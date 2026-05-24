/**
 * Phase 12 — Detection routes.
 *
 *   GET   /api/detections/rules            — catalog + which are disabled
 *   PATCH /api/detections/rules/:key       — ADMIN: enable/disable
 *   GET   /api/detections/hits             — recent hits (default: unacknowledged)
 *   POST  /api/detections/hits/:id/ack     — mark a hit acknowledged
 *   POST  /api/detections/run              — ADMIN: force a detection sweep now
 */

import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { basePrismaUnscoped, prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { parseOrgSettings } from "../tenant/settings.js";
import { publicDetectionCatalog } from "../detect/registry.js";
import { runDetectionsForOrg } from "../detect/engine.js";

export const detectionsRouter = Router();
detectionsRouter.use(requireAuth);

detectionsRouter.get(
  "/rules",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: me.organizationId }, select: { settings: true },
    });
    const disabled = new Set(parseOrgSettings(org?.settings).disabledDetectionRules ?? []);
    const rules = publicDetectionCatalog().map((r) => ({ ...r, disabled: disabled.has(r.key) }));
    res.json({ rules });
  }),
);

detectionsRouter.patch(
  "/rules/:key",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const key = req.params.key;
    if (!key) throw new AppError(400, "rule key required", "VALIDATION");
    const parsed = z.object({ disabled: z.boolean() }).safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "disabled must be boolean", "VALIDATION");
    const valid = new Set(publicDetectionCatalog().map((r) => r.key));
    if (!valid.has(key)) throw new AppError(404, "Unknown rule", "NOT_FOUND");

    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: me.organizationId }, select: { settings: true },
    });
    if (!org) throw new AppError(404, "Org not found", "NOT_FOUND");
    const settings = parseOrgSettings(org.settings);
    const set = new Set(settings.disabledDetectionRules ?? []);
    if (parsed.data.disabled) set.add(key);
    else set.delete(key);
    await basePrismaUnscoped.organization.update({
      where: { id: me.organizationId },
      data: { settings: { ...settings, disabledDetectionRules: [...set] } as object },
    });
    res.json({ ok: true });
  }),
);

detectionsRouter.get(
  "/hits",
  asyncHandler(async (req, res) => {
    const include = String(req.query.include ?? "open"); // "open" | "all"
    const hits = await prisma.detectionHit.findMany({
      where: include === "all" ? {} : { acknowledgedAt: null },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ hits });
  }),
);

detectionsRouter.post(
  "/hits/:id/ack",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const hit = await prisma.detectionHit.findUnique({ where: { id } });
    if (!hit) throw new AppError(404, "Hit not found", "NOT_FOUND");
    const updated = await prisma.detectionHit.update({
      where: { id },
      data: { acknowledgedAt: new Date(), acknowledgedBy: me.id },
    });
    res.json({ hit: updated });
  }),
);

detectionsRouter.post(
  "/run",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const created = await runDetectionsForOrg(me.organizationId, new Date());
    res.json({ ok: true, hitsCreated: created });
  }),
);
