/**
 * OcrPage — OCR tool UI.
 *
 * Flow:
 *   1. User drops a single scanned PDF or image (PNG/JPG)
 *   2. User selects output format (TXT / MD / Searchable PDF)
 *   3. User selects language (English / Hindi / Auto-detect)
 *   4. "Extract text" triggers: upload → OCR → show result
 *   5. Result shows: confidence score, page count, text preview, download
 *   6. "Run OCR on another file" resets
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { ScanText, RefreshCw } from "lucide-react";

import { DropZone } from "@/components/DropZone";
import { FileCard } from "@/components/FileCard";
import { ProgressBar } from "@/components/ProgressBar";
import { ResultCard } from "@/components/ResultCard";
import { Button } from "@/components/ui/button";

import { validateFiles, getFileExt } from "@/lib/fileUtils";
import {
  uploadFiles,
  runOcr,
  getDownloadUrl,
  cleanupJob,
  OcrResponse,
} from "@/lib/api";

// ------------------------------------------------------------------ //
// Types
// ------------------------------------------------------------------ //

type OutputFormat = "txt" | "md" | "pdf";
type Language = "eng" | "hin" | "auto";
type PageState = "idle" | "uploading" | "processing" | "done" | "error";

interface StagedFile {
  file: File;
  error?: string;
}

// ------------------------------------------------------------------ //
// Config
// ------------------------------------------------------------------ //

const OUTPUT_FORMATS: { value: OutputFormat; label: string; description: string }[] = [
  { value: "txt", label: "Plain text", description: ".txt file" },
  { value: "md",  label: "Markdown",   description: ".md with page headings" },
  { value: "pdf", label: "Searchable PDF", description: "Original PDF + text layer" },
];

const LANGUAGES: { value: Language; label: string; sublabel: string }[] = [
  { value: "eng",  label: "English",     sublabel: "eng" },
  { value: "hin",  label: "Hindi",       sublabel: "hin" },
  { value: "auto", label: "Auto-detect", sublabel: "eng + hin" },
];

// Confidence score → color
function confidenceColor(score: number): string {
  if (score >= 80) return "#16A34A";   // success green
  if (score >= 50) return "#D97706";   // warning amber
  return "#DC2626";                     // danger red
}

function confidenceLabel(score: number): string {
  if (score >= 80) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

// ------------------------------------------------------------------ //
// ConfidenceBar — per-page confidence display
// ------------------------------------------------------------------ //

function ConfidenceBar({ score, page }: { score: number; page: number }) {
  const color = confidenceColor(score);
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-[#6B6B65] dark:text-[#888880] w-12 flex-shrink-0">
        Pg {page}
      </span>
      <div className="flex-1 h-1.5 bg-[#E5E5E0] dark:bg-[#2A2A2A] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span
        className="text-[11px] font-medium w-16 text-right flex-shrink-0"
        style={{ color }}
      >
        {score.toFixed(0)}% {confidenceLabel(score)}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ //
// OcrPage
// ------------------------------------------------------------------ //

export function OcrPage() {
  const [staged, setStaged] = useState<StagedFile | null>(null);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("txt");
  const [language, setLanguage] = useState<Language>("eng");
  const [pageState, setPageState] = useState<PageState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [result, setResult] = useState<OcrResponse | null>(null);

  const isProcessing = pageState === "uploading" || pageState === "processing";

  const isPdfInput = staged ? getFileExt(staged.file) === "pdf" : false;

  // ---------------------------------------------------------------- //
  // File handling
  // ---------------------------------------------------------------- //

  const handleFiles = useCallback((incoming: File[]) => {
    const file = incoming[0];
    if (!file) return;

    const ext = getFileExt(file);
    if (!["pdf", "png", "jpg", "jpeg"].includes(ext)) {
      setStaged({
        file,
        error: "Only scanned PDFs and images (PNG, JPG) are supported.",
      });
      return;
    }

    const errors = validateFiles([file]);
    setStaged({ file, error: errors[0]?.reason });

    // Searchable PDF output only works for PDF input — reset if switching
    if (ext !== "pdf" && outputFormat === "pdf") {
      setOutputFormat("txt");
    }
  }, [outputFormat]);

  const removeFile = useCallback(() => {
    setStaged(null);
  }, []);

  // ---------------------------------------------------------------- //
  // OCR flow
  // ---------------------------------------------------------------- //
  const handleOcr = async () => {
    if (!staged || staged.error) return;

    setPageState("uploading");
    setUploadProgress(0);

    let jobId: string | null = null;

    try {
      const uploadResp = await uploadFiles([staged.file], (pct) =>
        setUploadProgress(pct)
      );
      jobId = uploadResp.job_id;

      setPageState("processing");
      const ocrResp = await runOcr(jobId, outputFormat, language);

      setResult(ocrResp);
      setPageState("done");
    } catch (err: unknown) {
      setPageState("error");
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail ?? "OCR failed. Please try again.");
      if (jobId) await cleanupJob(jobId);
    }
  };

  const handleReset = () => {
    setStaged(null);
    setOutputFormat("txt");
    setLanguage("eng");
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
          <ScanText size={18} className="text-accent dark:text-accent-dark" />
        </div>
        <div>
          <h1 className="text-xl font-medium text-[#111111] dark:text-[#F0F0EE]">
            OCR
          </h1>
          <p className="text-xs text-[#6B6B65] dark:text-[#888880]">
            Extract text from scanned PDFs and images — English and Hindi
          </p>
        </div>
      </div>

      {/* Result state */}
      {pageState === "done" && result && (
        <div className="space-y-4">
          {/* Download */}
          <ResultCard
            filename={result.metadata.output_filename}
            outputSize={result.output_size}
            downloadUrl={getDownloadUrl(result.job_id)}
          />

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Pages", value: String(result.metadata.page_count) },
              {
                label: "Confidence",
                value: `${result.metadata.mean_confidence.toFixed(0)}%`,
              },
              { label: "Language", value: result.metadata.language.toUpperCase() },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="text-center p-3 rounded-lg bg-[#F9F9F7] dark:bg-[#1A1A1A] border border-[#E5E5E0] dark:border-[#2A2A2A]"
              >
                <p className="text-xs text-[#6B6B65] dark:text-[#888880]">{label}</p>
                <p className="text-sm font-medium text-[#111111] dark:text-[#F0F0EE] mt-0.5">
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Per-page confidence bars (show only if multi-page) */}
          {result.metadata.confidence_scores.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#6B6B65] dark:text-[#888880] uppercase tracking-wider">
                Per-page confidence
              </p>
              <div className="space-y-1.5">
                {result.metadata.confidence_scores.map((score, i) => (
                  <ConfidenceBar key={i} score={score} page={i + 1} />
                ))}
              </div>
            </div>
          )}

          {/* Text preview */}
          {result.metadata.text_preview && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-[#6B6B65] dark:text-[#888880] uppercase tracking-wider">
                Text preview
              </p>
              <div className="p-3 rounded-lg bg-[#F9F9F7] dark:bg-[#1A1A1A] border border-[#E5E5E0] dark:border-[#2A2A2A]">
                <p className="text-xs text-[#111111] dark:text-[#F0F0EE] font-mono whitespace-pre-wrap leading-relaxed line-clamp-6">
                  {result.metadata.text_preview}
                </p>
              </div>
            </div>
          )}

          {/* Low confidence warning */}
          {result.metadata.mean_confidence < 50 && (
            <p className="text-xs text-[#D97706] dark:text-[#F59E0B] bg-[#FEF3C7] dark:bg-[#D97706]/10 border border-[#D97706]/30 rounded-lg px-3 py-2">
              Low confidence detected. The document may be a poor scan or contain
              handwriting. Consider rescanning at higher resolution.
            </p>
          )}

          <Button
            variant="outline"
            onClick={handleReset}
            className="w-full border-[#E5E5E0] dark:border-[#2A2A2A] gap-2"
          >
            <RefreshCw size={14} />
            Run OCR on another file
          </Button>
        </div>
      )}

      {/* Upload + OCR state */}
      {pageState !== "done" && (
        <>
          {/* Drop zone */}
          {!staged ? (
            <DropZone
              onFiles={handleFiles}
              multiple={false}
              disabled={isProcessing}
              label="Drop a scanned PDF or image here"
              sublabel="PDF, PNG, JPG — one file at a time"
              accept={{
                "application/pdf": [],
                "image/png": [],
                "image/jpeg": [],
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

          {/* Options — shown when a valid file is staged */}
          {staged && !staged.error && (
            <>
              {/* Output format */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-[#6B6B65] dark:text-[#888880] uppercase tracking-wider">
                  Output format
                </label>
                <div className="flex gap-2 flex-wrap">
                  {OUTPUT_FORMATS.filter(
                    (f) => f.value !== "pdf" || isPdfInput
                  ).map((fmt) => (
                    <button
                      key={fmt.value}
                      onClick={() => setOutputFormat(fmt.value)}
                      disabled={isProcessing}
                      className={[
                        "flex-1 min-w-[100px] p-3 rounded-lg border text-left transition-colors",
                        outputFormat === fmt.value
                          ? "border-accent dark:border-accent-dark bg-accent/10 dark:bg-accent-dark/10"
                          : "border-[#E5E5E0] dark:border-[#2A2A2A] hover:border-[#111111] dark:hover:border-[#F0F0EE]",
                        isProcessing ? "opacity-40 cursor-not-allowed" : "",
                      ].join(" ")}
                    >
                      <p
                        className={[
                          "text-sm font-medium",
                          outputFormat === fmt.value
                            ? "text-accent dark:text-accent-dark"
                            : "text-[#111111] dark:text-[#F0F0EE]",
                        ].join(" ")}
                      >
                        {fmt.label}
                      </p>
                      <p className="text-[11px] text-[#6B6B65] dark:text-[#888880] mt-0.5">
                        {fmt.description}
                      </p>
                    </button>
                  ))}
                </div>
                {!isPdfInput && (
                  <p className="text-[11px] text-[#6B6B65] dark:text-[#888880]">
                    Searchable PDF output is only available for PDF inputs.
                  </p>
                )}
              </div>

              {/* Language */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-[#6B6B65] dark:text-[#888880] uppercase tracking-wider">
                  Language
                </label>
                <div className="flex gap-2">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.value}
                      onClick={() => setLanguage(lang.value)}
                      disabled={isProcessing}
                      className={[
                        "flex-1 py-2 px-3 rounded-lg border text-sm transition-colors",
                        language === lang.value
                          ? "border-accent dark:border-accent-dark bg-accent/10 dark:bg-accent-dark/10 text-accent dark:text-accent-dark font-medium"
                          : "border-[#E5E5E0] dark:border-[#2A2A2A] text-[#6B6B65] dark:text-[#888880] hover:border-[#111111] dark:hover:border-[#F0F0EE]",
                        isProcessing ? "opacity-40 cursor-not-allowed" : "",
                      ].join(" ")}
                    >
                      {lang.label}
                      <span className="block text-[10px] opacity-60 mt-0.5">
                        {lang.sublabel}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Progress */}
          {pageState === "uploading" && (
            <ProgressBar value={uploadProgress} label="Uploading…" />
          )}
          {pageState === "processing" && (
            <ProgressBar value={100} label="Extracting text… (this may take a moment)" />
          )}

          {/* Extract button */}
          <Button
            onClick={handleOcr}
            disabled={!staged || !!staged.error || isProcessing}
            className="w-full h-11 bg-accent hover:bg-accent/90 dark:bg-accent-dark text-white font-medium"
          >
            {isProcessing
              ? pageState === "uploading"
                ? "Uploading…"
                : "Extracting text…"
              : "Extract text"}
          </Button>
        </>
      )}
    </div>
  );
}
