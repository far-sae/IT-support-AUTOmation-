import { Router } from "express";
import { z } from "zod";
import { Prisma, Role, SessionStatus } from "@prisma/client";

import { prisma } from "../db.js";
import { AppError, asyncHandler } from "../errors.js";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { emit } from "../realtime/socket.js";

export const remoteSessionsRouter = Router();
remoteSessionsRouter.use(requireAuth, requireRole(Role.AGENT, Role.ADMIN));

interface SessionEvent { time: string; type: string; message: string }

remoteSessionsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const sessions = await prisma.remoteSession.findMany({
      orderBy: { startedAt: "desc" },
      take: 50,
      include: {
        device: { select: { id: true, hostname: true, assignedUser: true } },
        agent: { select: { id: true, name: true, email: true } },
      },
    });
    res.json({ sessions });
  }),
);

remoteSessionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const session = await prisma.remoteSession.findUnique({
      where: { id },
      include: {
        device: true,
        agent: { select: { id: true, name: true, email: true } },
      },
    });
    if (!session) throw new AppError(404, "Session not found", "NOT_FOUND");
    res.json({ session });
  }),
);

const startSchema = z.object({ deviceId: z.string().min(1) });

remoteSessionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = startSchema.parse(req.body);
    const me = req.user!;

    const device = await prisma.device.findUnique({ where: { id: body.deviceId } });
    if (!device) throw new AppError(404, "Device not found", "NOT_FOUND");

    const firstEvent: SessionEvent = {
      time: new Date().toISOString(),
      type: "system",
      message: `Session started — connecting to ${device.hostname}.`,
    };

    const session = await prisma.remoteSession.create({
      data: {
        organizationId: me.organizationId,
        deviceId: device.id,
        agentId: me.id,
        status: SessionStatus.LIVE,
        eventLog: [firstEvent] as unknown as Prisma.InputJsonValue,
      },
      include: {
        device: { select: { id: true, hostname: true, assignedUser: true } },
        agent: { select: { id: true, name: true, email: true } },
      },
    });

    emit("session:event", { sessionId: session.id, event: firstEvent });
    res.status(201).json({ session });
  }),
);

const appendSchema = z.object({
  event: z.object({
    type: z.string().min(1).max(40),
    message: z.string().min(1).max(500),
  }),
});

remoteSessionsRouter.patch(
  "/:id/events",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const { event } = appendSchema.parse(req.body);

    const session = await prisma.remoteSession.findUnique({ where: { id } });
    if (!session) throw new AppError(404, "Session not found", "NOT_FOUND");
    if (session.status === SessionStatus.ENDED) {
      throw new AppError(400, "Session has ended", "BAD_REQUEST");
    }

    const newEvent: SessionEvent = { time: new Date().toISOString(), ...event };
    const log: SessionEvent[] = Array.isArray(session.eventLog) ? (session.eventLog as unknown as SessionEvent[]) : [];

    const updated = await prisma.remoteSession.update({
      where: { id },
      data: { eventLog: [...log, newEvent] as unknown as Prisma.InputJsonValue },
    });

    emit("session:event", { sessionId: updated.id, event: newEvent });
    res.json({ session: updated });
  }),
);

remoteSessionsRouter.patch(
  "/:id/end",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const session = await prisma.remoteSession.findUnique({ where: { id } });
    if (!session) throw new AppError(404, "Session not found", "NOT_FOUND");

    const endEvent: SessionEvent = {
      time: new Date().toISOString(),
      type: "system",
      message: "Session ended.",
    };
    const log: SessionEvent[] = Array.isArray(session.eventLog) ? (session.eventLog as unknown as SessionEvent[]) : [];

    const updated = await prisma.remoteSession.update({
      where: { id },
      data: {
        status: SessionStatus.ENDED,
        endedAt: new Date(),
        eventLog: [...log, endEvent] as unknown as Prisma.InputJsonValue,
      },
    });

    emit("session:event", { sessionId: updated.id, event: endEvent });
    res.json({ session: updated });
  }),
);
