/**
 * Inline SVG sparkline. Tiny, zero-dep, fits in a table row.
 * Values are 0-100 (percent). Renders a smooth-ish polyline plus an end dot.
 */

import { cx } from "../../lib/cx.js";

interface Props {
  values: number[];
  label?: string;
  className?: string;
  /** SVG width in px. Default 96. */
  width?: number;
  /** SVG height in px. Default 24. */
  height?: number;
  color?: string;
}

export function Sparkline({
  values, label, className,
  width = 96, height = 24, color = "#17160E",
}: Props) {
  if (!values || values.length === 0) {
    return (
      <div className={cx("flex items-center gap-2 text-ink/40 text-xs", className)}>
        {label && <span className="font-mono text-[10px] uppercase tracking-widest text-ink/50">{label}</span>}
        <span>no data</span>
      </div>
    );
  }

  const padding = 1;
  const maxV = Math.max(100, ...values);
  const minV = 0;
  const stepX = (width - padding * 2) / Math.max(1, values.length - 1);
  const scaleY = (v: number) =>
    height - padding - ((v - minV) / Math.max(1, maxV - minV)) * (height - padding * 2);

  const points = values.map((v, i) => `${padding + i * stepX},${scaleY(v)}`);
  const path = `M ${points.join(" L ")}`;

  const lastX = padding + (values.length - 1) * stepX;
  const lastY = scaleY(values[values.length - 1] ?? 0);
  const latest = values[values.length - 1] ?? 0;

  return (
    <div className={cx("flex items-center gap-2", className)}>
      {label && (
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink/50 w-10 shrink-0">{label}</span>
      )}
      <svg width={width} height={height} className="block overflow-visible">
        <path d={path} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lastX} cy={lastY} r={2.2} fill={color} />
      </svg>
      <span className="font-mono text-xs tabular-nums w-8 shrink-0 text-right">{latest}%</span>
    </div>
  );
}
