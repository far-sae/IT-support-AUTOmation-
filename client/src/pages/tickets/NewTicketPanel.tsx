import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ticketsApi } from "../../api/endpoints.js";
import { ApiError } from "../../api/client.js";
import { Card } from "../../components/ui/Card.js";
import { Badge, priorityTone } from "../../components/ui/Badge.js";
import { Field, TextArea } from "../../components/ui/Field.js";
import { Button } from "../../components/ui/Button.js";
import type { TriagePreview } from "../../types.js";

const DEBOUNCE_MS = 350;

export function NewTicketPanel() {
  const qc = useQueryClient();
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<TriagePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<number | null>(null);

  // Live triage preview, debounced.
  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    if (description.trim().length < 5) { setPreview(null); return; }
    setPreviewing(true);
    debounce.current = window.setTimeout(() => {
      ticketsApi.triagePreview(description)
        .then(setPreview)
        .catch(() => setPreview(null))
        .finally(() => setPreviewing(false));
    }, DEBOUNCE_MS);
    return () => { if (debounce.current) window.clearTimeout(debounce.current); };
  }, [description]);

  const create = useMutation({
    mutationFn: async () => {
      const r = await ticketsApi.create(description);
      // Sequentially upload attachments to the new ticket.
      for (const f of files) {
        await ticketsApi.uploadAttachment(r.ticket.id, f);
      }
      return r.ticket;
    },
    onSuccess: () => {
      setDescription(""); setFiles([]); setPreview(null); setError(null);
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not create the ticket.");
    },
  });

  return (
    <Card className="p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">New ticket</p>
      <h3 className="font-display text-2xl mb-4">Tell us what's broken</h3>

      <form onSubmit={(e) => { e.preventDefault(); if (description.trim().length >= 5) create.mutate(); }} className="space-y-4">
        <Field
          label="Description"
          hint="Include error messages, what you were doing, when it started — the more detail, the faster we triage."
        >
          <TextArea
            placeholder="e.g. VPN keeps dropping every few minutes — happens on both wifi and ethernet."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={5000}
          />
        </Field>

        <Field label="Attachments" hint="Screenshots, logs, anything that'd help (10 MB max each)">
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="text-sm"
          />
          {files.length > 0 && (
            <ul className="mt-2 text-xs text-ink/70 space-y-1">
              {files.map(f => (
                <li key={f.name} className="font-mono">{f.name} <span className="text-ink/50">({Math.round(f.size / 1024)} KB)</span></li>
              ))}
            </ul>
          )}
        </Field>

        {/* Live triage preview */}
        {preview && (
          <div className="rounded-2xl border border-ink/10 p-4 bg-paper">
            <div className="flex items-center justify-between mb-2">
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60">Triage preview</p>
              <p className="font-mono text-xs text-ink/60">{Math.round(preview.confidence * 100)}% confidence</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-ink/60 text-xs">Category</p>
                <p className="font-medium">{preview.category}</p>
              </div>
              <div>
                <p className="text-ink/60 text-xs">Priority</p>
                <Badge tone={priorityTone(preview.priority)}>{preview.priority}</Badge>
              </div>
              <div>
                <p className="text-ink/60 text-xs">Team</p>
                <p className="font-medium">{preview.assignedTeam}</p>
              </div>
              <div>
                <p className="text-ink/60 text-xs">SLA target</p>
                <p className="font-medium">{preview.slaTarget}</p>
              </div>
            </div>
            {preview.matchedKeywords.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {preview.matchedKeywords.map(k => (
                  <span key={k} className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-ink/5">{k}</span>
                ))}
              </div>
            )}
          </div>
        )}
        {previewing && !preview && (
          <p className="text-xs text-ink/50">Triaging…</p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={create.isPending || description.trim().length < 5}>
            {create.isPending ? "Submitting…" : "Submit ticket"}
          </Button>
          <p className="text-xs text-ink/60">You'll get an email confirmation right away.</p>
        </div>
      </form>
    </Card>
  );
}
