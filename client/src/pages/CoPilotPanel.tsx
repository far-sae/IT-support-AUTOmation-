/**
 * Phase 10C — Co-pilot panel for the Remote page.
 *
 * Shows five one-click Tier 2 actions and the device's recent agent-action
 * history. Dispatches actions directly via /api/devices/:id/actions, no
 * ticket needed. Useful when an agent is exploring a device and wants to
 * try a quick fix.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { devicesApi } from "../api/endpoints.js";
import { Card } from "../components/ui/Card.js";
import { Badge } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { ApiError } from "../api/client.js";
import type { AgentAction, AgentActionKind } from "../types.js";

interface QuickAction {
  kind: AgentActionKind;
  label: string;
  hint: string;
  input?: Record<string, unknown>;
}

const QUICK_ACTIONS: QuickAction[] = [
  { kind: "RUN_DIAGNOSTIC",        label: "Run diagnostic",        hint: "Network, DNS, disk, services" },
  { kind: "RESTART_SERVICE",       label: "Restart Outlook",       hint: "Stops + starts outlook",      input: { service: "outlook" } },
  { kind: "CLEAR_CACHE",           label: "Clear Slack cache",     hint: "Stops Slack, nukes cache",     input: { app: "slack" } },
  { kind: "DISK_CLEANUP",          label: "Disk cleanup",          hint: "Free temp + caches" },
  { kind: "APPLY_PENDING_UPDATES", label: "Apply OS updates",      hint: "Stage available patches" },
];

function statusTone(s: AgentAction["status"]) {
  switch (s) {
    case "SUCCEEDED":   return "success";
    case "FAILED":      return "danger";
    case "QUEUED":      return "neutral";
    case "IN_PROGRESS": return "info";
    case "EXPIRED":     return "warn";
    case "CANCELLED":   return "neutral";
  }
}

function relative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export function CoPilotPanel({
  deviceId, deviceHostname, discoverySource,
}: {
  deviceId: string; deviceHostname: string;
  discoverySource: "AGENT" | "MANUAL";
}) {
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["device-actions", deviceId],
    queryFn: () => devicesApi.listActions(deviceId),
    refetchInterval: 10_000,
  });

  const dispatch = useMutation({
    mutationFn: (a: QuickAction) => devicesApi.dispatchAction(deviceId, a.kind, a.input ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["device-actions", deviceId] }),
  });

  const isAgent = discoverySource === "AGENT";

  return (
    <Card className="p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Co-pilot</p>
      <h3 className="font-display text-xl mb-2">Quick actions</h3>
      <p className="text-sm text-ink/70 mb-4">Dispatch a real action on <strong>{deviceHostname}</strong>. The local agent picks it up on its next poll.</p>

      {!isAgent && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 mb-4">
          This device has no Relay agent yet. Install it (Organization → Agent tokens) before dispatching actions.
        </div>
      )}

      <ul className="space-y-2 mb-6">
        {QUICK_ACTIONS.map((a) => (
          <li key={a.kind + (a.input?.service ?? a.input?.app ?? "")}>
            <Button
              variant="secondary" size="sm"
              disabled={!isAgent || dispatch.isPending}
              onClick={() => dispatch.mutate(a)}
              className="w-full justify-between"
            >
              <span>{a.label}</span>
              <span className="text-[10px] font-mono text-ink/50">{a.hint}</span>
            </Button>
          </li>
        ))}
      </ul>

      {dispatch.error && (
        <p className="text-xs text-red-600 mb-3">{(dispatch.error as ApiError).message}</p>
      )}

      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-2">Recent actions</p>
      {error && <p className="text-xs text-red-600">{(error as Error).message}</p>}
      {data && data.actions.length === 0 && (
        <p className="text-xs text-ink/60">No actions yet.</p>
      )}
      {data && data.actions.length > 0 && (
        <ul className="space-y-2 max-h-72 overflow-y-auto">
          {data.actions.map((a) => {
            const r = a.result as { ok?: boolean; output?: string };
            return (
              <li key={a.id} className="rounded-xl border border-ink/10 p-3 text-xs">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-mono">{a.kind}</span>
                  <Badge tone={statusTone(a.status)}>{a.status.replace(/_/g, " ")}</Badge>
                </div>
                <p className="text-[10px] text-ink/50 font-mono">{relative(a.createdAt)}</p>
                {r?.output && (
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-ink/80 mt-1.5">{String(r.output).slice(0, 400)}</pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
