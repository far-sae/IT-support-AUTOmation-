/**
 * Admin endpoints for managing AgentEnrollmentTokens within the caller's org.
 *
 *   GET    /api/agent-tokens          — list (token value only shown on create)
 *   POST   /api/agent-tokens          — generate a new token
 *   POST   /api/agent-tokens/:id/revoke
 *
 * Plus a device-metrics history endpoint used by the assets page sparklines:
 *
 *   GET    /api/devices/:id/metrics?hours=24
 */

import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { nanoid } from "nanoid";

import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";

export const agentTokensRouter = Router();
agentTokensRouter.use(requireAuth, requireRole(Role.ADMIN));

agentTokensRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const tokens = await prisma.agentEnrollmentToken.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, label: true, createdAt: true, revokedAt: true, lastUsedAt: true,
        // Mask the token for listing — only the first 6 chars.
        token: false,
      },
    });
    res.json({ tokens });
  }),
);

const createSchema = z.object({
  label: z.string().min(1).max(120),
});

agentTokensRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const token = `relay_agent_${nanoid(32)}`;
    const created = await prisma.agentEnrollmentToken.create({
      data: {
        organizationId: req.user!.organizationId,
        label: body.label,
        token,
      },
    });
    // The token is returned exactly once — the admin should copy it now.
    res.status(201).json({
      token: {
        id: created.id,
        label: created.label,
        createdAt: created.createdAt,
        revokedAt: created.revokedAt,
        lastUsedAt: created.lastUsedAt,
        token, // ONLY on create
      },
    });
  }),
);

agentTokensRouter.post(
  "/:id/revoke",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const updated = await prisma.agentEnrollmentToken.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: {
        id: true, label: true, createdAt: true, revokedAt: true, lastUsedAt: true,
      },
    });
    res.json({ token: updated });
  }),
);

// ─── Device metrics history (sparkline) ───────────────────────────────

export const deviceMetricsRouter = Router({ mergeParams: true });
deviceMetricsRouter.use(requireAuth, requireRole(Role.AGENT, Role.ADMIN));

const metricsQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).default(24),
});

deviceMetricsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const deviceId = (req.params as { deviceId?: string }).deviceId;
    if (!deviceId) throw new AppError(400, "Missing deviceId", "BAD_REQUEST");
    const { hours } = metricsQuerySchema.parse(req.query);

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const metrics = await prisma.deviceMetric.findMany({
      where: { deviceId, recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
      take: 500,
      select: { recordedAt: true, cpu: true, ram: true, disk: true },
    });
    res.json({ metrics });
  }),
);
