import type { ReactNode } from "react";

/**
 * Phase 23 — polished empty / loading / error states.
 *
 * Adds:
 *   • Visual treatment (icon + dashed border for empties)
 *   • role / aria-live for screen-reader users
 *   • Skeleton variant for content-shaped loading
 */

export function EmptyState({ title, description, action, icon }: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="text-center py-12 px-6 border border-dashed border-ink/15 rounded-xl bg-ink/[0.02]"
    >
      {icon && <div className="mx-auto mb-3 text-ink/40">{icon}</div>}
      <h2 className="font-display text-xl mb-2">{title}</h2>
      {description && (
        <p className="text-ink/70 text-sm max-w-md mx-auto mb-6">{description}</p>
      )}
      {action}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="py-12 flex items-center justify-center gap-3 text-ink/60 text-sm"
    >
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 rounded-full border-2 border-ink/30 border-t-ink animate-spin"
      />
      <span>{label}</span>
    </div>
  );
}

/** Content-shaped skeleton — use in lists/tables for less-jarring transitions. */
export function SkeletonRows({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={"space-y-3 " + className}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="h-4 bg-ink/10 rounded w-3/4 mb-2" />
          <div className="h-3 bg-ink/5 rounded w-1/2" />
        </div>
      ))}
      <span className="sr-only">Loading content</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="py-12 px-6 text-center border border-red-200 bg-red-50/50 rounded-xl"
    >
      <p className="text-red-800 font-medium mb-1">Something went wrong</p>
      <p className="text-red-700/80 text-sm max-w-md mx-auto mb-4">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-sm underline-offset-2 hover:underline text-red-800"
        >
          Try again
        </button>
      )}
    </div>
  );
}
