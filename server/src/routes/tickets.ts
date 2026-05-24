import { Router } from "express";
import { z } from "zod";
import { Role, TicketSource, TicketStatus } from "@prisma/client";

import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { computeSlaDueAt, generateAutoReply, triage, type Priority } from "../triage.js";
import { nextRefCode } from "../ref.js";
import { emit } from "../realtime/socket.js";
import { sendMail } from "../email/mailer.js";
import { autoReplyEmail } from "../email/templates.js";
import { createSurveyForTicket } from "../survey/survey.js";
import { decideAndExecute } from "../brain/index.js";
import { runWithTenant } from "../tenant/context.js";
import { commentsRouter } from "./comments.js";
import { ticketAttachmentsRouter } from "./attachments.js";

export const ticketsRouter = Router();
ticketsRouter.use(requireAuth);

ticketsRouter.use("/:ticketId/comments", commentsRouter);
ticketsRouter.use("/:ticketId/attachments", ticketAttachmentsRouter);

// ─── List ─────────────────────────────────────────────────────────────

ticketsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const where =
      me.role === Role.EMPLOYEE
        ? { OR: [{ submitterUserId: me.id }, { submitterEmail: me.email }] }
        : {};
    const tickets = await prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        assignedAgent: { select: { id: true, name: true, email: true } },
        _count: { select: { comments: true, attachments: true } },
      },
    });
    res.json({ tickets });
  }),
);

// ─── Create ───────────────────────────────────────────────────────────

const createSchema = z.object({
  description: z.string().min(5).max(5000),
});

ticketsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const me = req.user!;

    const result = triage(body.description);
    const refCode = await nextRefCode();
    const createdAt = new Date();
    const slaDueAt = computeSlaDueAt(result.priority as Priority, createdAt);
    const autoReply = generateAutoReply({
      submitterName: me.name,
      refCode,
      category: result.category,
      priority: result.priority,
      assignedTeam: result.assignedTeam,
      slaTarget: result.slaTarget,
    });

    const ticket = await prisma.ticket.create({
      data: {
        organizationId: me.organizationId,
        refCode,
        description: body.description,
        source: TicketSource.PORTAL,
        submitterName: me.name,
        submitterEmail: me.email,
        submitterUserId: me.id,
        category: result.category,
        priority: result.priority,
        assignedTeam: result.assignedTeam,
        slaTarget: result.slaTarget,
        slaDueAt,
        confidence: result.confidence,
        autoReply,
      },
    });

    // Best-effort outbound auto-reply.
    try {
      const built = autoReplyEmail({
        submitterName: me.name,
        refCode,
        category: result.category,
        priority: result.priority,
        assignedTeam: result.assignedTeam,
        slaTarget: result.slaTarget,
        autoReplyText: autoReply,
      });
      await sendMail({ to: me.email, ...built });
    } catch (err) {
      console.error("[tickets] failed to send auto-reply:", err);
    }

    emit("ticket:created", {
      ticketId: ticket.id,
      refCode: ticket.refCode,
      status: ticket.status,
      priority: ticket.priority,
    });
    emit("analytics:updated", { reason: "ticket-created" });

    // Phase 11 — Prometheus.
    try {
      const { ticketsCreatedTotal } = await import("../observability/metrics.js");
      ticketsCreatedTotal.inc({ org: me.organizationSlug, category: ticket.category, priority: ticket.priority });
    } catch { /* metrics best-effort */ }

    // Phase 12 — event bus (drives ES indexing, Kafka mirror, detection sinks).
    try {
      const { bus } = await import("../events/bus.js");
      bus.emit({
        kind: "ticket.created",
        organizationId: me.organizationId,
        ticketId: ticket.id,
        refCode: ticket.refCode,
        priority: ticket.priority,
        category: ticket.category,
      });
    } catch { /* bus best-effort */ }

    // Fire-and-forget autopilot brain. Re-enters the same tenant ALS
    // context so the Prisma extension keeps filtering for us.
    const orgId = me.organizationId;
    void runWithTenant(orgId, async () => {
      try { await decideAndExecute(ticket, result); }
      catch (err) { console.error("[autopilot] inline failed:", err); }
    });

    res.status(201).json({ ticket });
  }),
);

// ─── Helper to fetch ticket scoped by role ───────────────────────────

async function fetchTicketForUser(ticketId: string, me: Express.User) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      assignedAgent: { select: { id: true, name: true, email: true } },
      submitter: { select: { id: true, name: true, email: true } },
      attachments: true,
    },
  });
  if (!ticket) throw new AppError(404, "Ticket not found", "NOT_FOUND");
  if (me.role === Role.EMPLOYEE) {
    const isMine = ticket.submitterUserId === me.id || ticket.submitterEmail === me.email;
    if (!isMine) throw new AppError(403, "You can't view that ticket", "FORBIDDEN");
  }
  return ticket;
}

// ─── Get one ──────────────────────────────────────────────────────────

ticketsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const ticket = await fetchTicketForUser(id, req.user!);
    res.json({ ticket });
  }),
);

// ─── Patch (status / assigned agent) ──────────────────────────────────

const patchSchema = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  assignedAgentId: z.string().nullable().optional(),
});

ticketsRouter.patch(
  "/:id",
  requireRole(Role.AGENT, Role.ADMIN),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const body = patchSchema.parse(req.body);

    const existing = await prisma.ticket.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "Ticket not found", "NOT_FOUND");

    const data: { status?: TicketStatus; assignedAgentId?: string | null; resolvedAt?: Date | null } = {};
    if (body.status) {
      data.status = body.status;
      if (body.status === TicketStatus.RESOLVED && !existing.resolvedAt) {
        data.resolvedAt = new Date();
      } else if (body.status !== TicketStatus.RESOLVED && existing.resolvedAt) {
        data.resolvedAt = null;
      }
    }
    if (body.assignedAgentId !== undefined) {
      data.assignedAgentId = body.assignedAgentId;
    }

    const ticket = await prisma.ticket.update({
      where: { id },
      data,
      include: {
        assignedAgent: { select: { id: true, name: true, email: true } },
        submitter: { select: { id: true, name: true, email: true } },
      },
    });

    // Transitioning to RESOLVED → fire the satisfaction survey.
    const justResolved =
      body.status === TicketStatus.RESOLVED && existing.status !== TicketStatus.RESOLVED;
    if (justResolved) {
      try {
        await createSurveyForTicket(ticket.id);
      } catch (err) {
        console.error("[tickets] failed to create survey:", err);
      }
    }

    emit("ticket:updated", {
      ticketId: ticket.id,
      refCode: ticket.refCode,
      status: ticket.status,
    });
    emit("analytics:updated", { reason: "ticket-updated" });

    res.json({ ticket });
  }),
);
