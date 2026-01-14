from __future__ import annotations

import os
import time
from datetime import date
from typing import Any

import duckdb
import pandas as pd
import requests

from pipelines.config.loader import load_yaml
from pipelines.common.logging_setup import get_logger
from pipelines.common.http import get_json

logger = get_logger(__name__)


def run_discovery() -> None:
    # ---- env ----
    pa_key = os.getenv("PURPLEAIR_API_KEY")
    md_token = os.getenv("MOTHERDUCK_TOKEN")
    md_db = os.getenv("MOTHERDUCK_DATABASE")

    if not pa_key:
        raise RuntimeError("PURPLEAIR_API_KEY is required")
    if not md_token or not md_db:
        raise RuntimeError("MotherDuck credentials are required")

    # ---- config ----
    cfg = load_yaml("pipelines/config/policy.discovery.yml")
    region = cfg["region"]
    policy = cfg["policy"]
    ingest = cfg["ingest"]

    bbox = region["bbox"]

    # ---- fetch sensors (cheap discovery fields) ----
    params = {
        "fields": ingest["discovery_fields"],
        "nwlng": bbox["nw_lon"],
        "nwlat": bbox["nw_lat"],
        "selng": bbox["se_lon"],
        "selat": bbox["se_lat"],
        "max_age": 0,
    }

    logger.info("Running PurpleAir discovery", extra={"bbox": bbox})

    payload = get_json(
    "https://api.purpleair.com/v1/sensors",
    headers={"X-API-Key": pa_key},
    params=params,
    timeout_s=60.0,
    )

    df = pd.DataFrame(payload["data"], columns=payload["fields"])
    if df.empty:
        logger.warning("No sensors returned from discovery")
        return

    # ---- normalize ----
    for c in ["sensor_index", "latitude", "longitude", "location_type", "last_seen"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    now = int(time.time())
    df["fresh_minutes"] = (now - df["last_seen"]) / 60.0
    df["is_fresh"] = df["fresh_minutes"] <= policy["freshness_minutes"]
    df["is_outdoor"] = df["location_type"] == 0

    if policy["outdoor_only"]:
        df = df[df["is_outdoor"]]

    if df.empty:
        logger.warning("No sensors passed freshness/outdoor filters")
        return

    # ---- connect to MotherDuck ----
    con = duckdb.connect(f"md:{md_db}?motherduck_token={md_token}")
    con.execute("INSTALL spatial; LOAD spatial;")

    # ---- spatial ZIP assignment ----
    con.register("sensors", df)

    enriched = con.execute(
        """
        SELECT
          s.sensor_index,
          s.latitude AS lat,
          s.longitude AS lon,
          s.last_seen,
          s.fresh_minutes,
          s.is_fresh,
          z.zip
        FROM sensors s
        JOIN raw.raw_zip_boundaries z
          ON ST_Contains(z.geometry, ST_Point(s.longitude, s.latitude))
        """
    ).df()

    if enriched.empty:
        logger.warning("No sensors matched to ZCTAs")
        return

    enriched["date"] = date.today()
    enriched["region"] = region["name"]

    # ---- write RAW discovery ----
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS raw.raw_discovery_daily AS
        SELECT * FROM enriched WHERE 1=0;
        """
    )
    con.register("enriched", enriched)
    con.execute("INSERT INTO raw.raw_discovery_daily SELECT * FROM enriched")

    logger.info(
        "Discovery complete",
        extra={
            "sensors": enriched["sensor_index"].nunique(),
            "zips": enriched["zip"].nunique(),
        },
    )

    con.close()


if __name__ == "__main__":
    run_discovery()
