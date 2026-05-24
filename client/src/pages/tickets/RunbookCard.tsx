/**
 * Phase 10B — Autopilot card on the ticket detail.
 *
 * Replaces the Yes/No human checkpoint from Phase 10A with an "Autopilot
 * activity" view:
 *   • What the brain decided + which runbook ran
 *   • Verification countdown (when the cron will auto-close it)
 *   • Optional brain log of tool calls / reasoning
 *   • Optional manual overrides for impatient users
 *       — Mark resolved now    (skip the verification wait)
 *       — Didn't work, re-try  (negative signal → brain re-attempts)
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runbooksApi, ticketsApi } from "../../api/endpoints.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { Card } from "../../components/ui/Card.js";
import { Badge } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import type { BrainLogEntry, RunbookExecution, RunbookRisk, RunbookStatus } from "../../types.js";

function riskTone(r: RunbookRisk) {
  return r === "HIGH" ? "danger" : r === "MEDIUM" ? "warn" : "success";
}
function statusTone(s: RunbookStatus) {
  switch (s) {
    case "SUCCEEDED":             return "success";
    case "AWAITING_VERIFICATION": return "info";
    case "AWAITING_AGENT":        return "warn";
    case "RUNNING":               return "info";
    case "AWAITING_USER":         return "info";
    case "CANCELLED":
    case "FAILED":                return "danger";
    default:                      return "neutral";
  }
}

function relativeFuture(iso: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs} h`;
  return `in ${Math.round(hrs / 24)} d`;
}

function relativePast(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export function RunbookCard({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["ticket-runbooks", ticketId],
    queryFn: () => runbooksApi.listForTicket(ticketId),
    refetchInterval: 30_000,
  });

  const markResolved = useMutation({
    mutationFn: () => ticketsApi.patch(ticketId, { status: "RESOLVED" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket-runbooks", ticketId] });
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  const reattempt = useMutation({
    mutationFn: () => ticketsApi.addComment(ticketId, "Didn't work — still broken.", false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket-runbooks", ticketId] });
      qc.invalidateQueries({ queryKey: ["ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["comments", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  const approve = useMutation({
    mutationFn: (id: string) => runbooksApi.approve(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket-runbooks", ticketId] });
    },
  });

  if (!data || data.executions.length === 0) return null;
  const isStaff = user?.role === "AGENT" || user?.role === "ADMIN";

  return (
    <Card className="p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Autopilot</p>
      <h3 className="font-display text-2xl mb-4">Activity</h3>

      <ul className="space-y-3">
        {data.executions.map((exec) => (
          <ExecutionRow
            key={exec.id} exec={exec} isStaff={isStaff}
            onMarkResolved={() => markResolved.mutate()}
            markResolving={markResolved.isPending}
            onReattempt={() => reattempt.mutate()}
            reattemptPending={reattempt.isPending}
            onApprove={() => approve.mutate(exec.id)}
            approving={approve.isPending}
          />
        ))}
      </ul>
    </Card>
  );
}

function ExecutionRow({
  exec, isStaff,
  onMarkResolved, markResolving,
  onReattempt, reattemptPending,
  onApprove, approving,
}: {
  exec: RunbookExecution;
  isStaff: boolean;
  onMarkResolved: () => void;
  markResolving: boolean;
  onReattempt: () => void;
  reattemptPending: boolean;
  onApprove: () => void;
  approving: boolean;
}) {
  const [showLog, setShowLog] = useState(false);
  const decision = exec.decision as { matchReason?: string; action?: string };
  const log: BrainLogEntry[] = Array.isArray(exec.brainLog) ? exec.brainLog : [];

  return (
    <li className="rounded-2xl border border-ink/10 p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <p className="font-mono text-sm truncate">{exec.runbookKey}</p>
          <Badge tone={riskTone(exec.risk)}>{exec.risk}</Badge>
          <Badge tone={statusTone(exec.status)}>{exec.status.replace(/_/g, " ")}</Badge>
        </div>
        <p className="font-mono text-[10px] text-ink/50 shrink-0">{relativePast(exec.startedAt)}</p>
      </div>

      {decision.matchReason && (
        <p className="text-xs text-ink/60 mb-1">Brain reasoning: {decision.matchReason}</p>
      )}
      <p className="font-mono text-[10px] text-ink/50">
        confidence {Math.round(exec.confidence * 100)}%
        {typeof exec.decision.riskScore === "number" ? ` · risk ${exec.decision.riskScore}` : ""}
        {decision.action ? ` · action: ${decision.action}` : ""}
        {exec.approvedBy ? ` · approved by ${exec.approvedBy.name}` : ""}
      </p>

      {/* Phase 11 — show policy block, if any */}
      {exec.decision.policyDecision === "DENY" && (
        <div className="mt-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber-900 mb-1">Policy block</p>
          <p className="text-amber-900">
            <strong>{exec.decision.policy}</strong> {exec.status === "AWAITING_AGENT" ? "escalated" : "denied"}: {exec.decision.policyReason}
          </p>
        </div>
      )}

      {exec.status === "AWAITING_VERIFICATION" && exec.verifyAt && (
        <VerificationCountdown
          verifyAt={exec.verifyAt}
          onMarkResolved={onMarkResolved}
          markResolving={markResolving}
          onReattempt={onReattempt}
          reattemptPending={reattemptPending}
        />
      )}

      {exec.status === "AWAITING_AGENT" && isStaff && (
        <div className="flex gap-2 mt-3">
          <Button size="sm" disabled={approving} onClick={onApprove}>
            Approve &amp; run
          </Button>
        </div>
      )}

      {exec.status === "AWAITING_USER" && (
        <p className="text-xs text-ink/60 mt-3">
          (Legacy human-confirmation row — autopilot has since taken over the verification loop.)
        </p>
      )}

      {exec.agentActions && exec.agentActions.length > 0 && (
        <div className="mt-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-2">Agent actions</p>
          <ul className="space-y-2">
            {exec.agentActions.map((a) => {
              const r = a.result as { ok?: boolean; output?: string };
              return (
                <li key={a.id} className="rounded-xl bg-paper p-3 text-xs">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-mono">{a.kind}</span>
                    <Badge tone={
                      a.status === "SUCCEEDED" ? "success" :
                      a.status === "FAILED"    ? "danger"  :
                      a.status === "QUEUED"    ? "neutral" :
                      "info"
                    }>{a.status.replace(/_/g, " ")}</Badge>
                  </div>
                  {r?.output && (
                    <pre className="whitespace-pre-wrap font-mono text-[11px] text-ink/80 mt-1">{String(r.output).slice(0, 600)}</pre>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {log.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            className="text-xs underline underline-offset-4 text-ink/60 hover:text-ink"
            onClick={() => setShowLog((s) => !s)}
          >
            {showLog ? "Hide" : "Show"} brain log ({log.length})
          </button>
          {showLog && (
            <ol className="mt-2 space-y-1.5 border-l border-ink/10 pl-3 max-h-56 overflow-y-auto">
              {log.map((e, i) => (
                <li key={i} className="text-xs">
                  <span className={
                    e.role === "system" ? "text-ink/50 font-mono" :
                    e.role === "tool"   ? "text-sky-700 font-mono" :
                                          "text-ink/80"
                  }>
                    {e.role === "tool" ? "🔧" : e.role === "system" ? "✱" : "💬"} {e.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

function VerificationCountdown({
  verifyAt, onMarkResolved, markResolving, onReattempt, reattemptPending,
}: {
  verifyAt: string;
  onMarkResolved: () => void;
  markResolving: boolean;
  onReattempt: () => void;
  reattemptPending: boolean;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mt-3 rounded-xl bg-paper px-3 py-3 border border-ink/10">
      <p className="text-xs text-ink/70 mb-2">
        Autopilot will auto-resolve <strong>{relativeFuture(verifyAt)}</strong> unless you tell it otherwise.
      </p>
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant="secondary" disabled={markResolving} onClick={onMarkResolved}>
          Mark resolved now
        </Button>
        <Button size="sm" variant="ghost" disabled={reattemptPending} onClick={onReattempt}>
          Didn't work, re-attempt
        </Button>
      </div>
    </div>
  );
}
