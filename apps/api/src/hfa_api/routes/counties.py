from __future__ import annotations

import json
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from hfa_api.db.connection import query_rows

router = APIRouter()


@lru_cache(maxsize=64)
def _fetch_county_boundaries(state: str) -> list[dict]:
    """Fetch county GeoJSON features for a state (full detail), cached per process."""
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
    return _rows_to_features(rows)


@lru_cache(maxsize=1)
def _fetch_all_county_boundaries_simplified() -> list[dict]:
    """Return all US county boundaries with simplified geometry (~0.7 MB).

    Uses ST_SimplifyPreserveTopology at 0.05° tolerance (~5 km). Invisible at national
    zoom levels; acceptable for county tier context rendering. Cached once per process.
    """
    rows = query_rows(
        """
        SELECT geoid, name, name_lsad,
               ST_X(ST_Centroid(geom)) AS centroid_lon,
               ST_Y(ST_Centroid(geom)) AS centroid_lat,
               ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.05)) AS geometry_json
        FROM raw_us_counties
        ORDER BY state_fp, name
        """,
        spatial=True,
    )
    return _rows_to_features(rows)


def _rows_to_features(rows: list) -> list[dict]:
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
    state: str = Query(default="", description="2-digit FIPS state code. Omit for all US counties (simplified geometry)."),
) -> JSONResponse:
    """Return county boundaries.

    - No `state` param (or empty): returns all 3,235 US counties with simplified geometry
      (~0.7 MB). Use for national color-scale rendering in the county tier.
    - `state=<fips>`: returns that state's counties with full-detail geometry.
      Use when zoomed into a specific state.
    """
    try:
        if state:
            features = _fetch_county_boundaries(state)
            if not features:
                raise HTTPException(status_code=404, detail=f"No counties found for state FIPS '{state}'")
        else:
            features = _fetch_all_county_boundaries_simplified()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"County boundary query failed: {e}")

    return JSONResponse(
        content={"type": "FeatureCollection", "features": features},
        media_type="application/geo+json",
        headers={"Cache-Control": "no-store"},
    )
