/**
 * Phase 13 — Workflows page.
 *
 * Two cards:
 *   • Active executions — running / waiting / awaiting-approval, with a
 *     timeline showing every step's state. Admin can approve / cancel.
 *   • Catalog — every in-code workflow with its step count.
 *
 * "Tick now" button forces the executor to advance immediately (admin),
 * useful when you don't want to wait the cron interval.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { workflowsApi } from "../api/endpoints.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Button } from "../components/ui/Button.js";
import { Badge } from "../components/ui/Badge.js";
import { EmptyState, LoadingState } from "../components/ui/EmptyState.js";
import { useAuth } from "../auth/AuthProvider.js";
import type {
  WorkflowExecution, WorkflowExecutionStatus, WorkflowStepStatus,
} from "../types.js";

const EXEC_TONE: Record<WorkflowExecutionStatus, "neutral" | "success" | "warn" | "danger" | "info"> = {
  RUNNING:           "info",
  WAITING:           "warn",
  AWAITING_APPROVAL: "warn",
  SUCCEEDED:         "success",
  FAILED:            "danger",
  CANCELLED:         "neutral",
  COMPENSATING:      "danger",
};

const STEP_TONE: Record<WorkflowStepStatus, "neutral" | "success" | "warn" | "danger" | "info"> = {
  PENDING:     "neutral",
  RUNNING:     "info",
  WAITING:     "warn",
  SUCCEEDED:   "success",
  FAILED:      "danger",
  SKIPPED:     "neutral",
  COMPENSATED: "danger",
};

export default function WorkflowsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === "ADMIN";

  const catalogQ = useQuery({
    queryKey: ["workflows", "catalog"],
    queryFn: () => workflowsApi.list(),
  });
  const execQ = useQuery({
    queryKey: ["workflows", "executions"],
    queryFn: () => workflowsApi.listExecutions(),
    refetchInterval: 10_000,
  });

  const tick = useMutation({
    mutationFn: () => workflowsApi.tick(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflows"] }),
  });

  return (
    <>
      <Header
        title="Workflows"
        subtitle="Multi-step plans the autopilot orchestrates against a ticket. Each step is durable and resumes after a crash."
        action={isAdmin && (
          <Button size="sm" variant="secondary" disabled={tick.isPending} onClick={() => tick.mutate()}>
            {tick.isPending ? "Ticking…" : "Tick now"}
          </Button>
        )}
      />

      <Card className="p-6 mb-6">
        <div className="mb-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">Active</p>
          <h3 className="font-display text-xl">Executions</h3>
        </div>
        {execQ.isLoading && <LoadingState />}
        {!execQ.isLoading && (execQ.data?.executions.length ?? 0) === 0 && (
          <EmptyState title="No workflows running." description="Start one from a ticket detail page." />
        )}
        {(execQ.data?.executions ?? []).length > 0 && (
          <div className="space-y-4">
            {execQ.data!.executions.map((e) => (
              <ExecutionCard key={e.id} execution={e} isAdmin={isAdmin} />
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">Catalog</p>
          <h3 className="font-display text-xl">Available workflows</h3>
        </div>
        {catalogQ.isLoading && <LoadingState />}
        {(catalogQ.data?.workflows ?? []).length > 0 && (
          <div className="space-y-3">
            {catalogQ.data!.workflows.map((w) => (
              <div key={w.key} className="border border-ink/10 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-display text-base">{w.name}</h4>
                  <span className="font-mono text-[10px] text-ink/50">{w.key} · {w.stepCount} steps</span>
                </div>
                <p className="text-sm text-ink/70">{w.description}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function ExecutionCard({ execution, isAdmin }: { execution: WorkflowExecution; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(execution.status !== "SUCCEEDED");

  const approve = useMutation({
    mutationFn: (stepKey: string) => workflowsApi.approve(execution.id, stepKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflows"] }),
  });
  const cancel = useMutation({
    mutationFn: () => workflowsApi.cancel(execution.id, "cancelled by admin"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflows"] }),
  });

  const steps = execution.steps ?? [];
  const waitingApproval = steps.find((s) => s.stepKey === "await_hr_approval" && s.status === "WAITING");

  return (
    <div className="border border-ink/10 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge tone={EXEC_TONE[execution.status]}>{execution.status}</Badge>
          <h4 className="font-display text-base">{execution.workflowKey}</h4>
        </div>
        <div className="flex items-center gap-2">
          {execution.status === "AWAITING_APPROVAL" && isAdmin && waitingApproval && (
            <Button size="sm" variant="primary" onClick={() => approve.mutate(waitingApproval.stepKey)}>
              Approve
            </Button>
          )}
          {!["SUCCEEDED", "FAILED", "CANCELLED"].includes(execution.status) && isAdmin && (
            <Button size="sm" variant="ghost" onClick={() => cancel.mutate()}>Cancel</Button>
          )}
          <button
            className="text-xs text-ink/60 underline-offset-2 hover:underline"
            onClick={() => setExpanded((s) => !s)}
          >
            {expanded ? "Hide" : "Show"} steps
          </button>
        </div>
      </div>
      <div className="text-xs text-ink/50 font-mono mb-3">
        ticket {execution.ticketId.slice(0, 8)} · started {new Date(execution.startedAt).toLocaleString()}
        {execution.errorReason && <span className="text-red-600 ml-2">⚠ {execution.errorReason}</span>}
      </div>
      {expanded && steps.length > 0 && (
        <ol className="space-y-2">
          {steps.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-[10px] text-ink/40 w-6 text-right">{s.sequence}.</span>
              <Badge tone={STEP_TONE[s.status]}>{s.status}</Badge>
              <span className="font-mono text-xs text-ink/70">{s.stepKey}</span>
              {s.resumeAt && (s.status === "WAITING") && (
                <span className="text-xs text-ink/50">→ resumes {new Date(s.resumeAt).toLocaleTimeString()}</span>
              )}
              {s.errorReason && <span className="text-xs text-red-600">{s.errorReason}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
