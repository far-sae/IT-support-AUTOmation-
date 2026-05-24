/**
 * Phase 26 — Defender routes.
 *
 *   GET  /api/defender/runs          — recent runs (newest first)
 *   GET  /api/defender/runs/:id      — full record incl. toolCalls + decisions
 *   GET  /api/defender/latest        — convenience: latest SUCCEEDED/HALTED run
 *   POST /api/defender/run-now       — ADMIN: trigger an immediate run
 */

import { Router } from "express";
import { Role } from "@prisma/client";
import { basePrismaUnscoped, prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { runDefenderForOrg } from "../defender/agent.js";

export const defenderRouter = Router();
defenderRouter.use(requireAuth);

defenderRouter.get(
  "/runs",
  asyncHandler(async (_req, res) => {
    const runs = await prisma.defenderRun.findMany({
      orderBy: { runDate: "desc" }, take: 30,
      select: {
        id: true, runDate: true, status: true, iterations: true,
        startedAt: true, completedAt: true,
        outcomes: true, situation: true,
      },
    });
    res.json({ runs });
  }),
);

defenderRouter.get(
  "/runs/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const run = await prisma.defenderRun.findUnique({ where: { id } });
    if (!run) throw new AppError(404, "Run not found", "NOT_FOUND");
    res.json({ run });
  }),
);

defenderRouter.get(
  "/latest",
  asyncHandler(async (_req, res) => {
    const run = await prisma.defenderRun.findFirst({
      where: { status: { in: ["SUCCEEDED", "HALTED"] } },
      orderBy: { runDate: "desc" },
    });
    res.json({ run });
  }),
);

defenderRouter.post(
  "/run-now",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const r = await runDefenderForOrg(me.organizationId, { runDate: new Date() });
    res.status(201).json(r);
  }),
);
