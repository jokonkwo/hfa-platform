# HFA API (FastAPI)

This service provides a read-only API over curated warehouse tables (Gold, sometimes Silver).
It is intentionally thin: validation, caching (later), and response shaping.

## Requirements
- Python 3.11+
- pip

## Local Setup

### 1) Create a virtual environment
From repo root:

    python -m venv .venv
    source .venv/bin/activate

### 2) Install dependencies
Minimal dependencies for the current API skeleton:

    pip install fastapi uvicorn pydantic duckdb pytest

Note: Later we will pin dependencies properly and add optional packages
(e.g., pandas for dataframe operations, redis for caching, etc.).

### 3) Configure environment variables
Copy the example env file and edit values as needed:

    cp configs/env/.env.example .env

For local development, these defaults are fine:
- HFA_WAREHOUSE_MODE=local
- HFA_DUCKDB_PATH=./data/local/hfa.duckdb

If you switch to MotherDuck, you must set:
- HFA_WAREHOUSE_MODE=motherduck
- MOTHERDUCK_DATABASE=...
- MOTHERDUCK_TOKEN=...

### 4) Run the API
From repo root:

    uvicorn hfa_api.main:app --reload --host 0.0.0.0 --port 8000

### 5) Verify
Health endpoint:

    curl http://localhost:8000/health

Expected response:

    {
      "status": "ok",
      "service": "hfa-api",
      "env": "local",
      "warehouse_mode": "local"
    }

Swagger docs (disabled in prod by default):
- http://localhost:8000/docs

## Tests
From repo root:

    pytest

## Notes
- Logging is configured via configs/logging/logging.json.
- This API should not perform heavy transformations at request time.
  It reads precomputed Gold tables produced by dbt.
