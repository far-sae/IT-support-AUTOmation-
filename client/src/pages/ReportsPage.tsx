import { useState } from "react";
import { Header } from "../components/Header.js";
import { Card } from "../components/ui/Card.js";
import { Button } from "../components/ui/Button.js";
import { Field, TextInput } from "../components/ui/Field.js";
import { downloadFile } from "../api/client.js";

export default function ReportsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function rangeQuery() {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const q = params.toString();
    return q ? `?${q}` : "";
  }

  async function download(kind: "tickets" | "csat", format: "csv" | "pdf") {
    setBusy(`${kind}-${format}`); setError(null);
    try {
      await downloadFile(`/api/reports/${kind}.${format}${rangeQuery()}`, `relay-${kind}.${format}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Header title="Reports" subtitle="Export ticket activity and customer-satisfaction data." />

      <Card className="p-6 mb-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Date range</p>
        <h3 className="font-display text-xl mb-4">Window</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
          <Field label="From"><TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-ink/60 mt-2">Leave blank to export everything.</p>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Tickets</p>
          <h3 className="font-display text-2xl mb-2">Ticket report</h3>
          <p className="text-sm text-ink/70 mb-5">Ref, category, priority, status, team, agent, dates and SLA status.</p>
          <div className="flex gap-2">
            <Button onClick={() => download("tickets", "csv")} disabled={busy !== null}>
              {busy === "tickets-csv" ? "Generating…" : "Download CSV"}
            </Button>
            <Button variant="secondary" onClick={() => download("tickets", "pdf")} disabled={busy !== null}>
              {busy === "tickets-pdf" ? "Generating…" : "Download PDF"}
            </Button>
          </div>
        </Card>

        <Card className="p-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">CSAT</p>
          <h3 className="font-display text-2xl mb-2">Satisfaction report</h3>
          <p className="text-sm text-ink/70 mb-5">Average rating, response count, rating distribution and recent comments.</p>
          <div className="flex gap-2">
            <Button onClick={() => download("csat", "csv")} disabled={busy !== null}>
              {busy === "csat-csv" ? "Generating…" : "Download CSV"}
            </Button>
            <Button variant="secondary" onClick={() => download("csat", "pdf")} disabled={busy !== null}>
              {busy === "csat-pdf" ? "Generating…" : "Download PDF"}
            </Button>
          </div>
        </Card>
      </div>

      {error && <p className="mt-6 text-sm text-red-600">{error}</p>}
    </>
  );
}
