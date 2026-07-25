from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient

API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(API_SRC))

# Load env before importing main — get_settings is lru_cached, so vars must be set first.
REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env")
os.environ["HFA_WAREHOUSE_MODE"] = "motherduck"


@pytest.fixture(scope="module")
def client():
    # Clear lru_cache so settings pick up env vars set above.
    from hfa_api.settings import get_settings
    get_settings.cache_clear()

    from hfa_api.main import create_app
    app = create_app()
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

    get_settings.cache_clear()


@pytest.fixture(scope="module")
def real_zip(client):
    resp = client.get("/v1/zips/now")
    assert resp.status_code == 200
    zips = resp.json()
    assert len(zips) > 0, "api_zip_now returned no rows — cannot run per-ZIP tests"
    return zips[0]["zip"]


REQUIRED_NOW_FIELDS = {"zip", "town", "pm25", "aqi", "category", "sample_size", "freshness_pct", "qc_badge"}


# --- Check 1: GET /v1/zips/now ---

def test_zips_now_returns_array_with_required_fields(client):
    resp = client.get("/v1/zips/now")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    body = resp.json()
    assert isinstance(body, list)
    assert len(body) > 0
    for item in body:
        missing = REQUIRED_NOW_FIELDS - set(item.keys())
        assert not missing, f"Item missing fields: {missing}"


# --- Check 2: GET /v1/zips/{zip}/now ---

def test_zip_now_real_zip_returns_200(client, real_zip):
    resp = client.get(f"/v1/zips/{real_zip}/now")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    body = resp.json()
    assert isinstance(body, dict)
    missing = REQUIRED_NOW_FIELDS - set(body.keys())
    assert not missing, f"Response missing fields: {missing}"
    assert body["zip"] == real_zip


def test_zip_now_unknown_zip_returns_404(client):
    resp = client.get("/v1/zips/00000/now")
    assert resp.status_code == 404
    assert resp.headers["content-type"].startswith("application/json")


# --- Check 3: GET /v1/zips/{zip}/hourly ---

def test_zip_hourly_returns_200(client, real_zip):
    resp = client.get(f"/v1/zips/{real_zip}/hourly")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    body = resp.json()
    assert isinstance(body, list)
    if body:
        required = {"hour_utc", "zip", "town", "pm25", "aqi", "sample_size", "coverage_bins"}
        missing = required - set(body[0].keys())
        assert not missing, f"Hourly item missing fields: {missing}"


# --- Check 4: GET /v1/zips/{zip}/daily ---

def test_zip_daily_returns_200_array_may_be_empty(client, real_zip):
    resp = client.get(f"/v1/zips/{real_zip}/daily")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    body = resp.json()
    assert isinstance(body, list)
    if body:
        required = {"date", "zip", "town", "pm25_mean", "pm25_p95", "pm25_max",
                    "aqi_exceed_101", "aqi_exceed_151", "coverage_hours"}
        missing = required - set(body[0].keys())
        assert not missing, f"Daily item missing fields: {missing}"


# --- Check 5: GET /v1/coverage/today ---

def test_coverage_today_returns_single_object(client):
    resp = client.get("/v1/coverage/today")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    body = resp.json()
    assert isinstance(body, dict)
    required = {"date", "qualified_zips", "total_zips", "panel_size"}
    missing = required - set(body.keys())
    assert not missing, f"Coverage today missing fields: {missing}"


# --- Check 6: No 500s on any endpoint even when underlying views are empty ---

def test_empty_results_never_500(client):
    endpoints = [
        "/v1/zips/now",
        "/v1/zips/99999/hourly",
        "/v1/zips/99999/daily",
    ]
    for url in endpoints:
        resp = client.get(url)
        assert resp.status_code != 500, f"{url} returned 500"
        assert resp.headers["content-type"].startswith("application/json"), f"{url} bad content-type"
