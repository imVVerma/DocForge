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

  // suppress unused warning for isIdle (kept for potential future use)
  void isIdle;

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
