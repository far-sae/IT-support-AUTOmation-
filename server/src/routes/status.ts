/**
 * Public status page data — per tenant.
 * URL pattern: GET /api/status/:orgSlug
 * No authentication required. Resolves the org by slug, then runs the
 * queries inside the org's tenant context so the Prisma extension scopes
 * everything correctly.
 */

import { Router } from "express";
import { ComponentStatus, IncidentStatus } from "@prisma/client";

import { prisma, basePrismaUnscoped } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import { AppError, asyncHandler } from "../errors.js";

export const statusRouter = Router();

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

interface UptimeBucket {
  componentId: string;
  totalDowntimeMs: number;
}

async function computeUptime(componentIds: string[]): Promise<Map<string, number>> {
  const since = new Date(Date.now() - NINETY_DAYS_MS);
  const incidents = await prisma.incident.findMany({
    where: {
      componentId: { in: componentIds },
      OR: [
        { resolvedAt: null },
        { resolvedAt: { gte: since } },
      ],
      impact: { not: "MINOR" },
    },
  });

  const buckets = new Map<string, UptimeBucket>();
  const now = Date.now();
  for (const id of componentIds) buckets.set(id, { componentId: id, totalDowntimeMs: 0 });

  for (const inc of incidents) {
    const start = Math.max(inc.startedAt.getTime(), now - NINETY_DAYS_MS);
    const end = (inc.resolvedAt ?? new Date()).getTime();
    if (end <= start) continue;
    const bucket = buckets.get(inc.componentId);
    if (bucket) bucket.totalDowntimeMs += end - start;
  }

  const result = new Map<string, number>();
  for (const [id, bucket] of buckets) {
    const pct = Math.max(0, 100 - (bucket.totalDowntimeMs / NINETY_DAYS_MS) * 100);
    result.set(id, Math.round(pct * 1000) / 1000);
  }
  return result;
}

statusRouter.get(
  "/:orgSlug",
  asyncHandler(async (req, res) => {
    const slug = req.params.orgSlug;
    if (!slug) throw new AppError(400, "Missing org slug", "BAD_REQUEST");

    const org = await basePrismaUnscoped.organization.findUnique({ where: { slug } });
    if (!org) throw new AppError(404, "Organization not found", "NOT_FOUND");
    if (org.suspendedAt) throw new AppError(404, "Organization not available", "NOT_FOUND");

    const payload = await runWithTenant(org.id, async () => {
      const components = await prisma.serviceComponent.findMany({ orderBy: { name: "asc" } });
      const uptime = await computeUptime(components.map((c) => c.id));

      const activeIncidents = await prisma.incident.findMany({
        where: { status: { not: IncidentStatus.RESOLVED } },
        orderBy: { startedAt: "desc" },
        include: { component: { select: { id: true, name: true } } },
      });

      const recentHistory = await prisma.incident.findMany({
        where: { status: IncidentStatus.RESOLVED, resolvedAt: { gte: new Date(Date.now() - NINETY_DAYS_MS) } },
        orderBy: { resolvedAt: "desc" },
        take: 20,
        include: { component: { select: { id: true, name: true } } },
      });

      return {
        organization: { id: org.id, name: org.name, slug: org.slug },
        components: components.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status as ComponentStatus,
          uptime90d: uptime.get(c.id) ?? 100,
        })),
        activeIncidents,
        recentHistory,
      };
    });

    res.json(payload);
  }),
);
