import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { publicApi } from "../api/endpoints.js";
import { Card } from "../components/ui/Card.js";
import { Badge, statusTone } from "../components/ui/Badge.js";
import { ErrorState, LoadingState } from "../components/ui/EmptyState.js";

export default function StatusPage() {
  const { orgSlug = "" } = useParams<{ orgSlug: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["status", orgSlug],
    queryFn: () => publicApi.status(orgSlug),
    enabled: Boolean(orgSlug),
    retry: false,
  });

  const overall = (() => {
    if (!data) return null;
    if (data.activeIncidents.some(i => i.impact === "CRITICAL")) return { label: "Critical outage", tone: "danger" as const };
    if (data.components.some(c => c.status === "OUTAGE")) return { label: "Outage", tone: "danger" as const };
    if (data.components.some(c => c.status === "DEGRADED")) return { label: "Degraded performance", tone: "warn" as const };
    return { label: "All systems operational", tone: "success" as const };
  })();

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <p className="font-mono text-xs uppercase tracking-widest text-ink/60 mb-3">
          Relay · Status · <span className="font-mono">{orgSlug}</span>
        </p>
        <h1 className="font-display text-4xl md:text-5xl mb-3">
          {data ? `${data.organization.name} — service status` : "Service status"}
        </h1>
        {overall && (
          <div className="inline-flex"><Badge tone={overall.tone} className="text-sm px-3 py-1">{overall.label}</Badge></div>
        )}

        {isLoading && <LoadingState />}
        {error && <ErrorState message={(error as Error).message} />}

        {data && (
          <>
            <section className="mt-10">
              <h2 className="font-display text-2xl mb-4">Services</h2>
              <Card>
                <ul className="divide-y divide-ink/10">
                  {data.components.map(c => (
                    <li key={c.id} className="flex items-center justify-between px-6 py-4">
                      <span className="font-medium">{c.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-ink/60">{c.uptime90d.toFixed(2)}% · 90d</span>
                        <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>

            {data.activeIncidents.length > 0 && (
              <section className="mt-10">
                <h2 className="font-display text-2xl mb-4">Active incidents</h2>
                <div className="space-y-4">
                  {data.activeIncidents.map(inc => (
                    <Card key={inc.id} className="p-6">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <h3 className="font-display text-xl">{inc.title}</h3>
                        <Badge tone={statusTone(inc.status)}>{inc.status}</Badge>
                      </div>
                      <p className="text-xs text-ink/60 mb-3">
                        {inc.component?.name} · Started {new Date(inc.startedAt).toLocaleString()}
                      </p>
                      <ol className="space-y-2 border-l border-ink/10 pl-4">
                        {inc.updates.slice().reverse().map((u, i) => (
                          <li key={i}>
                            <p className="font-mono text-xs text-ink/60">{new Date(u.time).toLocaleString()} · {u.status}</p>
                            <p className="text-sm">{u.message}</p>
                          </li>
                        ))}
                      </ol>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {data.recentHistory.length > 0 && (
              <section className="mt-10">
                <h2 className="font-display text-2xl mb-4">Recent history</h2>
                <Card>
                  <ul className="divide-y divide-ink/10">
                    {data.recentHistory.map(inc => (
                      <li key={inc.id} className="px-6 py-4">
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <p className="font-medium">{inc.title}</p>
                          <Badge tone="success">Resolved</Badge>
                        </div>
                        <p className="text-xs text-ink/60">
                          {inc.component?.name} · {new Date(inc.startedAt).toLocaleDateString()} → {inc.resolvedAt ? new Date(inc.resolvedAt).toLocaleDateString() : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            )}
          </>
        )}

        <p className="text-xs text-ink/50 mt-16">No login required · Updated live</p>
      </div>
    </div>
  );
}
