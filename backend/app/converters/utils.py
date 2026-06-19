"""Shared utilities for DocForge converters."""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger("docforge.converters")


def run_subprocess(cmd: list[str], context: str) -> subprocess.CompletedProcess[str]:
    """Run a subprocess command and raise a clean error on failure."""
    logger.info("subprocess start: [%s] cmd=%s", context, " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        logger.error(
            "subprocess failed: [%s] returncode=%d stderr=%s",
            context,
            result.returncode,
            result.stderr[:500],
        )
        raise RuntimeError(
            f"{context} failed (exit {result.returncode}). "
            f"Details: {result.stderr[:200] or 'no stderr output'}"
        )
    logger.info("subprocess done: [%s]", context)
    return result


def output_path(output_dir: Path, stem: str, ext: str) -> Path:
    """Build a clean output file path."""
    return output_dir / f"{stem}.{ext}"
