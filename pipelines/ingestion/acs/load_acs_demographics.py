"""
Annual refresh: Census data → MotherDuck HFA_DEV.raw_acs_demographics.

Data sources by geography and field:
  - STATE / COUNTY — Population, Pop Density, Pop Growth:
      Census PEP (Population Estimates Program) Vintage 2024 CSV.
      URL: https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/counties/totals/co-est2024-alldata.csv
      Provides POPESTIMATE2023 and POPESTIMATE2024 per county/state.
      Coverage: 50 US states + DC. Puerto Rico and unincorporated territories
      are absent from PEP and fall back to ACS 5-Year for those geoids.
  - ZCTA (ZIP-tier) — Population, Pop Density, Pop Growth:
      ACS 5-Year 2024 only (PEP does not publish ZCTA-level estimates).
  - ALL levels — all other fields (Median HH Income, Median Age, Poverty Rate,
      Ed Attainment, Unemployment, Linguistic Isolation, Housing Cost Burden,
      Income Growth): ACS 5-Year Data Profile 2024 (and 2023 for growth).

Pulls ACS 2024 (and 2023 for income_growth and ZCTA pop_growth) at:
  - STATE level: all 52 US states/territories (for=state:*)
  - COUNTY level: all ~3,222 US counties nationally (for=county:*&in=state:*)
  - ZCTA level: California only (filtered from national pull)

Re-runnable via CREATE OR REPLACE TABLE.

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

# PEP Vintage 2024: county/state total population estimates.
# Covers 50 US states + DC (3,144 county rows + 51 state rows, COUNTY=000).
# Puerto Rico (FP=72) and territories are absent — ACS used as fallback for those.
PEP_CSV_URL = (
    "https://www2.census.gov/programs-surveys/popest/datasets/"
    "2020-2024/counties/totals/co-est2024-alldata.csv"
)

# ZCTAs for California — full range 900–961 (all valid CA 3-digit prefixes)
CA_ZIP_PREFIXES = tuple(f"{p:03d}" for p in range(900, 962))

# State FP codes present in Census API response (50 states + DC + PR + territories)
# Used only for sanity checks; all states fetched via wildcard.
_ALL_STATE_GEO_LEVELS = ("state", "county", "zcta")


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


def _fetch_bytes(url: str) -> bytes:
    """Like _fetch but returns raw bytes (for non-JSON sources like CSV files)."""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    return b""


def _fetch_pep_vintage2024() -> dict[str, dict[str, dict]]:
    """Download PEP Vintage 2024 county/state totals CSV from Census FTP.

    Returns population estimates keyed by FIPS:
        {
          "state":  {state_fp_2char: {"pop_2024": int, "pop_2023": int}},
          "county": {geoid_5char:   {"pop_2024": int, "pop_2023": int}},
        }

    Coverage: 50 US states + DC (state COUNTY=000 rows) and 3,144 county rows.
    Puerto Rico (FP=72) and unincorporated territories are absent; callers fall
    back to ACS 5-Year for any geoid not found in the returned dicts.
    """
    import io
    import csv as csv_mod

    print("Downloading PEP Vintage 2024 county CSV...", end=" ", flush=True)
    raw = _fetch_bytes(PEP_CSV_URL)
    # Census FTP files use latin-1 (Puerto Rico's name contains non-ASCII)
    text = raw.decode("latin-1")
    reader = csv_mod.DictReader(io.StringIO(text))

    states: dict[str, dict] = {}
    counties: dict[str, dict] = {}

    for row in reader:
        entry = {
            "pop_2024": int(row["POPESTIMATE2024"]),
            "pop_2023": int(row["POPESTIMATE2023"]),
        }
        if row["COUNTY"] == "000":
            states[row["STATE"]] = entry
        else:
            counties[row["STATE"] + row["COUNTY"]] = entry

    print(f"{len(states)} state rows, {len(counties)} county rows", flush=True)
    return {"state": states, "county": counties}


def _parse_rows(rows: list[list], headers: list[str], geoid_fn, name_fn, state_fp_fn) -> list[dict]:
    """Generic row parser for any ACS geography level."""
    idx = {h: i for i, h in enumerate(headers)}
    out = []
    for row in rows:
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
            "geoid": geoid_fn(row, idx),
            "name": name_fn(row, idx),
            "state_fp": state_fp_fn(row, idx),
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


def _pull_vintage(vintage: int, api_key: str) -> dict[str, list[dict]]:
    """Return {'state': [...], 'county': [...], 'zcta': [...]} for one vintage.

    STATE and COUNTY are pulled nationally (all US states/territories).
    ZCTA is pulled nationally then filtered to California only.
    """
    base = f"{CENSUS_BASE}/{vintage}/acs/acs5/profile"
    results = {}

    # ── All states nationally ────────────────────────────────────────────────
    print(f"  [{vintage}] Fetching all states (national)...", end=" ", flush=True)
    raw = _fetch(f"{base}?get={VARS_MAIN}&for=state:*&key={api_key}")
    headers = raw[0]
    state_rows = _parse_rows(
        raw[1:], headers,
        geoid_fn=lambda r, idx: r[idx["state"]],
        name_fn=lambda r, idx: r[idx.get("NAME", 0)] if "NAME" in idx else r[idx["state"]],
        state_fp_fn=lambda r, idx: r[idx["state"]],
    )
    results["state"] = state_rows
    print(f"{len(state_rows)} rows", flush=True)
    time.sleep(0.4)

    # ── All counties nationally ───────────────────────────────────────────────
    print(f"  [{vintage}] Fetching all counties (national)...", end=" ", flush=True)
    raw = _fetch(f"{base}?get={VARS_MAIN}&for=county:*&in=state:*&key={api_key}")
    headers = raw[0]
    # geoid = state_fp (2 digits) + county_fp (3 digits) = 5-char FIPS
    county_rows = _parse_rows(
        raw[1:], headers,
        geoid_fn=lambda r, idx: r[idx["state"]] + r[idx["county"]],
        name_fn=lambda r, idx: r[idx["state"]] + r[idx["county"]],  # placeholder; replaced below
        state_fp_fn=lambda r, idx: r[idx["state"]],
    )
    results["county"] = county_rows
    print(f"{len(county_rows)} rows", flush=True)
    time.sleep(0.4)

    # ── ZCTAs — national pull, filter to CA ──────────────────────────────────
    print(f"  [{vintage}] Fetching ZCTAs (national, filtering to CA)...", end=" ", flush=True)
    raw = _fetch(f"{base}?get={VARS_MAIN}&for=zip%20code%20tabulation%20area:*&key={api_key}")
    headers_zcta = raw[0]
    idx_zcta = {h: i for i, h in enumerate(headers_zcta)}
    zip_col = "zip code tabulation area"
    all_zcta = raw[1:]
    ca_zcta = [r for r in all_zcta if r[idx_zcta[zip_col]][:3] in CA_ZIP_PREFIXES]
    zcta_rows = _parse_rows(
        ca_zcta, headers_zcta,
        geoid_fn=lambda r, idx: r[idx["zip code tabulation area"]],
        name_fn=lambda r, idx: r[idx["zip code tabulation area"]],
        state_fp_fn=lambda r, _idx: CA_FIPS,
    )
    results["zcta"] = zcta_rows
    print(f"{len(all_zcta)} national → {len(zcta_rows)} CA rows", flush=True)

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

    # Fetch county names nationally from raw_us_counties (already national in MotherDuck)
    print("Fetching county names from MotherDuck (national)...", flush=True)
    county_names = {
        row[0]: row[1]
        for row in con.execute(
            "SELECT geoid, name_lsad FROM raw_us_counties"
        ).fetchall()
    }
    print(f"  Loaded {len(county_names)} county names", flush=True)

    # Fetch state names from raw_us_states
    print("Fetching state names from MotherDuck...", flush=True)
    state_names = {
        row[0]: row[1]
        for row in con.execute(
            "SELECT state_fp, name FROM raw_us_states"
        ).fetchall()
    }
    print(f"  Loaded {len(state_names)} state names", flush=True)

    # Fetch PEP Vintage 2024 for state/county population + growth
    pep = _fetch_pep_vintage2024()

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

            if level == "state":
                name = state_names.get(geoid, geoid)
            elif level == "county":
                name = county_names.get(geoid, geoid)

            prior = rows_prior.get(geoid)

            # Income growth: always ACS (PEP has no income data)
            income_growth = None
            if prior:
                inc_24 = row["median_hh_income"]
                inc_23 = prior["median_hh_income"]
                if inc_24 is not None and inc_23 is not None and inc_23 != 0:
                    income_growth = round((inc_24 - inc_23) / inc_23 * 100, 3)

            # Population + pop_growth: PEP for state/county (where covered), ACS for ZCTA/missing
            # PEP is annual point-in-time (July 1); more current than ACS 5-year rolling average.
            # Puerto Rico (state_fp=72) and territories absent from PEP — ACS used as fallback.
            pep_entry = pep.get(level, {}).get(geoid) if level in ("state", "county") else None
            if pep_entry is not None:
                population = pep_entry["pop_2024"]
                pop_2023_pep = pep_entry["pop_2023"]
                pop_growth = (
                    round((population - pop_2023_pep) / pop_2023_pep * 100, 3)
                    if pop_2023_pep else None
                )
            else:
                population = row["population"]
                pop_growth = None
                if prior:
                    pop_24 = row["population"]
                    pop_23 = prior["population"]
                    if pop_24 is not None and pop_23 is not None and pop_23 != 0:
                        pop_growth = round((pop_24 - pop_23) / pop_23 * 100, 3)

            final_rows.append((
                vintage_main,
                level,
                geoid,
                name,
                row["state_fp"],
                population,
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

    import pandas as pd

    cols = [
        "vintage", "geography_level", "geoid", "name", "state_fp",
        "population", "median_hh_income", "median_age", "poverty_rate_pct",
        "ed_less_than_hs_pct", "unemployment_rate_pct", "limited_english_pct",
        "housing_cost_burden_pct", "pop_density_per_sq_mi",
        "pop_growth_pct", "income_growth_pct",
    ]
    df = pd.DataFrame(final_rows, columns=cols)
    df = df.astype({
        "vintage": "Int64", "population": "Int64",
    })

    print(f"\nInserting {len(df)} rows into raw_acs_demographics (bulk via DataFrame)...", flush=True)
    # Single CREATE AS SELECT — avoids row-by-row executemany lease timeout on MotherDuck
    con.execute("CREATE OR REPLACE TABLE raw_acs_demographics AS SELECT * FROM df")

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

    # National range verification
    print("\n  National ranges (state tier):")
    ranges = con.execute("""
        SELECT
            'population' AS field, MIN(population), MAX(population),
            (SELECT name FROM raw_acs_demographics WHERE geography_level='state' ORDER BY population ASC LIMIT 1) AS min_name,
            (SELECT name FROM raw_acs_demographics WHERE geography_level='state' ORDER BY population DESC LIMIT 1) AS max_name
        FROM raw_acs_demographics WHERE geography_level = 'state'
        UNION ALL
        SELECT 'median_hh_income', MIN(median_hh_income), MAX(median_hh_income),
            (SELECT name FROM raw_acs_demographics WHERE geography_level='state' AND median_hh_income IS NOT NULL ORDER BY median_hh_income ASC LIMIT 1),
            (SELECT name FROM raw_acs_demographics WHERE geography_level='state' AND median_hh_income IS NOT NULL ORDER BY median_hh_income DESC LIMIT 1)
        FROM raw_acs_demographics WHERE geography_level = 'state'
    """).fetchall()
    for field, mn, mx, mn_name, mx_name in ranges:
        print(f"    {field}: {mn:,.0f} ({mn_name}) → {mx:,.0f} ({mx_name})")

    print("\n  National ranges (county tier — income):")
    county_income = con.execute("""
        SELECT MIN(median_hh_income), MAX(median_hh_income),
            (SELECT name FROM raw_acs_demographics WHERE geography_level='county' AND median_hh_income IS NOT NULL ORDER BY median_hh_income ASC LIMIT 1) AS min_name,
            (SELECT name FROM raw_acs_demographics WHERE geography_level='county' AND median_hh_income IS NOT NULL ORDER BY median_hh_income DESC LIMIT 1) AS max_name
        FROM raw_acs_demographics WHERE geography_level = 'county'
    """).fetchall()
    for mn, mx, mn_name, mx_name in county_income:
        print(f"    median_hh_income: {mn:,.0f} ({mn_name}) → {mx:,.0f} ({mx_name})")

    print("\n  CA county income sample (national context):")
    ca_income = con.execute("""
        SELECT name, median_hh_income,
            PERCENT_RANK() OVER (ORDER BY median_hh_income) * 100 AS national_pct_rank
        FROM raw_acs_demographics
        WHERE geography_level = 'county' AND state_fp = '06' AND median_hh_income IS NOT NULL
        ORDER BY name
        LIMIT 8
    """).fetchall()
    for name, income, pct in ca_income:
        print(f"    {name}: ${income:,.0f} (national pct rank: {pct:.1f}%)")

    print("\n  PEP source verification (Fresno County, CA):")
    fresno_check = con.execute("""
        SELECT name, population, pop_growth_pct
        FROM raw_acs_demographics
        WHERE geography_level = 'county' AND geoid = '06019'
    """).fetchall()
    for name, pop, growth in fresno_check:
        print(f"    {name}: pop={pop:,} (PEP 2024 target=1,024,125), growth={growth}%")

    print("\n  ZCTA unchanged check (Fresno ZIPs, still ACS-sourced):")
    zcta_check = con.execute("""
        SELECT name, population, median_hh_income
        FROM raw_acs_demographics
        WHERE geography_level = 'zcta' AND geoid IN ('93701','93702','93705','93710')
        ORDER BY geoid
    """).fetchall()
    for name, pop, income in zcta_check:
        print(f"    {name}: pop={pop}, income={income}")

    con.close()
    print("\nDone. raw_acs_demographics: state/county Population from PEP 2024; all other fields from ACS 5-Year 2024.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load ACS demographics into MotherDuck HFA_DEV")
    parser.add_argument("--check", action="store_true", help="Report counts only; do not write")
    parser.add_argument("--vintage", type=int, help="Pull only a specific vintage year")
    args = parser.parse_args()

    v_list = [args.vintage, args.vintage - 1] if args.vintage else None
    main(check_only=args.check, vintages=v_list)
