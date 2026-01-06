from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from hfa_api.logging_setup import setup_logging, get_logger
from hfa_api.settings import get_settings
from hfa_api.routes.health import router as health_router

logger = get_logger(__name__)


def create_app() -> FastAPI:
    """
    Application factory.

    Keeps app creation explicit and testable.
    """
    settings = get_settings()

    app = FastAPI(
        title="Healthy Fresno Air API",
        version="0.1.0",
        docs_url="/docs" if settings.env != "prod" else None,
        redoc_url=None,
    )

    # CORS: permissive for v1; tighten later if needed
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers
    app.include_router(health_router, prefix="/health", tags=["health"])

    return app


def _startup() -> None:
    """
    Startup hook for side effects that must happen once.
    """
    setup_logging()
    settings = get_settings()
    logger.info(
        "API starting",
        extra={
            "env": settings.env,
            "warehouse_mode": settings.warehouse_mode,
        },
    )


# FastAPI entrypoint
_startup()
app = create_app()
