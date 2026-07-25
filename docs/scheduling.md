# Scheduling

## Why not GitHub Actions `on.schedule` alone

GitHub's `on.schedule` trigger is best-effort. GitHub documents that scheduled workflows
can be delayed by 5–30 minutes (or more) during high load. This makes it unsuitable as
the sole trigger for time-sensitive workflows. The fix: use `on.workflow_dispatch` as the
primary trigger, called by an external scheduler that hits the GitHub API directly.
`on.schedule` stays in each workflow as a fallback only.

---

## Workflows

Two scheduled workflows exist with different cadences:

| Workflow | File | Cadence | What it does |
|---|---|---|---|
| Ingest PurpleAir | `ingest.yml` | Every 10 minutes | Fetches PurpleAir readings → writes bronze → runs `tag:realtime` dbt models |
| Rollup transforms | `rollup.yml` | Hourly | Runs `tag:hourly` and `tag:daily` dbt models |

Each needs its own external scheduler entry.

---

## One-time setup (manual, account-level)

### 1. Create a GitHub Personal Access Token (PAT)

In your GitHub account settings:
- Go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
- Create a token scoped to the `jokonkwo/hfa-platform` repository
- Grant **Actions: Read and write** permission
- Store the token securely — you will use it in both scheduler entries below

### 2. Add repository secrets

In **Settings → Secrets and variables → Actions** on `jokonkwo/hfa-platform`:

| Secret name | Value |
|---|---|
| `MOTHERDUCK_TOKEN` | Full token from MotherDuck UI (`mdt_...` string) |
| `PURPLEAIR_API_KEY` | PurpleAir API key |
| `PURPLEAIR_SENSOR_IDS` | Comma-separated sensor IDs (same as `.env`) |

`MOTHERDUCK_DATABASE` is set as a plain env var in both workflows (`hfa_dev`) and is not a secret.

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

## Freshness expectations

**Ingestion + realtime dbt (ingest.yml, every 10 min):**
- Typical end-to-end latency: ~1–3 minutes (scheduler → GitHub runner → PurpleAir API → MotherDuck write → dbt incremental run)
- Worst-case: ~5 minutes if the runner queue is busy
- A reading gap exceeding **20 minutes** indicates a scheduler or pipeline failure

**Rollup dbt (rollup.yml, hourly):**
- Hourly and daily aggregates lag the realtime data by up to ~1 hour by design
- `silver_zip_hourly` and `silver_zip_daily` are full-table rebuilds on each run

The `on.schedule` fallback in both workflows may drift by 5–30 minutes. It exists only
to limit data gaps if the external scheduler is down, not to meet the freshness target.
