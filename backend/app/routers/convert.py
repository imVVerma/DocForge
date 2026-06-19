"""Convert endpoint for staged DocForge jobs."""

from __future__ import annotations

import logging
import zipfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException

from app.converters.dispatcher import ALLOWED_TARGETS, dispatch
from app.file_manager import cleanup_job
from app.job_store import JobStatus, store
from app.schemas import ErrorResponse, JobResultResponse

logger = logging.getLogger("docforge.convert")

router = APIRouter(prefix="/api", tags=["convert"])

ALLOWED_TARGET_FORMATS = {"pdf", "docx", "txt", "md"}


def _get_ext(path: Path) -> str:
    """Return the lowercase extension of a file without the leading dot."""
    return path.suffix.lower().lstrip(".")


def _convert_single(input_file: Path, target_ext: str, output_dir: Path) -> Path:
    """Convert one file and wrap converter errors as HTTP exceptions."""
    source_ext = _get_ext(input_file)
    try:
        return dispatch(source_ext, target_ext, input_file, output_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _zip_outputs(files: list[Path], output_dir: Path, job_id: str) -> Path:
    """Zip multiple output files into a single archive."""
    zip_path = output_dir / f"docforge_converted_{job_id[:8]}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
        used_names: set[str] = set()
        for output_file in files:
            arcname = output_file.name
            stem = output_file.stem
            suffix = output_file.suffix
            counter = 2
            while arcname in used_names:
                arcname = f"{stem}_{counter}{suffix}"
                counter += 1
            used_names.add(arcname)
            zip_file.write(output_file, arcname=arcname)
    return zip_path


@router.post(
    "/convert",
    response_model=JobResultResponse,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def convert_documents(
    job_id: Annotated[str, Form(description="Job ID returned by POST /api/upload")],
    target_format: Annotated[str, Form(description="Target format: pdf, docx, txt, or md")],
) -> JobResultResponse:
    """Convert a staged upload job into the requested target format."""
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    if job.status not in (JobStatus.PENDING, JobStatus.ERROR):
        raise HTTPException(
            status_code=409,
            detail=f"Job '{job_id}' is already {job.status}. Upload new files to start a fresh conversion.",
        )
    if not job.input_files:
        raise HTTPException(status_code=400, detail=f"Job '{job_id}' has no staged input files.")

    target_ext = target_format.lower().strip().lstrip(".")
    if target_ext not in ALLOWED_TARGET_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported target format '{target_format}'. Choose from: pdf, docx, txt, md.",
        )

    input_paths = [Path(path) for path in job.input_files]
    for input_file in input_paths:
        source_ext = _get_ext(input_file)
        allowed_targets = ALLOWED_TARGETS.get(source_ext, [])
        if target_ext not in allowed_targets:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Cannot convert '{input_file.name}' ({source_ext.upper()}) to {target_ext.upper()}. "
                    f"Allowed targets: {', '.join(item.upper() for item in allowed_targets)}."
                ),
            )

    store.update_status(job_id, JobStatus.PROCESSING)
    output_dir = Path(job.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    converted_files: list[Path] = []
    try:
        for input_file in input_paths:
            converted = _convert_single(input_file, target_ext, output_dir)
            converted_files.append(converted)
            logger.info("convert done: job=%s file=%s→%s", job_id, input_file.name, converted.name)
    except HTTPException:
        store.set_error(job_id, "Conversion failed. See error details.")
        raise
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.exception("unexpected conversion error: job=%s", job_id)
        store.set_error(job_id, "An unexpected server error occurred during conversion.")
        raise HTTPException(status_code=500, detail="Conversion failed due to a server error. Please try again.") from exc

    final_output = converted_files[0] if len(converted_files) == 1 else _zip_outputs(converted_files, output_dir, job_id)
    if len(converted_files) > 1:
        logger.info("zipped %d files: %s", len(converted_files), final_output.name)

    store.set_output(job_id, str(final_output))

    download_url = f"/api/download/{job_id}"
    current_job = store.get(job_id)
    output_size = current_job.output_size if current_job and current_job.output_size is not None else 0
    logger.info("convert complete: job=%s output=%s size=%d", job_id, final_output.name, output_size)

    return JobResultResponse(
        job_id=job_id,
        status=JobStatus.DONE,
        download_url=download_url,
        output_size=output_size,
        metadata={"output_filename": final_output.name, "file_count": len(converted_files)},
    )
