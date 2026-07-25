from __future__ import annotations

import datetime
from typing import Any

from fastapi import APIRouter, HTTPException

from hfa_api.db.connection import query_df
from hfa_api.logging_setup import get_logger

router = APIRouter()
logger = get_logger(__name__)


def _to_records(df: Any) -> list[dict]:
    records = df.to_dict(orient="records")
    for rec in records:
        for k, v in rec.items():
            if isinstance(v, (datetime.datetime, datetime.date)):
                rec[k] = v.isoformat()
    return records


@router.get("/now", summary="Current conditions for all ZIPs")
def get_all_zips_now() -> list[dict]:
    df = query_df("SELECT * FROM api_zip_now ORDER BY zip")
    return _to_records(df)


@router.get("/{zip_code}/now", summary="Current conditions for one ZIP")
def get_zip_now(zip_code: str) -> dict:
    df = query_df("SELECT * FROM api_zip_now WHERE zip = ?", [zip_code])
    if df.empty:
        raise HTTPException(status_code=404, detail=f"ZIP {zip_code} not found")
    return _to_records(df)[0]


@router.get("/{zip_code}/hourly", summary="Hourly rollup for one ZIP")
def get_zip_hourly(zip_code: str) -> list[dict]:
    df = query_df(
        "SELECT * FROM api_zip_hourly WHERE zip = ? ORDER BY hour_utc DESC",
        [zip_code],
    )
    return _to_records(df)


@router.get("/{zip_code}/daily", summary="Daily rollup for one ZIP")
def get_zip_daily(zip_code: str) -> list[dict]:
    df = query_df(
        "SELECT * FROM api_zip_daily WHERE zip = ? ORDER BY date DESC",
        [zip_code],
    )
    return _to_records(df)
