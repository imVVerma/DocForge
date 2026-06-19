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
import { Layers, RefreshCw, GripVertical, FileText, FileType, File as FileIcon } from "lucide-react";

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

import {
  validateFiles,
  getFileExt,
  formatBytes,
  FILE_EXT_COLORS,
  FILE_EXT_LABELS,
  FileExt,
} from "@/lib/fileUtils";
import {
  uploadFiles,
  mergeFiles,
  getDownloadUrl,
  cleanupJob,
  MergeResponse,
} from "@/lib/api";

// ------------------------------------------------------------------ //
// Types
// ------------------------------------------------------------------ //

type PageState = "idle" | "uploading" | "merging" | "done" | "error";

interface StagedFile {
  id: string;       // unique id for dnd-kit
  file: File;
  error?: string;
}

// ------------------------------------------------------------------ //
// FileTypeIcon — small coloured icon per extension
// ------------------------------------------------------------------ //

function FileTypeIcon({ ext }: { ext: FileExt }) {
  const color = FILE_EXT_COLORS[ext];
  if (ext === "pdf") return <FileType size={18} style={{ color }} />;
  if (ext === "docx") return <FileText size={18} style={{ color }} />;
  return <FileIcon size={18} style={{ color }} />;
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

      // Step 2: Use actual stored filenames returned by the backend (in upload order)
      const orderedFilenames = uploadResp.input_filenames;

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
