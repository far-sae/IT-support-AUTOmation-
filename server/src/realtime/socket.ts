/**
 * Socket.io setup.
 *
 * The handshake is authenticated with the same JWT we issue for the REST API,
 * passed either in `socket.handshake.auth.token` or the `?token=` query string.
 *
 * Multi-tenant: each connecting socket joins `org:<organizationId>` so that
 * `emit()` can target only that tenant's clients. When `emit()` is called
 * inside a tenant ALS context it sends to the matching org room; outside any
 * context it broadcasts (used e.g. when a platform admin acts on an org list).
 */

import type { Server as HttpServer } from "node:http";
import { Server as IOServer, type Socket } from "socket.io";
import type { Role } from "@prisma/client";

import { env } from "../env.js";
import { verifyToken } from "../auth/jwt.js";
import { getTenantContext } from "../tenant/context.js";

export interface RelayEvents {
  "ticket:created":   (payload: { ticketId: string; refCode: string; status: string; priority: string }) => void;
  "ticket:updated":   (payload: { ticketId: string; refCode: string; status: string }) => void;
  "device:updated":   (payload: { deviceId: string; hostname: string; healthStatus: string }) => void;
  "session:event":    (payload: { sessionId: string; event: { time: string; type: string; message: string } }) => void;
  "sla:breach":       (payload: { ticketId: string; refCode: string; minutesOver: number }) => void;
  "incident:updated": (payload: { incidentId: string; status: string; componentId: string }) => void;
  "analytics:updated": (payload: { reason: string }) => void;
}

interface SocketAuth {
  userId: string;
  role: Role;
  organizationId: string;
}

type RelayIO = IOServer<Record<string, never>, RelayEvents>;

let io: RelayIO | null = null;

export function initSocket(server: HttpServer): RelayIO {
  io = new IOServer<Record<string, never>, RelayEvents>(server, {
    cors: { origin: env.CLIENT_URL, credentials: true },
  });

  io.use((socket, next) => {
    const tokenRaw = socket.handshake.auth?.token ?? socket.handshake.query?.token;
    const token = typeof tokenRaw === "string" ? tokenRaw : Array.isArray(tokenRaw) ? tokenRaw[0] : undefined;
    if (!token) return next(new Error("Authentication required"));
    try {
      const payload = verifyToken(token);
      (socket.data as SocketAuth).userId = payload.userId;
      (socket.data as SocketAuth).role = payload.role;
      (socket.data as SocketAuth).organizationId = payload.organizationId;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const auth = socket.data as SocketAuth;
    socket.join(`role:${auth.role}`);
    socket.join(`user:${auth.userId}`);
    socket.join(`org:${auth.organizationId}`);
  });

  return io;
}

export function getIO(): RelayIO | null {
  return io;
}

type EventPayload<K extends keyof RelayEvents> = Parameters<RelayEvents[K]>[0];

/**
 * Emit an event. Reads the current tenant ALS context; if an organizationId
 * is set it targets `org:<id>` only. Outside any context (very rare — only
 * platform-mode or boot scripts) it broadcasts to all connected sockets.
 */
export function emit<K extends keyof RelayEvents>(event: K, payload: EventPayload<K>): void {
  if (!io) return;
  const ctx = getTenantContext();
  const args = [payload] as unknown as Parameters<RelayEvents[K]>;
  if (ctx?.organizationId) {
    io.to(`org:${ctx.organizationId}`).emit(event, ...args);
  } else {
    io.emit(event, ...args);
  }
}
