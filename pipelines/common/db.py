from __future__ import annotations

from pathlib import Path
from typing import Any

from pipelines.common.config import PipelineConfig
from pipelines.common.logging_setup import get_logger

logger = get_logger(__name__)


def _require_duckdb() -> Any:
    try:
        import duckdb  # type: ignore
    except ImportError as e:
        raise RuntimeError("duckdb is not installed. Install it with: pip install duckdb") from e
    return duckdb


def connect(cfg: PipelineConfig) -> Any:
    """
    Create a DuckDB connection.

    - local: connects to a local DuckDB file
    - motherduck: connects to MotherDuck using md: DSN
      (requires MOTHERDUCK_TOKEN env var)

    Returns:
        duckdb.DuckDBPyConnection (typed as Any to avoid hard dependency in typing)
    """
    duckdb = _require_duckdb()

    if cfg.warehouse_mode == "local":
        db_path = cfg.duckdb_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

        logger.info("Connecting to local DuckDB", extra={"path": str(db_path)})
        return duckdb.connect(str(db_path))

    # MotherDuck
    if not cfg.motherduck_database:
        raise RuntimeError("MOTHERDUCK_DATABASE must be set for MotherDuck mode")
    if not cfg.motherduck_token:
        raise RuntimeError("MOTHERDUCK_TOKEN must be set for MotherDuck mode")

    # Strip the mdt_ prefix the MotherDuck UI adds — duckdb.connect() requires raw JWT.
    token = cfg.motherduck_token or ""
    if token.startswith("mdt_"):
        token = token[4:]

    logger.info("Connecting to MotherDuck", extra={"database": cfg.motherduck_database})
    return duckdb.connect(
        f"md:{cfg.motherduck_database}",
        config={"motherduck_token": token},
    )
