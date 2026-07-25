# Deployed Schema Audit — HFA_DEV (MotherDuck)

Audited: 2026-07-24. Read-only. Nothing was modified in MotherDuck.

This document captures the actual schema of the `HFA_DEV` MotherDuck database as it exists today, which was built and run during **Oct 8 – Nov 18 2025** via scripts that were never committed to git. It uses a flat `bronze / silver / gold / api_*` naming scheme (no dbt schema prefixes), which differs from the `raw / silver / gold` schema-qualified naming in the current `warehouse/dbt/` models. The two have never been reconciled.

---

## Summary of what exists

| Object | Type | Row count | Status |
|---|---|---|---|
| `bronze_sensor_now_raw_10min` | Table | 160 | Populated |
| `bronze_discovery_daily` | Table | 38 | Populated |
| `bronze_panel_zipmap_daily` | Table | 80 | Populated |
| `bronze_panel_show_only_daily` | Table | 80 | Populated |
| `bronze_api_cost_daily` | Table | 2 | Populated |
| `silver_sensor_corrected_10min` | Table | 160 | Populated |
| `silver_zip_now_10min` | Table | 32 | Populated |
| `silver_zip_hourly` | Table | 0 | **Empty** |
| `silver_zip_daily` | Table | 0 | **Empty** |
| `gold_zip_now` | Table | 8 | Populated |
| `api_zip_now` | View | — | Thin wrapper on `gold_zip_now` |
| `api_zip_hourly` | View | — | Thin wrapper on `silver_zip_hourly` (empty) |
| `api_zip_daily` | View | — | Thin wrapper on `silver_zip_daily` (empty) |
| `api_coverage_today` | View | — | Aggregates `bronze_discovery_daily` |

No `gold_rankings` equivalent exists. The repo's `gold_rankings.sql` dbt model has no counterpart in the deployed database.

---

## Bronze layer (raw ingestion)

### `bronze_sensor_now_raw_10min`
Raw PurpleAir API readings, one row per sensor per poll. The polling cadence is every 10 minutes.

| Column | Type | Notes |
|---|---|---|
| `ts_utc` | TIMESTAMP | Wall-clock time the poll ran |
| `sensor_index` | BIGINT | PurpleAir sensor ID |
| `last_seen` | TIMESTAMP | PurpleAir-reported last transmission time |
| `pm25_cf1_a` | DOUBLE | **Channel A cf_1 PM2.5** — raw, uncorrected |
| `pm25_cf1_b` | DOUBLE | **Channel B cf_1 PM2.5** — raw, uncorrected |
| `humidity_a` | DOUBLE | Relative humidity from channel A sensor |

**Key finding:** `pm25_cf1_a` and `pm25_cf1_b` are present here. CLAUDE.md §3 flags these as missing from the current repo's `load_raw.py` / `raw_purpleair_readings` table — the deployed pipeline already solved this. The current repo's ingestion only captures a blended `pm2_5` field.

**Temperature note:** No `temperature_f` column is stored in the bronze table, even though temperature appears in the current `client.py` and is required for the full EPA correction formula (`0.541 × avg(cf1_a, cf1_b) − 0.0618 × RH + 0.00534 × T + 3.634`). Either temperature was used inline during the silver transform without being persisted, or the deployed correction omitted the temperature term. This should be confirmed before rebuilding the pipeline.

**Sample rows:**
```
ts_utc                      sensor_index  last_seen             pm25_cf1_a  pm25_cf1_b  humidity_a
2025-11-18 16:34:17         473           2025-11-18 16:33:25   2.9         3.0         73
2025-11-18 16:34:17         269336        2025-03-18 22:36:33   993.8       891.6       46
2025-11-18 16:34:17         8892          2025-11-18 16:31:58   6.0         0.0         51
2025-11-18 16:34:17         288472        2025-08-09 19:33:25   0.7         0.8         39
2025-11-18 16:34:17         27111         2025-11-18 16:32:03   11.0        0.0         57
```
Note: sensor 269336 `last_seen` is from March 2025 (stale) — the `fresh_minutes` field in the silver layer identifies this. Sensor 8892 has `pm25_cf1_b = 0`, which `ab_agree` in silver flags as a disagreement.

---

### `bronze_discovery_daily`
One row per ZIP per discovery run. Captures how many PurpleAir sensors exist in each ZIP and whether the ZIP meets the panel threshold (≥ `min_sensors` fresh sensors within `fresh_window_m` minutes).

| Column | Type | Notes |
|---|---|---|
| `date` | DATE | Discovery run date |
| `region` | VARCHAR | Human-readable policy label (e.g. `"Fresno Co / Fresno / fresh≤30m / min2"`) |
| `fresh_window_m` | INTEGER | Freshness threshold in minutes (30) |
| `min_sensors` | INTEGER | Minimum fresh sensors required for qualification (2) |
| `zip` | VARCHAR | ZIP code |
| `town` | VARCHAR | Town name |
| `sensors_total` | INTEGER | Total sensors found in the ZIP's bbox |
| `sensors_fresh` | INTEGER | Sensors reporting within `fresh_window_m` |
| `qualified` | BOOLEAN | Whether ZIP meets the panel threshold |

**Sample rows:**
```
date        region                                    fresh_window_m  min_sensors  zip    town    sensors_total  sensors_fresh  qualified
2025-10-15  Fresno Co / Fresno / fresh≤30m / min2   30              2            93650  Fresno  2              1              false
2025-10-15  Fresno Co / Fresno / fresh≤30m / min2   30              2            93701  Fresno  6              4              true
2025-10-15  Fresno Co / Fresno / fresh≤30m / min2   30              2            93702  Fresno  14             2              true
2025-10-15  Fresno Co / Fresno / fresh≤30m / min2   30              2            93703  Fresno  3              1              false
```

---

### `bronze_panel_zipmap_daily`
The panel of sensors selected for ingestion, with their ZIP assignment. One row per selected sensor per day.

| Column | Type | Notes |
|---|---|---|
| `date` | DATE | |
| `region` | VARCHAR | Policy label |
| `sensor_index` | BIGINT | Selected sensor |
| `zip` | VARCHAR | ZIP this sensor is assigned to |
| `town` | VARCHAR | |

80 rows across the data window. This is the resolved "sensor → ZIP" mapping for each day's panel.

---

### `bronze_panel_show_only_daily`
Sensor IDs selected for the panel without ZIP attribution. 80 rows — appears to be a sensor-only projection of `bronze_panel_zipmap_daily`, possibly used for API request batching.

| Column | Type | Notes |
|---|---|---|
| `date` | DATE | |
| `region` | VARCHAR | |
| `sensor_index` | BIGINT | |

---

### `bronze_api_cost_daily`
Estimated PurpleAir API cost per day. Manual tracking table; 2 rows (Oct 8 and Oct 15, 2025).

| Column | Type | Notes |
|---|---|---|
| `date` | DATE | |
| `region` | VARCHAR | |
| `panel_size` | INTEGER | Number of sensors in panel (40) |
| `cadence_min` | INTEGER | Poll interval in minutes (10) |
| `polls_per_day` | INTEGER | Computed: 144 polls/day |
| `fields_per_row` | INTEGER | PurpleAir API fields requested (4) |
| `points_est` | BIGINT | Estimated API data points/day (23,184) |
| `dollars_est` | DOUBLE | Estimated daily API cost ($0.15) |

---

## Silver layer (corrected / joined readings)

### `silver_sensor_corrected_10min`
Per-sensor EPA-corrected readings, joined to ZIP via the panel's sensor→ZIP map. One row per sensor per poll (mirrors bronze row count: 160).

| Column | Type | Notes |
|---|---|---|
| `ts_utc` | TIMESTAMP | Poll timestamp |
| `sensor_index` | BIGINT | |
| `zip` | VARCHAR | ZIP assigned via panel map |
| `town` | VARCHAR | |
| `pm25_corr` | DOUBLE | **EPA-corrected PM2.5** (formula applied to cf1_a, cf1_b, humidity_a) |
| `ab_agree` | BOOLEAN | `true` when channels A and B are in reasonable agreement; `false` flags suspect readings |
| `fresh_minutes` | DOUBLE | Minutes since `last_seen` at poll time — staleness indicator |

**Sample rows:**
```
ts_utc                  sensor_index  zip    town    pm25_corr  ab_agree  fresh_minutes
2025-11-18 16:34:17     473           93727  Fresno  1.003      true      0.88
2025-11-18 16:34:17     269336        93705  Fresno  495.76     true      352497.7   ← stale sensor, enormous value
2025-11-18 16:34:17     8892          93728  Fresno  2.926      false     2.33       ← ab_agree=false (ch B was 0)
2025-11-18 16:34:17     288472        93702  Fresno  2.781      true      145320.9   ← stale
2025-11-18 16:34:17     27111         93711  Fresno  3.719      false     2.24       ← ab_agree=false
```

**Observations:**
- The correction formula is applied here. Two channels are averaged (or one channel used when `ab_agree=false`) before applying the EPA formula.
- Stale sensors (sensor 269336 last seen ~8 months prior, sensor 288472 ~3 months prior) pass through to this layer with very large `fresh_minutes` — the gold layer filters or weights by freshness.
- `ab_agree=false` does not appear to block a row from appearing; it's a QC flag for downstream use.

---

### `silver_zip_now_10min`
Current-conditions rollup per ZIP, aggregated from `silver_sensor_corrected_10min`. One row per ZIP per poll snapshot. 32 rows (8 ZIPs × 4 snapshots observed).

| Column | Type | Notes |
|---|---|---|
| `ts_utc` | TIMESTAMP | |
| `zip` | VARCHAR | |
| `town` | VARCHAR | |
| `pm25_corr` | DOUBLE | ZIP-level corrected PM2.5 (mean of qualified sensors) |
| `aqi` | INTEGER | AQI derived from `pm25_corr` |
| `sample_size` | INTEGER | Number of sensors contributing (5 per ZIP) |
| `freshness_pct` | DOUBLE | % of panel sensors that reported recently |
| `qc_badge` | VARCHAR | `"good"` / `"warning"` / `"poor"` — data quality signal |

**Sample rows:**
```
ts_utc                zip    town    pm25_corr  aqi  sample_size  freshness_pct  qc_badge
2025-11-18 16:34:17   93701  Fresno  3.3        18   5            60.0           warning
2025-11-18 16:34:17   93702  Fresno  3.9        22   5            40.0           warning
2025-11-18 16:34:17   93705  Fresno  2.7        15   5            40.0           warning
2025-11-18 16:34:17   93711  Fresno  4.2        23   5            100.0          warning
2025-11-18 16:34:17   93720  Fresno  1.9        10   5            100.0          warning
```

All observed badges are `"warning"` — likely because some panel sensors are stale, pulling `freshness_pct` below a threshold that triggers the badge even when most sensors are fresh.

---

### `silver_zip_hourly` — **0 rows**

| Column | Type |
|---|---|
| `hour_utc` | TIMESTAMP |
| `zip` | VARCHAR |
| `town` | VARCHAR |
| `pm25_corr` | DOUBLE |
| `aqi` | INTEGER |
| `sample_size` | INTEGER |
| `coverage_bins` | INTEGER |

Schema exists but no data. The hourly rollup job was either not run or not connected to the pipeline during the Oct–Nov 2025 window.

---

### `silver_zip_daily` — **0 rows**

| Column | Type |
|---|---|
| `date` | DATE |
| `zip` | VARCHAR |
| `town` | VARCHAR |
| `pm25_mean` | DOUBLE |
| `pm25_p95` | DOUBLE |
| `pm25_max` | DOUBLE |
| `aqi_exceed_101` | INTEGER |
| `aqi_exceed_151` | INTEGER |
| `coverage_hours` | INTEGER |

Schema exists but no data. Same situation as `silver_zip_hourly`.

---

## Gold layer

### `gold_zip_now`
Final API-ready "current conditions" table. 8 rows (one per active ZIP). This is the table the `api_zip_now` view reads from.

| Column | Type | Notes |
|---|---|---|
| `updated_ts` | TIMESTAMP WITH TIME ZONE | UTC timestamp of last poll, timezone-aware |
| `zip` | VARCHAR | |
| `town` | VARCHAR | |
| `pm25` | DOUBLE | Corrected PM2.5 |
| `aqi` | BIGINT | |
| `category` | VARCHAR | AQI category text: `"Good"`, `"Moderate"`, etc. |
| `sample_size` | BIGINT | |
| `freshness_pct` | DOUBLE | |
| `qc_badge` | VARCHAR | |

**Sample rows:**
```
updated_ts                    zip    town    pm25  aqi  category  sample_size  freshness_pct  qc_badge
2025-11-19 00:34:17+00        93701  Fresno  3.3   18   Good      5            60.0           warning
2025-11-19 00:34:17+00        93702  Fresno  3.9   22   Good      5            40.0           warning
2025-11-19 00:34:17+00        93705  Fresno  2.7   15   Good      5            40.0           warning
2025-11-19 00:34:17+00        93711  Fresno  4.2   23   Good      5            100.0          warning
2025-11-19 00:34:17+00        93720  Fresno  1.9   10   Good      5            100.0          warning
```

Differences from `silver_zip_now_10min`: adds `category` (AQI text label), renames `pm25_corr` → `pm25`, upgrades `updated_ts` to timezone-aware. Effectively a final rename + enrich step.

**No `gold_rankings` equivalent.** The repo's `gold_rankings.sql` dbt model (ranking ZIPs by worst air quality) has no counterpart in the deployed database.

---

## API layer (views)

All four are thin projections — no logic beyond column selection and aliasing.

### `api_zip_now`
```sql
SELECT zip, town, pm25, aqi, category, sample_size, freshness_pct, qc_badge, updated_ts
FROM gold_zip_now
```
Direct pass-through of `gold_zip_now` with column reordering. This is the shape the FastAPI `/zip/now` endpoint should return.

---

### `api_zip_hourly`
```sql
SELECT hour_utc, zip, town, pm25_corr AS pm25, aqi, sample_size, coverage_bins
FROM silver_zip_hourly
```
Renames `pm25_corr` → `pm25`. Currently returns no rows (silver table is empty).

---

### `api_zip_daily`
```sql
SELECT date, zip, town, pm25_mean, pm25_p95, pm25_max,
       aqi_exceed_101, aqi_exceed_151, coverage_hours
FROM silver_zip_daily
```
Direct pass-through. Currently returns no rows (silver table is empty).

---

### `api_coverage_today`
```sql
WITH latest AS (SELECT MAX(date) AS d FROM bronze_discovery_daily)
SELECT
    d.date,
    SUM(CASE WHEN qualified THEN 1 ELSE 0 END) AS qualified_zips,
    COUNT(DISTINCT zip)                          AS total_zips,
    (SELECT COUNT(*) FROM bronze_panel_show_only_daily AS p
     WHERE p.date = d.date)                      AS panel_size
FROM bronze_discovery_daily AS d, latest
WHERE d.date = latest.d
GROUP BY d.date
```
Returns one row: the most recent discovery date, how many ZIPs qualified, total ZIPs surveyed, and how many sensors are in the active panel.

---

## As-of join decision (2026-07-24)

The deployed `silver_sensor_corrected_10min` was originally built with an exact-date join against `bronze_panel_zipmap_daily`:

```sql
-- original (exact date match)
CAST(reading.ts_utc AS DATE) = panel.date
```

The `bronze_panel_zipmap_daily` table is only updated when `discovery_panel.py` runs. The discovery job is not guaranteed to run every day — during the Oct–Nov 2025 window, it was run on Oct 8 and Oct 15, but not again in November. As a result, Nov 18 bronze readings had no matching panel entry and were silently dropped from silver (160 bronze rows → 80 silver rows).

The git-committed model was changed to an as-of join:

```sql
-- corrected (as-of join: most recent panel on or before reading date, per sensor)
JOIN bronze_panel_zipmap_daily p
    ON  p.sensor_index = r.sensor_index
    AND p.date <= cast(r.ts_utc as date)
QUALIFY row_number() over (
    partition by r.ts_utc, r.sensor_index
    order by p.date desc
) = 1
```

**Why this is correct:** Panel membership (which sensor covers which ZIP) changes slowly — typically only when discovery reruns. Using the most recent panel entry available for a given date is semantically accurate: a sensor's ZIP assignment on Nov 18 is the same as its assignment on Oct 15 unless discovery told us otherwise. The as-of join ensures no readings are dropped due to discovery job gaps.

**What this is NOT:** A data integrity requirement. The panel assignment could theoretically be wrong for sensors that moved ZIPs between discovery runs, but at Fresno-county scale with fixed physical sensor locations, this does not occur in practice.

---

## Gap analysis vs. current git repo

| Deployed (MotherDuck) | Repo equivalent | Delta |
|---|---|---|
| `bronze_sensor_now_raw_10min` | `raw.raw_purpleair_readings` | Deployed has `pm25_cf1_a`, `pm25_cf1_b` instead of blended `pm2_5`. Repo ingestion needs to be updated to match. |
| `silver_sensor_corrected_10min` | `silver.silver_sensor_readings_10min` | Deployed adds `ab_agree` QC flag and `fresh_minutes` staleness field. Repo dbt model lacks both. |
| `silver_zip_now_10min` | No direct equivalent | Repo goes bronze → silver → gold_zip_now in dbt. Deployed has this intermediate ZIP rollup layer. |
| `silver_zip_hourly` / `silver_zip_daily` | `gold_zip_hourly.sql` / `gold_zip_daily.sql` | Naming differs; deployed versions are empty — rollup jobs were never run. |
| `gold_zip_now` | `gold_zip_now.sql` | Deployed adds `category`, `freshness_pct`, `qc_badge`, `updated_ts` (timezone-aware). Repo model is simpler. |
| `api_zip_now` / `api_zip_daily` / `api_zip_hourly` | No equivalent | Repo has no API view layer. These views define the intended FastAPI response shape. |
| `api_coverage_today` | No equivalent | No repo counterpart — new endpoint needed. |
| `bronze_discovery_daily` | Output of `discovery_daily.py` | Code exists in repo but writes directly to MotherDuck without going through dbt. |
| `bronze_panel_*` | Output of `discovery_panel.py` | Same — committed code, but writes directly to MD, not through dbt. |
| `gold_rankings` | `gold_rankings.sql` in dbt | **Not deployed.** No counterpart in MotherDuck. |
| Correction formula | `pm25_correction.sql` (wrong placeholder) | Deployed corrected formula is applied in the silver transform. Temperature field is absent from bronze — unclear if temperature term was used. |

---

## Correction Formula Verification

`silver_sensor_corrected_10min` is a plain table (CREATE TABLE, not a view), so the SELECT that populated it is not stored in MotherDuck metadata. The formula was recovered by reverse-engineering: joining all 20 available bronze/silver rows for the same sensor+timestamp and solving algebraically for coefficients, then verifying all 20 predictions against actual `pm25_corr` values.

### Verified deployed formula

```
pm25_corr = 0.524 × avg(pm25_cf1_a, pm25_cf1_b) − 0.0862 × humidity_a + 5.75
```

All 20 tested rows match to full floating-point precision (residuals < 1e-12). This is not measurement noise — the formula is exact.

### Comparison against candidates

| Formula | Match? | Notes |
|---|---|---|
| **Deployed** `0.524 × avg(A,B) − 0.0862 × RH + 5.75` | **Exact** | Zero residual across all 20 rows |
| **EPA/Barkjohn** `0.541 × avg(A,B) − 0.0618 × RH + 0.00534 × T + 3.634` | No | Different coefficients; temperature term would require T data not present |
| **Repo placeholder** `0.52 × pm2.5 − 0.085 × RH + 5.71` | No | Close but wrong coefficients; also uses blended `pm2_5` instead of channel average |

### Temperature: definitively absent

The deployed formula has **no temperature term**. This can be confirmed three ways:

1. `bronze_sensor_now_raw_10min` has no `temperature_f` column — temperature was never persisted in the bronze layer.
2. The three-coefficient formula above fits all data perfectly — adding a temperature term would require a fourth coefficient and a temperature value, neither of which is needed to explain the observed `pm25_corr` values.
3. Varying sensors have very different humidity values (RH 22–83) and the formula accounts for all of them without temperature.

### Relationship to the repo's placeholder macro

The deployed formula is a **refined version of the repo placeholder**, not the EPA formula:
- Same structural form (linear in PM2.5 + RH + intercept, no temperature)
- Slightly different coefficients: 0.524 vs 0.52 (PM2.5), −0.0862 vs −0.085 (RH), 5.75 vs 5.71 (intercept)
- Key improvement: uses `avg(cf1_a, cf1_b)` instead of a pre-blended `pm2_5` field, which is a correct use of the raw channel data

The coefficients (0.524, −0.0862, 5.75) do not correspond to any published EPA correction variant. They appear to be empirical values chosen for this deployment.

### `ab_agree` does not change the formula

For sensors where `ab_agree = false` (channel B reported 0 or channels diverged significantly), the formula still uses `avg(cf1_a, cf1_b)` — the same as when `ab_agree = true`. The flag is purely informational; it does not trigger fallback to a single-channel value or exclusion.

### What this means for the repo

CLAUDE.md §3 states the repo's `pm25_correction.sql` is a placeholder and needs to be replaced with the EPA/Barkjohn formula. The deployed schema complicates this picture:

- The deployed pipeline ran on the **non-EPA formula** and produced real results.
- The EPA formula (`0.541 × avg(A,B) − 0.0618 × RH + 0.00534 × T + 3.634`) requires temperature, which the deployed bronze schema does not store.
- If the rebuild targets the true EPA formula, `bronze_sensor_now_raw_10min` must add a `temperature_f` column (the current `client.py` already requests this field — it just wasn't persisted in the deployed version).
- If the rebuild retains the deployed formula, it should be documented as a deliberate choice distinct from EPA/Barkjohn, not treated as the "real" formula.
