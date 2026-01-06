from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class PipelineConfig:
    # Runtime
    env: str
    log_level: str

    # Warehouse
    warehouse_mode: str
    duckdb_path: Path
    motherduck_database: str | None
    motherduck_token: str | None

    # PurpleAir
    purpleair_api_key: str | None
    purpleair_read_key: str | None
    purpleair_sensor_ids: list[int] | None
    ingestion_interval_minutes: int

    # Alerts / Ops
    slack_webhook_url: str | None
    data_freshness_breach_minutes: int

    # Data dirs
    external_data_dir: Path


def _parse_sensor_ids(raw: str | None) -> list[int] | None:
    if not raw:
        return None
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if not parts:
        return None
    return [int(p) for p in parts]


def load_config() -> PipelineConfig:
    """
    Load .env from repo root if present, then load config from environment variables.

    This mirrors configs/env/.env.example and is shared by all pipeline jobs.
    """
    # Load .env from repo root if it exists
    load_dotenv()

    env = os.getenv("HFA_ENV", "local")
    log_level = os.getenv("HFA_LOG_LEVEL", "INFO")

    warehouse_mode = os.getenv("HFA_WAREHOUSE_MODE", "local")
    duckdb_path = Path(os.getenv("HFA_DUCKDB_PATH", "./data/local/hfa.duckdb"))

    motherduck_database = os.getenv("MOTHERDUCK_DATABASE")
    motherduck_token = os.getenv("MOTHERDUCK_TOKEN")

    purpleair_api_key = os.getenv("PURPLEAIR_API_KEY")
    purpleair_read_key = os.getenv("PURPLEAIR_READ_KEY")
    purpleair_sensor_ids = _parse_sensor_ids(os.getenv("PURPLEAIR_SENSOR_IDS"))
    ingestion_interval_minutes = int(os.getenv("INGESTION_INTERVAL_MINUTES", "10"))

    slack_webhook_url = os.getenv("SLACK_WEBHOOK_URL")
    data_freshness_breach_minutes = int(os.getenv("DATA_FRESHNESS_BREACH_MINUTES", "30"))

    external_data_dir = Path(os.getenv("HFA_DATA_EXTERNAL_DIR", "./data/external"))

    cfg = PipelineConfig(
        env=env,
        log_level=log_level,
        warehouse_mode=warehouse_mode,
        duckdb_path=duckdb_path,
        motherduck_database=motherduck_database,
        motherduck_token=motherduck_token,
        purpleair_api_key=purpleair_api_key,
        purpleair_read_key=purpleair_read_key,
        purpleair_sensor_ids=purpleair_sensor_ids,
        ingestion_interval_minutes=ingestion_interval_minutes,
        slack_webhook_url=slack_webhook_url,
        data_freshness_breach_minutes=data_freshness_breach_minutes,
        external_data_dir=external_data_dir,
    )

    # Fail-fast safety checks
    if cfg.warehouse_mode == "motherduck":
        if not cfg.motherduck_database:
            raise RuntimeError("MOTHERDUCK_DATABASE must be set when HFA_WAREHOUSE_MODE=motherduck")
        if not cfg.motherduck_token:
            raise RuntimeError("MOTHERDUCK_TOKEN must be set when HFA_WAREHOUSE_MODE=motherduck")

    if not cfg.purpleair_api_key:
        # Ingestion jobs require this; keep config loader strict.
        # If you run non-PurpleAir jobs later, we can relax this per job.
        pass

    return cfg
