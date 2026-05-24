/**
 * Current-organization settings (in-tenant ADMIN scope).
 *   GET    /api/organization        — fetch the caller's org
 *   PATCH  /api/organization        — rename, edit settings (ADMIN)
 */

import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";

import { basePrismaUnscoped } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { parseOrgSettings } from "../tenant/settings.js";

export const organizationRouter = Router();
organizationRouter.use(requireAuth);

organizationRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: me.organizationId },
    });
    if (!org) throw new AppError(404, "Organization not found", "NOT_FOUND");
    res.json({
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        settings: parseOrgSettings(org.settings),
        createdAt: org.createdAt,
        suspendedAt: org.suspendedAt,
      },
    });
  }),
);

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  settings: z
    .object({
      branding: z.object({
        primaryColor: z.string().regex(/^#?[0-9a-fA-F]{3,8}$/).optional(),
        logoUrl: z.string().url().optional(),
      }).optional(),
      slaOverrides: z.object({
        Critical: z.string().optional(),
        High: z.string().optional(),
        Medium: z.string().optional(),
        Low: z.string().optional(),
      }).optional(),
      allowedDomains: z.array(z.string().min(1)).optional(),
      // Phase 10A — list of runbook keys disabled for this org.
      disabledRunbooks: z.array(z.string().min(1)).optional(),
      // Phase 10B — autopilot controls.
      autonomy: z.enum(["FULL_AUTO", "REVIEW_MEDIUM_HIGH", "HUMAN_IN_LOOP"]).optional(),
      verificationMinutes: z.number().int().min(1).max(10080).optional(), // up to 7 days
      // Phase 11 — closed-loop.
      disabledPolicies: z.array(z.string().min(1)).optional(),
      slackWebhookUrl: z.string().url().or(z.literal("")).optional(),
      briefSchedule: z.string().min(5).max(60).optional(),
      githubRepo: z.string().regex(/^[^/\s]+\/[^/\s]+$/).or(z.literal("")).optional(),
      businessHours: z.object({
        tz: z.string().min(1).max(60).optional(),
        daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
        startHour: z.number().int().min(0).max(23).optional(),
        endHour: z.number().int().min(0).max(24).optional(),
      }).optional(),
    })
    .optional(),
});

organizationRouter.patch(
  "/",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const body = patchSchema.parse(req.body);

    const updated = await basePrismaUnscoped.organization.update({
      where: { id: me.organizationId },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.settings ? { settings: body.settings } : {}),
      },
    });
    res.json({
      organization: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        settings: parseOrgSettings(updated.settings),
        createdAt: updated.createdAt,
        suspendedAt: updated.suspendedAt,
      },
    });
  }),
);
