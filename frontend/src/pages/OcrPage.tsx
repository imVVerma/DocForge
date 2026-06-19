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
