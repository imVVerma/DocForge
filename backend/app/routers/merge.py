"""
POST /api/merge

Accepts a previously uploaded job_id and an ordered list of filenames
specifying the merge order. Runs the merge and makes output available
via GET /api/download/{job_id}.
"""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException

from app.job_store import store, JobStatus
from app.schemas import JobResultResponse, ErrorResponse
from app.mergers.dispatcher import dispatch_merge

logger = logging.getLogger("docforge.merge")

router = APIRouter(prefix="/api", tags=["merge"])


@router.post(
    "/merge",
    response_model=JobResultResponse,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def merge_documents(
    job_id: Annotated[str, Form(description="Job ID from POST /api/upload")],
    ordered_filenames: Annotated[
        str,
        Form(
            description=(
                "Comma-separated list of filenames in the desired merge order. "
                "Must match the filenames in the uploaded job exactly. "
                "Example: '0_report.pdf,2_appendix.pdf,1_intro.pdf'"
            )
        ),
    ],
) -> JobResultResponse:
    """
    Merge previously uploaded files in the specified order.

    Accepts:
        job_id: from POST /api/upload
        ordered_filenames: comma-separated filenames in merge order

    The merge strategy is auto-selected based on input file types:
    - All PDF → merged PDF
    - All DOCX → merged DOCX
    - All TXT → merged TXT
    - All MD → merged MD
    - Mixed → all converted to PDF, then merged PDF

    Output available at GET /api/download/{job_id}.
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

    if not job.input_files or len(job.input_files) < 2:
        raise HTTPException(
            status_code=400,
            detail="Merge requires at least 2 uploaded files.",
        )

    # ------------------------------------------------------------------ #
    # 2. Parse and validate ordered_filenames
    # ------------------------------------------------------------------ #
    requested_names = [n.strip() for n in ordered_filenames.split(",") if n.strip()]

    if len(requested_names) < 2:
        raise HTTPException(
            status_code=400,
            detail="ordered_filenames must contain at least 2 filenames.",
        )

    # Build a lookup of available files by filename
    available: dict[str, Path] = {
        Path(p).name: Path(p) for p in job.input_files
    }

    # Resolve ordered paths
    ordered_paths: list[Path] = []
    for name in requested_names:
        if name not in available:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"File '{name}' not found in job '{job_id}'. "
                    f"Available files: {', '.join(available.keys())}"
                ),
            )
        ordered_paths.append(available[name])

    # ------------------------------------------------------------------ #
    # 3. Run merge
    # ------------------------------------------------------------------ #
    store.update_status(job_id, JobStatus.PROCESSING)

    output_dir = Path(job.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    tmp_pdf_dir = output_dir / "_tmp_pdfs"

    try:
        output_file, output_format = dispatch_merge(
            input_files=ordered_paths,
            output_dir=output_dir,
            tmp_pdf_dir=tmp_pdf_dir,
        )
    except (ValueError, RuntimeError) as exc:
        store.set_error(job_id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("unexpected merge error: job=%s", job_id)
        store.set_error(job_id, "Merge failed due to a server error.")
        raise HTTPException(
            status_code=500,
            detail="Merge failed due to a server error. Please try again.",
        ) from exc
    finally:
        # Clean up intermediate PDF dir regardless of success/failure
        import shutil
        if tmp_pdf_dir.exists():
            shutil.rmtree(tmp_pdf_dir, ignore_errors=True)

    store.set_output(job_id, str(output_file))
    current_job = store.get(job_id)
    output_size = current_job.output_size if current_job and current_job.output_size is not None else 0
    logger.info(
        "merge complete: job=%s output=%s format=%s size=%d",
        job_id, output_file.name, output_format, output_size,
    )

    return JobResultResponse(
        job_id=job_id,
        status=JobStatus.DONE,
        download_url=f"/api/download/{job_id}",
        output_size=output_size,
        metadata={
            "output_filename": output_file.name,
            "output_format": output_format,
            "file_count": len(ordered_paths),
        },
    )
