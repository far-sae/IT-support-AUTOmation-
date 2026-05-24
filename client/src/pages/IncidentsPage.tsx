import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { incidentsApi } from "../api/endpoints.js";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Badge, statusTone } from "../components/ui/Badge.js";
import { Button } from "../components/ui/Button.js";
import { Field, Select, TextArea, TextInput } from "../components/ui/Field.js";
import { ErrorState, LoadingState, EmptyState } from "../components/ui/EmptyState.js";
import { ApiError } from "../api/client.js";
import type { ComponentStatus, Incident, IncidentImpact, IncidentStatus } from "../types.js";

export default function IncidentsPage() {
  const qc = useQueryClient();
  const incidentsQ = useQuery({ queryKey: ["incidents"], queryFn: () => incidentsApi.list() });
  const componentsQ = useQuery({ queryKey: ["components"], queryFn: () => incidentsApi.components() });

  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const [componentId, setComponentId] = useState("");
  const [impact, setImpact] = useState<IncidentImpact>("MINOR");
  const [status, setStatus] = useState<IncidentStatus>("INVESTIGATING");
  const [componentStatus, setComponentStatus] = useState<ComponentStatus>("DEGRADED");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => incidentsApi.create({ title, componentId, impact, status, message, componentStatus }),
    onSuccess: () => {
      setTitle(""); setComponentId(""); setImpact("MINOR"); setStatus("INVESTIGATING");
      setComponentStatus("DEGRADED"); setMessage(""); setShowNew(false); setError(null);
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["status"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not create the incident."),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title || !componentId || !message) return;
    create.mutate();
  }

  return (
    <>
      <Header
        title="Incidents"
        subtitle="Active incidents and status-page history."
        action={
          <Button variant={showNew ? "secondary" : "primary"} onClick={() => setShowNew(s => !s)}>
            {showNew ? "Cancel" : "New incident"}
          </Button>
        }
      />

      {showNew && (
        <Card className="p-6 mb-6">
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
            <Field label="Component">
              <Select value={componentId} onChange={(e) => setComponentId(e.target.value)} required>
                <option value="">— select —</option>
                {componentsQ.data?.components.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Impact">
              <Select value={impact} onChange={(e) => setImpact(e.target.value as IncidentImpact)}>
                <option value="MINOR">Minor</option>
                <option value="MAJOR">Major</option>
                <option value="CRITICAL">Critical</option>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)}>
                <option value="INVESTIGATING">Investigating</option>
                <option value="IDENTIFIED">Identified</option>
                <option value="MONITORING">Monitoring</option>
                <option value="RESOLVED">Resolved</option>
              </Select>
            </Field>
            <Field label="Set component status">
              <Select value={componentStatus} onChange={(e) => setComponentStatus(e.target.value as ComponentStatus)}>
                <option value="OPERATIONAL">Operational</option>
                <option value="DEGRADED">Degraded</option>
                <option value="OUTAGE">Outage</option>
              </Select>
            </Field>
            <Field label="Initial message" hint="Shown publicly on the status page">
              <TextArea value={message} onChange={(e) => setMessage(e.target.value)} required rows={3} />
            </Field>
            {error && <p className="md:col-span-2 text-sm text-red-600">{error}</p>}
            <div className="md:col-span-2">
              <Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Open incident"}</Button>
            </div>
          </form>
        </Card>
      )}

      {incidentsQ.isLoading && <LoadingState />}
      {incidentsQ.error && <ErrorState message={(incidentsQ.error as Error).message} />}

      {incidentsQ.data && incidentsQ.data.incidents.length === 0 && (
        <EmptyState title="No incidents logged yet" description="Open one above if something's down." />
      )}

      <div className="space-y-4">
        {incidentsQ.data?.incidents.map((inc) => <IncidentCard key={inc.id} incident={inc} />)}
      </div>
    </>
  );
}

function IncidentCard({ incident }: { incident: Incident }) {
  const qc = useQueryClient();
  const [showUpdate, setShowUpdate] = useState(false);
  const [status, setStatus] = useState<IncidentStatus>(incident.status);
  const [message, setMessage] = useState("");
  const [componentStatus, setComponentStatus] = useState<ComponentStatus | "">("");

  const add = useMutation({
    mutationFn: () => incidentsApi.addUpdate(incident.id, {
      status,
      message,
      componentStatus: componentStatus || undefined,
      resolved: status === "RESOLVED",
    }),
    onSuccess: () => {
      setMessage(""); setShowUpdate(false); setComponentStatus("");
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["status"] });
    },
  });

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="font-display text-xl">{incident.title}</h3>
          <p className="text-xs text-ink/60 mt-1">
            {incident.component?.name} · Started {new Date(incident.startedAt).toLocaleString()}
            {incident.resolvedAt && ` · Resolved ${new Date(incident.resolvedAt).toLocaleString()}`}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Badge tone={statusTone(incident.status)}>{incident.status}</Badge>
          <Badge tone={incident.impact === "CRITICAL" ? "danger" : incident.impact === "MAJOR" ? "warn" : "neutral"}>
            {incident.impact}
          </Badge>
        </div>
      </div>

      <ol className="space-y-2 border-l border-ink/10 pl-4 mt-4">
        {incident.updates.map((u, i) => (
          <li key={i}>
            <p className="text-xs font-mono text-ink/60">{new Date(u.time).toLocaleString()} · {u.status}</p>
            <p className="text-sm">{u.message}</p>
          </li>
        ))}
      </ol>

      <div className="mt-5">
        {showUpdate ? (
          <div className="rounded-2xl border border-ink/10 p-4 space-y-3 bg-paper">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="New status">
                <Select value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)}>
                  <option value="INVESTIGATING">Investigating</option>
                  <option value="IDENTIFIED">Identified</option>
                  <option value="MONITORING">Monitoring</option>
                  <option value="RESOLVED">Resolved</option>
                </Select>
              </Field>
              <Field label="Set component status (optional)">
                <Select value={componentStatus} onChange={(e) => setComponentStatus(e.target.value as ComponentStatus | "")}>
                  <option value="">— unchanged —</option>
                  <option value="OPERATIONAL">Operational</option>
                  <option value="DEGRADED">Degraded</option>
                  <option value="OUTAGE">Outage</option>
                </Select>
              </Field>
            </div>
            <Field label="Update">
              <TextArea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
            </Field>
            <div className="flex gap-2">
              <Button type="button" onClick={() => add.mutate()} disabled={!message || add.isPending}>
                {add.isPending ? "Posting…" : "Post update"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowUpdate(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setShowUpdate(true)}>Post update</Button>
        )}
      </div>
    </Card>
  );
}
