from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pipelines.common.config import PipelineConfig
from pipelines.common.db import connect
from pipelines.common.logging_setup import get_logger
from pipelines.ingestion.purpleair.client import PurpleAirClient

logger = get_logger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_raw_tables(cfg: PipelineConfig) -> None:
    con = connect(cfg)
    try:
        con.execute("CREATE SCHEMA IF NOT EXISTS raw;")
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS raw.raw_purpleair_readings (
              sensor_id INTEGER,
              ts TIMESTAMP,
              pm2_5 DOUBLE,
              temperature_f DOUBLE,
              humidity DOUBLE,
              pressure DOUBLE,
              lat DOUBLE,
              lon DOUBLE,
              source VARCHAR,
              ingested_at TIMESTAMP
            );
            """
        )

        # Recommended indexes/constraints are limited in DuckDB.
        # We'll enforce uniqueness logically via anti-join inserts for v1.
    finally:
        con.close()


def load_raw_purpleair(cfg: PipelineConfig) -> dict[str, Any]:
    """
    Fetch PurpleAir readings and append to raw.raw_purpleair_readings
    with dedupe by (sensor_id, ts).

    Returns stats:
      - rows_inserted
      - max_observed_ts
    """
    if not cfg.purpleair_api_key:
        raise RuntimeError("PURPLEAIR_API_KEY is required to ingest PurpleAir readings")
    if not cfg.purpleair_sensor_ids:
        raise RuntimeError("PURPLEAIR_SENSOR_IDS must be set (comma-separated integers)")

    ensure_raw_tables(cfg)

    client = PurpleAirClient(api_key=cfg.purpleair_api_key)

    payload = client.fetch_sensors(sensor_ids=cfg.purpleair_sensor_ids)
    readings = client.parse_readings(payload)

    if not readings:
        logger.warning("No PurpleAir readings returned")
        return {"rows_inserted": 0, "max_observed_ts": None}

    # Convert unix seconds -> timestamp string; DuckDB parses ISO.
    rows = []
    max_ts = None
    for r in readings:
        ts_dt = datetime.fromtimestamp(r.ts, tz=timezone.utc)
        if max_ts is None or ts_dt > max_ts:
            max_ts = ts_dt

        rows.append(
            (
                r.sensor_id,
                ts_dt.isoformat(),
                r.pm2_5,
                r.temperature_f,
                r.humidity,
                r.pressure,
                r.lat,
                r.lon,
                "purpleair",
                utc_now().isoformat(),
            )
        )

    con = connect(cfg)
    try:
        # Insert new rows only (anti-join on existing keys)
        # We stage incoming rows in a temp table to do a set-based insert.
        con.execute(
            """
            CREATE TEMP TABLE _incoming_purpleair (
              sensor_id INTEGER,
              ts TIMESTAMP,
              pm2_5 DOUBLE,
              temperature_f DOUBLE,
              humidity DOUBLE,
              pressure DOUBLE,
              lat DOUBLE,
              lon DOUBLE,
              source VARCHAR,
              ingested_at TIMESTAMP
            );
            """
        )
        con.executemany(
            "INSERT INTO _incoming_purpleair VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            rows,
        )

        # Insert only rows not already present
        res = con.execute(
            """
            INSERT INTO raw.raw_purpleair_readings
            SELECT i.*
            FROM _incoming_purpleair i
            LEFT JOIN raw.raw_purpleair_readings r
              ON r.sensor_id = i.sensor_id AND r.ts = i.ts
            WHERE r.sensor_id IS NULL;
            """
        )
        # DuckDB doesn't always return rowcount consistently; we compute it.
        rows_inserted = con.execute(
            """
            SELECT COUNT(*)
            FROM _incoming_purpleair i
            LEFT JOIN raw.raw_purpleair_readings r
              ON r.sensor_id = i.sensor_id AND r.ts = i.ts
            WHERE r.sensor_id IS NULL;
            """
        ).fetchone()[0]

        logger.info(
            "Loaded PurpleAir RAW",
            extra={"rows_incoming": len(rows), "rows_inserted": int(rows_inserted)},
        )

        return {
            "rows_inserted": int(rows_inserted),
            "max_observed_ts": max_ts.isoformat() if max_ts else None,
        }
    finally:
        try:
            con.close()
        except Exception:
            pass
