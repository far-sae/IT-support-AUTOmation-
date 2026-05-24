/**
 * Phase 27 — Behavioural-defence API.
 *
 *   GET  /api/attack/techniques            — paginated catalog (search by tactic, mitreId)
 *   GET  /api/attack/coverage              — coverage report: which techniques have rules
 *   POST /api/attack/ingest                — ADMIN: force-refresh from MITRE
 *
 *   GET  /api/attack/rules                 — list generated rules (filter by status)
 *   GET  /api/attack/rules/:id             — single rule
 *   POST /api/attack/rules                 — ADMIN: hand-author a rule
 *   POST /api/attack/rules/:id/test        — ADMIN: replay against history
 *   POST /api/attack/rules/:id/approve     — ADMIN: TESTING → APPROVED
 *   POST /api/attack/rules/:id/reject      — ADMIN: TESTING → REJECTED (with reason)
 *   POST /api/attack/rules/:id/retire      — ADMIN: APPROVED → RETIRED
 *
 *   GET  /api/attack/sensors/alerts        — recent SensorAlert rows for this org
 *
 *   POST /api/attack/study/run-now         — ADMIN: trigger AI study session immediately
 */

import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { basePrismaUnscoped, prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { ingestMitreAttack } from "../attack/mitre-ingest.js";
import { validateRuleSpec } from "../rules/dsl.js";
import { replayRule } from "../rules/replay.js";
import { runRuleStudyForOrg } from "../rules/study.js";
import { runDemoStudyForOrg } from "../rules/demo.js";
import { env } from "../env.js";

export const attackRouter = Router();
attackRouter.use(requireAuth);

attackRouter.get(
  "/techniques",
  asyncHandler(async (req, res) => {
    const tactic = typeof req.query.tactic === "string" ? req.query.tactic : undefined;
    const search = typeof req.query.q === "string" ? req.query.q : undefined;
    const limit  = Math.min(200, Number(req.query.limit) || 100);
    const techniques = await basePrismaUnscoped.attackTechnique.findMany({
      where: {
        revoked: false,
        ...(tactic ? { tactic } : {}),
        ...(search ? { OR: [
          { mitreId: { contains: search, mode: "insensitive" } },
          { name:    { contains: search, mode: "insensitive" } },
        ] } : {}),
      },
      orderBy: [{ tactic: "asc" }, { mitreId: "asc" }],
      take: limit,
    });
    res.json({ techniques });
  }),
);

attackRouter.get(
  "/coverage",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const all = await basePrismaUnscoped.attackTechnique.findMany({
      where: { revoked: false },
      select: { id: true, mitreId: true, name: true, tactic: true },
    });
    const approved = await basePrismaUnscoped.generatedRule.findMany({
      where: {
        status: "APPROVED",
        attackTechniqueId: { not: null },
        OR: [{ organizationId: null }, { organizationId: me.organizationId }],
      },
      select: { attackTechniqueId: true },
    });
    const coveredSet = new Set(approved.map((r) => r.attackTechniqueId));
    const byTactic: Record<string, { covered: number; total: number; techniques: Array<{ mitreId: string; name: string; covered: boolean }> }> = {};
    for (const t of all) {
      if (!byTactic[t.tactic]) byTactic[t.tactic] = { covered: 0, total: 0, techniques: [] };
      const covered = coveredSet.has(t.id);
      byTactic[t.tactic]!.total++;
      if (covered) byTactic[t.tactic]!.covered++;
      byTactic[t.tactic]!.techniques.push({ mitreId: t.mitreId, name: t.name, covered });
    }
    res.json({
      summary: {
        totalTechniques: all.length,
        approvedRules:   approved.length,
        coveredTechniques: coveredSet.size,
      },
      byTactic,
    });
  }),
);

attackRouter.post(
  "/ingest",
  requireRole(Role.ADMIN),
  asyncHandler(async (_req, res) => {
    const r = await ingestMitreAttack();
    res.json({ ok: true, ...r });
  }),
);

// ── Generated rules ──────────────────────────────────────────────────

attackRouter.get(
  "/rules",
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;
    const rules = await basePrismaUnscoped.generatedRule.findMany({
      where: {
        OR: [{ organizationId: null }, { organizationId: me.organizationId }],
        ...(status ? { status: status as never } : {}),
      },
      orderBy: { createdAt: "desc" }, take: 200,
      include: { attackTechnique: { select: { mitreId: true, name: true, tactic: true } } },
    });
    res.json({ rules });
  }),
);

attackRouter.get(
  "/rules/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const rule = await basePrismaUnscoped.generatedRule.findUnique({
      where: { id }, include: { attackTechnique: true },
    });
    if (!rule) throw new AppError(404, "Rule not found", "NOT_FOUND");
    res.json({ rule });
  }),
);

attackRouter.post(
  "/rules",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const parsed = z.object({
      mitreId:     z.string().optional(),
      title:       z.string().min(3),
      description: z.string().min(10),
      severity:    z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
      logic:       z.unknown(),
    }).safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "Invalid body", "VALIDATION");
    let spec;
    try { spec = validateRuleSpec(parsed.data.logic); }
    catch (err) { throw new AppError(400, `Invalid rule logic: ${(err as Error).message}`, "VALIDATION"); }

    const tech = parsed.data.mitreId
      ? await basePrismaUnscoped.attackTechnique.findUnique({ where: { mitreId: parsed.data.mitreId } })
      : null;

    const rule = await basePrismaUnscoped.generatedRule.create({
      data: {
        organizationId: me.organizationId,
        attackTechniqueId: tech?.id ?? null,
        title:       parsed.data.title,
        description: parsed.data.description,
        severity:    parsed.data.severity,
        logic:       spec as unknown as object,
        status:      "DRAFT",
        createdBy:   `human:${me.id}`,
      },
    });
    res.status(201).json({ rule });
  }),
);

attackRouter.post(
  "/rules/:id/test",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const rule = await basePrismaUnscoped.generatedRule.findUnique({ where: { id } });
    if (!rule) throw new AppError(404, "Rule not found", "NOT_FOUND");
    const spec = rule.logic as never;
    const report = await replayRule(me.organizationId, spec);
    await basePrismaUnscoped.generatedRule.update({
      where: { id }, data: { testResults: report as unknown as object },
    });
    res.json({ report });
  }),
);

attackRouter.post(
  "/rules/:id/approve",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const updated = await basePrismaUnscoped.generatedRule.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: me.id, approvedAt: new Date() },
    });
    res.json({ rule: updated });
  }),
);

attackRouter.post(
  "/rules/:id/reject",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const reason = String(req.body?.reason ?? "rejected by admin").slice(0, 500);
    const updated = await basePrismaUnscoped.generatedRule.update({
      where: { id },
      data: { status: "REJECTED", rejectionReason: reason, approvedBy: me.id, approvedAt: new Date() },
    });
    res.json({ rule: updated });
  }),
);

attackRouter.post(
  "/rules/:id/retire",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const updated = await basePrismaUnscoped.generatedRule.update({
      where: { id }, data: { status: "RETIRED" },
    });
    res.json({ rule: updated });
  }),
);

// ── Sensor alerts ────────────────────────────────────────────────────

attackRouter.get(
  "/sensors/alerts",
  asyncHandler(async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const alerts = await prisma.sensorAlert.findMany({
      orderBy: { createdAt: "desc" }, take: limit,
    });
    res.json({ alerts });
  }),
);

// ── AI study session ──────────────────────────────────────────────────

attackRouter.post(
  "/study/run-now",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    // Real AI when keys are configured.
    const aiOn = env.USE_AI_BRAIN && env.ANTHROPIC_API_KEY && env.AI_RULE_STUDY_ENABLED;
    if (aiOn) {
      const r = await runRuleStudyForOrg(me.organizationId);
      res.json({ ...r, mode: "ai" });
      return;
    }
    // Fallback: deterministic demo generator. Every rule it produces is
    // clearly labelled `createdBy: demo_template` and gets a DEMO badge
    // in the UI — nobody can mistake the output for real AI.
    const r = await runDemoStudyForOrg(me.organizationId);
    res.json(r);
  }),
);
