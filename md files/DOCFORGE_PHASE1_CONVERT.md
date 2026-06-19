# DocForge — Phase 1 Backend Build Prompt
## Steps 1.3a → 1.3e: Convert Tool — All Processing Logic + `/api/convert` Route

> Hand this entire file to Antigravity / Codex as a single prompt.
> Complete steps in order. Do not skip ahead. Verify each step before proceeding.

---

## Context

Backend plumbing is complete:
- `app/config.py` — constants (TMP_BASE, size limits, MIME map)
- `app/job_store.py` — in-memory job store singleton (`store`)
- `app/file_manager.py` — upload validation, save_uploads, create_job_dirs, cleanup_job
- `app/schemas.py` — Pydantic response models
- `app/routers/upload.py` — `POST /api/upload` (stages files, returns job_id)
- `app/routers/download.py` — `GET /api/download/{job_id}`, `DELETE /api/cleanup/{job_id}`

You are now implementing the **Convert tool** — the first end-to-end working feature.

The Convert tool accepts a pre-staged `job_id` (from `POST /api/upload`) plus a
`target_format` string, runs the appropriate conversion, and makes the output available
via the existing download endpoint.

---

## Conversion Matrix (implement all of these)

| From | To | Library / method |
|------|----|-----------------|
| PDF  | DOCX | `pdf2docx` |
| PDF  | TXT  | `pypdf` (extract text per page) |
| PDF  | MD   | `pypdf` + light markdown formatting |
| DOCX | PDF  | LibreOffice headless (`soffice --headless --convert-to pdf`) |
| DOCX | TXT  | `python-docx` (iterate paragraphs) |
| DOCX | MD   | `python-docx` + `markdownify` |
| TXT  | PDF  | `WeasyPrint` (wrap in minimal HTML, render to PDF) |
| TXT  | MD   | direct text copy (add no formatting — user's text is preserved as-is) |
| TXT  | DOCX | `python-docx` (create doc, add paragraphs) |
| MD   | PDF  | `markdown` lib → HTML → `WeasyPrint` |
| MD   | DOCX | `pandoc` subprocess (`pandoc input.md -o output.docx`) |
| MD   | TXT  | `markdown` lib → `BeautifulSoup` strip tags → plain text |
| PNG  | PDF  | `Pillow` (`Image.save(..., "PDF")`) |
| JPG  | PDF  | `Pillow` (`Image.save(..., "PDF")`) |

Batch convert: up to 10 files, each converted independently, output zipped into a
single archive if more than 1 file. If exactly 1 file, return the converted file directly.

---

## Mandatory Rules (inherited from master doc — re-read before touching any file)

1. Read every existing file before editing it.
2. `async def` for all FastAPI route handlers.
3. No `os.system()` — use `subprocess.run(capture_output=True, text=True, check=False)`.
4. All paths via `pathlib.Path`. No string concatenation for paths.
5. Every subprocess call checks `returncode` and logs `stderr` on failure.
6. Files go to `TMP_BASE / job_id / ...` only. Never write to the project directory.
7. Never expose raw Python tracebacks. Return `{"error": "human-readable"}` + correct HTTP status.
8. Type-hint every function. Pydantic models for all request/response shapes.
9. Docstring on every route handler.
10. New libraries → `requirements.txt` immediately after installing.

---

## Step 1 — Install processing libraries

```bash
pip install pypdf pdf2docx python-docx markdownify weasyprint markdown \
            beautifulsoup4 Pillow
```

Add to `backend/requirements.txt` (preserve all existing entries):
```
pypdf==4.3.1
pdf2docx==0.5.8
python-docx==1.1.2
markdownify==0.13.1
weasyprint==62.3
markdown==3.6
beautifulsoup4==4.12.3
Pillow==10.4.0
```

> `pandoc` and `libreoffice` are system binaries — confirm they are installed:
> ```bash
> pandoc --version
> soffice --version   # or libreoffice --version
> ```
> If either is missing, install it now before proceeding:
> - Windows: download Pandoc from https://pandoc.org/installing.html
>             download LibreOffice from https://www.libreoffice.org/download/
> - Linux: `sudo apt install pandoc libreoffice`
> - Mac: `brew install pandoc` + LibreOffice DMG

**Verify:**
```bash
python -c "import pypdf, pdf2docx, docx, markdownify, weasyprint, markdown, bs4, PIL; print('OK')"
```

---

## Step 2 — Create `backend/app/converters/__init__.py`

Create the directory `backend/app/converters/` with an empty `__init__.py`.

This package will hold one module per conversion direction. Keeping them separate makes
it easy to add new converters without touching existing ones.

---

## Step 3 — Create `backend/app/converters/utils.py`

Create `backend/app/converters/utils.py`:

```python
"""
Shared utilities for all converter modules.
"""

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger("docforge.converters")


def run_subprocess(cmd: list[str], context: str) -> subprocess.CompletedProcess:
    """
    Run a subprocess command and return the result.
    Logs stderr and raises RuntimeError if returncode is non-zero.

    Args:
        cmd: Command list passed to subprocess.run.
        context: Human-readable label for log messages (e.g. "DOCX→PDF via LibreOffice").

    Raises:
        RuntimeError: with a clean message if the process fails.
    """
    logger.info("subprocess start: [%s] cmd=%s", context, " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)

    if result.returncode != 0:
        logger.error(
            "subprocess failed: [%s] returncode=%d stderr=%s",
            context, result.returncode, result.stderr[:500],
        )
        raise RuntimeError(
            f"{context} failed (exit {result.returncode}). "
            f"Details: {result.stderr[:200] or 'no stderr output'}"
        )

    logger.info("subprocess done: [%s]", context)
    return result


def output_path(output_dir: Path, stem: str, ext: str) -> Path:
    """
    Build a clean output file path.
    Example: output_path(dir, "report", "pdf") → dir/report.pdf
    """
    return output_dir / f"{stem}.{ext}"
```

---

## Step 4 — Create `backend/app/converters/pdf_converter.py`

```python
"""
PDF → DOCX, TXT, MD converters.
"""

import logging
from pathlib import Path

from pdf2docx import Converter as Pdf2DocxConverter
import pypdf

from app.converters.utils import output_path

logger = logging.getLogger("docforge.converters.pdf")


def pdf_to_docx(input_file: Path, output_dir: Path) -> Path:
    """
    Convert a PDF to DOCX using pdf2docx.
    Preserves layout where possible. Complex PDFs (scanned, heavy tables)
    may have imperfect fidelity — that is expected.

    Returns the path of the output .docx file.
    """
    out = output_path(output_dir, input_file.stem, "docx")
    cv = Pdf2DocxConverter(str(input_file))
    try:
        cv.convert(str(out), start=0, end=None)
    finally:
        cv.close()
    logger.info("pdf→docx done: %s → %s", input_file.name, out.name)
    return out


def pdf_to_txt(input_file: Path, output_dir: Path) -> Path:
    """
    Extract plain text from a PDF using pypdf.
    Pages are separated by a blank line. Scanned PDFs will produce empty output
    (use OCR tool for those).

    Returns the path of the output .txt file.
    """
    out = output_path(output_dir, input_file.stem, "txt")
    reader = pypdf.PdfReader(str(input_file))
    pages: list[str] = []

    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        pages.append(text.strip())

    out.write_text("\n\n".join(pages), encoding="utf-8")
    logger.info("pdf→txt done: %s (%d pages)", input_file.name, len(pages))
    return out


def pdf_to_md(input_file: Path, output_dir: Path) -> Path:
    """
    Extract text from a PDF and wrap it in minimal Markdown.
    Each page becomes an H2 heading followed by the page text.

    Returns the path of the output .md file.
    """
    out = output_path(output_dir, input_file.stem, "md")
    reader = pypdf.PdfReader(str(input_file))
    sections: list[str] = []

    for i, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        sections.append(f"## Page {i}\n\n{text}")

    out.write_text("\n\n---\n\n".join(sections), encoding="utf-8")
    logger.info("pdf→md done: %s (%d pages)", input_file.name, len(sections))
    return out
```

---

## Step 5 — Create `backend/app/converters/docx_converter.py`

```python
"""
DOCX → PDF, TXT, MD converters.
"""

import logging
import shutil
from pathlib import Path

import docx
from markdownify import markdownify as md_from_html

from app.converters.utils import output_path, run_subprocess

logger = logging.getLogger("docforge.converters.docx")


def _find_soffice() -> str:
    """
    Locate the LibreOffice / soffice binary.
    Checks common install paths on Windows, Mac, and Linux.
    Raises RuntimeError if not found.
    """
    candidates = [
        "soffice",
        "libreoffice",
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/usr/bin/soffice",
        "/usr/bin/libreoffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ]
    for candidate in candidates:
        if shutil.which(candidate):
            return candidate
        p = Path(candidate)
        if p.exists():
            return str(p)
    raise RuntimeError(
        "LibreOffice not found. Install it from https://www.libreoffice.org/download/ "
        "and ensure 'soffice' is on your PATH."
    )


def docx_to_pdf(input_file: Path, output_dir: Path) -> Path:
    """
    Convert a DOCX to PDF using LibreOffice headless.
    LibreOffice writes its output to the same directory as the input file,
    so we convert in the output_dir after copying the input there.

    Returns the path of the output .pdf file.
    """
    soffice = _find_soffice()

    # LibreOffice writes output next to the input — copy input to output_dir first
    input_copy = output_dir / input_file.name
    shutil.copy2(input_file, input_copy)

    run_subprocess(
        [soffice, "--headless", "--convert-to", "pdf", "--outdir",
         str(output_dir), str(input_copy)],
        context="DOCX→PDF via LibreOffice",
    )

    # Remove the copied input; the PDF should now exist
    input_copy.unlink(missing_ok=True)

    out = output_path(output_dir, input_file.stem, "pdf")
    if not out.exists():
        raise RuntimeError(
            f"LibreOffice ran but output PDF not found at {out}. "
            "Check LibreOffice installation."
        )
    logger.info("docx→pdf done: %s → %s", input_file.name, out.name)
    return out


def docx_to_txt(input_file: Path, output_dir: Path) -> Path:
    """
    Extract plain text from a DOCX by iterating paragraphs.
    Preserves paragraph breaks. Tables are flattened row-by-row.

    Returns the path of the output .txt file.
    """
    out = output_path(output_dir, input_file.stem, "txt")
    doc = docx.Document(str(input_file))
    lines: list[str] = []

    for para in doc.paragraphs:
        lines.append(para.text)

    # Also extract table cell text
    for table in doc.tables:
        for row in table.rows:
            row_text = "\t".join(cell.text for cell in row.cells)
            lines.append(row_text)

    out.write_text("\n".join(lines), encoding="utf-8")
    logger.info("docx→txt done: %s", input_file.name)
    return out


def docx_to_md(input_file: Path, output_dir: Path) -> Path:
    """
    Convert DOCX to Markdown.
    Strategy: extract paragraphs with their style, map Heading 1/2/3 to
    # / ## / ###, bold runs to **text**, italic to *text*.
    Tables are converted to GFM pipe tables.

    Returns the path of the output .md file.
    """
    out = output_path(output_dir, input_file.stem, "md")
    doc = docx.Document(str(input_file))
    md_lines: list[str] = []

    heading_map = {
        "Heading 1": "#",
        "Heading 2": "##",
        "Heading 3": "###",
        "Heading 4": "####",
    }

    for para in doc.paragraphs:
        style_name = para.style.name if para.style else "Normal"
        text = para.text.strip()

        if not text:
            md_lines.append("")
            continue

        if style_name in heading_map:
            md_lines.append(f"{heading_map[style_name]} {text}")
        else:
            # Reconstruct inline formatting from runs
            inline = ""
            for run in para.runs:
                run_text = run.text
                if run.bold and run.italic:
                    inline += f"***{run_text}***"
                elif run.bold:
                    inline += f"**{run_text}**"
                elif run.italic:
                    inline += f"*{run_text}*"
                else:
                    inline += run_text
            md_lines.append(inline)

    # Tables → GFM
    for table in doc.tables:
        if not table.rows:
            continue
        header = "| " + " | ".join(c.text for c in table.rows[0].cells) + " |"
        separator = "| " + " | ".join("---" for _ in table.rows[0].cells) + " |"
        md_lines.append(header)
        md_lines.append(separator)
        for row in table.rows[1:]:
            md_lines.append("| " + " | ".join(c.text for c in row.cells) + " |")
        md_lines.append("")

    out.write_text("\n".join(md_lines), encoding="utf-8")
    logger.info("docx→md done: %s", input_file.name)
    return out
```

---

## Step 6 — Create `backend/app/converters/text_converter.py`

```python
"""
TXT and MD converters → PDF, DOCX, MD, TXT.
"""

import logging
from pathlib import Path

import markdown as md_lib
from bs4 import BeautifulSoup
import docx as python_docx
from weasyprint import HTML as WeasyprintHTML

from app.converters.utils import output_path, run_subprocess

logger = logging.getLogger("docforge.converters.text")


# Minimal CSS for WeasyPrint PDF output — readable, clean, no dependencies
_WEASYPRINT_CSS = """
@page { margin: 2cm; }
body {
    font-family: Georgia, serif;
    font-size: 12pt;
    line-height: 1.7;
    color: #111;
}
h1, h2, h3, h4 { font-family: Arial, sans-serif; margin-top: 1.4em; }
h1 { font-size: 20pt; }
h2 { font-size: 16pt; }
h3 { font-size: 13pt; }
pre, code {
    font-family: 'Courier New', monospace;
    background: #f4f4f4;
    padding: 2px 4px;
    border-radius: 3px;
}
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #ccc; padding: 6px 10px; }
th { background: #f0f0f0; }
"""


def txt_to_pdf(input_file: Path, output_dir: Path) -> Path:
    """
    Convert a plain text file to PDF via WeasyPrint.
    Wraps the text in a minimal HTML shell. Line breaks are preserved.

    Returns the path of the output .pdf file.
    """
    out = output_path(output_dir, input_file.stem, "pdf")
    text = input_file.read_text(encoding="utf-8", errors="replace")
    # Escape HTML entities and preserve line breaks
    escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    escaped = escaped.replace("\n", "<br>")
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>{_WEASYPRINT_CSS}</style></head>
<body><pre style="font-family: inherit; white-space: pre-wrap;">{escaped}</pre>
</body></html>"""
    WeasyprintHTML(string=html).write_pdf(str(out))
    logger.info("txt→pdf done: %s", input_file.name)
    return out


def txt_to_md(input_file: Path, output_dir: Path) -> Path:
    """
    'Convert' TXT to MD — copy the file with .md extension.
    No formatting is added; the user's plain text is preserved exactly.

    Returns the path of the output .md file.
    """
    out = output_path(output_dir, input_file.stem, "md")
    out.write_bytes(input_file.read_bytes())
    logger.info("txt→md done: %s", input_file.name)
    return out


def txt_to_docx(input_file: Path, output_dir: Path) -> Path:
    """
    Convert plain text to DOCX by creating a new document and adding
    each line as a paragraph.

    Returns the path of the output .docx file.
    """
    out = output_path(output_dir, input_file.stem, "docx")
    text = input_file.read_text(encoding="utf-8", errors="replace")
    doc = python_docx.Document()
    for line in text.splitlines():
        doc.add_paragraph(line)
    doc.save(str(out))
    logger.info("txt→docx done: %s", input_file.name)
    return out


def md_to_pdf(input_file: Path, output_dir: Path) -> Path:
    """
    Convert Markdown to PDF via markdown → HTML → WeasyPrint.
    Uses GFM-style extensions: tables, fenced code blocks, toc.

    Returns the path of the output .pdf file.
    """
    out = output_path(output_dir, input_file.stem, "pdf")
    text = input_file.read_text(encoding="utf-8", errors="replace")
    body_html = md_lib.markdown(
        text,
        extensions=["tables", "fenced_code", "toc", "nl2br"],
    )
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>{_WEASYPRINT_CSS}</style></head>
<body>{body_html}</body></html>"""
    WeasyprintHTML(string=html).write_pdf(str(out))
    logger.info("md→pdf done: %s", input_file.name)
    return out


def md_to_docx(input_file: Path, output_dir: Path) -> Path:
    """
    Convert Markdown to DOCX using pandoc subprocess.
    pandoc produces the best MD→DOCX fidelity of any Python option.

    Returns the path of the output .docx file.
    """
    out = output_path(output_dir, input_file.stem, "docx")
    run_subprocess(
        ["pandoc", str(input_file), "-o", str(out)],
        context="MD→DOCX via pandoc",
    )
    logger.info("md→docx done: %s", input_file.name)
    return out


def md_to_txt(input_file: Path, output_dir: Path) -> Path:
    """
    Convert Markdown to plain text by rendering to HTML then stripping tags.

    Returns the path of the output .txt file.
    """
    out = output_path(output_dir, input_file.stem, "txt")
    text = input_file.read_text(encoding="utf-8", errors="replace")
    html = md_lib.markdown(text)
    soup = BeautifulSoup(html, "html.parser")
    plain = soup.get_text(separator="\n")
    out.write_text(plain.strip(), encoding="utf-8")
    logger.info("md→txt done: %s", input_file.name)
    return out
```

---

## Step 7 — Create `backend/app/converters/image_converter.py`

```python
"""
Image (PNG, JPG) → PDF converter.
"""

import logging
from pathlib import Path

from PIL import Image

from app.converters.utils import output_path

logger = logging.getLogger("docforge.converters.image")


def image_to_pdf(input_file: Path, output_dir: Path) -> Path:
    """
    Convert a PNG or JPG image to a single-page PDF using Pillow.
    Converts RGBA images to RGB first (PDF doesn't support alpha channel).

    Returns the path of the output .pdf file.
    """
    out = output_path(output_dir, input_file.stem, "pdf")
    img = Image.open(str(input_file))

    if img.mode in ("RGBA", "P", "LA"):
        img = img.convert("RGB")

    img.save(str(out), "PDF", resolution=150)
    logger.info("image→pdf done: %s → %s", input_file.name, out.name)
    return out
```

---

## Step 8 — Create `backend/app/converters/dispatcher.py`

This is the routing layer — a single function that takes `(source_ext, target_ext, input_file, output_dir)` and calls the right converter.

```python
"""
Converter dispatcher — routes (source_ext, target_ext) pairs to the
correct converter function.

Add new converters here as new formats are supported.
"""

from pathlib import Path

from app.converters.pdf_converter import pdf_to_docx, pdf_to_txt, pdf_to_md
from app.converters.docx_converter import docx_to_pdf, docx_to_txt, docx_to_md
from app.converters.text_converter import (
    txt_to_pdf, txt_to_md, txt_to_docx,
    md_to_pdf, md_to_docx, md_to_txt,
)
from app.converters.image_converter import image_to_pdf

# Keys: (source_ext, target_ext) — both lowercase, no dot
# Values: callable(input_file: Path, output_dir: Path) -> Path
CONVERTER_MAP: dict[tuple[str, str], callable] = {
    ("pdf",  "docx"): pdf_to_docx,
    ("pdf",  "txt"):  pdf_to_txt,
    ("pdf",  "md"):   pdf_to_md,
    ("docx", "pdf"):  docx_to_pdf,
    ("docx", "txt"):  docx_to_txt,
    ("docx", "md"):   docx_to_md,
    ("txt",  "pdf"):  txt_to_pdf,
    ("txt",  "md"):   txt_to_md,
    ("txt",  "docx"): txt_to_docx,
    ("md",   "pdf"):  md_to_pdf,
    ("md",   "docx"): md_to_docx,
    ("md",   "txt"):  md_to_txt,
    ("png",  "pdf"):  image_to_pdf,
    ("jpg",  "pdf"):  image_to_pdf,
    ("jpeg", "pdf"):  image_to_pdf,
}

# What each source format can be converted to
ALLOWED_TARGETS: dict[str, list[str]] = {
    "pdf":  ["docx", "txt", "md"],
    "docx": ["pdf", "txt", "md"],
    "txt":  ["pdf", "md", "docx"],
    "md":   ["pdf", "docx", "txt"],
    "png":  ["pdf"],
    "jpg":  ["pdf"],
    "jpeg": ["pdf"],
}


def dispatch(
    source_ext: str,
    target_ext: str,
    input_file: Path,
    output_dir: Path,
) -> Path:
    """
    Route a conversion request to the correct converter function.

    Args:
        source_ext: lowercase file extension without dot (e.g. "pdf")
        target_ext: lowercase target format (e.g. "docx")
        input_file: absolute Path to the source file
        output_dir: absolute Path to write the output file

    Returns:
        Path to the output file.

    Raises:
        ValueError: if the (source, target) pair is not supported.
        RuntimeError: if the underlying converter fails.
    """
    source_ext = source_ext.lower().lstrip(".")
    target_ext = target_ext.lower().lstrip(".")

    key = (source_ext, target_ext)
    converter = CONVERTER_MAP.get(key)

    if converter is None:
        allowed = ALLOWED_TARGETS.get(source_ext, [])
        raise ValueError(
            f"Cannot convert '{source_ext}' → '{target_ext}'. "
            f"Supported targets for {source_ext.upper()}: "
            f"{', '.join(t.upper() for t in allowed) if allowed else 'none'}."
        )

    return converter(input_file, output_dir)
```

---

## Step 9 — Create `backend/app/routers/convert.py`

```python
"""
POST /api/convert

Accepts a previously uploaded job_id and a target_format string.
Runs the conversion and makes the output available via GET /api/download/{job_id}.

For batch jobs (multiple input files), each file is converted independently
and the results are zipped into a single archive.
"""

import logging
import zipfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException
from fastapi.responses import JSONResponse

from app.job_store import store, JobStatus
from app.file_manager import cleanup_job
from app.schemas import JobResultResponse, ErrorResponse
from app.converters.dispatcher import dispatch, ALLOWED_TARGETS

logger = logging.getLogger("docforge.convert")

router = APIRouter(prefix="/api", tags=["convert"])


def _get_ext(path: Path) -> str:
    """Return the lowercase extension of a file without the leading dot."""
    return path.suffix.lower().lstrip(".")


def _convert_single(
    input_file: Path,
    target_ext: str,
    output_dir: Path,
) -> Path:
    """
    Convert one file and return the output path.
    Raises HTTPException on unsupported pair or converter failure.
    """
    source_ext = _get_ext(input_file)

    try:
        return dispatch(source_ext, target_ext, input_file, output_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _zip_outputs(files: list[Path], output_dir: Path, job_id: str) -> Path:
    """
    Zip multiple output files into a single archive.
    Returns the path of the zip file.
    """
    zip_path = output_dir / f"docforge_converted_{job_id[:8]}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            zf.write(f, arcname=f.name)
    return zip_path


@router.post(
    "/convert",
    response_model=JobResultResponse,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def convert_documents(
    job_id: Annotated[str, Form(description="Job ID returned by POST /api/upload")],
    target_format: Annotated[
        str,
        Form(description="Target format: pdf, docx, txt, or md"),
    ],
) -> JobResultResponse:
    """
    Convert previously uploaded files to the requested target format.

    Accepts:
        job_id: from POST /api/upload
        target_format: one of pdf, docx, txt, md

    For single-file jobs: returns the converted file directly via download_url.
    For multi-file jobs: returns a zip archive containing all converted files.

    The output is available at GET /api/download/{job_id} until downloaded
    or until the 1-hour TTL expires.
    """
    # ------------------------------------------------------------------ #
    # 1. Validate job exists and is in a convertible state
    # ------------------------------------------------------------------ #
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    if job.status not in (JobStatus.PENDING, JobStatus.ERROR):
        raise HTTPException(
            status_code=409,
            detail=f"Job '{job_id}' is already {job.status}. "
                   "Upload new files to start a fresh conversion.",
        )

    if not job.input_files:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_id}' has no staged input files.",
        )

    # ------------------------------------------------------------------ #
    # 2. Validate target format
    # ------------------------------------------------------------------ #
    target_ext = target_format.lower().strip()
    if target_ext not in ("pdf", "docx", "txt", "md"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported target format '{target_format}'. "
                   "Choose from: pdf, docx, txt, md.",
        )

    # ------------------------------------------------------------------ #
    # 3. Validate that every source file can be converted to target
    # ------------------------------------------------------------------ #
    input_paths = [Path(p) for p in job.input_files]
    for p in input_paths:
        src_ext = _get_ext(p)
        allowed = ALLOWED_TARGETS.get(src_ext, [])
        if target_ext not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot convert '{p.name}' ({src_ext.upper()}) "
                       f"to {target_ext.upper()}. "
                       f"Allowed targets: {', '.join(t.upper() for t in allowed)}.",
            )

    # ------------------------------------------------------------------ #
    # 4. Run conversion(s)
    # ------------------------------------------------------------------ #
    store.update_status(job_id, JobStatus.PROCESSING)
    output_dir = Path(job.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    converted: list[Path] = []

    try:
        for input_file in input_paths:
            out = _convert_single(input_file, target_ext, output_dir)
            converted.append(out)
            logger.info(
                "convert done: job=%s file=%s→%s",
                job_id, input_file.name, out.name,
            )
    except HTTPException:
        store.set_error(job_id, "Conversion failed. See error details.")
        raise
    except Exception as exc:
        logger.exception("unexpected conversion error: job=%s", job_id)
        store.set_error(job_id, "An unexpected server error occurred during conversion.")
        raise HTTPException(
            status_code=500,
            detail="Conversion failed due to a server error. Please try again.",
        ) from exc

    # ------------------------------------------------------------------ #
    # 5. Package output (single file or zip)
    # ------------------------------------------------------------------ #
    if len(converted) == 1:
        final_output = converted[0]
    else:
        final_output = _zip_outputs(converted, output_dir, job_id)
        logger.info("zipped %d files: %s", len(converted), final_output.name)

    store.set_output(job_id, str(final_output))

    download_url = f"/api/download/{job_id}"
    logger.info(
        "convert complete: job=%s output=%s size=%d",
        job_id, final_output.name, job.output_size or 0,
    )

    return JobResultResponse(
        job_id=job_id,
        status=JobStatus.DONE,
        download_url=download_url,
        output_size=job.output_size or 0,
        metadata={"output_filename": final_output.name, "file_count": len(converted)},
    )
```

---

## Step 10 — Register the convert router

Read `backend/app/routes.py` (or `main.py`, whichever currently registers routers).
Add the convert router alongside the existing upload and download routers:

```python
from app.routers.convert import router as convert_router

app.include_router(convert_router)
```

---

## Step 11 — Smoke tests (curl)

Start the server:
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Run all tests in order. Have at least one sample file of each type ready:
- `test.pdf` — a text-based PDF (not scanned)
- `test.docx` — a Word document with headings and a table
- `test.txt` — a plain text file
- `test.md` — a Markdown file with headings, bold, and a table
- `test.png` — any PNG image

**Test A — PDF → DOCX**
```bash
# Stage the file
JOB=$(curl -s -X POST http://localhost:8000/api/upload \
  -F "files=@test.pdf" | python -m json.tool | grep job_id | awk -F'"' '{print $4}')
echo "job_id: $JOB"

# Convert
curl -s -X POST http://localhost:8000/api/convert \
  -F "job_id=$JOB" \
  -F "target_format=docx" | python -m json.tool

# Download
curl -OJ http://localhost:8000/api/download/$JOB
# Verify: a .docx file appears in the current directory, opens in Word
```

**Test B — PDF → TXT**
```bash
JOB=$(curl -s -X POST http://localhost:8000/api/upload \
  -F "files=@test.pdf" | python -m json.tool | grep job_id | awk -F'"' '{print $4}')
curl -s -X POST http://localhost:8000/api/convert \
  -F "job_id=$JOB" -F "target_format=txt" | python -m json.tool
curl -OJ http://localhost:8000/api/download/$JOB
# Verify: .txt file contains readable text from the PDF
```

**Test C — DOCX → PDF**
```bash
JOB=$(curl -s -X POST http://localhost:8000/api/upload \
  -F "files=@test.docx" | python -m json.tool | grep job_id | awk -F'"' '{print $4}')
curl -s -X POST http://localhost:8000/api/convert \
  -F "job_id=$JOB" -F "target_format=pdf" | python -m json.tool
curl -OJ http://localhost:8000/api/download/$JOB
# Verify: .pdf opens and resembles the source docx
```

**Test D — MD → PDF**
```bash
JOB=$(curl -s -X POST http://localhost:8000/api/upload \
  -F "files=@test.md" | python -m json.tool | grep job_id | awk -F'"' '{print $4}')
curl -s -X POST http://localhost:8000/api/convert \
  -F "job_id=$JOB" -F "target_format=pdf" | python -m json.tool
curl -OJ http://localhost:8000/api/download/$JOB
# Verify: .pdf shows formatted headings and text
```

**Test E — MD → DOCX (pandoc)**
```bash
JOB=$(curl -s -X POST http://localhost:8000/api/upload \
  -F "files=@test.md" | python -m json.tool | grep job_id | awk -F'"' '{print $4}')
curl -s -X POST http://localhost:8000/api/convert \
  -F "job_id=$JOB" -F "target_format=docx" | python -m json.tool
curl -OJ http://localhost:8000/api/download/$JOB
```

**Test F — PNG → PDF**
```bash
JOB=$(curl -s -X POST http://localhost:8000/api/upload \
  -F "files=@test.png" | python -m json.tool | grep job_id | awk -F'"' '{print $4}')
curl -s -X POST http://localhost:8000/api/convert \
  -F "job_id=$JOB" -F "target_format=pdf" | python -m json.tool
curl -OJ http://localhost:8000/api/download/$JOB
```

**Test G — Batch convert (2 files → zip)**
```bash
JOB=$(curl -s -X POST http://localhost:8000/api/upload \
  -F "files=@test.pdf" -F "files=@test.md" \
  | python -m json.tool | grep job_id | awk -F'"' '{print $4}')
curl -s -X POST http://localhost:8000/api/convert \
  -F "job_id=$JOB" -F "target_format=txt" | python -m json.tool
curl -OJ http://localhost:8000/api/download/$JOB
# Verify: downloads a .zip containing test.txt and test.txt (from md)
```

**Test H — Invalid conversion pair**
```bash
JOB=$(curl -s -X POST http://localhost:8000/api/upload \
  -F "files=@test.png" | python -m json.tool | grep job_id | awk -F'"' '{print $4}')
curl -s -X POST http://localhost:8000/api/convert \
  -F "job_id=$JOB" -F "target_format=md" | python -m json.tool
# Expected: 400 with "Cannot convert 'png' → 'md'"
```

**Test I — Reuse completed job (should be rejected)**
```bash
# Use any job_id that has already been converted and downloaded
curl -s -X POST http://localhost:8000/api/convert \
  -F "job_id=<already_done_job_id>" -F "target_format=txt"
# Expected: 404 (job cleaned up) or 409 (already done)
```

---

## Verification Checklist

Before marking Steps 1.3a–1.3e done, confirm every item:

- [ ] `python -c "import pypdf, pdf2docx, docx, markdownify, weasyprint, markdown, bs4, PIL; print('OK')"` succeeds
- [ ] `pandoc --version` works in the terminal
- [ ] `soffice --version` (or `libreoffice --version`) works in the terminal
- [ ] Test A: PDF → DOCX produces a readable Word document
- [ ] Test B: PDF → TXT produces readable plain text
- [ ] Test C: DOCX → PDF produces a PDF that visually matches the source
- [ ] Test D: MD → PDF shows formatted headings and body text
- [ ] Test E: MD → DOCX opens in Word with correct heading styles
- [ ] Test F: PNG → PDF embeds the image in a single-page PDF
- [ ] Test G: 2-file batch produces a .zip with 2 converted files
- [ ] Test H: PNG → MD returns HTTP 400 with clear error message
- [ ] Test I: Re-using a completed/cleaned job returns 404 or 409
- [ ] Server logs show job IDs + file sizes, no file content logged
- [ ] `requirements.txt` updated with all 8 new libraries
- [ ] No raw Python tracebacks visible in any API response

---

## Files created / modified this step

```
backend/
├── requirements.txt                        ← updated (8 new libraries)
├── app/
│   ├── routes.py (or main.py)              ← updated (include convert router)
│   └── converters/
│       ├── __init__.py                     ← NEW (empty)
│       ├── utils.py                        ← NEW
│       ├── pdf_converter.py                ← NEW
│       ├── docx_converter.py               ← NEW
│       ├── text_converter.py               ← NEW
│       ├── image_converter.py              ← NEW
│       └── dispatcher.py                   ← NEW
│   └── routers/
│       └── convert.py                      ← NEW
```

---

## Tracker update

After all checklist items pass, update `DOCFORGE_MASTER.md`:

| Task | New status |
|------|-----------|
| 1.3a PDF → DOCX/TXT/MD | ✅ Done |
| 1.3b DOCX → PDF/TXT/MD | ✅ Done |
| 1.3c TXT/MD → PDF | ✅ Done |
| 1.3d MD → DOCX | ✅ Done |
| 1.3e IMG → PDF | ✅ Done |

---

*Next step after this: Steps 1.4a–1.4e — Frontend shell (layout, nav, DropZone, FileCard, Convert page).*
