"""DocForge filesystem manager.

Handles:
- Creating per-job directories under /tmp/docforge/
- Writing uploaded files to disk with sanitized names
- MIME type validation via libmagic (reads actual file bytes, not extension)
- File size enforcement
- Cleanup of job directories (called by cron and post-download)
"""

from __future__ import annotations

import logging
import shutil
import zipfile
from io import BytesIO
from datetime import datetime, timezone
from pathlib import Path

try:
    import magic as _magic
    _MAGIC_AVAILABLE = True
except Exception:  # pragma: no cover - Windows DLL load failures
    _magic = None  # type: ignore[assignment]
    _MAGIC_AVAILABLE = False
from fastapi import HTTPException, UploadFile
from werkzeug.utils import secure_filename

from app.config import (
    ALLOWED_EXTENSIONS_LABEL,
    ALLOWED_MIME_TYPES,
    JOB_TTL_MINUTES,
    MAX_FILE_SIZE_BYTES,
    MAX_JOB_SIZE_BYTES,
    TMP_BASE,
)

logger = logging.getLogger("docforge.file_manager")

TEXTUAL_MIME_TYPES = {"text/plain", "text/markdown", "text/x-markdown"}
ZIP_CONTAINER_MIME_TYPES = {"application/zip", "application/x-zip-compressed", "application/octet-stream"}


def ensure_tmp_base() -> None:
    """Create /tmp/docforge/ if it does not exist."""
    TMP_BASE.mkdir(parents=True, exist_ok=True)
    logger.info("tmp base ready: %s", TMP_BASE)


def create_job_dirs(job_id: str) -> tuple[Path, Path]:
    """Create input and output directories for a job."""
    input_dir = TMP_BASE / job_id / "input"
    output_dir = TMP_BASE / job_id / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    return input_dir, output_dir


# Extension → MIME fallback for environments without working libmagic (e.g. Windows dev)
_EXT_TO_MIME: dict[str, str] = {
    "pdf":  "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt":  "text/plain",
    "md":   "text/markdown",
    "png":  "image/png",
    "jpg":  "image/jpeg",
    "jpeg": "image/jpeg",
}


def _detect_mime(data: bytes, filename: str = "") -> str:
    """Detect MIME type from file bytes via libmagic, falling back to extension."""
    if _MAGIC_AVAILABLE:
        try:
            return _magic.from_buffer(data, mime=True)
        except Exception:  # pragma: no cover - libmagic runtime failures on Windows
            pass
    # Fallback: infer from file extension
    ext = Path(filename).suffix.lower().lstrip(".")
    return _EXT_TO_MIME.get(ext, "application/octet-stream")


def _canonical_extension(filename: str, mime_type: str) -> str:
    """Pick a safe extension for the staged upload."""
    original_extension = Path(filename).suffix.lower().lstrip(".")
    if mime_type in TEXTUAL_MIME_TYPES:
        if original_extension in {"md", "txt"}:
            return original_extension
        return "txt"
    return ALLOWED_MIME_TYPES[mime_type]


def _validate_file(filename: str, data: bytes) -> str:
    """Validate size and MIME type, returning the detected MIME type."""
    if len(data) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File '{filename}' exceeds the 50 MB limit "
                f"({len(data) / 1024 / 1024:.1f} MB)."
            ),
        )

    mime_type = _detect_mime(data, filename)
    extension = Path(filename).suffix.lower().lstrip(".")
    
    # libmagic often misidentifies .md or .txt containing code snippets as text/x-python, text/x-c, etc.
    if mime_type.startswith("text/") and mime_type not in ALLOWED_MIME_TYPES:
        if extension == "md":
            mime_type = "text/markdown"
        elif extension == "txt":
            mime_type = "text/plain"

    if extension == "docx" and (
        mime_type in ZIP_CONTAINER_MIME_TYPES or zipfile.is_zipfile(BytesIO(data))
    ):
        mime_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File '{filename}' has unsupported type '{mime_type}'. "
                f"Allowed: {ALLOWED_EXTENSIONS_LABEL}."
            ),
        )
    return mime_type


async def save_uploads(
    job_id: str,
    uploads: list[UploadFile],
    input_dir: Path,
) -> list[Path]:
    """Validate total job size, then save all uploads in order."""
    staged_files: list[tuple[UploadFile, bytes]] = []
    total_size = 0

    for upload in uploads:
        data = await upload.read()
        total_size += len(data)
        staged_files.append((upload, data))

    if total_size > MAX_JOB_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Total upload size {total_size / 1024 / 1024:.1f} MB exceeds "
                f"the 200 MB per-job limit."
            ),
        )

    saved_paths: list[Path] = []
    for index, (upload, data) in enumerate(staged_files):
        safe_name = secure_filename(upload.filename or f"file_{index}") or f"file_{index}"
        mime_type = _validate_file(safe_name, data)
        extension = _canonical_extension(safe_name, mime_type)
        stem = Path(safe_name).stem or f"file_{index}"
        destination = input_dir / f"{index}_{stem}.{extension}"
        destination.write_bytes(data)
        logger.info(
            "saved upload: job=%s file=%s size=%d mime=%s",
            job_id,
            destination.name,
            len(data),
            mime_type,
        )
        saved_paths.append(destination)

    return saved_paths


def cleanup_job(job_id: str) -> None:
    """Delete the entire job directory for a given job_id."""
    job_dir = TMP_BASE / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)
        logger.info("cleaned up job dir: %s", job_id)


def cleanup_expired_jobs() -> None:
    """Delete job directories older than the configured TTL."""
    if not TMP_BASE.exists():
        return

    now = datetime.now(timezone.utc).timestamp()
    ttl_seconds = JOB_TTL_MINUTES * 60

    from app.job_store import store

    for job_dir in TMP_BASE.iterdir():
        if not job_dir.is_dir():
            continue

        age_seconds = now - job_dir.stat().st_mtime
        if age_seconds > ttl_seconds:
            shutil.rmtree(job_dir, ignore_errors=True)
            store.delete(job_dir.name)
            logger.info("expired job dir removed: %s (age=%.0fs)", job_dir.name, age_seconds)
