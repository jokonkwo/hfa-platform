# HFA Warehouse (dbt)

This folder contains the dbt project that builds SILVER and GOLD tables from RAW inputs
in DuckDB (local) and MotherDuck (prod).

## Install dbt dependencies

From repo root:

    pip install dbt-duckdb

(We will add dbt-duckdb to requirements.txt once we confirm local runs cleanly.)

## Run dbt locally (DuckDB file)

1) Ensure you have a DuckDB file path configured:

    cp configs/env/.env.example .env

Set / confirm:

- HFA_WAREHOUSE_MODE=local
- HFA_DUCKDB_PATH=./data/local/hfa.duckdb

2) Run dbt using the included profiles.yml

From repo root:

    dbt --version

Then:

    dbt debug --project-dir warehouse/dbt --profiles-dir warehouse/dbt
    dbt compile --project-dir warehouse/dbt --profiles-dir warehouse/dbt

Once models exist:

    dbt run --project-dir warehouse/dbt --profiles-dir warehouse/dbt
    dbt test --project-dir warehouse/dbt --profiles-dir warehouse/dbt

## MotherDuck (optional)

Set:

- HFA_WAREHOUSE_MODE=motherduck
- MOTHERDUCK_DATABASE=<your_db_name>
- MOTHERDUCK_TOKEN=<your_token>

Then run with the MotherDuck target:

    dbt debug --project-dir warehouse/dbt --profiles-dir warehouse/dbt --target motherduck

Notes:
- MotherDuck connectivity is mediated through DuckDB using the "md:<database>" DSN.
- The token should be sourced from MOTHERDUCK_TOKEN in your environment.

If `dbt debug` fails for MotherDuck, we will adjust the profile fields to match the exact
behavior of your installed dbt-duckdb version.
