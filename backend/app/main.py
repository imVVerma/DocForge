"""DocForge FastAPI application entry point."""

from __future__ import annotations

from contextlib import asynccontextmanager
import logging

# pyrefly: ignore [missing-import]
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import CLEANUP_INTERVAL_MINUTES
from app.file_manager import cleanup_expired_jobs, ensure_tmp_base
from app.routes import router
from app.core.limiter import limiter

logger = logging.getLogger("docforge.main")
scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start DocForge background services on boot and stop them on shutdown."""
    ensure_tmp_base()
    scheduler.add_job(
        cleanup_expired_jobs,
        "interval",
        minutes=CLEANUP_INTERVAL_MINUTES,
        id="cleanup_cron",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("scheduler started with cleanup interval=%s minutes", CLEANUP_INTERVAL_MINUTES)
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)
        logger.info("scheduler stopped")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="DocForge API",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/")
    def root():
        return {"message": "DocForge API is running"}

    return app


app = create_app()
