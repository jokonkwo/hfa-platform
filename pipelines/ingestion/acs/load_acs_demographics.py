"""
Annual refresh: Census ACS 5-Year Data Profile → MotherDuck HFA_DEV.raw_acs_demographics.

Pulls ACS 2024 (and 2023 for growth calcs) at state, county, and ZCTA levels for
California. Re-runnable via CREATE OR REPLACE TABLE.

Run from repo root:
    python -m pipelines.ingestion.acs.load_acs_demographics [--check] [--vintage YEAR]

--check:    Print row counts without writing to MotherDuck.
--vintage:  Pull only a specific year (2024 or 2023). Default: both.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import urllib.request
import json
from typing import Any

# Census ACS 5-Year Data Profile variable list for a single pull
# Population and income fetched for both vintages (growth calc); rest for 2024 only.
VARS_MAIN = (
    "DP05_0001E,"   # Population
    "DP03_0062E,"   # Median HH Income
    "DP05_0018E,"   # Median Age
    "DP03_0128PE,"  # Poverty Rate (all people)
    "DP02_0060PE,"  # Ed: Less than 9th grade %
    "DP02_0061PE,"  # Ed: 9th-12th no diploma %
    "DP03_0009PE,"  # Unemployment Rate
    "DP02_0115PE,"  # Speak English less than very well %
    "DP04_0141E,"   # Renters: 30-34.9% of income on rent (count)
    "DP04_0142E,"   # Renters: 35%+ of income on rent (count)
    "DP04_0136E"    # Total renters paying rent (denominator)
)

CA_FIPS = "06"
CENSUS_BASE = "https://api.census.gov/data"

# ZCTAs for California — full range 900–961 (all valid CA 3-digit prefixes)
CA_ZIP_PREFIXES = tuple(f"{p:03d}" for p in range(900, 962))


def _null(v: Any) -> Any:
    """Convert Census suppression codes to None."""
    if v is None:
        return None
    try:
        f = float(v)
        if f in (-666666666.0, -999999999.0, -888888888.0):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _get_api_key() -> str:
    key = os.environ.get("CENSUS_API_KEY", "").strip()
    if not key:
        from dotenv import load_dotenv
        load_dotenv()
        key = os.environ.get("CENSUS_API_KEY", "").strip()
    if not key:
        sys.exit("CENSUS_API_KEY not set.")
    return key


def _get_token() -> str:
    tok = os.environ.get("MOTHERDUCK_TOKEN", "")
    if not tok:
        from dotenv import load_dotenv
        load_dotenv()
        tok = os.environ.get("MOTHERDUCK_TOKEN", "")
    return tok[4:] if tok.startswith("mdt_") else tok


def _fetch(url: str) -> list[list]:
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    return []


def _pull_vintage(vintage: int, api_key: str) -> dict[str, list[dict]]:
    """Return {'state': [...], 'county': [...], 'zcta': [...]} for one vintage."""
    base = f"{CENSUS_BASE}/{vintage}/acs/acs5/profile"

    def _parse(rows: list[list], headers: list[str], geo_level: str, geoid_col: str, name_fn=None) -> list[dict]:
        idx = {h: i for i, h in enumerate(headers)}
        out = []
        for row in rows:
            geoid = row[idx[geoid_col]]
            name = name_fn(row, idx) if name_fn else geoid

            pop = _null(row[idx.get("DP05_0001E", -1)] if "DP05_0001E" in idx else None)
            income = _null(row[idx.get("DP03_0062E", -1)] if "DP03_0062E" in idx else None)
            age = _null(row[idx.get("DP05_0018E", -1)] if "DP05_0018E" in idx else None)
            poverty = _null(row[idx.get("DP03_0128PE", -1)] if "DP03_0128PE" in idx else None)
            ed_9th = _null(row[idx.get("DP02_0060PE", -1)] if "DP02_0060PE" in idx else None)
            ed_nodip = _null(row[idx.get("DP02_0061PE", -1)] if "DP02_0061PE" in idx else None)
            unemp = _null(row[idx.get("DP03_0009PE", -1)] if "DP03_0009PE" in idx else None)
            lim_eng = _null(row[idx.get("DP02_0115PE", -1)] if "DP02_0115PE" in idx else None)
            rent_30_34 = _null(row[idx.get("DP04_0141E", -1)] if "DP04_0141E" in idx else None)
            rent_35p = _null(row[idx.get("DP04_0142E", -1)] if "DP04_0142E" in idx else None)
            rent_total = _null(row[idx.get("DP04_0136E", -1)] if "DP04_0136E" in idx else None)

            ed_hs = (
                round((ed_9th or 0) + (ed_nodip or 0), 2)
                if ed_9th is not None or ed_nodip is not None
                else None
            )
            housing_burden = (
                round((rent_30_34 + rent_35p) / rent_total * 100, 2)
                if rent_total and rent_total > 0 and rent_30_34 is not None and rent_35p is not None
                else None
            )

            out.append({
                "geoid": geoid,
                "name": name,
                "state_fp": row[idx["state"]] if "state" in idx else CA_FIPS,
                "population": int(pop) if pop is not None else None,
                "median_hh_income": income,
                "median_age": age,
                "poverty_rate_pct": poverty,
                "ed_less_than_hs_pct": ed_hs,
                "unemployment_rate_pct": unemp,
                "limited_english_pct": lim_eng,
                "housing_cost_burden_pct": housing_burden,
            })
        return out

    results = {}

    # State
    print(f"  [{vintage}] Fetching state...", end=" ", flush=True)
    url = f"{base}?get={VARS_MAIN}&for=state:{CA_FIPS}&key={api_key}"
    raw = _fetch(url)
    headers = raw[0]
    state_rows = _parse(raw[1:], headers, "state", "state",
                        name_fn=lambda r, idx: "California")
    results["state"] = state_rows
    print(f"{len(state_rows)} rows", flush=True)
    time.sleep(0.3)

    # County
    print(f"  [{vintage}] Fetching counties...", end=" ", flush=True)
    url = f"{base}?get={VARS_MAIN}&for=county:*&in=state:{CA_FIPS}&key={api_key}"
    raw = _fetch(url)
    headers = raw[0]

    def _county_geoid(row, idx):
        return row[idx["state"]] + row[idx["county"]]

    def _county_name(row, idx):
        # We'll fill from MotherDuck later; use placeholder
        return row[idx["county"]]

    county_rows_raw = raw[1:]

    def _parse_county(rows, headers):
        idx = {h: i for i, h in enumerate(headers)}
        out = []
        for row in rows:
            geoid = row[idx["state"]] + row[idx["county"]]
            name = geoid  # placeholder; replaced below via MotherDuck lookup

            pop = _null(row[idx["DP05_0001E"]])
            income = _null(row[idx["DP03_0062E"]])
            age = _null(row[idx["DP05_0018E"]])
            poverty = _null(row[idx["DP03_0128PE"]])
            ed_9th = _null(row[idx["DP02_0060PE"]])
            ed_nodip = _null(row[idx["DP02_0061PE"]])
            unemp = _null(row[idx["DP03_0009PE"]])
            lim_eng = _null(row[idx["DP02_0115PE"]])
            rent_30_34 = _null(row[idx["DP04_0141E"]])
            rent_35p = _null(row[idx["DP04_0142E"]])
            rent_total = _null(row[idx["DP04_0136E"]])

            ed_hs = (
                round((ed_9th or 0) + (ed_nodip or 0), 2)
                if ed_9th is not None or ed_nodip is not None
                else None
            )
            housing_burden = (
                round((rent_30_34 + rent_35p) / rent_total * 100, 2)
                if rent_total and rent_total > 0 and rent_30_34 is not None and rent_35p is not None
                else None
            )

            out.append({
                "geoid": geoid,
                "name": name,
                "state_fp": CA_FIPS,
                "population": int(pop) if pop is not None else None,
                "median_hh_income": income,
                "median_age": age,
                "poverty_rate_pct": poverty,
                "ed_less_than_hs_pct": ed_hs,
                "unemployment_rate_pct": unemp,
                "limited_english_pct": lim_eng,
                "housing_cost_burden_pct": housing_burden,
            })
        return out

    county_rows = _parse_county(county_rows_raw, headers)
    results["county"] = county_rows
    print(f"{len(county_rows)} rows", flush=True)
    time.sleep(0.3)

    # ZCTA (national pull, filter to CA)
    print(f"  [{vintage}] Fetching ZCTAs (national)...", end=" ", flush=True)
    url = f"{base}?get={VARS_MAIN}&for=zip%20code%20tabulation%20area:*&key={api_key}"
    raw = _fetch(url)
    headers_zcta = raw[0]
    idx_zcta = {h: i for i, h in enumerate(headers_zcta)}
    zip_col = "zip code tabulation area"

    all_zcta_rows = raw[1:]
    ca_zcta_rows = [r for r in all_zcta_rows if r[idx_zcta[zip_col]][:3] in CA_ZIP_PREFIXES]

    def _parse_zcta(rows, headers):
        idx = {h: i for i, h in enumerate(headers)}
        zcol = "zip code tabulation area"
        out = []
        for row in rows:
            zip5 = row[idx[zcol]]
            pop = _null(row[idx["DP05_0001E"]])
            income = _null(row[idx["DP03_0062E"]])
            age = _null(row[idx["DP05_0018E"]])
            poverty = _null(row[idx["DP03_0128PE"]])
            ed_9th = _null(row[idx["DP02_0060PE"]])
            ed_nodip = _null(row[idx["DP02_0061PE"]])
            unemp = _null(row[idx["DP03_0009PE"]])
            lim_eng = _null(row[idx["DP02_0115PE"]])
            rent_30_34 = _null(row[idx["DP04_0141E"]])
            rent_35p = _null(row[idx["DP04_0142E"]])
            rent_total = _null(row[idx["DP04_0136E"]])

            ed_hs = (
                round((ed_9th or 0) + (ed_nodip or 0), 2)
                if ed_9th is not None or ed_nodip is not None
                else None
            )
            housing_burden = (
                round((rent_30_34 + rent_35p) / rent_total * 100, 2)
                if rent_total and rent_total > 0 and rent_30_34 is not None and rent_35p is not None
                else None
            )

            out.append({
                "geoid": zip5,
                "name": zip5,
                "state_fp": CA_FIPS,
                "population": int(pop) if pop is not None else None,
                "median_hh_income": income,
                "median_age": age,
                "poverty_rate_pct": poverty,
                "ed_less_than_hs_pct": ed_hs,
                "unemployment_rate_pct": unemp,
                "limited_english_pct": lim_eng,
                "housing_cost_burden_pct": housing_burden,
            })
        return out

    zcta_rows = _parse_zcta(ca_zcta_rows, headers_zcta)
    results["zcta"] = zcta_rows
    print(f"{len(all_zcta_rows)} national → {len(zcta_rows)} CA rows", flush=True)

    return results


def main(check_only: bool = False, vintages: list[int] | None = None) -> None:
    import duckdb

    if vintages is None:
        vintages = [2024, 2023]

    api_key = _get_api_key()

    print("Fetching Census ACS data...", flush=True)
    data_by_vintage: dict[int, dict[str, list[dict]]] = {}
    for v in vintages:
        data_by_vintage[v] = _pull_vintage(v, api_key)

    if check_only:
        print("\n=== CHECK (no write to MotherDuck) ===")
        for v, tiers in data_by_vintage.items():
            for level, rows in tiers.items():
                print(f"  {v} {level}: {len(rows)} rows")
        return

    tok = _get_token()
    print("\nConnecting to MotherDuck HFA_DEV...", flush=True)
    con = duckdb.connect("md:HFA_DEV", config={"motherduck_token": tok})
    con.execute("LOAD spatial")

    # Fetch county names from raw_us_counties (already in MotherDuck)
    print("Fetching county names from MotherDuck...", flush=True)
    county_names = {
        row[0]: row[1]
        for row in con.execute(
            "SELECT geoid, name_lsad FROM raw_us_counties WHERE state_fp = ?",
            [CA_FIPS],
        ).fetchall()
    }

    # Build final rows (2024 vintage only, with growth rates from 2023)
    final_rows: list[tuple] = []
    vintage_main = 2024 if 2024 in data_by_vintage else min(data_by_vintage.keys())
    vintage_prior = 2023 if 2023 in data_by_vintage else None

    for level in ("state", "county", "zcta"):
        rows_main = data_by_vintage[vintage_main].get(level, [])
        rows_prior = {r["geoid"]: r for r in (data_by_vintage[vintage_prior].get(level, []) if vintage_prior else [])}

        for row in rows_main:
            geoid = row["geoid"]
            name = row["name"]

            if level == "county":
                name = county_names.get(geoid, geoid)

            prior = rows_prior.get(geoid)

            pop_growth = None
            income_growth = None
            if prior:
                pop_24 = row["population"]
                pop_23 = prior["population"]
                if pop_24 is not None and pop_23 is not None and pop_23 != 0:
                    pop_growth = round((pop_24 - pop_23) / pop_23 * 100, 3)

                inc_24 = row["median_hh_income"]
                inc_23 = prior["median_hh_income"]
                if inc_24 is not None and inc_23 is not None and inc_23 != 0:
                    income_growth = round((inc_24 - inc_23) / inc_23 * 100, 3)

            final_rows.append((
                vintage_main,
                level,
                geoid,
                name,
                row["state_fp"],
                row["population"],
                row["median_hh_income"],
                row["median_age"],
                row["poverty_rate_pct"],
                row["ed_less_than_hs_pct"],
                row["unemployment_rate_pct"],
                row["limited_english_pct"],
                row["housing_cost_burden_pct"],
                None,   # pop_density_per_sq_mi — computed below via spatial join
                pop_growth,
                income_growth,
            ))

    print(f"\nInserting {len(final_rows)} rows into raw_acs_demographics...", flush=True)
    con.execute("""
        CREATE OR REPLACE TABLE raw_acs_demographics (
            vintage INTEGER,
            geography_level VARCHAR,
            geoid VARCHAR,
            name VARCHAR,
            state_fp VARCHAR,
            population BIGINT,
            median_hh_income DOUBLE,
            median_age DOUBLE,
            poverty_rate_pct DOUBLE,
            ed_less_than_hs_pct DOUBLE,
            unemployment_rate_pct DOUBLE,
            limited_english_pct DOUBLE,
            housing_cost_burden_pct DOUBLE,
            pop_density_per_sq_mi DOUBLE,
            pop_growth_pct DOUBLE,
            income_growth_pct DOUBLE
        )
    """)

    con.executemany(
        "INSERT INTO raw_acs_demographics VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        final_rows,
    )

    # Compute population density via spatial join against existing geometry tables
    print("Computing population density via spatial joins...", flush=True)

    # State density
    con.execute("""
        UPDATE raw_acs_demographics d
        SET pop_density_per_sq_mi = (
            SELECT CASE
                WHEN d.population IS NOT NULL AND sq_mi > 0
                THEN ROUND(d.population / sq_mi, 2)
                ELSE NULL
            END
            FROM (
                SELECT ST_Area(geom) * POW(111319.9, 2)
                    * COS(RADIANS(ST_Y(ST_Centroid(geom)))) / 2589988.0 AS sq_mi
                FROM raw_us_states
                WHERE geoid = d.geoid
                LIMIT 1
            ) g
        )
        WHERE d.geography_level = 'state'
    """)

    # County density
    con.execute("""
        UPDATE raw_acs_demographics d
        SET pop_density_per_sq_mi = (
            SELECT CASE
                WHEN d.population IS NOT NULL AND sq_mi > 0
                THEN ROUND(d.population / sq_mi, 2)
                ELSE NULL
            END
            FROM (
                SELECT ST_Area(geom) * POW(111319.9, 2)
                    * COS(RADIANS(ST_Y(ST_Centroid(geom)))) / 2589988.0 AS sq_mi
                FROM raw_us_counties
                WHERE geoid = d.geoid
                LIMIT 1
            ) g
        )
        WHERE d.geography_level = 'county'
    """)

    # ZCTA density
    con.execute("""
        UPDATE raw_acs_demographics d
        SET pop_density_per_sq_mi = (
            SELECT CASE
                WHEN d.population IS NOT NULL AND sq_mi > 0
                THEN ROUND(d.population / sq_mi, 2)
                ELSE NULL
            END
            FROM (
                SELECT ST_Area(geom) * POW(111319.9, 2)
                    * COS(RADIANS(ST_Y(ST_Centroid(geom)))) / 2589988.0 AS sq_mi
                FROM raw_us_zctas
                WHERE zip5 = d.geoid
                LIMIT 1
            ) g
        )
        WHERE d.geography_level = 'zcta'
    """)

    # Summary
    counts = con.execute(
        "SELECT geography_level, COUNT(*) FROM raw_acs_demographics GROUP BY geography_level ORDER BY 1"
    ).fetchall()
    print("\n=== Import complete ===")
    for level, count in counts:
        print(f"  {level}: {count} rows")

    samples = con.execute("""
        SELECT geography_level, name, population, median_hh_income, pop_density_per_sq_mi
        FROM raw_acs_demographics
        WHERE name IN ('California', 'Fresno County', '93701')
        ORDER BY geography_level
    """).fetchall()
    print("\n  Sample rows:")
    for row in samples:
        print(f"    {row[0]}: {row[1]}, pop={row[2]:,}, income={row[3]}, density={row[4]}")

    con.close()
    print("\nDone. raw_acs_demographics is now in HFA_DEV.main")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load ACS demographics into MotherDuck HFA_DEV")
    parser.add_argument("--check", action="store_true", help="Report counts only; do not write")
    parser.add_argument("--vintage", type=int, help="Pull only a specific vintage year")
    args = parser.parse_args()

    v_list = [args.vintage, args.vintage - 1] if args.vintage else None
    main(check_only=args.check, vintages=v_list)
