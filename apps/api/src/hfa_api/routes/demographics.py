from __future__ import annotations

import logging

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from hfa_api.db.connection import query_rows

router = APIRouter()
logger = logging.getLogger(__name__)

_FIELDS = (
    "geoid", "name", "geography_level",
    "population", "median_hh_income", "median_age",
    "poverty_rate_pct", "ed_less_than_hs_pct", "unemployment_rate_pct",
    "limited_english_pct", "housing_cost_burden_pct", "pop_density_per_sq_mi",
    "pop_growth_pct", "income_growth_pct",
)

_SELECT = ", ".join(_FIELDS)

_BASE_SQL = f"""
    SELECT {_SELECT}
    FROM raw_acs_demographics
    WHERE vintage = 2024
"""


def _row_to_dict(row: tuple) -> dict:
    return dict(zip(_FIELDS, row))


@router.get("/states", summary="ACS demographics for California state")
def get_state_demographics() -> JSONResponse:
    try:
        rows = query_rows(
            f"{_BASE_SQL} AND geography_level = 'state' AND state_fp = '06'",
        )
    except Exception as exc:
        logger.warning("State demographics error: %s", exc)
        return JSONResponse(content=[], status_code=503)
    return JSONResponse(content=[_row_to_dict(r) for r in rows])


@router.get("/counties", summary="ACS demographics for all CA counties")
def get_county_demographics(
    state_fp: str = Query(default="06", max_length=2),
) -> JSONResponse:
    try:
        rows = query_rows(
            f"{_BASE_SQL} AND geography_level = 'county' AND state_fp = ?",
            [state_fp],
        )
    except Exception as exc:
        logger.warning("County demographics error: %s", exc)
        return JSONResponse(content=[], status_code=503)
    return JSONResponse(content=[_row_to_dict(r) for r in rows])


@router.get("/zctas", summary="ACS demographics for specified ZCTAs")
def get_zcta_demographics(
    geoids: str = Query(..., description="Comma-separated zip5 codes, max 200"),
) -> JSONResponse:
    zip_list = [z.strip() for z in geoids.split(",") if z.strip()][:200]
    if not zip_list:
        return JSONResponse(content=[])

    placeholders = ", ".join("?" for _ in zip_list)
    try:
        rows = query_rows(
            f"{_BASE_SQL} AND geography_level = 'zcta' AND geoid IN ({placeholders})",
            zip_list,
        )
    except Exception as exc:
        logger.warning("ZCTA demographics error: %s", exc)
        return JSONResponse(content=[], status_code=503)
    return JSONResponse(content=[_row_to_dict(r) for r in rows])
