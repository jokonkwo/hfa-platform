# HFA Data Contract (v1)

This document is the source of truth for HFA warehouse tables and their guarantees.
All pipelines, dbt models, and API schemas must conform to this contract.

## Guiding Rules

1. **System of record**: MotherDuck (prod) / DuckDB file (local).
2. **Medallion layers**: RAW → SILVER → GOLD.
3. **Immutability**:
   - RAW tables are append-only.
   - SILVER/GOLD are derived and reproducible via dbt.
4. **Serving rule**: API serves from GOLD (and occasionally SILVER metadata), not RAW.
5. **Map performance rule**: geometry is served separately from metrics.

---

## Keys & Definitions

### Geographic Keys
- `county_name`: string (e.g., "Fresno")
- `zip`: string (5-digit ZIP as string, e.g., "93727")  
  ZIP is stored as a string to preserve leading zeros and simplify joins.

### Time Keys
- `ts`: UTC timestamp at native sensor resolution (RAW only)
- `ts_10m`: UTC timestamp floored to 10-minute buckets (SILVER and most GOLD)
- `hour_ts`: UTC timestamp floored to hourly (GOLD hourly)
- `date`: UTC date (GOLD daily)

### AQI Definition (v1)
- AQI is computed from **corrected PM2.5** (PurpleAir) using a standard conversion function.
- AQI category is derived from AQI numeric value.
- **ZIP-level AQI** is computed by averaging across sensors within the ZIP for the relevant time bucket.

---

## Data Sources (v1)

### PurpleAir (primary)
- Sensor readings from public PurpleAir API.
- Cadence: every **10 minutes**.
- Scope: Fresno County default; sensors chosen from the PurpleAir map (targeting up to ~5 sensors per ZIP).

### ZIP Boundaries
- ZIP polygon geometries (GeoJSON / Shapefile).
- Used for spatial mapping and map layer rendering.

### Demographics (optional v1)
- ZIP-level demographic attributes (CSV/API).
- Non-critical for v1 ingestion; may be loaded as a seed/external dataset.

---

## Tables

### 1) RAW Layer (append-only)

#### `raw_purpleair_readings`
**Grain:** (sensor_id, ts)  
**Primary key:** (sensor_id, ts)

Required columns:
- `sensor_id` (int)
- `ts` (timestamp, UTC) — observation timestamp
- `pm2_5` (double) — raw PM2.5
- `temperature_f` (double, nullable)
- `humidity` (double, nullable)
- `pressure` (double, nullable)
- `lat` (double) — sensor latitude at observation time
- `lon` (double) — sensor longitude at observation time
- `source` (string) — e.g., "purpleair"
- `ingested_at` (timestamp, UTC) — ingestion time

Notes:
- RAW keeps “exactly what came in” with minimal parsing.
- RAW may include additional PurpleAir fields over time (schema evolution allowed).
- If a field is missing from the API response, store NULL.

#### `raw_zip_boundaries`
**Grain:** zip  
**Primary key:** zip

Required columns:
- `zip` (string)
- `county_name` (string, nullable)
- `geometry` (geometry or WKT string depending on DuckDB extension strategy)
- `source` (string)
- `ingested_at` (timestamp, UTC)

#### `raw_demographics` (optional v1)
**Grain:** zip  
**Primary key:** zip

Required columns (example):
- `zip` (string)
- `population` (int, nullable)
- `median_income` (int, nullable)
- `source` (string)
- `ingested_at` (timestamp, UTC)

---

### 2) SILVER Layer (cleaned & standardized)

#### `dim_sensors`
**Grain:** sensor_id  
**Primary key:** sensor_id

Required columns:
- `sensor_id` (int)
- `name` (string, nullable)
- `lat` (double)
- `lon` (double)
- `zip` (string) — static mapping
- `county_name` (string, nullable)
- `is_active` (boolean) — updated by ingestion metadata rules
- `first_seen_at` (timestamp, UTC)
- `last_seen_at` (timestamp, UTC)
- `updated_at` (timestamp, UTC)

Notes:
- This is the authoritative sensor registry for v1.
- Sensor → ZIP mapping is computed from sensor coordinates and ZIP polygons and stored here.

#### `silver_sensor_readings_10min`
**Grain:** (sensor_id, ts_10m)  
**Primary key:** (sensor_id, ts_10m)

Required columns:
- `sensor_id` (int)
- `ts_10m` (timestamp, UTC) — floored to 10-min bucket
- `pm2_5_raw` (double)
- `pm2_5_corrected` (double) — v1 corrected PM2.5
- `aqi` (int) — derived from corrected PM2.5
- `aqi_category` (string) — derived from AQI
- `zip` (string) — joined from `dim_sensors`
- `county_name` (string, nullable)
- `updated_at` (timestamp, UTC)

Notes:
- This table standardizes units, applies correction, and attaches geography keys.
- Correction logic lives in dbt macros so it is reproducible.

---

### 3) GOLD Layer (product tables)

#### `gold_zip_now`
**Grain:** zip (latest bucket)  
**Primary key:** zip

Required columns:
- `zip` (string)
- `county_name` (string)
- `ts_10m` (timestamp, UTC) — latest available 10-min bucket for that zip
- `aqi` (int) — ZIP-level AQI at `ts_10m` (average across sensors in zip)
- `aqi_category` (string)
- `sensor_count` (int) — sensors contributing at `ts_10m`
- `updated_at` (timestamp, UTC)

ZIP aggregation rule:
- For each zip at the latest `ts_10m`, compute:
  - `aqi = ROUND(AVG(aqi))` across contributing sensors  
  - `sensor_count = COUNT(DISTINCT sensor_id)`

#### `gold_zip_hourly`
**Grain:** (zip, hour_ts)  
**Primary key:** (zip, hour_ts)

Required columns:
- `zip` (string)
- `county_name` (string)
- `hour_ts` (timestamp, UTC)
- `aqi_avg` (int)
- `aqi_category` (string) — based on `aqi_avg`
- `sensor_count` (int)
- `updated_at` (timestamp, UTC)

Aggregation rule:
- compute hourly averages from `silver_sensor_readings_10min`

#### `gold_zip_daily`
**Grain:** (zip, date)  
**Primary key:** (zip, date)

Required columns:
- `zip` (string)
- `county_name` (string)
- `date` (date, UTC)
- `aqi_avg` (int)
- `aqi_max` (int)
- `sensor_count` (int)
- `updated_at` (timestamp, UTC)

#### `gold_rankings` (v1 minimal)
**Grain:** (window, zip, date) or (window, zip, ts)
(We will define exact schema when implementing rankings.)

---

## Map Geometry Tables (v1)

Goal: serve geometry separately from metrics for performance.

#### `gold_zip_geoms_z7`, `gold_zip_geoms_z9`, `gold_zip_geoms_z11`
**Grain:** zip  
**Primary key:** zip

Required columns:
- `zip` (string)
- `county_name` (string)
- `geometry` (simplified geometry for that zoom)
- `bbox` (string or struct; optional)
- `updated_at` (timestamp, UTC)

Notes:
- These tables may be generated from `raw_zip_boundaries` using simplification.
- API selects the appropriate geometry table based on zoom.

---

## Freshness & Operational Guarantees

### Ingestion cadence
- PurpleAir ingestion scheduled every **10 minutes**.

### Freshness breach (v1)
- If max(ts) in RAW or max(ts_10m) in SILVER lags real time by > **30 minutes**, trigger an alert.

### Run metadata
- Every pipeline run writes a row into `ops.pipeline_runs` with:
  - run_id, job_name, started_at, finished_at, status, error_message (nullable),
  - rows_ingested (nullable), max_observed_ts (nullable)

---

## API Contract Alignment

API reads from:
- `gold_zip_geoms_z*` for geometry layers
- `gold_zip_now`, `gold_zip_hourly`, `gold_zip_daily` for metrics

API endpoints are versioned:
- `/v1/meta/...`
- `/v1/layers/...`
- `/v1/metrics/...`
