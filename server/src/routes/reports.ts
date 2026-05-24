/**
 * Admin-only ticket + CSAT reports as CSV and PDF.
 * Optional ?from= and ?to= ISO-date query params bound the time window.
 */

import { Router } from "express";
import { Role, TicketStatus } from "@prisma/client";

import { prisma } from "../db.js";
import { asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { toCsv } from "../reports/csv.js";
import { streamPdfReport } from "../reports/pdf.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireRole(Role.ADMIN));

function parseRange(q: { from?: unknown; to?: unknown }): { from: Date | null; to: Date | null } {
  const parse = (v: unknown): Date | null => {
    if (typeof v !== "string" || !v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return { from: parse(q.from), to: parse(q.to) };
}

function rangeWhere(range: { from: Date | null; to: Date | null }) {
  if (!range.from && !range.to) return {};
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (range.from) createdAt.gte = range.from;
  if (range.to) createdAt.lte = range.to;
  return { createdAt };
}

interface TicketReportRow {
  refCode: string;
  category: string;
  priority: string;
  status: string;
  assignedTeam: string;
  assignedAgent: string;
  createdAt: Date;
  resolvedAt: Date | null;
  slaMet: string;
}

async function loadTicketRows(range: { from: Date | null; to: Date | null }): Promise<TicketReportRow[]> {
  const tickets = await prisma.ticket.findMany({
    where: rangeWhere(range),
    orderBy: { createdAt: "desc" },
    include: { assignedAgent: { select: { name: true } } },
  });
  return tickets.map((t) => ({
    refCode: t.refCode,
    category: t.category,
    priority: t.priority,
    status: t.status,
    assignedTeam: t.assignedTeam,
    assignedAgent: t.assignedAgent?.name ?? "—",
    createdAt: t.createdAt,
    resolvedAt: t.resolvedAt,
    slaMet: t.resolvedAt
      ? t.resolvedAt.getTime() <= t.slaDueAt.getTime() ? "Yes" : "No"
      : t.slaDueAt.getTime() < Date.now() ? "Breached" : "On track",
  }));
}

// ─── Tickets — CSV ────────────────────────────────────────────────────

reportsRouter.get(
  "/tickets.csv",
  asyncHandler(async (req, res) => {
    const range = parseRange(req.query);
    const rows = await loadTicketRows(range);
    const csv = toCsv(rows, [
      { key: "refCode", label: "Ref" },
      { key: "category", label: "Category" },
      { key: "priority", label: "Priority" },
      { key: "status", label: "Status" },
      { key: "assignedTeam", label: "Team" },
      { key: "assignedAgent", label: "Agent" },
      { key: "createdAt", label: "Created" },
      { key: "resolvedAt", label: "Resolved" },
      { key: "slaMet", label: "SLA" },
    ]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="relay-tickets-${Date.now()}.csv"`);
    res.send(csv);
  }),
);

// ─── Tickets — PDF ────────────────────────────────────────────────────

reportsRouter.get(
  "/tickets.pdf",
  asyncHandler(async (req, res) => {
    const range = parseRange(req.query);
    const rows = await loadTicketRows(range);
    const open = rows.filter((r) => r.status !== TicketStatus.RESOLVED).length;
    const resolved = rows.length - open;
    const breached = rows.filter((r) => r.slaMet === "Breached" || r.slaMet === "No").length;

    res.setHeader("Content-Disposition", `attachment; filename="relay-tickets-${Date.now()}.pdf"`);
    streamPdfReport(res, {
      title: "Ticket report",
      subtitle: "Ticket activity across the selected window.",
      range,
      summary: [
        { label: "Total", value: String(rows.length) },
        { label: "Open", value: String(open) },
        { label: "Resolved", value: String(resolved) },
        { label: "SLA breached", value: String(breached) },
      ],
      columns: [
        { label: "Ref", width: 60 },
        { label: "Category", width: 80 },
        { label: "Priority", width: 60 },
        { label: "Status", width: 70 },
        { label: "Team", width: 110 },
        { label: "Created", width: 75 },
        { label: "SLA", width: 50 },
      ],
      rows: rows.map((r) => [
        r.refCode, r.category, r.priority, r.status, r.assignedTeam,
        r.createdAt.toISOString().slice(0, 10), r.slaMet,
      ]),
    });
  }),
);

// ─── CSAT ─────────────────────────────────────────────────────────────

interface CsatReportRow {
  refCode: string;
  rating: number | null;
  comment: string | null;
  submittedAt: Date | null;
}

async function loadCsatRows(range: { from: Date | null; to: Date | null }) {
  const where: { submittedAt?: { gte?: Date; lte?: Date; not?: null } } = {
    submittedAt: { not: null },
  };
  if (range.from || range.to) {
    if (range.from) where.submittedAt!.gte = range.from;
    if (range.to) where.submittedAt!.lte = range.to;
  }
  const surveys = await prisma.surveyResponse.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    include: { ticket: { select: { refCode: true } } },
  });
  return surveys.map<CsatReportRow>((s) => ({
    refCode: s.ticket.refCode,
    rating: s.rating,
    comment: s.comment,
    submittedAt: s.submittedAt,
  }));
}

reportsRouter.get(
  "/csat.csv",
  asyncHandler(async (req, res) => {
    const range = parseRange(req.query);
    const rows = await loadCsatRows(range);
    const csv = toCsv(rows, [
      { key: "refCode", label: "Ref" },
      { key: "rating", label: "Rating" },
      { key: "comment", label: "Comment" },
      { key: "submittedAt", label: "Submitted" },
    ]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="relay-csat-${Date.now()}.csv"`);
    res.send(csv);
  }),
);

reportsRouter.get(
  "/csat.pdf",
  asyncHandler(async (req, res) => {
    const range = parseRange(req.query);
    const rows = await loadCsatRows(range);
    const ratings = rows.filter((r): r is CsatReportRow & { rating: number } => r.rating !== null);
    const avg = ratings.length === 0 ? 0 : ratings.reduce((s, r) => s + r.rating, 0) / ratings.length;
    const dist = [1, 2, 3, 4, 5].map((n) => ({
      n,
      count: ratings.filter((r) => r.rating === n).length,
    }));

    res.setHeader("Content-Disposition", `attachment; filename="relay-csat-${Date.now()}.pdf"`);
    streamPdfReport(res, {
      title: "CSAT report",
      subtitle: "Customer satisfaction responses from resolved tickets.",
      range,
      summary: [
        { label: "Responses", value: String(ratings.length) },
        { label: "Average", value: avg.toFixed(2) },
        { label: "5★", value: String(dist[4]?.count ?? 0) },
        { label: "1★", value: String(dist[0]?.count ?? 0) },
      ],
      columns: [
        { label: "Ref", width: 70 },
        { label: "Rating", width: 50 },
        { label: "Submitted", width: 90 },
        { label: "Comment", width: 290 },
      ],
      rows: rows.map((r) => [
        r.refCode,
        r.rating === null ? "—" : `${r.rating}/5`,
        r.submittedAt ? r.submittedAt.toISOString().slice(0, 10) : "—",
        r.comment ?? "",
      ]),
    });
  }),
);
