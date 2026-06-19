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
