import json
import logging
import logging.config
import os
from pathlib import Path


def _find_repo_root(start: Path | None = None) -> Path:
    """
    Find the repo root by walking upwards until we locate pyproject.toml.
    This avoids brittle relative paths when running from different cwd's.
    """
    current = (start or Path(__file__)).resolve()
    for parent in [current, *current.parents]:
        if (parent / "pyproject.toml").exists():
            return parent
    raise RuntimeError("Could not locate repo root (pyproject.toml not found).")


def setup_logging() -> None:
    """
    Configure Python logging using configs/logging/logging.json.

    Override path via:
      - HFA_LOG_CONFIG_PATH (absolute or repo-relative)
    """
    repo_root = _find_repo_root()
    override = os.getenv("HFA_LOG_CONFIG_PATH")

    if override:
        cfg_path = Path(override)
        if not cfg_path.is_absolute():
            cfg_path = (repo_root / cfg_path).resolve()
    else:
        cfg_path = repo_root / "configs" / "logging" / "logging.json"

    if not cfg_path.exists():
        raise FileNotFoundError(f"Logging config not found: {cfg_path}")

    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    logging.config.dictConfig(cfg)


def get_logger(name: str) -> logging.Logger:
    """
    Convenience wrapper for consistent logger acquisition.
    """
    return logging.getLogger(name)
