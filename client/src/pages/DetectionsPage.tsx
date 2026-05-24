/**
 * Phase 12 — Detections page.
 *
 * Two stacked cards:
 *   • Active hits (unacknowledged) — severity badge, count, evidence preview, ack
 *   • Rule catalog — name + description + per-rule enable/disable toggle (ADMIN)
 *
 * "Run now" button (ADMIN) fires a one-shot sweep so admins don't wait the
 * cron interval to verify their rule changes.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { detectionsApi } from "../api/endpoints.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Button } from "../components/ui/Button.js";
import { Badge } from "../components/ui/Badge.js";
import { EmptyState, LoadingState } from "../components/ui/EmptyState.js";
import { useAuth } from "../auth/AuthProvider.js";
import type { DetectionHit, DetectionSeverity } from "../types.js";

const SEVERITY_TONE: Record<DetectionSeverity, "neutral" | "info" | "warn" | "danger"> = {
  LOW:      "neutral",
  MEDIUM:   "info",
  HIGH:     "warn",
  CRITICAL: "danger",
};

export default function DetectionsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === "ADMIN";

  const [showAcknowledged, setShowAcknowledged] = useState(false);

  const hitsQ  = useQuery({
    queryKey: ["detections", "hits", showAcknowledged],
    queryFn: () => detectionsApi.listHits(showAcknowledged ? "all" : "open"),
    refetchInterval: 30_000,
  });
  const rulesQ = useQuery({
    queryKey: ["detections", "rules"],
    queryFn: () => detectionsApi.listRules(),
  });

  const ack = useMutation({
    mutationFn: (id: string) => detectionsApi.acknowledge(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["detections", "hits"] }),
  });
  const toggle = useMutation({
    mutationFn: ({ key, disabled }: { key: string; disabled: boolean }) =>
      detectionsApi.setRuleDisabled(key, disabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["detections", "rules"] }),
  });
  const runNow = useMutation({
    mutationFn: () => detectionsApi.run(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["detections"] }),
  });

  return (
    <>
      <Header
        title="Detections"
        subtitle="Sigma-style rules that watch your tickets, runbooks, and fleet for emerging patterns."
        action={isAdmin && (
          <Button size="sm" variant="secondary" disabled={runNow.isPending} onClick={() => runNow.mutate()}>
            {runNow.isPending ? "Running…" : "Run now"}
          </Button>
        )}
      />

      <Card className="p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">Active</p>
            <h3 className="font-display text-xl">Recent hits</h3>
          </div>
          <button
            className="text-xs text-ink/60 underline-offset-2 hover:underline"
            onClick={() => setShowAcknowledged((s) => !s)}
          >
            {showAcknowledged ? "Hide acknowledged" : "Show acknowledged"}
          </button>
        </div>

        {hitsQ.isLoading && <LoadingState />}
        {!hitsQ.isLoading && (hitsQ.data?.hits.length ?? 0) === 0 && (
          <EmptyState title="No active detections." description="Quiet skies. The cron sweeps every few minutes." />
        )}
        {(hitsQ.data?.hits ?? []).length > 0 && (
          <div className="space-y-3">
            {hitsQ.data!.hits.map((h) => <HitRow key={h.id} hit={h} onAck={() => ack.mutate(h.id)} />)}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">Rules</p>
          <h3 className="font-display text-xl">Rule catalog</h3>
        </div>
        {rulesQ.isLoading && <LoadingState />}
        {(rulesQ.data?.rules ?? []).length > 0 && (
          <div className="space-y-3">
            {rulesQ.data!.rules.map((r) => (
              <div key={r.key} className="border border-ink/10 rounded-lg p-4 flex items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-display text-base">{r.name}</h4>
                    <Badge tone={SEVERITY_TONE[r.severity]}>{r.severity}</Badge>
                    <span className="font-mono text-[10px] text-ink/50">{r.key} · {r.windowMinutes}min</span>
                  </div>
                  <p className="text-sm text-ink/70">{r.description}</p>
                </div>
                {isAdmin && (
                  <label className="text-xs flex items-center gap-2 shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!r.disabled}
                      onChange={(e) => toggle.mutate({ key: r.key, disabled: !e.target.checked })}
                    />
                    Enabled
                  </label>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function HitRow({ hit, onAck }: { hit: DetectionHit; onAck: () => void }) {
  const evidenceEntries = Object.entries(hit.evidence).slice(0, 3);
  return (
    <div className={"border border-ink/10 rounded-lg p-4 " + (hit.acknowledgedAt ? "opacity-50" : "")}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge tone={SEVERITY_TONE[hit.severity]}>{hit.severity}</Badge>
          <h4 className="font-display text-base">{hit.ruleKey}</h4>
          <span className="font-mono text-[10px] text-ink/50">count {hit.count}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-ink/50">
            {new Date(hit.windowStart).toLocaleString()}
          </span>
          {!hit.acknowledgedAt && (
            <Button size="sm" variant="ghost" onClick={onAck}>Acknowledge</Button>
          )}
        </div>
      </div>
      {evidenceEntries.length > 0 && (
        <ul className="text-xs text-ink/70 space-y-0.5">
          {evidenceEntries.map(([k, v]) => (
            <li key={k} className="font-mono">
              <span className="text-ink/50">{k}:</span> {JSON.stringify(v).slice(0, 200)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
