from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter()

_BOUNDARIES_FILE = (
    Path(__file__).parent.parent.parent.parent / "data" / "ca_county_boundaries.geojson"
)


@router.get("/boundaries", summary="CA county boundary polygons as GeoJSON FeatureCollection")
def get_county_boundaries() -> JSONResponse:
    if not _BOUNDARIES_FILE.exists():
        raise HTTPException(status_code=503, detail="County boundary data not available")
    with open(_BOUNDARIES_FILE) as f:
        data = json.load(f)
    return JSONResponse(content=data, media_type="application/geo+json")
