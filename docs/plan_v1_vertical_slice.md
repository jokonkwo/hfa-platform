# Plan: First Vertical Slice (v3 — reconciled against deployed schema)

**Supersedes v2**, which planned against the `warehouse/dbt/` models as if they were the current state. The actual ground truth is the `HFA_DEV` MotherDuck database, audited 2026-07-24 in `docs/deployed_schema_audit.md`. That deployed schema (flat `bronze/silver/gold/api_*` naming, built Oct–Nov 2025 from uncommitted scripts) is more complete than the dbt models and is the target to port into version control.

**Goal:** get the existing deployed pipeline fully committed, fix the correction formula to EPA/Barkjohn (adding `temperature_f`), populate the empty rollup tables (`silver_zip_hourly`, `silver_zip_daily`), and wire the `api_*` views to real FastAPI endpoints. The map proof follows from that.

### Database environment clarification (2026-07-24)

All v1 development **directly targets `HFA_DEV`**. There is no separate staging database.

- **HFAP_DEV** — abandoned. Was briefly referenced as a development target but was never set up, has no working token, and is empty. Any prior instruction to "run against HFAP_DEV instead of HFA_DEV" is obsolete.
- **HFA_PROD** — created 2026-07-24 as an empty future-production placeholder. Nothing targets it yet. Do not use it until the POC is validated.
- **Named snapshot (pre_dbt_rebuild) — not created.** MotherDuck named snapshots require the Business plan; the account is on Lite. The bronze source data in HFA_DEV serves as the rollback point — silver/gold can be regenerated from it via `dbt run`.

---

## Step 1 — Confirm HFA_DEV still has live-ish data and the pipeline can run

Before committing anything, confirm the database state is what the audit showed:

```sql
-- Should return 160 rows, last ts_utc in Nov 2025
SELECT COUNT(*), MAX(ts_utc) FROM bronze_sensor_now_raw_10min;

-- Should return 8 rows
SELECT * FROM gold_zip_now ORDER BY aqi DESC;

-- Should return 1 row (coverage summary)
SELECT * FROM api_coverage_today;

-- Confirm these are still 0 — means rollup jobs haven't run yet
SELECT COUNT(*) FROM silver_zip_hourly;
SELECT COUNT(*) FROM silver_zip_daily;
```

If `gold_zip_now` is empty or missing, the pipeline stalled — diagnose before proceeding.

---

## Step 2 — Commit the deployed DDL and transform logic into version control

The bronze/silver/gold/api_* tables and views exist in MotherDuck but have no committed code that creates them. Fix that first, before any new changes, so there is a baseline.

**2a. Write DDL for all deployed tables and views**

Create `warehouse/sql/schema_hfa_dev.sql` (or equivalent location) containing `CREATE TABLE IF NOT EXISTS` + `CREATE OR REPLACE VIEW` statements matching the exact schemas in `docs/deployed_schema_audit.md`. This is a snapshot, not a migration system — its purpose is to make the current deployed state reproducible.

**2b. Commit the transform logic**

The silver and gold transforms (sensor correction, ZIP rollup, gold enrichment) exist as data in MotherDuck tables but their generating SQL was never committed. Write `warehouse/sql/transforms/` scripts (or dbt models — see §2c) that produce:
- `silver_sensor_corrected_10min` from `bronze_sensor_now_raw_10min` + panel map
- `silver_zip_now_10min` from `silver_sensor_corrected_10min`
- `gold_zip_now` from `silver_zip_now_10min`

Use the deployed table names exactly. The deployed correction formula (as a starting point only, pending Step 3) is:
```
pm25_corr = 0.524 × avg(pm25_cf1_a, pm25_cf1_b) − 0.0862 × humidity_a + 5.75
```

**2c. Align dbt models to deployed naming**

The existing `warehouse/dbt/models/` use `raw/silver/gold` schema-qualified names. Rename them to target the flat deployed names (`bronze_sensor_now_raw_10min`, `silver_sensor_corrected_10min`, etc.) and update `dbt_project.yml` accordingly. This is a rename + extend, not a rewrite.

---

## Step 3 — Fix the correction formula (EPA/Barkjohn, with temperature)

The deployed pipeline used a non-EPA formula with no temperature term. The target formula (Barkjohn et al., 2021, used on AirNow's Fire and Smoke Map):

```
PM2.5_corrected = 0.541 × avg(pm25_cf1_a, pm25_cf1_b) − 0.0618 × RH + 0.00534 × T + 3.634
```

This requires three coordinated changes:

**3a. Add `temperature_f` to bronze ingestion**

1. `pipelines/ingestion/purpleair/load_raw.py` (`ensure_raw_tables`): add `temperature_f DOUBLE` column to `bronze_sensor_now_raw_10min`
2. `pipelines/ingestion/purpleair/client.py`: add `temperature` to the PurpleAir API field list and map it to `temperature_f` in the returned record — the API already returns it, it was just never persisted

**3b. Rewrite the correction macro**

`warehouse/dbt/macros/pm25_correction.sql`: replace the current formula with:
```sql
0.541 * (pm25_cf1_a + pm25_cf1_b) / 2.0
  - 0.0618 * humidity_a
  + 0.00534 * temperature_f
  + 3.634
```

**3c. Verify**

After a fresh ingestion poll (which now captures `temperature_f`) and a dbt run:
- Corrected values should be lower than raw PurpleAir values on average — consistent with published PurpleAir overreporting bias
- At typical Fresno conditions (T ~65–90°F, RH ~20–60%), a raw PM2.5 of 10 µg/m³ should correct to roughly 5–8 µg/m³

The deployed formula (Step 2b) may remain as a fallback reference; the EPA formula is what goes into the dbt macro and any production output.

---

## Step 4 — Populate `silver_zip_hourly` and `silver_zip_daily`

Both tables have schema but 0 rows. These rollup jobs were never run during the Oct–Nov 2025 window.

**Target schemas** (from `docs/deployed_schema_audit.md`):

`silver_zip_hourly`: `hour_utc`, `zip`, `town`, `pm25_corr`, `aqi`, `sample_size`, `coverage_bins`

`silver_zip_daily`: `date`, `zip`, `town`, `pm25_mean`, `pm25_p95`, `pm25_max`, `aqi_exceed_101`, `aqi_exceed_151`, `coverage_hours`

Write dbt models (or scheduled SQL jobs) that aggregate `silver_sensor_corrected_10min` into these tables. `coverage_bins` = number of 10-min bins that had at least one valid reading in the hour. `aqi_exceed_101` / `aqi_exceed_151` = count of hours where AQI exceeded those thresholds.

Once populated, `api_zip_hourly` and `api_zip_daily` views become live automatically (they are thin pass-through views already in place).

---

## Step 5 — Resolve the discovery → ingestion handoff

`discovery_panel.py` builds `bronze_panel_zipmap_daily` (top-5-freshest-sensors-per-ZIP), but no committed code connects that to the sensor list used in `load_raw_purpleair`. The deployed pipeline must have had this handoff somewhere — it ran end-to-end, but the connecting code is missing from git.

Confirm: is the handoff manual (someone updates `PURPLEAIR_SENSOR_IDS` by hand after discovery runs), or was there an automated script? Write and commit whichever is correct.

---

## Step 6 — Reconcile the discovery scripts' connection pattern

`discovery_daily.py` and `discovery_panel.py` hardcode their own MotherDuck DSN (`duckdb.connect(f"md:{md_db}?motherduck_token={md_token}")`) instead of using `pipelines/common/db.py`'s `connect()`. Switch them to the shared helper for consistency.

---

## Step 7 — Build the FastAPI endpoints against the `api_*` views

The `api_*` views in HFA_DEV already define the exact response shapes. `apps/api` must serve these shapes — do not invent new ones.

| Endpoint | Source view | Key columns |
|---|---|---|
| `GET /v1/zips/now` | `api_zip_now` | `zip`, `town`, `pm25`, `aqi`, `category`, `sample_size`, `freshness_pct`, `qc_badge`, `updated_ts` |
| `GET /v1/zips/{zip}/now` | `api_zip_now` WHERE zip | Same, filtered |
| `GET /v1/zips/{zip}/hourly` | `api_zip_hourly` | `hour_utc`, `zip`, `town`, `pm25`, `aqi`, `sample_size`, `coverage_bins` |
| `GET /v1/zips/{zip}/daily` | `api_zip_daily` | `date`, `zip`, `town`, `pm25_mean`, `pm25_p95`, `pm25_max`, `aqi_exceed_101`, `aqi_exceed_151`, `coverage_hours` |
| `GET /v1/coverage/today` | `api_coverage_today` | `date`, `qualified_zips`, `total_zips`, `panel_size` |

Any deviation from these column names or types must be reflected in `docs/data_contract.md` before the endpoint is written.

---

## Step 8 — Minimal map proof

One static page or minimal MapLibre setup rendering dots for all ZIPs in `api_zip_now`, colored by AQI category. Sourced from the new `/v1/zips/now` endpoint. This is not the start of `apps/web` — it's proof the pipeline is correct end to end with real data.

---

## Step 9 — Address the GitHub Actions cron reliability gap

Independent of everything above — `on.schedule` is documented as best-effort with 5-30+ min delays. Needs either an external `workflow_dispatch` trigger (e.g., cron-job.org or GitHub's own scheduled `workflow_dispatch`) or a freshness SLA in `docs/data_contract.md` that explicitly accepts the delay. Do not let this stay silently unresolved once the rest of the slice works.

---

## Order of operations

1 (verify deployed state) → 2 (commit DDL + deployed transforms) → 3 (EPA formula + temperature_f) → 4 (hourly/daily rollups) → 5+6 (handoff + connection pattern, can parallelize) → 7 (API endpoints) → 8 (map proof) → 9 (cron, can happen anytime after step 1)

Steps 3 and 4 depend on step 2 being committed first so there's a stable baseline to diff against.

---

## Definition of done

- All deployed HFA_DEV tables/views have committed DDL and generating SQL/dbt models in the repo
- `bronze_sensor_now_raw_10min` has `temperature_f`; ingestion persists it on each poll
- `pm25_correction.sql` implements the EPA/Barkjohn formula; corrected values are sanity-checked against expected ranges
- `silver_zip_hourly` and `silver_zip_daily` have real rows; `api_zip_hourly` and `api_zip_daily` return data
- Discovery → ingestion handoff is committed (automated or explicitly documented as manual)
- `GET /v1/zips/now`, `GET /v1/zips/{zip}/hourly`, `GET /v1/zips/{zip}/daily`, `GET /v1/coverage/today` all return the shapes defined by the `api_*` views
- One map renders real ZIP-level AQI from the live endpoint
- Cron reliability has an explicit resolution (fixed or knowingly deferred with a stated SLA)
