import { Router } from "express";
import { z } from "zod";
import { ComponentStatus, IncidentImpact, IncidentStatus, Prisma, Role } from "@prisma/client";

import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { emit } from "../realtime/socket.js";

export const incidentsRouter = Router();
incidentsRouter.use(requireAuth, requireRole(Role.ADMIN));

// ─── List ─────────────────────────────────────────────────────────────

incidentsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const incidents = await prisma.incident.findMany({
      orderBy: { startedAt: "desc" },
      include: { component: { select: { id: true, name: true } } },
    });
    res.json({ incidents });
  }),
);

// ─── Components (admin-managed) ──────────────────────────────────────

incidentsRouter.get(
  "/components",
  asyncHandler(async (_req, res) => {
    const components = await prisma.serviceComponent.findMany({ orderBy: { name: "asc" } });
    res.json({ components });
  }),
);

// ─── Create ───────────────────────────────────────────────────────────

interface IncidentUpdate { time: string; status: IncidentStatus; message: string }

const createSchema = z.object({
  title: z.string().min(1).max(200),
  status: z.nativeEnum(IncidentStatus).default(IncidentStatus.INVESTIGATING),
  impact: z.nativeEnum(IncidentImpact).default(IncidentImpact.MINOR),
  componentId: z.string().min(1),
  message: z.string().min(1).max(500),
  componentStatus: z.nativeEnum(ComponentStatus).optional(),
});

incidentsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);

    const component = await prisma.serviceComponent.findUnique({ where: { id: body.componentId } });
    if (!component) throw new AppError(404, "Component not found", "NOT_FOUND");

    const initialUpdate: IncidentUpdate = {
      time: new Date().toISOString(),
      status: body.status,
      message: body.message,
    };

    const incident = await prisma.incident.create({
      data: {
        organizationId: req.user!.organizationId,
        title: body.title,
        status: body.status,
        impact: body.impact,
        componentId: body.componentId,
        updates: [initialUpdate] as unknown as Prisma.InputJsonValue,
      },
      include: { component: { select: { id: true, name: true } } },
    });

    if (body.componentStatus) {
      await prisma.serviceComponent.update({
        where: { id: body.componentId },
        data: { status: body.componentStatus },
      });
    }

    emit("incident:updated", {
      incidentId: incident.id,
      status: incident.status,
      componentId: incident.componentId,
    });

    res.status(201).json({ incident });
  }),
);

// ─── Append update ────────────────────────────────────────────────────

const updateSchema = z.object({
  status: z.nativeEnum(IncidentStatus),
  message: z.string().min(1).max(500),
  componentStatus: z.nativeEnum(ComponentStatus).optional(),
  resolved: z.boolean().optional(),
});

incidentsRouter.post(
  "/:id/updates",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const body = updateSchema.parse(req.body);

    const existing = await prisma.incident.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "Incident not found", "NOT_FOUND");

    const log: IncidentUpdate[] = Array.isArray(existing.updates)
      ? (existing.updates as unknown as IncidentUpdate[])
      : [];
    const newUpdate: IncidentUpdate = {
      time: new Date().toISOString(),
      status: body.status,
      message: body.message,
    };

    const resolvingNow = body.resolved || body.status === IncidentStatus.RESOLVED;

    const incident = await prisma.incident.update({
      where: { id },
      data: {
        status: body.status,
        updates: [...log, newUpdate] as unknown as Prisma.InputJsonValue,
        resolvedAt: resolvingNow ? new Date() : existing.resolvedAt,
      },
      include: { component: { select: { id: true, name: true } } },
    });

    if (body.componentStatus) {
      await prisma.serviceComponent.update({
        where: { id: existing.componentId },
        data: { status: body.componentStatus },
      });
    } else if (resolvingNow) {
      await prisma.serviceComponent.update({
        where: { id: existing.componentId },
        data: { status: ComponentStatus.OPERATIONAL },
      });
    }

    emit("incident:updated", {
      incidentId: incident.id,
      status: incident.status,
      componentId: incident.componentId,
    });

    res.json({ incident });
  }),
);
