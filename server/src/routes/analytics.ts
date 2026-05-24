/**
 * Aggregated dashboard analytics. Returns category mix, priority mix,
 * SLA at-risk + breached counts, fleet health %, resolved count, KB
 * deflection, and CSAT (CSAT survey integration arrives in Phase 3).
 */

import { Router } from "express";
import { HealthStatus, Role, TicketStatus } from "@prisma/client";

import { prisma, basePrismaUnscoped } from "../db.js";
import { asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth, requireRole(Role.AGENT, Role.ADMIN));

analyticsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const now = new Date();
    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: { id: true, name: true, slug: true },
    });
    const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);

    const [byCategory, byPriority, openCount, atRiskCount, breachedCount, resolvedCount, devices, kbAggregate, surveyAgg, surveyCount, ratingDist] = await Promise.all([
      prisma.ticket.groupBy({ by: ["category"], _count: { _all: true } }),
      prisma.ticket.groupBy({ by: ["priority"], _count: { _all: true } }),
      prisma.ticket.count({ where: { status: { not: TicketStatus.RESOLVED } } }),
      prisma.ticket.count({
        where: {
          status: { not: TicketStatus.RESOLVED },
          slaDueAt: { gt: now, lte: fifteenMinutesFromNow },
        },
      }),
      prisma.ticket.count({
        where: {
          status: { not: TicketStatus.RESOLVED },
          slaDueAt: { lte: now },
        },
      }),
      prisma.ticket.count({ where: { status: TicketStatus.RESOLVED } }),
      prisma.device.groupBy({ by: ["healthStatus"], _count: { _all: true } }),
      prisma.kbArticle.aggregate({ _sum: { helpedCount: true } }),
      prisma.surveyResponse.aggregate({ _avg: { rating: true } }),
      prisma.surveyResponse.count({ where: { rating: { not: null } } }),
      prisma.surveyResponse.groupBy({ by: ["rating"], _count: { _all: true }, where: { rating: { not: null } } }),
    ]);

    const totalDevices = devices.reduce((s, d) => s + d._count._all, 0);
    const healthy = devices.find((d) => d.healthStatus === HealthStatus.HEALTHY)?._count._all ?? 0;
    const fleetHealthPct = totalDevices === 0 ? 100 : Math.round((healthy / totalDevices) * 1000) / 10;

    res.json({
      organization: org,
      open: openCount,
      resolved: resolvedCount,
      slaAtRisk: atRiskCount,
      slaBreached: breachedCount,
      fleetHealthPct,
      kbDeflection: kbAggregate._sum.helpedCount ?? 0,
      byCategory: byCategory.map((b) => ({ category: b.category, count: b._count._all })),
      byPriority: byPriority.map((b) => ({ priority: b.priority, count: b._count._all })),
      fleet: devices.map((d) => ({ status: d.healthStatus, count: d._count._all })),
      csat: {
        average: surveyAgg._avg.rating ?? 0,
        responses: surveyCount,
        distribution: ratingDist.map((r) => ({ rating: r.rating, count: r._count._all })),
      },
    });
  }),
);
