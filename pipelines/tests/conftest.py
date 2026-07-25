from __future__ import annotations

import os

import duckdb
import pytest
from dotenv import load_dotenv


@pytest.fixture(scope="session")
def md_conn():
    load_dotenv()
    token = os.environ.get("MOTHERDUCK_TOKEN", "")
    if token.startswith("mdt_"):
        token = token[4:]
    database = os.environ.get("MOTHERDUCK_DATABASE", "hfa_dev")
    if not token:
        pytest.skip("MOTHERDUCK_TOKEN not set — skipping MotherDuck tests")
    con = duckdb.connect(f"md:{database}", config={"motherduck_token": token})
    yield con
    con.close()
