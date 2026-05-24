import type { ButtonHTMLAttributes } from "react";
import { cx } from "../../lib/cx.js";

/**
 * Phase 23 — Button polish.
 *
 * Adds:
 *   • Focus ring (visible-only — no harassing every mouse-user)
 *   • Subtle press-state via `active:scale-95`
 *   • `loading` prop with inline spinner
 *   • `motion-reduce:transition-none` for reduced-motion users
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium " +
  "transition-all duration-fast ease-snap motion-reduce:transition-none " +
  "disabled:opacity-50 disabled:pointer-events-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ink/40 focus-visible:ring-offset-paper " +
  "active:scale-95";

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-5 py-2.5 text-sm",
};

const variants: Record<Variant, string> = {
  primary:   "bg-ink text-lime hover:bg-ink/90",
  secondary: "border border-ink/15 hover:bg-ink/5",
  ghost:     "text-ink/80 hover:bg-ink/5",
  danger:    "bg-danger-600 text-white hover:bg-danger-700",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  loading = false,
  disabled,
  children,
  ...props
}: Props) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(base, sizes[size], variants[variant], className)}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin"
        />
      )}
      {children}
    </button>
  );
}
