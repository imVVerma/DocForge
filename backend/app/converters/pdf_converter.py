"""PDF to DOCX, TXT, and MD converters."""

from __future__ import annotations

import logging
from pathlib import Path

import pypdf
from pdf2docx import Converter as Pdf2DocxConverter

from app.converters.utils import output_path

logger = logging.getLogger("docforge.converters.pdf")


def pdf_to_docx(input_file: Path, output_dir: Path) -> Path:
    """Convert a PDF to DOCX using pdf2docx."""
    out = output_path(output_dir, input_file.stem, "docx")
    converter = Pdf2DocxConverter(str(input_file))
    try:
        converter.convert(str(out), start=0, end=None)
    finally:
        converter.close()
    logger.info("pdf→docx done: %s → %s", input_file.name, out.name)
    return out


def pdf_to_txt(input_file: Path, output_dir: Path) -> Path:
    """Extract plain text from a PDF using pypdf."""
    out = output_path(output_dir, input_file.stem, "txt")
    reader = pypdf.PdfReader(str(input_file))
    pages: list[str] = []
    for page in reader.pages:
        pages.append((page.extract_text() or "").strip())
    out.write_text("\n\n".join(pages), encoding="utf-8")
    logger.info("pdf→txt done: %s (%d pages)", input_file.name, len(pages))
    return out


def pdf_to_md(input_file: Path, output_dir: Path) -> Path:
    """Extract text from a PDF and wrap it in minimal Markdown."""
    out = output_path(output_dir, input_file.stem, "md")
    reader = pypdf.PdfReader(str(input_file))
    sections: list[str] = []
    for index, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        sections.append(f"## Page {index}\n\n{text}")
    out.write_text("\n\n---\n\n".join(sections), encoding="utf-8")
    logger.info("pdf→md done: %s (%d pages)", input_file.name, len(sections))
    return out
