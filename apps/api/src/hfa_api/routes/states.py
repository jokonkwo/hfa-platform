from __future__ import annotations

import json
from functools import lru_cache

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from hfa_api.db.connection import query_rows

router = APIRouter()


@lru_cache(maxsize=4)
def _fetch_state_boundaries() -> list[dict]:
    """Fetch all US state/territory boundaries, cached for the process lifetime."""
    rows = query_rows(
        """
        SELECT state_fp, state_abbr, name, geoid, ST_AsGeoJSON(geom) AS geometry_json
        FROM raw_us_states
        ORDER BY name
        """,
        spatial=True,
    )
    return [
        {
            "type": "Feature",
            "geometry": json.loads(geom_json),
            "properties": {
                "GEOID": geoid,
                "NAME": name,
                "STUSPS": state_abbr,
                "isCalifornia": state_fp == "06",
            },
        }
        for state_fp, state_abbr, name, geoid, geom_json in rows
    ]


@router.get("/boundaries", summary="US state boundary polygons as GeoJSON FeatureCollection")
def get_state_boundaries() -> JSONResponse:
    try:
        features = _fetch_state_boundaries()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"State boundary query failed: {e}")

    if not features:
        raise HTTPException(status_code=404, detail="No state boundaries found")

    return JSONResponse(
        content={"type": "FeatureCollection", "features": features},
        media_type="application/geo+json",
        headers={"Cache-Control": "no-store"},
    )
