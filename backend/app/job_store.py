"""In-memory job store for DocForge.

Each job tracks: status, file paths, output, metadata, and timestamps.
No database in v1 - all state lives here and in /tmp/docforge/.
Jobs are keyed by UUID4 job_id strings.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from app.config import TMP_BASE


class JobStatus:
    """Lifecycle states for a DocForge job."""

    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    ERROR = "error"


@dataclass
class Job:
    """Single staged or processed job tracked in memory."""

    operation: str
    job_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: str = JobStatus.PENDING
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    input_dir: str = field(init=False)
    output_dir: str = field(init=False)
    input_files: list[str] = field(default_factory=list)
    output_file: str | None = None
    output_size: int | None = None
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.input_dir = str(TMP_BASE / self.job_id / "input")
        self.output_dir = str(TMP_BASE / self.job_id / "output")


class JobStore:
    """Thread-safe in-memory job registry."""

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = Lock()

    def create(self, operation: str) -> Job:
        """Create a new job, register it, and return it."""
        job = Job(operation=operation)
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
            job = self._jobs.get(job_id)
            if job is not None:
                job.status = status

    def set_output(self, job_id: str, output_path: str) -> None:
        """Record the output file path and size when processing completes."""
        from pathlib import Path

        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job.output_file = output_path
                job.output_size = Path(output_path).stat().st_size
                job.status = JobStatus.DONE

    def set_error(self, job_id: str, message: str) -> None:
        """Mark a job as failed with a human-readable error message."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job.status = JobStatus.ERROR
                job.error = message

    def delete(self, job_id: str) -> None:
        """Remove a job from the store."""
        with self._lock:
            self._jobs.pop(job_id, None)

    def all_jobs(self) -> list[Job]:
        """Return a snapshot of all jobs."""
        with self._lock:
            return list(self._jobs.values())


store = JobStore()
