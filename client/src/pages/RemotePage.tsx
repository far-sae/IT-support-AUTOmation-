import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { devicesApi } from "../api/endpoints.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Badge, statusTone } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Select } from "../components/ui/Field.js";
import { ErrorState, LoadingState } from "../components/ui/EmptyState.js";
import { CoPilotPanel } from "./CoPilotPanel.js";
import type { RemoteSession, SessionEvent } from "../types.js";

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export default function RemotePage() {
  const qc = useQueryClient();
  const devicesQ = useQuery({
    queryKey: ["devices"],
    queryFn: () => devicesApi.list(),
  });

  const [deviceId, setDeviceId] = useState<string>("");
  const [session, setSession] = useState<RemoteSession | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  // tick the timer while LIVE
  useEffect(() => {
    if (session?.status !== "LIVE") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session?.status]);

  // poll-by-invalidation: when sessions update via socket, refetch
  const sessionQ = useQuery({
    queryKey: ["session", session?.id ?? "none"],
    queryFn: () => devicesApi.getSession(session!.id),
    enabled: Boolean(session?.id),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (sessionQ.data?.session) setSession(sessionQ.data.session);
  }, [sessionQ.data]);

  const start = useMutation({
    mutationFn: () => devicesApi.startSession(deviceId),
    onSuccess: (r) => {
      setSession(r.session);
      setNow(Date.now());
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
  });

  const append = useMutation({
    mutationFn: (event: { type: string; message: string }) =>
      devicesApi.appendEvent(session!.id, event),
    onSuccess: (r) => setSession(r.session),
  });

  const end = useMutation({
    mutationFn: () => devicesApi.endSession(session!.id),
    onSuccess: (r) => setSession(r.session),
  });

  const events = useMemo<SessionEvent[]>(() => session?.eventLog ?? [], [session]);
  const latency = useMemo(() => Math.floor(20 + Math.random() * 40), [events.length]);
  const elapsed = session?.startedAt ? now - new Date(session.startedAt).getTime() : 0;

  return (
    <>
      <Header
        title="Remote support"
        subtitle="Pick a device, connect, and run diagnostics — every action is logged."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <Card className="p-0 overflow-hidden">
          <div className="border-b border-ink/10 bg-ink text-paper px-6 py-4 flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-paper/60">Remote session</p>
              <p className="font-display text-xl">
                {session ? session.device?.hostname ?? "Connecting…" : "No active session"}
              </p>
            </div>
            <div className="text-right font-mono text-xs space-y-1">
              {session ? (
                <>
                  <p>Status: <span className="text-lime">{session.status}</span></p>
                  <p>Elapsed: <span className="text-lime">{formatDuration(elapsed)}</span></p>
                  <p>Latency: <span className="text-lime">{latency} ms</span></p>
                </>
              ) : (
                <p className="text-paper/60">Pick a device to connect →</p>
              )}
            </div>
          </div>

          {/* Simulated remote desktop viewport */}
          <div className="aspect-video bg-ink/95 text-paper relative">
            {session ? (
              <>
                <div className="absolute inset-0 grid grid-cols-12 grid-rows-8 gap-1 p-3 opacity-40">
                  {Array.from({ length: 96 }).map((_, i) => (
                    <div key={i} className="bg-paper/5 rounded" />
                  ))}
                </div>
                <div className="absolute inset-0 flex items-center justify-center text-paper/60 font-mono text-xs">
                  ◉ live screen mirror — {session.device?.hostname}
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-paper/60 font-mono text-xs">
                no signal
              </div>
            )}
          </div>

          {/* Toolbar */}
          <div className="px-6 py-4 border-t border-ink/10 flex flex-wrap gap-2">
            <Button
              variant="secondary" size="sm"
              disabled={!session || session.status === "ENDED" || append.isPending}
              onClick={() => append.mutate({ type: "diagnostic", message: "Ran network + storage diagnostic. No errors." })}
            >
              Run diagnostic
            </Button>
            <Button
              variant="secondary" size="sm"
              disabled={!session || session.status === "ENDED" || append.isPending}
              onClick={() => append.mutate({ type: "update", message: "Pushed pending OS updates." })}
            >
              Push updates
            </Button>
            <Button
              variant="secondary" size="sm"
              disabled={!session || session.status === "ENDED" || append.isPending}
              onClick={() => append.mutate({ type: "restart", message: "Issued a remote restart." })}
            >
              Restart
            </Button>
            <Button
              variant="secondary" size="sm"
              disabled={!session || session.status === "ENDED" || append.isPending}
              onClick={() => append.mutate({ type: "file-transfer", message: "Sent diagnostic-collector.zip to the device." })}
            >
              Transfer file
            </Button>
            <div className="flex-1" />
            <Button
              variant="danger" size="sm"
              disabled={!session || session.status === "ENDED" || end.isPending}
              onClick={() => end.mutate()}
            >
              End session
            </Button>
          </div>

          {/* Event log */}
          <div className="px-6 py-4 border-t border-ink/10">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-2">Session log</p>
            {events.length === 0 && <p className="text-sm text-ink/60">No events yet.</p>}
            <ul className="space-y-1">
              {events.map((e, i) => (
                <li key={i} className="font-mono text-xs flex gap-3">
                  <span className="text-ink/50">{new Date(e.time).toLocaleTimeString()}</span>
                  <Badge tone={e.type === "system" ? "neutral" : "info"}>{e.type}</Badge>
                  <span className="text-ink/80">{e.message}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="p-6 h-fit">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Pick a device</p>
          <h3 className="font-display text-xl mb-4">Connect</h3>
          {devicesQ.isLoading && <LoadingState />}
          {devicesQ.error && <ErrorState message={(devicesQ.error as Error).message} />}
          {devicesQ.data && (
            <>
              <Select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="mb-3">
                <option value="">— select a device —</option>
                {devicesQ.data.devices.map(d => (
                  <option key={d.id} value={d.id}>{d.hostname} · {d.assignedUser}</option>
                ))}
              </Select>
              <Button
                onClick={() => start.mutate()}
                disabled={!deviceId || start.isPending || (session?.status === "LIVE")}
                className="w-full"
              >
                {start.isPending ? "Connecting…" : "Start session"}
              </Button>
              <p className="text-xs text-ink/60 mt-3">
                Sessions are simulated — every action is logged and broadcast to anyone viewing the ticket.
              </p>
              {session && (
                <div className="mt-4 text-xs">
                  <p className="text-ink/60 font-mono uppercase tracking-widest mb-1">Current session</p>
                  <Badge tone={statusTone(session.status)}>{session.status}</Badge>
                </div>
              )}
            </>
          )}
        </Card>

        {/* Phase 10C — Co-pilot quick-action panel for the selected device */}
        {deviceId && devicesQ.data && (() => {
          const d = devicesQ.data.devices.find((x) => x.id === deviceId);
          if (!d) return null;
          return (
            <CoPilotPanel
              deviceId={d.id}
              deviceHostname={d.hostname}
              discoverySource={d.discoverySource}
            />
          );
        })()}
      </div>
    </>
  );
}
