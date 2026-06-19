"""
PDF merge — concatenate multiple PDFs into one using pypdf.
Pages are appended in the order the input_files list is provided.
"""

import logging
from pathlib import Path

from pypdf import PdfWriter

logger = logging.getLogger("docforge.mergers.pdf")


def merge_pdfs(input_files: list[Path], output_dir: Path) -> Path:
    """
    Merge a list of PDF files into a single PDF.

    Files are merged in the order given — the caller is responsible for
    passing them in the user's chosen order.

    Args:
        input_files: ordered list of PDF file paths
        output_dir: directory to write the merged output

    Returns:
        Path to the merged PDF file.

    Raises:
        ValueError: if fewer than 2 files are provided
        RuntimeError: if any input file cannot be read as a PDF
    """
    if len(input_files) < 2:
        raise ValueError("Merge requires at least 2 files.")

    writer = PdfWriter()

    for pdf_path in input_files:
        try:
            writer.append(str(pdf_path))
            logger.info("merge_pdfs: appended %s", pdf_path.name)
        except Exception as exc:
            raise RuntimeError(
                f"Could not read '{pdf_path.name}' as a PDF. "
                "The file may be corrupted or password-protected."
            ) from exc

    out = output_dir / "merged.pdf"
    with open(out, "wb") as f:
        writer.write(f)

    logger.info("merge_pdfs: wrote %s (%d files)", out.name, len(input_files))
    return out
