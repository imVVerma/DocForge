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
  originalSize?: number; // for compress: show reduction %
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
