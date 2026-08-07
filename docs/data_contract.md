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

### `GET /v1/states/boundaries` — US state boundary polygons

Returns a GeoJSON `FeatureCollection` of all 56 US states/territories queried at request time from `HFA_DEV.main.raw_us_states` (Census TIGER 2025). Registered under `apps/api/src/hfa_api/routes/states.py`. Response is `lru_cache`-cached for the process lifetime and pre-warmed at startup.

Each feature has four properties:
- `GEOID` — 2-digit FIPS code (e.g. `"06"` for California)
- `NAME` — full state name (e.g. `"California"`)
- `STUSPS` — 2-letter abbreviation (e.g. `"CA"`)
- `isCalifornia` — boolean (`true` for GEOID `"06"`, `false` for all others)

The frontend uses this for the **state tier** of the drill-down map hierarchy. California is colored by average AQI across pilot ZIPs; all other states are rendered grey (`#cccccc`) as "no sensor data yet."

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "GEOID": "06", "NAME": "California", "STUSPS": "CA", "isCalifornia": true },
      "geometry": { "type": "MultiPolygon", "coordinates": [...] }
    }
  ]
}
```

### `GET /v1/search?q=` — national search for states, counties, cities, and ZIP codes

**Query params:** `?q=` (required, 1–100 chars). No `Cache-Control` — responses include `Cache-Control: no-store`.

Queries `raw_us_states`, `raw_us_counties`, `raw_us_zctas`, and `raw_us_places` in HFA_DEV. Returns up to 10 results. Registered under `apps/api/src/hfa_api/routes/search.py`.

**Result type rules:**
- **States**: abbreviation exact-match (any length) OR name substring (≥3 chars); up to 3 results
- **Counties**: name/full-name substring (≥3 chars only); up to 5 results
- **ZIPs**: prefix match on `zip5` (numeric queries only, any length); up to 5 results
- **Places (cities/towns)**: name substring (≥3 chars, non-numeric only); up to 5 results

**Selection behavior by type:**
- `state` → switches to State tier, zooms to selected state
- `county` → switches to County tier, loads that state's counties, zooms to selected county
- `zip` → flies to centroid at zoom 13
- `place` → switches to ZIP tier, loads that city's containing county ZIPs, flies to city centroid at zoom 11

Each result object:

| Field | Type | Notes |
|---|---|---|
| `type` | `"state" \| "county" \| "zip" \| "place"` | Result category |
| `identifier` | string | State GEOID (`"06"`), county GEOID (`"06019"`), zip5 (`"93701"`), or place GEOID (`"0627000"`) |
| `display_name` | string | `"California"`, `"Fresno County, CA"`, `"93701"`, `"Fresno, CA"` |
| `abbr` | string \| null | State abbreviation (`"CA"`) for states; `null` otherwise |
| `state_fp` | string \| null | 2-digit state FIPS for counties and places; `null` for states and ZIPs |
| `county_geoid` | string \| null | 5-digit county FIPS for places (containing county — drives ZIP boundary fetch); `null` for other types |
| `bbox` | [west, south, east, north] \| null | Bounding box for states and counties; `null` for ZIPs and places |
| `lon` | number | Centroid longitude |
| `lat` | number | Centroid latitude |

```json
[
  {
    "type": "state",
    "identifier": "06",
    "display_name": "California",
    "abbr": "CA",
    "state_fp": null,
    "county_geoid": null,
    "bbox": [-124.4820, 32.5288, -114.1312, 42.0095],
    "lon": -119.4696,
    "lat": 37.1841
  },
  {
    "type": "county",
    "identifier": "06019",
    "display_name": "Fresno County, CA",
    "abbr": null,
    "state_fp": "06",
    "county_geoid": null,
    "bbox": [-120.5260, 35.7817, -118.3544, 37.5778],
    "lon": -119.6490,
    "lat": 36.7378
  },
  {
    "type": "place",
    "identifier": "0627000",
    "display_name": "Fresno, CA",
    "abbr": null,
    "state_fp": "06",
    "county_geoid": "06019",
    "bbox": null,
    "lon": -119.7938,
    "lat": 36.7831
  },
  {
    "type": "zip",
    "identifier": "93701",
    "display_name": "93701",
    "abbr": null,
    "state_fp": null,
    "county_geoid": null,
    "bbox": null,
    "lon": -119.7834,
    "lat": 36.7469
  }
]
```

### `GET /v1/counties/boundaries` — CA county boundary polygons

**Query params:** `?state=06` (default `"06"` = California). Returns all counties for the given 2-digit FIPS state code.

Returns a GeoJSON `FeatureCollection` of county polygons queried at request time from `HFA_DEV.main.raw_us_counties` (Census TIGER 2025, 3,235 US counties). Registered under `apps/api/src/hfa_api/routes/counties.py`.

Each feature has **five** properties:
- `GEOID` — 5-digit FIPS code (e.g. `"06019"` for Fresno County)
- `NAME` — short county name (e.g. `"Fresno"`)
- `NAMELSAD` — full legal name (e.g. `"Fresno County"`)
- `CENTROID_LON` — centroid longitude (number) — used by the Table View to filter counties to those whose centroid is inside the current map viewport
- `CENTROID_LAT` — centroid latitude (number)

The frontend uses this for the **county tier** of the drill-down map hierarchy. Fresno County (`GEOID: "06019"`) is colored by average AQI across pilot ZIPs; all other counties are rendered grey (`#cccccc`) as "no sensor data yet."

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "GEOID": "06019", "NAME": "Fresno", "NAMELSAD": "Fresno County", "CENTROID_LON": -119.649, "CENTROID_LAT": 36.738 },
      "geometry": { "type": "MultiPolygon", "coordinates": [...] }
    }
  ]
}
```

### `GET /v1/zips/boundaries` — ZIP boundary polygons

**Query params:** `?county=06019` (default `"06019"` = Fresno County CA). Returns all ZCTAs whose centroid is within the given county GEOID (`ST_Within(ST_Centroid(geom), county_geom)`).

Returns a GeoJSON `FeatureCollection` queried at request time from `HFA_DEV.main.raw_us_zctas` (Census TIGER 2025, 33,791 US ZCTAs). Default Fresno County scope returns 55 ZIPs (18 pilot ZIPs with sensor data + 37 rural Fresno County ZIPs). Each feature has a single property: `ZCTA5` (5-digit ZIP string). The frontend joins this against `/v1/zips/now` client-side to color each polygon by AQI category.

**Note:** PMTiles (Cloudflare R2 + Tippecanoe) remains the target if coverage expands significantly. The MotherDuck query approach is sufficient for single-state or single-county scope at low request volume.

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

### `GET /v1/zips/cities` — nearest incorporated city per ZIP in a county

**Query params:** `?county=06019` (required, 5-digit county GEOID). Returns a JSON object mapping each ZCTA `zip5` to its nearest incorporated city (LSAD `'25'`). Falls back to any place type if no incorporated cities exist in the county. Registered under `apps/api/src/hfa_api/routes/zips.py`, `lru_cache`-cached for process lifetime.

**Source:** Joins `raw_us_zctas` (centroids) against `raw_us_places` (city centroids) using Euclidean distance on pre-computed centroid columns. Only ZCTAs whose centroid is within the county boundary are included.

**Frontend usage:** Fetched on mount and on `selectedCountyGeoid` change. Used by the **ZIP tier Table View** to populate the `City` column. Response is `Record<string, string>` (zip5 → city name).

```json
{
  "93701": "Fresno",
  "93702": "Fresno",
  "93711": "Fresno",
  "93727": "Clovis",
  "93730": "Clovis"
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
    "population": null,
    "sample_size": 3,
    "freshness_pct": 100.0,
    "qc_badge": "verified",
    "updated_ts": "2025-11-18T22:10:00+00:00"
  }
]
```

Single-ZIP endpoint returns one object (not an array). Returns 404 if ZIP not found.

**`population` field:** Always `null` in the `/v1/zips/now` response — the ZIP-level AQI API does not embed population. Population for ZCTAs is served separately via `GET /v1/demographics/zctas`. Frontend renders `null` as `"—"` in the ZIP Table View population column; the separate ZCTA demographics endpoint feeds the Sidebar "Community Context" section.

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

### `GET /v1/demographics/states` — state-level demographics

Returns a JSON array of all 52 US states/territories. Used by the frontend to compute the **national** color-scale range. No query params. Registered under `apps/api/src/hfa_api/routes/demographics.py`.

**Data source by field:**
- `population`, `pop_growth_pct`, `pop_density_per_sq_mi`: Census PEP Vintage 2024 (July 1, 2024 annual estimates). PR (FP=72) falls back to ACS 5-Year (PEP doesn't publish PR data).
- All other fields: ACS 5-Year Data Profile 2024.

Each object also includes `state_fp` (same as `geoid` for states).

```json
[
  {
    "geoid": "06",
    "name": "California",
    "geography_level": "state",
    "state_fp": "06",
    "population": 39431263,
    "median_hh_income": 99122.0,
    "median_age": 38.2,
    "poverty_rate_pct": 11.5,
    "ed_less_than_hs_pct": 15.2,
    "unemployment_rate_pct": 4.4,
    "limited_english_pct": 17.5,
    "housing_cost_burden_pct": 55.31,
    "pop_density_per_sq_mi": 240,
    "pop_growth_pct": 0.593,
    "income_growth_pct": 5.12
  }
]
```

**National income range (states, 2024 ACS):** $26,297 (PR) → $109,870 (DC).

### `GET /v1/demographics/counties` — county-level demographics

**Query params:** `?state_fp=<fips>` (optional). When omitted, returns all ~3,222 US counties for national color-scale computation. When provided (e.g. `?state_fp=06`), returns only that state's counties.

**Data source by field:**
- `population`, `pop_growth_pct`, `pop_density_per_sq_mi`: Census PEP Vintage 2024 (July 1, 2024 annual estimates) for all 50 states + DC (3,144 counties). Puerto Rico municipalities fall back to ACS 5-Year.
- All other fields: ACS 5-Year Data Profile 2024.

```json
[
  {
    "geoid": "06019",
    "name": "Fresno County",
    "geography_level": "county",
    "population": 1024125,
    "median_hh_income": 74201.0,
    "median_age": 31.8,
    "poverty_rate_pct": 18.3,
    "ed_less_than_hs_pct": 24.7,
    "unemployment_rate_pct": 8.7,
    "limited_english_pct": 17.7,
    "housing_cost_burden_pct": 57.2,
    "pop_density_per_sq_mi": 170,
    "pop_growth_pct": 0.414,
    "income_growth_pct": 5.0
  }
]
```

### `GET /v1/demographics/zctas` — ZCTA-level demographics (batch)

**Query params:** `?geoids=93701,93702,...` (comma-separated ZCTA geoids, max 200). Returns demographics for each requested ZCTA found in `raw_acs_demographics`. Missing geoids are silently omitted.

**Data source:** All fields including `population` are ACS 5-Year 2024. Census PEP does not publish ZCTA-level estimates, so ZIP-tier Population is ~2 years less current than county/state Population.

```json
[
  {
    "geoid": "93701",
    "name": "93701",
    "geography_level": "zcta",
    "population": 9808,
    "median_hh_income": 32768.0,
    "median_age": 33.5,
    "poverty_rate_pct": 38.5,
    "ed_less_than_hs_pct": 47.5,
    "unemployment_rate_pct": 12.9,
    "limited_english_pct": 31.9,
    "housing_cost_burden_pct": 62.82,
    "pop_density_per_sq_mi": 6436.38,
    "pop_growth_pct": -4.387,
    "income_growth_pct": 1.789
  }
]
```

**Frontend usage:**
- State geoid `"06"` → `stateDemographic` state in page.tsx → passed to RegionPanel and StateTable  
- All 58 counties → `countyDemographics` state → passed to RegionPanel (county selection) and CountyTable  
- Current county's ZCTA geoids extracted from ZIP boundary `ZCTA5` feature properties → `zctaDemographics` state → `selectedZipDemographics` memoized for Sidebar "Community Context" section  

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

---

## Demographics Table (annual refresh)

### `raw_acs_demographics`
**Sources:** Mixed — see tier-specific notes below  
**Loaded by:** `pipelines/ingestion/acs/load_acs_demographics.py`  
**Rows:** 5,076 rows for vintage 2024 (52 states/territories, 3,222 counties nationally, 1,802 CA ZCTAs covering ZIP prefix 900–961)  
**Grain:** (vintage, geography_level, geoid)  
**Refresh cadence:** Annual (run manually once per ACS and PEP release cycle). Last run 2026-08-06.

| Column | Type | Source | Notes |
|---|---|---|---|
| `vintage` | INTEGER | — | ACS release year (e.g. 2024) |
| `geography_level` | VARCHAR | — | `"state"`, `"county"`, or `"zcta"` |
| `geoid` | VARCHAR | — | 2-digit state FIPS (`"06"`), 5-digit county FIPS (`"06019"`), or 5-digit ZCTA (`"93701"`) |
| `name` | VARCHAR | — | Human-readable name (e.g. `"California"`, `"Fresno County"`) |
| `state_fp` | VARCHAR | — | 2-digit state FIPS for all levels |
| `population` | BIGINT | **PEP 2024** (state/county); **ACS DP05_0001E** (ZCTA) | PEP = July 1, 2024 annual estimate. ZCTA stays ACS because PEP doesn't publish ZCTA-level estimates. PR/territories fall back to ACS (absent from PEP file). |
| `median_hh_income` | DOUBLE | ACS DP03_0062E | Median household income (USD) |
| `median_age` | DOUBLE | ACS DP05_0018E | Median age |
| `poverty_rate_pct` | DOUBLE | ACS DP03_0128PE | % people below poverty level |
| `ed_less_than_hs_pct` | DOUBLE | ACS DP02_0060PE + DP02_0061PE | % adults with less than HS diploma |
| `unemployment_rate_pct` | DOUBLE | ACS DP03_0009PE | Civilian unemployment rate |
| `limited_english_pct` | DOUBLE | ACS DP02_0115PE | % who speak English less than "very well" |
| `housing_cost_burden_pct` | DOUBLE | Computed from ACS DP04_* | (DP04_0141E + DP04_0142E) / DP04_0136E × 100 — % renters paying 30%+ of income on rent |
| `pop_density_per_sq_mi` | DOUBLE | Computed | Population (see `population` source) ÷ land area from DuckDB spatial JOIN against `raw_us_states`/`raw_us_counties`/`raw_us_zctas` |
| `pop_growth_pct` | DOUBLE | **PEP 2024** (state/county); **ACS 2024 vs 2023** (ZCTA) | `(pop_current − pop_prior) / pop_prior × 100`. State/county: PEP 2024 vs PEP 2023 (point-in-time annual). ZCTA: ACS 5-Year 2024 vs 2023. |
| `income_growth_pct` | DOUBLE | ACS 2024 vs 2023 | `(income_2024 − income_2023) / income_2023 × 100` — 1-year income growth |

**Suppression codes:** Census values -666666666, -999999999, -888888888 are stored as NULL.

**Coverage notes:**
- States: all 52 US states and territories (national — used for color-scale baseline)
- Counties: all 3,222 US counties (national — used for color-scale baseline)
- ZCTAs: CA ZIP prefixes 900–961 only (1,802 rows). All 55 Fresno County ZCTAs included.
- **ZCTA-level PEP:** PEP does not publish ZCTA-level population estimates. This is confirmed by inspecting `pep/charv` geography.json (only covers us/region/state/county/MSA). ZIP-tier Population is therefore always ACS 5-Year and will be ~2 years less current than state/county Population. This is a structural Census data limitation, not a code choice.
- National income range (states): $26,297 (PR) → $109,870 (DC)
- National income range (counties): $16,314 → $181,765

---

## Reference Tables (static — not part of the ETL pipeline)

These tables are loaded once via one-time import scripts in `pipelines/ingestion/geo/` and do not change unless a new Census release is imported.

### `raw_us_places`
**Source:** Census Bureau Cartographic Boundary 2024 (500k scale) — `cb_2024_us_place_500k.zip`  
**Loaded by:** `pipelines/ingestion/geo/load_places.py`  
**Rows:** 32,612 US incorporated places and Census-Designated Places (CDPs)  
**Storage:** ~1.6 MB (metadata only — no polygon geometry stored)

| Column | Type | Notes |
|---|---|---|
| `place_geoid` | VARCHAR | 7-digit FIPS (`state_fp` 2 + `placefp` 5), e.g. `"0627000"` for Fresno, CA |
| `name` | VARCHAR | Place name, e.g. `"Fresno"` |
| `name_lsad` | VARCHAR | Full legal name, e.g. `"Fresno city"` |
| `state_fp` | VARCHAR | 2-digit state FIPS |
| `lsad` | VARCHAR | Legal/statistical area description code (e.g. `"25"` = city) |
| `centroid_lon` | DOUBLE | Precomputed centroid longitude (rounded to 6 decimal places) |
| `centroid_lat` | DOUBLE | Precomputed centroid latitude (rounded to 6 decimal places) |
| `county_geoid` | VARCHAR | 5-digit FIPS of containing county (resolved via `ST_Within` spatial join at import time); NULL for 1 coastal/border place |

**Why no geometry:** Search only needs centroid + county lookup. Storing the polygon for 32,612 places would add ~60–100 MB with no benefit. The `county_geoid` is precomputed at import time via a one-time spatial join against `raw_us_counties` so search queries have zero spatial overhead.

**Used by:** `GET /v1/search?q=` (place result type)

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
