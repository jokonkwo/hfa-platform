# HFA Pipelines

Pipelines are responsible for:
- ingesting external data sources into RAW tables
- running dbt transformations (RAW → SILVER → GOLD) via scheduled workflows
- recording run metadata and raising alerts on failure/freshness breaches

This folder contains **repeatable jobs** (not one-off scripts). One-off operational utilities live in `scripts/`.

---

## Requirements
- Python 3.11+
- Environment variables configured via `.env` (copied from `configs/env/.env.example`)
- DuckDB locally or MotherDuck in production

Install Python dependencies (repo root):

    pip install -r requirements.txt

---

## Configuration

Copy the environment template:

    cp configs/env/.env.example .env

For local dev, the defaults are fine:
- HFA_WAREHOUSE_MODE=local
- HFA_DUCKDB_PATH=./data/local/hfa.duckdb

For MotherDuck:
- HFA_WAREHOUSE_MODE=motherduck
- MOTHERDUCK_DATABASE=...
- MOTHERDUCK_TOKEN=...

---

## Running a Pipeline Locally (v1)

### PurpleAir ingestion (RAW)
This job pulls PurpleAir readings and writes to `raw_purpleair_readings`.

Run from repo root:

    python -m pipelines.ingestion.purpleair.cli load-raw

---

## Pipeline Principles (non-negotiable)

1. **Idempotent by design**
   - Re-running a job should not corrupt tables.
   - Use deterministic keys (sensor_id, ts) and dedupe/merge patterns.

2. **Observable**
   - Every run logs structured JSON.
   - Every run writes to `ops.pipeline_runs`.

3. **Fail fast**
   - Missing credentials or invalid config should stop immediately.

4. **No hidden state**
   - No hardcoded paths.
   - No local-only dependencies.

---

## Scheduling (GitHub Actions)

Scheduled runs will live in:
- `.github/workflows/`

We will add:
- a 10-min ingestion workflow (PurpleAir → RAW)
- a transformation workflow (dbt → SILVER/GOLD)
- Slack alerts on failure

---

## Notes

- Do not put dbt projects here. dbt lives in `warehouse/dbt/`.
- Do not put API code here. API lives in `apps/api/`.
