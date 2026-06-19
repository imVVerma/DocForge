"""Pydantic response schemas for DocForge API.
All route handlers return one of these models - never raw dicts.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class JobCreatedResponse(BaseModel):
    """Returned immediately when a job is accepted and staged."""

    job_id: str
    status: str
    input_filenames: list[str] = Field(
        default_factory=list,
        description="Actual stored filenames (basename only), in upload order.",
    )


class JobResultResponse(BaseModel):
    """Returned when a job completes successfully."""

    job_id: str
    status: str
    download_url: str
    output_size: int
    metadata: dict[str, Any] = Field(default_factory=dict)


class CleanupResponse(BaseModel):
    """Returned when a job is manually cleaned up."""

    success: bool
    job_id: str


class ErrorResponse(BaseModel):
    """Returned on any error."""

    error: str


class HealthResponse(BaseModel):
    """Returned by /api/ping."""

    status: str
    tmp_base_exists: bool
