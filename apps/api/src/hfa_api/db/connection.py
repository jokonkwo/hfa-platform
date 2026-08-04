from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from hfa_api.logging_setup import get_logger
from hfa_api.settings import get_settings

logger = get_logger(__name__)


@dataclass(frozen=True)
class WarehouseConnectionInfo:
    mode: str
    duckdb_path: Optional[Path] = None
    motherduck_database: Optional[str] = None


def _require_duckdb() -> Any:
    """
    Lazy import so this module can be imported even if duckdb isn't installed yet.
    We'll install duckdb as part of the API deps shortly.
    """
    try:
        import duckdb  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "duckdb is not installed. Install it with: pip install duckdb"
        ) from e
    return duckdb


def get_connection_info() -> WarehouseConnectionInfo:
    settings = get_settings()
    if settings.warehouse_mode == "local":
        return WarehouseConnectionInfo(mode="local", duckdb_path=settings.duckdb_path)

    # MotherDuck
    return WarehouseConnectionInfo(
        mode="motherduck",
        motherduck_database=settings.motherduck_database,
    )


def connect_readonly() -> Any:
    """
    Create a DuckDB connection for read-only query usage.

    - local: connects to a local DuckDB file
    - motherduck: connects to MotherDuck using the md: DSN
      (requires MOTHERDUCK_TOKEN in environment)

    Returns:
        duckdb.DuckDBPyConnection (typed as Any to avoid hard dependency in typing)
    """
    settings = get_settings()
    duckdb = _require_duckdb()

    if settings.warehouse_mode == "local":
        db_path = settings.duckdb_path
        db_path.parent.mkdir(parents=True, exist_ok=True)

        logger.info("Connecting to local DuckDB", extra={"path": str(db_path)})
        # DuckDB doesn't enforce true read-only here; we treat it as read-only by convention.
        return duckdb.connect(str(db_path))

    # MotherDuck
    # Settings.validate_runtime() already enforces required env vars,
    # but we keep the checks explicit for clarity.
    if not settings.motherduck_database:
        raise RuntimeError("MOTHERDUCK_DATABASE must be set for MotherDuck mode")
    if not settings.motherduck_token:
        raise RuntimeError("MOTHERDUCK_TOKEN must be set for MotherDuck mode")

    logger.info(
        "Connecting to MotherDuck",
        extra={"database": settings.motherduck_database},
    )

    # Strip the mdt_ prefix the MotherDuck UI adds — duckdb.connect() requires the raw JWT.
    token = settings.motherduck_token or ""
    if token.startswith("mdt_"):
        token = token[4:]
    return duckdb.connect(
        f"md:{settings.motherduck_database}",
        config={"motherduck_token": token},
    )


def query_rows(sql: str, params: Optional[list[Any]] = None, *, spatial: bool = False) -> list[tuple]:
    """Run a query and return raw rows as a list of tuples.

    Pass spatial=True to load the DuckDB spatial extension before executing
    (required for ST_AsGeoJSON, ST_Intersects, etc.).
    """
    con = connect_readonly()
    try:
        if spatial:
            con.execute("INSTALL spatial; LOAD spatial")
        if params:
            return con.execute(sql, params).fetchall()
        return con.execute(sql).fetchall()
    finally:
        try:
            con.close()
        except Exception:
            pass


def query_df(sql: str, params: Optional[list[Any]] = None) -> Any:
    """
    Convenience helper: run a query and return a dataframe-like object.

    Note: duckdb returns a pandas DataFrame from .df() if pandas is installed.
    We'll keep this flexible for now.
    """
    con = connect_readonly()
    try:
        if params:
            return con.execute(sql, params).df()
        return con.execute(sql).df()
    finally:
        try:
            con.close()
        except Exception:
            pass
