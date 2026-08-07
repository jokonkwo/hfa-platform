# CLAUDE.md — Healthy Fresno Air (HFA)

This file is standing context for any Claude Code session working in this repo. Read it before making changes. If something here conflicts with what you find in the code, the code is more current on implementation details — but the *decisions* in this file are the ones that were deliberately made after real investigation, so don't silently reverse them.

**Source of truth, in order:** this file → `docs/deployed_schema_audit.md` → `docs/data_contract.md`.

---

## 1. What this project is

A map-first air quality intelligence platform for Fresno County, in the pattern of Reventure.app applied to air quality. Built by a nonprofit currently running a POC on existing public PurpleAir sensors, with a planned transition to nonprofit-owned sensors post-POC. **Currently in test mode, not production.**

**Primary goal: fastest path to a real, working product to validate with users.** Not a portfolio exercise. v1 scope: Fresno County only. Web (Next.js) + mobile (Expo/React Native), one shared FastAPI backend. Budget: free tiers while in test mode; the nonprofit can commit to paid infra once production is proven.

---

## 2. Stack decisions — and why some were reversed

| Layer | Decision | History |
|---|---|---|
| Database | **DuckDB (local) / MotherDuck (cloud), free/Lite tier** | Was briefly changed to Supabase/PostGIS mid-project over geospatial-maturity concerns, then **reversed** once real investigation showed: (a) the spatial joins (`ST_Contains`/`ST_Point`/`ST_Centroid`) already work correctly in the existing dbt models, (b) the account is free-tier ("Lite") using **Pulse ducklings**, which meter per-query in CU-seconds with no idle/cooldown billing — a good fit for a low-frequency POC workload. **Do not re-propose Postgres/PostGIS without new evidence.** |
| Schema naming | **Flat `bronze/silver/gold/api_*` in the `main` schema** — no dbt schema prefixes | The deployed MotherDuck database (`HFA_DEV`) was built with this naming scheme and ran live Oct–Nov 2025. The repo's `warehouse/dbt/` models use schema-qualified `raw/silver/gold` naming and are misaligned with what actually ran. The target is to port the deployed naming into version control, not rewrite toward `raw/silver/gold`. See `docs/deployed_schema_audit.md` for the full deployed schema. |
| Transforms | **dbt** for warehouse models, but with the deployed flat naming as the target | The deployed pipeline used direct Python writes for the bronze tables (discovery output) and uncommitted SQL for silver/gold. The plan is to express the full transform chain in dbt, using the deployed table names as the target schema. The existing `warehouse/dbt/` models are a starting point but need to be aligned to the deployed naming and extended. |
| Geospatial | DuckDB spatial extension (`ST_Contains`, `ST_Point`, `ST_Centroid`) | Working in `dim_sensors.sql` and `dim_zip_county.sql`. Known long-term limitation: no native spatial index yet — not a binding constraint at Fresno-county scale. |
| Map geometry | **MotherDuck `raw_us_*` tables, queried at request time** | Static `fresno_zip_boundaries.geojson` (18 ZIPs) and `ca_county_boundaries.geojson` (58 counties) were removed 2026-07-30. Census TIGER 2025 shapefiles are now stored in HFA_DEV as `raw_us_states` (56 rows), `raw_us_counties` (3,235 rows), and `raw_us_zctas` (33,791 rows). Boundary endpoints query at request time using DuckDB spatial: counties use `WHERE state_fp = ?` (default '06'); ZIPs use `ST_Within(ST_Centroid(geom), county_geom)` (default Fresno County GEOID '06019', returns 55 ZIPs — all 18 pilot ZIPs plus 37 rural Fresno County ZIPs). Optional query params: `?state=` for counties, `?county=` for ZIPs. Source .zip files are local only (not in repo): `~/Downloads/tl_2025_us_*.zip`. **PMTiles (Tippecanoe → Cloudflare R2 → MapLibre) remains the plan if coverage expands significantly** — the MotherDuck approach is sufficient for California-scale, single-scope queries at low volume. |
| Basemap | **Mapbox Light v11** (`mapbox://styles/mapbox/light-v11`) | Replaced Outdoors v12 (2026-08-06). Network inspection of Reventure.app confirmed their style (`gabriel416/clbt2ugok000514qtaam2tola`) uses the DIN Pro font family — which is the Streets/Light family, not Outdoors. Light v11 is the closest available public Mapbox style. Requires `NEXT_PUBLIC_MAPBOX_TOKEN` env var (stored in `.env`). |
| Web | Next.js + Mapbox GL JS | `apps/web` exists and is running. Map has Mapbox Outdoors v12 basemap, GeoJSON fill layer for ZIP boundaries colored by AQI, county drill-down layer (CA-wide at zoom 5, Fresno-focused at zoom 12 via County/ZIP tier toggle in header), sidebar, filter, detail panel, About panel. |
| Mobile | Expo + React Native | Not yet implemented — `apps/mobile` doesn't exist. |
| Scheduling | **Paused** — pipeline proven, ingestion deliberately off | `on.schedule` removed from both workflows (2026-07-25). cron-job.org is configured and was firing every 10 min, but ingestion is paused while PurpleAir API point budget is confirmed sustainable. Both workflows are `workflow_dispatch`-only; manual runs work via the Actions tab or `gh workflow run`. To resume: re-enable the cron-job.org jobs. See `docs/scheduling.md`. |
| PurpleAir sourcing | Two-phase: small existing public sensor set now, nonprofit-owned sensors post-POC | Free API access applies once sensors are owned. |
| Cost monitoring | Watch MotherDuck CU consumption via `MD_INFORMATION_SCHEMA.QUERY_HISTORY` once running live. `bronze_api_cost_daily` in HFA_DEV estimates ~$0.15/day at 40 sensors × 10min cadence. Monitor spatial join queries (`dim_sensors`, `dim_zip_county`) specifically — MotherDuck notes these cost more on Pulse. |

---

## 3. Data correction — required, not optional

### What the deployed pipeline used (non-EPA)

The deployed `silver_sensor_corrected_10min` table in HFA_DEV was populated with this formula (verified by reverse-engineering against live data — zero residuals across all 20 tested rows):

```
pm25_corr = 0.524 × avg(pm25_cf1_a, pm25_cf1_b) − 0.0862 × humidity_a + 5.75
```

This is a structural variant of the repo's placeholder macro (`pm25_correction.sql`), with slightly adjusted coefficients and the correct improvement of averaging the two raw cf_1 channels instead of using a pre-blended field. **It is not the EPA/Barkjohn formula.** The coefficients do not correspond to any published EPA correction variant.

The deployed bronze table (`bronze_sensor_now_raw_10min`) stores `pm25_cf1_a`, `pm25_cf1_b`, and `humidity_a` but **no `temperature_f` column** — temperature was never persisted, so the deployed correction ran without it.

### What the rebuild must use (EPA/Barkjohn)

The target correction formula (Barkjohn et al., 2021 — same one used on AirNow's Fire and Smoke Map):

```
PM2.5_corrected = 0.541 × avg(pm25_cf1_a, pm25_cf1_b) − 0.0618 × RH + 0.00534 × T + 3.634
```

**This requires adding `temperature_f` to the bronze table.** `client.py` already fetches temperature from PurpleAir — it was never persisted in the deployed version. The rebuild must:

1. Add `temperature_f DOUBLE` to `bronze_sensor_now_raw_10min` (update `load_raw.py`'s `ensure_raw_tables`)
2. Persist `temperature_f` in each ingestion poll (update `client.py` field mapping)
3. Rewrite `pm25_correction.sql` against the EPA formula, referencing `pm25_cf1_a`, `pm25_cf1_b`, `humidity_a`, and `temperature_f`
4. Never surface raw, uncorrected PurpleAir PM2.5 in any API response or UI

The deployed formula may be used as a temporary fallback while `temperature_f` data accumulates, but the EPA formula is the stated target.

---

## 4. Honest current-state inventory (update this section as things change — do not let it go stale)

### MotherDuck database environments

| Database | Status | Purpose |
|---|---|---|
| **HFA_DEV** | Active — all v1 development targets this | Contains Oct–Nov 2025 deployed data (160 bronze rows, silver/gold tables, api_* views). This is the real dev database. |
| **HFA_PROD** | Empty placeholder, not yet used | Created 2026-07-24 as future production target. Nothing writes to it. Don't touch it until the POC is validated. |
| **HFAP_DEV** | Abandoned — never set up | Was briefly named as a placeholder target but has no working token and is empty. All references to HFAP_DEV in prior docs/plans are obsolete. |

**Named snapshots are not available on the MotherDuck Lite plan** (Business plan required). The `CREATE SNAPSHOT pre_dbt_rebuild OF HFA_DEV` command was attempted and failed. The bronze source data in HFA_DEV is the rollback point — silver/gold can be regenerated from it via dbt.

**`.env` / `profiles.yml` connection:** `MOTHERDUCK_TOKEN` is stored with the `mdt_` prefix as shown in the MotherDuck UI. `profiles.yml` strips the prefix automatically via `[4:]` slice on the token value. Local Python scripts that connect directly must strip it themselves (see `pipelines/common/db.py`).

### Deployed and working in HFA_DEV (MotherDuck) — but not committed to git

A full pipeline ran Oct 8 – Nov 18 2025 against live PurpleAir data using the flat bronze/silver/gold/api_* naming scheme. The code that built these tables was **never committed**. See `docs/deployed_schema_audit.md` for schemas, row counts, view definitions, and sample data.

**Deployed tables/views (HFA_DEV `main` schema):**

| Object | Status | Notes |
|---|---|---|
| `bronze_sensor_now_raw_10min` | 160 rows | Has `pm25_cf1_a`, `pm25_cf1_b`, `humidity_a`; missing `temperature_f` |
| `bronze_discovery_daily` | 38 rows | Output of `discovery_daily.py` |
| `bronze_panel_zipmap_daily` | 80 rows | Sensor→ZIP panel map, output of `discovery_panel.py` |
| `bronze_panel_show_only_daily` | 80 rows | Sensor-only projection of panel |
| `bronze_api_cost_daily` | 2 rows | Manual cost tracking |
| `silver_sensor_corrected_10min` | 160 rows | Non-EPA corrected PM2.5 + `ab_agree` QC + `fresh_minutes` staleness |
| `silver_zip_now_10min` | 32 rows | ZIP rollup of current conditions |
| `silver_zip_hourly` | **13,405 rows** | Backfilled 2026-07-30 from HFA (cross-DB INSERT); 7 ZIPs, Oct 7 2025 – Jan 21 2026. ZIPs 93705/93710 excluded. |
| `silver_zip_daily` | **602 rows** | Backfilled 2026-07-30 from HFA; 7 ZIPs × 86 days. Jan 21 partial (coverage_hours=4). |
| `gold_zip_now` | 8 rows | Final "now" table with `category`, `freshness_pct`, `qc_badge` |
| `api_zip_now` | View | Thin wrapper on `gold_zip_now` — defines FastAPI `/zip/now` response shape |
| `api_zip_hourly` | View | Thin wrapper on `silver_zip_hourly` — currently empty |
| `api_zip_daily` | View | Thin wrapper on `silver_zip_daily` — currently empty |
| `api_coverage_today` | View | Aggregates `bronze_discovery_daily` — defines `/coverage/today` response shape |

| `raw_us_states` | 56 rows | Census TIGER 2025 US states; columns: `state_fp`, `state_abbr`, `name`, `geoid`, `geom`. Added 2026-07-30. |
| `raw_us_counties` | 3,235 rows | Census TIGER 2025 US counties; columns: `state_fp`, `county_fp`, `geoid`, `name`, `name_lsad`, `geom`. Added 2026-07-30. |
| `raw_us_zctas` | 33,791 rows | Census TIGER 2025 US ZCTAs; columns: `zip5`, `geoid`, `geom`. Added 2026-07-30. ~213 MB stored (compressed). |
| `raw_us_places` | 32,612 rows | Census GENZ 2024 US places (cities/CDPs); columns: `place_geoid`, `name`, `name_lsad`, `state_fp`, `lsad`, `centroid_lon`, `centroid_lat`, `county_geoid`. No geometry stored (centroid + county pre-computed). Added 2026-07-30. |
| `raw_acs_demographics` | 5,076 rows | Mixed-source demographics for vintage 2024: 52 states/territories + 3,222 US counties (national) + 1,802 CA ZCTAs (ZIP prefixes 900–961). **Population and pop_growth sourcing is tier-specific:** state/county Population comes from Census PEP Vintage 2024 (`co-est2024-alldata.csv`, July 1 2024 annual estimates); ZCTA Population comes from ACS 5-Year 2024 (`DP05_0001E`) because PEP does not publish ZCTA-level estimates. All other fields (income, poverty, education, unemployment, linguistic isolation, housing cost burden, income growth, median age) are ACS 5-Year 2024 for all tiers. Re-runnable annual refresh. Last run 2026-08-06. |

**No `gold_rankings` equivalent** exists in the deployed database. The repo's `gold_rankings.sql` dbt model has no deployed counterpart.

### Committed to git — aligned with deployed

- `pipelines/ingestion/purpleair/client.py`, `load_raw.py`, `sensors_registry.py` — raw ingestion; currently captures blended `pm2_5`, needs update to capture `pm25_cf1_a`, `pm25_cf1_b`, `temperature_f` to match deployed + enable EPA formula
- `pipelines/ingestion/purpleair/discovery_daily.py`, `discovery_panel.py`, `pipelines/config/policy.discovery.yml` — discovery system; output matches deployed `bronze_discovery_daily` / `bronze_panel_*` tables. **These scripts hardcode their own MotherDuck DSN** instead of using `pipelines/common/db.py` — worth reconciling.
- `pipelines/ingestion/geo/` — ZIP and county boundary loaders

### Committed to git — misaligned with deployed (need reconciliation)

- `warehouse/dbt/models/` — uses `raw/silver/gold` schema-qualified naming instead of deployed flat `bronze/silver/gold` naming. Models need to be renamed and extended to match the deployed schema.
- `warehouse/dbt/macros/pm25_correction.sql` — placeholder formula, not the EPA formula, and references blended `pm2_5` instead of cf_1 channels
- `warehouse/dbt/models/silver/silver_sensor_readings_10min.sql` — missing `ab_agree` and `fresh_minutes` fields present in deployed `silver_sensor_corrected_10min`
- `warehouse/dbt/models/gold/gold_zip_now.sql` — missing `category`, `freshness_pct`, `qc_badge`, timezone-aware `updated_ts`

### Doesn't exist yet (in git or deployed)

- `apps/mobile`, `packages/shared`
- SQL/Python code for `silver_zip_hourly` and `silver_zip_daily` rollups (backfill was a one-time cross-DB INSERT — not a committed dbt model yet)
- The EPA/Barkjohn correction formula (with temperature)
- cron-job.org re-enable (ingestion paused — see §2 Scheduling row and `docs/scheduling.md`)
- Committed DDL/transforms for the deployed bronze/silver/gold tables
- Playwright tests for the demographics panel and 5-bin color legend (UI-only, no test coverage yet)

### Open question on the discovery → ingestion handoff

`discovery_panel.py` builds `bronze_panel_zipmap_daily` (the top-5-freshest-sensors-per-ZIP panel), but no committed code connects that output to `PURPLEAIR_SENSOR_IDS` in `load_raw_purpleair`. In the deployed pipeline this handoff likely existed as uncommitted code. Confirm before assuming it's automatic.

**Known housekeeping item, deferred by choice:** `.env` is currently tracked in git. Decision made to not rotate credentials or untrack it for now — revisit before any collaborator access or public-facing launch.

---

## 5. Working conventions

- **Plan before you edit.** For anything touching more than one file, use Plan Mode: list files, functions, and order of operations before writing code.
- **Don't reintroduce Postgres/PostGIS** without a new, explicit discussion — see §2.
- **The deployed schema in `docs/deployed_schema_audit.md` is the target.** When building new dbt models or pipeline code, match the deployed table names and column names exactly unless there is a deliberate, documented reason to deviate.
- **The `api_*` views in HFA_DEV define the API response shapes.** `apps/api` endpoints must serve these shapes. Do not invent new response schemas — update `docs/data_contract.md` if the shapes need to change.
- **Any schema or API response shape change must update `docs/data_contract.md` in the same change.**
- **Before treating any pipeline component as "working," confirm it's actually been run against live data.** Several pieces are unverified or have empty tables (§4).
- Python: follow existing style in `pipelines/`. dbt: follow existing model structure in `warehouse/dbt/models/`, targeting the deployed flat naming scheme.

---

## 6. Pipeline orchestration — decision not to add one

**Decision:** No dedicated orchestration tool (Dagster, Airflow, Prefect) for the foreseeable POC.

**Why:** There is currently one pipeline (`ingest.yml` / PurpleAir poll), ingestion is paused while API point budget is confirmed, and all runs are manual (`workflow_dispatch`). There is no multi-job coordination need — no fan-out, no inter-job dependencies, no parallel schedules requiring coordination, and no requirement for automated retries or structured failure alerting beyond GitHub Actions' built-in notifications.

Adding an orchestrator now would impose infra overhead (a running scheduler process, another service to maintain, a new mental model for contributors) without solving any current problem. This is the same pattern already established across this project: don't add infrastructure until a real constraint demands it.

**Interim approach:** Backfill and pipeline runs are logged in `docs/benchmark_log.md` with timestamps and row counts. That's sufficient for the POC audit trail.

**Reconsider when:** Ingestion resumes AND multiple recurring jobs with inter-dependencies emerge — e.g., if a gold rollup must wait on silver, and a notification must fire on failure, on a schedule, reliably. That's the threshold where an orchestrator earns its keep.

---

## 7. Raw landing zone — decision not to add one (yet)

**Current state:** The bronze tables (`bronze_sensor_now_raw_10min`, `bronze_discovery_daily`, etc.) serve as the de facto raw/immutable layer. There is no separate pre-bronze landing zone.

**Why not now:** At current scale — single county, small sensor panel, one source system — a separate landing zone adds real operational complexity (two systems, dual permissions, more failure surface) without proportional benefit. The bronze tables are append-only and effectively immutable in practice.

**Reconsider if** the project grows to genuine production scale with any of:
- Multiple source systems with different schemas or ingestion cadences
- Need for multi-engine interoperability (e.g., Spark, Trino, or external consumers reading raw data directly)
- Regulatory or audit requirements for byte-exact raw retention independent of the warehouse
- Real concern about migrating off MotherDuck someday — a landing zone in object storage would decouple raw data from the warehouse vendor

**Middle path worth evaluating first** (before a full separate landing zone): migrate bronze tables specifically to **DuckLake** once it's out of Preview and confirmed available on the Lite plan. DuckLake tables are physically Parquet in object storage under a thin catalog, giving much of a landing zone's durability and interoperability benefit without operating two parallel raw layers. This is a lower-complexity first step than a fully separate raw system.

---

## 8. AQI legend — settled design decision (do not silently revisit)

**Decision:** Keep the 6-category EPA AQI color legend — Good / Moderate / Unhealthy for Sensitive Groups / Unhealthy / Very Unhealthy / Hazardous — with the fixed breakpoints defined in the EPA standard (0–50 / 51–100 / 101–150 / 151–200 / 201–300 / 301+).

**Do not switch to a continuous min/max gradient.** The Reventure.app convention (real-estate relative ranking with a min→max color ramp) is designed for showing relative position, not absolute public-health risk. Air quality is a regulatory domain with established public communication norms — "Good" (green), "Hazardous" (maroon) are exactly what users see on AirNow and expect on any air quality product. A continuous gradient would destroy that recognizable vocabulary.

**Implemented in:**
- `apps/web/lib/aqi.ts` — `AQI_CATEGORIES` array (6 entries, pastel palette), `categoryColor()`, `aqiToCategory()`, `pm25ToAqi()`
- `apps/web/components/Sidebar.tsx` — "AQI Legend" section renders the 6 categories with swatches and ranges
- Map fill colors driven by `categoryColor()` at all three tiers (state, county, ZIP)

**Colors (pastel, chosen for readability on Mapbox Outdoors basemap):**
Good `#8FE3A8` · Moderate `#FCE083` · USG `#F5B375` · Unhealthy `#EF8C8C` · Very Unhealthy `#B994D1` · Hazardous `#8B4B5C`

**Reconsider only if:** The product explicitly pivots away from public-health communication toward real-estate or comparative-ranking use cases.

---

## 9. Demographics color-binning — confirmed approach (do not silently revisit)

**Decision:** Keep the 7-bin uniform quantile approach for all demographic metrics (Population, Median HH Income, etc.) with breakpoints computed nationally from all available rows (3,222 counties, 52 states, 1,802 ZCTAs).

**The tier mismatch vs. Reventure on specific counties (Kings County, Imperial County, Humboldt County, etc.) is understood and is NOT a bug.** Two confirmed explanations:

1. **Different population source:** Prior to 2026-08-06, our Population was ACS 5-Year 2024 while Reventure uses PEP annual estimates — this has since been corrected (state/county Population is now PEP Vintage 2024, matching Reventure's values for Fresno County exactly). The remaining tier mismatches on specific counties are likely explained by #2 below.

2. **Different binning method or bin count:** Our 7-bin uniform quantile assigns equal numbers of counties per bin. Reventure likely uses a different approach — Jenks natural breaks, equal-interval, or a 5-bin quintile scheme — which produces different bin boundaries at absolute value thresholds. This is a visual design choice, not a data accuracy issue.

**Do not switch to Jenks or 5-bin** without a deliberate product decision that the current bin-per-county distribution behavior is a problem. The current breakpoints (for county Population: ~6,675 / 12,737 / 20,642 / 33,584 / 57,901 / 148,002) correctly place each tier at equal county counts nationally.

**Implemented in:** `apps/web/lib/demographics.ts` — `getQuantileBreakpoints()` (6 thresholds at 1/7…6/7 positions), `getBin()` (strict `<` comparison, standard quantile behavior).

---

## 10. Subagents (start with these two, add more as needed)

- `api-contract-agent` — owns `apps/api/`, keeps endpoints in sync with `docs/data_contract.md` and the `api_*` view shapes in HFA_DEV.
- `qa-review-agent` — read-only, reviews diffs against the spec, data contract, and deployed schema before merge.
