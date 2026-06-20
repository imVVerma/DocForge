# DocForge â€” Master Build Document
> Document Intelligence Platform: Merge Â· Compress Â· OCR Â· Convert
> Version: 1.0 | Status: Planning | Last Updated: June 2026

---

## Table of Contents
1. [Product Overview](#1-product-overview)
2. [Product Requirements (PRD)](#2-product-requirements-prd)
3. [Tech Stack](#3-tech-stack)
4. [App Flow](#4-app-flow)
5. [Data Schema](#5-data-schema)
6. [Implementation Plan](#6-implementation-plan)
7. [Design Guidelines](#7-design-guidelines)
8. [Agent Rules (Antigravity / Codex)](#8-agent-rules-antigravity--codex)
9. [Build Tracker](#9-build-tracker)

---

## 1. Product Overview

### What is DocForge?
DocForge is a browser-based document toolkit that lets users perform four core operations on their documents â€” **Merge**, **Compress**, **OCR**, and **Convert** â€” without installing any software. All processing happens server-side via a FastAPI backend. No accounts required in v1.

### Who is it for?
- Individuals who work with PDFs, Word docs, Markdown, and text files
- People replacing slow, ad-heavy online tools (ILovePDF, Smallpdf, etc.)
- Developers and writers who want a clean, fast, self-hostable alternative

### Core Value Props
- Fast, clean UI â€” no ads, no paywalls, no tracking
- Handles PDF, DOCX, TXT, MD in every operation
- Privacy-first â€” files are deleted from server after processing
- Built to be extended with AI (Phase 2)

---

## 2. Product Requirements (PRD)

### 2.1 Supported File Types

| Format | Merge | Compress | OCR | Convert (from) | Convert (to) |
|--------|-------|----------|-----|----------------|--------------|
| PDF    | âœ…    | âœ…       | âœ…  | âœ…             | âœ…           |
| DOCX   | âœ…    | âœ…       | âŒ  | âœ…             | âœ…           |
| TXT    | âœ…    | âŒ       | âŒ  | âœ…             | âœ…           |
| MD     | âœ…    | âŒ       | âŒ  | âœ…             | âœ…           |
| PNG/JPG| âŒ    | âŒ       | âœ…  | âœ…             | âŒ           |

### 2.2 Feature Requirements

#### MERGE
- Accept 2â€“20 files per merge job
- Drag-to-reorder before merging
- Show file size + page count (for PDFs) per file
- Output: single merged PDF (default) or DOCX
- For TXT/MD: concatenate with separator headings

#### COMPRESS
- Accept PDF and DOCX
- Show original size â†’ estimated output size (before processing)
- Quality levels: Low (max compression) / Medium (balanced) / High (minimal loss)
- Output: same format as input, smaller file

#### OCR
- Accept PDF (scanned) and image files (PNG, JPG)
- Extract text and return as: TXT, MD, or searchable PDF
- Show confidence score per page (%)
- Language selection: English (default), Hindi, auto-detect

#### CONVERT
- Conversion matrix (what â†’ what):
  - PDF â†’ DOCX, TXT, MD
  - DOCX â†’ PDF, TXT, MD
  - TXT â†’ PDF, MD, DOCX
  - MD â†’ PDF, DOCX, TXT
  - PNG/JPG â†’ PDF
- Batch convert: up to 10 files at once

### 2.3 Non-Functional Requirements
- Max file size per upload: 50 MB
- Max total upload size per job: 200 MB
- File retention on server: deleted immediately after download or after 1 hour (whichever comes first)
- Browser support: Chrome, Firefox, Safari, Edge (latest 2 versions)
- Mobile-responsive UI
- No login required in v1

### 2.4 Out of Scope (v1)
- Video or audio files
- AI summarization or chat (Phase 2)
- User accounts / history
- Cloud storage integrations (Google Drive, Dropbox)
- Password-protected PDFs (Phase 2)

---

## 3. Tech Stack

### 3.1 Frontend
| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | React 18 + Vite | Fast DX, matches existing stack |
| Styling | Tailwind CSS v3 | Utility-first, no runtime overhead |
| UI Components | shadcn/ui | Accessible, composable, unstyled base |
| File Upload | react-dropzone | Battle-tested drag-and-drop |
| Drag Reorder | @dnd-kit/sortable | Lightweight, accessible DnD |
| State Management | Zustand | Simple global state for job queue |
| HTTP Client | axios | Progress events for upload tracking |
| Icons | lucide-react | Consistent with shadcn |

### 3.2 Backend
| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | FastAPI (Python 3.11+) | Async, fast, matches existing stack |
| Task Queue | None in v1 (sync) | Keep simple; add Celery in v2 if needed |
| File Storage | Local /tmp with UUID dirs | Ephemeral, cleaned by cron |
| CORS | fastapi.middleware.cors | Allow frontend origin |

### 3.3 Document Processing Libraries (Python)
| Operation | Library | Notes |
|-----------|---------|-------|
| PDF Merge | pypdf | Pure Python, no system deps |
| PDF Compress | ghostscript (via subprocess) | Best compression; must be installed |
| PDF â†’ DOCX | pdf2docx | Good fidelity |
| DOCX â†’ PDF | LibreOffice headless | Most reliable conversion |
| DOCX â†’ TXT/MD | python-docx + markdownify | |
| TXT/MD â†’ PDF | WeasyPrint | HTML â†’ PDF pipeline |
| MD â†’ DOCX | pandoc (via subprocess) | Best MD â†’ DOCX quality |
| OCR (PDF/Image) | pytesseract + Pillow | Tesseract must be installed |
| OCR (PDF pages) | pdf2image + pytesseract | Convert pages to images first |
| Image â†’ PDF | Pillow | |

### 3.4 System Dependencies (must be installed on server)
```
ghostscript       # PDF compression
tesseract-ocr     # OCR engine
tesseract-ocr-hin # Hindi language pack
poppler-utils     # pdf2image dependency (pdftoppm)
libreoffice       # DOCX â†’ PDF conversion
pandoc            # MD â†” DOCX conversion
```

### 3.5 Dev & Deployment
| Tool | Choice |
|------|--------|
| Package Manager | pnpm (frontend), pip + venv (backend) |
| Linting | ESLint + Prettier (FE), ruff (BE) |
| Deployment (backend) | Railway |
| Deployment (frontend) | Vercel |
| Env Management | .env files, python-dotenv |

---

## 4. App Flow

### 4.1 User Journey (Happy Path)

```
Landing Page
    â”‚
    â”œâ”€â”€ User selects a tool tab: [Merge] [Compress] [OCR] [Convert]
    â”‚
    â–¼
Tool Page
    â”‚
    â”œâ”€â”€ Drop Zone: drag & drop OR click to browse
    â”‚       â””â”€â”€ Files appear as cards with: name, size, type icon, remove button
    â”‚               â””â”€â”€ (Merge only): drag handles for reordering
    â”‚
    â”œâ”€â”€ Options Panel (tool-specific settings)
    â”‚       â”œâ”€â”€ Merge: output format (PDF/DOCX), separator style
    â”‚       â”œâ”€â”€ Compress: quality level slider (Low/Med/High)
    â”‚       â”œâ”€â”€ OCR: output format, language selection
    â”‚       â””â”€â”€ Convert: target format selector
    â”‚
    â”œâ”€â”€ [Process] button
    â”‚       â””â”€â”€ Upload files â†’ show upload progress bar
    â”‚               â””â”€â”€ Processing spinner with status message
    â”‚                       â””â”€â”€ Success: show output file size, [Download] button
    â”‚                               â””â”€â”€ Option to process another batch
    â”‚
    â””â”€â”€ Error States
            â”œâ”€â”€ File too large â†’ inline error on card
            â”œâ”€â”€ Unsupported format â†’ inline error on card
            â””â”€â”€ Server error â†’ toast notification with retry option
```

### 4.2 Page Structure

```
/                       â†’ Landing page with tool cards
/merge                  â†’ Merge tool
/compress               â†’ Compress tool
/ocr                    â†’ OCR tool
/convert                â†’ Convert tool
```

### 4.3 API Endpoints

```
POST /api/merge
  body: multipart/form-data
  fields: files[] (ordered), output_format (pdf|docx)
  returns: { job_id, download_url, output_size }

POST /api/compress
  body: multipart/form-data
  fields: file, quality (low|medium|high)
  returns: { job_id, download_url, original_size, output_size, reduction_pct }

POST /api/ocr
  body: multipart/form-data
  fields: file, output_format (txt|md|pdf), language (eng|hin|auto)
  returns: { job_id, download_url, confidence_scores[] }

POST /api/convert
  body: multipart/form-data
  fields: files[] (batch), target_format
  returns: { job_id, download_url }

GET /api/download/{job_id}
  returns: file stream (Content-Disposition: attachment)

DELETE /api/cleanup/{job_id}
  returns: { success: true }
  note: also called automatically after download
```

---

## 5. Data Schema

> v1 is stateless â€” no database. All state is in-memory (job dict) + filesystem (/tmp).
> Schema shown here for in-memory job tracking only. Add PostgreSQL in v2.

### 5.1 In-Memory Job Store (Python dict)

```python
jobs: dict[str, Job] = {}

class Job(TypedDict):
    job_id: str              # UUID4
    operation: str           # "merge" | "compress" | "ocr" | "convert"
    status: str              # "pending" | "processing" | "done" | "error"
    created_at: datetime
    input_files: list[str]   # file paths in /tmp/{job_id}/input/
    output_file: str | None  # file path in /tmp/{job_id}/output/
    output_size: int | None  # bytes
    error: str | None
    metadata: dict           # operation-specific: confidence scores, reduction %, etc.
```

### 5.2 Filesystem Layout

```
/tmp/docforge/
â””â”€â”€ {job_id}/
    â”œâ”€â”€ input/
    â”‚   â”œâ”€â”€ 0_filename.pdf
    â”‚   â”œâ”€â”€ 1_filename.docx
    â”‚   â””â”€â”€ ...
    â””â”€â”€ output/
        â””â”€â”€ result.pdf
```

### 5.3 Cleanup Policy
- Cron job every 15 minutes: delete any job dir older than 60 minutes
- Immediate cleanup: called after successful download via DELETE /api/cleanup/{job_id}
- On server restart: wipe /tmp/docforge entirely

---

## 6. Implementation Plan

### Phase 1 â€” Foundation + Convert (Week 1)
> Goal: working full-stack skeleton + the Convert tool end-to-end

**Step 1.1 â€” Project scaffold**
- [ ] Create `docforge/` monorepo with `frontend/` and `backend/`
- [ ] Init React + Vite + Tailwind + shadcn/ui in `frontend/`
- [ ] Init FastAPI with virtual env in `backend/`
- [ ] Setup `.env` files, ESLint, ruff, .gitignore

**Step 1.2 â€” Backend core**
- [ ] FastAPI app with CORS, health check `/api/ping`
- [ ] File upload handler (multipart, size validation, type validation)
- [ ] Job store (in-memory dict + UUID)
- [ ] /tmp directory manager + cleanup cron (APScheduler)
- [ ] Download endpoint with Content-Disposition headers

**Step 1.3 â€” Convert tool (backend)**
- [ ] PDF â†’ DOCX (pdf2docx)
- [ ] PDF â†’ TXT (pypdf)
- [ ] PDF â†’ MD (pypdf + formatting)
- [ ] DOCX â†’ PDF (LibreOffice headless)
- [ ] DOCX â†’ TXT / MD (python-docx)
- [ ] TXT â†’ PDF (WeasyPrint)
- [ ] MD â†’ PDF (WeasyPrint with md rendering)
- [ ] MD â†’ DOCX (pandoc)
- [ ] TXT â†” MD (direct text processing)
- [ ] PNG/JPG â†’ PDF (Pillow)

**Step 1.4 â€” Frontend shell**
- [ ] Layout: sidebar nav (Merge / Compress / OCR / Convert) + main area
- [ ] Landing page with 4 tool cards
- [ ] Shared DropZone component (react-dropzone)
- [ ] Shared FileCard component (name, size, type icon, remove)
- [ ] Shared ProgressBar component
- [ ] Convert tool page: format selector, batch upload, download result

**Verification:** Upload a PDF â†’ get DOCX back. Upload MD â†’ get PDF back.

---

### Phase 2 â€” Merge Tool (Week 2)
> Goal: multi-file merge with drag-to-reorder

**Step 2.1 â€” Backend**
- [ ] PDF merge (pypdf PdfMerger)
- [ ] DOCX merge (python-docx append sections)
- [ ] TXT/MD merge (concatenate with H2 separators)
- [ ] Mixed-format merge: convert all to PDF, then merge

**Step 2.2 â€” Frontend**
- [ ] Merge page with @dnd-kit sortable file list
- [ ] Page count display for PDFs (parse on upload via pdfjs-dist)
- [ ] Output format selector
- [ ] Reorder â†’ submit â†’ download flow

**Verification:** Upload 3 PDFs out of order, reorder them, merge, confirm page order in output.

---

### Phase 3 â€” Compress Tool (Week 2â€“3)
> Goal: PDF and DOCX compression with size preview

**Step 3.1 â€” Backend**
- [ ] PDF compress via ghostscript subprocess
  - Low: `-dPDFSETTINGS=/screen` (~72dpi images)
  - Medium: `-dPDFSETTINGS=/ebook` (~150dpi)
  - High: `-dPDFSETTINGS=/printer` (~300dpi, minimal loss)
- [ ] DOCX compress: re-compress embedded images with Pillow, re-save
- [ ] Return original_size, output_size, reduction_pct

**Step 3.2 â€” Frontend**
- [ ] Compress page with quality slider (Low / Medium / High)
- [ ] Size comparison display: "4.2 MB â†’ ~1.1 MB (est.)"
- [ ] Actual size shown post-processing

**Verification:** Upload a 5MB PDF, compress on Low, confirm output < 2MB.

---

### Phase 4 â€” OCR Tool (Week 3)
> Goal: extract text from scanned PDFs and images

**Step 4.1 â€” Backend**
- [ ] Image OCR: pytesseract â†’ TXT/MD
- [ ] PDF OCR: pdf2image (pdftoppm) â†’ per-page images â†’ pytesseract â†’ reassemble
- [ ] Searchable PDF output: embed extracted text layer back into PDF
- [ ] Confidence scores per page
- [ ] Language support: eng, hin, auto (both)

**Step 4.2 â€” Frontend**
- [ ] OCR page: file upload, language selector, output format selector
- [ ] Per-page confidence score display post-processing
- [ ] Preview of extracted text (first 500 chars) before download

**Verification:** Upload a scanned PDF, run OCR, download TXT, confirm text is readable.

---

### Phase 5 â€” Polish + Deployment (Week 4)
- [ ] Error handling: all edge cases, user-friendly messages
- [ ] Mobile responsive audit
- [ ] File cleanup verification (no orphan files after 1hr)
- [ ] Rate limiting on API (slowapi): 20 req/min per IP
- [ ] Loading states, toast notifications (sonner)
- [ ] Deploy backend to Railway
- [ ] Deploy frontend to Vercel
- [ ] Set env vars, test in production

---

## 7. Design Guidelines

### 7.1 Visual Principles
- **Clean and functional** â€” this is a tool, not a portfolio. Whitespace over decoration.
- **No gradients, no shadows** (except subtle card borders)
- **Monochrome-first** with a single accent color (Teal â€” `#1D9E75`)
- Dark mode support via Tailwind `dark:` classes

### 7.2 Color Palette
| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| Background | `#FFFFFF` | `#0F0F0F` | Page bg |
| Surface | `#F9F9F7` | `#1A1A1A` | Cards, panels |
| Border | `#E5E5E0` | `#2A2A2A` | Card borders, dividers |
| Text Primary | `#111111` | `#F0F0EE` | Headings, body |
| Text Muted | `#6B6B65` | `#888880` | Labels, captions |
| Accent (Teal) | `#1D9E75` | `#25C292` | CTAs, active states, icons |
| Danger | `#DC2626` | `#EF4444` | Errors |
| Warning | `#D97706` | `#F59E0B` | Warnings |
| Success | `#16A34A` | `#22C55E` | Success states |

### 7.3 Typography
- Font: `Inter` (system fallback: `-apple-system, sans-serif`)
- Heading 1: `24px / 500`
- Heading 2: `18px / 500`
- Body: `14px / 400 / line-height 1.6`
- Caption: `12px / 400 / muted`
- Code: `JetBrains Mono` or `monospace`

### 7.4 Spacing
- Base unit: `4px`
- Component padding: `16px` (inner), `24px` (card)
- Section gap: `32px`
- Max content width: `860px` centered

### 7.5 Component Patterns

**DropZone:**
- Dashed border `1.5px`, border-radius `12px`
- Hover: solid border, accent tint background
- Contains: upload icon (24px) + primary text + secondary caption

**FileCard:**
- White card, `1px` border, `8px` radius
- Left: file type icon (color-coded: red=PDF, blue=DOCX, gray=TXT/MD)
- Center: filename (truncated), file size
- Right: remove button (Ã—), drag handle (merge only)

**Process Button:**
- Full-width, `44px` height, accent background, white text, `8px` radius
- Loading state: spinner + "Processingâ€¦" text, disabled

**Result Card:**
- Green left border accent
- Shows: output filename, size (with reduction %), download button

### 7.6 File Type Colors
| Format | Icon Color |
|--------|-----------|
| PDF | `#DC2626` (red) |
| DOCX | `#2563EB` (blue) |
| TXT | `#6B6B65` (gray) |
| MD | `#7C3AED` (purple) |
| PNG/JPG | `#D97706` (amber) |

---

## 8. Agent Rules (Antigravity / Codex)

> These rules are **mandatory** for any AI agent working on the DocForge codebase.

### 8.1 General Rules
1. **Never overwrite working code** without explicitly noting what is being replaced and why.
2. **One step at a time.** Complete and verify each step before moving to the next.
3. **Always read existing files before editing them.** Do not assume file contents.
4. **Never delete files** unless the step explicitly says so.
5. **Respect the monorepo structure.** Frontend code goes in `frontend/`, backend in `backend/`. Never mix.

### 8.2 Backend Rules
6. **Use `async def` for all FastAPI route handlers.**
7. **Never use `os.system()`.** Use `subprocess.run()` with `capture_output=True, text=True`.
8. **All file paths must use `pathlib.Path`**, never raw string concatenation.
9. **Every subprocess call must check `returncode`.** Log stderr on failure.
10. **All uploaded files get a UUID job directory under `/tmp/docforge/`**. Never write to the project directory.
11. **Clean up input files immediately after processing.** Only output file stays until download.
12. **Never expose raw Python errors to the client.** Return structured JSON: `{ "error": "human-readable message" }` with appropriate HTTP status codes.
13. **Type-hint every function.** Use `pydantic` models for request/response bodies.
14. **Add a docstring to every route handler** explaining what it does, inputs, and outputs.

### 8.3 Frontend Rules
15. **Never use inline styles** except for dynamic values (e.g. progress bar width). Use Tailwind classes.
16. **Never use `any` TypeScript type.** Define proper interfaces for all API responses.
17. **All API calls go through a centralized `api.ts` service file.** No raw `fetch` or `axios` calls in components.
18. **Every user-visible string is sentence-case.** No Title Case in UI labels.
19. **Handle all three states for async operations:** loading, success, error. Never leave a missing state.
20. **File upload validation happens on the frontend first** (size, type) before sending to the backend.

### 8.4 Code Style Rules
21. **Python:** `ruff` formatting, `snake_case` for all names.
22. **TypeScript/React:** `prettier` formatting, `camelCase` for variables, `PascalCase` for components.
23. **Commit messages:** `feat:`, `fix:`, `chore:`, `docs:` prefixes. One logical change per commit.
24. **No commented-out code** in committed files. Use git history.
25. **Every new backend library added must be added to `requirements.txt`** immediately.
26. **Every new frontend package must be added via `pnpm add`**, never manually to package.json.

### 8.5 Security Rules
27. **Validate file MIME type on the backend** using `python-magic`, not just the file extension.
28. **Sanitize filenames** using `werkzeug.utils.secure_filename` before writing to disk.
29. **Enforce file size limit** on the backend (50 MB per file, 200 MB per job).
30. **Never log file contents.** Log only job IDs, operation types, and file sizes.
31. **Rate limiting is mandatory** before production deploy (slowapi, 20 req/min per IP).

### 8.6 Step Completion Checklist
After completing each implementation step, verify:
- [ ] Feature works end-to-end (upload â†’ process â†’ download)
- [ ] Error case handled (bad file type, oversized file)
- [ ] No console errors in browser
- [ ] No Python tracebacks in server logs
- [ ] New packages documented in requirements.txt / package.json

---

## 9. Build Tracker

### Phase 1 â€” Foundation + Convert
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1a | Monorepo scaffold | ✅ Done | Root-level `frontend/` and `backend/` scaffolded |
| 1.1b | Frontend init (React+Vite+Tailwind+shadcn) | ✅ Done | Vite + React shell created |
| 1.1c | Backend init (FastAPI+venv) | ✅ Done | FastAPI app scaffolded with requirements |
| 1.2a | FastAPI core + CORS + health check | ✅ Done | `/api/ping` is wired up |
| 1.2b | File upload handler + validation | ✅ Done | Shared upload staging, size checks, MIME checks |
| 1.2c | Job store + /tmp manager + cleanup cron | ✅ Done | Thread-safe store and APScheduler cleanup |
| 1.2d | Download endpoint | ✅ Done | Streaming download plus post-download cleanup |
| 1.3a | PDF â†’ DOCX/TXT/MD | ✅ Done | pdf2docx + pypdf converters wired |
| 1.3b | DOCX â†’ PDF/TXT/MD | ✅ Done | LibreOffice path, python-docx, markdownify |
| 1.3c | TXT/MD â†’ PDF | ✅ Done | WeasyPrint HTML rendering path |
| 1.3d | MD â†’ DOCX | ✅ Done | pandoc subprocess route |
| 1.3e | IMG â†’ PDF | ✅ Done | Pillow image-to-PDF path |
| 1.4a | Frontend layout + nav | â¬œ Not started | |
| 1.4b | Landing page | â¬œ Not started | |
| 1.4c | DropZone component | â¬œ Not started | |
| 1.4d | FileCard component | â¬œ Not started | |
| 1.4e | Convert tool page | â¬œ Not started | |

### Phase 2 â€” Merge
| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1a | PDF merge (backend) | â¬œ Not started | |
| 2.1b | DOCX/TXT/MD merge (backend) | â¬œ Not started | |
| 2.2a | Sortable file list (frontend) | â¬œ Not started | |
| 2.2b | Merge page (frontend) | â¬œ Not started | |

### Phase 3 â€” Compress
| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1a | PDF compress via ghostscript | ✅ Done | |
| 3.1b | DOCX image compress | ✅ Done | |
| 3.2a | Compress page (frontend) | ✅ Done | |

### Phase 4 â€” OCR
| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.1a | Image OCR (pytesseract) | ✅ Done | |
| 4.1b | PDF OCR (pdf2image + tesseract) | ✅ Done | |
| 4.1c | Searchable PDF output | ✅ Done | |
| 4.2a | OCR page (frontend) | ✅ Done | |

### Phase 5 â€” Polish + Deploy
| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | Error handling audit | â¬œ Not started | |
| 5.2 | Mobile responsive audit | â¬œ Not started | |
| 5.3 | Rate limiting | â¬œ Not started | |
| 5.4 | Railway deploy (backend) | â¬œ Not started | |
| 5.5 | Vercel deploy (frontend) | â¬œ Not started | |

---

**Status Legend:** â¬œ Not started Â· ðŸ”„ In progress Â· âœ… Done Â· â Œ Blocked

---

*DocForge Master Build Document â€” keep this file updated as the single source of truth.*
