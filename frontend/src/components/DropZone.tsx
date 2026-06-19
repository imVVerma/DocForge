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
