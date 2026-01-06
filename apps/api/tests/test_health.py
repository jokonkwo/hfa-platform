from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient


# Ensure the API package is importable in a monorepo layout:
# apps/api/src/hfa_api/...
API_SRC = Path(__file__).resolve().parents[2] / "src"
sys.path.insert(0, str(API_SRC))


from hfa_api.main import create_app  # noqa: E402


def test_health_endpoint_returns_ok() -> None:
    app = create_app()
    client = TestClient(app)

    resp = client.get("/health")
    assert resp.status_code == 200

    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "hfa-api"
    assert "env" in body
    assert "warehouse_mode" in body
