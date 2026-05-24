/**
 * Dashboard tile that surfaces the "intelligence" layer added in Phases
 * 12-16: live detection hits, in-flight workflows, latest ML model. One
 * compact card so a tired admin sees what the autopilot is up to without
 * clicking through.
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { detectionsApi, mlApi, threatApi, workflowsApi } from "../api/endpoints.js";
import { Card } from "../components/ui/Card.js";
import { Badge } from "../components/ui/Badge.js";

export function IntelligenceCard() {
  const { orgSlug } = useParams<{ orgSlug?: string }>();
  const base = orgSlug ? `/app/${orgSlug}` : "";

  const hitsQ      = useQuery({ queryKey: ["detections", "hits", "open"], queryFn: () => detectionsApi.listHits("open"), refetchInterval: 30_000 });
  const execQ      = useQuery({ queryKey: ["workflows", "executions"],    queryFn: () => workflowsApi.listExecutions(),  refetchInterval: 30_000 });
  const modelsQ    = useQuery({ queryKey: ["ml", "models"],               queryFn: () => mlApi.listModels() });
  const threatQ    = useQuery({ queryKey: ["threat", "matches"],          queryFn: () => threatApi.listMatches("open"), refetchInterval: 60_000 });

  const openHits = hitsQ.data?.hits ?? [];
  const critical = openHits.filter((h) => h.severity === "CRITICAL").length;
  const high     = openHits.filter((h) => h.severity === "HIGH").length;
  const executions = execQ.data?.executions ?? [];
  const running    = executions.filter((e) => ["RUNNING", "WAITING", "AWAITING_APPROVAL", "COMPENSATING"].includes(e.status)).length;
  const activeModel = (modelsQ.data?.models ?? []).find((m) => m.active) ?? null;
  const threatMatches = threatQ.data?.matches ?? [];
  const threatCrit    = threatMatches.filter((m) => m.threatIntel.severity === "CRITICAL").length;

  return (
    <Card className="p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Autopilot intelligence</p>
      <h3 className="font-display text-xl mb-4">What the brain is doing</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Threat intel matches */}
        <Link to={`${base}/threat`} className="block border border-ink/10 rounded-lg p-4 hover:bg-ink/5 transition">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Threat intel</span>
            {threatCrit > 0
              ? <Badge tone="danger">{threatCrit} crit</Badge>
              : threatMatches.length > 0
                ? <Badge tone="warn">{threatMatches.length}</Badge>
                : <Badge tone="success">clear</Badge>}
          </div>
          <p className="font-display text-3xl">{threatMatches.length}</p>
          <p className="text-xs text-ink/60">live CVE matches against your fleet</p>
        </Link>

        {/* Detections */}
        <Link to={`${base}/detections`} className="block border border-ink/10 rounded-lg p-4 hover:bg-ink/5 transition">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Detections</span>
            {critical > 0 && <Badge tone="danger">{critical} crit</Badge>}
            {critical === 0 && high > 0 && <Badge tone="warn">{high} high</Badge>}
            {critical === 0 && high === 0 && openHits.length === 0 && <Badge tone="success">clear</Badge>}
          </div>
          <p className="font-display text-3xl">{openHits.length}</p>
          <p className="text-xs text-ink/60">unacknowledged hits</p>
        </Link>

        {/* Workflows */}
        <Link to={`${base}/workflows`} className="block border border-ink/10 rounded-lg p-4 hover:bg-ink/5 transition">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Workflows</span>
            {running > 0 ? <Badge tone="info">{running} live</Badge> : <Badge tone="neutral">idle</Badge>}
          </div>
          <p className="font-display text-3xl">{executions.length}</p>
          <p className="text-xs text-ink/60">{running} active, {executions.length - running} historical</p>
        </Link>

        {/* ML model */}
        <Link to={`${base}/ml`} className="block border border-ink/10 rounded-lg p-4 hover:bg-ink/5 transition">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Brain model</span>
            {activeModel
              ? <Badge tone="success">v{activeModel.version}</Badge>
              : <Badge tone="neutral">untrained</Badge>}
          </div>
          <p className="font-display text-3xl">
            {activeModel ? `${(activeModel.metrics.accuracy * 100).toFixed(0)}%` : "—"}
          </p>
          <p className="text-xs text-ink/60">
            {activeModel
              ? `accuracy on ${activeModel.metrics.sampleCount} examples`
              : "no labelled history yet"}
          </p>
        </Link>
      </div>
    </Card>
  );
}
