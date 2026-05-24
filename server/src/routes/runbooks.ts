/**
 * Runbook endpoints.
 *
 *   GET    /api/runbook-catalog                        — catalog + disabled flags
 *   PATCH  /api/runbook-catalog/:key                   — ADMIN: toggle disabled
 *
 *   GET    /api/tickets/:ticketId/runbook-executions   — list executions for a ticket
 *   POST   /api/runbook-executions/:id/confirm         — submitter Yes/No after AWAITING_USER
 *   POST   /api/runbook-executions/:id/approve         — AGENT/ADMIN approves HIGH-risk one
 */

import { Router } from "express";
import { z } from "zod";
import { Role, RunbookStatus } from "@prisma/client";

import { basePrismaUnscoped, prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { parseOrgSettings } from "../tenant/settings.js";
import { publicCatalog, RUNBOOKS } from "../runbooks/registry.js";
import { approveExecution, confirmExecution } from "../runbooks/engine.js";
import { triage } from "../triage.js";

// ─── Catalog ─────────────────────────────────────────────────────────

export const runbookCatalogRouter = Router();
runbookCatalogRouter.use(requireAuth);

runbookCatalogRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: { settings: true },
    });
    const disabled = new Set<string>(
      (parseOrgSettings(org?.settings) as { disabledRunbooks?: string[] }).disabledRunbooks ?? [],
    );
    res.json({
      runbooks: publicCatalog().map((r) => ({ ...r, disabled: disabled.has(r.key) })),
    });
  }),
);

const toggleSchema = z.object({ disabled: z.boolean() });

runbookCatalogRouter.patch(
  "/:key",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const key = req.params.key;
    if (!key || !RUNBOOKS.some((r) => r.key === key)) {
      throw new AppError(404, "Unknown runbook key", "NOT_FOUND");
    }
    const body = toggleSchema.parse(req.body);

    const org = await basePrismaUnscoped.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: { settings: true },
    });
    const current = parseOrgSettings(org?.settings);
    const disabledList = new Set<string>((current as { disabledRunbooks?: string[] }).disabledRunbooks ?? []);
    if (body.disabled) disabledList.add(key); else disabledList.delete(key);

    const updated = await basePrismaUnscoped.organization.update({
      where: { id: req.user!.organizationId },
      data: { settings: { ...current, disabledRunbooks: Array.from(disabledList) } as object },
      select: { settings: true },
    });
    const newDisabled = new Set<string>((parseOrgSettings(updated.settings) as { disabledRunbooks?: string[] }).disabledRunbooks ?? []);
    res.json({
      runbooks: publicCatalog().map((r) => ({ ...r, disabled: newDisabled.has(r.key) })),
    });
  }),
);

// ─── Executions (per ticket) ─────────────────────────────────────────

export const ticketRunbookExecutionsRouter = Router({ mergeParams: true });
ticketRunbookExecutionsRouter.use(requireAuth);

ticketRunbookExecutionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const ticketId = (req.params as { ticketId?: string }).ticketId;
    if (!ticketId) throw new AppError(400, "Missing ticketId", "BAD_REQUEST");
    // Tenant scope via the Prisma extension; an org B ticketId yields [].
    const executions = await prisma.runbookExecution.findMany({
      where: { ticketId },
      orderBy: { startedAt: "desc" },
      include: {
        approvedBy: { select: { id: true, name: true, email: true } },
        agentActions: {
          orderBy: { createdAt: "desc" },
          select: { id: true, kind: true, status: true, input: true, result: true, createdAt: true, completedAt: true },
        },
      },
    });
    res.json({ executions });
  }),
);

// ─── Confirm / approve ───────────────────────────────────────────────

export const runbookExecutionsRouter = Router();
runbookExecutionsRouter.use(requireAuth);

const confirmSchema = z.object({ fixed: z.boolean() });

runbookExecutionsRouter.post(
  "/:id/confirm",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const body = confirmSchema.parse(req.body);

    // Only the submitter (or an agent/admin) may confirm.
    const exec = await prisma.runbookExecution.findUnique({
      where: { id },
      include: { ticket: { select: { submitterUserId: true, submitterEmail: true } } },
    });
    if (!exec) throw new AppError(404, "Execution not found", "NOT_FOUND");
    const me = req.user!;
    const isStaff = me.role === Role.AGENT || me.role === Role.ADMIN;
    const isSubmitter = exec.ticket.submitterUserId === me.id || exec.ticket.submitterEmail === me.email;
    if (!isStaff && !isSubmitter) throw new AppError(403, "Not your ticket", "FORBIDDEN");

    const r = await confirmExecution(id, body.fixed ? "fixed" : "still_broken", me);
    res.json(r);
  }),
);

runbookExecutionsRouter.post(
  "/:id/approve",
  requireRole(Role.AGENT, Role.ADMIN),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const exec = await prisma.runbookExecution.findUnique({
      where: { id },
      include: { ticket: true },
    });
    if (!exec) throw new AppError(404, "Execution not found", "NOT_FOUND");
    if (exec.status !== RunbookStatus.AWAITING_AGENT) {
      throw new AppError(409, `Execution is in ${exec.status}, not AWAITING_AGENT`, "BAD_STATE");
    }
    // Recompute triage so the runbook gets the original context.
    const t = triage(exec.ticket.description);
    const r = await approveExecution(id, { id: req.user!.id }, t);
    res.json(r);
  }),
);
