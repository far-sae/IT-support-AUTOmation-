import { useSocket } from "../realtime/SocketProvider.js";
import { useAuth } from "../auth/AuthProvider.js";
import { cx } from "../lib/cx.js";

export function Header({ title, subtitle, action }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const { connected } = useSocket();
  const { org } = useAuth();
  return (
    <header className="flex items-end justify-between gap-4 mb-8">
      <div className="min-w-0">
        <div className="flex items-center gap-3 mb-1">
          {org && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
              {org.slug}
            </span>
          )}
          <span className={cx(
            "inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest",
            connected ? "text-emerald-700" : "text-ink/40",
          )}>
            <span className={cx(
              "h-1.5 w-1.5 rounded-full",
              connected ? "bg-emerald-500" : "bg-ink/30",
            )} />
            {connected ? "Live" : "Offline"}
          </span>
        </div>
        <h1 className="font-display text-3xl md:text-4xl leading-tight truncate">{title}</h1>
        {subtitle && <p className="text-ink/70 mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
