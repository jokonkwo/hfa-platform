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


TIGER_ZCTA_URL = "https://www2.census.gov/geo/tiger/TIGER2025/ZCTA520/tl_2025_us_zcta520.zip"


@dataclass(frozen=True)
class GeoIngestStats:
    rows_loaded: int
    shp_path: str
    scope: str


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
        # pick the largest as a simple heuristic
        shp_files.sort(key=lambda p: p.stat().st_size, reverse=True)
    return shp_files[0]


def _load_spatial_extension(con: Any) -> None:
    # DuckDB spatial extension (works for local DuckDB; MotherDuck may also support it depending on environment)
    con.execute("INSTALL spatial;")
    con.execute("LOAD spatial;")


def _get_columns(con: Any, view_name: str) -> list[str]:
    rows = con.execute(f"PRAGMA table_info('{view_name}')").fetchall()
    # rows: (cid, name, type, notnull, dflt_value, pk)
    return [r[1] for r in rows]


def _pick_col(candidates: list[str], cols: list[str]) -> str | None:
    for c in candidates:
        if c in cols:
            return c
    # fallback: any column that starts with candidate prefix (e.g., STATEFP*)
    for pref in candidates:
        for c in cols:
            if c.upper().startswith(pref.upper()):
                return c
    return None


def ensure_raw_zip_table(con: Any) -> None:
    con.execute("CREATE SCHEMA IF NOT EXISTS raw;")
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS raw.raw_zip_boundaries (
          zip VARCHAR,
          county_name VARCHAR,
          geometry GEOMETRY,
          source VARCHAR,
          ingested_at TIMESTAMP
        );
        """
    )


def load_zip_boundaries(cfg: PipelineConfig, scope: str = "us", url: str = TIGER_ZCTA_URL) -> GeoIngestStats:
    """
    Ingest Census ZCTA polygons into raw.raw_zip_boundaries.

    scope:
      - "us": load all ZCTAs
      - "ca": attempt to filter to California if STATEFP-like column exists (06)
        (If the dataset does not contain a usable STATEFP column, we fall back to full load.)

    Note:
    - county_name is left NULL here (ZCTA files typically don't include county name).
      We'll derive county_name later by joining ZIP polygons to county polygons (future geo slice),
      or we can keep county_name null for v1 if your UI only needs ZIPs inside a selected county
      once we have a county-ZIP relationship.
    """
    if scope not in {"us", "ca"}:
        raise ValueError("scope must be one of: us, ca")

    # Download/extract into data/external/geo/...
    base_dir = cfg.external_data_dir / "geo" / "zcta520"
    zip_path = base_dir / "tl_us_zcta520.zip"
    extract_dir = base_dir / "extracted"

    if not zip_path.exists():
        _download(url, zip_path)
    if not extract_dir.exists() or not any(extract_dir.glob("*.shp")):
        _unzip(zip_path, extract_dir)

    shp_path = _find_shapefile(extract_dir)

    con = connect(cfg)
    try:
        _load_spatial_extension(con)
        ensure_raw_zip_table(con)

        # Read shapefile into a view so we can inspect column names
        con.execute("DROP VIEW IF EXISTS _zcta_src;")
        con.execute(f"CREATE VIEW _zcta_src AS SELECT * FROM ST_Read('{shp_path.as_posix()}');")

        cols = _get_columns(con, "_zcta_src")

        # ZCTA code column varies by vintage; pick the most likely
        zip_col = _pick_col(
            candidates=["ZCTA5CE20", "ZCTA5CE10", "ZCTA5CE00", "ZCTA5CE"],
            cols=cols,
        )
        if not zip_col:
            raise RuntimeError(f"Could not find ZCTA column in shapefile. Columns: {cols}")

        # Geometry column name may vary; DuckDB ST_Read typically creates "geom"
        geom_col = _pick_col(candidates=["geom", "geometry", "wkb_geometry", "shape"], cols=cols) or "geom"

        # Optional CA filtering if STATEFP exists
        statefp_col = _pick_col(candidates=["STATEFP", "STATEFP20", "STATEFP10"], cols=cols)

        where_clause = ""
        if scope == "ca":
            if statefp_col:
                where_clause = f"WHERE {statefp_col} = '06'"
                logger.info("Filtering ZCTAs to California", extra={"statefp_col": statefp_col})
            else:
                logger.warning("No STATEFP column found; falling back to full US ZCTA load")

        # Replace existing table on each run (static dataset)
        con.execute("DELETE FROM raw.raw_zip_boundaries;")

        con.execute(
            f"""
            INSERT INTO raw.raw_zip_boundaries (zip, county_name, geometry, source, ingested_at)
            SELECT
              cast({zip_col} as varchar) as zip,
              cast(NULL as varchar) as county_name,
              {geom_col} as geometry,
              'census_tiger_zcta520' as source,
              current_timestamp as ingested_at
            FROM _zcta_src
            {where_clause};
            """
        )

        rows_loaded = con.execute("SELECT COUNT(*) FROM raw.raw_zip_boundaries;").fetchone()[0]

        logger.info(
            "Loaded ZIP boundaries",
            extra={"rows_loaded": int(rows_loaded), "scope": scope, "shp_path": str(shp_path)},
        )

        return GeoIngestStats(rows_loaded=int(rows_loaded), shp_path=str(shp_path), scope=scope)
    finally:
        try:
            con.close()
        except Exception:
            pass
