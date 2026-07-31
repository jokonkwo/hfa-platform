from __future__ import annotations

import logging

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from hfa_api.db.connection import query_rows

router = APIRouter()
logger = logging.getLogger(__name__)


def _search_states(q_like: str, q_exact: str) -> list[dict]:
    rows = query_rows(
        """
        SELECT geoid, name, state_abbr,
          ST_XMin(geom) AS w, ST_YMin(geom) AS s,
          ST_XMax(geom) AS e, ST_YMax(geom) AS n,
          ST_X(ST_Centroid(geom)) AS lon, ST_Y(ST_Centroid(geom)) AS lat
        FROM raw_us_states
        WHERE LOWER(name) LIKE ? OR UPPER(state_abbr) = ?
        ORDER BY name
        LIMIT 3
        """,
        [q_like, q_exact],
        spatial=True,
    )
    return [
        {
            "type": "state",
            "identifier": geoid,
            "display_name": name,
            "abbr": abbr,
            "state_fp": None,
            "bbox": [float(w), float(s), float(e), float(n)],
            "lon": float(lon),
            "lat": float(lat),
        }
        for geoid, name, abbr, w, s, e, n, lon, lat in rows
    ]


def _search_counties(q_like: str) -> list[dict]:
    rows = query_rows(
        """
        SELECT c.geoid, c.name_lsad, c.state_fp, s.state_abbr,
          ST_XMin(c.geom) AS w, ST_YMin(c.geom) AS s,
          ST_XMax(c.geom) AS e, ST_YMax(c.geom) AS n,
          ST_X(ST_Centroid(c.geom)) AS lon, ST_Y(ST_Centroid(c.geom)) AS lat
        FROM raw_us_counties c
        JOIN raw_us_states s ON s.state_fp = c.state_fp
        WHERE LOWER(c.name) LIKE ? OR LOWER(c.name_lsad) LIKE ?
        ORDER BY c.name
        LIMIT 5
        """,
        [q_like, q_like],
        spatial=True,
    )
    return [
        {
            "type": "county",
            "identifier": geoid,
            "display_name": f"{name_lsad}, {state_abbr}",
            "abbr": None,
            "state_fp": state_fp,
            "bbox": [float(w), float(s), float(e), float(n)],
            "lon": float(lon),
            "lat": float(lat),
        }
        for geoid, name_lsad, state_fp, state_abbr, w, s, e, n, lon, lat in rows
    ]


def _search_zips(prefix: str) -> list[dict]:
    rows = query_rows(
        """
        SELECT z.zip5,
          ST_X(ST_Centroid(z.geom)) AS lon, ST_Y(ST_Centroid(z.geom)) AS lat
        FROM raw_us_zctas z
        WHERE z.zip5 LIKE ?
        ORDER BY z.zip5
        LIMIT 5
        """,
        [f"{prefix}%"],
        spatial=True,
    )
    return [
        {
            "type": "zip",
            "identifier": zip5,
            "display_name": zip5,
            "abbr": None,
            "state_fp": None,
            "bbox": None,
            "lon": float(lon),
            "lat": float(lat),
        }
        for zip5, lon, lat in rows
    ]


@router.get("", summary="Search states, counties, and ZIP codes")
def search_regions(
    q: str = Query(..., min_length=1, max_length=100, description="Search query"),
) -> JSONResponse:
    q = q.strip()
    if not q:
        return JSONResponse(content=[], headers={"Cache-Control": "no-store"})

    q_len = len(q)
    q_like = f"%{q.lower()}%"
    q_exact_upper = q.upper()
    results: list[dict] = []

    # States: abbreviation exact-match always; name substring only for 3+ chars
    try:
        results.extend(_search_states(q_like if q_len >= 3 else "%NOMATCH%", q_exact_upper))
    except Exception as exc:
        logger.warning("State search error: %s", exc)

    # Counties: substring match only for 3+ char queries
    if q_len >= 3:
        try:
            results.extend(_search_counties(q_like))
        except Exception as exc:
            logger.warning("County search error: %s", exc)

    # ZIPs: prefix match for numeric queries of any length
    if q.isdigit():
        try:
            results.extend(_search_zips(q))
        except Exception as exc:
            logger.warning("ZIP search error: %s", exc)

    return JSONResponse(
        content=results[:10],
        headers={"Cache-Control": "no-store"},
    )
