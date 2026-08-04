from __future__ import annotations

import datetime
import json
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from hfa_api.db.connection import query_df, query_rows
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


@lru_cache(maxsize=64)
def _fetch_zip_boundaries(county: str) -> list[dict]:
    """Fetch ZIP GeoJSON features for a county, cached for the process lifetime.

    Uses precomputed centroid_lon/centroid_lat columns on raw_us_zctas (added 2026-07-31)
    to avoid recomputing ST_Centroid for all 33,791 ZCTAs on every cold query.
    This reduced cold-query time by ~35% (4-6s → 2.5-4s) with no spatial index needed.
    """
    rows = query_rows(
        """
        SELECT z.zip5, ST_AsGeoJSON(z.geom) AS geometry_json
        FROM raw_us_zctas z
        WHERE ST_Within(
            ST_Point(z.centroid_lon, z.centroid_lat),
            (SELECT geom FROM raw_us_counties WHERE geoid = ?)
        )
        ORDER BY z.zip5
        """,
        [county],
        spatial=True,
    )
    return [
        {
            "type": "Feature",
            "geometry": json.loads(geom_json),
            "properties": {"ZCTA5": zip5},
        }
        for zip5, geom_json in rows
    ]


@lru_cache(maxsize=64)
def _fetch_zip_cities(county: str) -> list[tuple[str, str]]:
    """Map each ZCTA in a county to its nearest incorporated city (lsad='25').
    Falls back to any place type if no incorporated cities exist in the county.
    Cached for the process lifetime.
    """
    rows = query_rows(
        """
        WITH cities AS (
            SELECT name, centroid_lon, centroid_lat
            FROM raw_us_places
            WHERE county_geoid = ? AND lsad = '25'
        ),
        all_places AS (
            SELECT name, centroid_lon, centroid_lat
            FROM raw_us_places
            WHERE county_geoid = ?
        ),
        chosen AS (
            SELECT name, centroid_lon, centroid_lat FROM cities
            UNION ALL
            SELECT name, centroid_lon, centroid_lat FROM all_places
            WHERE (SELECT COUNT(*) FROM cities) = 0
        )
        SELECT z.zip5,
               FIRST(c.name ORDER BY (z.centroid_lon - c.centroid_lon)^2 + (z.centroid_lat - c.centroid_lat)^2) AS city
        FROM raw_us_zctas z
        CROSS JOIN chosen c
        JOIN raw_us_counties co ON co.geoid = ?
        WHERE ST_Within(ST_Point(z.centroid_lon, z.centroid_lat), co.geom)
        GROUP BY z.zip5
        """,
        [county, county, county],
        spatial=True,
    )
    return [(zip5, city) for zip5, city in rows]


@router.get("/cities", summary="Map ZIPs to nearest incorporated city for a county")
def get_zip_cities(
    county: str = Query(..., description="5-digit county GEOID (e.g. 06019 for Fresno County CA)"),
) -> JSONResponse:
    try:
        pairs = _fetch_zip_cities(county)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"ZIP cities query failed: {e}")
    return JSONResponse(
        content={zip5: city for zip5, city in pairs},
        headers={"Cache-Control": "no-store"},
    )


@router.get("/boundaries", summary="ZIP boundary polygons as GeoJSON FeatureCollection")
def get_zip_boundaries(
    county: str = Query(default="06019", description="5-digit county GEOID (default: 06019 = Fresno County CA)"),
) -> JSONResponse:
    try:
        features = _fetch_zip_boundaries(county)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"ZIP boundary query failed: {e}")

    if not features:
        raise HTTPException(status_code=404, detail=f"No ZIP boundaries found for county '{county}'")

    return JSONResponse(
        content={"type": "FeatureCollection", "features": features},
        media_type="application/geo+json",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/now", summary="Current conditions for all ZIPs")
def get_all_zips_now() -> list[dict]:
    df = query_df("SELECT * FROM api_zip_now ORDER BY zip")
    records = _to_records(df)
    for rec in records:
        rec["population"] = None
    return records


@router.get("/{zip_code}/now", summary="Current conditions for one ZIP")
def get_zip_now(zip_code: str) -> dict:
    df = query_df("SELECT * FROM api_zip_now WHERE zip = ?", [zip_code])
    if df.empty:
        raise HTTPException(status_code=404, detail=f"ZIP {zip_code} not found")
    rec = _to_records(df)[0]
    rec["population"] = None
    return rec


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
