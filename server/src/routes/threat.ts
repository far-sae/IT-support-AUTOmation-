/**
 * Phase 25 — Threat-intel API.
 *
 *   GET  /api/threat/intel                 — recent intel (any tenant — it's global)
 *   GET  /api/threat/matches               — this org's open matches
 *   POST /api/threat/matches/:id/ack       — acknowledge a match
 *   POST /api/threat/matches/:id/ticket    — convert a match into a ticket
 *   POST /api/threat/matches/:id/dismiss   — mark false-positive
 *   POST /api/threat/ingest                — ADMIN: force-poll now
 */

import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { basePrismaUnscoped, prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ingestAll } from "../threat/engine.js";

export const threatRouter = Router();
threatRouter.use(requireAuth);

threatRouter.get(
  "/intel",
  asyncHandler(async (req, res) => {
    const kind = typeof req.query.kind === "string" ? req.query.kind.toUpperCase() : undefined;
    const intel = await basePrismaUnscoped.threatIntel.findMany({
      where: kind ? { kind: kind as never } : {},
      orderBy: { publishedAt: "desc" },
      take: 100,
    });
    res.json({ intel });
  }),
);

threatRouter.get(
  "/matches",
  asyncHandler(async (req, res) => {
    const include = String(req.query.include ?? "open");
    const matches = await prisma.threatMatch.findMany({
      where: include === "all" ? {} : { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { threatIntel: true },
    });
    res.json({ matches });
  }),
);

threatRouter.post(
  "/matches/:id/ack",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const m = await prisma.threatMatch.findUnique({ where: { id } });
    if (!m) throw new AppError(404, "Match not found", "NOT_FOUND");
    const updated = await prisma.threatMatch.update({
      where: { id },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedBy: me.id },
    });
    res.json({ match: updated });
  }),
);

threatRouter.post(
  "/matches/:id/dismiss",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const m = await prisma.threatMatch.findUnique({ where: { id } });
    if (!m) throw new AppError(404, "Match not found", "NOT_FOUND");
    const updated = await prisma.threatMatch.update({
      where: { id },
      data: { status: "DISMISSED", acknowledgedAt: new Date(), acknowledgedBy: me.id },
    });
    res.json({ match: updated });
  }),
);

threatRouter.post(
  "/matches/:id/ticket",
  requireRole(Role.AGENT, Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const parsed = z.object({
      priority: z.enum(["Critical", "High", "Medium", "Low"]).default("High"),
    }).safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Invalid body", "VALIDATION");

    const m = await prisma.threatMatch.findUnique({
      where: { id }, include: { threatIntel: true },
    });
    if (!m) throw new AppError(404, "Match not found", "NOT_FOUND");
    if (m.resultingTicketId) throw new AppError(409, "Ticket already created for this match", "CONFLICT");

    const evidenceText = JSON.stringify(m.evidence, null, 2);
    const description = `Threat-intel match (${m.threatIntel.kind} / ${m.threatIntel.severity})\n\n` +
      `${m.threatIntel.title}\n\n` +
      `${m.threatIntel.description}\n\n` +
      `Reason: ${m.reason}\n\nEvidence:\n${evidenceText.slice(0, 1000)}`;
    // Generate refCode using the same scheme other routes use (delegated
    // to Prisma defaults + our seed counter).
    const ticket = await prisma.ticket.create({
      data: {
        organizationId: me.organizationId,
        refCode: `INC-${Date.now().toString().slice(-7)}`,
        description: description.slice(0, 4000),
        source: "PORTAL",
        submitterName: me.name ?? "Threat intelligence",
        submitterEmail: me.email ?? "threat-intel@relay",
        submitterUserId: me.id,
        category: "Security",
        priority: parsed.data.priority,
        assignedTeam: "Security",
        slaTarget: "1 business day",
        slaDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        confidence: 1.0,
        status: "OPEN",
        autoReply: "",
      },
    });
    const updated = await prisma.threatMatch.update({
      where: { id },
      data: { status: "CONVERTED_TO_TICKET", resultingTicketId: ticket.id },
    });
    res.status(201).json({ ticket, match: updated });
  }),
);

threatRouter.post(
  "/ingest",
  requireRole(Role.ADMIN),
  asyncHandler(async (_req, res) => {
    const results = await ingestAll();
    res.json({ ok: true, results });
  }),
);
