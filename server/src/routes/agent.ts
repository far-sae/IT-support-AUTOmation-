/**
 * Phase 7 — Asset auto-discovery agent.
 *
 * POST /api/agent/checkin
 *   Authenticated by an AgentEnrollmentToken (Bearer header, NOT a JWT).
 *   Upserts the Device by (organizationId, hostname), stores a DeviceMetric
 *   row, recomputes healthStatus from thresholds, stamps lastCheckInAt, and
 *   emits `device:updated` so the assets page refreshes live.
 *
 * The token resolves the tenant — we don't trust the body's org information.
 */

import { Router } from "express";
import { z } from "zod";
import { DeviceType, HealthStatus, DiscoverySource } from "@prisma/client";

import { prisma, basePrismaUnscoped } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import { AppError, asyncHandler } from "../errors.js";
import { emit } from "../realtime/socket.js";

export const agentRouter = Router();

// ─── Token auth (Bearer) ──────────────────────────────────────────────

interface ResolvedToken {
  id: string;
  organizationId: string;
}

export async function resolveAgentToken(headerValue: string | undefined): Promise<ResolvedToken | null> {
  if (!headerValue) return null;
  const [scheme, raw] = headerValue.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !raw) return null;
  const found = await basePrismaUnscoped.agentEnrollmentToken.findUnique({
    where: { token: raw },
    select: { id: true, organizationId: true, revokedAt: true },
  });
  if (!found || found.revokedAt) return null;
  basePrismaUnscoped.agentEnrollmentToken
    .update({ where: { id: found.id }, data: { lastUsedAt: new Date() } })
    .catch(() => { /* fire and forget */ });
  return { id: found.id, organizationId: found.organizationId };
}

// ─── Check-in ─────────────────────────────────────────────────────────

export const checkinSchema = z.object({
  hostname:        z.string().min(1).max(120),
  os:              z.string().min(1).max(120),
  assignedUser:    z.string().min(1).max(120).optional(),
  type:            z.nativeEnum(DeviceType).optional(),
  cpu:             z.number().int().min(0).max(100),
  ram:             z.number().int().min(0).max(100),
  disk:            z.number().int().min(0).max(100),
  uptimeSeconds:   z.number().int().min(0).optional(),
  pendingUpdates:  z.number().int().min(0).optional(),
  agentVersion:    z.string().min(1).max(40).optional(),
});

export type CheckinBody = z.infer<typeof checkinSchema>;

export function computeHealth(
  cpu: number, ram: number, disk: number, pendingUpdates?: number,
): HealthStatus {
  if (disk >= 95 || ram >= 95 || (pendingUpdates ?? 0) >= 25) return HealthStatus.CRITICAL;
  if (disk >= 80 || ram >= 80 || cpu >= 90 || (pendingUpdates ?? 0) >= 5) return HealthStatus.WARNING;
  return HealthStatus.HEALTHY;
}

export interface CheckinResult {
  deviceId: string;
  hostname: string;
  healthStatus: HealthStatus;
}

/** Pure side-effecting function — caller must have already authenticated the token. */
export async function performCheckin(orgId: string, body: CheckinBody): Promise<CheckinResult> {
  return runWithTenant(orgId, async () => {
    const now = new Date();
    const health = computeHealth(body.cpu, body.ram, body.disk, body.pendingUpdates);
    const patchStatus =
      body.pendingUpdates === undefined
        ? "Unknown"
        : body.pendingUpdates === 0
          ? "Up to date"
          : `${body.pendingUpdates} update${body.pendingUpdates === 1 ? "" : "s"} pending`;

    const device = await prisma.device.upsert({
      where: { organizationId_hostname: { organizationId: orgId, hostname: body.hostname } },
      create: {
        organizationId: orgId,
        hostname: body.hostname,
        assignedUser: body.assignedUser ?? "—",
        type: body.type ?? DeviceType.LAPTOP,
        os: body.os,
        healthStatus: health,
        diskUsage: body.disk,
        ramUsage: body.ram,
        patchStatus,
        lastSeenAt: now,
        discoverySource: DiscoverySource.AGENT,
        agentVersion: body.agentVersion ?? null,
        lastCheckInAt: now,
      },
      update: {
        assignedUser: body.assignedUser ?? undefined,
        os: body.os,
        type: body.type ?? undefined,
        healthStatus: health,
        diskUsage: body.disk,
        ramUsage: body.ram,
        patchStatus,
        lastSeenAt: now,
        agentVersion: body.agentVersion ?? undefined,
        lastCheckInAt: now,
      },
    });

    await prisma.deviceMetric.create({
      data: {
        organizationId: orgId,
        deviceId: device.id,
        cpu: body.cpu,
        ram: body.ram,
        disk: body.disk,
      },
    });

    emit("device:updated", {
      deviceId: device.id,
      hostname: device.hostname,
      healthStatus: device.healthStatus,
    });

    return { deviceId: device.id, hostname: device.hostname, healthStatus: device.healthStatus };
  });
}

agentRouter.post(
  "/checkin",
  asyncHandler(async (req, res) => {
    const tok = await resolveAgentToken(req.headers.authorization);
    if (!tok) throw new AppError(401, "Invalid or revoked enrollment token", "UNAUTHENTICATED");
    const body = checkinSchema.parse(req.body);
    const result = await performCheckin(tok.organizationId, body);
    res.json({ ok: true, ...result });
  }),
);

// ─── Phase 10C — pending-actions channel ──────────────────────────────
//
// Authenticated by the same enrollment token. The agent passes its hostname
// as a query parameter so we only hand it the queued actions targeting it.

import { settleFromAgentResult } from "../runbooks/agentActions.js";

agentRouter.get(
  "/actions",
  asyncHandler(async (req, res) => {
    const tok = await resolveAgentToken(req.headers.authorization);
    if (!tok) throw new AppError(401, "Invalid or revoked enrollment token", "UNAUTHENTICATED");
    const hostname = typeof req.query.hostname === "string" ? req.query.hostname : "";
    if (!hostname) throw new AppError(400, "Missing hostname query param", "BAD_REQUEST");

    const device = await basePrismaUnscoped.device.findUnique({
      where: { organizationId_hostname: { organizationId: tok.organizationId, hostname } },
      select: { id: true },
    });
    if (!device) {
      // Agent hasn't checked in yet → no actions; not an error.
      return res.json({ actions: [] });
    }

    const queued = await basePrismaUnscoped.agentAction.findMany({
      where: { organizationId: tok.organizationId, deviceId: device.id, status: "QUEUED" },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    // Mark them IN_PROGRESS so a second poll doesn't double-dispatch.
    if (queued.length > 0) {
      const now = new Date();
      await basePrismaUnscoped.agentAction.updateMany({
        where: { id: { in: queued.map((q) => q.id) } },
        data: { status: "IN_PROGRESS", dispatchedAt: now },
      });
    }

    res.json({
      actions: queued.map((a) => ({
        id: a.id, kind: a.kind, input: a.input, createdAt: a.createdAt,
      })),
    });
  }),
);

const resultSchema = z.object({
  ok: z.boolean(),
  // Free-form stdout / structured report from the action runner.
  output: z.string().max(20_000).optional(),
  data: z.record(z.unknown()).optional(),
  errorMessage: z.string().max(2_000).optional(),
});

agentRouter.post(
  "/actions/:id/result",
  asyncHandler(async (req, res) => {
    const tok = await resolveAgentToken(req.headers.authorization);
    if (!tok) throw new AppError(401, "Invalid or revoked enrollment token", "UNAUTHENTICATED");
    const id = req.params.id;
    if (!id) throw new AppError(400, "Missing id", "BAD_REQUEST");
    const body = resultSchema.parse(req.body);

    const action = await basePrismaUnscoped.agentAction.findUnique({ where: { id } });
    if (!action || action.organizationId !== tok.organizationId) {
      throw new AppError(404, "Action not found", "NOT_FOUND");
    }
    if (action.status !== "IN_PROGRESS" && action.status !== "QUEUED") {
      // Idempotent — already finalised. Don't fail the agent.
      return res.json({ ok: true, already: action.status });
    }

    const final = body.ok ? "SUCCEEDED" : "FAILED";
    const now = new Date();
    await basePrismaUnscoped.agentAction.update({
      where: { id },
      data: {
        status: final,
        result: {
          ok: body.ok,
          output: body.output ?? null,
          data:   body.data   ?? null,
          errorMessage: body.errorMessage ?? null,
        } as object,
        completedAt: now,
      },
    });

    // If this action was created by a Tier 2 runbook, settle the run too.
    if (action.runbookExecutionId) {
      try {
        await settleFromAgentResult(action.runbookExecutionId, action.organizationId, body.ok, body.output);
      } catch (err) {
        console.error("[agent-actions] settle failed:", err);
      }
    }

    res.json({ ok: true });
  }),
);
