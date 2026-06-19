/**
 * FileCard — displays a single staged file with type badge, size, and remove button.
 * Used by all tool pages. Merge adds drag handles (Phase 2).
 */

import { X, FileText, FileType, File } from "lucide-react";
import {
  formatBytes,
  getFileExt,
  FILE_EXT_COLORS,
  FILE_EXT_LABELS,
  FileExt,
} from "@/lib/fileUtils";

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
