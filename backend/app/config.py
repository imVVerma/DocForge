"""DocForge configuration constants.
All tunable values live here - never hardcode them in route handlers.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

# Base directory for all job temporary files
TMP_BASE: Path = Path(tempfile.gettempdir()) / "docforge"

# Per-file size limit: 50 MB
MAX_FILE_SIZE_BYTES: int = 50 * 1024 * 1024

# Per-job total size limit: 200 MB
MAX_JOB_SIZE_BYTES: int = 200 * 1024 * 1024

# Maximum number of files accepted by the upload staging endpoint
MAX_UPLOAD_FILES: int = 20

# Job TTL: delete job dirs older than this many minutes
JOB_TTL_MINUTES: int = 60

# Cleanup cron interval in minutes
CLEANUP_INTERVAL_MINUTES: int = 15

# Allowed MIME types mapped to canonical extension
ALLOWED_MIME_TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/x-markdown": "md",
    "image/png": "png",
    "image/jpeg": "jpg",
}

# Human-readable labels for error messages
ALLOWED_EXTENSIONS_LABEL: str = "PDF, DOCX, TXT, MD, PNG, JPG"
