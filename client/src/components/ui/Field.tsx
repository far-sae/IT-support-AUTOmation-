import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx.js";

const inputCls = "block w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20";

export function Field({ label, hint, error, children }: {
  label?: string; hint?: ReactNode; error?: ReactNode; children: ReactNode;
}) {
  return (
    <label className="block">
      {label && <span className="text-sm font-medium block mb-1">{label}</span>}
      {children}
      {hint && !error && <span className="text-xs text-ink/60 mt-1 block">{hint}</span>}
      {error && <span className="text-xs text-red-600 mt-1 block">{error}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, "min-h-[120px]", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, "bg-white pr-10", props.className)} />;
}
