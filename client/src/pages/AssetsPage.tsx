import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { agentApi, devicesApi } from "../api/endpoints.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Badge, statusTone } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Select } from "../components/ui/Field.js";
import { Gauge } from "../components/ui/Gauge.js";
import { Sparkline } from "../components/ui/Sparkline.js";
import { ErrorState, LoadingState, EmptyState } from "../components/ui/EmptyState.js";
import type { Device, HealthStatus } from "../types.js";

// Devices that haven't checked in within this window are "stale".
// Mirrors AGENT_STALE_MINUTES on the server; kept loose here since the
// server is the source of truth for healthStatus anyway.
const STALE_MINUTES = 15;

function isStale(d: Device): boolean {
  if (d.discoverySource !== "AGENT") return false;
  if (!d.lastCheckInAt) return true;
  return Date.now() - new Date(d.lastCheckInAt).getTime() > STALE_MINUTES * 60 * 1000;
}

function relativeMinutes(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export default function AssetsPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["devices"],
    queryFn: () => devicesApi.list(),
  });

  const [health, setHealth] = useState<HealthStatus | "ALL">("ALL");
  const [source, setSource] = useState<"ALL" | "AGENT" | "MANUAL">("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.devices.filter((d) => {
      if (health !== "ALL" && d.healthStatus !== health) return false;
      if (source !== "ALL" && d.discoverySource !== source) return false;
      return true;
    });
  }, [data, health, source]);

  return (
    <>
      <Header
        title="Assets"
        subtitle="Fleet health, agent telemetry and patch status. Click any row to inspect."
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select value={health} onChange={(e) => setHealth(e.target.value as HealthStatus | "ALL")} className="max-w-[180px]">
          <option value="ALL">All health states</option>
          <option value="HEALTHY">Healthy only</option>
          <option value="WARNING">Warning only</option>
          <option value="CRITICAL">Critical only</option>
        </Select>
        <Select value={source} onChange={(e) => setSource(e.target.value as "ALL" | "AGENT" | "MANUAL")} className="max-w-[180px]">
          <option value="ALL">Any source</option>
          <option value="AGENT">Agent-discovered</option>
          <option value="MANUAL">Manually added</option>
        </Select>
      </div>

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}
      {data && filtered.length === 0 && <EmptyState title="No devices match that filter" />}

      {filtered.length > 0 && (
        <Card>
          <ul className="divide-y divide-ink/10">
            {filtered.map((d) => {
              const open = expanded === d.id;
              const stale = isStale(d);
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    className="w-full text-left px-6 py-4 hover:bg-ink/5"
                    onClick={() => setExpanded(open ? null : d.id)}
                  >
                    <div className="flex items-center gap-4">
                      <Badge tone={statusTone(d.healthStatus)}>{d.healthStatus}</Badge>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium flex items-center gap-2">
                          {d.hostname}
                          {d.discoverySource === "AGENT" && !stale && <Badge tone="success">Online</Badge>}
                          {d.discoverySource === "AGENT" && stale && <Badge tone="warn">Stale</Badge>}
                          {d.discoverySource === "MANUAL" && <Badge tone="neutral">Manual</Badge>}
                        </p>
                        <p className="text-xs text-ink/60">{d.assignedUser} · {d.type} · {d.os}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono text-xs text-ink/60">{d.patchStatus}</p>
                        {d.discoverySource === "AGENT" && (
                          <p className="font-mono text-[10px] text-ink/50">checked in {relativeMinutes(d.lastCheckInAt)}</p>
                        )}
                      </div>
                      <span className="text-ink/40">{open ? "▾" : "▸"}</span>
                    </div>
                  </button>
                  {open && <DeviceDetail device={d} onRemote={() => navigate("../remote")} />}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}

function DeviceDetail({ device, onRemote }: { device: Device; onRemote: () => void }) {
  const { data } = useQuery({
    queryKey: ["device-metrics", device.id],
    queryFn: () => agentApi.metrics(device.id, 24),
    enabled: device.discoverySource === "AGENT",
  });

  const cpu = data?.metrics.map((m) => m.cpu) ?? [];
  const ram = data?.metrics.map((m) => m.ram) ?? [];
  const disk = data?.metrics.map((m) => m.disk) ?? [];

  return (
    <div className="px-6 pb-6 grid grid-cols-1 md:grid-cols-3 gap-6">
      <div>
        <Gauge value={device.diskUsage} label="Disk usage" />
        <div className="mt-4"><Gauge value={device.ramUsage} label="RAM usage" /></div>
      </div>

      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-2">Last 24 h (agent)</p>
        {device.discoverySource === "AGENT" ? (
          <div className="space-y-1.5">
            <Sparkline label="CPU"  values={cpu} />
            <Sparkline label="RAM"  values={ram} />
            <Sparkline label="DISK" values={disk} />
          </div>
        ) : (
          <p className="text-xs text-ink/60">No agent installed on this device. Generate an enrollment token in <strong>Organization → Agent tokens</strong> and run the agent on the device to start collecting telemetry.</p>
        )}
      </div>

      <div className="flex flex-col items-start justify-end">
        <p className="text-xs text-ink/60 mb-1">Last seen: {new Date(device.lastSeenAt).toLocaleString()}</p>
        {device.agentVersion && (
          <p className="text-xs text-ink/60 mb-3 font-mono">Agent v{device.agentVersion}</p>
        )}
        <Button size="sm" variant="primary" onClick={onRemote}>Remote into this device →</Button>
      </div>
    </div>
  );
}
