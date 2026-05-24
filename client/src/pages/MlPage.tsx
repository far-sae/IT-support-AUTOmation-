/**
 * Phase 16 — ML Models page.
 *
 * Admin-facing view of the per-org remediation classifier:
 *   • A summary card with the currently active model's accuracy + sample count.
 *   • "Train now" button kicks off a fresh training run (returns 400 if
 *     there's not enough labelled history).
 *   • Table of every historical model version, with a per-row "Activate"
 *     button so an admin can roll back to an older model if needed.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { mlApi } from "../api/endpoints.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Button } from "../components/ui/Button.js";
import { Badge } from "../components/ui/Badge.js";
import { ErrorState, EmptyState, LoadingState } from "../components/ui/EmptyState.js";
import { ApiError } from "../api/client.js";

export default function MlPage() {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; msg: string } | null>(null);

  const modelsQ = useQuery({
    queryKey: ["ml", "models"],
    queryFn: () => mlApi.listModels(),
  });

  const train = useMutation({
    mutationFn: () => mlApi.train(),
    onSuccess: (r) => {
      setFeedback({
        kind: "success",
        msg: `Trained v${r.version} on ${r.metrics.sampleCount} examples (accuracy ${(r.metrics.accuracy * 100).toFixed(1)}%)`,
      });
      qc.invalidateQueries({ queryKey: ["ml"] });
    },
    onError: (err) => setFeedback({
      kind: "error",
      msg: err instanceof ApiError ? err.message : "Could not train — see server logs.",
    }),
  });

  const activate = useMutation({
    mutationFn: (id: string) => mlApi.activate(id),
    onSuccess: (r) => {
      setFeedback({ kind: "success", msg: `Activated v${r.model.version}` });
      qc.invalidateQueries({ queryKey: ["ml"] });
    },
  });

  const models = modelsQ.data?.models ?? [];
  const active = models.find((m) => m.active);

  return (
    <>
      <Header
        title="ML Models"
        subtitle="Learned classifier that predicts P(success) for every runbook the autopilot considers."
        action={
          <Button size="sm" variant="primary" disabled={train.isPending} onClick={() => train.mutate()}>
            {train.isPending ? "Training…" : "Train now"}
          </Button>
        }
      />

      {feedback && (
        <div
          className={
            "mb-6 px-4 py-3 rounded-lg text-sm border " +
            (feedback.kind === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-red-50 border-red-200 text-red-900")
          }
        >
          {feedback.msg}
        </div>
      )}

      {modelsQ.isLoading && <LoadingState />}
      {modelsQ.error && <ErrorState message={(modelsQ.error as Error).message} />}

      {!modelsQ.isLoading && !modelsQ.error && (
        <>
          {/* Active model card */}
          <Card className="p-6 mb-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Active</p>
            {active ? (
              <>
                <div className="flex items-baseline justify-between mb-4">
                  <h3 className="font-display text-2xl">
                    <span className="font-mono text-base text-ink/60 mr-2">{active.modelKey}</span>
                    v{active.version}
                  </h3>
                  <span className="text-xs text-ink/60 font-mono">
                    trained {new Date(active.trainedAt).toLocaleString()}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <Metric label="Accuracy" value={`${(active.metrics.accuracy * 100).toFixed(1)}%`} accent />
                  <Metric label="Log-loss" value={active.metrics.logLoss.toFixed(3)} />
                  <Metric label="Examples" value={String(active.metrics.sampleCount)} />
                  <Metric label="+ Positives" value={String(active.metrics.positiveCount)} />
                  <Metric label="− Negatives" value={String(active.metrics.negativeCount)} />
                </div>
              </>
            ) : (
              <EmptyState
                title="No active model."
                description="Click 'Train now' once you have at least 3 successful + 3 failed runbook attempts in this org."
              />
            )}
          </Card>

          {/* Version history */}
          <Card className="p-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">History</p>
            <h3 className="font-display text-xl mb-4">All trained versions</h3>
            {models.length === 0 ? (
              <EmptyState title="No training runs yet." description="Each train ⇒ new immutable row + previous one deactivated." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-ink/60 font-mono text-[10px] uppercase tracking-widest">
                    <tr className="border-b border-ink/10">
                      <th className="py-2 pr-4">v</th>
                      <th className="py-2 pr-4">Key</th>
                      <th className="py-2 pr-4">Accuracy</th>
                      <th className="py-2 pr-4">Samples</th>
                      <th className="py-2 pr-4">+ / −</th>
                      <th className="py-2 pr-4">Trained</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((m) => (
                      <tr key={m.id} className="border-b border-ink/5">
                        <td className="py-3 pr-4 font-mono">{m.version}</td>
                        <td className="py-3 pr-4 font-mono text-xs text-ink/70">{m.modelKey}</td>
                        <td className="py-3 pr-4">{(m.metrics.accuracy * 100).toFixed(1)}%</td>
                        <td className="py-3 pr-4">{m.metrics.sampleCount}</td>
                        <td className="py-3 pr-4 text-ink/70 font-mono text-xs">
                          {m.metrics.positiveCount} / {m.metrics.negativeCount}
                        </td>
                        <td className="py-3 pr-4 text-ink/70 text-xs">
                          {new Date(m.trainedAt).toLocaleString()}
                        </td>
                        <td className="py-3 pr-4">
                          {m.active ? <Badge tone="success">active</Badge> : <Badge tone="neutral">inactive</Badge>}
                        </td>
                        <td className="py-3 pr-4 text-right">
                          {!m.active && (
                            <Button
                              size="sm" variant="ghost"
                              disabled={activate.isPending}
                              onClick={() => activate.mutate(m.id)}
                            >
                              Activate
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="mt-6 text-xs text-ink/50 max-w-2xl">
            The brain blends each model's P(success) 50/50 with the heuristic
            success-rate weighting. Models load lazily and are cached for 5
            minutes; activation propagates within that window.
          </p>
        </>
      )}
    </>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">{label}</p>
      <p className={"font-display text-2xl " + (accent ? "text-ink" : "text-ink/80")}>{value}</p>
    </div>
  );
}
