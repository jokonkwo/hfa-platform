from __future__ import annotations

import json
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from hfa_api.db.connection import query_rows

router = APIRouter()


@lru_cache(maxsize=64)
def _fetch_county_boundaries(state: str) -> list[dict]:
    """Fetch county GeoJSON features for a state, cached for the process lifetime."""
    rows = query_rows(
        """
        SELECT geoid, name, name_lsad,
               ST_X(ST_Centroid(geom)) AS centroid_lon,
               ST_Y(ST_Centroid(geom)) AS centroid_lat,
               ST_AsGeoJSON(geom) AS geometry_json
        FROM raw_us_counties
        WHERE state_fp = ?
        ORDER BY name
        """,
        [state],
        spatial=True,
    )
    return [
        {
            "type": "Feature",
            "geometry": json.loads(geom_json),
            "properties": {
                "GEOID": geoid,
                "NAME": name,
                "NAMELSAD": name_lsad,
                "CENTROID_LON": centroid_lon,
                "CENTROID_LAT": centroid_lat,
            },
        }
        for geoid, name, name_lsad, centroid_lon, centroid_lat, geom_json in rows
    ]


@router.get("/boundaries", summary="County boundary polygons as GeoJSON FeatureCollection")
def get_county_boundaries(
    state: str = Query(default="06", description="2-digit FIPS state code (default: 06 = California)"),
) -> JSONResponse:
    try:
        features = _fetch_county_boundaries(state)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"County boundary query failed: {e}")

    if not features:
        raise HTTPException(status_code=404, detail=f"No counties found for state FIPS '{state}'")

    return JSONResponse(
        content={"type": "FeatureCollection", "features": features},
        media_type="application/geo+json",
        headers={"Cache-Control": "no-store"},
    )
