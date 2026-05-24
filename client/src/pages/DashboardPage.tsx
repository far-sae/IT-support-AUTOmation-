import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { analyticsApi } from "../api/endpoints.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Badge, priorityTone } from "../components/ui/Badge.js";
import { ErrorState, LoadingState } from "../components/ui/EmptyState.js";
import { DailyBriefCard } from "./DailyBriefCard.js";
import { IntelligenceCard } from "./IntelligenceCard.js";

function Kpi({ label, value, hint, tone }: {
  label: string; value: string; hint?: string;
  tone?: "default" | "warn" | "danger" | "success";
}) {
  const toneCls =
    tone === "danger"  ? "text-red-700" :
    tone === "warn"    ? "text-amber-700" :
    tone === "success" ? "text-emerald-700" :
    "text-ink";
  return (
    <Card className="p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">{label}</p>
      <p className={`font-display text-4xl mt-2 ${toneCls}`}>{value}</p>
      {hint && <p className="text-ink/60 text-xs mt-1">{hint}</p>}
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics"],
    queryFn: () => analyticsApi.get(),
  });

  return (
    <>
      <Header title="Dashboard" subtitle="A live snapshot of the helpdesk." />

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {/* Phase 11 — daily brief widget sits at the top of the dashboard. */}
      <div className="mb-6">
        <DailyBriefCard />
      </div>

      {/* Phases 12-16 — autopilot intelligence at a glance. */}
      <div className="mb-6">
        <IntelligenceCard />
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
            <Kpi label="Open"      value={String(data.open)}                                         />
            <Kpi label="Resolved"  value={String(data.resolved)}                                     />
            <Kpi label="SLA at risk" value={String(data.slaAtRisk)} tone={data.slaAtRisk > 0 ? "warn" : "default"} />
            <Kpi label="SLA breached" value={String(data.slaBreached)} tone={data.slaBreached > 0 ? "danger" : "default"} />
            <Kpi label="Fleet health" value={`${data.fleetHealthPct}%`} tone={data.fleetHealthPct >= 90 ? "success" : data.fleetHealthPct >= 75 ? "warn" : "danger"} />
            <Kpi
              label="CSAT"
              value={data.csat.responses === 0 ? "—" : data.csat.average.toFixed(2)}
              hint={data.csat.responses === 0 ? "no responses yet" : `${data.csat.responses} ${data.csat.responses === 1 ? "response" : "responses"}`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 p-6">
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Tickets by category</p>
              <h3 className="font-display text-2xl mb-4">Where the load lives</h3>
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={data.byCategory} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <XAxis dataKey="category" tickLine={false} axisLine={false} stroke="#17160E80" fontSize={12} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} stroke="#17160E80" fontSize={12} />
                    <Tooltip cursor={{ fill: "#17160E10" }} contentStyle={{ background: "#17160E", color: "#C8F23A", border: 0, borderRadius: 8 }} />
                    <Bar dataKey="count" fill="#17160E" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-6">
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Priority mix</p>
              <h3 className="font-display text-2xl mb-4">What's burning</h3>
              <ul className="space-y-3">
                {data.byPriority.map((p) => (
                  <li key={p.priority} className="flex items-center justify-between">
                    <Badge tone={priorityTone(p.priority)}>{p.priority}</Badge>
                    <span className="font-mono text-sm">{p.count}</span>
                  </li>
                ))}
              </ul>
              <hr className="my-6 border-ink/10" />
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-2">Fleet</p>
              <ul className="space-y-2">
                {data.fleet.map((f) => (
                  <li key={f.status} className="flex items-center justify-between text-sm">
                    <span className="text-ink/80">{f.status}</span>
                    <span className="font-mono">{f.count}</span>
                  </li>
                ))}
              </ul>
              <hr className="my-6 border-ink/10" />
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-2">KB deflection</p>
              <p className="font-display text-2xl">{data.kbDeflection}</p>
              <p className="text-xs text-ink/60">tickets potentially avoided via self-service</p>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
