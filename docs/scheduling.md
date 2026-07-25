# Scheduling

## Current status — ingestion paused

Continuous 10-minute ingestion is **deliberately paused** as of 2026-07-25 while
PurpleAir API point budget is confirmed sustainable. The pipeline is proven working
end to end (every step green in CI). No code needs to be rebuilt to resume.

**To resume continuous ingestion:**
1. Re-enable the cron-job.org job for `ingest.yml` (disable → enable toggle in the dashboard).
2. Re-enable the cron-job.org job for `rollup.yml`.
3. Optionally restore `on.schedule` fallback triggers in both workflow files (see the
   commented-out blocks removed 2026-07-25 — they can be copied back verbatim).

---

## Why not GitHub Actions `on.schedule` alone

GitHub's `on.schedule` trigger is best-effort and documented to lag 5–30 minutes (or
more) during high load. It is unsuitable as the sole trigger for a 10-minute freshness
target. The approach: use `on.workflow_dispatch` as the primary trigger, called by
cron-job.org which POSTs to the GitHub API on a precise interval. `on.schedule` can
be kept as a fallback but is not the primary driver.

---

## Workflows

Two workflows exist with different cadences (both currently paused):

| Workflow | File | Cadence | What it does |
|---|---|---|---|
| Ingest PurpleAir | `ingest.yml` | Every 10 minutes | Fetches PurpleAir readings → writes bronze → runs `tag:realtime` dbt models |
| Rollup transforms | `rollup.yml` | Hourly | Runs `tag:hourly` and `tag:daily` dbt models |

Each needs its own cron-job.org entry.

---

## One-time setup (manual, account-level)

### 1. Create a GitHub Personal Access Token (PAT)

In your GitHub account settings:
- Go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
- Create a token scoped to the `jokonkwo/hfa-platform` repository
- Grant **Actions: Read and write** permission
- Store the token securely — you will use it in both scheduler entries below

### 2. Repository secrets required

In **Settings → Secrets and variables → Actions** on `jokonkwo/hfa-platform`:

| Secret name | Value |
|---|---|
| `MOTHERDUCK_TOKEN` | Full token from MotherDuck UI (with or without `mdt_` prefix — both work) |
| `PURPLEAIR_API_KEY` | PurpleAir API key |

`MOTHERDUCK_DATABASE` and `PURPLEAIR_SENSOR_IDS` are plain env vars embedded in the
workflow files, not secrets.

### 3. Configure cron-job.org (two separate entries)

Use [cron-job.org](https://cron-job.org) (free tier supports 1-minute intervals).
cron-job.org setup path: **Dashboard → Create cronjob → Advanced → Headers / Request body**

**Entry 1 — 10-minute ingestion:**

| Field | Value |
|---|---|
| URL | `https://api.github.com/repos/jokonkwo/hfa-platform/actions/workflows/ingest.yml/dispatches` |
| Method | `POST` |
| Interval | Every 10 minutes |
| Header: `Authorization` | `Bearer <your-pat>` |
| Header: `Accept` | `application/vnd.github+json` |
| Header: `X-GitHub-Api-Version` | `2022-11-28` |
| Body (JSON) | `{"ref": "main"}` |

**Entry 2 — hourly rollup:**

| Field | Value |
|---|---|
| URL | `https://api.github.com/repos/jokonkwo/hfa-platform/actions/workflows/rollup.yml/dispatches` |
| Method | `POST` |
| Interval | Every 60 minutes |
| Header: `Authorization` | `Bearer <your-pat>` |
| Header: `Accept` | `application/vnd.github+json` |
| Header: `X-GitHub-Api-Version` | `2022-11-28` |
| Body (JSON) | `{"ref": "main"}` |

### 4. Verify

Trigger each workflow once manually from the GitHub Actions tab
(**Actions → [workflow name] → Run workflow**) to confirm secrets and connectivity before
enabling the external schedulers.

Check `MD_INFORMATION_SCHEMA.QUERY_HISTORY` in MotherDuck to confirm rows are landing
in `bronze_sensor_now_raw_10min` and that dbt models are running at the expected cadence.

---

## Freshness expectations (when running)

**Ingestion + realtime dbt (ingest.yml, every 10 min):**
- Typical end-to-end latency: ~1–3 minutes (scheduler → GitHub runner → PurpleAir API → MotherDuck write → dbt incremental run)
- Worst-case: ~5 minutes if the runner queue is busy
- A reading gap exceeding **20 minutes** indicates a scheduler or pipeline failure

**Rollup dbt (rollup.yml, hourly):**
- Hourly and daily aggregates lag the realtime data by up to ~1 hour by design
- `silver_zip_hourly` and `silver_zip_daily` are full-table rebuilds on each run
