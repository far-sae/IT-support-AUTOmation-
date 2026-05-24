import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx.js";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Adds a subtle hover lift — useful for clickable cards. */
  interactive?: boolean;
}

/**
 * Phase 23 — Cards now opt into the `soft` token shadow + optional
 * interactive hover lift. Existing `<Card>` callers don't change.
 */
export function Card({ children, className, interactive, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={cx(
        "bg-white border border-ink/10 rounded-2xl shadow-soft",
        interactive && "transition-all duration-base ease-snap hover:shadow-pop hover:border-ink/15 motion-reduce:transition-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("px-6 pt-6", className)}>{children}</div>;
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("px-6 py-5", className)}>{children}</div>;
}
