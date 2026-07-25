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
| Map geometry | PMTiles, generated via Tippecanoe | Static file, hosted on Cloudflare R2, read directly by MapLibre. Not yet implemented. |
| Web | Next.js + MapLibre GL JS | Not yet implemented — `apps/web` doesn't exist. |
| Mobile | Expo + React Native | Not yet implemented — `apps/mobile` doesn't exist. |
| Scheduling | GitHub Actions — **known unresolved issue** | `on.schedule` is documented by GitHub as best-effort with 5-30+ min delays. Still needs either an external trigger (`workflow_dispatch` via a free scheduler) or a loosened freshness SLA. Do not assume this is fixed. |
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
| `silver_zip_hourly` | **0 rows** | Schema exists; rollup job was never run |
| `silver_zip_daily` | **0 rows** | Schema exists; rollup job was never run |
| `gold_zip_now` | 8 rows | Final "now" table with `category`, `freshness_pct`, `qc_badge` |
| `api_zip_now` | View | Thin wrapper on `gold_zip_now` — defines FastAPI `/zip/now` response shape |
| `api_zip_hourly` | View | Thin wrapper on `silver_zip_hourly` — currently empty |
| `api_zip_daily` | View | Thin wrapper on `silver_zip_daily` — currently empty |
| `api_coverage_today` | View | Aggregates `bronze_discovery_daily` — defines `/coverage/today` response shape |

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

- `apps/web`, `apps/mobile`, `packages/shared`
- Any API route beyond `/health` in `apps/api`
- SQL/Python code for `silver_zip_hourly` and `silver_zip_daily` rollups
- The EPA/Barkjohn correction formula (with temperature)
- External trigger or SLA fix for the GitHub Actions cron reliability issue
- Committed DDL/transforms for the deployed bronze/silver/gold tables

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

## 6. Subagents (start with these two, add more as needed)

- `api-contract-agent` — owns `apps/api/`, keeps endpoints in sync with `docs/data_contract.md` and the `api_*` view shapes in HFA_DEV.
- `qa-review-agent` — read-only, reviews diffs against the spec, data contract, and deployed schema before merge.
