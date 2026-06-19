/**
 * ProgressBar — upload/processing progress indicator.
 * Shows percentage with animated fill.
 */

interface ProgressBarProps {
  value: number; // 0–100
  label?: string;
  className?: string;
}

export function ProgressBar({ value, label, className = "" }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <div className="flex justify-between items-center">
          <span className="text-xs text-[#6B6B65] dark:text-[#888880]">{label}</span>
          <span className="text-xs font-medium text-[#111111] dark:text-[#F0F0EE]">
            {clamped}%
          </span>
        </div>
      )}
      <div className="h-1.5 bg-[#E5E5E0] dark:bg-[#2A2A2A] rounded-full overflow-hidden">
        <div
          className="h-full bg-accent dark:bg-accent-dark rounded-full transition-all duration-300"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
