"""/api/upload - shared multi-file upload endpoint.

Accepts 1-20 files, validates each, writes them to a job directory,
and returns a job_id for use in subsequent processing calls.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.config import MAX_UPLOAD_FILES
from app.file_manager import cleanup_job, create_job_dirs, save_uploads
from app.job_store import JobStatus, store
from app.schemas import CleanupResponse, ErrorResponse, JobCreatedResponse

logger = logging.getLogger("docforge.upload")

router = APIRouter(prefix="/api", tags=["upload"])


@router.post(
    "/upload",
    response_model=JobCreatedResponse,
    responses={400: {"model": ErrorResponse}},
)
async def upload_files(
    files: Annotated[list[UploadFile], File(description="1-20 document files")],
) -> JobCreatedResponse:
    """Stage files for processing and return a job id."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")
    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_UPLOAD_FILES} files per job.")

    job = store.create("upload")
    input_dir, _ = create_job_dirs(job.job_id)

    try:
        saved_files = await save_uploads(job.job_id, files, input_dir)
        job.input_files = [str(path) for path in saved_files]
        store.update_status(job.job_id, JobStatus.PENDING)
        logger.info("upload complete: job=%s files=%d", job.job_id, len(saved_files))
    except HTTPException:
        store.set_error(job.job_id, "Upload validation failed.")
        cleanup_job(job.job_id)
        raise
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.exception("unexpected upload error: job=%s", job.job_id)
        store.set_error(job.job_id, "Upload failed due to a server error.")
        cleanup_job(job.job_id)
        raise HTTPException(status_code=500, detail="Upload failed. Please try again.") from exc

    return JobCreatedResponse(
        job_id=job.job_id,
        status=job.status,
        input_filenames=[Path(p).name for p in job.input_files],
    )
