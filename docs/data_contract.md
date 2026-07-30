# HFA Data Contract (v1)

This document is the source of truth for HFA warehouse tables and API response shapes.
All pipelines, dbt models, and API endpoints must conform to this contract.

**Source of truth order:** CLAUDE.md → `docs/deployed_schema_audit.md` → this file.
If this file conflicts with `deployed_schema_audit.md`, the audit doc wins on table schemas.

---

## Layers

| Layer | Naming | Materialization | Purpose |
|---|---|---|---|
| Bronze | `bronze_*` | Table (append-only) | Raw ingestion — exactly what arrived from source APIs |
| Silver | `silver_*` | Table | Cleaned, corrected, joined — derived from bronze via dbt |
| Gold | `gold_*` | Table | Product-ready — filtered, categorized, ready for API |
| API views | `api_*` | View | Thin wrappers on gold/silver — define API response shapes |

All objects live in the `main` schema of the `HFA_DEV` database (MotherDuck).

---

## Geographic Keys

- `zip`: string, 5-digit ZIP code stored as a string to preserve leading zeros (e.g., `"93727"`)
- `town`: string, human-readable locality name for the ZIP

## Time Keys

- `ts_utc`: TIMESTAMP, UTC — wall-clock time of the ingestion poll (bronze) or observation
- `last_seen`: TIMESTAMP, UTC — sensor's last reported transmission time
- `hour_utc`: TIMESTAMP, UTC — truncated to hour boundary (silver hourly rollup)
- `date`: DATE, UTC — date boundary (silver daily rollup)
- `updated_ts`: TIMESTAMPTZ — gold/api timestamp with explicit UTC zone

## AQI

AQI is computed from corrected PM2.5 via the US EPA standard breakpoints.
ZIP-level AQI is the AQI of the mean corrected PM2.5 across all contributing sensors.
Category is one of: `Good`, `Moderate`, `Unhealthy for Sensitive Groups`, `Unhealthy`, `Very Unhealthy`, `Hazardous`.

---

## Bronze Tables (append-only)

### `bronze_sensor_now_raw_10min`
**Grain:** (sensor_index, ts_utc) — one row per sensor per ingestion poll  
**Source:** PurpleAir `/v1/sensors` API, polled every 10 minutes

| Column | Type | Notes |
|---|---|---|
| `ts_utc` | TIMESTAMP | Wall-clock time the poll ran |
| `sensor_index` | BIGINT | PurpleAir sensor ID |
| `last_seen` | TIMESTAMP | Sensor's last reported transmission |
| `pm25_cf1_a` | DOUBLE | Raw PM2.5 CF=1, channel A |
| `pm25_cf1_b` | DOUBLE | Raw PM2.5 CF=1, channel B |
| `humidity_a` | DOUBLE | Relative humidity from channel A |
| `temperature_f` | DOUBLE | Temperature in °F (NULL for rows ingested before 2026-07-24) |

### `bronze_discovery_daily`
**Grain:** (sensor_index, date) — daily snapshot of discoverable sensors  
**Source:** `discovery_daily.py`

Columns include `sensor_index`, `date`, `name`, `lat`, `lon`, `zip`, `county_name`, and discovery metadata.

### `bronze_panel_zipmap_daily`
**Grain:** (sensor_index, date) — daily panel of top-freshest sensors per ZIP  
**Source:** `discovery_panel.py`

Columns include `sensor_index`, `date`, `zip`, `town`.

### `bronze_panel_show_only_daily`
**Grain:** (sensor_index, date) — sensor-only projection of the panel  
**Source:** `discovery_panel.py`

---

## Silver Tables

### `silver_sensor_corrected_10min`
**Grain:** (sensor_index, ts_utc)  
**Source:** `bronze_sensor_now_raw_10min` joined to `bronze_panel_zipmap_daily` (as-of join)

| Column | Type | Notes |
|---|---|---|
| `ts_utc` | TIMESTAMP | Poll timestamp |
| `sensor_index` | BIGINT | PurpleAir sensor ID |
| `zip` | VARCHAR | From panel (as-of join: latest panel date ≤ reading date) |
| `town` | VARCHAR | From panel |
| `pm25_corr` | DOUBLE | EPA/Barkjohn corrected PM2.5 (see CLAUDE.md §3) |
| `ab_agree` | BOOLEAN | True if channels A/B agree within 30% of their mean |
| `fresh_minutes` | DOUBLE | Minutes between `last_seen` and `ts_utc` |

**Correction formula:** EPA/Barkjohn when `temperature_f` is not null:
`0.541 × avg(cf1_a, cf1_b) − 0.0618 × RH + 0.00534 × T + 3.634`

Fallback (deployed-era formula, used when `temperature_f` IS NULL):
`0.524 × avg(cf1_a, cf1_b) − 0.0862 × RH + 5.75`

### `silver_zip_now_10min`
**Grain:** (zip, ts_utc) — latest bucket per ZIP  
Aggregates `silver_sensor_corrected_10min` into ZIP-level rollup.

| Column | Type |
|---|---|
| `ts_utc` | TIMESTAMP |
| `zip` | VARCHAR |
| `town` | VARCHAR |
| `pm25_corr` | DOUBLE |
| `aqi` | INTEGER |
| `sample_size` | BIGINT |
| `freshness_pct` | DOUBLE |
| `qc_badge` | VARCHAR |
| `max_last_seen` | TIMESTAMP | MAX(last_seen) across contributing sensors — propagated to gold as updated_ts |

### `silver_zip_hourly`
**Grain:** (zip, hour_utc)

| Column | Type |
|---|---|
| `hour_utc` | TIMESTAMP |
| `zip` | VARCHAR |
| `town` | VARCHAR |
| `pm25_corr` | DOUBLE |
| `aqi` | INTEGER |
| `sample_size` | BIGINT |
| `coverage_bins` | BIGINT |

### `silver_zip_daily`
**Grain:** (zip, date)

| Column | Type |
|---|---|
| `date` | DATE |
| `zip` | VARCHAR |
| `town` | VARCHAR |
| `pm25_mean` | DOUBLE |
| `pm25_p95` | DOUBLE |
| `pm25_max` | DOUBLE |
| `aqi_exceed_101` | BIGINT |
| `aqi_exceed_151` | BIGINT |
| `coverage_hours` | BIGINT |

---

## Gold Tables

### `gold_zip_now`
**Grain:** zip (one row per ZIP, filtered to latest ts_utc)

| Column | Type | Notes |
|---|---|---|
| `zip` | VARCHAR | |
| `town` | VARCHAR | |
| `pm25` | DOUBLE | Renamed from pm25_corr |
| `aqi` | INTEGER | |
| `category` | VARCHAR | AQI category string |
| `sample_size` | BIGINT | |
| `freshness_pct` | DOUBLE | |
| `qc_badge` | VARCHAR | |
| `updated_ts` | TIMESTAMPTZ | MAX(last_seen) AT TIME ZONE 'UTC' — the most recent sensor transmission timestamp across all contributing sensors for this ZIP. Reflects true data age, not poll time. A stale sensor will show its actual last-seen time even if the pipeline polled more recently. |

---

## API Views (response shapes)

These views are the authoritative API contract. Endpoints must serve exactly these shapes.

### `GET /v1/zips/boundaries` — ZIP boundary polygons

Returns a GeoJSON `FeatureCollection` of Fresno County ZCTA polygon geometries sourced from Census TIGER 2025. Served as a static file from `apps/api/data/fresno_zip_boundaries.geojson` (refreshed by re-running the Census TIGER fetch; no MotherDuck dependency). Each feature has a single property: `ZCTA5` (5-digit ZIP string). The frontend joins this against `/v1/zips/now` client-side to color each polygon by AQI category.

**Note:** PMTiles (Cloudflare R2 + Tippecanoe) remains the target if coverage expands beyond Fresno County. Direct GeoJSON is appropriate at this scale (~18 polygons, 275KB).

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "ZCTA5": "93727" },
      "geometry": { "type": "Polygon", "coordinates": [...] }
    }
  ]
}
```

### `api_zip_now` → `GET /v1/zips/now` and `GET /v1/zips/{zip}/now`

```json
[
  {
    "zip": "93727",
    "town": "Fresno",
    "pm25": 8.4,
    "aqi": 35,
    "category": "Good",
    "sample_size": 3,
    "freshness_pct": 100.0,
    "qc_badge": "verified",
    "updated_ts": "2025-11-18T22:10:00+00:00"
  }
]
```

Single-ZIP endpoint returns one object (not an array). Returns 404 if ZIP not found.

### `api_zip_hourly` → `GET /v1/zips/{zip}/hourly`

```json
[
  {
    "hour_utc": "2025-11-18T22:00:00",
    "zip": "93727",
    "town": "Fresno",
    "pm25": 8.4,
    "aqi": 35,
    "sample_size": 3,
    "coverage_bins": 6
  }
]
```

Array ordered by `hour_utc DESC`. May be empty if no hourly data exists for that ZIP.

**Pilot data availability (as of 2026-07-30):** 7 ZIPs have full hourly history: 93701, 93702, 93711, 93720, 93727, 93728, 93730. Data spans Oct 7 2025 – Jan 21 2026 (13,405 rows). ZIPs 93705 (10 days) and 93710 (2 days) are excluded from the backfill — they return no rows. The gap Oct 27 – Nov 17 2025 is real and must render as a visible discontinuity in any chart, never interpolated.

**Backfill source:** `silver_zip_hourly` in HFA_DEV was populated via cross-database INSERT from `HFA.main.silver_sensor_corrected_10min` (the `HFA` database, not HFA_DEV). All app queries continue to target HFA_DEV at runtime.

### `api_zip_daily` → `GET /v1/zips/{zip}/daily`

```json
[
  {
    "date": "2025-11-18",
    "zip": "93727",
    "town": "Fresno",
    "pm25_mean": 8.4,
    "pm25_p95": 14.2,
    "pm25_max": 18.0,
    "aqi_exceed_101": 0,
    "aqi_exceed_151": 0,
    "coverage_hours": 12
  }
]
```

Array ordered by `date DESC`. May be empty if no daily data exists for that ZIP.

**Date field type quirk:** The `date` column in `silver_zip_daily` is typed DATE in DuckDB but arrives in the API response as a TIMESTAMP string (e.g., `"2026-01-21T00:00:00"` instead of `"2026-01-21"`) due to pandas type coercion. Frontend must normalize with `.substring(0, 10)` before display or comparison.

**Pilot data availability (as of 2026-07-30):** Same 7 ZIPs as hourly; 602 daily rows spanning 86 dates. Jan 21 2026 is a partial day (coverage_hours=4, data ends ~05:58 UTC).

**aqi_exceed_* type quirk:** These BIGINT columns arrive as float64 through pandas (values like `0.0`). Not used in the UI.

### `api_coverage_today` → `GET /v1/coverage/today`

```json
{
  "date": "2025-11-18",
  "qualified_zips": 8,
  "total_zips": 12,
  "panel_size": 40
}
```

Single object. Returns 404 if no discovery data available for today.

---

## Freshness & Operational Guarantees

**Ingestion cadence:** PurpleAir readings are ingested every 10 minutes via
`.github/workflows/ingest.yml`, triggered by an external scheduler (cron-job.org)
calling the GitHub `workflow_dispatch` API. See `docs/scheduling.md` for setup.

**Expected freshness:** With `workflow_dispatch` as the primary trigger, typical
end-to-end latency is 1–2 minutes. A reading gap exceeding **20 minutes** indicates
a scheduler or pipeline failure.

**Breach alert threshold:** `DATA_FRESHNESS_BREACH_MINUTES=30` — alert if the newest
reading in `bronze_sensor_now_raw_10min` is older than 30 minutes. This threshold is
intentionally above the 20-minute failure signal to absorb transient delays without
false-positive alerts.

**Fallback:** `on.schedule` (`*/10 * * * *`) remains in the workflow as a backup if the
external scheduler is down. GitHub may delay this trigger by 5–30+ minutes, so it is
not relied on for the freshness target — only for gap prevention.

---

## Rules

1. **Never surface raw, uncorrected PurpleAir PM2.5** in any API response or UI.
2. **Bronze is append-only.** Silver and gold are fully reproducible via `dbt run`.
3. **API shapes must match `api_*` view column names exactly.** Any deviation requires updating this document.
4. **ZIP is always stored as a string**, even when the value is all-numeric.
5. **Geometry is out of scope for v1 API** — served separately via PMTiles on Cloudflare R2.
