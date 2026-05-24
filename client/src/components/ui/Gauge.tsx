import { cx } from "../../lib/cx.js";

/** Simple horizontal progress bar (0-100). Colors threshold based. */
export function Gauge({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const color =
    clamped >= 90 ? "bg-red-500" :
    clamped >= 75 ? "bg-amber-500" :
    "bg-emerald-500";
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-1">
        {label && <span className="text-xs text-ink/60">{label}</span>}
        <span className="font-mono text-xs">{clamped}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-ink/5 overflow-hidden">
        <div className={cx("h-full rounded-full", color)} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
