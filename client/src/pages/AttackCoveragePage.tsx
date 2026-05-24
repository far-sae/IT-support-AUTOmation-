/**
 * Phase 27 — Behavioural-defence page.
 *
 * Three sections:
 *   • Coverage summary — how many MITRE techniques are covered by APPROVED rules
 *   • Rules awaiting review — DRAFT + TESTING rules (mostly AI-drafted)
 *   • Recent sensor alerts — what the sensors are seeing right now
 *
 * Admin can trigger MITRE re-ingest, run a study session immediately, and
 * approve/reject AI-drafted rules.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { attackApi } from "../api/endpoints.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Button } from "../components/ui/Button.js";
import { Badge } from "../components/ui/Badge.js";
import { EmptyState, LoadingState } from "../components/ui/EmptyState.js";
import { useAuth } from "../auth/AuthProvider.js";
import type { GeneratedRule, GeneratedRuleStatus, ThreatSeverity } from "../types.js";

const SEV_TONE: Record<ThreatSeverity, "neutral" | "info" | "warn" | "danger"> = {
  LOW: "neutral", MEDIUM: "info", HIGH: "warn", CRITICAL: "danger",
};

const STATUS_TONE: Record<GeneratedRuleStatus, "neutral" | "info" | "warn" | "success" | "danger"> = {
  DRAFT:    "neutral",
  TESTING:  "warn",
  APPROVED: "success",
  RETIRED:  "neutral",
  REJECTED: "danger",
};

export default function AttackCoveragePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === "ADMIN";
  const [feedback, setFeedback] = useState<string | null>(null);

  const coverageQ = useQuery({
    queryKey: ["attack", "coverage"],
    queryFn: () => attackApi.coverage(),
  });
  const draftRulesQ = useQuery({
    queryKey: ["attack", "rules", "review"],
    queryFn: async () => {
      // Pull DRAFT + TESTING, merge.
      const [d, t] = await Promise.all([
        attackApi.listRules("DRAFT"),
        attackApi.listRules("TESTING"),
      ]);
      return [...d.rules, ...t.rules];
    },
  });
  const approvedRulesQ = useQuery({
    queryKey: ["attack", "rules", "approved"],
    queryFn: () => attackApi.listRules("APPROVED"),
  });
  const alertsQ = useQuery({
    queryKey: ["attack", "alerts"],
    queryFn: () => attackApi.recentAlerts(20),
    refetchInterval: 60_000,
  });

  const ingest = useMutation({
    mutationFn: () => attackApi.ingest(),
    onSuccess: (r) => {
      setFeedback(`MITRE refresh: ${r.techniquesUpserted} techniques (${r.techniquesRevoked} revoked) in ${r.durationMs}ms`);
      qc.invalidateQueries({ queryKey: ["attack"] });
    },
    onError: (err) => setFeedback(`Ingest failed: ${(err as Error).message}`),
  });
  const study = useMutation({
    mutationFn: () => attackApi.runStudyNow(),
    onSuccess: (r) => {
      const m = r as typeof r & { mode?: "ai" | "demo"; mitreEmpty?: boolean };
      if (m.mitreEmpty) {
        setFeedback("MITRE catalog is empty — click 'Refresh MITRE' first, then re-run the study.");
      } else if (m.mode === "demo") {
        setFeedback(`📋 DEMO mode (no Anthropic key set): created ${r.newDraftsCreated} TEMPLATE rules so you can walk the UI end-to-end. Add USE_AI_BRAIN=true + ANTHROPIC_API_KEY for real AI-generated rules.`);
      } else {
        setFeedback(`🤖 AI study: ${r.newDraftsCreated} new drafts in ${r.iterations} iterations${r.error ? ` — ${r.error}` : ""}`);
      }
      qc.invalidateQueries({ queryKey: ["attack"] });
    },
    onError: (err) => setFeedback(`Study failed: ${(err as Error).message}`),
  });
  const test = useMutation({
    mutationFn: (id: string) => attackApi.testRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attack"] }),
  });
  const approve = useMutation({
    mutationFn: (id: string) => attackApi.approveRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attack"] }),
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => attackApi.rejectRule(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attack"] }),
  });

  const coverage = coverageQ.data;
  const coveragePct = coverage
    ? Math.round((coverage.summary.coveredTechniques / Math.max(1, coverage.summary.totalTechniques)) * 100)
    : null;

  return (
    <>
      <Header
        title="Behavioural defence"
        subtitle="MITRE ATT&CK coverage + AI-drafted detection rules + live sensor alerts. The agent studies attack techniques daily and drafts rules for human review."
        action={isAdmin && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" loading={ingest.isPending} onClick={() => ingest.mutate()}>
              Refresh MITRE
            </Button>
            <Button size="sm" variant="primary" loading={study.isPending} onClick={() => study.mutate()}>
              Run study now
            </Button>
          </div>
        )}
      />

      {feedback && (
        <div className="mb-6 px-4 py-3 rounded-lg text-sm border bg-emerald-50 border-emerald-200 text-emerald-900">
          {feedback}
        </div>
      )}

      {/* Coverage summary */}
      <Card className="p-6 mb-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Coverage</p>
        <h3 className="font-display text-xl mb-4">ATT&CK technique coverage</h3>
        {coverageQ.isLoading && <LoadingState />}
        {coverage && coverage.summary.totalTechniques === 0 && (
          <EmptyState
            title="MITRE catalog is empty."
            description={isAdmin ? "Click 'Refresh MITRE' to fetch the latest ATT&CK enterprise bundle (~600 techniques)." : "Ask an admin to refresh the MITRE catalog."}
          />
        )}
        {coverage && coverage.summary.totalTechniques > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <Stat label="Total techniques"   value={String(coverage.summary.totalTechniques)} />
              <Stat label="Covered"             value={String(coverage.summary.coveredTechniques)} accent />
              <Stat label="Approved rules"      value={String(coverage.summary.approvedRules)} />
              <Stat label="Coverage"            value={`${coveragePct}%`} />
            </div>
            <div className="space-y-2">
              {Object.entries(coverage.byTactic).map(([tactic, data]) => (
                <TacticRow key={tactic} tactic={tactic} data={data} />
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Rules awaiting review */}
      <Card className="p-6 mb-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Awaiting review</p>
        <h3 className="font-display text-xl mb-4">AI-drafted rules</h3>
        {draftRulesQ.isLoading && <LoadingState />}
        {(draftRulesQ.data?.length ?? 0) === 0 && !draftRulesQ.isLoading && (
          <EmptyState
            title="No drafts pending."
            description="The AI study session runs daily after the defender (06:00 UTC) and proposes new rules based on the day's threat landscape."
          />
        )}
        {(draftRulesQ.data ?? []).map((r) => (
          <RuleRow
            key={r.id} rule={r} isAdmin={isAdmin}
            onTest={() => test.mutate(r.id)}
            onApprove={() => approve.mutate(r.id)}
            onReject={() => {
              const reason = window.prompt("Reason for rejection?", "noisy");
              if (reason) reject.mutate({ id: r.id, reason });
            }}
            testPending={test.isPending}
          />
        ))}
      </Card>

      {/* Approved rules */}
      {(approvedRulesQ.data?.rules.length ?? 0) > 0 && (
        <Card className="p-6 mb-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Live</p>
          <h3 className="font-display text-xl mb-4">Approved rules ({approvedRulesQ.data!.rules.length})</h3>
          {approvedRulesQ.data!.rules.map((r) => (
            <div key={r.id} className="border-b border-ink/5 py-2 last:border-0 text-sm flex items-center justify-between">
              <div>
                <span className="font-medium">{r.title}</span>
                {r.attackTechnique && <span className="font-mono text-xs text-ink/50 ml-2">{r.attackTechnique.mitreId}</span>}
              </div>
              <Badge tone={SEV_TONE[r.severity]}>{r.severity}</Badge>
            </div>
          ))}
        </Card>
      )}

      {/* Recent sensor alerts */}
      <Card className="p-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Live</p>
        <h3 className="font-display text-xl mb-4">Recent sensor alerts</h3>
        {alertsQ.isLoading && <LoadingState />}
        {(alertsQ.data?.alerts.length ?? 0) === 0 && !alertsQ.isLoading && (
          <EmptyState
            title="No sensor alerts yet."
            description="Configure WAZUH_API_URL + credentials in your environment to start ingesting endpoint alerts."
          />
        )}
        {(alertsQ.data?.alerts ?? []).map((a) => (
          <div key={a.id} className="border-b border-ink/5 py-2 last:border-0">
            <div className="flex items-center gap-2 text-sm">
              <span className={
                "px-2 py-0.5 rounded-full text-xs font-mono " +
                (a.level >= 13 ? "bg-red-100 text-red-800" :
                 a.level >= 10 ? "bg-amber-100 text-amber-800" :
                 a.level >= 7  ? "bg-sky-100 text-sky-800"   : "bg-ink/10 text-ink/70")
              }>L{a.level}</span>
              <span className="font-mono text-xs text-ink/70">{a.source}</span>
              {a.mitreTechniqueId && <span className="font-mono text-xs text-ink/50">{a.mitreTechniqueId}</span>}
              {a.agentName && <span className="font-mono text-xs text-ink/50">{a.agentName}</span>}
              <span className="text-[10px] text-ink/40 ml-auto">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
            <p className="text-sm text-ink/80 mt-0.5">{a.description}</p>
          </div>
        ))}
      </Card>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">{label}</p>
      <p className={"font-display text-2xl " + (accent ? "text-emerald-700" : "text-ink")}>{value}</p>
    </div>
  );
}

function TacticRow({ tactic, data }: { tactic: string; data: { covered: number; total: number } }) {
  const pct = Math.round((data.covered / Math.max(1, data.total)) * 100);
  return (
    <div className="flex items-center gap-4">
      <p className="font-mono text-xs w-40 text-ink/70">{tactic}</p>
      <div className="flex-1 h-2 bg-ink/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 transition-all duration-base"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="font-mono text-xs text-ink/60 w-20 text-right">{data.covered}/{data.total}</p>
    </div>
  );
}

function RuleRow({
  rule, isAdmin, onTest, onApprove, onReject, testPending,
}: {
  rule: GeneratedRule; isAdmin: boolean;
  onTest: () => void; onApprove: () => void; onReject: () => void; testPending: boolean;
}) {
  const tr = rule.testResults;
  return (
    <div className="border border-ink/10 rounded-lg p-4 mb-3">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge tone={STATUS_TONE[rule.status]}>{rule.status}</Badge>
            <Badge tone={SEV_TONE[rule.severity]}>{rule.severity}</Badge>
            {/* Make demo rules unmistakable so nobody mis-claims AI origin. */}
            {rule.createdBy === "demo_template" && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-amber-200 text-amber-900 border border-amber-300">
                DEMO TEMPLATE
              </span>
            )}
            {rule.createdBy === "ai_daily_study" && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider bg-violet-200 text-violet-900 border border-violet-300">
                AI-GENERATED
              </span>
            )}
            {rule.attackTechnique && (
              <span className="font-mono text-xs text-ink/60">
                {rule.attackTechnique.mitreId} · {rule.attackTechnique.tactic}
              </span>
            )}
            <span className="font-mono text-[10px] text-ink/50">{rule.createdBy}</span>
          </div>
          <h4 className="font-display text-base">{rule.title}</h4>
          <p className="text-sm text-ink/70 mt-1">{rule.description}</p>
          {rule.rationale && <p className="text-xs text-ink/60 italic mt-1">"{rule.rationale}"</p>}
        </div>
        {isAdmin && (
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {rule.status === "DRAFT" && (
              <Button size="sm" variant="secondary" loading={testPending} onClick={onTest}>Test</Button>
            )}
            {rule.status === "TESTING" && (
              <>
                <Button size="sm" variant="primary" onClick={onApprove}>Approve</Button>
                <Button size="sm" variant="ghost" onClick={onReject}>Reject</Button>
              </>
            )}
          </div>
        )}
      </div>
      {/* Test results */}
      {tr && typeof tr.totalFires === "number" && (
        <div className="grid grid-cols-3 gap-3 text-xs bg-ink/[0.02] rounded p-2 mt-2 font-mono">
          <span>30d fires: <strong>{tr.totalFires}</strong></span>
          <span>matching alerts: <strong>{tr.matchingAlerts}</strong></span>
          <span>signal: <strong>{((tr.signalStrength ?? 0) * 100).toFixed(0)}%</strong></span>
        </div>
      )}
      <details className="text-xs mt-2">
        <summary className="cursor-pointer text-ink/60 hover:text-ink">Rule logic</summary>
        <pre className="mt-2 bg-ink/[0.03] rounded p-2 overflow-x-auto text-[11px]">{JSON.stringify(rule.logic, null, 2)}</pre>
      </details>
    </div>
  );
}
