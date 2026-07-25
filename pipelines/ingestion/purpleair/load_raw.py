from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from pipelines.common.config import PipelineConfig
from pipelines.common.db import connect
from pipelines.common.logging_setup import get_logger
from pipelines.ingestion.purpleair.client import PurpleAirClient

logger = get_logger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_bronze_tables(cfg: PipelineConfig) -> None:
    con = connect(cfg)
    try:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS bronze_sensor_now_raw_10min (
                ts_utc        TIMESTAMP,
                sensor_index  BIGINT,
                last_seen     TIMESTAMP,
                pm25_cf1_a    DOUBLE,
                pm25_cf1_b    DOUBLE,
                humidity_a    DOUBLE,
                temperature_f DOUBLE
            );
            """
        )
    finally:
        con.close()


def load_raw_purpleair(cfg: PipelineConfig) -> dict[str, Any]:
    """
    Fetch PurpleAir readings and append to bronze_sensor_now_raw_10min,
    deduplicating on (sensor_index, ts_utc).
    """
    if not cfg.purpleair_api_key:
        raise RuntimeError("PURPLEAIR_API_KEY is required to ingest PurpleAir readings")
    if not cfg.purpleair_sensor_ids:
        raise RuntimeError("PURPLEAIR_SENSOR_IDS must be set (comma-separated integers)")

    ensure_bronze_tables(cfg)

    poll_ts = int(time.time())
    poll_dt = datetime.fromtimestamp(poll_ts, tz=timezone.utc)

    client = PurpleAirClient(api_key=cfg.purpleair_api_key)
    payload = client.fetch_sensors(sensor_ids=cfg.purpleair_sensor_ids)
    readings = client.parse_readings(payload, poll_ts=poll_ts)

    if not readings:
        logger.warning("No PurpleAir readings returned")
        return {"rows_inserted": 0, "max_observed_ts": None}

    rows = [
        (
            poll_dt.isoformat(),
            r.sensor_index,
            datetime.fromtimestamp(r.last_seen, tz=timezone.utc).isoformat(),
            r.pm25_cf1_a,
            r.pm25_cf1_b,
            r.humidity_a,
            r.temperature_f,
        )
        for r in readings
    ]

    con = connect(cfg)
    try:
        con.execute(
            """
            CREATE TEMP TABLE _incoming (
                ts_utc        TIMESTAMP,
                sensor_index  BIGINT,
                last_seen     TIMESTAMP,
                pm25_cf1_a    DOUBLE,
                pm25_cf1_b    DOUBLE,
                humidity_a    DOUBLE,
                temperature_f DOUBLE
            );
            """
        )
        con.executemany("INSERT INTO _incoming VALUES (?, ?, ?, ?, ?, ?, ?);", rows)

        res = con.execute(
            """
            INSERT INTO bronze_sensor_now_raw_10min
            SELECT i.*
            FROM _incoming i
            LEFT JOIN bronze_sensor_now_raw_10min b
                ON b.sensor_index = i.sensor_index AND b.ts_utc = i.ts_utc
            WHERE b.sensor_index IS NULL;
            """
        )

        rows_inserted = con.execute(
            """
            SELECT COUNT(*)
            FROM _incoming i
            LEFT JOIN bronze_sensor_now_raw_10min b
                ON b.sensor_index = i.sensor_index AND b.ts_utc = i.ts_utc
            WHERE b.sensor_index IS NULL;
            """
        ).fetchone()[0]

        logger.info(
            "Loaded PurpleAir bronze",
            extra={"rows_incoming": len(rows), "rows_inserted": int(rows_inserted)},
        )

        return {
            "rows_inserted": int(rows_inserted),
            "max_observed_ts": poll_dt.isoformat(),
        }
    finally:
        try:
            con.close()
        except Exception:
            pass
