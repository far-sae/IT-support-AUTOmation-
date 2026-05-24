/**
 * Phase 11 — Policy catalog + per-org enable/disable.
 *
 *   GET   /api/policies                  — list policies + disabled flag for caller's org
 *   PATCH /api/policies/:key             — ADMIN: toggle disabled
 */

import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { basePrismaUnscoped } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { POLICIES, publicPolicyCatalog } from "../policies/registry.js";
import { parseOrgSettings } from "../tenant/settings.js";

export const policiesRouter = Router();
policiesRouter.use(requireAuth);

policiesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: me.organizationId }, select: { settings: true },
    });
    const disabled = new Set<string>(parseOrgSettings(org?.settings).disabledPolicies ?? []);
    res.json({
      policies: publicPolicyCatalog().map((p) => ({ ...p, disabled: disabled.has(p.key) })),
    });
  }),
);

const toggleSchema = z.object({ disabled: z.boolean() });

policiesRouter.patch(
  "/:key",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const key = req.params.key;
    if (!key || !POLICIES.some((p) => p.key === key)) {
      throw new AppError(404, "Unknown policy", "NOT_FOUND");
    }
    const body = toggleSchema.parse(req.body);

    const me = req.user!;
    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: me.organizationId }, select: { settings: true },
    });
    const current = parseOrgSettings(org?.settings);
    const list = new Set<string>(current.disabledPolicies ?? []);
    if (body.disabled) list.add(key); else list.delete(key);

    const updated = await basePrismaUnscoped.organization.update({
      where: { id: me.organizationId },
      data: { settings: { ...current, disabledPolicies: Array.from(list) } as object },
      select: { settings: true },
    });
    const newDisabled = new Set<string>(parseOrgSettings(updated.settings).disabledPolicies ?? []);
    res.json({
      policies: publicPolicyCatalog().map((p) => ({ ...p, disabled: newDisabled.has(p.key) })),
    });
  }),
);
