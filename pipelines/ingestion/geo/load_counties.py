from __future__ import annotations

import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

from pipelines.common.config import PipelineConfig
from pipelines.common.db import connect
from pipelines.common.logging_setup import get_logger

logger = get_logger(__name__)


TIGER_COUNTY_URL = "https://www2.census.gov/geo/tiger/TIGER2025/COUNTY/tl_2025_us_county.zip"
CA_STATEFP = "06"


@dataclass(frozen=True)
class GeoCountyIngestStats:
    rows_loaded: int
    shp_path: str
    statefp: str


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Downloading geo file", extra={"url": url, "dest": str(dest)})

    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)


def _unzip(zip_path: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Extracting zip", extra={"zip_path": str(zip_path), "out_dir": str(out_dir)})

    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(out_dir)


def _find_shapefile(dir_path: Path) -> Path:
    shp_files = list(dir_path.glob("*.shp"))
    if not shp_files:
        raise FileNotFoundError(f"No .shp file found in: {dir_path}")
    if len(shp_files) > 1:
        shp_files.sort(key=lambda p: p.stat().st_size, reverse=True)
    return shp_files[0]


def _load_spatial_extension(con: Any) -> None:
    con.execute("INSTALL spatial;")
    con.execute("LOAD spatial;")


def _get_columns(con: Any, view_name: str) -> list[str]:
    rows = con.execute(f"PRAGMA table_info('{view_name}')").fetchall()
    return [r[1] for r in rows]


def _pick_col(candidates: list[str], cols: list[str]) -> str | None:
    for c in candidates:
        if c in cols:
            return c
    for pref in candidates:
        for c in cols:
            if c.upper().startswith(pref.upper()):
                return c
    return None


def ensure_raw_county_table(con: Any) -> None:
    con.execute("CREATE SCHEMA IF NOT EXISTS raw;")
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS raw.raw_county_boundaries (
          statefp VARCHAR,
          countyfp VARCHAR,
          geoid VARCHAR,
          name VARCHAR,
          geometry GEOMETRY,
          source VARCHAR,
          ingested_at TIMESTAMP
        );
        """
    )


def load_counties(cfg: PipelineConfig, statefp: str = CA_STATEFP, url: str = TIGER_COUNTY_URL) -> GeoCountyIngestStats:
    """
    Ingest Census county polygons into raw.raw_county_boundaries filtered to a single state (default CA).

    statefp:
      - "06" = California
    """
    base_dir = cfg.external_data_dir / "geo" / "counties"
    zip_path = base_dir / "tl_us_county.zip"
    extract_dir = base_dir / "extracted"

    if not zip_path.exists():
        _download(url, zip_path)
    if not extract_dir.exists() or not any(extract_dir.glob("*.shp")):
        _unzip(zip_path, extract_dir)

    shp_path = _find_shapefile(extract_dir)

    con = connect(cfg)
    try:
        _load_spatial_extension(con)
        ensure_raw_county_table(con)

        con.execute("DROP VIEW IF EXISTS _county_src;")
        con.execute(f"CREATE VIEW _county_src AS SELECT * FROM ST_Read('{shp_path.as_posix()}');")

        cols = _get_columns(con, "_county_src")

        statefp_col = _pick_col(["STATEFP", "STATEFP20", "STATEFP10"], cols)
        countyfp_col = _pick_col(["COUNTYFP", "COUNTYFP20", "COUNTYFP10"], cols)
        geoid_col = _pick_col(["GEOID", "GEOID20", "GEOID10"], cols)
        name_col = _pick_col(["NAME", "NAMELSAD"], cols)
        geom_col = _pick_col(["geom", "geometry", "wkb_geometry", "shape"], cols) or "geom"

        if not statefp_col or not countyfp_col or not geoid_col or not name_col:
            raise RuntimeError(f"Missing expected columns in county shapefile. Columns: {cols}")

        # Replace existing table (static dataset)
        con.execute("DELETE FROM raw.raw_county_boundaries WHERE statefp = ?;", [statefp])

        con.execute(
            f"""
            INSERT INTO raw.raw_county_boundaries
              (statefp, countyfp, geoid, name, geometry, source, ingested_at)
            SELECT
              cast({statefp_col} as varchar) as statefp,
              cast({countyfp_col} as varchar) as countyfp,
              cast({geoid_col} as varchar) as geoid,
              cast({name_col} as varchar) as name,
              {geom_col} as geometry,
              'census_tiger_county' as source,
              current_timestamp as ingested_at
            FROM _county_src
            WHERE {statefp_col} = '{statefp}';
            """
        )

        rows_loaded = con.execute(
            "SELECT COUNT(*) FROM raw.raw_county_boundaries WHERE statefp = ?;",
            [statefp],
        ).fetchone()[0]

        logger.info("Loaded county boundaries", extra={"rows_loaded": int(rows_loaded), "statefp": statefp})
        return GeoCountyIngestStats(rows_loaded=int(rows_loaded), shp_path=str(shp_path), statefp=statefp)
    finally:
        try:
            con.close()
        except Exception:
            pass
