"""API routes for DocForge."""

from __future__ import annotations

from fastapi import APIRouter

from app.config import TMP_BASE
from app.routers.convert import router as convert_router
from app.routers.download import router as download_router
from app.routers.merge import router as merge_router
from app.routers.upload import router as upload_router
from app.routers.compress import router as compress_router
from app.routers.ocr import router as ocr_router
from app.schemas import HealthResponse

router = APIRouter()
router.include_router(upload_router)
router.include_router(download_router)
router.include_router(convert_router)
router.include_router(merge_router)
router.include_router(compress_router)
router.include_router(ocr_router)


@router.get("/api/ping", response_model=HealthResponse)
async def ping() -> HealthResponse:
    """Return a lightweight health check response."""
    return HealthResponse(status="ok", tmp_base_exists=TMP_BASE.exists())
