/**
 * Phase 26 — Defender page.
 *
 * Shows the latest daily defender run with:
 *   • Status + iteration count + decision summary
 *   • The Markdown briefing the agent wrote
 *   • Yesterday's outcomes (tickets resolved / dismissals re-fired)
 *   • A list of every concrete decision the agent made
 *   • History table of prior runs
 *
 * Admin can "Run now" to trigger a fresh defender pass.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { defenderApi } from "../api/endpoints.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Button } from "../components/ui/Button.js";
import { Badge } from "../components/ui/Badge.js";
import { EmptyState, LoadingState } from "../components/ui/EmptyState.js";
import { useAuth } from "../auth/AuthProvider.js";
import type { DefenderDecision, DefenderRun, DefenderStatus } from "../types.js";

const STATUS_TONE: Record<DefenderStatus, "neutral" | "info" | "success" | "warn" | "danger"> = {
  RUNNING:   "info",
  SUCCEEDED: "success",
  HALTED:    "warn",
  FAILED:    "danger",
};

function renderMarkdown(md: string): string {
  let out = md
    .replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c)
    .replace(/^# (.+)$/gm, "<h2 class=\"font-display text-2xl mb-2 mt-4\">$1</h2>")
    .replace(/^## (.+)$/gm, "<h3 class=\"font-display text-lg mt-4 mb-2\">$1</h3>")
    .replace(/^### (.+)$/gm, "<h4 class=\"font-display text-base mt-3 mb-1\">$1</h4>")
    .replace(/^_(.+)_$/gm, "<p class=\"text-ink/60 text-xs mb-2\">$1</p>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, "<li>$1</li>");
  out = out.replace(/(<li>[\s\S]+?<\/li>)(?!\s*<li>)/g, "<ul class=\"list-disc list-inside text-sm space-y-1 mb-3\">$1</ul>");
  out = out.replace(/^(?!<|$)(.+)$/gm, "<p class=\"text-sm mb-2\">$1</p>");
  return out;
}

export default function DefenderPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === "ADMIN";
  const [feedback, setFeedback] = useState<string | null>(null);

  const latestQ  = useQuery({
    queryKey: ["defender", "latest"],
    queryFn: () => defenderApi.latest(),
    refetchInterval: 60_000,
  });
  const runsQ = useQuery({
    queryKey: ["defender", "runs"],
    queryFn: () => defenderApi.listRuns(),
  });

  const runNow = useMutation({
    mutationFn: () => defenderApi.runNow(),
    onSuccess: (r) => {
      setFeedback(`Run ${r.status} after ${r.iterations} iterations with ${r.decisions.length} decisions.`);
      qc.invalidateQueries({ queryKey: ["defender"] });
    },
    onError: (err) => setFeedback(`Failed: ${(err as Error).message}`),
  });

  const latest = latestQ.data?.run ?? null;

  return (
    <>
      <Header
        title="Daily defender"
        subtitle="An AI agent runs once a day per organisation: it reviews the last 24h of threat intel, correlates against your fleet, and decides what to do. It learns from yesterday's outcomes."
        action={isAdmin && (
          <Button size="sm" variant="primary" loading={runNow.isPending} onClick={() => runNow.mutate()}>
            Run now
          </Button>
        )}
      />

      {feedback && (
        <div className="mb-6 px-4 py-3 rounded-lg text-sm border bg-emerald-50 border-emerald-200 text-emerald-900">
          {feedback}
        </div>
      )}

      {latestQ.isLoading && <LoadingState />}

      {!latestQ.isLoading && !latest && (
        <Card className="p-6 mb-6">
          <EmptyState
            title="No defender runs yet."
            description="The defender runs once a day at 06:00 UTC. Click 'Run now' as an admin to trigger one immediately."
          />
        </Card>
      )}

      {latest && (
        <>
          <Card className="p-6 mb-6">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">Today's briefing</p>
                <h3 className="font-display text-2xl">
                  {latest.runDate.slice(0, 10)}
                  <Badge tone={STATUS_TONE[latest.status]} className="ml-2">{latest.status}</Badge>
                </h3>
              </div>
              <div className="text-xs text-ink/60 text-right font-mono">
                {latest.iterations} iterations · {(latest.decisions ?? []).length} decisions<br />
                started {new Date(latest.startedAt).toLocaleString()}
              </div>
            </div>

            {latest.briefing ? (
              <div
                className="prose prose-sm max-w-none [&_li]:ml-0"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: renderMarkdown(latest.briefing) }}
              />
            ) : (
              <p className="text-ink/60 text-sm">No briefing produced.</p>
            )}

            {/* Outcomes from THIS run's measurement (typically set the next day) */}
            {latest.outcomes && Object.keys(latest.outcomes).length > 0 && (
              <div className="mt-6 border-t border-ink/10 pt-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-2">Outcomes</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <OutcomeCell label="Decisions" value={latest.outcomes.decisionsMade} />
                  <OutcomeCell label="Tickets opened" value={latest.outcomes.ticketsOpened} />
                  <OutcomeCell label="Tickets resolved" value={latest.outcomes.ticketsResolved} accent />
                  <OutcomeCell label="Dismissed re-fired" value={latest.outcomes.dismissedThenRefired} warn />
                </div>
              </div>
            )}
          </Card>

          {/* Decisions */}
          {(latest.decisions?.length ?? 0) > 0 && (
            <Card className="p-6 mb-6">
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-3">Decisions</p>
              <ul className="space-y-2">
                {latest.decisions!.map((d, i) => <DecisionRow key={i} decision={d} />)}
              </ul>
            </Card>
          )}
        </>
      )}

      {/* History */}
      <Card className="p-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-3">History</p>
        {runsQ.isLoading && <LoadingState />}
        {(runsQ.data?.runs.length ?? 0) === 0 ? (
          <EmptyState title="No prior runs." description="History accumulates after the first daily run." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink/60 font-mono text-[10px] uppercase tracking-widest">
                <tr className="border-b border-ink/10">
                  <th className="py-2 pr-4">Run date</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Iter.</th>
                  <th className="py-2 pr-4">Decisions</th>
                  <th className="py-2 pr-4">Started</th>
                  <th className="py-2 pr-4">Completed</th>
                </tr>
              </thead>
              <tbody>
                {(runsQ.data?.runs ?? []).map((r) => <RunHistoryRow key={r.id} run={r} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function OutcomeCell({ label, value, accent, warn }: { label: string; value: number | undefined; accent?: boolean; warn?: boolean }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">{label}</p>
      <p className={
        "font-display text-2xl " +
        (warn ? "text-amber-700" : accent ? "text-emerald-700" : "text-ink/80")
      }>
        {value ?? "—"}
      </p>
    </div>
  );
}

function DecisionRow({ decision }: { decision: DefenderDecision }) {
  if (decision.kind === "open_ticket") {
    return (
      <li className="border border-ink/10 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1">
          <Badge tone="info">OPEN TICKET</Badge>
          <span className="font-mono text-xs">{decision.refCode}</span>
          <Badge tone={decision.priority === "Critical" ? "danger" : decision.priority === "High" ? "warn" : "neutral"}>{decision.priority}</Badge>
        </div>
        <p className="text-sm text-ink/70">{decision.reason}</p>
      </li>
    );
  }
  if (decision.kind === "ack_match") {
    return (
      <li className="border border-ink/10 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1">
          <Badge tone="success">ACKNOWLEDGED</Badge>
          <span className="font-mono text-[10px] text-ink/50">match {decision.matchId.slice(0, 12)}</span>
        </div>
        <p className="text-sm text-ink/70">{decision.reason}</p>
      </li>
    );
  }
  if (decision.kind === "dismiss_match") {
    return (
      <li className="border border-ink/10 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1">
          <Badge tone="neutral">DISMISSED</Badge>
          <span className="font-mono text-[10px] text-ink/50">match {decision.matchId.slice(0, 12)}</span>
        </div>
        <p className="text-sm text-ink/70">{decision.reason}</p>
      </li>
    );
  }
  if (decision.kind === "recommend_runbook") {
    return (
      <li className="border border-ink/10 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1">
          <Badge tone="warn">RECOMMEND RUNBOOK</Badge>
          <span className="font-mono text-xs">{decision.runbookKey}</span>
          <span className="font-mono text-[10px] text-ink/50">match {decision.matchId.slice(0, 12)}</span>
        </div>
        <p className="text-sm text-ink/70">{decision.reason}</p>
      </li>
    );
  }
  return (
    <li className="border border-ink/10 rounded-lg p-3 text-sm text-ink/70">{decision.text}</li>
  );
}

function RunHistoryRow({ run }: { run: DefenderRun }) {
  return (
    <tr className="border-b border-ink/5">
      <td className="py-3 pr-4 font-mono">{run.runDate.slice(0, 10)}</td>
      <td className="py-3 pr-4"><Badge tone={STATUS_TONE[run.status]}>{run.status}</Badge></td>
      <td className="py-3 pr-4">{run.iterations}</td>
      <td className="py-3 pr-4">{(run.decisions?.length ?? "—")}</td>
      <td className="py-3 pr-4 text-xs text-ink/70">{new Date(run.startedAt).toLocaleString()}</td>
      <td className="py-3 pr-4 text-xs text-ink/70">{run.completedAt ? new Date(run.completedAt).toLocaleString() : "—"}</td>
    </tr>
  );
}
