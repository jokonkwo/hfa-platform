# Plan: First Vertical Slice (v2 — grounded in actual repo state)

**Supersedes the earlier version of this plan**, which was written against a stale zip and assumed a Postgres migration that has since been reversed (see `CLAUDE.md` §2). This version is grounded in what's actually in the repo as of the current state check.

**Goal:** prove the existing pipeline works end to end with a *correct* AQI value, then expose it through one real API endpoint and one map dot. Given how much is already built, this is less "build from scratch" and more "verify, fix, and connect."

---

## Step 1 — Verify the pipeline has actually run, not just that it looks correct

Before fixing or building anything, establish ground truth:
```
# Confirm raw tables have real data
duckdb <path or md: DSN> -c "SELECT COUNT(*), MAX(ts) FROM raw.raw_purpleair_readings;"
duckdb <path or md: DSN> -c "SELECT COUNT(*) FROM raw.raw_sensors;"

# Confirm the dbt run actually executes without error
cd warehouse/dbt && dbt run

# Confirm gold_zip_now has real rows (this was 0 in the original zip)
duckdb <path or md: DSN> -c "SELECT * FROM gold_zip_now LIMIT 10;"
```
If any of these are empty or error, that's the actual first bug to fix — not a new feature, a broken assumption.

## Step 2 — Fix the correction formula (decided, not yet done)

1. `pipelines/ingestion/purpleair/client.py`: update the PurpleAir API field request to include channel A and B `cf_1` PM2.5 readings, not just the blended `pm2_5` field
2. `pipelines/ingestion/purpleair/load_raw.py` (`ensure_raw_tables`): add the new channel A/B columns to `raw.raw_purpleair_readings`
3. `warehouse/dbt/macros/pm25_correction.sql`: replace the placeholder formula with:
   ```
   PM2.5_corrected = 0.541 × PA_cf1(avg of channel A and B) − 0.0618 × RH + 0.00534 × T + 3.634
   ```
4. `warehouse/dbt/models/silver/silver_sensor_readings_10min.sql`: confirm it references the updated macro correctly (it already calls `purpleair_pm25_correction`, so this should mostly be a macro-body change plus new source columns)
5. Re-run `dbt run`, confirm `silver_sensor_readings_10min.pm2_5_corrected` produces sane values (sanity check: corrected values should generally track below raw PurpleAir values, consistent with published PurpleAir overreporting bias)

## Step 3 — Resolve the discovery → ingestion handoff gap

`discovery_panel.py` builds a table of the 5 freshest sensors per ZIP, but no code was found connecting that output to `PURPLEAIR_SENSOR_IDS` (which drives actual ingestion in `load_raw_purpleair`). Confirm:
- Is this handoff manual today (someone reads the panel and updates the env var by hand)?
- Should it be automated (a script that reads `silver.discovery_panel_daily` and writes `PURPLEAIR_SENSOR_IDS`)?
This needs a decision, not just a fix — it's a real design gap, not a bug.

## Step 4 — Reconcile `discovery_daily.py`/`discovery_panel.py` with the shared connection pattern

Both scripts currently hardcode their own MotherDuck DSN connection (`duckdb.connect(f"md:{md_db}?motherduck_token={md_token}")`) instead of using `pipelines/common/db.py`'s `connect()`. Minor, but worth fixing for consistency and so `CLAUDE.md`'s "one connection pattern" holds true.

## Step 5 — Build the first real API endpoint

- `apps/api`: add `GET /v1/zips/{zip}/now`, querying `gold_zip_now` via `apps/api/src/hfa-api/db/connection.py` (stays DuckDB/MotherDuck, per the reversed decision)
- Response shape must match `docs/data_contract.md` — check before writing the response model

## Step 6 — Minimal map proof

- One static page or minimal MapLibre setup rendering one marker for one real Fresno ZIP, sourced from the new endpoint
- Not the start of `apps/web` — a proof the pipeline is correct end to end

## Step 7 — Address the GitHub Actions cron reliability gap

Independent of everything above (see `CLAUDE.md` §2) — still needs either an external `workflow_dispatch` trigger or a loosened freshness SLA in `docs/data_contract.md`. Don't let this stay silently unresolved once the rest of the slice works.

---

## Order of operations

1 (verify) → 2 (correction formula) → 3 (handoff decision) → 4 (connection consistency, can parallelize with 3) → 5 (API) → 6 (map proof) → 7 (cron, can happen anytime after step 1, doesn't block the rest)

## Definition of done

- `dbt run` succeeds against real data, `gold_zip_now` has non-null rows with a properly EPA-corrected AQI
- Discovery → ingestion handoff is either automated or explicitly documented as manual
- `GET /v1/zips/{zip}/now` returns the contract-defined shape
- One marker renders on a map from real pipeline data
- Cron reliability has an explicit resolution (fixed or knowingly deferred with a stated SLA)
