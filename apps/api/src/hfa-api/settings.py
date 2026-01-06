from functools import lru_cache
from pathlib import Path
import os

from pydantic import BaseModel, Field, ValidationError


class Settings(BaseModel):
    # ----------------------------
    # App
    # ----------------------------
    env: str = Field(default="local", description="local | staging | prod")
    log_level: str = Field(default="INFO", description="Logging level")

    # ----------------------------
    # Warehouse
    # ----------------------------
    warehouse_mode: str = Field(
        default="local", description="local | motherduck"
    )

    duckdb_path: Path = Field(
        default=Path("./data/local/hfa.duckdb"),
        description="Local DuckDB file path",
    )

    motherduck_database: str | None = Field(
        default=None, description="MotherDuck database name"
    )

    motherduck_token: str | None = Field(
        default=None, description="MotherDuck auth token"
    )

    # ----------------------------
    # API
    # ----------------------------
    api_host: str = Field(default="0.0.0.0")
    api_port: int = Field(default=8000)

    # ----------------------------
    # Freshness / Ops
    # ----------------------------
    data_freshness_breach_minutes: int = Field(default=30)

    def validate_runtime(self) -> None:
        """
        Fail fast on invalid or unsafe runtime configurations.
        """
        if self.warehouse_mode == "motherduck":
            if not self.motherduck_database:
                raise ValueError("MOTHERDUCK_DATABASE must be set when using MotherDuck")
            if not self.motherduck_token:
                raise ValueError("MOTHERDUCK_TOKEN must be set when using MotherDuck")


@lru_cache
def get_settings() -> Settings:
    """
    Load settings once per process.
    """
    try:
        settings = Settings(
            env=os.getenv("HFA_ENV", "local"),
            log_level=os.getenv("HFA_LOG_LEVEL", "INFO"),
            warehouse_mode=os.getenv("HFA_WAREHOUSE_MODE", "local"),
            duckdb_path=Path(
                os.getenv("HFA_DUCKDB_PATH", "./data/local/hfa.duckdb")
            ),
            motherduck_database=os.getenv("MOTHERDUCK_DATABASE"),
            motherduck_token=os.getenv("MOTHERDUCK_TOKEN"),
            api_host=os.getenv("API_HOST", "0.0.0.0"),
            api_port=int(os.getenv("API_PORT", "8000")),
            data_freshness_breach_minutes=int(
                os.getenv("DATA_FRESHNESS_BREACH_MINUTES", "30")
            ),
        )
        settings.validate_runtime()
        return settings
    except ValidationError as e:
        raise RuntimeError(f"Invalid configuration: {e}") from e
