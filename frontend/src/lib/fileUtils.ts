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
