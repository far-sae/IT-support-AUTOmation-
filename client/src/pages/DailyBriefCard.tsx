/**
 * Phase 11 — Daily-brief widget on the dashboard.
 * Shows the most recent brief's Markdown + a "Generate now" button (ADMIN).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { briefApi } from "../api/endpoints.js";
import { Card } from "../components/ui/Card.js";
import { Button } from "../components/ui/Button.js";
import { useAuth } from "../auth/AuthProvider.js";
import { LoadingState } from "../components/ui/EmptyState.js";

function renderMarkdown(md: string): string {
  // Minimal Markdown → HTML — we control the input (autopilot-generated)
  // so we don't need a full parser.
  let out = md
    .replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c)
    .replace(/^# (.+)$/gm, "<h2 class=\"font-display text-2xl mb-1\">$1</h2>")
    .replace(/^## (.+)$/gm, "<h3 class=\"font-display text-lg mt-4 mb-2\">$1</h3>")
    .replace(/^_(.+)_$/gm, "<p class=\"text-ink/60 text-xs mb-2\">$1</p>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, "<li>$1</li>");
  // Wrap consecutive <li>'s in <ul>.
  out = out.replace(/(<li>[\s\S]+?<\/li>)(?!\s*<li>)/g, "<ul class=\"list-disc list-inside text-sm space-y-1 mb-3\">$1</ul>");
  // Paragraph wrap remaining loose lines.
  out = out.replace(/^(?!<|$)(.+)$/gm, "<p class=\"text-sm mb-2\">$1</p>");
  return out;
}

export function DailyBriefCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["brief", "latest"],
    queryFn: () => briefApi.latest(),
    refetchInterval: 60_000,
  });
  const generate = useMutation({
    mutationFn: () => briefApi.generate(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brief", "latest"] }),
  });

  const isAdmin = user?.role === "ADMIN";
  const brief = data?.brief ?? null;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">Morning brief</p>
          <h3 className="font-display text-2xl">Yesterday in autopilot</h3>
        </div>
        {isAdmin && (
          <Button
            size="sm" variant="secondary"
            disabled={generate.isPending}
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? "Generating…" : brief ? "Regenerate" : "Generate now"}
          </Button>
        )}
      </div>

      {isLoading && <LoadingState />}

      {!isLoading && !brief && (
        <p className="text-sm text-ink/60">
          No brief yet. The autopilot generates one every morning (or click "Generate now").
        </p>
      )}

      {brief && (
        <>
          <div
            className="prose prose-sm max-w-none [&_li]:ml-0"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: renderMarkdown(brief.markdown) }}
          />
          <div className="border-t border-ink/10 mt-4 pt-3 grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            <Stat label="Opened" value={brief.stats.ticketsOpened} />
            <Stat label="Resolved" value={brief.stats.ticketsResolved} />
            <Stat label="By autopilot" value={brief.stats.autoResolvedByBrain} accent />
            <Stat label="SLA breached" value={brief.stats.slaBreached} />
            <Stat label="Critical devices" value={brief.stats.devicesCritical} />
            <Stat label="Escalations" value={brief.stats.escalations} />
          </div>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">{label}</p>
      <p className={"font-display text-xl " + (accent ? "text-ink" : "text-ink/80")}>{value}</p>
    </div>
  );
}
