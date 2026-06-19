# DocForge — Phase 2 Build Prompt
## Merge Tool: Backend + Frontend (Steps 2.1a → 2.2b)

> Hand this entire file to Antigravity / Codex as a single prompt.
> Complete steps in order. Do not skip ahead. Verify each step before proceeding.

---

## Context

Phase 1 is complete:
- Backend: upload, job store, /tmp manager, download, cleanup, convert router all working.
- Frontend: Layout, DropZone, FileCard, ProgressBar, ResultCard, api.ts, ConvertPage fully wired.

You are now implementing the **Merge tool** — the second tool in DocForge.

The Merge tool lets users upload 2–20 files, drag to reorder them, and merge them into
a single output document. The frontend introduces `@dnd-kit/sortable` for drag-to-reorder.
The backend adds a `/api/merge` route with four merge strategies depending on input types.

**No new backend infrastructure needed** — reuse `store`, `file_manager`, `schemas`,
upload/download routers exactly as-is. Only new file: `backend/app/routers/merge.py`
and `backend/app/mergers/` package.

---

## Merge Strategies (implement all four)

| Input types | Strategy | Output |
|-------------|----------|--------|
| All PDF | `pypdf.PdfMerger` — concatenate pages in order | PDF |
| All DOCX | `python-docx` — append sections with page break between each | DOCX |
| All TXT or MD | Concatenate text with `## {filename}` H2 separator between each | TXT or MD |
| Mixed (any combo) | Convert each file to PDF first (reuse dispatcher), then PDF merge | PDF |

Output format rules:
- All-PDF input → PDF output always
- All-DOCX input → DOCX output always
- All-TXT input → TXT output
- All-MD input → MD output
- Mixed → PDF output always (after converting each to PDF)
- User cannot override output format — it is determined by input types

---

## Mandatory Rules (inherited — re-read before touching any file)

1. Read every existing file before editing it. Never assume contents.
2. `async def` for all FastAPI route handlers.
3. No `os.system()` — use `subprocess.run(capture_output=True, text=True, check=False)`.
4. All paths via `pathlib.Path`. No string concatenation for paths.
5. Every subprocess call checks `returncode` and logs `stderr` on failure.
6. Never expose raw Python tracebacks. Return `{"error": "human-readable"}` + correct HTTP status.
7. Type-hint every function. Pydantic models for all responses.
8. New libraries → `requirements.txt` immediately after installing.
9. Never use TypeScript `any`. Define proper interfaces.
10. All API calls go through `src/lib/api.ts` only.
11. Every user-visible string is sentence-case.
12. New frontend packages via `pnpm add` only.

---

## Step 1 — Install dependencies

### Backend (no new libraries needed)
`pypdf` and `python-docx` are already installed from Phase 1. Confirm:
```bash
python -c "import pypdf; import docx; print('OK')"
```

### Frontend
```bash
cd frontend
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Verify:** `pnpm run dev` still starts cleanly after install.

---

## Step 2 — Create `backend/app/mergers/__init__.py`

Create the directory `backend/app/mergers/` with an empty `__init__.py`.

---

## Step 3 — Create `backend/app/mergers/pdf_merger.py`

```python
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
```

---

## Step 4 — Create `backend/app/mergers/docx_merger.py`

```python
"""
DOCX merge — append multiple Word documents into one using python-docx.

Strategy: open the first document, then for each subsequent document
add a page break and copy all paragraphs and tables into the first doc.
"""

import logging
from pathlib import Path
from copy import deepcopy

from docx import Document
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

logger = logging.getLogger("docforge.mergers.docx")


def _add_page_break(doc: Document) -> None:
    """Insert a page break paragraph at the end of a document."""
    para = doc.add_paragraph()
    run = para.add_run()
    br = OxmlElement("w:br")
    br.set(qn("w:type"), "page")
    run._r.append(br)


def _copy_element(element):
    """Deep-copy an XML element for insertion into another document."""
    return deepcopy(element)


def merge_docx(input_files: list[Path], output_dir: Path) -> Path:
    """
    Merge a list of DOCX files into a single DOCX.

    Opens the first document as the base, then appends each subsequent
    document's body elements after a page break.

    Args:
        input_files: ordered list of DOCX file paths (minimum 2)
        output_dir: directory to write the merged output

    Returns:
        Path to the merged DOCX file.

    Raises:
        ValueError: if fewer than 2 files provided
        RuntimeError: if a file cannot be opened as DOCX
    """
    if len(input_files) < 2:
        raise ValueError("Merge requires at least 2 files.")

    try:
        merged = Document(str(input_files[0]))
        logger.info("merge_docx: base document = %s", input_files[0].name)
    except Exception as exc:
        raise RuntimeError(
            f"Could not open '{input_files[0].name}' as a Word document."
        ) from exc

    for docx_path in input_files[1:]:
        try:
            src = Document(str(docx_path))
        except Exception as exc:
            raise RuntimeError(
                f"Could not open '{docx_path.name}' as a Word document."
            ) from exc

        # Add page break before each appended document
        _add_page_break(merged)

        # Copy body elements (paragraphs + tables) from source into merged
        for element in src.element.body:
            # Skip the final sectPr (section properties) to avoid layout conflicts
            if element.tag.endswith("}sectPr"):
                continue
            merged.element.body.append(_copy_element(element))

        logger.info("merge_docx: appended %s", docx_path.name)

    out = output_dir / "merged.docx"
    merged.save(str(out))
    logger.info("merge_docx: wrote %s (%d files)", out.name, len(input_files))
    return out
```

---

## Step 5 — Create `backend/app/mergers/text_merger.py`

```python
"""
TXT and MD merge — concatenate text files with filename separators.
"""

import logging
from pathlib import Path

logger = logging.getLogger("docforge.mergers.text")


def merge_text(input_files: list[Path], output_dir: Path, ext: str) -> Path:
    """
    Concatenate text or markdown files in order.

    Each file's content is preceded by an H2 heading with the original filename
    as a separator, making it clear where each source document begins.

    Args:
        input_files: ordered list of TXT or MD file paths (minimum 2)
        output_dir: directory to write the output
        ext: output file extension — "txt" or "md"

    Returns:
        Path to the merged file.

    Raises:
        ValueError: if fewer than 2 files provided
    """
    if len(input_files) < 2:
        raise ValueError("Merge requires at least 2 files.")

    sections: list[str] = []

    for file_path in input_files:
        content = file_path.read_text(encoding="utf-8", errors="replace").strip()
        # Use the original filename stem (strip index prefix added during upload)
        # e.g. "0_notes" → "notes"
        stem = file_path.stem
        if stem and stem[0].isdigit() and "_" in stem:
            stem = stem.split("_", 1)[1]

        header = f"## {stem}"
        sections.append(f"{header}\n\n{content}")
        logger.info("merge_text: read %s (%d chars)", file_path.name, len(content))

    separator = "\n\n---\n\n"
    merged_content = separator.join(sections)

    out = output_dir / f"merged.{ext}"
    out.write_text(merged_content, encoding="utf-8")
    logger.info("merge_text: wrote %s (%d files)", out.name, len(input_files))
    return out
```

---

## Step 6 — Create `backend/app/mergers/dispatcher.py`

```python
"""
Merge dispatcher — determines the correct merge strategy based on input file types,
runs any required pre-conversion, then calls the appropriate merger.
"""

import logging
from pathlib import Path

from app.mergers.pdf_merger import merge_pdfs
from app.mergers.docx_merger import merge_docx
from app.mergers.text_merger import merge_text

logger = logging.getLogger("docforge.mergers.dispatcher")

# Mapping from file extension to its "type group"
_EXT_GROUP: dict[str, str] = {
    "pdf":  "pdf",
    "docx": "docx",
    "txt":  "txt",
    "md":   "md",
}


def _get_ext(path: Path) -> str:
    return path.suffix.lower().lstrip(".")


def dispatch_merge(
    input_files: list[Path],
    output_dir: Path,
    tmp_pdf_dir: Path,
) -> tuple[Path, str]:
    """
    Choose and run the correct merge strategy for the given input files.

    Strategy selection (in priority order):
    1. All PDF → pdf_merger directly
    2. All DOCX → docx_merger directly
    3. All TXT → text_merger (ext="txt")
    4. All MD → text_merger (ext="md")
    5. Mixed → convert each to PDF via dispatcher, then pdf_merger

    Args:
        input_files: ordered list of input file Paths
        output_dir: where to write the final merged file
        tmp_pdf_dir: scratch dir for intermediate PDFs (mixed merge only)

    Returns:
        Tuple of (output_file_path, output_format_string)

    Raises:
        ValueError: on unsupported combination
        RuntimeError: if any conversion or merge step fails
    """
    if len(input_files) < 2:
        raise ValueError("Merge requires at least 2 files.")

    exts = [_get_ext(f) for f in input_files]
    unique_exts = set(exts)

    logger.info(
        "dispatch_merge: %d files, types=%s", len(input_files), unique_exts
    )

    # ------------------------------------------------------------------ #
    # Homogeneous groups — direct merge
    # ------------------------------------------------------------------ #
    if unique_exts == {"pdf"}:
        out = merge_pdfs(input_files, output_dir)
        return out, "pdf"

    if unique_exts == {"docx"}:
        out = merge_docx(input_files, output_dir)
        return out, "docx"

    if unique_exts == {"txt"}:
        out = merge_text(input_files, output_dir, ext="txt")
        return out, "txt"

    if unique_exts == {"md"}:
        out = merge_text(input_files, output_dir, ext="md")
        return out, "md"

    # ------------------------------------------------------------------ #
    # Mixed types — convert everything to PDF first, then merge
    # ------------------------------------------------------------------ #
    logger.info(
        "dispatch_merge: mixed types %s — converting all to PDF first", unique_exts
    )

    # Import here to avoid circular imports (converters ↔ mergers)
    from app.converters.dispatcher import dispatch as convert_dispatch

    tmp_pdf_dir.mkdir(parents=True, exist_ok=True)
    pdf_files: list[Path] = []

    for i, src in enumerate(input_files):
        ext = _get_ext(src)

        if ext == "pdf":
            # Already PDF — use as-is (copy to tmp dir to keep ordering clean)
            import shutil
            dest = tmp_pdf_dir / f"{i:02d}_{src.name}"
            shutil.copy2(src, dest)
            pdf_files.append(dest)
            logger.info("dispatch_merge: %s already PDF, copied", src.name)
        else:
            # Convert to PDF
            try:
                converted = convert_dispatch(ext, "pdf", src, tmp_pdf_dir)
                # Rename with index prefix to preserve order
                ordered = tmp_pdf_dir / f"{i:02d}_{converted.name}"
                converted.rename(ordered)
                pdf_files.append(ordered)
                logger.info(
                    "dispatch_merge: converted %s → %s", src.name, ordered.name
                )
            except Exception as exc:
                raise RuntimeError(
                    f"Could not convert '{src.name}' to PDF for mixed merge. "
                    f"Reason: {exc}"
                ) from exc

    out = merge_pdfs(pdf_files, output_dir)
    return out, "pdf"
```

---

## Step 7 — Create `backend/app/routers/merge.py`

```python
"""
POST /api/merge

Accepts a previously uploaded job_id and an ordered list of filenames
specifying the merge order. Runs the merge and makes output available
via GET /api/download/{job_id}.
"""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException

from app.job_store import store, JobStatus
from app.schemas import JobResultResponse, ErrorResponse
from app.mergers.dispatcher import dispatch_merge

logger = logging.getLogger("docforge.merge")

router = APIRouter(prefix="/api", tags=["merge"])


@router.post(
    "/merge",
    response_model=JobResultResponse,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def merge_documents(
    job_id: Annotated[str, Form(description="Job ID from POST /api/upload")],
    ordered_filenames: Annotated[
        str,
        Form(
            description=(
                "Comma-separated list of filenames in the desired merge order. "
                "Must match the filenames in the uploaded job exactly. "
                "Example: '0_report.pdf,2_appendix.pdf,1_intro.pdf'"
            )
        ),
    ],
) -> JobResultResponse:
    """
    Merge previously uploaded files in the specified order.

    Accepts:
        job_id: from POST /api/upload
        ordered_filenames: comma-separated filenames in merge order

    The merge strategy is auto-selected based on input file types:
    - All PDF → merged PDF
    - All DOCX → merged DOCX
    - All TXT → merged TXT
    - All MD → merged MD
    - Mixed → all converted to PDF, then merged PDF

    Output available at GET /api/download/{job_id}.
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

    if not job.input_files or len(job.input_files) < 2:
        raise HTTPException(
            status_code=400,
            detail="Merge requires at least 2 uploaded files.",
        )

    # ------------------------------------------------------------------ #
    # 2. Parse and validate ordered_filenames
    # ------------------------------------------------------------------ #
    requested_names = [n.strip() for n in ordered_filenames.split(",") if n.strip()]

    if len(requested_names) < 2:
        raise HTTPException(
            status_code=400,
            detail="ordered_filenames must contain at least 2 filenames.",
        )

    # Build a lookup of available files by filename
    available: dict[str, Path] = {
        Path(p).name: Path(p) for p in job.input_files
    }

    # Resolve ordered paths
    ordered_paths: list[Path] = []
    for name in requested_names:
        if name not in available:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"File '{name}' not found in job '{job_id}'. "
                    f"Available files: {', '.join(available.keys())}"
                ),
            )
        ordered_paths.append(available[name])

    # ------------------------------------------------------------------ #
    # 3. Run merge
    # ------------------------------------------------------------------ #
    store.update_status(job_id, JobStatus.PROCESSING)

    output_dir = Path(job.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    tmp_pdf_dir = output_dir / "_tmp_pdfs"

    try:
        output_file, output_format = dispatch_merge(
            input_files=ordered_paths,
            output_dir=output_dir,
            tmp_pdf_dir=tmp_pdf_dir,
        )
    except (ValueError, RuntimeError) as exc:
        store.set_error(job_id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("unexpected merge error: job=%s", job_id)
        store.set_error(job_id, "Merge failed due to a server error.")
        raise HTTPException(
            status_code=500,
            detail="Merge failed due to a server error. Please try again.",
        ) from exc
    finally:
        # Clean up intermediate PDF dir regardless of success/failure
        import shutil
        if tmp_pdf_dir.exists():
            shutil.rmtree(tmp_pdf_dir, ignore_errors=True)

    store.set_output(job_id, str(output_file))
    logger.info(
        "merge complete: job=%s output=%s format=%s size=%d",
        job_id, output_file.name, output_format, job.output_size or 0,
    )

    return JobResultResponse(
        job_id=job_id,
        status=JobStatus.DONE,
        download_url=f"/api/download/{job_id}",
        output_size=job.output_size or 0,
        metadata={
            "output_filename": output_file.name,
            "output_format": output_format,
            "file_count": len(ordered_paths),
        },
    )
```

---

## Step 8 — Register the merge router

Read `backend/app/routes.py` (or `main.py`, whichever registers routers). Add:

```python
from app.routers.merge import router as merge_router
app.include_router(merge_router)
```

---

## Step 9 — Update `frontend/src/lib/api.ts`

Read the existing `api.ts`. Add the merge function and its response type
**without removing or modifying anything already there**:

```ts
// Add to the Types section:
export interface MergeResponse {
  job_id: string;
  status: string;
  download_url: string;
  output_size: number;
  metadata: {
    output_filename: string;
    output_format: string;
    file_count: number;
  };
}

// Add after the convertFiles function:
export async function mergeFiles(
  jobId: string,
  orderedFilenames: string[]
): Promise<MergeResponse> {
  const form = new FormData();
  form.append("job_id", jobId);
  form.append("ordered_filenames", orderedFilenames.join(","));

  const { data } = await client.post<MergeResponse>("/api/merge", form);
  return data;
}
```

---

## Step 10 — Create `frontend/src/pages/MergePage.tsx`

Replace the existing placeholder `MergePage.tsx` entirely with the full implementation:

```tsx
/**
 * MergePage — Merge tool UI.
 *
 * Flow:
 *   1. User drops 2–20 files into DropZone
 *   2. Files appear as a sortable list (drag handles on left)
 *   3. User drags to reorder
 *   4. "Merge" button triggers: upload → merge → show result
 *   5. ResultCard shows output with download button
 *   6. "Merge more" resets the page
 *
 * Merge order sent to backend = current visual order of the list.
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { Layers, RefreshCw, GripVertical } from "lucide-react";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { DropZone } from "@/components/DropZone";
import { ProgressBar } from "@/components/ProgressBar";
import { ResultCard } from "@/components/ResultCard";
import { Button } from "@/components/ui/button";

import { validateFiles, getFileExt, formatBytes, FILE_EXT_COLORS, FILE_EXT_LABELS, FileExt } from "@/lib/fileUtils";
import { uploadFiles, mergeFiles, getDownloadUrl, cleanupJob, MergeResponse } from "@/lib/api";
import { FileText, FileType, File as FileIcon } from "lucide-react";

// ------------------------------------------------------------------ //
// Types
// ------------------------------------------------------------------ //

type PageState = "idle" | "uploading" | "merging" | "done" | "error";

interface StagedFile {
  id: string;       // unique id for dnd-kit (index-based)
  file: File;
  error?: string;
}

// ------------------------------------------------------------------ //
// SortableFileCard — FileCard with a drag handle
// ------------------------------------------------------------------ //

interface SortableFileCardProps {
  item: StagedFile;
  onRemove: () => void;
  disabled: boolean;
  index: number;
}

function FileTypeIcon({ ext }: { ext: FileExt }) {
  const color = FILE_EXT_COLORS[ext];
  if (ext === "pdf") return <FileType size={18} style={{ color }} />;
  if (ext === "docx") return <FileText size={18} style={{ color }} />;
  return <FileIcon size={18} style={{ color }} />;
}

function SortableFileCard({ item, onRemove, disabled, index }: SortableFileCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled });

  const ext = getFileExt(item.file) as FileExt;
  const label = FILE_EXT_LABELS[ext];
  const color = FILE_EXT_COLORS[ext];

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "flex items-center gap-3 px-3 py-3 rounded-lg border",
        "bg-[#F9F9F7] dark:bg-[#1A1A1A]",
        item.error
          ? "border-danger dark:border-danger-dark"
          : "border-[#E5E5E0] dark:border-[#2A2A2A]",
        isDragging ? "shadow-sm z-50 relative" : "",
      ].join(" ")}
    >
      {/* Order badge */}
      <span className="text-xs font-medium text-[#6B6B65] dark:text-[#888880] w-5 text-center flex-shrink-0">
        {index + 1}
      </span>

      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        disabled={disabled}
        className={[
          "cursor-grab active:cursor-grabbing p-0.5 rounded",
          "text-[#6B6B65] dark:text-[#888880]",
          "hover:text-[#111111] dark:hover:text-[#F0F0EE]",
          "focus:outline-none focus:ring-1 focus:ring-accent",
          disabled ? "opacity-40 cursor-not-allowed" : "",
        ].join(" ")}
        aria-label="Drag to reorder"
      >
        <GripVertical size={16} />
      </button>

      {/* File icon */}
      <FileTypeIcon ext={ext} />

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#111111] dark:text-[#F0F0EE] truncate">
          {item.file.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ color, backgroundColor: `${color}18` }}
          >
            {label}
          </span>
          <span className="text-xs text-[#6B6B65] dark:text-[#888880]">
            {formatBytes(item.file.size)}
          </span>
        </div>
        {item.error && (
          <p className="text-xs text-danger dark:text-danger-dark mt-0.5">{item.error}</p>
        )}
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        disabled={disabled}
        className={[
          "p-1 rounded-md text-[#6B6B65] dark:text-[#888880]",
          "hover:text-danger dark:hover:text-danger-dark hover:bg-danger/10",
          "transition-colors flex-shrink-0",
          disabled ? "opacity-40 cursor-not-allowed" : "",
        ].join(" ")}
        aria-label={`Remove ${item.file.name}`}
      >
        ×
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ //
// Merge type inference — what will the output format be?
// ------------------------------------------------------------------ //

function inferOutputFormat(files: File[]): string | null {
  if (files.length < 2) return null;
  const exts = new Set(files.map((f) => getFileExt(f)));
  if (exts.size === 1) {
    const ext = [...exts][0];
    if (ext === "pdf") return "PDF";
    if (ext === "docx") return "DOCX";
    if (ext === "txt") return "TXT";
    if (ext === "md") return "MD";
  }
  return "PDF"; // mixed → always PDF
}

// ------------------------------------------------------------------ //
// MergePage
// ------------------------------------------------------------------ //

export function MergePage() {
  const [items, setItems] = useState<StagedFile[]>([]);
  const [pageState, setPageState] = useState<PageState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<MergeResponse | null>(null);

  const isProcessing = pageState === "uploading" || pageState === "merging";
  const validItems = items.filter((it) => !it.error);
  const hasErrors = items.some((it) => it.error);
  const outputFormat = inferOutputFormat(validItems.map((it) => it.file));

  // ---------------------------------------------------------------- //
  // DnD sensors
  // ---------------------------------------------------------------- //
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((prev) => {
        const oldIndex = prev.findIndex((it) => it.id === active.id);
        const newIndex = prev.findIndex((it) => it.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  // ---------------------------------------------------------------- //
  // File handling
  // ---------------------------------------------------------------- //
  const handleFiles = useCallback((incoming: File[]) => {
    if (items.length + incoming.length > 20) {
      toast.error("Maximum 20 files per merge job.");
      return;
    }

    const errors = validateFiles(incoming);
    const errorMap = new Map(errors.map((e) => [e.file.name, e.reason]));

    const newItems: StagedFile[] = incoming.map((file, i) => ({
      id: `${Date.now()}-${i}-${file.name}`,
      file,
      error: errorMap.get(file.name),
    }));

    setItems((prev) => [...prev, ...newItems]);
  }, [items.length]);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  // ---------------------------------------------------------------- //
  // Merge flow
  // ---------------------------------------------------------------- //
  const handleMerge = async () => {
    if (validItems.length < 2) return;

    setPageState("uploading");
    setUploadProgress(0);

    let jobId: string | null = null;

    try {
      // Step 1: Upload in current visual order
      const files = validItems.map((it) => it.file);
      const uploadResp = await uploadFiles(files, (pct) => setUploadProgress(pct));
      jobId = uploadResp.job_id;

      // Step 2: Derive the server-side filenames in order.
      // The backend saves files as "{index}_{sanitized_stem}.{ext}"
      // We reconstruct these from the upload order.
      // Since uploadFiles sends them in order, index 0 = first file, etc.
      // We send the order as 0,1,2,...N which matches the upload order.
      // The backend's ordered_filenames param accepts the actual stored filenames.
      // Since we uploaded in order and want to keep that order, we pass them as-is.
      // The backend will list job.input_files in insertion order.

      // Fetch the actual stored filenames from the job by using the job_id.
      // Since the backend stores files as "{i}_{stem}.{ext}", we reconstruct:
      const orderedFilenames = files.map((f, i) => {
        const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const ext = getFileExt(f);
        const stem = safeName.replace(/\.[^.]+$/, "");
        return `${i}_${stem}.${ext}`;
      });

      // Step 3: Merge
      setPageState("merging");
      const mergeResp = await mergeFiles(jobId, orderedFilenames);

      setResult(mergeResp);
      setPageState("done");
    } catch (err: unknown) {
      setPageState("error");
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail ?? "Merge failed. Please try again.");

      if (jobId) await cleanupJob(jobId);
    }
  };

  const handleReset = () => {
    setItems([]);
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
          <Layers size={18} className="text-accent dark:text-accent-dark" />
        </div>
        <div>
          <h1 className="text-xl font-medium text-[#111111] dark:text-[#F0F0EE]">
            Merge
          </h1>
          <p className="text-xs text-[#6B6B65] dark:text-[#888880]">
            PDF · DOCX · TXT · MD — up to 20 files, drag to reorder
          </p>
        </div>
      </div>

      {/* Result state */}
      {pageState === "done" && result && (
        <div className="space-y-4">
          <ResultCard
            filename={result.metadata.output_filename}
            outputSize={result.output_size}
            downloadUrl={getDownloadUrl(result.job_id)}
          />
          <div className="text-xs text-center text-[#6B6B65] dark:text-[#888880]">
            {result.metadata.file_count} files merged into{" "}
            <span className="font-medium">{result.metadata.output_format.toUpperCase()}</span>
          </div>
          <Button
            variant="outline"
            onClick={handleReset}
            className="w-full border-[#E5E5E0] dark:border-[#2A2A2A] gap-2"
          >
            <RefreshCw size={14} />
            Merge more files
          </Button>
        </div>
      )}

      {/* Upload + merge state */}
      {pageState !== "done" && (
        <>
          {/* Drop zone */}
          <DropZone
            onFiles={handleFiles}
            disabled={isProcessing}
            label={items.length > 0 ? "Drop more files" : "Drop files here"}
            sublabel="PDF, DOCX, TXT, MD — 2 to 20 files"
          />

          {/* Sortable file list */}
          {items.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[#6B6B65] dark:text-[#888880] uppercase tracking-wider">
                  Merge order — drag to reorder
                </p>
                {outputFormat && (
                  <span className="text-xs text-[#6B6B65] dark:text-[#888880]">
                    Output:{" "}
                    <span className="font-medium text-[#111111] dark:text-[#F0F0EE]">
                      {outputFormat}
                    </span>
                  </span>
                )}
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={items.map((it) => it.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {items.map((item, index) => (
                      <SortableFileCard
                        key={item.id}
                        item={item}
                        index={index}
                        onRemove={() => removeItem(item.id)}
                        disabled={isProcessing}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}

          {/* Progress */}
          {pageState === "uploading" && (
            <ProgressBar value={uploadProgress} label="Uploading…" />
          )}
          {pageState === "merging" && (
            <ProgressBar value={100} label="Merging…" />
          )}

          {/* Info banner: mixed types */}
          {validItems.length >= 2 &&
            new Set(validItems.map((it) => getFileExt(it.file))).size > 1 && (
              <p className="text-xs text-[#6B6B65] dark:text-[#888880] bg-[#F9F9F7] dark:bg-[#1A1A1A] border border-[#E5E5E0] dark:border-[#2A2A2A] rounded-lg px-3 py-2">
                Mixed file types detected — all files will be converted to PDF before merging.
              </p>
            )}

          {/* Merge button */}
          <Button
            onClick={handleMerge}
            disabled={validItems.length < 2 || hasErrors || isProcessing}
            className="w-full h-11 bg-accent hover:bg-accent/90 dark:bg-accent-dark text-white font-medium"
          >
            {isProcessing
              ? pageState === "uploading"
                ? "Uploading…"
                : "Merging…"
              : `Merge ${validItems.length >= 2 ? `${validItems.length} files` : "files"}`}
          </Button>

          {validItems.length < 2 && items.length > 0 && (
            <p className="text-xs text-center text-[#6B6B65] dark:text-[#888880]">
              Add at least {2 - validItems.length} more file{2 - validItems.length > 1 ? "s" : ""} to merge.
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

---

## Step 11 — Handle filename reconstruction edge case

The `handleMerge` function reconstructs server-side filenames from the frontend.
However, `werkzeug.secure_filename` may sanitize names differently than the frontend
reconstruction. The safest approach is to have the backend return the actual stored
filenames after upload.

Update `backend/app/schemas.py` — add `input_filenames` to `JobCreatedResponse`:

Read `schemas.py` first. Then update `JobCreatedResponse`:

```python
class JobCreatedResponse(BaseModel):
    """Returned immediately when a job is accepted and queued."""
    job_id: str
    status: str
    input_filenames: list[str] = []   # actual stored filenames, basename only
```

Update `backend/app/routers/upload.py` — return actual filenames:

Read `upload.py` first. In the return statement, add `input_filenames`:

```python
return JobCreatedResponse(
    job_id=job.job_id,
    status=job.status,
    input_filenames=[Path(p).name for p in job.input_files],
)
```

Update `frontend/src/lib/api.ts` — add `input_filenames` to `UploadResponse`:

```ts
export interface UploadResponse {
  job_id: string;
  status: string;
  input_filenames: string[];   // add this field
}
```

Update `MergePage.tsx` — use actual filenames from upload response instead of reconstructing:

In `handleMerge`, replace the filename reconstruction block with:

```ts
// Use actual stored filenames returned by the backend (in upload order)
const orderedFilenames = uploadResp.input_filenames;
```

This is the correct approach — no guessing at sanitization rules.

---

## Step 12 — Backend smoke tests

Start the backend:
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

**Test A — Merge 2 PDFs**
```powershell
$UP = Invoke-RestMethod -Uri http://localhost:8000/api/upload `
  -Method POST -Form @{ files = @(Get-Item .\a.pdf, Get-Item .\b.pdf) }
$FNAMES = $UP.input_filenames -join ","
$MERGE = Invoke-RestMethod -Uri http://localhost:8000/api/merge `
  -Method POST -Form @{ job_id = $UP.job_id; ordered_filenames = $FNAMES }
Invoke-WebRequest -Uri "http://localhost:8000/api/download/$($UP.job_id)" -OutFile merged.pdf
# Verify: merged.pdf opens and contains pages from both a.pdf and b.pdf in order
```

**Test B — Merge 2 PDFs in reverse order**
```powershell
$UP = Invoke-RestMethod -Uri http://localhost:8000/api/upload `
  -Method POST -Form @{ files = @(Get-Item .\a.pdf, Get-Item .\b.pdf) }
# Reverse the filenames order
$FNAMES = ($UP.input_filenames | Sort-Object -Descending) -join ","
$MERGE = Invoke-RestMethod -Uri http://localhost:8000/api/merge `
  -Method POST -Form @{ job_id = $UP.job_id; ordered_filenames = $FNAMES }
Invoke-WebRequest -Uri "http://localhost:8000/api/download/$($UP.job_id)" -OutFile merged_reversed.pdf
# Verify: b.pdf content comes first
```

**Test C — Merge 2 TXT files**
```powershell
$UP = Invoke-RestMethod -Uri http://localhost:8000/api/upload `
  -Method POST -Form @{ files = @(Get-Item .\notes1.txt, Get-Item .\notes2.txt) }
$FNAMES = $UP.input_filenames -join ","
Invoke-RestMethod -Uri http://localhost:8000/api/merge `
  -Method POST -Form @{ job_id = $UP.job_id; ordered_filenames = $FNAMES }
Invoke-WebRequest -Uri "http://localhost:8000/api/download/$($UP.job_id)" -OutFile merged.txt
# Verify: merged.txt contains ## heading separators + content from both files
```

**Test D — Fewer than 2 files (error)**
```powershell
$UP = Invoke-RestMethod -Uri http://localhost:8000/api/upload `
  -Method POST -Form @{ files = Get-Item .\a.pdf }
Invoke-RestMethod -Uri http://localhost:8000/api/merge `
  -Method POST -Form @{ job_id = $UP.job_id; ordered_filenames = $UP.input_filenames[0] }
# Expected: 400 "Merge requires at least 2 files"
```

---

## Step 13 — Frontend smoke tests

Open `http://localhost:5173/merge` and manually test:

**Test 1 — Basic merge flow**
- [ ] Drop 2 PDF files — both appear as SortableFileCards with order numbers (1, 2)
- [ ] "Output: PDF" shown in top-right of file list
- [ ] Drag file 2 above file 1 — order numbers update (now 1, 2 in new order)
- [ ] Click "Merge 2 files" — upload progress bar, then "Merging…" state
- [ ] ResultCard appears with `merged.pdf` filename and size
- [ ] Download button downloads a valid PDF containing both files in dragged order
- [ ] "Merge more files" resets page to empty state

**Test 2 — Mixed file types**
- [ ] Drop 1 PDF + 1 TXT file
- [ ] Info banner appears: "Mixed file types detected — all files will be converted to PDF"
- [ ] Output format shows "PDF"
- [ ] Merge completes successfully

**Test 3 — Error states**
- [ ] Drop only 1 file — button shows "Merge files" and is disabled
- [ ] Helper text: "Add at least 1 more file to merge"
- [ ] Drop an unsupported file (.gif) — FileCard shows inline error, button stays disabled

**Test 4 — Maximum files**
- [ ] Drop 20 files — all appear, merge button enabled
- [ ] Try to drop a 21st file — toast: "Maximum 20 files per merge job"

---

## Verification Checklist

Before marking Phase 2 done, confirm every item:

- [ ] `python -c "import pypdf; import docx; print('OK')"` passes
- [ ] `pnpm run build` passes with zero TypeScript errors
- [ ] `POST /api/merge` registered and visible in `GET /docs`
- [ ] `JobCreatedResponse` now includes `input_filenames`
- [ ] `UploadResponse` interface in `api.ts` includes `input_filenames`
- [ ] Test A: 2 PDFs merge into 1 PDF correctly
- [ ] Test B: Reversed order produces correctly reordered PDF
- [ ] Test C: 2 TXT files merge with `##` separators
- [ ] Test D: Single file returns HTTP 400
- [ ] Frontend: drag handle is visible and functional
- [ ] Frontend: order numbers update after drag
- [ ] Frontend: output format badge shows correct format
- [ ] Frontend: mixed-type info banner appears for mixed uploads
- [ ] Frontend: disabled state correct (< 2 valid files, or processing)
- [ ] Frontend: error files are excluded from merge, shown with red border
- [ ] No `console.error` during happy path
- [ ] No TypeScript `any`
- [ ] No inline styles except `transform`/`transition` from dnd-kit

---

## Files created / modified this step

```
backend/
├── app/
│   ├── schemas.py                      ← updated (input_filenames on JobCreatedResponse)
│   ├── routers/
│   │   ├── upload.py                   ← updated (return input_filenames)
│   │   └── merge.py                    ← NEW
│   └── mergers/
│       ├── __init__.py                 ← NEW (empty)
│       ├── pdf_merger.py               ← NEW
│       ├── docx_merger.py              ← NEW
│       ├── text_merger.py              ← NEW
│       └── dispatcher.py               ← NEW

frontend/
├── src/
│   ├── lib/
│   │   └── api.ts                      ← updated (MergeResponse, mergeFiles, input_filenames)
│   └── pages/
│       └── MergePage.tsx               ← replaced (full implementation)
```

---

## Tracker update

After all checklist items pass, update `DOCFORGE_MASTER.md`:

| Task | New status |
|------|-----------|
| 2.1a PDF merge (backend) | ✅ Done |
| 2.1b DOCX/TXT/MD merge (backend) | ✅ Done |
| 2.2a Sortable file list (frontend) | ✅ Done |
| 2.2b Merge page (frontend) | ✅ Done |

---

*Next: Phase 3 — Compress tool (backend + frontend).*
