"""
One-time import: Census 2024 Cartographic Boundary places → MotherDuck HFA_DEV.

Downloads cb_2024_us_place_500k.zip (US incorporated places + CDPs, ~31k rows).
Stores only metadata (no polygon geometry) — centroid_lon/lat precomputed, and
county_geoid resolved via spatial join against raw_us_counties in HFA_DEV.

Run from repo root:
    python -m pipelines.ingestion.geo.load_places [--check]

--check: prints estimated storage impact without writing to MotherDuck.
"""
from __future__ import annotations

import argparse
import os
import sys
import zipfile
from pathlib import Path

PLACES_URL = "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_place_500k.zip"
LOCAL_ZIP = Path.home() / "Downloads" / "cb_2024_us_place_500k.zip"
LOCAL_EXTRACT = Path.home() / "Downloads" / "cb_2024_us_place_500k"


def _download(url: str, dest: Path) -> None:
    import urllib.request
    print(f"Downloading {url} → {dest} …", flush=True)
    dest.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, dest)
    print(f"  Done. {dest.stat().st_size / 1_048_576:.1f} MB", flush=True)


def _unzip(zip_path: Path, out_dir: Path) -> None:
    print(f"Extracting {zip_path} → {out_dir} …", flush=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(out_dir)
    print("  Done.", flush=True)


def _find_shp(directory: Path) -> Path:
    shp_files = list(directory.glob("*.shp"))
    if not shp_files:
        raise FileNotFoundError(f"No .shp found in {directory}")
    return sorted(shp_files, key=lambda p: p.stat().st_size, reverse=True)[0]


def _get_token() -> str:
    tok = os.environ.get("MOTHERDUCK_TOKEN", "")
    if not tok:
        from dotenv import load_dotenv
        load_dotenv()
        tok = os.environ.get("MOTHERDUCK_TOKEN", "")
    if not tok:
        sys.exit("MOTHERDUCK_TOKEN not set. Source .env first.")
    return tok[4:] if tok.startswith("mdt_") else tok


def main(check_only: bool = False) -> None:
    import duckdb

    # ── Ensure local shapefile ────────────────────────────────────────────────
    if not LOCAL_ZIP.exists():
        _download(PLACES_URL, LOCAL_ZIP)
    else:
        print(f"Using cached {LOCAL_ZIP} ({LOCAL_ZIP.stat().st_size / 1_048_576:.1f} MB)", flush=True)

    if not LOCAL_EXTRACT.exists() or not any(LOCAL_EXTRACT.glob("*.shp")):
        _unzip(LOCAL_ZIP, LOCAL_EXTRACT)

    shp_path = _find_shp(LOCAL_EXTRACT)
    print(f"Shapefile: {shp_path}", flush=True)

    # ── Connect (in-memory for check, MotherDuck for import) ─────────────────
    if check_only:
        print("\n=== STORAGE CHECK (in-memory DuckDB, no write to MotherDuck) ===", flush=True)
        con = duckdb.connect(":memory:")
    else:
        tok = _get_token()
        print("\nConnecting to MotherDuck HFA_DEV …", flush=True)
        con = duckdb.connect("md:HFA_DEV", config={"motherduck_token": tok})

    con.execute("INSTALL spatial; LOAD spatial;")

    shp_posix = shp_path.as_posix()

    # ── Load shapefile into staging ───────────────────────────────────────────
    print("Loading shapefile into staging table …", flush=True)
    # Discover the geometry column name (TIGER shapefiles use 'geom' not 'geometry')
    cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM ST_Read('{shp_posix}') LIMIT 0").fetchall()]
    geom_col = next((c for c in cols if c.lower() in ("geom", "geometry", "wkb_geometry", "shape")), None)
    if not geom_col:
        sys.exit(f"Could not find geometry column. Available columns: {cols}")
    print(f"  Geometry column: {geom_col!r}", flush=True)

    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE _places_staging AS
        SELECT
            STATEFP      AS state_fp,
            GEOID        AS place_geoid,
            NAME         AS name,
            NAMELSAD     AS name_lsad,
            LSAD         AS lsad,
            ST_Centroid({geom_col}) AS centroid_geom,
            {geom_col}   AS geometry
        FROM ST_Read('{shp_posix}')
    """)

    row_count = con.execute("SELECT COUNT(*) FROM _places_staging").fetchone()[0]
    print(f"  Loaded {row_count:,} place features", flush=True)

    if check_only:
        # Estimate storage for metadata-only table (no geometry)
        con.execute("""
            CREATE OR REPLACE TEMP TABLE _places_check AS
            SELECT
                place_geoid,
                name,
                name_lsad,
                state_fp,
                lsad,
                ROUND(ST_X(centroid_geom), 6) AS centroid_lon,
                ROUND(ST_Y(centroid_geom), 6) AS centroid_lat,
                NULL::VARCHAR AS county_geoid
            FROM _places_staging
        """)
        size_mb = con.execute("""
            SELECT ROUND(SUM(LENGTH(place_geoid) + LENGTH(name) + LENGTH(name_lsad)
                            + LENGTH(COALESCE(lsad,'')) + LENGTH(state_fp)
                            + 8 + 8) / 1048576.0, 2)
            FROM _places_check
        """).fetchone()[0]

        print(f"\nEstimated storage for raw_us_places (metadata only, no geometry):")
        print(f"  Rows:              {row_count:,}")
        print(f"  Approx raw bytes:  ~{size_mb:.1f} MB (compressed in MotherDuck: ~1–2 MB)")
        print(f"  Comparison:        raw_us_zctas with geometry is ~213 MB")
        print(f"\nThis is a very lightweight table — safe to import.")
        print("Re-run without --check to write to MotherDuck.")
        return

    # ── Spatial join: find containing county for each place centroid ──────────
    print("\nSpatial join: resolving county_geoid for each place …", flush=True)
    print("  (This joins 31k place centroids against 3,235 county polygons)", flush=True)
    con.execute("""
        CREATE OR REPLACE TABLE raw_us_places AS
        SELECT
            p.place_geoid,
            p.name,
            p.name_lsad,
            p.state_fp,
            p.lsad,
            ROUND(ST_X(p.centroid_geom), 6) AS centroid_lon,
            ROUND(ST_Y(p.centroid_geom), 6) AS centroid_lat,
            (
                SELECT c.geoid
                FROM raw_us_counties c
                WHERE c.state_fp = p.state_fp
                  AND ST_Within(p.centroid_geom, c.geom)
                LIMIT 1
            ) AS county_geoid
        FROM _places_staging p
    """)

    final_count = con.execute("SELECT COUNT(*) FROM raw_us_places").fetchone()[0]
    matched_count = con.execute(
        "SELECT COUNT(*) FROM raw_us_places WHERE county_geoid IS NOT NULL"
    ).fetchone()[0]

    print(f"\n=== Import complete ===")
    print(f"  Total rows:       {final_count:,}")
    print(f"  County matched:   {matched_count:,} ({100*matched_count/final_count:.1f}%)")
    print(f"  Unmatched:        {final_count - matched_count:,} (centroid outside all county polygons — typically coastal/border places)")

    # Sample check
    samples = con.execute("""
        SELECT name, name_lsad, state_fp, county_geoid, centroid_lon, centroid_lat
        FROM raw_us_places
        WHERE county_geoid IS NOT NULL
        ORDER BY RANDOM()
        LIMIT 5
    """).fetchall()
    print("\n  Sample rows:")
    for row in samples:
        print(f"    {row[0]} / {row[1]}, state={row[2]}, county={row[3]}, lon={row[4]}, lat={row[5]}")

    con.close()
    print("\nDone. raw_us_places is now in HFA_DEV.main")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load Census places into MotherDuck HFA_DEV")
    parser.add_argument("--check", action="store_true", help="Report storage impact only; do not write")
    args = parser.parse_args()
    main(check_only=args.check)
