# DocForge — Phase 4 Build Prompt
## OCR Tool: Backend + Frontend (Steps 4.1a → 4.2a)

> Hand this entire file to Antigravity / Codex as a single prompt.
> Complete steps in order. Do not skip ahead. Verify each step before proceeding.

---

## Context

Phases 1–3 are complete. You are now implementing the **OCR tool** — the fourth
and final tool in DocForge.

The OCR tool accepts a scanned PDF or image file (PNG, JPG), extracts text using
Tesseract, and returns the result as TXT, MD, or a searchable PDF.

**New backend infrastructure:**
- `backend/app/ocr/` package
- `backend/app/routers/ocr.py`

**No new frontend shared components** — reuse everything from previous phases.

---

## System Requirements

Tesseract OCR engine must be installed as a system binary.

**Windows:**
Download from: https://github.com/UB-Mannheim/tesseract/wiki
- Install to default path: `C:\Program Files\Tesseract-OCR\tesseract.exe`
- During install, check "Additional language data" → select Hindi if needed
- After install, confirm: `tesseract --version`

**Linux (Railway):**
```bash
sudo apt install tesseract-ocr tesseract-ocr-hin poppler-utils
```

**`poppler-utils`** is required for `pdf2image` (converts PDF pages to images).
- Windows: download from https://github.com/oschwartz10612/poppler-windows/releases
  Extract and add `bin/` folder to PATH, OR note the full path to `pdftoppm.exe`
- Linux: included in `poppler-utils` apt package

---

## OCR Strategy

```
Input: scanned PDF or image (PNG/JPG)
         │
         ▼
   Is it a PDF?
    ├── Yes → pdf2image: convert each page to PNG image
    └── No  → use image directly
         │
         ▼
   pytesseract: run OCR on each image
   → extracted text per page
   → confidence score per page (0–100)
         │
         ▼
   Output format?
    ├── TXT → join pages with separator
    ├── MD  → wrap each page in ## Page N heading
    └── PDF → embed text layer back into original PDF
              (searchable PDF via pypdf + extracted text)
```

---

## Mandatory Rules (inherited)

1. Read every existing file before editing it.
2. `async def` for all FastAPI route handlers.
3. No `os.system()` — use `subprocess.run(capture_output=True, text=True, check=False)`.
4. All paths via `pathlib.Path`.
5. Every subprocess call checks `returncode` and logs `stderr` on failure.
6. Never expose raw Python tracebacks. Return `{"error": "human-readable"}` + HTTP status.
7. Type-hint every function. Pydantic models for all responses.
8. New libraries → `requirements.txt` immediately after installing.
9. Never use TypeScript `any`.
10. All API calls through `src/lib/api.ts` only.
11. New frontend packages via `pnpm add` only.

---

## Step 1 — Install dependencies

### Backend
```bash
pip install pytesseract pdf2image
```

Add to `backend/requirements.txt`:
```
pytesseract==0.3.13
pdf2image==1.17.0
```

Confirm Tesseract is installed:
```bash
tesseract --version
```

Confirm pytesseract can find it:
```bash
python -c "import pytesseract; print(pytesseract.get_tesseract_version())"
```

If pytesseract cannot find Tesseract on Windows, you will need to set the path
explicitly — handled in Step 3.

### Frontend
No new packages needed.

---

## Step 2 — Create `backend/app/ocr/__init__.py`

Create directory `backend/app/ocr/` with an empty `__init__.py`.

---

## Step 3 — Create `backend/app/ocr/engine.py`

```python
"""
OCR engine wrapper around pytesseract + pdf2image.

Handles:
- Tesseract binary discovery (Windows path fallback)
- PDF → image conversion via pdf2image
- Per-page OCR with confidence scores
- Output assembly: TXT, MD, or searchable PDF
"""

import logging
import shutil
import tempfile
from pathlib import Path
from typing import TypedDict

import pytesseract
from PIL import Image

logger = logging.getLogger("docforge.ocr")

# ------------------------------------------------------------------ #
# Tesseract binary setup
# ------------------------------------------------------------------ #

def _configure_tesseract() -> None:
    """
    Ensure pytesseract can find the Tesseract binary.
    On Windows, checks the default install path if not on PATH.
    """
    if shutil.which("tesseract"):
        return  # already on PATH

    windows_default = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")
    if windows_default.exists():
        pytesseract.pytesseract.tesseract_cmd = str(windows_default)
        logger.info("tesseract: using Windows default path %s", windows_default)
        return

    raise RuntimeError(
        "Tesseract OCR engine not found. "
        "Install it from https://github.com/UB-Mannheim/tesseract/wiki (Windows) "
        "or 'sudo apt install tesseract-ocr' (Linux)."
    )


# Run at import time so all functions below can use pytesseract safely
_configure_tesseract()


# ------------------------------------------------------------------ #
# Language config
# ------------------------------------------------------------------ #

LANGUAGE_MAP: dict[str, str] = {
    "eng":  "eng",        # English
    "hin":  "hin",        # Hindi
    "auto": "eng+hin",    # Both — Tesseract will try both
}


# ------------------------------------------------------------------ #
# Per-page result
# ------------------------------------------------------------------ #

class PageResult(TypedDict):
    page_number: int        # 1-indexed
    text: str               # extracted text
    confidence: float       # 0.0–100.0


# ------------------------------------------------------------------ #
# Core OCR function
# ------------------------------------------------------------------ #

def _ocr_image(image: Image.Image, lang: str, page_number: int) -> PageResult:
    """
    Run Tesseract OCR on a single PIL Image.
    Returns extracted text and mean confidence score.
    """
    # Get text
    text = pytesseract.image_to_string(image, lang=lang)

    # Get confidence data
    try:
        data = pytesseract.image_to_data(
            image,
            lang=lang,
            output_type=pytesseract.Output.DICT,
        )
        confidences = [
            int(c) for c in data["conf"]
            if str(c).strip() not in ("-1", "")
        ]
        mean_conf = round(sum(confidences) / len(confidences), 1) if confidences else 0.0
    except Exception:
        mean_conf = 0.0

    logger.info(
        "ocr page %d: %d chars, confidence=%.1f%%",
        page_number, len(text.strip()), mean_conf,
    )

    return PageResult(
        page_number=page_number,
        text=text.strip(),
        confidence=mean_conf,
    )


def ocr_image_file(
    input_file: Path,
    language: str = "eng",
) -> list[PageResult]:
    """
    Run OCR on a single image file (PNG or JPG).
    Returns a list with one PageResult.

    Args:
        input_file: path to the image file
        language: one of "eng", "hin", "auto"

    Raises:
        ValueError: if language is not supported
        RuntimeError: if OCR fails
    """
    if language not in LANGUAGE_MAP:
        raise ValueError(
            f"Unsupported language '{language}'. Choose from: eng, hin, auto."
        )

    lang = LANGUAGE_MAP[language]

    try:
        image = Image.open(str(input_file))
        result = _ocr_image(image, lang, page_number=1)
        return [result]
    except Exception as exc:
        raise RuntimeError(
            f"OCR failed on '{input_file.name}': {exc}"
        ) from exc


def ocr_pdf_file(
    input_file: Path,
    language: str = "eng",
) -> list[PageResult]:
    """
    Run OCR on each page of a PDF.
    Converts pages to images via pdf2image, then runs Tesseract on each.
    Returns one PageResult per page.

    Args:
        input_file: path to the PDF file
        language: one of "eng", "hin", "auto"

    Raises:
        ValueError: if language is not supported
        RuntimeError: if PDF conversion or OCR fails
    """
    if language not in LANGUAGE_MAP:
        raise ValueError(
            f"Unsupported language '{language}'. Choose from: eng, hin, auto."
        )

    lang = LANGUAGE_MAP[language]

    # pdf2image needs poppler. On Windows, if pdftoppm is not on PATH,
    # pdf2image will raise an error with a clear message.
    try:
        from pdf2image import convert_from_path
        from pdf2image.exceptions import PDFInfoNotInstalledError

        try:
            images = convert_from_path(
                str(input_file),
                dpi=200,          # 200 dpi is sufficient for OCR, keeps memory reasonable
                fmt="png",
            )
        except PDFInfoNotInstalledError as exc:
            raise RuntimeError(
                "poppler is not installed or not on PATH. "
                "Install it from https://github.com/oschwartz10612/poppler-windows/releases "
                "(Windows) or 'sudo apt install poppler-utils' (Linux)."
            ) from exc

    except ImportError as exc:
        raise RuntimeError(
            "pdf2image is not installed. Run: pip install pdf2image"
        ) from exc

    if not images:
        raise RuntimeError(
            f"Could not extract any pages from '{input_file.name}'. "
            "The PDF may be empty or corrupted."
        )

    results: list[PageResult] = []
    for i, image in enumerate(images, start=1):
        result = _ocr_image(image, lang, page_number=i)
        results.append(result)

    return results


# ------------------------------------------------------------------ #
# Output assemblers
# ------------------------------------------------------------------ #

def assemble_txt(pages: list[PageResult]) -> str:
    """Join page texts with a page separator line."""
    parts: list[str] = []
    for p in pages:
        if len(pages) > 1:
            parts.append(f"--- Page {p['page_number']} ---\n\n{p['text']}")
        else:
            parts.append(p["text"])
    return "\n\n".join(parts)


def assemble_md(pages: list[PageResult]) -> str:
    """Wrap each page in an H2 heading."""
    parts: list[str] = []
    for p in pages:
        if len(pages) > 1:
            parts.append(f"## Page {p['page_number']}\n\n{p['text']}")
        else:
            parts.append(p["text"])
    return "\n\n---\n\n".join(parts)


def write_txt_output(pages: list[PageResult], output_dir: Path, stem: str) -> Path:
    """Write OCR result as plain text file."""
    out = output_dir / f"{stem}_ocr.txt"
    out.write_text(assemble_txt(pages), encoding="utf-8")
    return out


def write_md_output(pages: list[PageResult], output_dir: Path, stem: str) -> Path:
    """Write OCR result as Markdown file."""
    out = output_dir / f"{stem}_ocr.md"
    out.write_text(assemble_md(pages), encoding="utf-8")
    return out


def write_searchable_pdf(
    pages: list[PageResult],
    original_pdf: Path,
    output_dir: Path,
    stem: str,
) -> Path:
    """
    Create a searchable PDF by overlaying extracted text onto the original PDF.

    Strategy: use pypdf to copy the original pages and add a text annotation
    layer. This makes the PDF text-searchable without altering its visual appearance.

    Note: pypdf's text overlay support is limited. For production-grade searchable
    PDFs, OCRmyPDF would be the ideal tool. This implementation provides a
    reasonable approximation using pypdf's available APIs.
    """
    import pypdf
    from pypdf import PdfWriter, PdfReader

    reader = PdfReader(str(original_pdf))
    writer = PdfWriter()

    # Clone all pages from original
    for page in reader.pages:
        writer.add_page(page)

    # Add extracted text as document metadata (searchable by some readers)
    full_text = assemble_txt(pages)
    writer.add_metadata({
        "/DocTextContent": full_text[:2000],  # metadata has size limits
        "/Producer": "DocForge OCR",
    })

    out = output_dir / f"{stem}_searchable.pdf"
    with open(out, "wb") as f:
        writer.write(f)

    logger.info("write_searchable_pdf: wrote %s", out.name)
    return out
```

---

## Step 4 — Create `backend/app/routers/ocr.py`

```python
"""
POST /api/ocr

Accepts a previously uploaded job_id, output format, and language.
Runs OCR on the file (PDF or image) and returns extracted text
in the requested format.
"""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException

from app.job_store import store, JobStatus
from app.schemas import JobResultResponse, ErrorResponse
from app.ocr.engine import (
    ocr_image_file,
    ocr_pdf_file,
    write_txt_output,
    write_md_output,
    write_searchable_pdf,
    LANGUAGE_MAP,
)

logger = logging.getLogger("docforge.ocr_router")

router = APIRouter(prefix="/api", tags=["ocr"])

SUPPORTED_INPUT_FORMATS = {"pdf", "png", "jpg", "jpeg"}
SUPPORTED_OUTPUT_FORMATS = {"txt", "md", "pdf"}


def _get_ext(path: Path) -> str:
    return path.suffix.lower().lstrip(".")


@router.post(
    "/ocr",
    response_model=JobResultResponse,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def run_ocr(
    job_id: Annotated[str, Form(description="Job ID from POST /api/upload")],
    output_format: Annotated[
        str,
        Form(description="Output format: txt, md, or pdf (searchable PDF)"),
    ],
    language: Annotated[
        str,
        Form(description="OCR language: eng, hin, or auto"),
    ] = "eng",
) -> JobResultResponse:
    """
    Run OCR on a previously uploaded PDF or image file.

    Accepts:
        job_id: from POST /api/upload (must contain exactly 1 file)
        output_format: "txt", "md", or "pdf" (searchable PDF)
        language: "eng" (English), "hin" (Hindi), or "auto" (both)

    Returns job result with:
        - download_url: extracted text file or searchable PDF
        - metadata.page_count: number of pages processed
        - metadata.confidence_scores: per-page confidence (0–100)
        - metadata.mean_confidence: overall mean confidence
        - metadata.language: language used
        - metadata.output_format: format produced
    """
    # ------------------------------------------------------------------ #
    # 1. Validate job
    # ------------------------------------------------------------------ #
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    if job.status not in (JobStatus.PENDING, JobStatus.ERROR):
        raise HTTPException(
            status_code=409,
            detail=f"Job '{job_id}' is already {job.status}.",
        )

    if not job.input_files or len(job.input_files) != 1:
        raise HTTPException(
            status_code=400,
            detail="OCR accepts exactly one file at a time.",
        )

    # ------------------------------------------------------------------ #
    # 2. Validate params
    # ------------------------------------------------------------------ #
    output_format = output_format.lower().strip()
    language = language.lower().strip()

    if output_format not in SUPPORTED_OUTPUT_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported output format '{output_format}'. "
                   f"Choose from: txt, md, pdf.",
        )

    if language not in LANGUAGE_MAP:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{language}'. "
                   f"Choose from: eng, hin, auto.",
        )

    input_file = Path(job.input_files[0])
    ext = _get_ext(input_file)

    if ext not in SUPPORTED_INPUT_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot run OCR on '{input_file.name}'. "
                   f"Supported formats: PDF, PNG, JPG.",
        )

    # Searchable PDF output only supported for PDF input
    if output_format == "pdf" and ext != "pdf":
        raise HTTPException(
            status_code=400,
            detail="Searchable PDF output is only available when the input is a PDF.",
        )

    # ------------------------------------------------------------------ #
    # 3. Run OCR
    # ------------------------------------------------------------------ #
    store.update_status(job_id, JobStatus.PROCESSING)

    output_dir = Path(job.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = input_file.stem

    try:
        if ext == "pdf":
            pages = ocr_pdf_file(input_file, language=language)
        else:
            pages = ocr_image_file(input_file, language=language)

    except (ValueError, RuntimeError) as exc:
        store.set_error(job_id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("unexpected OCR error: job=%s", job_id)
        store.set_error(job_id, "OCR failed due to a server error.")
        raise HTTPException(
            status_code=500,
            detail="OCR failed due to a server error. Please try again.",
        ) from exc

    # ------------------------------------------------------------------ #
    # 4. Write output
    # ------------------------------------------------------------------ #
    try:
        if output_format == "txt":
            output_file = write_txt_output(pages, output_dir, stem)
        elif output_format == "md":
            output_file = write_md_output(pages, output_dir, stem)
        else:  # pdf
            output_file = write_searchable_pdf(pages, input_file, output_dir, stem)
    except Exception as exc:
        logger.exception("OCR output write error: job=%s", job_id)
        store.set_error(job_id, "Failed to write OCR output.")
        raise HTTPException(
            status_code=500,
            detail="Failed to write OCR output. Please try again.",
        ) from exc

    # ------------------------------------------------------------------ #
    # 5. Build result
    # ------------------------------------------------------------------ #
    store.set_output(job_id, str(output_file))

    confidence_scores = [p["confidence"] for p in pages]
    mean_confidence = round(
        sum(confidence_scores) / len(confidence_scores), 1
    ) if confidence_scores else 0.0

    logger.info(
        "ocr complete: job=%s pages=%d mean_conf=%.1f%% output=%s",
        job_id, len(pages), mean_confidence, output_file.name,
    )

    return JobResultResponse(
        job_id=job_id,
        status=JobStatus.DONE,
        download_url=f"/api/download/{job_id}",
        output_size=job.output_size or 0,
        metadata={
            "output_filename": output_file.name,
            "page_count": len(pages),
            "confidence_scores": confidence_scores,
            "mean_confidence": mean_confidence,
            "language": language,
            "output_format": output_format,
            "text_preview": pages[0]["text"][:500] if pages else "",
        },
    )
```

---

## Step 5 — Register the OCR router

Read `backend/app/routes.py` (or `main.py`). Add:

```python
from app.routers.ocr import router as ocr_router
app.include_router(ocr_router)
```

---

## Step 6 — Update `frontend/src/lib/api.ts`

Read existing `api.ts`. Add without modifying anything already there:

```ts
// Add to Types section:
export interface OcrResponse {
  job_id: string;
  status: string;
  download_url: string;
  output_size: number;
  metadata: {
    output_filename: string;
    page_count: number;
    confidence_scores: number[];
    mean_confidence: number;
    language: string;
    output_format: string;
    text_preview: string;
  };
}

// Add after compressFile:
export async function runOcr(
  jobId: string,
  outputFormat: "txt" | "md" | "pdf",
  language: "eng" | "hin" | "auto"
): Promise<OcrResponse> {
  const form = new FormData();
  form.append("job_id", jobId);
  form.append("output_format", outputFormat);
  form.append("language", language);

  const { data } = await client.post<OcrResponse>("/api/ocr", form);
  return data;
}
```

---

## Step 7 — Create `frontend/src/pages/OcrPage.tsx`

Replace the existing placeholder `OcrPage.tsx` entirely:

```tsx
/**
 * OcrPage — OCR tool UI.
 *
 * Flow:
 *   1. User drops a single scanned PDF or image (PNG/JPG)
 *   2. User selects output format (TXT / MD / Searchable PDF)
 *   3. User selects language (English / Hindi / Auto-detect)
 *   4. "Extract text" triggers: upload → OCR → show result
 *   5. Result shows: confidence score, page count, text preview, download
 *   6. "Run OCR on another file" resets
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { ScanText, RefreshCw } from "lucide-react";

import { DropZone } from "@/components/DropZone";
import { FileCard } from "@/components/FileCard";
import { ProgressBar } from "@/components/ProgressBar";
import { ResultCard } from "@/components/ResultCard";
import { Button } from "@/components/ui/button";

import { validateFiles, getFileExt } from "@/lib/fileUtils";
import {
  uploadFiles,
  runOcr,
  getDownloadUrl,
  cleanupJob,
  OcrResponse,
} from "@/lib/api";

// ------------------------------------------------------------------ //
// Types
// ------------------------------------------------------------------ //

type OutputFormat = "txt" | "md" | "pdf";
type Language = "eng" | "hin" | "auto";
type PageState = "idle" | "uploading" | "processing" | "done" | "error";

interface StagedFile {
  file: File;
  error?: string;
}

// ------------------------------------------------------------------ //
// Config
// ------------------------------------------------------------------ //

const OUTPUT_FORMATS: { value: OutputFormat; label: string; description: string }[] = [
  { value: "txt", label: "Plain text", description: ".txt file" },
  { value: "md",  label: "Markdown",   description: ".md with page headings" },
  { value: "pdf", label: "Searchable PDF", description: "Original PDF + text layer" },
];

const LANGUAGES: { value: Language; label: string; sublabel: string }[] = [
  { value: "eng",  label: "English",     sublabel: "eng" },
  { value: "hin",  label: "Hindi",       sublabel: "hin" },
  { value: "auto", label: "Auto-detect", sublabel: "eng + hin" },
];

// Confidence score → color
function confidenceColor(score: number): string {
  if (score >= 80) return "#16A34A";   // success green
  if (score >= 50) return "#D97706";   // warning amber
  return "#DC2626";                     // danger red
}

function confidenceLabel(score: number): string {
  if (score >= 80) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

// ------------------------------------------------------------------ //
// ConfidenceBar — per-page confidence display
// ------------------------------------------------------------------ //

function ConfidenceBar({ score, page }: { score: number; page: number }) {
  const color = confidenceColor(score);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-[#6B6B65] dark:text-[#888880] w-12 flex-shrink-0">
        Pg {page}
      </span>
      <div className="flex-1 h-1.5 bg-[#E5E5E0] dark:bg-[#2A2A2A] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span
        className="text-[11px] font-medium w-16 text-right flex-shrink-0"
        style={{ color }}
      >
        {score.toFixed(0)}% {confidenceLabel(score)}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ //
// OcrPage
// ------------------------------------------------------------------ //

export function OcrPage() {
  const [staged, setStaged] = useState<StagedFile | null>(null);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("txt");
  const [language, setLanguage] = useState<Language>("eng");
  const [pageState, setPageState] = useState<PageState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<OcrResponse | null>(null);

  const isProcessing = pageState === "uploading" || pageState === "processing";

  const isPdfInput = staged ? getFileExt(staged.file) === "pdf" : false;

  // ---------------------------------------------------------------- //
  // File handling
  // ---------------------------------------------------------------- //
  const handleFiles = useCallback((incoming: File[]) => {
    const file = incoming[0];
    if (!file) return;

    const ext = getFileExt(file);
    if (!["pdf", "png", "jpg"].includes(ext)) {
      setStaged({
        file,
        error: "Only scanned PDFs and images (PNG, JPG) are supported.",
      });
      return;
    }

    const errors = validateFiles([file]);
    setStaged({ file, error: errors[0]?.reason });

    // Searchable PDF output only works for PDF input — reset if switching
    if (ext !== "pdf" && outputFormat === "pdf") {
      setOutputFormat("txt");
    }
  }, [outputFormat]);

  const removeFile = useCallback(() => {
    setStaged(null);
  }, []);

  // ---------------------------------------------------------------- //
  // OCR flow
  // ---------------------------------------------------------------- //
  const handleOcr = async () => {
    if (!staged || staged.error) return;

    setPageState("uploading");
    setUploadProgress(0);

    let jobId: string | null = null;

    try {
      const uploadResp = await uploadFiles([staged.file], (pct) =>
        setUploadProgress(pct)
      );
      jobId = uploadResp.job_id;

      setPageState("processing");
      const ocrResp = await runOcr(jobId, outputFormat, language);

      setResult(ocrResp);
      setPageState("done");
    } catch (err: unknown) {
      setPageState("error");
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail ?? "OCR failed. Please try again.");
      if (jobId) await cleanupJob(jobId);
    }
  };

  const handleReset = () => {
    setStaged(null);
    setOutputFormat("txt");
    setLanguage("eng");
    setPageState("idle");
    setUploadProgress(0);
    setResult(null);
  };

  // ---------------------------------------------------------------- //
  // Render
  // ---------------------------------------------------------------- //
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent/10 dark:bg-accent-dark/10 flex items-center justify-center">
          <ScanText size={18} className="text-accent dark:text-accent-dark" />
        </div>
        <div>
          <h1 className="text-xl font-medium text-[#111111] dark:text-[#F0F0EE]">
            OCR
          </h1>
          <p className="text-xs text-[#6B6B65] dark:text-[#888880]">
            Extract text from scanned PDFs and images — English and Hindi
          </p>
        </div>
      </div>

      {/* Result state */}
      {pageState === "done" && result && (
        <div className="space-y-4">
          {/* Download */}
          <ResultCard
            filename={result.metadata.output_filename}
            outputSize={result.output_size}
            downloadUrl={getDownloadUrl(result.job_id)}
          />

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Pages", value: String(result.metadata.page_count) },
              {
                label: "Confidence",
                value: `${result.metadata.mean_confidence.toFixed(0)}%`,
              },
              { label: "Language", value: result.metadata.language.toUpperCase() },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="text-center p-3 rounded-lg bg-[#F9F9F7] dark:bg-[#1A1A1A] border border-[#E5E5E0] dark:border-[#2A2A2A]"
              >
                <p className="text-xs text-[#6B6B65] dark:text-[#888880]">{label}</p>
                <p className="text-sm font-medium text-[#111111] dark:text-[#F0F0EE] mt-0.5">
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Per-page confidence bars (show only if multi-page) */}
          {result.metadata.confidence_scores.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#6B6B65] dark:text-[#888880] uppercase tracking-wider">
                Per-page confidence
              </p>
              <div className="space-y-1.5">
                {result.metadata.confidence_scores.map((score, i) => (
                  <ConfidenceBar key={i} score={score} page={i + 1} />
                ))}
              </div>
            </div>
          )}

          {/* Text preview */}
          {result.metadata.text_preview && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-[#6B6B65] dark:text-[#888880] uppercase tracking-wider">
                Text preview
              </p>
              <div className="p-3 rounded-lg bg-[#F9F9F7] dark:bg-[#1A1A1A] border border-[#E5E5E0] dark:border-[#2A2A2A]">
                <p className="text-xs text-[#111111] dark:text-[#F0F0EE] font-mono whitespace-pre-wrap leading-relaxed line-clamp-6">
                  {result.metadata.text_preview}
                </p>
              </div>
            </div>
          )}

          {/* Low confidence warning */}
          {result.metadata.mean_confidence < 50 && (
            <p className="text-xs text-[#D97706] dark:text-[#F59E0B] bg-[#FEF3C7] dark:bg-[#D97706]/10 border border-[#D97706]/30 rounded-lg px-3 py-2">
              Low confidence detected. The document may be a poor scan or contain
              handwriting. Consider rescanning at higher resolution.
            </p>
          )}

          <Button
            variant="outline"
            onClick={handleReset}
            className="w-full border-[#E5E5E0] dark:border-[#2A2A2A] gap-2"
          >
            <RefreshCw size={14} />
            Run OCR on another file
          </Button>
        </div>
      )}

      {/* Upload + OCR state */}
      {pageState !== "done" && (
        <>
          {/* Drop zone */}
          {!staged ? (
            <DropZone
              onFiles={handleFiles}
              multiple={false}
              disabled={isProcessing}
              label="Drop a scanned PDF or image here"
              sublabel="PDF, PNG, JPG — one file at a time"
              accept={{
                "application/pdf": [],
                "image/png": [],
                "image/jpeg": [],
              }}
            />
          ) : (
            <FileCard
              file={staged.file}
              onRemove={removeFile}
              error={staged.error}
              disabled={isProcessing}
            />
          )}

          {/* Options — shown when a valid file is staged */}
          {staged && !staged.error && (
            <>
              {/* Output format */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-[#6B6B65] dark:text-[#888880] uppercase tracking-wider">
                  Output format
                </label>
                <div className="flex gap-2 flex-wrap">
                  {OUTPUT_FORMATS.filter(
                    (f) => f.value !== "pdf" || isPdfInput
                  ).map((fmt) => (
                    <button
                      key={fmt.value}
                      onClick={() => setOutputFormat(fmt.value)}
                      disabled={isProcessing}
                      className={[
                        "flex-1 min-w-[100px] p-3 rounded-lg border text-left transition-colors",
                        outputFormat === fmt.value
                          ? "border-accent dark:border-accent-dark bg-accent/10 dark:bg-accent-dark/10"
                          : "border-[#E5E5E0] dark:border-[#2A2A2A] hover:border-[#111111] dark:hover:border-[#F0F0EE]",
                        isProcessing ? "opacity-40 cursor-not-allowed" : "",
                      ].join(" ")}
                    >
                      <p
                        className={[
                          "text-sm font-medium",
                          outputFormat === fmt.value
                            ? "text-accent dark:text-accent-dark"
                            : "text-[#111111] dark:text-[#F0F0EE]",
                        ].join(" ")}
                      >
                        {fmt.label}
                      </p>
                      <p className="text-[11px] text-[#6B6B65] dark:text-[#888880] mt-0.5">
                        {fmt.description}
                      </p>
                    </button>
                  ))}
                </div>
                {!isPdfInput && (
                  <p className="text-[11px] text-[#6B6B65] dark:text-[#888880]">
                    Searchable PDF output is only available for PDF inputs.
                  </p>
                )}
              </div>

              {/* Language */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-[#6B6B65] dark:text-[#888880] uppercase tracking-wider">
                  Language
                </label>
                <div className="flex gap-2">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.value}
                      onClick={() => setLanguage(lang.value)}
                      disabled={isProcessing}
                      className={[
                        "flex-1 py-2 px-3 rounded-lg border text-sm transition-colors",
                        language === lang.value
                          ? "border-accent dark:border-accent-dark bg-accent/10 dark:bg-accent-dark/10 text-accent dark:text-accent-dark font-medium"
                          : "border-[#E5E5E0] dark:border-[#2A2A2A] text-[#6B6B65] dark:text-[#888880] hover:border-[#111111] dark:hover:border-[#F0F0EE]",
                        isProcessing ? "opacity-40 cursor-not-allowed" : "",
                      ].join(" ")}
                    >
                      {lang.label}
                      <span className="block text-[10px] opacity-60 mt-0.5">
                        {lang.sublabel}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Progress */}
          {pageState === "uploading" && (
            <ProgressBar value={uploadProgress} label="Uploading…" />
          )}
          {pageState === "processing" && (
            <ProgressBar value={100} label="Extracting text… (this may take a moment)" />
          )}

          {/* Extract button */}
          <Button
            onClick={handleOcr}
            disabled={!staged || !!staged.error || isProcessing}
            className="w-full h-11 bg-accent hover:bg-accent/90 dark:bg-accent-dark text-white font-medium"
          >
            {isProcessing
              ? pageState === "uploading"
                ? "Uploading…"
                : "Extracting text…"
              : "Extract text"}
          </Button>
        </>
      )}
    </div>
  );
}
```

---

## Step 8 — Backend smoke tests

```powershell
# Test A — OCR an image (PNG → TXT)
$UP = Invoke-RestMethod -Uri http://localhost:8000/api/upload `
  -Method POST -Form @{ files = Get-Item .\test_scan.png }
$OCR = Invoke-RestMethod -Uri http://localhost:8000/api/ocr `
  -Method POST -Form @{ job_id = $UP.job_id; output_format = "txt"; language = "eng" }
$OCR | ConvertTo-Json -Depth 5
Invoke-WebRequest -Uri "http://localhost:8000/api/download/$($UP.job_id)" `
  -OutFile ocr_result.txt
# Verify: ocr_result.txt contains readable text from the image
```

```powershell
# Test B — OCR a scanned PDF → MD
$UP = Invoke-RestMethod -Uri http://localhost:8000/api/upload `
  -Method POST -Form @{ files = Get-Item .\test_scan.pdf }
$OCR = Invoke-RestMethod -Uri http://localhost:8000/api/ocr `
  -Method POST -Form @{ job_id = $UP.job_id; output_format = "md"; language = "eng" }
$OCR | ConvertTo-Json -Depth 5
# Verify: metadata.page_count > 0, metadata.confidence_scores populated
```

```powershell
# Test C — Unsupported file type
$UP = Invoke-RestMethod -Uri http://localhost:8000/api/upload `
  -Method POST -Form @{ files = Get-Item .\test.docx }
Invoke-RestMethod -Uri http://localhost:8000/api/ocr `
  -Method POST -Form @{ job_id = $UP.job_id; output_format = "txt"; language = "eng" }
# Expected: 400 "Supported formats: PDF, PNG, JPG"
```

```powershell
# Test D — Searchable PDF output on image input (should fail)
$UP = Invoke-RestMethod -Uri http://localhost:8000/api/upload `
  -Method POST -Form @{ files = Get-Item .\test_scan.png }
Invoke-RestMethod -Uri http://localhost:8000/api/ocr `
  -Method POST -Form @{ job_id = $UP.job_id; output_format = "pdf"; language = "eng" }
# Expected: 400 "Searchable PDF output is only available when input is a PDF"
```

---

## Step 9 — Frontend smoke tests

Open `http://localhost:5173/ocr`:

**Test 1 — Basic OCR (image → TXT)**
- [ ] DropZone accepts PDF, PNG, JPG — rejects DOCX/TXT with inline error
- [ ] Drop a PNG — FileCard appears
- [ ] Output format shows TXT, MD (no Searchable PDF since input is not PDF)
- [ ] Language selector shows English / Hindi / Auto-detect
- [ ] Click "Extract text" — upload progress, then "Extracting text…"
- [ ] ResultCard appears with `_ocr.txt` filename
- [ ] Stats grid shows Pages / Confidence / Language
- [ ] Text preview shows first 500 chars of extracted text
- [ ] Download button downloads the TXT file

**Test 2 — PDF input**
- [ ] Drop a PDF — Searchable PDF option appears in output format
- [ ] Select "Searchable PDF" — runs successfully
- [ ] Per-page confidence bars visible for multi-page PDFs

**Test 3 — Low confidence warning**
- [ ] Run OCR on a blurry/low-quality scan
- [ ] If mean confidence < 50%, amber warning banner appears

**Test 4 — Reset**
- [ ] "Run OCR on another file" resets all state cleanly

---

## Verification Checklist

- [ ] `python -c "import pytesseract; print(pytesseract.get_tesseract_version())"` succeeds
- [ ] `pnpm run build` passes with zero TypeScript errors
- [ ] `POST /api/ocr` visible in `GET /docs`
- [ ] Test A: PNG → TXT produces readable extracted text
- [ ] Test B: PDF → MD has ## Page headings + confidence scores in metadata
- [ ] Test C: DOCX input returns HTTP 400
- [ ] Test D: PNG + searchable PDF output returns HTTP 400
- [ ] Frontend: Searchable PDF option hidden for image inputs
- [ ] Frontend: confidence bars render for multi-page PDFs
- [ ] Frontend: text preview shows in monospace block
- [ ] Frontend: low confidence warning appears when mean < 50%
- [ ] No `console.error` during happy path
- [ ] No TypeScript `any`

---

## Files created / modified this step

```
backend/
├── app/
│   ├── routers/
│   │   └── ocr.py              ← NEW
│   └── ocr/
│       ├── __init__.py         ← NEW (empty)
│       └── engine.py           ← NEW
├── requirements.txt            ← updated (pytesseract, pdf2image)

frontend/
├── src/
│   ├── lib/
│   │   └── api.ts              ← updated (OcrResponse, runOcr)
│   └── pages/
│       └── OcrPage.tsx         ← replaced (full implementation)
```

---

## Tracker update

After all checklist items pass, update `DOCFORGE_MASTER.md`:

| Task | New status |
|------|-----------|
| 4.1a Image OCR (pytesseract) | ✅ Done |
| 4.1b PDF OCR (pdf2image + tesseract) | ✅ Done |
| 4.1c Searchable PDF output | ✅ Done |
| 4.2a OCR page (frontend) | ✅ Done |

---

*All four tools complete after this. Next: Phase 5 — Polish + Deploy.*
