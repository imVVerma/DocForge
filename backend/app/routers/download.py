"""/api/download/{job_id} - stream the processed output file to the client.
/api/cleanup/{job_id} - delete job directory and remove job from store.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.file_manager import cleanup_job
from app.job_store import JobStatus, store
from app.schemas import CleanupResponse, ErrorResponse

logger = logging.getLogger("docforge.download")

router = APIRouter(prefix="/api", tags=["download"])


@router.get(
    "/download/{job_id}",
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
    },
)
async def download_file(job_id: str) -> FileResponse:
    """Stream the processed output file for a completed job."""
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    if job.status == JobStatus.ERROR:
        raise HTTPException(status_code=409, detail=job.error or "Job failed. Please try again.")

    if job.status != JobStatus.DONE:
        raise HTTPException(
            status_code=409,
            detail=f"Job '{job_id}' is not ready yet (status: {job.status}).",
        )

    if not job.output_file or not Path(job.output_file).exists():
        raise HTTPException(
            status_code=500,
            detail="Output file is missing. The job may have already been downloaded.",
        )

    output_path = Path(job.output_file)
    logger.info("download: job=%s file=%s size=%d", job_id, output_path.name, job.output_size or 0)

    def _sync_cleanup() -> None:
        cleanup_job(job_id)
        store.delete(job_id)
        logger.info("post-download cleanup done: job=%s", job_id)

    return FileResponse(
        path=str(output_path),
        filename=output_path.name,
        media_type="application/octet-stream",
        background=BackgroundTask(_sync_cleanup),
    )


@router.delete(
    "/cleanup/{job_id}",
    response_model=CleanupResponse,
    responses={404: {"model": ErrorResponse}},
)
async def cleanup_job_endpoint(job_id: str) -> CleanupResponse:
    """Delete a job's files and remove it from the store."""
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    cleanup_job(job_id)
    store.delete(job_id)
    logger.info("manual cleanup: job=%s", job_id)

    return CleanupResponse(success=True, job_id=job_id)
