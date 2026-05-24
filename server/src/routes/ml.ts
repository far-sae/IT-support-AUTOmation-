/**
 * Phase 16 — ML routes.
 *
 *   GET  /api/ml/models             — list every trained model (active + history)
 *   POST /api/ml/train              — ADMIN: train now
 *   POST /api/ml/models/:id/activate — ADMIN: flip a specific version active (rollback)
 */

import { Router } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { trainRemediationModel, REMEDIATION_MODEL_KEY } from "../ml/trainer.js";
import { invalidateModelCache } from "../ml/predict.js";

export const mlRouter = Router();
mlRouter.use(requireAuth);

mlRouter.get(
  "/models",
  asyncHandler(async (_req, res) => {
    const models = await prisma.mlModel.findMany({
      orderBy: { version: "desc" }, take: 30,
      select: { id: true, modelKey: true, version: true, active: true, metrics: true, trainedAt: true },
    });
    res.json({ models });
  }),
);

mlRouter.post(
  "/train",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const result = await trainRemediationModel(me.organizationId);
    if (!result) {
      throw new AppError(400, "Not enough labelled history to train (need ≥3 positives + ≥3 negatives)", "VALIDATION");
    }
    invalidateModelCache(me.organizationId);
    res.json({ ok: true, ...result });
  }),
);

mlRouter.post(
  "/models/:id/activate",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const target = await prisma.mlModel.findUnique({ where: { id } });
    if (!target) throw new AppError(404, "Model not found", "NOT_FOUND");

    await prisma.mlModel.updateMany({
      where: { modelKey: target.modelKey, active: true },
      data: { active: false },
    });
    const updated = await prisma.mlModel.update({
      where: { id }, data: { active: true },
    });
    invalidateModelCache(me.organizationId);
    res.json({ ok: true, model: updated });
  }),
);

export { REMEDIATION_MODEL_KEY };
