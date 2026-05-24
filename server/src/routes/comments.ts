import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";

import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { emit } from "../realtime/socket.js";
import { sendMail } from "../email/mailer.js";
import { commentNotifyEmail } from "../email/templates.js";
import { classifySubmitterReply, settleVerifications, decideAndExecute } from "../brain/index.js";
import { triage } from "../triage.js";

// Mounted under /api/tickets/:ticketId/comments  (mergeParams = true)
export const commentsRouter = Router({ mergeParams: true });

async function loadTicketScoped(ticketId: string, me: Express.User) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AppError(404, "Ticket not found", "NOT_FOUND");
  if (me.role === Role.EMPLOYEE) {
    const isMine = ticket.submitterUserId === me.id || ticket.submitterEmail === me.email;
    if (!isMine) throw new AppError(403, "You can't view that ticket", "FORBIDDEN");
  }
  return ticket;
}

// ─── List ─────────────────────────────────────────────────────────────

commentsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const ticketId = (req.params as { ticketId?: string }).ticketId;
    if (!ticketId) throw new AppError(400, "Missing ticketId", "BAD_REQUEST");
    await loadTicketScoped(ticketId, me);

    const where = me.role === Role.EMPLOYEE
      ? { ticketId, isInternal: false }
      : { ticketId };

    const comments = await prisma.comment.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, name: true, email: true, role: true } } },
    });
    res.json({ comments });
  }),
);

// ─── Add ──────────────────────────────────────────────────────────────

const addSchema = z.object({
  body: z.string().min(1).max(5000),
  isInternal: z.boolean().optional().default(false),
});

commentsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const ticketId = (req.params as { ticketId?: string }).ticketId;
    if (!ticketId) throw new AppError(400, "Missing ticketId", "BAD_REQUEST");
    await loadTicketScoped(ticketId, me);

    const body = addSchema.parse(req.body);
    const isInternal = me.role === Role.EMPLOYEE ? false : body.isInternal;

    const comment = await prisma.comment.create({
      data: {
        organizationId: me.organizationId,
        ticketId,
        authorId: me.id,
        body: body.body,
        isInternal,
      },
      include: { author: { select: { id: true, name: true, email: true, role: true } } },
    });

    const ticket = await prisma.ticket.update({
      where: { id: ticketId },
      data: { updatedAt: new Date() },
      select: {
        id: true, refCode: true, status: true,
        submitterEmail: true, submitterName: true,
        assignedAgent: { select: { email: true, name: true } },
      },
    });

    // Public comments → notify the other party best-effort.
    if (!isInternal) {
      const recipient =
        me.role === Role.EMPLOYEE
          ? ticket.assignedAgent
            ? { email: ticket.assignedAgent.email, name: ticket.assignedAgent.name }
            : null
          : { email: ticket.submitterEmail, name: ticket.submitterName };

      if (recipient && recipient.email !== me.email) {
        try {
          const built = commentNotifyEmail({
            recipientName: recipient.name,
            refCode: ticket.refCode,
            authorName: me.name,
            body: body.body,
          });
          await sendMail({ to: recipient.email, ...built });
        } catch (err) {
          console.error("[comments] failed to send notify email:", err);
        }
      }
    }

    emit("ticket:updated", {
      ticketId: ticket.id,
      refCode: ticket.refCode,
      status: ticket.status,
    });

    // ─── Autopilot reply detection (Phase 10B) ────────────────────
    // If the submitter just posted a public reply on a ticket whose runbook
    // is in AWAITING_VERIFICATION, classify the message:
    //   • positive → settle the execution as SUCCEEDED, close the ticket
    //   • negative → mark FAILED + re-trigger the brain with that history
    if (!isInternal && me.role === Role.EMPLOYEE) {
      const signal = classifySubmitterReply(body.body);
      if (signal !== "neutral") {
        void (async () => {
          try {
            await settleVerifications({ ticketId, userSignal: signal });
            if (signal === "negative") {
              const t = await prisma.ticket.findUnique({ where: { id: ticketId } });
              if (t) await decideAndExecute(t, triage(t.description));
            }
          } catch (err) {
            console.error("[autopilot] reply-driven settle failed:", err);
          }
        })();
      }
    }

    res.status(201).json({ comment });
  }),
);
