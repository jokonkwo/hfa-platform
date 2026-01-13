from __future__ import annotations

import os
from datetime import date

import duckdb

from pipelines.common.logging_setup import get_logger

logger = get_logger(__name__)


def build_panel() -> None:
    md_token = os.getenv("MOTHERDUCK_TOKEN")
    md_db = os.getenv("MOTHERDUCK_DATABASE")

    if not md_token or not md_db:
        raise RuntimeError("MotherDuck credentials required")

    con = duckdb.connect(f"md:{md_db}?motherduck_token={md_token}")

    today = date.today()

    con.execute(
        """
        CREATE TABLE IF NOT EXISTS silver.discovery_panel_daily (
          date DATE,
          region VARCHAR,
          zip VARCHAR,
          sensor_index BIGINT
        );
        """
    )

    con.execute(
        """
        INSERT INTO silver.discovery_panel_daily
        SELECT
          date,
          region,
          zip,
          sensor_index
        FROM (
          SELECT
            date,
            region,
            zip,
            sensor_index,
            row_number() OVER (
              PARTITION BY zip
              ORDER BY fresh_minutes ASC
            ) AS rn
          FROM raw.raw_discovery_daily
          WHERE date = ?
            AND is_fresh = TRUE
        )
        WHERE rn <= 5;
        """,
        [today],
    )

    logger.info("Discovery panel built", extra={"date": str(today)})
    con.close()


if __name__ == "__main__":
    build_panel()
