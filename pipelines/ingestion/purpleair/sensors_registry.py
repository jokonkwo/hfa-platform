from __future__ import annotations

import json
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
              zip VARCHAR,
              county_name VARCHAR,
              is_active BOOLEAN,
              first_seen_at TIMESTAMP,
              last_seen_at TIMESTAMP,
              updated_at TIMESTAMP
            );
            """
        )
    finally:
        con.close()


def _load_sensor_zip_map(cfg: PipelineConfig) -> dict[int, dict[str, str]]:
    """
    v1 mapping strategy:
    - Provide explicit sensor->zip mapping via env var JSON.

    Env example:
      SENSOR_ZIP_MAP_JSON='{"12345":{"zip":"93727","county_name":"Fresno"}, "67890":{"zip":"93722","county_name":"Fresno"}}'

    Later: replace or augment with geospatial mapping from ZIP polygons.
    """
    raw_map = json.loads(
        (cfg.__dict__.get("sensor_zip_map_json") or "")  # type: ignore[attr-defined]
        if hasattr(cfg, "sensor_zip_map_json")
        else "null"
    )
    if raw_map is None:
        return {}

    out: dict[int, dict[str, str]] = {}
    for k, v in raw_map.items():
        try:
            sid = int(k)
            if isinstance(v, dict) and "zip" in v:
                out[sid] = {
                    "zip": str(v["zip"]),
                    "county_name": str(v.get("county_name", "")) if v.get("county_name") else "",
                }
        except Exception:
            continue
    return out


def upsert_raw_sensors(
    cfg: PipelineConfig,
    readings: list[PurpleAirReading],
) -> None:
    """
    Maintain raw.raw_sensors based on readings.

    - first_seen_at set on first insert
    - last_seen_at updated on every run where sensor appears
    - is_active set true when seen
    - zip/county populated via explicit mapping if available (v1)
    """
    ensure_raw_sensors_table(cfg)

    # v1: optional explicit mapping from env; if not provided we keep zip null
    sensor_map: dict[int, dict[str, str]] = {}
    try:
        # We haven't added cfg.sensor_zip_map_json to PipelineConfig yet; we will in a later patch.
        # For now, allow absence and proceed.
        raw_json = getattr(cfg, "sensor_zip_map_json", None)
        if raw_json:
            raw_map = json.loads(raw_json)
            for sid_str, v in raw_map.items():
                try:
                    sid = int(sid_str)
                    sensor_map[sid] = {
                        "zip": str(v.get("zip")) if v.get("zip") else None,
                        "county_name": str(v.get("county_name")) if v.get("county_name") else None,
                    }
                except Exception:
                    continue
    except Exception as e:
        logger.warning(f"Failed to parse sensor_zip_map_json: {e}")

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
              zip VARCHAR,
              county_name VARCHAR,
              is_active BOOLEAN,
              first_seen_at TIMESTAMP,
              last_seen_at TIMESTAMP,
              updated_at TIMESTAMP
            );
            """
        )

        incoming_rows: list[tuple[Any, ...]] = []
        for r in readings:
            z = sensor_map.get(r.sensor_id, {})
            incoming_rows.append(
                (
                    r.sensor_id,
                    None,  # name not available from current endpoint fields; keep null for v1
                    r.lat,
                    r.lon,
                    z.get("zip"),
                    z.get("county_name"),
                    True,
                    now.isoformat(),  # will be used only on insert; merge keeps existing first_seen_at
                    now.isoformat(),
                    now.isoformat(),
                )
            )

        con.executemany(
            "INSERT INTO _incoming_sensors VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            incoming_rows,
        )

        # Merge semantics (DuckDB supports MERGE in newer versions; use update+insert fallback for safety)
        # 1) Update existing sensors
        con.execute(
            """
            UPDATE raw.raw_sensors t
            SET
              lat = COALESCE(i.lat, t.lat),
              lon = COALESCE(i.lon, t.lon),
              zip = COALESCE(i.zip, t.zip),
              county_name = COALESCE(i.county_name, t.county_name),
              is_active = TRUE,
              last_seen_at = i.last_seen_at,
              updated_at = i.updated_at
            FROM _incoming_sensors i
            WHERE t.sensor_id = i.sensor_id;
            """
        )

        # 2) Insert new sensors
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
