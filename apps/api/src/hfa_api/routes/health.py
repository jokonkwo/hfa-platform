from fastapi import APIRouter

from hfa_api.logging_setup import get_logger
from hfa_api.settings import get_settings

router = APIRouter()
logger = get_logger(__name__)


@router.get(
    "",
    summary="Service health check",
    description="Basic liveness and configuration health for the API.",
)
def health() -> dict:
    """
    Lightweight health check.

    This endpoint should be:
    - fast
    - non-blocking
    - free of heavy dependencies

    Database connectivity and data freshness checks
    will be layered in later once the warehouse is wired.
    """
    settings = get_settings()

    logger.debug("Health check requested")

    return {
        "status": "ok",
        "service": "hfa-api",
        "env": settings.env,
        "warehouse_mode": settings.warehouse_mode,
    }
