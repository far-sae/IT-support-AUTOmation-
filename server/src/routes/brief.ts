/**
 * Phase 11 — Daily brief endpoints.
 *
 *   GET  /api/brief/latest   — most recent brief for the caller's org (dashboard widget)
 *   GET  /api/brief          — paginated history
 *   POST /api/brief/generate — ADMIN: force-regenerate today's brief on demand
 */

import { Router } from "express";
import { Role } from "@prisma/client";
import { basePrismaUnscoped } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { generateBriefForOrg } from "../jobs/dailyBrief.js";

export const briefRouter = Router();
briefRouter.use(requireAuth);

briefRouter.get(
  "/latest",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const brief = await basePrismaUnscoped.dailyBrief.findFirst({
      where: { organizationId: me.organizationId },
      orderBy: { forDate: "desc" },
    });
    res.json({ brief });
  }),
);

briefRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const briefs = await basePrismaUnscoped.dailyBrief.findMany({
      where: { organizationId: me.organizationId },
      orderBy: { forDate: "desc" },
      take: 30,
    });
    res.json({ briefs });
  }),
);

briefRouter.post(
  "/generate",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: me.organizationId }, select: { name: true },
    });
    if (!org) throw new AppError(404, "Org not found", "NOT_FOUND");
    const r = await generateBriefForOrg({
      organizationId: me.organizationId, orgName: org.name, forceRegenerate: true,
    });
    res.json({ generated: r !== null, brief: r });
  }),
);
