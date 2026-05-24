/**
 * Platform-admin routes. Mounted at /api/platform; gated by isPlatformAdmin.
 * The middleware switches the ALS context into platformMode so Prisma
 * queries can span tenants.
 */

import { Router } from "express";
import { z } from "zod";

import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requirePlatformAdmin } from "../auth/middleware.js";

export const platformRouter = Router();
platformRouter.use(requireAuth, requirePlatformAdmin);

function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── List orgs ────────────────────────────────────────────────────────

platformRouter.get(
  "/organizations",
  asyncHandler(async (_req, res) => {
    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { users: true, tickets: true, devices: true } },
      },
    });
    res.json({ organizations: orgs });
  }),
);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(60).optional(),
});

platformRouter.post(
  "/organizations",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const slug = normalizeSlug(body.slug ?? body.name) || "org";
    const exists = await prisma.organization.findUnique({ where: { slug } });
    if (exists) throw new AppError(409, "Slug already taken", "SLUG_TAKEN");
    const org = await prisma.organization.create({ data: { name: body.name, slug } });
    res.status(201).json({ organization: org });
  }),
);

const suspendSchema = z.object({ suspended: z.boolean() });

platformRouter.patch(
  "/organizations/:id/suspend",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const body = suspendSchema.parse(req.body);
    const org = await prisma.organization.update({
      where: { id },
      data: { suspendedAt: body.suspended ? new Date() : null },
    });
    res.json({ organization: org });
  }),
);

platformRouter.delete(
  "/organizations/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    await prisma.organization.delete({ where: { id } });
    res.status(204).end();
  }),
);

// ─── Cross-org aggregate analytics ────────────────────────────────────

platformRouter.get(
  "/analytics",
  asyncHandler(async (_req, res) => {
    const [orgs, userCount, ticketCount, deviceCount] = await Promise.all([
      prisma.organization.count(),
      prisma.user.count(),
      prisma.ticket.count(),
      prisma.device.count(),
    ]);
    res.json({ orgs, users: userCount, tickets: ticketCount, devices: deviceCount });
  }),
);
