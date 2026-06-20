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

    try {
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
