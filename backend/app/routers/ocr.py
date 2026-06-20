"""
POST /api/ocr

Accepts a previously uploaded job_id, output format, and language.
Runs OCR on the file (PDF or image) and returns extracted text
in the requested format.
"""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException

from app.job_store import store, JobStatus
from app.schemas import JobResultResponse, ErrorResponse
from app.ocr.engine import (
    ocr_image_file,
    ocr_pdf_file,
    write_txt_output,
    write_md_output,
    write_searchable_pdf,
    LANGUAGE_MAP,
)

logger = logging.getLogger("docforge.ocr_router")

router = APIRouter(prefix="/api", tags=["ocr"])

SUPPORTED_INPUT_FORMATS = {"pdf", "png", "jpg", "jpeg"}
SUPPORTED_OUTPUT_FORMATS = {"txt", "md", "pdf"}


def _get_ext(path: Path) -> str:
    return path.suffix.lower().lstrip(".")


@router.post(
    "/ocr",
    response_model=JobResultResponse,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def run_ocr(
    job_id: Annotated[str, Form(description="Job ID from POST /api/upload")],
    output_format: Annotated[
        str,
        Form(description="Output format: txt, md, or pdf (searchable PDF)"),
    ],
    language: Annotated[
        str,
        Form(description="OCR language: eng, hin, or auto"),
    ] = "eng",
) -> JobResultResponse:
    """
    Run OCR on a previously uploaded PDF or image file.

    Accepts:
        job_id: from POST /api/upload (must contain exactly 1 file)
        output_format: "txt", "md", or "pdf" (searchable PDF)
        language: "eng" (English), "hin" (Hindi), or "auto" (both)

    Returns job result with:
        - download_url: extracted text file or searchable PDF
        - metadata.page_count: number of pages processed
        - metadata.confidence_scores: per-page confidence (0–100)
        - metadata.mean_confidence: overall mean confidence
        - metadata.language: language used
        - metadata.output_format: format produced
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

    if not job.input_files or len(job.input_files) != 1:
        raise HTTPException(
            status_code=400,
            detail="OCR accepts exactly one file at a time.",
        )

    # ------------------------------------------------------------------ #
    # 2. Validate params
    # ------------------------------------------------------------------ #
    output_format = output_format.lower().strip()
    language = language.lower().strip()

    if output_format not in SUPPORTED_OUTPUT_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported output format '{output_format}'. "
                   f"Choose from: txt, md, pdf.",
        )

    if language not in LANGUAGE_MAP:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{language}'. "
                   f"Choose from: eng, hin, auto.",
        )

    input_file = Path(job.input_files[0])
    ext = _get_ext(input_file)

    if ext not in SUPPORTED_INPUT_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot run OCR on '{input_file.name}'. "
                   f"Supported formats: PDF, PNG, JPG.",
        )

    # Searchable PDF output only supported for PDF input
    if output_format == "pdf" and ext != "pdf":
        raise HTTPException(
            status_code=400,
            detail="Searchable PDF output is only available when the input is a PDF.",
        )

    # ------------------------------------------------------------------ #
    # 3. Run OCR
    # ------------------------------------------------------------------ #
    store.update_status(job_id, JobStatus.PROCESSING)

    output_dir = Path(job.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = input_file.stem

    try:
        if ext == "pdf":
            pages = ocr_pdf_file(input_file, language=language)
        else:
            pages = ocr_image_file(input_file, language=language)

    except (ValueError, RuntimeError) as exc:
        store.set_error(job_id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("unexpected OCR error: job=%s", job_id)
        store.set_error(job_id, "OCR failed due to a server error.")
        raise HTTPException(
            status_code=500,
            detail="OCR failed due to a server error. Please try again.",
        ) from exc

    # ------------------------------------------------------------------ #
    # 4. Write output
    # ------------------------------------------------------------------ #
    try:
        if output_format == "txt":
            output_file = write_txt_output(pages, output_dir, stem)
        elif output_format == "md":
            output_file = write_md_output(pages, output_dir, stem)
        else:  # pdf
            output_file = write_searchable_pdf(pages, input_file, output_dir, stem)
    except Exception as exc:
        logger.exception("OCR output write error: job=%s", job_id)
        store.set_error(job_id, "Failed to write OCR output.")
        raise HTTPException(
            status_code=500,
            detail="Failed to write OCR output. Please try again.",
        ) from exc

    # ------------------------------------------------------------------ #
    # 5. Build result
    # ------------------------------------------------------------------ #
    store.set_output(job_id, str(output_file))

    confidence_scores = [p["confidence"] for p in pages]
    mean_confidence = round(
        sum(confidence_scores) / len(confidence_scores), 1
    ) if confidence_scores else 0.0

    logger.info(
        "ocr complete: job=%s pages=%d mean_conf=%.1f%% output=%s",
        job_id, len(pages), mean_confidence, output_file.name,
    )

    return JobResultResponse(
        job_id=job_id,
        status=JobStatus.DONE,
        download_url=f"/api/download/{job_id}",
        output_size=job.output_size or 0,
        metadata={
            "output_filename": output_file.name,
            "page_count": len(pages),
            "confidence_scores": confidence_scores,
            "mean_confidence": mean_confidence,
            "language": language,
            "output_format": output_format,
            "text_preview": pages[0]["text"][:500] if pages else "",
        },
    )
