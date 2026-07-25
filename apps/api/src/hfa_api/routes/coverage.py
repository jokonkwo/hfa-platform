from __future__ import annotations

import datetime
from typing import Any

from fastapi import APIRouter, HTTPException

from hfa_api.db.connection import query_df
from hfa_api.logging_setup import get_logger

router = APIRouter()
logger = get_logger(__name__)


def _to_record(df: Any) -> dict:
    records = df.to_dict(orient="records")
    rec = records[0]
    for k, v in rec.items():
        if isinstance(v, (datetime.datetime, datetime.date)):
            rec[k] = v.isoformat()
    return rec


@router.get("/today", summary="Sensor coverage for today")
def get_coverage_today() -> dict:
    df = query_df("SELECT * FROM api_coverage_today LIMIT 1")
    if df.empty:
        raise HTTPException(status_code=404, detail="No coverage data available for today")
    return _to_record(df)
