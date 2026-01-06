from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

import requests

from pipelines.common.db import connect
from pipelines.common.logging_setup import get_logger
from pipelines.common.config import PipelineConfig

logger = get_logger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class PipelineRun:
    run_id: str
    job_name: str
    started_at: datetime
    finished_at: datetime | None
    status: str  # success | failed
    error_message: str | None = None
    rows_ingested: int | None = None
    max_observed_ts: datetime | None = None


def ensure_ops_tables(cfg: PipelineConfig) -> None:
    """
    Create ops schema/tables if they don't exist.
    Keep this minimal and safe.
    """
    con = connect(cfg)
    try:
        con.execute("CREATE SCHEMA IF NOT EXISTS ops;")
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS ops.pipeline_runs (
              run_id VARCHAR,
              job_name VARCHAR,
              started_at TIMESTAMP,
              finished_at TIMESTAMP,
              status VARCHAR,
              error_message VARCHAR,
              rows_ingested BIGINT,
              max_observed_ts TIMESTAMP
            );
            """
        )
    finally:
        con.close()


def record_pipeline_run(cfg: PipelineConfig, run: PipelineRun) -> None:
    """
    Persist run metadata for observability and /health reporting.
    """
    ensure_ops_tables(cfg)

    con = connect(cfg)
    try:
        con.execute(
            """
            INSERT INTO ops.pipeline_runs
            (run_id, job_name, started_at, finished_at, status, error_message, rows_ingested, max_observed_ts)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                run.run_id,
                run.job_name,
                run.started_at,
                run.finished_at,
                run.status,
                run.error_message,
                run.rows_ingested,
                run.max_observed_ts,
            ],
        )
    finally:
        con.close()


def notify_slack(cfg: PipelineConfig, text: str) -> None:
    """
    Best-effort Slack notification using incoming webhook.
    If webhook isn't configured, do nothing.
    """
    if not cfg.slack_webhook_url:
        logger.info("Slack webhook not configured; skipping notification")
        return

    payload = {"text": text}
    try:
        resp = requests.post(cfg.slack_webhook_url, data=json.dumps(payload), timeout=10)
        resp.raise_for_status()
    except Exception as e:
        logger.warning(f"Failed to send Slack notification: {e}")


def run_with_ops(cfg: PipelineConfig, job_name: str, fn: Any) -> Any:
    """
    Wrapper to standardize:
    - run_id
    - started/finished timestamps
    - success/failure recording
    - Slack notification on failure
    """
    run_id = f"{job_name}-{int(time.time())}"
    started = utc_now()
    run = PipelineRun(
        run_id=run_id,
        job_name=job_name,
        started_at=started,
        finished_at=None,
        status="running",
    )

    logger.info("Pipeline run started", extra={"job_name": job_name, "run_id": run_id})

    try:
        result = fn()
        finished = utc_now()
        run.finished_at = finished
        run.status = "success"
        record_pipeline_run(cfg, run)
        logger.info("Pipeline run success", extra={"job_name": job_name, "run_id": run_id})
        return result
    except Exception as e:
        finished = utc_now()
        run.finished_at = finished
        run.status = "failed"
        run.error_message = str(e)
        record_pipeline_run(cfg, run)
        notify_slack(cfg, f":rotating_light: HFA pipeline failed: `{job_name}` run_id=`{run_id}` error=`{e}`")
        logger.exception("Pipeline run failed", extra={"job_name": job_name, "run_id": run_id})
        raise
