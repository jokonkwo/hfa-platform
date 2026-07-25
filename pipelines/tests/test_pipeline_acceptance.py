"""
Pipeline acceptance checks against HFA_DEV (MotherDuck).

These tests verify end-to-end correctness of the dbt-transformed tables.
They require a live MotherDuck connection (MOTHERDUCK_TOKEN in .env).

Run from the repo root:
    pytest pipelines/tests/test_pipeline_acceptance.py -v
"""
from __future__ import annotations


def test_silver_row_count_matches_bronze(md_conn) -> None:
    """
    After the as-of panel join, every qualifying bronze reading must produce
    exactly one silver row. No silent drops due to panel date mismatches.

    'Qualifying' means the reading has a non-null pm25_cf1_a, pm25_cf1_b,
    and humidity_a AND at least one panel entry on or before its date for the
    same sensor_index. This excludes sensors that never appeared in the panel.
    """
    row = md_conn.execute("""
        WITH qualifiable_bronze AS (
            SELECT b.ts_utc, b.sensor_index
            FROM bronze_sensor_now_raw_10min b
            WHERE b.pm25_cf1_a IS NOT NULL
              AND b.pm25_cf1_b IS NOT NULL
              AND b.humidity_a IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM bronze_panel_zipmap_daily p
                  WHERE p.sensor_index = b.sensor_index
                    AND p.date <= CAST(b.ts_utc AS DATE)
              )
        )
        SELECT
            (SELECT COUNT(*) FROM qualifiable_bronze)         AS expected,
            (SELECT COUNT(*) FROM silver_sensor_corrected_10min) AS actual
    """).fetchone()

    expected, actual = row
    assert actual == expected, (
        f"silver_sensor_corrected_10min has {actual} rows but expected {expected} "
        f"(qualifiable bronze rows). Check the as-of panel join."
    )


def test_epa_formula_executes_on_temperature_rows(md_conn) -> None:
    """
    At least one row in silver_sensor_corrected_10min must use the EPA/Barkjohn
    formula (temperature_f is not null) and the pm25_corr value must match it
    exactly (within floating-point tolerance).

    If this fails with 'no rows with temperature_f', a live ingestion poll via
    the updated client.py must run first to populate temperature_f in bronze.
    """
    EPA_TOLERANCE = 1e-6

    rows = md_conn.execute("""
        SELECT
            s.pm25_corr,
            0.541 * (b.pm25_cf1_a + b.pm25_cf1_b) / 2.0
                - 0.0618 * b.humidity_a
                + 0.00534 * b.temperature_f
                + 3.634 AS expected_epa
        FROM silver_sensor_corrected_10min s
        JOIN bronze_sensor_now_raw_10min b
            ON  b.sensor_index = s.sensor_index
            AND b.ts_utc = s.ts_utc
        WHERE b.temperature_f IS NOT NULL
        LIMIT 100
    """).fetchall()

    assert len(rows) > 0, (
        "No silver rows have temperature_f populated — a live ingestion poll "
        "via the updated client.py must run before this check can pass."
    )

    mismatches = [
        (actual, expected)
        for actual, expected in rows
        if abs(actual - expected) > EPA_TOLERANCE
    ]
    assert not mismatches, (
        f"{len(mismatches)} rows where pm25_corr does not match EPA formula. "
        f"First mismatch: actual={mismatches[0][0]}, expected={mismatches[0][1]}"
    )


def test_gold_zip_now_no_null_aqi_or_category(md_conn) -> None:
    """gold_zip_now must have zero rows with null aqi or null category."""
    row = md_conn.execute("""
        SELECT
            COUNT(*) AS total_rows,
            SUM(CASE WHEN aqi IS NULL THEN 1 ELSE 0 END) AS null_aqi,
            SUM(CASE WHEN category IS NULL THEN 1 ELSE 0 END) AS null_category
        FROM gold_zip_now
    """).fetchone()

    total, null_aqi, null_category = row
    assert total > 0, "gold_zip_now is empty — dbt run must succeed first"
    assert null_aqi == 0, f"gold_zip_now has {null_aqi} rows with null aqi"
    assert null_category == 0, f"gold_zip_now has {null_category} rows with null category"


def test_gold_zip_now_zips_in_reference_data(md_conn) -> None:
    """
    Every zip in gold_zip_now must exist in bronze_discovery_daily.

    Note: bronze_discovery_daily is used as the ZIP reference because a
    dedicated ZIP boundary table has not yet been loaded into HFA_DEV. This
    check will be upgraded once load_zip_boundaries is run.
    """
    orphan_rows = md_conn.execute("""
        SELECT g.zip
        FROM gold_zip_now g
        LEFT JOIN (
            SELECT DISTINCT zip FROM bronze_discovery_daily
        ) d ON g.zip = d.zip
        WHERE d.zip IS NULL
    """).fetchall()

    assert not orphan_rows, (
        f"ZIPs in gold_zip_now not found in bronze_discovery_daily: "
        f"{[r[0] for r in orphan_rows]}"
    )
