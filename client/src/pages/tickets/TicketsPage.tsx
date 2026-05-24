import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { ticketsApi } from "../../api/endpoints.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { Header } from "../../components/Header.js";
import { Card } from "../../components/ui/Card.js";
import { Badge, priorityTone, statusTone } from "../../components/ui/Badge.js";
import { ErrorState, LoadingState, EmptyState } from "../../components/ui/EmptyState.js";
import { Select } from "../../components/ui/Field.js";
import { NewTicketPanel } from "./NewTicketPanel.js";
import type { Ticket, TicketStatus } from "../../types.js";

const STATUSES: Array<TicketStatus | "ALL"> = ["ALL", "OPEN", "IN_PROGRESS", "RESOLVED"];

export default function TicketsPage() {
  const { user } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => ticketsApi.list(),
  });

  const [statusFilter, setStatusFilter] = useState<TicketStatus | "ALL">("ALL");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const tickets = data?.tickets ?? [];
    const needle = q.trim().toLowerCase();
    return tickets.filter((t) => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (priorityFilter !== "ALL" && t.priority !== priorityFilter) return false;
      if (needle) {
        const blob = `${t.refCode} ${t.description} ${t.submitterName} ${t.submitterEmail} ${t.category}`.toLowerCase();
        if (!blob.includes(needle)) return false;
      }
      return true;
    });
  }, [data, statusFilter, priorityFilter, q]);

  const isStaff = user?.role === "AGENT" || user?.role === "ADMIN";

  return (
    <>
      <Header
        title={isStaff ? "All tickets" : "My tickets"}
        subtitle={isStaff ? "Triage queue, scoped by your role." : "Tickets you've submitted."}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8">
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TicketStatus | "ALL")} className="max-w-[180px]">
              {STATUSES.map(s => <option key={s} value={s}>{s === "ALL" ? "All statuses" : s.replace("_", " ")}</option>)}
            </Select>
            <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="max-w-[180px]">
              <option value="ALL">All priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </Select>
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search ref, description, submitter…"
              className="flex-1 min-w-[200px] rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
          </div>

          {isLoading && <LoadingState />}
          {error && <ErrorState message={(error as Error).message} />}

          {data && filtered.length === 0 && (
            <EmptyState
              title={data.tickets.length === 0 ? "No tickets yet" : "Nothing matches those filters"}
              description={data.tickets.length === 0 ? "Submit one with the form on the right and the triage will run instantly." : "Try widening the filters."}
            />
          )}

          {filtered.length > 0 && (
            <Card>
              <ul className="divide-y divide-ink/10">
                {filtered.map((t) => <TicketRow key={t.id} ticket={t} />)}
              </ul>
            </Card>
          )}
        </div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <NewTicketPanel />
        </div>
      </div>
    </>
  );
}

function TicketRow({ ticket }: { ticket: Ticket }) {
  const isOverdue = ticket.status !== "RESOLVED" && new Date(ticket.slaDueAt).getTime() < Date.now();
  return (
    <li>
      <Link to={`${ticket.id}`} className="block px-6 py-4 hover:bg-ink/5">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-ink/60">{ticket.refCode}</span>
              <Badge tone={statusTone(ticket.status)}>{ticket.status.replace("_", " ")}</Badge>
              <Badge tone={priorityTone(ticket.priority)}>{ticket.priority}</Badge>
              {isOverdue && <Badge tone="danger">SLA breached</Badge>}
            </div>
            <p className="line-clamp-2 text-sm">{ticket.description}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-ink/60">
              <span>{ticket.category}</span>
              <span>·</span>
              <span>{ticket.assignedTeam}</span>
              <span>·</span>
              <span>{ticket.submitterName}</span>
              {ticket._count && (
                <>
                  <span>·</span>
                  <span>{ticket._count.comments} comments</span>
                  <span>·</span>
                  <span>{ticket._count.attachments} attachments</span>
                </>
              )}
            </div>
          </div>
          <span className="font-mono text-xs text-ink/50 shrink-0">{new Date(ticket.createdAt).toLocaleString()}</span>
        </div>
      </Link>
    </li>
  );
}
