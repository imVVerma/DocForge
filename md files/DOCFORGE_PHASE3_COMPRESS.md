# DocForge — Phase 3 Build Prompt
## Compress Tool: Backend + Frontend (Steps 3.1a → 3.2a)

> Hand this entire file to Antigravity / Codex as a single prompt.
> Complete steps in order. Do not skip ahead. Verify each step before proceeding.

---

## Context

Phases 1 and 2 are complete:
- Backend: upload, job store, /tmp manager, download, cleanup, convert, merge all working.
- Frontend: Layout, shared components, ConvertPage, MergePage fully wired.

You are now implementing the **Compress tool** — the third tool in DocForge.

The Compress tool accepts a single PDF or DOCX file, applies compression at a
user-chosen quality level (Low / Medium / High), and returns a smaller file.

**New backend infrastructure needed:**
- `backend/app/compressors/` package
- `backend/app/routers/compress.py`

**No new frontend shared components needed** — reuse DropZone, FileCard,
ProgressBar, ResultCard, api.ts exactly as-is.

---

## Compression Strategies

### PDF compression — ghostscript subprocess
Three quality levels map to ghostscript's built-in PDF settings presets:

| Level | ghostscript flag | Target use | Expected reduction |
|-------|-----------------|------------|-------------------|
| low | `-dPDFSETTINGS=/screen` | Web viewing, email | 60–80% |
| medium | `-dPDFSETTINGS=/ebook` | Digital reading | 40–60% |
| high | `-dPDFSETTINGS=/printer` | Print quality | 10–30% |

### DOCX compression — image recompression via Pillow
DOCX files are ZIP archives. The bulk of size is embedded images.
Strategy:
1. Unzip the DOCX
2. Find all images in `word/media/`
3. Re-encode each image as JPEG at a quality setting derived from the level
4. Repack the ZIP as a new DOCX

| Level | JPEG quality | Max dimension |
|-------|-------------|---------------|
| low | 40 | 1280px |
| medium | 65 | 1920px |
| high | 85 | original |

> Note: ghostscript must be installed as a system binary. On Windows it is typically
> at `C:\Program Files\gs\gs*\bin\gswin64c.exe`. On Linux: `gs`. Confirm before running.
> If ghostscript is not installed, PDF compression will fail with a clear error —
> DOCX compression will still work (pure Python).

---

## Mandatory Rules (inherited — re-read before touching any file)

1. Read every existing file before editing it.
2. `async def` for all FastAPI route handlers.
3. No `os.system()` — use `subprocess.run(capture_output=True, text=True, check=False)`.
4. All paths via `pathlib.Path`.
5. Every subprocess call checks `returncode` and logs `stderr` on failure.
6. Never expose raw Python tracebacks. Return `{"error": "human-readable"}` + correct HTTP status.
7. Type-hint every function. Pydantic models for all responses.
8. New libraries → `requirements.txt` immediately after installing.
9. Never use TypeScript `any`.
10. All API calls through `src/lib/api.ts` only.
11. New frontend packages via `pnpm add` only.

---

## Step 1 — Confirm dependencies

### Backend
`Pillow` is already installed from Phase 1. Confirm:
```bash
python -c "from PIL import Image; print('Pillow OK')"
```

Check ghostscript availability:
```bash
# Windows — check common install paths
where gswin64c
# or
dir "C:\Program Files\gs\" /s /b | findstr gswin64c.exe

# Linux/Mac
which gs
```

Note the full path to the ghostscript binary — you will need it in Step 3.

### Frontend
No new packages needed for this phase.

---

## Step 2 — Create `backend/app/compressors/__init__.py`

Create the directory `backend/app/compressors/` with an empty `__init__.py`.

---

## Step 3 — Create `backend/app/compressors/pdf_compressor.py`

```python
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
```

---

## Step 4 — Create `backend/app/compressors/docx_compressor.py`

```python
"""
DOCX compression by recompressing embedded images.

DOCX files are ZIP archives. The largest contributors to file size are
images stored under word/media/. We unzip, recompress each image using
Pillow, and repack as a new DOCX.

This is pure Python — no system dependencies required.
"""

import io
import logging
import zipfile
from pathlib import Path

from PIL import Image

logger = logging.getLogger("docforge.compressors.docx")

# Per quality level: (jpeg_quality, max_dimension_px)
# max_dimension=None means keep original dimensions
_QUALITY_SETTINGS: dict[str, tuple[int, int | None]] = {
    "low":    (40, 1280),
    "medium": (65, 1920),
    "high":   (85, None),
}

# Image extensions we will recompress
_COMPRESSIBLE = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif"}


def _recompress_image(data: bytes, jpeg_quality: int, max_dim: int | None) -> bytes:
    """
    Recompress image bytes using Pillow.

    Converts to JPEG (RGB) at the given quality. Optionally resizes
    if the image exceeds max_dim in either dimension.

    Returns recompressed JPEG bytes.
    """
    img = Image.open(io.BytesIO(data))

    # Convert to RGB (JPEG doesn't support alpha)
    if img.mode in ("RGBA", "P", "LA"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "P":
            img = img.convert("RGBA")
        background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # Resize if exceeds max dimension
    if max_dim is not None:
        w, h = img.size
        if w > max_dim or h > max_dim:
            ratio = min(max_dim / w, max_dim / h)
            new_size = (int(w * ratio), int(h * ratio))
            img = img.resize(new_size, Image.LANCZOS)
            logger.debug("recompress_image: resized %dx%d → %dx%d", w, h, *new_size)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
    return buf.getvalue()


def compress_docx(
    input_file: Path,
    output_dir: Path,
    quality: str,
) -> Path:
    """
    Compress a DOCX file by recompressing its embedded images.

    Args:
        input_file: path to the source DOCX
        output_dir: directory to write the compressed output
        quality: one of "low", "medium", "high"

    Returns:
        Path to the compressed DOCX.

    Raises:
        ValueError: if quality is invalid
        RuntimeError: if the file cannot be processed
    """
    if quality not in _QUALITY_SETTINGS:
        raise ValueError(
            f"Invalid quality '{quality}'. Choose from: low, medium, high."
        )

    jpeg_quality, max_dim = _QUALITY_SETTINGS[quality]
    out = output_dir / f"{input_file.stem}_compressed.docx"

    original_size = input_file.stat().st_size
    images_recompressed = 0
    bytes_saved = 0

    try:
        with zipfile.ZipFile(input_file, "r") as zin:
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    data = zin.read(item.name)
                    ext = Path(item.name).suffix.lower()

                    # Recompress images in word/media/
                    if item.name.startswith("word/media/") and ext in _COMPRESSIBLE:
                        original_len = len(data)
                        try:
                            compressed = _recompress_image(data, jpeg_quality, max_dim)
                            # Only use compressed version if it's actually smaller
                            if len(compressed) < original_len:
                                # Rename .png/.bmp etc to .jpeg since we converted
                                new_name = (
                                    item.name.rsplit(".", 1)[0] + ".jpeg"
                                    if not ext in (".jpg", ".jpeg")
                                    else item.name
                                )
                                saved = original_len - len(compressed)
                                bytes_saved += saved
                                images_recompressed += 1
                                logger.debug(
                                    "compress_docx: %s %d→%d bytes (saved %d)",
                                    item.name, original_len, len(compressed), saved,
                                )
                                zout.writestr(new_name, compressed)
                                continue
                        except Exception as img_err:
                            logger.warning(
                                "compress_docx: could not recompress %s: %s — keeping original",
                                item.name, img_err,
                            )

                    # All other files (XML, rels, fonts, etc.) — copy as-is
                    zout.writestr(item, data)

    except zipfile.BadZipFile as exc:
        raise RuntimeError(
            f"'{input_file.name}' does not appear to be a valid DOCX file."
        ) from exc

    output_size = out.stat().st_size
    reduction_pct = (1 - output_size / original_size) * 100 if original_size > 0 else 0

    logger.info(
        "compress_docx: %s → %s | images=%d | saved=%d bytes (%.1f%%)",
        input_file.name, out.name, images_recompressed, bytes_saved, reduction_pct,
    )

    # If no images found or output is larger, return a copy of the original
    if output_size >= original_size:
        logger.warning(
            "compress_docx: output not smaller than input "
            "(no compressible images found or already optimized)"
        )

    return out
```

---

## Step 5 — Create `backend/app/routers/compress.py`

```python
"""
POST /api/compress

Accepts a previously uploaded job_id, a quality level, and runs
compression on the single uploaded file (PDF or DOCX).

Returns job result with original_size, output_size, and reduction_pct
in metadata for the frontend size comparison display.
"""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException

from app.job_store import store, JobStatus
from app.schemas import JobResultResponse, ErrorResponse
from app.compressors.pdf_compressor import compress_pdf
from app.compressors.docx_compressor import compress_docx

logger = logging.getLogger("docforge.compress")

router = APIRouter(prefix="/api", tags=["compress"])

SUPPORTED_FORMATS = {"pdf", "docx"}
QUALITY_LEVELS = {"low", "medium", "high"}


def _get_ext(path: Path) -> str:
    return path.suffix.lower().lstrip(".")


@router.post(
    "/compress",
    response_model=JobResultResponse,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def compress_document(
    job_id: Annotated[str, Form(description="Job ID from POST /api/upload")],
    quality: Annotated[
        str,
        Form(description="Compression quality: low, medium, or high"),
    ],
) -> JobResultResponse:
    """
    Compress a previously uploaded PDF or DOCX file.

    Accepts:
        job_id: from POST /api/upload (must contain exactly 1 file)
        quality: "low" (smallest), "medium" (balanced), or "high" (minimal loss)

    Returns job result with:
        - download_url: compressed file
        - metadata.original_size: input file size in bytes
        - metadata.output_size: output file size in bytes
        - metadata.reduction_pct: percentage size reduction
        - metadata.quality: quality level used

    Only PDF and DOCX are supported. Only 1 file per compress job.
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

    if not job.input_files:
        raise HTTPException(
            status_code=400,
            detail="No files found in this job.",
        )

    if len(job.input_files) > 1:
        raise HTTPException(
            status_code=400,
            detail="Compress accepts one file at a time. Upload a single file.",
        )

    # ------------------------------------------------------------------ #
    # 2. Validate quality
    # ------------------------------------------------------------------ #
    quality = quality.lower().strip()
    if quality not in QUALITY_LEVELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid quality '{quality}'. Choose from: low, medium, high.",
        )

    # ------------------------------------------------------------------ #
    # 3. Validate file format
    # ------------------------------------------------------------------ #
    input_file = Path(job.input_files[0])
    ext = _get_ext(input_file)

    if ext not in SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot compress '{input_file.name}'. "
                   f"Only PDF and DOCX are supported.",
        )

    original_size = input_file.stat().st_size

    # ------------------------------------------------------------------ #
    # 4. Run compression
    # ------------------------------------------------------------------ #
    store.update_status(job_id, JobStatus.PROCESSING)

    output_dir = Path(job.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        if ext == "pdf":
            output_file = compress_pdf(input_file, output_dir, quality)
        else:  # docx
            output_file = compress_docx(input_file, output_dir, quality)

    except ValueError as exc:
        store.set_error(job_id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        store.set_error(job_id, str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("unexpected compress error: job=%s", job_id)
        store.set_error(job_id, "Compression failed due to a server error.")
        raise HTTPException(
            status_code=500,
            detail="Compression failed due to a server error. Please try again.",
        ) from exc

    # ------------------------------------------------------------------ #
    # 5. Build result
    # ------------------------------------------------------------------ #
    store.set_output(job_id, str(output_file))

    output_size = job.output_size or output_file.stat().st_size
    reduction_pct = round((1 - output_size / original_size) * 100, 1) if original_size > 0 else 0

    logger.info(
        "compress complete: job=%s quality=%s %d→%d bytes (%.1f%%)",
        job_id, quality, original_size, output_size, reduction_pct,
    )

    return JobResultResponse(
        job_id=job_id,
        status=JobStatus.DONE,
        download_url=f"/api/download/{job_id}",
        output_size=output_size,
        metadata={
            "output_filename": output_file.name,
            "original_size": original_size,
            "output_size": output_size,
            "reduction_pct": reduction_pct,
            "quality": quality,
        },
    )
```

---

## Step 6 — Register the compress router

Read `backend/app/routes.py` (or `main.py`, whichever registers routers). Add:

```python
from app.routers.compress import router as compress_router
app.include_router(compress_router)
```

---

## Step 7 — Update `frontend/src/lib/api.ts`

Read the existing `api.ts`. Add the compress function and response type
**without modifying anything already there**:

```ts
// Add to the Types section:
export interface CompressResponse {
  job_id: string;
  status: string;
  download_url: string;
  output_size: number;
  metadata: {
    output_filename: string;
    original_size: number;
    output_size: number;
    reduction_pct: number;
    quality: string;
  };
}

// Add after mergeFiles:
export async function compressFile(
  jobId: string,
  quality: "low" | "medium" | "high"
): Promise<CompressResponse> {
  const form = new FormData();
  form.append("job_id", jobId);
  form.append("quality", quality);

  const { data } = await client.post<CompressResponse>("/api/compress", form);
  return data;
}
```

---

## Step 8 — Create `frontend/src/pages/CompressPage.tsx`

Replace the existing placeholder `CompressPage.tsx` entirely:

```tsx
/**
 * CompressPage — Compress tool UI.
 *
 * Flow:
 *   1. User drops a single PDF or DOCX file
 *   2. User selects quality level: Low / Medium / High
 *   3. "Compress" button triggers: upload → compress → show result
 *   4. ResultCard shows original size, output size, reduction %
 *   5. "Compress another file" resets the page
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { Minimize2, RefreshCw } from "lucide-react";

import { DropZone } from "@/components/DropZone";
import { FileCard } from "@/components/FileCard";
import { ProgressBar } from "@/components/ProgressBar";
import { ResultCard } from "@/components/ResultCard";
import { Button } from "@/components/ui/button";

import { validateFiles, getFileExt, formatBytes } from "@/lib/fileUtils";
import {
  uploadFiles,
  compressFile,
  getDownloadUrl,
  cleanupJob,
  CompressResponse,
} from "@/lib/api";

// ------------------------------------------------------------------ //
// Types
// ------------------------------------------------------------------ //

type Quality = "low" | "medium" | "high";
type PageState = "idle" | "uploading" | "compressing" | "done" | "error";

interface StagedFile {
  file: File;
  error?: string;
}

// ------------------------------------------------------------------ //
// Quality option config
// ------------------------------------------------------------------ //

const QUALITY_OPTIONS: {
  value: Quality;
  label: string;
  description: string;
  expectedReduction: string;
}[] = [
  {
    value: "low",
    label: "Low",
    description: "Maximum compression",
    expectedReduction: "60–80% smaller",
  },
  {
    value: "medium",
    label: "Medium",
    description: "Balanced quality",
    expectedReduction: "40–60% smaller",
  },
  {
    value: "high",
    label: "High",
    description: "Minimal quality loss",
    expectedReduction: "10–30% smaller",
  },
];

// ------------------------------------------------------------------ //
// CompressPage
// ------------------------------------------------------------------ //

export function CompressPage() {
  const [staged, setStaged] = useState<StagedFile | null>(null);
  const [quality, setQuality] = useState<Quality>("medium");
  const [pageState, setPageState] = useState<PageState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<CompressResponse | null>(null);

  const isProcessing = pageState === "uploading" || pageState === "compressing";

  // ---------------------------------------------------------------- //
  // File handling — single file only
  // ---------------------------------------------------------------- //
  const handleFiles = useCallback((incoming: File[]) => {
    const file = incoming[0];
    if (!file) return;

    const ext = getFileExt(file);
    if (ext !== "pdf" && ext !== "docx") {
      setStaged({
        file,
        error: "Only PDF and DOCX files can be compressed.",
      });
      return;
    }

    const errors = validateFiles([file]);
    setStaged({
      file,
      error: errors[0]?.reason,
    });
  }, []);

  const removeFile = useCallback(() => setStaged(null), []);

  // ---------------------------------------------------------------- //
  // Compress flow
  // ---------------------------------------------------------------- //
  const handleCompress = async () => {
    if (!staged || staged.error) return;

    setPageState("uploading");
    setUploadProgress(0);

    let jobId: string | null = null;

    try:
      // Step 1: Upload
      const uploadResp = await uploadFiles([staged.file], (pct) =>
        setUploadProgress(pct)
      );
      jobId = uploadResp.job_id;

      // Step 2: Compress
      setPageState("compressing");
      const compressResp = await compressFile(jobId, quality);

      setResult(compressResp);
      setPageState("done");
    } catch (err: unknown) {
      setPageState("error");
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail;
      toast.error(detail ?? "Compression failed. Please try again.");

      if (jobId) await cleanupJob(jobId);
    }
  };

  const handleReset = () => {
    setStaged(null);
    setQuality("medium");
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
          <Minimize2 size={18} className="text-accent dark:text-accent-dark" />
        </div>
        <div>
          <h1 className="text-xl font-medium text-[#111111] dark:text-[#F0F0EE]">
            Compress
          </h1>
          <p className="text-xs text-[#6B6B65] dark:text-[#888880]">
            PDF · DOCX — reduce file size, one file at a time
          </p>
        </div>
      </div>

      {/* Result state */}
      {pageState === "done" && result && (
        <div className="space-y-4">
          <ResultCard
            filename={result.metadata.output_filename}
            outputSize={result.metadata.output_size}
            downloadUrl={getDownloadUrl(result.job_id)}
            originalSize={result.metadata.original_size}
          />

          {/* Size breakdown */}
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                label: "Original",
                value: formatBytes(result.metadata.original_size),
              },
              {
                label: "Compressed",
                value: formatBytes(result.metadata.output_size),
              },
              {
                label: "Saved",
                value:
                  result.metadata.reduction_pct > 0
                    ? `${result.metadata.reduction_pct}%`
                    : "—",
              },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="text-center p-3 rounded-lg bg-[#F9F9F7] dark:bg-[#1A1A1A] border border-[#E5E5E0] dark:border-[#2A2A2A]"
              >
                <p className="text-xs text-[#6B6B65] dark:text-[#888880]">
                  {label}
                </p>
                <p className="text-sm font-medium text-[#111111] dark:text-[#F0F0EE] mt-0.5">
                  {value}
                </p>
              </div>
            ))}
          </div>

          {result.metadata.reduction_pct <= 0 && (
            <p className="text-xs text-[#6B6B65] dark:text-[#888880] text-center">
              This file is already well-optimized — minimal reduction was possible.
            </p>
          )}

          <Button
            variant="outline"
            onClick={handleReset}
            className="w-full border-[#E5E5E0] dark:border-[#2A2A2A] gap-2"
          >
            <RefreshCw size={14} />
            Compress another file
          </Button>
        </div>
      )}

      {/* Upload + compress state */}
      {pageState !== "done" && (
        <>
          {/* Drop zone — single file */}
          {!staged ? (
            <DropZone
              onFiles={handleFiles}
              multiple={false}
              disabled={isProcessing}
              label="Drop a PDF or DOCX here"
              sublabel="One file at a time — up to 50 MB"
              accept={{
                "application/pdf": [],
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                  [],
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

          {/* Quality selector */}
          {staged && !staged.error && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#6B6B65] dark:text-[#888880] uppercase tracking-wider">
                Quality level
              </label>
              <div className="grid grid-cols-3 gap-2">
                {QUALITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setQuality(opt.value)}
                    disabled={isProcessing}
                    className={[
                      "p-3 rounded-lg border text-left transition-colors",
                      quality === opt.value
                        ? "border-accent dark:border-accent-dark bg-accent/10 dark:bg-accent-dark/10"
                        : "border-[#E5E5E0] dark:border-[#2A2A2A] hover:border-[#111111] dark:hover:border-[#F0F0EE]",
                      isProcessing ? "opacity-40 cursor-not-allowed" : "",
                    ].join(" ")}
                  >
                    <p
                      className={[
                        "text-sm font-medium",
                        quality === opt.value
                          ? "text-accent dark:text-accent-dark"
                          : "text-[#111111] dark:text-[#F0F0EE]",
                      ].join(" ")}
                    >
                      {opt.label}
                    </p>
                    <p className="text-[11px] text-[#6B6B65] dark:text-[#888880] mt-0.5">
                      {opt.description}
                    </p>
                    <p className="text-[11px] font-medium text-[#1D9E75] dark:text-[#25C292] mt-1">
                      {opt.expectedReduction}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Progress */}
          {pageState === "uploading" && (
            <ProgressBar value={uploadProgress} label="Uploading…" />
          )}
          {pageState === "compressing" && (
            <ProgressBar value={100} label="Compressing…" />
          )}

          {/* Compress button */}
          <Button
            onClick={handleCompress}
            disabled={!staged || !!staged.error || isProcessing}
            className="w-full h-11 bg-accent hover:bg-accent/90 dark:bg-accent-dark text-white font-medium"
          >
            {isProcessing
              ? pageState === "uploading"
                ? "Uploading…"
                : "Compressing…"
              : "Compress"}
          </Button>
        </>
      )}
    </div>
  );
}
```

---

## Step 9 — Backend smoke tests

Start the backend:
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

**Test A — PDF compress (medium quality)**
```powershell
$UP = Invoke-RestMethod -Uri http://localhost:8000/api/upload `
  -Method POST -Form @{ files = Get-Item .\test.pdf }
$COMP = Invoke-RestMethod -Uri http://localhost:8000/api/compress `
  -Method POST -Form @{ job_id = $UP.job_id; quality = "medium" }
$COMP | ConvertTo-Json
Invoke-WebRequest -Uri "http://localhost:8000/api/download/$($UP.job_id)" `
  -OutFile test_compressed.pdf
# Verify: test_compressed.pdf is smaller than test.pdf
# Check reduction_pct in $COMP.metadata
```

**Test B — DOCX compress (low quality)**
```powershell
$UP = Invoke-RestMethod -Uri http://localhost:8000/api/upload `
  -Method POST -Form @{ files = Get-Item .\test.docx }
$COMP = Invoke-RestMethod -Uri http://localhost:8000/api/compress `
  -Method POST -Form @{ job_id = $UP.job_id; quality = "low" }
$COMP | ConvertTo-Json
Invoke-WebRequest -Uri "http://localhost:8000/api/download/$($UP.job_id)" `
  -OutFile test_compressed.docx
# Verify: file downloads, opens in Word, images visible but smaller
```

**Test C — Unsupported format (TXT)**
```powershell
$UP = Invoke-RestMethod -Uri http://localhost:8000/api/upload `
  -Method POST -Form @{ files = Get-Item .\test.txt }
Invoke-RestMethod -Uri http://localhost:8000/api/compress `
  -Method POST -Form @{ job_id = $UP.job_id; quality = "medium" }
# Expected: 400 "Only PDF and DOCX are supported"
```

**Test D — Multiple files (error)**
```powershell
$UP = Invoke-RestMethod -Uri http://localhost:8000/api/upload `
  -Method POST -Form @{ files = @(Get-Item .\a.pdf, Get-Item .\b.pdf) }
Invoke-RestMethod -Uri http://localhost:8000/api/compress `
  -Method POST -Form @{ job_id = $UP.job_id; quality = "medium" }
# Expected: 400 "Compress accepts one file at a time"
```

> Note on ghostscript (Windows): if `gswin64c` is not on PATH, Test A will return
> a 500 with "Ghostscript not found". This is expected on Windows without ghostscript.
> DOCX compression (Test B) will still work — it is pure Python.
> Ghostscript will be available on Railway (Linux) via apt.

---

## Step 10 — Frontend smoke tests

Open `http://localhost:5173/compress`:

**Test 1 — Basic compress flow (DOCX)**
- [ ] DropZone accepts only PDF/DOCX (TXT/MD/PNG rejected with inline error)
- [ ] Drop a DOCX file — FileCard appears with DOCX badge
- [ ] Quality selector shows Low / Medium / High cards with descriptions
- [ ] Medium is selected by default
- [ ] Click "Compress" — upload progress, then "Compressing…"
- [ ] ResultCard appears with `_compressed.docx` filename
- [ ] Size breakdown grid shows Original / Compressed / Saved
- [ ] Download works, file opens in Word
- [ ] "Compress another file" resets to empty DropZone

**Test 2 — Quality selection**
- [ ] Click each quality option — selected card highlights in teal
- [ ] Expected reduction text changes per level

**Test 3 — Error states**
- [ ] Drop a TXT file — FileCard shows inline error "Only PDF and DOCX files can be compressed"
- [ ] Compress button stays disabled
- [ ] Drop a file > 50 MB — FileCard shows size error

**Test 4 — Already-optimized file**
- [ ] If output_size >= original_size, show "This file is already well-optimized" note
- [ ] reduction_pct shows "—" in the Saved cell

---

## Verification Checklist

Before marking Phase 3 done, confirm every item:

- [ ] `python -c "from PIL import Image; print('OK')"` passes
- [ ] `pnpm run build` passes with zero TypeScript errors
- [ ] `POST /api/compress` visible in `GET /docs`
- [ ] Test A: PDF compresses (or returns clear ghostscript error if not installed)
- [ ] Test B: DOCX with embedded images compresses successfully
- [ ] Test C: TXT upload returns HTTP 400
- [ ] Test D: Multi-file upload returns HTTP 400
- [ ] Frontend: DropZone restricted to PDF/DOCX only
- [ ] Frontend: quality selector default is "medium"
- [ ] Frontend: size breakdown grid renders correctly after compression
- [ ] Frontend: "already optimized" message shown when reduction_pct ≤ 0
- [ ] Frontend: disabled state correct (no file, or file has error, or processing)
- [ ] No `console.error` during happy path
- [ ] No TypeScript `any`

---

## Files created / modified this step

```
backend/
├── app/
│   ├── routers/
│   │   └── compress.py             ← NEW
│   └── compressors/
│       ├── __init__.py             ← NEW (empty)
│       ├── pdf_compressor.py       ← NEW
│       └── docx_compressor.py      ← NEW

frontend/
├── src/
│   ├── lib/
│   │   └── api.ts                  ← updated (CompressResponse, compressFile)
│   └── pages/
│       └── CompressPage.tsx        ← replaced (full implementation)
```

---

## Tracker update

After all checklist items pass, update `DOCFORGE_MASTER.md`:

| Task | New status |
|------|-----------|
| 3.1a PDF compress via ghostscript | ✅ Done |
| 3.1b DOCX image compress | ✅ Done |
| 3.2a Compress page (frontend) | ✅ Done |

---

*Next: Phase 4 — OCR tool (backend + frontend).*
