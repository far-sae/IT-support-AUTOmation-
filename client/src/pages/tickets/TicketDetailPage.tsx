import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ticketsApi } from "../../api/endpoints.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { Header } from "../../components/Header.js";
import { Card } from "../../components/ui/Card.js";
import { Badge, priorityTone, statusTone } from "../../components/ui/Badge.js";
import { Button } from "../../components/ui/Button.js";
import { Select } from "../../components/ui/Field.js";
import { ErrorState, LoadingState } from "../../components/ui/EmptyState.js";
import { CommentThread } from "./CommentThread.js";
import { RunbookCard } from "./RunbookCard.js";
import type { TicketStatus } from "../../types.js";

export default function TicketDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isStaff = user?.role === "AGENT" || user?.role === "ADMIN";

  const ticketQ = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => ticketsApi.get(id),
    enabled: Boolean(id),
  });

  const attachmentsQ = useQuery({
    queryKey: ["attachments", id],
    queryFn: () => ticketsApi.listAttachments(id),
    enabled: Boolean(id),
  });

  const patch = useMutation({
    mutationFn: (body: { status?: TicketStatus; assignedAgentId?: string | null }) => ticketsApi.patch(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ticket", id] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  async function downloadAttachment(attachmentId: string) {
    const r = await ticketsApi.attachmentDownload(attachmentId);
    window.open(r.url, "_blank", "noopener,noreferrer");
  }

  if (!id) return <ErrorState message="Missing ticket id." />;
  if (ticketQ.isLoading) return <LoadingState />;
  if (ticketQ.error) return <ErrorState message={(ticketQ.error as Error).message} />;
  if (!ticketQ.data) return <ErrorState message="Ticket not found." />;

  const t = ticketQ.data.ticket;
  const isOverdue = t.status !== "RESOLVED" && new Date(t.slaDueAt).getTime() < Date.now();

  return (
    <>
      <Header
        title={t.refCode}
        subtitle={t.category + " · " + t.assignedTeam}
        action={
          <Button variant="secondary" size="sm" onClick={() => navigate(-1)}>
            ← Back
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Badge tone={statusTone(t.status)}>{t.status.replace("_", " ")}</Badge>
              <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
              {isOverdue && <Badge tone="danger">SLA breached</Badge>}
              <span className="font-mono text-xs text-ink/60">
                from {t.submitterName} &lt;{t.submitterEmail}&gt;
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.description}</p>
          </Card>

          {/* Attachments */}
          <Card className="p-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Attachments</p>
            <h3 className="font-display text-2xl mb-4">Files</h3>
            {attachmentsQ.isLoading && <LoadingState />}
            {attachmentsQ.data && attachmentsQ.data.attachments.length === 0 && (
              <p className="text-sm text-ink/60">No attachments on this ticket.</p>
            )}
            {attachmentsQ.data && attachmentsQ.data.attachments.length > 0 && (
              <ul className="space-y-2">
                {attachmentsQ.data.attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-4 rounded-xl border border-ink/10 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm truncate font-medium">{a.fileName}</p>
                      <p className="text-xs text-ink/60 font-mono">{a.mimeType} · {Math.round(a.sizeBytes / 1024)} KB</p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => downloadAttachment(a.id)}>Download</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <RunbookCard ticketId={t.id} />

          <CommentThread ticketId={t.id} />
        </div>

        <div className="space-y-6">
          {/* Triage breakdown */}
          <Card className="p-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Triage</p>
            <h3 className="font-display text-2xl mb-4">How we routed this</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-ink/60">Category</dt><dd className="font-medium text-right">{t.category}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink/60">Priority</dt><dd className="text-right"><Badge tone={priorityTone(t.priority)}>{t.priority}</Badge></dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink/60">Team</dt><dd className="font-medium text-right">{t.assignedTeam}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink/60">SLA target</dt><dd className="font-medium text-right">{t.slaTarget}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink/60">SLA due</dt><dd className="font-mono text-right">{new Date(t.slaDueAt).toLocaleString()}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink/60">Confidence</dt><dd className="font-mono text-right">{Math.round(t.confidence * 100)}%</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink/60">Source</dt><dd className="font-medium text-right">{t.source}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink/60">Submitted</dt><dd className="font-mono text-right">{new Date(t.createdAt).toLocaleString()}</dd></div>
              {t.resolvedAt && (
                <div className="flex justify-between gap-3"><dt className="text-ink/60">Resolved</dt><dd className="font-mono text-right">{new Date(t.resolvedAt).toLocaleString()}</dd></div>
              )}
            </dl>
          </Card>

          {/* Status controls (staff only) */}
          {isStaff && (
            <Card className="p-6">
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Workflow</p>
              <h3 className="font-display text-xl mb-4">Move this along</h3>
              <Select
                value={t.status}
                onChange={(e) => patch.mutate({ status: e.target.value as TicketStatus })}
                disabled={patch.isPending}
              >
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="RESOLVED">Resolved</option>
              </Select>
              {t.status === "RESOLVED" && (
                <p className="text-xs text-emerald-700 mt-2">Resolving sends a satisfaction-survey email.</p>
              )}
            </Card>
          )}

          {/* Auto-reply preview */}
          <Card className="p-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink/60 mb-1">Auto-reply</p>
            <h3 className="font-display text-xl mb-3">First reply we sent</h3>
            <pre className="text-xs whitespace-pre-wrap font-sans text-ink/80 bg-paper rounded-xl p-4 border border-ink/10">
              {t.autoReply}
            </pre>
          </Card>

          <Link to=".." className="block text-center text-sm text-ink/60 hover:text-ink underline underline-offset-4" relative="path">
            ← Back to all tickets
          </Link>
        </div>
      </div>
    </>
  );
}
