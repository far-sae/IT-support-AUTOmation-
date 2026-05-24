import { Router } from "express";
import { z } from "zod";
import { AgentActionKind, DeviceType, HealthStatus, Role } from "@prisma/client";

import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { emit } from "../realtime/socket.js";

export const devicesRouter = Router();
devicesRouter.use(requireAuth, requireRole(Role.AGENT, Role.ADMIN));

devicesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const health = req.query.health;
    const where = typeof health === "string" && health in HealthStatus
      ? { healthStatus: health as HealthStatus }
      : {};
    const devices = await prisma.device.findMany({
      where,
      orderBy: { hostname: "asc" },
    });
    res.json({ devices });
  }),
);

const baseDevice = {
  hostname: z.string().min(1).max(120),
  assignedUser: z.string().min(1).max(120),
  type: z.nativeEnum(DeviceType),
  os: z.string().min(1).max(120),
  healthStatus: z.nativeEnum(HealthStatus),
  diskUsage: z.number().int().min(0).max(100),
  ramUsage: z.number().int().min(0).max(100),
  patchStatus: z.string().min(1).max(120),
};

const createSchema = z.object(baseDevice);

devicesRouter.post(
  "/",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const device = await prisma.device.create({
      data: { ...body, organizationId: req.user!.organizationId, lastSeenAt: new Date() },
    });
    emit("device:updated", { deviceId: device.id, hostname: device.hostname, healthStatus: device.healthStatus });
    res.status(201).json({ device });
  }),
);

const updateSchema = z.object(baseDevice).partial();

devicesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const body = updateSchema.parse(req.body);
    const device = await prisma.device.update({ where: { id }, data: body });
    emit("device:updated", { deviceId: device.id, hostname: device.hostname, healthStatus: device.healthStatus });
    res.json({ device });
  }),
);

// ─── Phase 10C — manual co-pilot dispatch ────────────────────────────
//
// Agent / admin clicks "Run diagnostic" / "Restart Outlook" on the Remote
// page → we queue an AgentAction for the device. No runbook execution
// linked (those come from automated runbook runs).

const dispatchSchema = z.object({
  kind: z.nativeEnum(AgentActionKind),
  input: z.record(z.unknown()).default({}),
});

devicesRouter.post(
  "/:id/actions",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const body = dispatchSchema.parse(req.body);
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device) throw new AppError(404, "Device not found", "NOT_FOUND");
    if (device.discoverySource !== "AGENT") {
      throw new AppError(400, "This device has no agent installed", "BAD_REQUEST");
    }
    const action = await prisma.agentAction.create({
      data: {
        organizationId: req.user!.organizationId,
        deviceId: device.id,
        kind: body.kind,
        input: body.input,
      },
    });
    emit("device:updated", { deviceId: device.id, hostname: device.hostname, healthStatus: device.healthStatus });
    res.status(201).json({ action });
  }),
);

devicesRouter.get(
  "/:id/actions",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const actions = await prisma.agentAction.findMany({
      where: { deviceId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    res.json({ actions });
  }),
);

devicesRouter.delete(
  "/:id",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    await prisma.device.delete({ where: { id } });
    res.status(204).end();
  }),
);
