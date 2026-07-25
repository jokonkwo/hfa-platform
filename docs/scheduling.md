# Ingestion Scheduling

## Why not GitHub Actions `on.schedule` alone

GitHub's `on.schedule` trigger is best-effort. GitHub documents that scheduled workflows
can be delayed by 5–30 minutes (or more) during high load. This makes it unsuitable as
the sole trigger for a 10-minute ingestion cadence: the worst-case delay exceeds the
target freshness window.

The fix: use `on.workflow_dispatch` as the primary trigger, called by an external
scheduler that hits the GitHub API directly. `on.schedule` stays in the workflow as a
fallback in case the external scheduler is down.

## External scheduler setup (one-time, manual)

This is an account-level setup step outside the repo. It cannot be automated here.

### 1. Create a GitHub Personal Access Token (PAT)

In your GitHub account settings:
- Go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens**
- Create a new token scoped to the `jokonkwo/hfa-platform` repository
- Grant the **Actions: Read and write** permission (this allows triggering `workflow_dispatch`)
- Set an expiry and store the token in a password manager — you will need it in step 3

### 2. Configure the external scheduler

Use [cron-job.org](https://cron-job.org) (free tier supports 1-minute intervals):

| Field | Value |
|---|---|
| URL | `https://api.github.com/repos/jokonkwo/hfa-platform/actions/workflows/ingest.yml/dispatches` |
| Method | `POST` |
| Interval | Every 10 minutes |
| Header: `Authorization` | `Bearer <your-pat>` |
| Header: `Accept` | `application/vnd.github+json` |
| Header: `X-GitHub-Api-Version` | `2022-11-28` |
| Body (JSON) | `{"ref": "main"}` |

cron-job.org setup path: **Dashboard → Create cronjob → Advanced → Headers / Request body**

### 3. Add repository secrets

In the `jokonkwo/hfa-platform` repository settings (**Settings → Secrets and variables → Actions**), add:

| Secret name | Value |
|---|---|
| `MOTHERDUCK_TOKEN` | Full token from MotherDuck UI (the `mdt_...` string) |
| `PURPLEAIR_API_KEY` | PurpleAir API key |
| `PURPLEAIR_SENSOR_IDS` | Comma-separated sensor IDs (same as `PURPLEAIR_SENSOR_IDS` in `.env`) |

`MOTHERDUCK_DATABASE` is set as a plain env var in the workflow (`hfa_dev`) and does not
need to be a secret.

### 4. Verify

After setup, trigger the workflow manually once from the GitHub Actions tab
(**Actions → Ingest PurpleAir → Run workflow**) to confirm secrets and connectivity are
correct before relying on the scheduler.

Check `MD_INFORMATION_SCHEMA.QUERY_HISTORY` in MotherDuck to confirm rows are landing
in `bronze_sensor_now_raw_10min` at the expected cadence.

## Freshness expectations with this setup

With `workflow_dispatch` called every 10 minutes by an external scheduler:
- Typical end-to-end latency: ~1–2 minutes (scheduler fires → GitHub queues → runner
  starts → PurpleAir API call → MotherDuck write)
- Worst-case: ~3–5 minutes if the runner queue is busy
- A reading absent for **>20 minutes** indicates a scheduler or pipeline failure and
  should be investigated

The `on.schedule` fallback fires roughly every 10 minutes but may drift by 5–30 minutes.
It exists only to prevent a complete data gap if the external scheduler goes down.
