import type { ReactNode } from "react";
import { cx } from "../../lib/cx.js";

type Tone = "neutral" | "success" | "warn" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-ink/5 text-ink/80",
  success: "bg-emerald-100 text-emerald-800",
  warn:    "bg-amber-100 text-amber-800",
  danger:  "bg-red-100 text-red-800",
  info:    "bg-sky-100 text-sky-800",
};

export function Badge({ tone = "neutral", children, className }: {
  tone?: Tone; children: ReactNode; className?: string;
}) {
  return (
    <span className={cx(
      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
      tones[tone],
      className,
    )}>
      {children}
    </span>
  );
}

export function priorityTone(priority: string): Tone {
  switch (priority) {
    case "Critical": return "danger";
    case "High":     return "warn";
    case "Medium":   return "info";
    case "Low":      return "neutral";
    default:         return "neutral";
  }
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "RESOLVED":
    case "OPERATIONAL":
    case "HEALTHY":
      return "success";
    case "IN_PROGRESS":
    case "DEGRADED":
    case "WARNING":
    case "MONITORING":
    case "INVESTIGATING":
    case "IDENTIFIED":
      return "warn";
    case "OPEN":
      return "info";
    case "OUTAGE":
    case "CRITICAL":
      return "danger";
    default:
      return "neutral";
  }
}
