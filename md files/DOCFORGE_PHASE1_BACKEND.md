# DocForge — Phase 1 Backend Build Prompt
## Steps 1.2b → 1.2d: Upload Handler · Job Store · /tmp Manager · Download Endpoint

> Hand this entire file to Antigravity / Codex as a single prompt.
> Complete steps in order. Do not skip ahead. Verify each step before proceeding.

---

## Context

You are building the backend for **DocForge**, a document processing platform (Merge · Compress · OCR · Convert). The FastAPI app scaffold already exists at `backend/app/main.py` and `backend/app/routes.py` with CORS wired up and a `/api/ping` health route working.

You are now implementing the **shared backend infrastructure** that every tool (Convert, Merge, Compress, OCR) will use:
- File upload handling with validation
- In-memory job store
- `/tmp/docforge/` filesystem manager
- Automatic cleanup (cron + on-download)
- File download endpoint

No document processing logic yet — that comes in Steps 1.3a–1.3e. This step is purely the plumbing.

---

## Mandatory Rules (read before touching any file)

1. Read every file before editing it. Never assume its current contents.
2. Use `async def` for all FastAPI route handlers.
3. Never use `os.system()`. Use `subprocess.run(capture_output=True, text=True)` only (not needed this step, but noted for later).
4. All file paths must use `pathlib.Path`. No raw string concatenation.
5. Never write uploaded files to the project directory. All file I/O goes under `/tmp/docforge/`.
6. Never expose raw Python tracebacks to the client. Always return `{"error": "human-readable message"}` with the correct HTTP status code.
7. Type-hint every function. Use Pydantic models for all request/response shapes.
8. Add a docstring to every route handler.
9. Every new library added must be appended to `backend/requirements.txt` immediately after installing it.
10. Never log file contents. Log only: job_id, operation, file sizes, status.

---

## Step 1 — Install new dependencies

Install the following into the backend virtual environment:

```bash
pip install python-magic werkzeug apscheduler
```

Add these three lines to `backend/requirements.txt` (preserve existing entries):
```
python-magic==0.4.27
werkzeug==3.0.3
apscheduler==3.10.4
```

> Note: `python-magic` requires the system library `libmagic`. On Windows it needs
> `python-magic-bin` instead. On Linux/Mac `libmagic` is usually pre-installed.
> If on Windows, install `python-magic-bin==0.4.14` instead of `python-magic`.

**Verify:** `python -c "import magic; import werkzeug; import apscheduler; print('OK')"` prints `OK`.

---

## Step 2 — Create `backend/app/config.py`

Create a new file `backend/app/config.py` with the following content exactly:

```python
"""
DocForge configuration constants.
All tunable values live here — never hardcode them in route handlers.
"""

from pathlib import Path

# Base directory for all job temporary files
TMP_BASE: Path = Path("/tmp/docforge")

# Per-file size limit: 50 MB
MAX_FILE_SIZE_BYTES: int = 50 * 1024 * 1024

# Per-job total size limit: 200 MB
MAX_JOB_SIZE_BYTES: int = 200 * 1024 * 1024

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
```

**Verify:** `python -c "from app.config import TMP_BASE; print(TMP_BASE)"` prints `/tmp/docforge`.

---

## Step 3 — Create `backend/app/job_store.py`

Create a new file `backend/app/job_store.py`:

```python
"""
In-memory job store for DocForge.

Each job tracks: status, file paths, output, metadata, and timestamps.
No database in v1 — all state lives here and in /tmp/docforge/.
Jobs are keyed by UUID4 job_id strings.
"""

import uuid
from datetime import datetime
from typing import Any
from threading import Lock

from app.config import TMP_BASE


# --------------------------------------------------------------------------- #
# Job lifecycle states
# --------------------------------------------------------------------------- #
class JobStatus:
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    ERROR = "error"


# --------------------------------------------------------------------------- #
# Job data structure
# --------------------------------------------------------------------------- #
class Job:
    def __init__(self, operation: str) -> None:
        self.job_id: str = str(uuid.uuid4())
        self.operation: str = operation          # "merge" | "compress" | "ocr" | "convert"
        self.status: str = JobStatus.PENDING
        self.created_at: datetime = datetime.utcnow()
        self.input_dir: str = str(TMP_BASE / self.job_id / "input")
        self.output_dir: str = str(TMP_BASE / self.job_id / "output")
        self.input_files: list[str] = []         # absolute paths
        self.output_file: str | None = None      # absolute path
        self.output_size: int | None = None      # bytes
        self.error: str | None = None
        self.metadata: dict[str, Any] = {}       # operation-specific extras


# --------------------------------------------------------------------------- #
# Thread-safe in-memory store
# --------------------------------------------------------------------------- #
class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = Lock()

    def create(self, operation: str) -> Job:
        """Create a new job, register it, and return it."""
        job = Job(operation)
        with self._lock:
            self._jobs[job.job_id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        """Return the job or None if not found."""
        with self._lock:
            return self._jobs.get(job_id)

    def update_status(self, job_id: str, status: str) -> None:
        """Update job status in place."""
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].status = status

    def set_error(self, job_id: str, message: str) -> None:
        """Mark a job as failed with a human-readable error message."""
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].status = JobStatus.ERROR
                self._jobs[job_id].error = message

    def set_output(self, job_id: str, output_path: str) -> None:
        """Record the output file path and size when processing completes."""
        from pathlib import Path
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].output_file = output_path
                self._jobs[job_id].output_size = Path(output_path).stat().st_size
                self._jobs[job_id].status = JobStatus.DONE

    def delete(self, job_id: str) -> None:
        """Remove a job from the store (called after download + cleanup)."""
        with self._lock:
            self._jobs.pop(job_id, None)

    def all_jobs(self) -> list[Job]:
        """Return a snapshot of all jobs (used by cleanup cron)."""
        with self._lock:
            return list(self._jobs.values())


# Module-level singleton — imported by routes and the cleanup scheduler
store = JobStore()
```

**Verify:** `python -c "from app.job_store import store; j = store.create('convert'); print(j.job_id)"` prints a UUID.

---

## Step 4 — Create `backend/app/file_manager.py`

Create a new file `backend/app/file_manager.py`:

```python
"""
DocForge filesystem manager.

Handles:
- Creating per-job directories under /tmp/docforge/
- Writing uploaded files to disk with sanitized names
- MIME type validation via libmagic (reads actual file bytes, not extension)
- File size enforcement
- Cleanup of job directories (called by cron and post-download)
"""

import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path

import magic
from werkzeug.utils import secure_filename
from fastapi import UploadFile, HTTPException

from app.config import (
    TMP_BASE,
    MAX_FILE_SIZE_BYTES,
    MAX_JOB_SIZE_BYTES,
    JOB_TTL_MINUTES,
    ALLOWED_MIME_TYPES,
    ALLOWED_EXTENSIONS_LABEL,
)

logger = logging.getLogger("docforge.file_manager")


# --------------------------------------------------------------------------- #
# Directory setup
# --------------------------------------------------------------------------- #

def ensure_tmp_base() -> None:
    """Create /tmp/docforge/ if it does not exist. Called on app startup."""
    TMP_BASE.mkdir(parents=True, exist_ok=True)
    logger.info("tmp base ready: %s", TMP_BASE)


def create_job_dirs(job_id: str) -> tuple[Path, Path]:
    """
    Create input/ and output/ directories for a job.
    Returns (input_dir, output_dir) as Path objects.
    """
    input_dir = TMP_BASE / job_id / "input"
    output_dir = TMP_BASE / job_id / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    return input_dir, output_dir


# --------------------------------------------------------------------------- #
# Upload validation and writing
# --------------------------------------------------------------------------- #

def _detect_mime(data: bytes) -> str:
    """Use libmagic to detect MIME type from file bytes."""
    return magic.from_buffer(data, mime=True)


def _validate_file(filename: str, data: bytes) -> str:
    """
    Validate a single file's size and MIME type.
    Returns the detected MIME type string.
    Raises HTTPException (400) on any validation failure.
    """
    if len(data) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File '{filename}' exceeds the 50 MB limit "
                   f"({len(data) / 1024 / 1024:.1f} MB).",
        )

    mime = _detect_mime(data)

    if mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"File '{filename}' has unsupported type '{mime}'. "
                   f"Allowed: {ALLOWED_EXTENSIONS_LABEL}.",
        )

    return mime


async def save_upload(
    upload: UploadFile,
    input_dir: Path,
    index: int,
) -> Path:
    """
    Read, validate, and write a single UploadFile to input_dir.
    Prefixes filename with index to preserve ordering (e.g. '0_report.pdf').
    Returns the absolute Path of the written file.
    """
    data = await upload.read()
    safe_name = secure_filename(upload.filename or f"file_{index}")
    mime = _validate_file(safe_name, data)

    # Use the MIME-detected extension, not the user-supplied one
    ext = ALLOWED_MIME_TYPES[mime]
    stem = Path(safe_name).stem
    dest = input_dir / f"{index}_{stem}.{ext}"

    dest.write_bytes(data)
    logger.info(
        "saved upload: job_dir=%s file=%s size=%d mime=%s",
        input_dir.parent.name, dest.name, len(data), mime,
    )
    return dest


async def save_uploads(
    uploads: list[UploadFile],
    input_dir: Path,
) -> list[Path]:
    """
    Validate total job size, then save all uploads in order.
    Returns list of saved file Paths in original order.
    Raises HTTPException (400) if total size exceeds 200 MB.
    """
    # Read all files first to check total size before writing anything
    file_data: list[tuple[UploadFile, bytes]] = []
    total = 0
    for upload in uploads:
        data = await upload.read()
        total += len(data)
        file_data.append((upload, data))

    if total > MAX_JOB_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Total upload size {total / 1024 / 1024:.1f} MB exceeds "
                   f"the 200 MB per-job limit.",
        )

    saved: list[Path] = []
    for i, (upload, data) in enumerate(file_data):
        safe_name = secure_filename(upload.filename or f"file_{i}")
        mime = _validate_file(safe_name, data)
        ext = ALLOWED_MIME_TYPES[mime]
        stem = Path(safe_name).stem
        dest = input_dir / f"{i}_{stem}.{ext}"
        dest.write_bytes(data)
        logger.info(
            "saved upload: job=%s file=%s size=%d mime=%s",
            input_dir.parent.name, dest.name, len(data), mime,
        )
        saved.append(dest)

    return saved


# --------------------------------------------------------------------------- #
# Cleanup
# --------------------------------------------------------------------------- #

def cleanup_job(job_id: str) -> None:
    """
    Delete the entire job directory for a given job_id.
    Safe to call even if the directory no longer exists.
    """
    job_dir = TMP_BASE / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)
        logger.info("cleaned up job dir: %s", job_id)


def cleanup_expired_jobs() -> None:
    """
    Cron target: scan /tmp/docforge/ and delete any job directory
    whose mtime is older than JOB_TTL_MINUTES minutes.
    Called every CLEANUP_INTERVAL_MINUTES by APScheduler.
    """
    if not TMP_BASE.exists():
        return

    now = datetime.now(tz=timezone.utc).timestamp()
    ttl_seconds = JOB_TTL_MINUTES * 60

    for job_dir in TMP_BASE.iterdir():
        if not job_dir.is_dir():
            continue
        age = now - job_dir.stat().st_mtime
        if age > ttl_seconds:
            shutil.rmtree(job_dir, ignore_errors=True)
            logger.info("expired job dir removed: %s (age=%.0fs)", job_dir.name, age)
```

**Verify:** `python -c "from app.file_manager import ensure_tmp_base; ensure_tmp_base(); print('OK')"` creates `/tmp/docforge/` and prints `OK`.

---

## Step 5 — Create `backend/app/schemas.py`

Create a new file `backend/app/schemas.py` with Pydantic response models:

```python
"""
Pydantic response schemas for DocForge API.
All route handlers return one of these models — never raw dicts.
"""

from pydantic import BaseModel
from typing import Any


class JobCreatedResponse(BaseModel):
    """Returned immediately when a job is accepted and queued."""
    job_id: str
    status: str


class JobResultResponse(BaseModel):
    """Returned when a job completes successfully."""
    job_id: str
    status: str
    download_url: str
    output_size: int                    # bytes
    metadata: dict[str, Any] = {}      # operation-specific (reduction %, confidence, etc.)


class ErrorResponse(BaseModel):
    """Returned on any error."""
    error: str


class HealthResponse(BaseModel):
    """Returned by /api/ping."""
    status: str
    tmp_base_exists: bool
```

---

## Step 6 — Update `backend/app/main.py`

Read `backend/app/main.py` first. Then make the following additions without removing anything that already works:

1. Import and call `ensure_tmp_base()` on startup.
2. Start the APScheduler cron for `cleanup_expired_jobs`.
3. Update the `/api/ping` handler to use `HealthResponse`.

The lifespan block should look like this (adapt to whatever startup pattern already exists in the file):

```python
from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler

from app.file_manager import ensure_tmp_base, cleanup_expired_jobs
from app.schemas import HealthResponse
from app.config import CLEANUP_INTERVAL_MINUTES

scheduler = BackgroundScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    ensure_tmp_base()
    scheduler.add_job(
        cleanup_expired_jobs,
        "interval",
        minutes=CLEANUP_INTERVAL_MINUTES,
        id="cleanup_cron",
    )
    scheduler.start()
    yield
    # Shutdown
    scheduler.shutdown(wait=False)

app = FastAPI(title="DocForge API", lifespan=lifespan)
```

Update the `/api/ping` route to return a `HealthResponse`:

```python
@app.get("/api/ping", response_model=HealthResponse)
async def ping():
    """Health check. Confirms the API is running and /tmp/docforge/ exists."""
    from pathlib import Path
    from app.config import TMP_BASE
    return HealthResponse(status="ok", tmp_base_exists=TMP_BASE.exists())
```

**Verify:** `uvicorn app.main:app --reload` starts without errors. `GET /api/ping` returns:
```json
{ "status": "ok", "tmp_base_exists": true }
```

---

## Step 7 — Create `backend/app/routers/upload.py`

Create the directory `backend/app/routers/` with an empty `__init__.py`, then create `backend/app/routers/upload.py`:

```python
"""
/api/upload — shared multi-file upload endpoint.

Accepts 1–20 files, validates each, writes them to a job directory,
and returns a job_id for use in subsequent processing calls.

This endpoint does NOT trigger processing. It is used to pre-stage files
before calling /api/convert, /api/merge, etc. This keeps processing routes
clean and allows the frontend to show upload progress separately.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse

from app.job_store import store, JobStatus
from app.file_manager import create_job_dirs, save_uploads
from app.schemas import JobCreatedResponse, ErrorResponse

logger = logging.getLogger("docforge.upload")

router = APIRouter(prefix="/api", tags=["upload"])


@router.post(
    "/upload",
    response_model=JobCreatedResponse,
    responses={400: {"model": ErrorResponse}},
)
async def upload_files(
    files: Annotated[list[UploadFile], File(description="1–20 document files")],
) -> JobCreatedResponse:
    """
    Stage files for processing.

    Accepts 1–20 files (PDF, DOCX, TXT, MD, PNG, JPG).
    Validates MIME type and size for each file.
    Writes files to /tmp/docforge/{job_id}/input/ in order.
    Returns job_id to be passed to a processing endpoint.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")
    if len(files) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 files per job.")

    job = store.create("upload")
    input_dir, _ = create_job_dirs(job.job_id)

    try:
        saved = await save_uploads(files, input_dir)
        job.input_files = [str(p) for p in saved]
        store.update_status(job.job_id, JobStatus.PENDING)
        logger.info("upload complete: job=%s files=%d", job.job_id, len(saved))
    except HTTPException:
        store.set_error(job.job_id, "Upload validation failed.")
        raise
    except Exception as exc:
        logger.exception("unexpected upload error: job=%s", job.job_id)
        store.set_error(job.job_id, "Upload failed due to a server error.")
        raise HTTPException(status_code=500, detail="Upload failed. Please try again.") from exc

    return JobCreatedResponse(job_id=job.job_id, status=job.status)
```

---

## Step 8 — Create `backend/app/routers/download.py`

Create `backend/app/routers/download.py`:

```python
"""
/api/download/{job_id} — stream the processed output file to the client.
/api/cleanup/{job_id}  — delete job directory and remove job from store.

Download automatically triggers cleanup after the response is sent.
The separate /api/cleanup endpoint exists for manual or error-path cleanup.
"""

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from app.job_store import store, JobStatus
from app.file_manager import cleanup_job
from app.schemas import ErrorResponse

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
    """
    Stream the processed output file for a completed job.

    Returns the file as an attachment with Content-Disposition set.
    Schedules job directory cleanup after the response is sent.
    Returns 404 if job not found, 409 if job is not yet complete.
    """
    job = store.get(job_id)

    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    if job.status == JobStatus.ERROR:
        raise HTTPException(
            status_code=409,
            detail=job.error or "Job failed. Please try again.",
        )

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
    filename = output_path.name

    logger.info("download: job=%s file=%s size=%d", job_id, filename, job.output_size or 0)

    # Background cleanup: remove files and job from store after response
    async def _cleanup_background() -> None:
        cleanup_job(job_id)
        store.delete(job_id)
        logger.info("post-download cleanup done: job=%s", job_id)

    return FileResponse(
        path=str(output_path),
        filename=filename,
        media_type="application/octet-stream",
        background=None,   # replaced below after we confirm FileResponse supports it
    )


@router.delete(
    "/cleanup/{job_id}",
    responses={404: {"model": ErrorResponse}},
)
async def cleanup_job_endpoint(job_id: str) -> JSONResponse:
    """
    Manually delete a job's files and remove it from the store.

    Called by the frontend after a successful download, or on error/cancel.
    Safe to call even if files are already gone.
    """
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    cleanup_job(job_id)
    store.delete(job_id)
    logger.info("manual cleanup: job=%s", job_id)

    return JSONResponse(content={"success": True, "job_id": job_id})
```

> Important note on download cleanup: FastAPI's `FileResponse` does not natively call a
> background coroutine after streaming. Use Starlette's `BackgroundTask` instead.
> Update the return statement in `download_file` to:
>
> ```python
> from starlette.background import BackgroundTask
>
> def _sync_cleanup() -> None:
>     cleanup_job(job_id)
>     store.delete(job_id)
>     logger.info("post-download cleanup done: job=%s", job_id)
>
> return FileResponse(
>     path=str(output_path),
>     filename=filename,
>     media_type="application/octet-stream",
>     background=BackgroundTask(_sync_cleanup),
> )
> ```

---

## Step 9 — Register routers in `backend/app/routes.py`

Read `backend/app/routes.py` first. Then add the two new routers to it:

```python
from app.routers.upload import router as upload_router
from app.routers.download import router as download_router

# Register with the main app — add these lines alongside any existing router includes
app.include_router(upload_router)
app.include_router(download_router)
```

If `routes.py` does not call `app.include_router` but instead defines routes directly, move the router registration to `main.py` instead. Read both files and choose the pattern that is already in use.

---

## Step 10 — Smoke test the full upload → download round trip

Start the server:
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Run the following curl commands in order:

**Test 1 — Health check**
```bash
curl http://localhost:8000/api/ping
# Expected: {"status":"ok","tmp_base_exists":true}
```

**Test 2 — Valid upload**
```bash
curl -X POST http://localhost:8000/api/upload \
  -F "files=@/path/to/any/test.pdf" \
  | python -m json.tool
# Expected: {"job_id": "<uuid>", "status": "pending"}
# Also check: ls /tmp/docforge/<job_id>/input/ shows the file
```

**Test 3 — Oversized file rejection**
Create a dummy file > 50 MB and upload it:
```bash
dd if=/dev/zero of=/tmp/big_test.bin bs=1M count=55
curl -X POST http://localhost:8000/api/upload \
  -F "files=@/tmp/big_test.bin"
# Expected: 400 with {"detail": "...exceeds the 50 MB limit..."}
```

**Test 4 — Invalid MIME type rejection**
```bash
curl -X POST http://localhost:8000/api/upload \
  -F "files=@/path/to/any/image.gif"
# Expected: 400 with {"detail": "...unsupported type..."}
```

**Test 5 — Download a non-existent job**
```bash
curl http://localhost:8000/api/download/fake-job-id
# Expected: 404 with {"detail": "Job 'fake-job-id' not found."}
```

**Test 6 — Manual cleanup**
Use the job_id from Test 2:
```bash
curl -X DELETE http://localhost:8000/api/cleanup/<job_id_from_test2>
# Expected: {"success": true, "job_id": "<uuid>"}
# Also check: ls /tmp/docforge/ — the job directory should be gone
```

---

## Verification Checklist

Before marking Steps 1.2b–1.2d as done, confirm every item:

- [ ] `python -c "import magic; import werkzeug; import apscheduler"` succeeds
- [ ] `/tmp/docforge/` is created automatically on server start
- [ ] `GET /api/ping` returns `{"status":"ok","tmp_base_exists":true}`
- [ ] Uploading a valid PDF creates `/tmp/docforge/{job_id}/input/0_*.pdf`
- [ ] Uploading a file > 50 MB returns HTTP 400
- [ ] Uploading a `.gif` or `.mp4` returns HTTP 400 (MIME check, not extension check)
- [ ] `GET /api/download/{fake_id}` returns HTTP 404
- [ ] `DELETE /api/cleanup/{job_id}` removes the directory from `/tmp/docforge/`
- [ ] Server logs show job IDs and file sizes but zero file content
- [ ] `requirements.txt` includes `python-magic`, `werkzeug`, `apscheduler`
- [ ] No raw Python tracebacks visible in any API response
- [ ] APScheduler cron job is registered and visible in startup logs

---

## Files created / modified this step

```
backend/
├── requirements.txt              ← updated (3 new packages)
├── app/
│   ├── main.py                   ← updated (lifespan, scheduler, HealthResponse)
│   ├── routes.py                 ← updated (include upload + download routers)
│   ├── config.py                 ← NEW
│   ├── job_store.py              ← NEW
│   ├── file_manager.py           ← NEW
│   ├── schemas.py                ← NEW
│   └── routers/
│       ├── __init__.py           ← NEW (empty)
│       ├── upload.py             ← NEW
│       └── download.py           ← NEW
```

---

## Tracker update

After all checklist items pass, update `DOCFORGE_MASTER.md` tracker:

| Task | New status |
|------|-----------|
| 1.2b File upload handler + validation | ✅ Done |
| 1.2c Job store + /tmp manager + cleanup cron | ✅ Done |
| 1.2d Download endpoint | ✅ Done |

---

*Next step after this: Step 1.3a — PDF → DOCX / TXT / MD conversion logic.*
