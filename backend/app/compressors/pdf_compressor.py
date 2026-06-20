"""
PDF compression via ghostscript subprocess.

Ghostscript's -dPDFSETTINGS presets control image downsampling and
compression aggressiveness. We map three user-facing quality levels
to these presets.

System requirement: ghostscript must be installed.
  Windows: gswin64c.exe (64-bit) or gswin32c.exe (32-bit)
  Linux/Mac: gs
"""

import logging
import shutil
from pathlib import Path

from app.converters.utils import run_subprocess

logger = logging.getLogger("docforge.compressors.pdf")

# Ghostscript PDF settings presets per quality level
_GS_SETTINGS: dict[str, str] = {
    "low":    "/screen",    # ~72 dpi images, smallest file
    "medium": "/ebook",     # ~150 dpi images, balanced
    "high":   "/printer",   # ~300 dpi images, minimal loss
}


def _find_ghostscript() -> str:
    """
    Locate the ghostscript binary.
    Checks PATH and common Windows install directories.
    Raises RuntimeError if not found.
    """
    candidates = [
        "gswin64c",
        "gswin32c",
        "gs",
    ]

    # Check PATH first
    for name in candidates:
        found = shutil.which(name)
        if found:
            return found

    # Windows: scan C:\Program Files\gs\ for gswin64c.exe
    gs_root = Path(r"C:\Program Files\gs")
    if gs_root.exists():
        for exe in gs_root.rglob("gswin64c.exe"):
            return str(exe)
        for exe in gs_root.rglob("gswin32c.exe"):
            return str(exe)

    raise RuntimeError(
        "Ghostscript not found. Install it from https://www.ghostscript.com/download.html "
        "and ensure 'gswin64c' (Windows) or 'gs' (Linux/Mac) is on your PATH."
    )


def compress_pdf(
    input_file: Path,
    output_dir: Path,
    quality: str,
) -> Path:
    """
    Compress a PDF using ghostscript.

    Args:
        input_file: path to the source PDF
        output_dir: directory to write the compressed output
        quality: one of "low", "medium", "high"

    Returns:
        Path to the compressed PDF.

    Raises:
        ValueError: if quality level is invalid
        RuntimeError: if ghostscript is not found or fails
    """
    if quality not in _GS_SETTINGS:
        raise ValueError(
            f"Invalid quality '{quality}'. Choose from: low, medium, high."
        )

    gs = _find_ghostscript()
    pdf_setting = _GS_SETTINGS[quality]
    out = output_dir / f"{input_file.stem}_compressed.pdf"

    run_subprocess(
        [
            gs,
            "-sDEVICE=pdfwrite",
            "-dNOPAUSE",
            "-dBATCH",
            "-dSAFER",
            f"-dPDFSETTINGS={pdf_setting}",
            f"-sOutputFile={out}",
            str(input_file),
        ],
        context=f"PDF compress (quality={quality}) via ghostscript",
    )

    if not out.exists():
        raise RuntimeError(
            "Ghostscript ran but output file was not created. "
            "Check ghostscript installation."
        )

    # Edge case: ghostscript sometimes produces a larger file than input
    # (e.g. if the PDF is already highly compressed). Return the smaller one.
    if out.stat().st_size >= input_file.stat().st_size:
        logger.warning(
            "compress_pdf: output (%d bytes) is not smaller than input (%d bytes) "
            "— returning original file copy",
            out.stat().st_size,
            input_file.stat().st_size,
        )
        import shutil as _shutil
        original_copy = output_dir / f"{input_file.stem}_compressed.pdf"
        _shutil.copy2(input_file, original_copy)
        return original_copy

    logger.info(
        "compress_pdf: %s → %s (%.1f%% reduction)",
        input_file.name,
        out.name,
        (1 - out.stat().st_size / input_file.stat().st_size) * 100,
    )
    return out
