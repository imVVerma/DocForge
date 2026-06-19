"""TXT and MD converters to PDF, DOCX, MD, and TXT."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

import markdown as markdown_lib
from bs4 import BeautifulSoup
from docx import Document
from fpdf import FPDF

from app.converters.utils import output_path, run_subprocess

logger = logging.getLogger("docforge.converters.text")
PANDOC_CANDIDATES = [
    "pandoc",
    r"C:\Users\Vaibhav Verma\AppData\Local\Pandoc\pandoc.exe",
]

_PAGE_W = 170   # usable width in mm on A4 with 20mm margins
_LINE_H = 6     # line height in mm
_FONT_SIZE_BODY = 11
_FONT_SIZE_H1 = 18
_FONT_SIZE_H2 = 15
_FONT_SIZE_H3 = 13


def _safe(text: str) -> str:
    """Encode text to latin-1 replacing unmappable chars (fpdf2 core fonts are Latin-1)."""
    return text.encode("latin-1", errors="replace").decode("latin-1")


def _render_txt_pdf(text: str, output_path_value: Path) -> None:
    """Write plain text to a PDF using fpdf2 (pure Python, no native deps)."""
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.set_margins(20, 20, 20)
    pdf.add_page()
    pdf.set_font("Helvetica", size=_FONT_SIZE_BODY)
    for line in text.splitlines():
        pdf.multi_cell(_PAGE_W, _LINE_H, _safe(line))
    pdf.output(str(output_path_value))


def _render_md_pdf(html_body: str, output_path_value: Path) -> None:
    """Render markdown (as parsed HTML soup) to a PDF with basic heading/code styling."""
    soup = BeautifulSoup(html_body, "html.parser")
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.set_margins(20, 20, 20)
    pdf.add_page()

    for tag in soup.children:
        name = getattr(tag, "name", None)
        text = tag.get_text()
        if not text.strip():
            continue

        if name == "h1":
            pdf.set_font("Helvetica", style="B", size=_FONT_SIZE_H1)
            pdf.multi_cell(_PAGE_W, 9, _safe(text.strip()))
            pdf.ln(2)
        elif name == "h2":
            pdf.set_font("Helvetica", style="B", size=_FONT_SIZE_H2)
            pdf.multi_cell(_PAGE_W, 8, _safe(text.strip()))
            pdf.ln(1)
        elif name == "h3":
            pdf.set_font("Helvetica", style="B", size=_FONT_SIZE_H3)
            pdf.multi_cell(_PAGE_W, 7, _safe(text.strip()))
        elif name in ("pre", "code"):
            pdf.set_font("Courier", size=10)
            for line in text.splitlines():
                pdf.multi_cell(_PAGE_W, _LINE_H, _safe(line))
            pdf.ln(2)
        elif name == "hr":
            pdf.ln(2)
        else:
            pdf.set_font("Helvetica", size=_FONT_SIZE_BODY)
            pdf.multi_cell(_PAGE_W, _LINE_H, _safe(text.strip()))
            pdf.ln(1)

    pdf.output(str(output_path_value))


def _find_pandoc() -> str:
    """Locate the Pandoc binary."""
    for candidate in PANDOC_CANDIDATES:
        if shutil.which(candidate):
            return candidate
        path_candidate = Path(candidate)
        if path_candidate.exists():
            return str(path_candidate)
    raise RuntimeError(
        "Pandoc not found. Install it from https://pandoc.org/installing.html "
        "and ensure 'pandoc' is on your PATH."
    )


def txt_to_pdf(input_file: Path, output_dir: Path) -> Path:
    """Convert plain text to PDF using fpdf2 (pure Python, no native deps)."""
    out = output_path(output_dir, input_file.stem, "pdf")
    text = input_file.read_text(encoding="utf-8", errors="replace")
    _render_txt_pdf(text, out)
    logger.info("txt→pdf done: %s", input_file.name)
    return out


def txt_to_md(input_file: Path, output_dir: Path) -> Path:
    """Copy TXT as Markdown without changing the content."""
    out = output_path(output_dir, input_file.stem, "md")
    out.write_bytes(input_file.read_bytes())
    logger.info("txt→md done: %s", input_file.name)
    return out


def txt_to_docx(input_file: Path, output_dir: Path) -> Path:
    """Convert plain text to DOCX."""
    out = output_path(output_dir, input_file.stem, "docx")
    text = input_file.read_text(encoding="utf-8", errors="replace")
    document = Document()
    for line in text.splitlines():
        document.add_paragraph(line)
    document.save(str(out))
    logger.info("txt→docx done: %s", input_file.name)
    return out


def md_to_pdf(input_file: Path, output_dir: Path) -> Path:
    """Convert Markdown to PDF via HTML parsing and fpdf2 (pure Python, no native deps)."""
    out = output_path(output_dir, input_file.stem, "pdf")
    text = input_file.read_text(encoding="utf-8", errors="replace")
    body_html = markdown_lib.markdown(text, extensions=["tables", "fenced_code", "nl2br"])
    _render_md_pdf(body_html, out)
    logger.info("md→pdf done: %s", input_file.name)
    return out


def md_to_docx(input_file: Path, output_dir: Path) -> Path:
    """Convert Markdown to DOCX using pandoc."""
    out = output_path(output_dir, input_file.stem, "docx")
    pandoc = _find_pandoc()
    run_subprocess([pandoc, str(input_file), "-o", str(out)], context="MD→DOCX via pandoc")
    logger.info("md→docx done: %s", input_file.name)
    return out


def md_to_txt(input_file: Path, output_dir: Path) -> Path:
    """Convert Markdown to plain text by stripping HTML tags from rendered HTML."""
    out = output_path(output_dir, input_file.stem, "txt")
    text = input_file.read_text(encoding="utf-8", errors="replace")
    rendered = markdown_lib.markdown(text, extensions=["tables", "fenced_code", "nl2br"])
    soup = BeautifulSoup(rendered, "html.parser")
    plain_text = soup.get_text(separator="\n")
    out.write_text(plain_text.strip(), encoding="utf-8")
    logger.info("md→txt done: %s", input_file.name)
    return out
