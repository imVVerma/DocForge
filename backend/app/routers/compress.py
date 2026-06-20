"""
POST /api/compress

Accepts a previously uploaded job_id, a quality level, and runs
compression on the single uploaded file (PDF or DOCX).

Returns job result with original_size, output_size, and reduction_pct
in metadata for the frontend size comparison display.
"""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException

from app.job_store import store, JobStatus
from app.schemas import JobResultResponse, ErrorResponse
from app.compressors.pdf_compressor import compress_pdf
from app.compressors.docx_compressor import compress_docx

logger = logging.getLogger("docforge.compress")

router = APIRouter(prefix="/api", tags=["compress"])

SUPPORTED_FORMATS = {"pdf", "docx"}
QUALITY_LEVELS = {"low", "medium", "high"}


def _get_ext(path: Path) -> str:
    return path.suffix.lower().lstrip(".")


@router.post(
    "/compress",
    response_model=JobResultResponse,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def compress_document(
    job_id: Annotated[str, Form(description="Job ID from POST /api/upload")],
    quality: Annotated[
        str,
        Form(description="Compression quality: low, medium, or high"),
    ],
) -> JobResultResponse:
    """
    Compress a previously uploaded PDF or DOCX file.

    Accepts:
        job_id: from POST /api/upload (must contain exactly 1 file)
        quality: "low" (smallest), "medium" (balanced), or "high" (minimal loss)

    Returns job result with:
        - download_url: compressed file
        - metadata.original_size: input file size in bytes
        - metadata.output_size: output file size in bytes
        - metadata.reduction_pct: percentage size reduction
        - metadata.quality: quality level used

    Only PDF and DOCX are supported. Only 1 file per compress job.
    """
    # ------------------------------------------------------------------ #
    # 1. Validate job
    # ------------------------------------------------------------------ #
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    if job.status not in (JobStatus.PENDING, JobStatus.ERROR):
        raise HTTPException(
            status_code=409,
            detail=f"Job '{job_id}' is already {job.status}.",
        )

    if not job.input_files:
        raise HTTPException(
            status_code=400,
            detail="No files found in this job.",
        )

    if len(job.input_files) > 1:
        raise HTTPException(
            status_code=400,
            detail="Compress accepts one file at a time. Upload a single file.",
        )

    # ------------------------------------------------------------------ #
    # 2. Validate quality
    # ------------------------------------------------------------------ #
    quality = quality.lower().strip()
    if quality not in QUALITY_LEVELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid quality '{quality}'. Choose from: low, medium, high.",
        )

    # ------------------------------------------------------------------ #
    # 3. Validate file format
    # ------------------------------------------------------------------ #
    input_file = Path(job.input_files[0])
    ext = _get_ext(input_file)

    if ext not in SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot compress '{input_file.name}'. "
                   f"Only PDF and DOCX are supported.",
        )

    original_size = input_file.stat().st_size

    # ------------------------------------------------------------------ #
    # 4. Run compression
    # ------------------------------------------------------------------ #
    store.update_status(job_id, JobStatus.PROCESSING)

    output_dir = Path(job.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        if ext == "pdf":
            output_file = compress_pdf(input_file, output_dir, quality)
        else:  # docx
            output_file = compress_docx(input_file, output_dir, quality)

    except ValueError as exc:
        store.set_error(job_id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        store.set_error(job_id, str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("unexpected compress error: job=%s", job_id)
        store.set_error(job_id, "Compression failed due to a server error.")
        raise HTTPException(
            status_code=500,
            detail="Compression failed due to a server error. Please try again.",
        ) from exc

    # ------------------------------------------------------------------ #
    # 5. Build result
    # ------------------------------------------------------------------ #
    store.set_output(job_id, str(output_file))

    output_size = job.output_size or output_file.stat().st_size
    reduction_pct = round((1 - output_size / original_size) * 100, 1) if original_size > 0 else 0

    logger.info(
        "compress complete: job=%s quality=%s %d→%d bytes (%.1f%%)",
        job_id, quality, original_size, output_size, reduction_pct,
    )

    return JobResultResponse(
        job_id=job_id,
        status=JobStatus.DONE,
        download_url=f"/api/download/{job_id}",
        output_size=output_size,
        metadata={
            "output_filename": output_file.name,
            "original_size": original_size,
            "output_size": output_size,
            "reduction_pct": reduction_pct,
            "quality": quality,
        },
    )
