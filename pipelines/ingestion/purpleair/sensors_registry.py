from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pipelines.common.config import PipelineConfig
from pipelines.common.db import connect
from pipelines.common.logging_setup import get_logger
from pipelines.ingestion.purpleair.client import PurpleAirReading

logger = get_logger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_raw_sensors_table(cfg: PipelineConfig) -> None:
    """
    Pipeline-maintained RAW sensor registry.

    IMPORTANT:
    - Do NOT store zip/county here.
    - zip/county are derived in dbt via spatial join with raw_zip_boundaries.
    """
    con = connect(cfg)
    try:
        con.execute("CREATE SCHEMA IF NOT EXISTS raw;")
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS raw.raw_sensors (
              sensor_id INTEGER,
              name VARCHAR,
              lat DOUBLE,
              lon DOUBLE,
              is_active BOOLEAN,
              first_seen_at TIMESTAMP,
              last_seen_at TIMESTAMP,
              updated_at TIMESTAMP
            );
            """
        )
    finally:
        con.close()


def upsert_raw_sensors(cfg: PipelineConfig, readings: list[PurpleAirReading]) -> None:
    """
    Maintain raw.raw_sensors based on readings.

    Semantics:
    - Insert new sensors on first sighting (first_seen_at = now)
    - Update existing sensors: lat/lon/last_seen_at/updated_at, is_active = TRUE
    - name stays NULL for now (we can enrich later with a different endpoint)
    """
    if not readings:
        return

    ensure_raw_sensors_table(cfg)
    now = utc_now()

    con = connect(cfg)
    try:
        con.execute(
            """
            CREATE TEMP TABLE _incoming_sensors (
              sensor_id INTEGER,
              name VARCHAR,
              lat DOUBLE,
              lon DOUBLE,
              is_active BOOLEAN,
              first_seen_at TIMESTAMP,
              last_seen_at TIMESTAMP,
              updated_at TIMESTAMP
            );
            """
        )

        incoming_rows: list[tuple[Any, ...]] = []
        for r in readings:
            incoming_rows.append(
                (
                    r.sensor_id,
                    None,  # v1: not fetched; keep null
                    r.lat,
                    r.lon,
                    True,
                    now.isoformat(),  # used on insert only
                    now.isoformat(),
                    now.isoformat(),
                )
            )

        con.executemany(
            "INSERT INTO _incoming_sensors VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
            incoming_rows,
        )

        # Update existing
        con.execute(
            """
            UPDATE raw.raw_sensors t
            SET
              lat = COALESCE(i.lat, t.lat),
              lon = COALESCE(i.lon, t.lon),
              is_active = TRUE,
              last_seen_at = i.last_seen_at,
              updated_at = i.updated_at
            FROM _incoming_sensors i
            WHERE t.sensor_id = i.sensor_id;
            """
        )

        # Insert new
        con.execute(
            """
            INSERT INTO raw.raw_sensors
            SELECT i.*
            FROM _incoming_sensors i
            LEFT JOIN raw.raw_sensors t
              ON t.sensor_id = i.sensor_id
            WHERE t.sensor_id IS NULL;
            """
        )

        logger.info("Upserted raw sensors registry", extra={"count": len(incoming_rows)})
    finally:
        con.close()
