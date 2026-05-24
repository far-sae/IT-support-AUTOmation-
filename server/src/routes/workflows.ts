/**
 * Phase 13 — Workflow routes.
 *
 *   GET  /api/workflows                     — catalog
 *   POST /api/workflows                     — start one against a ticket (AGENT/ADMIN)
 *   GET  /api/workflows/executions          — recent executions
 *   GET  /api/workflows/executions/:id      — single execution + steps
 *   POST /api/workflows/executions/:id/approve  — approve a WAITING approval step (ADMIN)
 *   POST /api/workflows/executions/:id/cancel   — cancel a non-terminal execution (ADMIN)
 *   POST /api/workflows/tick                — ADMIN: force-advance now
 */

import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import {
  findWorkflow, publicWorkflowCatalog, pickWorkflowForTicket,
} from "../workflows/registry.js";
import {
  advanceWorkflows, approveWaitingStep, cancelWorkflow, startWorkflow,
} from "../workflows/engine.js";

export const workflowsRouter = Router();
workflowsRouter.use(requireAuth);

workflowsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ workflows: publicWorkflowCatalog() });
  }),
);

workflowsRouter.post(
  "/",
  requireRole(Role.AGENT, Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const parsed = z.object({
      ticketId: z.string().min(1),
      workflowKey: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "ticketId required", "VALIDATION");

    const ticket = await prisma.ticket.findUnique({ where: { id: parsed.data.ticketId } });
    if (!ticket) throw new AppError(404, "Ticket not found", "NOT_FOUND");

    let key = parsed.data.workflowKey;
    if (!key) {
      const pick = pickWorkflowForTicket(ticket);
      if (!pick) throw new AppError(400, "No workflow matches this ticket and none was specified", "VALIDATION");
      key = pick.workflow.key;
    } else if (!findWorkflow(key)) {
      throw new AppError(404, `Unknown workflow '${key}'`, "NOT_FOUND");
    }

    const id = await startWorkflow({
      organizationId: me.organizationId,
      ticketId: ticket.id,
      workflowKey: key,
    });
    res.status(201).json({ workflowExecutionId: id, workflowKey: key });
  }),
);

workflowsRouter.get(
  "/executions",
  asyncHandler(async (req, res) => {
    const ticketId = typeof req.query.ticketId === "string" ? req.query.ticketId : undefined;
    const executions = await prisma.workflowExecution.findMany({
      where: ticketId ? { ticketId } : {},
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    res.json({ executions });
  }),
);

workflowsRouter.get(
  "/executions/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const execution = await prisma.workflowExecution.findUnique({
      where: { id },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    if (!execution) throw new AppError(404, "Execution not found", "NOT_FOUND");
    res.json({ execution });
  }),
);

workflowsRouter.post(
  "/executions/:id/approve",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const parsed = z.object({ stepKey: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) throw new AppError(400, "stepKey required", "VALIDATION");
    const exec = await prisma.workflowExecution.findUnique({ where: { id } });
    if (!exec) throw new AppError(404, "Execution not found", "NOT_FOUND");
    await approveWaitingStep(id, parsed.data.stepKey, me.id);
    res.json({ ok: true });
  }),
);

workflowsRouter.post(
  "/executions/:id/cancel",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "id required", "VALIDATION");
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "cancelled by admin";
    const exec = await prisma.workflowExecution.findUnique({ where: { id } });
    if (!exec) throw new AppError(404, "Execution not found", "NOT_FOUND");
    await cancelWorkflow(id, reason);
    res.json({ ok: true });
  }),
);

workflowsRouter.post(
  "/tick",
  requireRole(Role.ADMIN),
  asyncHandler(async (_req, res) => {
    const advanced = await advanceWorkflows(new Date());
    res.json({ ok: true, advanced });
  }),
);
