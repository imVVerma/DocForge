# DocForge — Phase 1 Frontend Build Prompt
## Steps 1.4a → 1.4e: Layout · Nav · Landing · DropZone · FileCard · Convert Page

> Hand this entire file to Antigravity / Codex as a single prompt.
> Complete steps in order. Do not skip ahead. Verify each step before proceeding.

---

## Context

The backend is complete and running at `http://localhost:8000`. The frontend scaffold
(React 18 + Vite + Tailwind + shadcn/ui) is in place at `frontend/`.

You are now building the complete frontend shell including:
- App layout with sidebar navigation
- Landing page with 4 tool cards
- Shared `DropZone` component
- Shared `FileCard` component
- Shared `ProgressBar` component
- Centralized `api.ts` service
- Convert tool page — fully wired to the backend (upload → convert → download)

The other three tool pages (Merge, Compress, OCR) get placeholder shells only —
they will be fully built in Phases 2–4.

---

## Design System (follow exactly — no deviations)

### Colors
```
Background:   #FFFFFF (dark: #0F0F0F)
Surface:      #F9F9F7 (dark: #1A1A1A)
Border:       #E5E5E0 (dark: #2A2A2A)
Text primary: #111111 (dark: #F0F0EE)
Text muted:   #6B6B65 (dark: #888880)
Accent teal:  #1D9E75 (dark: #25C292)
Danger:       #DC2626 (dark: #EF4444)
Success:      #16A34A (dark: #22C55E)
```

### Typography
- Font: Inter (import from Google Fonts)
- H1: 24px / font-weight 500
- H2: 18px / font-weight 500
- Body: 14px / line-height 1.6
- Caption: 12px / text-muted

### Spacing
- Base unit: 4px
- Card padding: 24px
- Section gap: 32px
- Max content width: 860px, centered

### File type icon colors
```
PDF:     #DC2626  (red-600)
DOCX:    #2563EB  (blue-600)
TXT:     #6B6B65  (gray, muted)
MD:      #7C3AED  (violet-600)
PNG/JPG: #D97706  (amber-600)
```

### Component rules
- No gradients. No drop shadows (except `shadow-sm` on cards max).
- No Title Case in UI text. Sentence case only.
- DropZone: `1.5px dashed border`, `border-radius: 12px`. Hover: solid border + teal/5 bg tint.
- FileCard: `1px solid border`, `border-radius: 8px`, surface background.
- Process button: full-width, `height: 44px`, accent bg, white text, `border-radius: 8px`.
- Result card: `border-left: 3px solid #16A34A`.

---

## Mandatory Agent Rules (frontend)

1. Read every existing file before editing it. Never assume contents.
2. Never use inline styles except for dynamic values (e.g. progress bar `width`).
3. Never use TypeScript `any`. Define proper interfaces for all API shapes.
4. All API calls go through `src/lib/api.ts` only. No raw `fetch`/`axios` in components.
5. Every async operation must handle all three states: loading, success, error.
6. File validation (size, type) happens on the frontend before any network call.
7. Every user-visible string is sentence-case.
8. New packages must be installed via `pnpm add`. Never manually edit `package.json`.
9. Never use `<form>` HTML elements. Use button `onClick` handlers instead.
10. Dark mode classes (`dark:`) must be added alongside every light mode color class.

---

## Step 1 — Install frontend dependencies

```bash
cd frontend
pnpm add axios react-dropzone lucide-react zustand sonner
pnpm add -D @types/node
```

Confirm shadcn/ui is already initialised (check `components.json` exists).
If not, run:
```bash
pnpm dlx shadcn@latest init
```
Accept defaults: TypeScript, default style, slate base color, `src/components/ui` path.

Then add the shadcn components needed for this phase:
```bash
pnpm dlx shadcn@latest add button badge separator tooltip
```

**Verify:** `pnpm run dev` starts without errors at `http://localhost:5173`.

---

## Step 2 — Configure Tailwind and global styles

### 2a — `frontend/tailwind.config.ts`

Ensure the config extends with the DocForge color tokens so they're available as
Tailwind classes (e.g. `bg-accent`, `text-muted`, `border-surface`):

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: { DEFAULT: "#FFFFFF", dark: "#0F0F0F" },
        surface: { DEFAULT: "#F9F9F7", dark: "#1A1A1A" },
        border: { DEFAULT: "#E5E5E0", dark: "#2A2A2A" },
        "text-primary": { DEFAULT: "#111111", dark: "#F0F0EE" },
        "text-muted": { DEFAULT: "#6B6B65", dark: "#888880" },
        accent: { DEFAULT: "#1D9E75", dark: "#25C292" },
        danger: { DEFAULT: "#DC2626", dark: "#EF4444" },
        success: { DEFAULT: "#16A34A", dark: "#22C55E" },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "sans-serif"],
      },
      maxWidth: {
        content: "860px",
      },
    },
  },
  plugins: [],
};

export default config;
```

### 2b — `frontend/src/styles.css` (or `index.css`)

Read the existing file first. Add or replace with:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  * { box-sizing: border-box; }

  body {
    @apply bg-white text-[#111111] font-sans text-sm leading-relaxed;
  }

  .dark body {
    @apply bg-[#0F0F0F] text-[#F0F0EE];
  }
}
```

**Verify:** dev server still runs, Inter font loads in browser.

---

## Step 3 — Create `frontend/src/lib/api.ts`

This is the single file all components use for backend communication. No component
should import axios or call fetch directly.

```ts
/**
 * DocForge API service.
 * All backend communication goes through this file.
 * Base URL is read from VITE_API_URL env var (defaults to localhost:8000).
 */

import axios, { AxiosProgressEvent } from "axios";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

const client = axios.create({ baseURL: BASE_URL });

// ------------------------------------------------------------------ //
// Types
// ------------------------------------------------------------------ //

export interface UploadResponse {
  job_id: string;
  status: string;
}

export interface ConvertResponse {
  job_id: string;
  status: string;
  download_url: string;
  output_size: number;
  metadata: {
    output_filename: string;
    file_count: number;
  };
}

export interface ApiError {
  detail: string;
}

// ------------------------------------------------------------------ //
// Upload
// ------------------------------------------------------------------ //

export async function uploadFiles(
  files: File[],
  onProgress?: (pct: number) => void
): Promise<UploadResponse> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));

  const { data } = await client.post<UploadResponse>("/api/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e: AxiosProgressEvent) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });

  return data;
}

// ------------------------------------------------------------------ //
// Convert
// ------------------------------------------------------------------ //

export async function convertFiles(
  jobId: string,
  targetFormat: string
): Promise<ConvertResponse> {
  const form = new FormData();
  form.append("job_id", jobId);
  form.append("target_format", targetFormat);

  const { data } = await client.post<ConvertResponse>("/api/convert", form);
  return data;
}

// ------------------------------------------------------------------ //
// Download
// ------------------------------------------------------------------ //

export function getDownloadUrl(jobId: string): string {
  return `${BASE_URL}/api/download/${jobId}`;
}

// ------------------------------------------------------------------ //
// Cleanup
// ------------------------------------------------------------------ //

export async function cleanupJob(jobId: string): Promise<void> {
  await client.delete(`/api/cleanup/${jobId}`).catch(() => {
    // Cleanup failures are non-fatal — job TTL will handle it
  });
}
```

Create `frontend/.env.development`:
```
VITE_API_URL=http://localhost:8000
```

---

## Step 4 — Create `frontend/src/lib/fileUtils.ts`

Shared file validation and formatting utilities used by all tool pages:

```ts
/**
 * File utility helpers — validation, formatting, type detection.
 * Used by DropZone and FileCard components.
 */

// ------------------------------------------------------------------ //
// Constants
// ------------------------------------------------------------------ //

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_TOTAL_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "image/png",
  "image/jpeg",
] as const;

export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

// ------------------------------------------------------------------ //
// Type detection
// ------------------------------------------------------------------ //

export type FileExt = "pdf" | "docx" | "txt" | "md" | "png" | "jpg" | "unknown";

export function getFileExt(file: File): FileExt {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".txt")) return "txt";
  if (name.endsWith(".md")) return "md";
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpg";
  return "unknown";
}

export const FILE_EXT_COLORS: Record<FileExt, string> = {
  pdf: "#DC2626",
  docx: "#2563EB",
  txt: "#6B6B65",
  md: "#7C3AED",
  png: "#D97706",
  jpg: "#D97706",
  unknown: "#6B6B65",
};

export const FILE_EXT_LABELS: Record<FileExt, string> = {
  pdf: "PDF",
  docx: "DOCX",
  txt: "TXT",
  md: "MD",
  png: "PNG",
  jpg: "JPG",
  unknown: "FILE",
};

// What each source ext can convert to
export const CONVERT_TARGETS: Partial<Record<FileExt, string[]>> = {
  pdf: ["docx", "txt", "md"],
  docx: ["pdf", "txt", "md"],
  txt: ["pdf", "md", "docx"],
  md: ["pdf", "docx", "txt"],
  png: ["pdf"],
  jpg: ["pdf"],
};

// ------------------------------------------------------------------ //
// Validation
// ------------------------------------------------------------------ //

export interface FileValidationError {
  file: File;
  reason: string;
}

export function validateFiles(files: File[]): FileValidationError[] {
  const errors: FileValidationError[] = [];

  let totalSize = 0;

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      errors.push({
        file,
        reason: `File exceeds 50 MB limit (${formatBytes(file.size)})`,
      });
      continue;
    }

    if (getFileExt(file) === "unknown") {
      errors.push({
        file,
        reason: "Unsupported file type. Allowed: PDF, DOCX, TXT, MD, PNG, JPG",
      });
      continue;
    }

    totalSize += file.size;
  }

  if (totalSize > MAX_TOTAL_SIZE_BYTES) {
    // Add a general error (not tied to a specific file)
    errors.push({
      file: files[0],
      reason: `Total upload size ${formatBytes(totalSize)} exceeds the 200 MB limit`,
    });
  }

  return errors;
}

// ------------------------------------------------------------------ //
// Formatting
// ------------------------------------------------------------------ //

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
```

---

## Step 5 — Create shared components

### 5a — `frontend/src/components/DropZone.tsx`

```tsx
/**
 * DropZone — shared file drop area used by all tool pages.
 *
 * Props:
 *   onFiles: called with the accepted File[] when files are dropped or selected
 *   accept: optional MIME type map (defaults to all allowed types)
 *   multiple: allow multiple files (default true)
 *   disabled: grey out and block interaction
 *   label: primary label text (default "Drop files here")
 *   sublabel: secondary caption text
 */

import { useDropzone } from "react-dropzone";
import { UploadCloud } from "lucide-react";
import { ALLOWED_MIME_TYPES } from "@/lib/fileUtils";

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  accept?: Record<string, string[]>;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  sublabel?: string;
}

const DEFAULT_ACCEPT = Object.fromEntries(
  ALLOWED_MIME_TYPES.map((mime) => [mime, []])
);

export function DropZone({
  onFiles,
  accept = DEFAULT_ACCEPT,
  multiple = true,
  disabled = false,
  label = "Drop files here",
  sublabel = "or click to browse",
}: DropZoneProps) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onFiles,
    accept,
    multiple,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={[
        "flex flex-col items-center justify-center gap-3",
        "border-[1.5px] border-dashed rounded-xl p-10 cursor-pointer",
        "transition-colors duration-150",
        isDragActive
          ? "border-accent bg-accent/5 dark:border-accent-dark dark:bg-accent-dark/5"
          : "border-[#E5E5E0] dark:border-[#2A2A2A]",
        disabled
          ? "opacity-40 cursor-not-allowed pointer-events-none"
          : "hover:border-accent dark:hover:border-accent-dark hover:bg-accent/5",
      ].join(" ")}
    >
      <input {...getInputProps()} />
      <UploadCloud
        size={32}
        className={
          isDragActive
            ? "text-accent dark:text-accent-dark"
            : "text-[#6B6B65] dark:text-[#888880]"
        }
      />
      <div className="text-center">
        <p className="text-sm font-medium text-[#111111] dark:text-[#F0F0EE]">
          {isDragActive ? "Release to upload" : label}
        </p>
        <p className="text-xs text-[#6B6B65] dark:text-[#888880] mt-1">
          {sublabel}
        </p>
      </div>
    </div>
  );
}
```

### 5b — `frontend/src/components/FileCard.tsx`

```tsx
/**
 * FileCard — displays a single staged file with type badge, size, and remove button.
 * Used by all tool pages. Merge adds drag handles (Phase 2).
 */

import { X, FileText, FileType, File } from "lucide-react";
import { formatBytes, getFileExt, FILE_EXT_COLORS, FILE_EXT_LABELS, FileExt } from "@/lib/fileUtils";

interface FileCardProps {
  file: File;
  onRemove: () => void;
  error?: string;
  disabled?: boolean;
}

function FileIcon({ ext }: { ext: FileExt }) {
  const color = FILE_EXT_COLORS[ext];
  const style = { color };

  if (ext === "pdf") return <FileType size={20} style={style} />;
  if (ext === "docx") return <FileText size={20} style={style} />;
  return <File size={20} style={style} />;
}

export function FileCard({ file, onRemove, error, disabled }: FileCardProps) {
  const ext = getFileExt(file);
  const label = FILE_EXT_LABELS[ext];
  const color = FILE_EXT_COLORS[ext];

  return (
    <div
      className={[
        "flex items-center gap-3 px-4 py-3 rounded-lg border",
        "bg-[#F9F9F7] dark:bg-[#1A1A1A]",
        error
          ? "border-danger dark:border-danger-dark"
          : "border-[#E5E5E0] dark:border-[#2A2A2A]",
      ].join(" ")}
    >
      {/* Icon */}
      <FileIcon ext={ext} />

      {/* Name + size */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#111111] dark:text-[#F0F0EE] truncate">
          {file.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ color, backgroundColor: `${color}18` }}
          >
            {label}
          </span>
          <span className="text-xs text-[#6B6B65] dark:text-[#888880]">
            {formatBytes(file.size)}
          </span>
        </div>
        {error && (
          <p className="text-xs text-danger dark:text-danger-dark mt-1">{error}</p>
        )}
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        disabled={disabled}
        className={[
          "p-1 rounded-md text-[#6B6B65] dark:text-[#888880]",
          "hover:text-danger dark:hover:text-danger-dark",
          "hover:bg-danger/10 transition-colors",
          disabled ? "opacity-40 cursor-not-allowed" : "",
        ].join(" ")}
        aria-label={`Remove ${file.name}`}
      >
        <X size={16} />
      </button>
    </div>
  );
}
```

### 5c — `frontend/src/components/ProgressBar.tsx`

```tsx
/**
 * ProgressBar — upload/processing progress indicator.
 * Shows percentage with animated fill.
 */

interface ProgressBarProps {
  value: number;       // 0–100
  label?: string;
  className?: string;
}

export function ProgressBar({ value, label, className = "" }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <div className="flex justify-between items-center">
          <span className="text-xs text-[#6B6B65] dark:text-[#888880]">{label}</span>
          <span className="text-xs font-medium text-[#111111] dark:text-[#F0F0EE]">
            {clamped}%
          </span>
        </div>
      )}
      <div className="h-1.5 bg-[#E5E5E0] dark:bg-[#2A2A2A] rounded-full overflow-hidden">
        <div
          className="h-full bg-accent dark:bg-accent-dark rounded-full transition-all duration-300"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
```

### 5d — `frontend/src/components/ResultCard.tsx`

```tsx
/**
 * ResultCard — shown after successful processing.
 * Displays output filename, size, and a download button.
 * Optionally shows size reduction (for compress tool).
 */

import { Download, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/fileUtils";

interface ResultCardProps {
  filename: string;
  outputSize: number;
  downloadUrl: string;
  originalSize?: number;    // for compress: show reduction %
  onDownloadComplete?: () => void;
}

export function ResultCard({
  filename,
  outputSize,
  downloadUrl,
  originalSize,
  onDownloadComplete,
}: ResultCardProps) {
  const reduction =
    originalSize && originalSize > 0
      ? Math.round((1 - outputSize / originalSize) * 100)
      : null;

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = filename;
    a.click();
    onDownloadComplete?.();
  };

  return (
    <div className="flex items-center gap-4 px-4 py-4 rounded-lg border border-[#E5E5E0] dark:border-[#2A2A2A] bg-[#F9F9F7] dark:bg-[#1A1A1A] border-l-[3px] border-l-success">
      <CheckCircle2 size={20} className="text-success dark:text-success-dark flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#111111] dark:text-[#F0F0EE] truncate">
          {filename}
        </p>
        <p className="text-xs text-[#6B6B65] dark:text-[#888880] mt-0.5">
          {formatBytes(outputSize)}
          {reduction !== null && reduction > 0 && (
            <span className="ml-2 text-success dark:text-success-dark font-medium">
              ↓ {reduction}% smaller
            </span>
          )}
        </p>
      </div>

      <Button
        onClick={handleDownload}
        size="sm"
        className="bg-accent hover:bg-accent/90 dark:bg-accent-dark text-white gap-2 flex-shrink-0"
      >
        <Download size={14} />
        Download
      </Button>
    </div>
  );
}
```

---

## Step 6 — Create app layout and routing

### 6a — Install router

```bash
pnpm add wouter
```

### 6b — `frontend/src/components/Layout.tsx`

```tsx
/**
 * App shell layout.
 * Sidebar navigation on desktop, bottom tab bar on mobile.
 */

import { Link, useLocation } from "wouter";
import { FileOutput, Layers, Minimize2, ScanText, Zap } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Zap },
  { href: "/convert", label: "Convert", icon: FileOutput },
  { href: "/merge", label: "Merge", icon: Layers },
  { href: "/compress", label: "Compress", icon: Minimize2 },
  { href: "/ocr", label: "OCR", icon: ScanText },
] as const;

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-white dark:bg-[#0F0F0F] flex">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-52 border-r border-[#E5E5E0] dark:border-[#2A2A2A] p-4 gap-1 flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 px-2 py-3 mb-4">
          <div className="w-7 h-7 rounded-lg bg-accent dark:bg-accent-dark flex items-center justify-center">
            <Zap size={14} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-[#111111] dark:text-[#F0F0EE]">
            DocForge
          </span>
        </div>

        {/* Nav links */}
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
          return (
            <Link key={href} href={href}>
              <a
                className={[
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-accent/10 dark:bg-accent-dark/10 text-accent dark:text-accent-dark font-medium"
                    : "text-[#6B6B65] dark:text-[#888880] hover:bg-[#F9F9F7] dark:hover:bg-[#1A1A1A] hover:text-[#111111] dark:hover:text-[#F0F0EE]",
                ].join(" ")}
              >
                <Icon size={16} />
                {label}
              </a>
            </Link>
          );
        })}
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-h-screen">
        <div className="flex-1 w-full max-w-content mx-auto px-6 py-8">
          {children}
        </div>
      </main>

      {/* Bottom tab bar — mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-[#E5E5E0] dark:border-[#2A2A2A] bg-white dark:bg-[#0F0F0F] flex justify-around px-2 py-2 z-50">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
          return (
            <Link key={href} href={href}>
              <a
                className={[
                  "flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] transition-colors",
                  active
                    ? "text-accent dark:text-accent-dark"
                    : "text-[#6B6B65] dark:text-[#888880]",
                ].join(" ")}
              >
                <Icon size={18} />
                {label}
              </a>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
```

---

## Step 7 — Create pages

### 7a — `frontend/src/pages/LandingPage.tsx`

```tsx
/**
 * Landing page — four tool cards that navigate to each tool.
 */

import { useLocation } from "wouter";
import { FileOutput, Layers, Minimize2, ScanText } from "lucide-react";

const TOOLS = [
  {
    href: "/convert",
    icon: FileOutput,
    label: "Convert",
    description: "PDF, DOCX, TXT, and MD — convert between any supported format.",
    formats: ["PDF", "DOCX", "TXT", "MD"],
  },
  {
    href: "/merge",
    icon: Layers,
    label: "Merge",
    description: "Combine multiple documents into one. Drag to reorder before merging.",
    formats: ["PDF", "DOCX", "TXT", "MD"],
  },
  {
    href: "/compress",
    icon: Minimize2,
    label: "Compress",
    description: "Reduce file size with three quality levels — low, medium, or high.",
    formats: ["PDF", "DOCX"],
  },
  {
    href: "/ocr",
    icon: ScanText,
    label: "OCR",
    description: "Extract text from scanned PDFs and images. Supports English and Hindi.",
    formats: ["PDF", "PNG", "JPG"],
  },
] as const;

export function LandingPage() {
  const [, navigate] = useLocation();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-medium text-[#111111] dark:text-[#F0F0EE]">
          Document toolkit
        </h1>
        <p className="text-sm text-[#6B6B65] dark:text-[#888880] mt-1">
          Convert, merge, compress, and extract text from your documents — no account needed.
        </p>
      </div>

      {/* Tool cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {TOOLS.map(({ href, icon: Icon, label, description, formats }) => (
          <button
            key={href}
            onClick={() => navigate(href)}
            className={[
              "text-left p-6 rounded-xl border border-[#E5E5E0] dark:border-[#2A2A2A]",
              "bg-[#F9F9F7] dark:bg-[#1A1A1A]",
              "hover:border-accent dark:hover:border-accent-dark",
              "transition-colors duration-150 group",
            ].join(" ")}
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-accent/10 dark:bg-accent-dark/10 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/15 transition-colors">
                <Icon size={20} className="text-accent dark:text-accent-dark" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-medium text-[#111111] dark:text-[#F0F0EE]">
                  {label}
                </h2>
                <p className="text-sm text-[#6B6B65] dark:text-[#888880] mt-1 leading-relaxed">
                  {description}
                </p>
                <div className="flex gap-1.5 mt-3 flex-wrap">
                  {formats.map((f) => (
                    <span
                      key={f}
                      className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#E5E5E0] dark:bg-[#2A2A2A] text-[#6B6B65] dark:text-[#888880]"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Privacy note */}
      <p className="text-xs text-[#6B6B65] dark:text-[#888880]">
        Files are processed on our server and deleted immediately after download. Nothing is stored.
      </p>
    </div>
  );
}
```

### 7b — `frontend/src/pages/ConvertPage.tsx`

This is the fully wired Convert tool page. It handles the complete flow:
upload → select target format → convert → show result → download.

```tsx
/**
 * ConvertPage — Convert tool UI.
 *
 * Flow:
 *   1. User drops files into DropZone
 *   2. Files validated client-side (type, size)
 *   3. User selects target format (filtered by source type)
 *   4. "Convert" button triggers: upload → convert → show result
 *   5. ResultCard shows output with download button
 *   6. "Convert more" resets the page
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { FileOutput, RefreshCw } from "lucide-react";

import { DropZone } from "@/components/DropZone";
import { FileCard } from "@/components/FileCard";
import { ProgressBar } from "@/components/ProgressBar";
import { ResultCard } from "@/components/ResultCard";
import { Button } from "@/components/ui/button";

import {
  validateFiles,
  getFileExt,
  CONVERT_TARGETS,
  FileExt,
} from "@/lib/fileUtils";
import {
  uploadFiles,
  convertFiles,
  getDownloadUrl,
  cleanupJob,
  ConvertResponse,
} from "@/lib/api";

// ------------------------------------------------------------------ //
// Types
// ------------------------------------------------------------------ //

type PageState = "idle" | "uploading" | "converting" | "done" | "error";

interface StagedFile {
  file: File;
  error?: string;
}

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

/** Returns the intersection of allowed targets across all files. */
function getCommonTargets(files: File[]): string[] {
  if (files.length === 0) return [];

  const targetSets = files.map((f) => {
    const ext = getFileExt(f) as FileExt;
    return new Set(CONVERT_TARGETS[ext] ?? []);
  });

  const [first, ...rest] = targetSets;
  const intersection = [...first].filter((t) => rest.every((s) => s.has(t)));
  return intersection;
}

const FORMAT_LABELS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word document (.docx)",
  txt: "Plain text (.txt)",
  md: "Markdown (.md)",
};

// ------------------------------------------------------------------ //
// Component
// ------------------------------------------------------------------ //

export function ConvertPage() {
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [targetFormat, setTargetFormat] = useState<string>("");
  const [pageState, setPageState] = useState<PageState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<ConvertResponse | null>(null);

  const isIdle = pageState === "idle";
  const isProcessing = pageState === "uploading" || pageState === "converting";

  // ---------------------------------------------------------------- //
  // File handling
  // ---------------------------------------------------------------- //

  const handleFiles = useCallback((incoming: File[]) => {
    const errors = validateFiles(incoming);
    const errorMap = new Map(errors.map((e) => [e.file.name, e.reason]));

    const newStaged: StagedFile[] = incoming.map((file) => ({
      file,
      error: errorMap.get(file.name),
    }));

    setStagedFiles((prev) => [...prev, ...newStaged]);
    setTargetFormat(""); // reset format when files change
  }, []);

  const removeFile = useCallback((index: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index));
    setTargetFormat("");
  }, []);

  const validFiles = stagedFiles.filter((sf) => !sf.error).map((sf) => sf.file);
  const hasErrors = stagedFiles.some((sf) => sf.error);
  const commonTargets = getCommonTargets(validFiles);

  // ---------------------------------------------------------------- //
  // Convert flow
  // ---------------------------------------------------------------- //

  const handleConvert = async () => {
    if (validFiles.length === 0 || !targetFormat) return;

    setPageState("uploading");
    setUploadProgress(0);

    let jobId: string | null = null;

    try {
      // Step 1: Upload
      const uploadResp = await uploadFiles(validFiles, (pct) => {
        setUploadProgress(pct);
      });
      jobId = uploadResp.job_id;

      // Step 2: Convert
      setPageState("converting");
      const convertResp = await convertFiles(jobId, targetFormat);

      setResult(convertResp);
      setPageState("done");
    } catch (err: unknown) {
      setPageState("error");
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.";
      toast.error(message);

      // Clean up the job if upload succeeded but convert failed
      if (jobId) {
        await cleanupJob(jobId);
      }
    }
  };

  const handleReset = () => {
    setStagedFiles([]);
    setTargetFormat("");
    setPageState("idle");
    setUploadProgress(0);
    setResult(null);
  };

  // ---------------------------------------------------------------- //
  // Render
  // ---------------------------------------------------------------- //

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent/10 dark:bg-accent-dark/10 flex items-center justify-center">
          <FileOutput size={18} className="text-accent dark:text-accent-dark" />
        </div>
        <div>
          <h1 className="text-xl font-medium text-[#111111] dark:text-[#F0F0EE]">
            Convert
          </h1>
          <p className="text-xs text-[#6B6B65] dark:text-[#888880]">
            PDF · DOCX · TXT · MD · PNG · JPG — up to 10 files, 50 MB each
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
          <Button
            variant="outline"
            onClick={handleReset}
            className="w-full border-[#E5E5E0] dark:border-[#2A2A2A] gap-2"
          >
            <RefreshCw size={14} />
            Convert more files
          </Button>
        </div>
      )}

      {/* Upload + convert state */}
      {pageState !== "done" && (
        <>
          {/* Drop zone */}
          <DropZone
            onFiles={handleFiles}
            disabled={isProcessing}
            label={
              stagedFiles.length > 0
                ? "Drop more files"
                : "Drop files here"
            }
            sublabel="PDF, DOCX, TXT, MD, PNG, JPG — up to 10 files"
          />

          {/* File list */}
          {stagedFiles.length > 0 && (
            <div className="space-y-2">
              {stagedFiles.map((sf, i) => (
                <FileCard
                  key={`${sf.file.name}-${i}`}
                  file={sf.file}
                  onRemove={() => removeFile(i)}
                  error={sf.error}
                  disabled={isProcessing}
                />
              ))}
            </div>
          )}

          {/* Target format selector */}
          {validFiles.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#6B6B65] dark:text-[#888880] uppercase tracking-wider">
                Convert to
              </label>
              {commonTargets.length === 0 ? (
                <p className="text-sm text-danger dark:text-danger-dark">
                  No common target format for the selected files.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {commonTargets.map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setTargetFormat(fmt)}
                      disabled={isProcessing}
                      className={[
                        "px-3 py-1.5 rounded-lg border text-sm transition-colors",
                        targetFormat === fmt
                          ? "border-accent dark:border-accent-dark bg-accent/10 dark:bg-accent-dark/10 text-accent dark:text-accent-dark font-medium"
                          : "border-[#E5E5E0] dark:border-[#2A2A2A] text-[#6B6B65] dark:text-[#888880] hover:border-[#111111] dark:hover:border-[#F0F0EE]",
                        isProcessing ? "opacity-40 cursor-not-allowed" : "",
                      ].join(" ")}
                    >
                      {FORMAT_LABELS[fmt] ?? fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Progress bars (during processing) */}
          {pageState === "uploading" && (
            <ProgressBar value={uploadProgress} label="Uploading…" />
          )}
          {pageState === "converting" && (
            <ProgressBar value={100} label="Converting…" />
          )}

          {/* Convert button */}
          <Button
            onClick={handleConvert}
            disabled={
              validFiles.length === 0 ||
              !targetFormat ||
              hasErrors ||
              isProcessing
            }
            className="w-full h-11 bg-accent hover:bg-accent/90 dark:bg-accent-dark text-white font-medium"
          >
            {isProcessing ? "Processing…" : "Convert"}
          </Button>
        </>
      )}
    </div>
  );
}
```

### 7c — Placeholder pages for Merge, Compress, OCR

Create three minimal placeholder pages. They will be fully implemented in Phases 2–4.

**`frontend/src/pages/MergePage.tsx`**
```tsx
import { Layers } from "lucide-react";

export function MergePage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent/10 dark:bg-accent-dark/10 flex items-center justify-center">
          <Layers size={18} className="text-accent dark:text-accent-dark" />
        </div>
        <div>
          <h1 className="text-xl font-medium text-[#111111] dark:text-[#F0F0EE]">Merge</h1>
          <p className="text-xs text-[#6B6B65] dark:text-[#888880]">Coming in Phase 2</p>
        </div>
      </div>
      <div className="border border-dashed border-[#E5E5E0] dark:border-[#2A2A2A] rounded-xl p-12 text-center">
        <p className="text-sm text-[#6B6B65] dark:text-[#888880]">
          Merge will be implemented in the next phase.
        </p>
      </div>
    </div>
  );
}
```

**`frontend/src/pages/CompressPage.tsx`**
```tsx
import { Minimize2 } from "lucide-react";

export function CompressPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent/10 dark:bg-accent-dark/10 flex items-center justify-center">
          <Minimize2 size={18} className="text-accent dark:text-accent-dark" />
        </div>
        <div>
          <h1 className="text-xl font-medium text-[#111111] dark:text-[#F0F0EE]">Compress</h1>
          <p className="text-xs text-[#6B6B65] dark:text-[#888880]">Coming in Phase 3</p>
        </div>
      </div>
      <div className="border border-dashed border-[#E5E5E0] dark:border-[#2A2A2A] rounded-xl p-12 text-center">
        <p className="text-sm text-[#6B6B65] dark:text-[#888880]">
          Compress will be implemented in the next phase.
        </p>
      </div>
    </div>
  );
}
```

**`frontend/src/pages/OcrPage.tsx`**
```tsx
import { ScanText } from "lucide-react";

export function OcrPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent/10 dark:bg-accent-dark/10 flex items-center justify-center">
          <ScanText size={18} className="text-accent dark:text-accent-dark" />
        </div>
        <div>
          <h1 className="text-xl font-medium text-[#111111] dark:text-[#F0F0EE]">OCR</h1>
          <p className="text-xs text-[#6B6B65] dark:text-[#888880]">Coming in Phase 4</p>
        </div>
      </div>
      <div className="border border-dashed border-[#E5E5E0] dark:border-[#2A2A2A] rounded-xl p-12 text-center">
        <p className="text-sm text-[#6B6B65] dark:text-[#888880]">
          OCR will be implemented in the next phase.
        </p>
      </div>
    </div>
  );
}
```

---

## Step 8 — Wire everything in `frontend/src/main.tsx`

Read the existing `main.tsx`. Replace or update it to:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { Route, Switch } from "wouter";
import { Toaster } from "sonner";

import { Layout } from "@/components/Layout";
import { LandingPage } from "@/pages/LandingPage";
import { ConvertPage } from "@/pages/ConvertPage";
import { MergePage } from "@/pages/MergePage";
import { CompressPage } from "@/pages/CompressPage";
import { OcrPage } from "@/pages/OcrPage";

import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Layout>
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/convert" component={ConvertPage} />
        <Route path="/merge" component={MergePage} />
        <Route path="/compress" component={CompressPage} />
        <Route path="/ocr" component={OcrPage} />
        <Route>
          <div className="text-center py-20 text-[#6B6B65] dark:text-[#888880]">
            <p className="text-lg font-medium">Page not found</p>
            <a href="/" className="text-sm text-accent dark:text-accent-dark mt-2 block">
              Go home
            </a>
          </div>
        </Route>
      </Switch>
    </Layout>
    <Toaster position="bottom-right" richColors />
  </React.StrictMode>
);
```

Add path alias to `frontend/vite.config.ts` (read existing file first, add only what's missing):
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

Add to `frontend/tsconfig.json` under `compilerOptions`:
```json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

---

## Step 9 — End-to-end smoke test

Ensure the backend is running at `http://localhost:8000`, then:

```bash
cd frontend
pnpm run dev
```

Open `http://localhost:5173` and manually test:

**Test 1 — Navigation**
- [ ] Landing page loads with 4 tool cards
- [ ] Clicking each card navigates to the correct route
- [ ] Sidebar shows active state for the current route
- [ ] Back button / URL bar navigation works

**Test 2 — Convert: valid flow**
- [ ] Drop a `.txt` file into the Convert page DropZone
- [ ] File appears as a FileCard with TXT badge and correct size
- [ ] Format buttons appear: PDF, MD, DOCX
- [ ] Select "MD" — button highlights in teal
- [ ] Click "Convert" — upload progress bar appears
- [ ] Processing spinner appears
- [ ] ResultCard appears with filename and size
- [ ] Click "Download" — file downloads, opens correctly
- [ ] Click "Convert more files" — page resets cleanly

**Test 3 — Convert: error states**
- [ ] Drop an oversized file (>50 MB) — FileCard shows inline error, convert button stays disabled
- [ ] Drop a `.gif` file — FileCard shows "unsupported file type" error
- [ ] Drop a `.png` + a `.pdf` — format buttons show only the common target (PDF, since png→pdf only)

**Test 4 — Batch convert**
- [ ] Drop 2 `.txt` files
- [ ] Select "PDF" as target
- [ ] Convert — ResultCard shows a `.zip` filename
- [ ] Download zip, confirm it contains 2 PDFs

**Test 5 — Mobile layout**
- [ ] Resize browser to 375px width
- [ ] Sidebar disappears, bottom tab bar appears
- [ ] All pages still usable

---

## Verification Checklist

Before marking Steps 1.4a–1.4e done, confirm every item:

- [ ] `pnpm run dev` starts with zero TypeScript errors
- [ ] `pnpm run build` completes without errors
- [ ] Landing page renders 4 tool cards, each navigates correctly
- [ ] Sidebar active state updates on navigation
- [ ] DropZone accepts drag-and-drop and click-to-browse
- [ ] FileCard shows correct icon color per file type
- [ ] Oversized file shows inline error on FileCard, not a toast
- [ ] Unsupported file type shows inline error on FileCard
- [ ] Format selector shows only valid targets for the dropped files
- [ ] Upload progress bar animates during upload
- [ ] Converting state shows a full-width progress bar
- [ ] ResultCard shows filename, size, and working download button
- [ ] "Convert more files" resets all state cleanly
- [ ] Toast appears on network/server error
- [ ] No `console.error` in browser DevTools during happy path
- [ ] Mobile layout (≤768px): bottom tab bar visible, sidebar hidden
- [ ] Zero inline styles except `width` on ProgressBar fill
- [ ] Zero TypeScript `any` types

---

## Files created / modified this step

```
frontend/
├── .env.development                        ← NEW
├── vite.config.ts                          ← updated (@ alias)
├── tsconfig.json                           ← updated (paths)
├── tailwind.config.ts                      ← updated (color tokens)
├── src/
│   ├── styles.css                          ← updated (Inter font, base styles)
│   ├── main.tsx                            ← updated (router, Layout, Toaster)
│   ├── lib/
│   │   ├── api.ts                          ← NEW
│   │   └── fileUtils.ts                    ← NEW
│   ├── components/
│   │   ├── Layout.tsx                      ← NEW
│   │   ├── DropZone.tsx                    ← NEW
│   │   ├── FileCard.tsx                    ← NEW
│   │   ├── ProgressBar.tsx                 ← NEW
│   │   └── ResultCard.tsx                  ← NEW
│   └── pages/
│       ├── LandingPage.tsx                 ← NEW
│       ├── ConvertPage.tsx                 ← NEW
│       ├── MergePage.tsx                   ← NEW (placeholder)
│       ├── CompressPage.tsx                ← NEW (placeholder)
│       └── OcrPage.tsx                     ← NEW (placeholder)
```

---

## Tracker update

After all checklist items pass, update `DOCFORGE_MASTER.md`:

| Task | New status |
|------|-----------|
| 1.4a Frontend layout + nav | ✅ Done |
| 1.4b Landing page | ✅ Done |
| 1.4c DropZone component | ✅ Done |
| 1.4d FileCard component | ✅ Done |
| 1.4e Convert tool page | ✅ Done |

---

*Phase 1 complete after this step. Next: Phase 2 — Merge tool (backend + frontend).*
