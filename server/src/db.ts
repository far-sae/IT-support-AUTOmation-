/**
 * Prisma client with a tenancy extension.
 *
 * Every query against a tenant-scoped model is silently filtered by
 * organizationId pulled from AsyncLocalStorage (see tenant/context.ts).
 * A missed `where: { organizationId }` in any route therefore cannot
 * leak cross-tenant data — the extension re-injects it at the DB layer.
 *
 *   • Reads (`findMany`, `findFirst`, `findUnique`, `count`, `aggregate`,
 *     `groupBy`)  → add `where: { organizationId }`.
 *   • Writes (`update`, `delete`, `updateMany`, `deleteMany`)
 *     → add `where: { organizationId }`. Prisma accepts non-unique
 *       fields alongside the unique key as additional AND filters,
 *       so an out-of-tenant id update simply matches no row → P2025.
 *   • `create` / `createMany` → inject `organizationId` into data
 *     (idempotent — routes that already set it stay correct).
 *   • `upsert` → inject into BOTH `where` and `create`.
 *
 * Bypass paths:
 *   • No context active (background scripts) → bypass.
 *   • `platformMode: true` → bypass (platform-admin endpoints opt in).
 *   • Non-tenant-scoped models (Organization, OrgInvite) → bypass.
 *
 * The args of `query` and the input objects are typed as discriminated
 * unions per model+operation; the extension treats them as opaque at the
 * boundary and casts back at the query call. The runtime branching above
 * makes that safe.
 */

import { PrismaClient } from "@prisma/client";
import { getTenantContext } from "./tenant/context.js";

const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

const TENANT_SCOPED_MODELS = new Set<string>([
  "User",
  "Ticket",
  "Comment",
  "Attachment",
  "SurveyResponse",
  "Device",
  "RemoteSession",
  "KbArticle",
  "ServiceComponent",
  "Incident",
  // Phase 7 — agent + telemetry
  "DeviceMetric",
  "AgentEnrollmentToken",
  // Phase 10A — auto-remediation
  "RunbookExecution",
  // Phase 10B — outcome learning
  "RemediationOutcome",
  // Phase 10C — agent-driven local actions
  "AgentAction",
  // Phase 11 — vector memory + daily brief
  "TicketEmbedding",
  "DailyBrief",
  // Phase 12 — detection
  "DetectionHit",
  // Phase 13 — workflows
  "WorkflowExecution",
  // WorkflowStepExecution belongs to a WorkflowExecution (cascaded org),
  // not tenant-direct — skipped.
  // Phase 16 — learned ML models
  "MlModel",
  // Phase 20 — per-attempt feature snapshots
  "RemediationAttempt",
  // Phase 25 — threat-intel matches (ThreatIntel itself is global, not scoped)
  "ThreatMatch",
  // Phase 26 — daily agentic defender runs
  "DefenderRun",
  // Phase 27 — sensor alerts + per-org generated rules
  // (AttackTechnique is global, not tenant-scoped)
  "SensorAlert",
  "GeneratedRule",
]);

interface AnyArgs {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: unknown;
}

function withWhere(args: AnyArgs | undefined, orgId: string): unknown {
  const a = args ?? {};
  return { ...a, where: { ...(a.where ?? {}), organizationId: orgId } };
}

function withDataOrg(args: AnyArgs | undefined, orgId: string): unknown {
  const a = args ?? {};
  if (Array.isArray(a.data)) {
    return {
      ...a,
      data: (a.data as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        organizationId: orgId,
      })),
    };
  }
  return {
    ...a,
    data: { ...((a.data as Record<string, unknown>) ?? {}), organizationId: orgId },
  };
}

export const prisma = basePrisma.$extends({
  name: "tenancy",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const ctx = getTenantContext();

        // No tenant context (boot scripts) OR explicit platform mode → bypass.
        if (!ctx || ctx.platformMode || !ctx.organizationId) {
          return query(args);
        }
        if (!TENANT_SCOPED_MODELS.has(model)) {
          return query(args);
        }

        const orgId = ctx.organizationId;
        const opaqueArgs = args as unknown as AnyArgs;
        const q = query as unknown as (a: unknown) => Promise<unknown>;

        switch (operation) {
          case "findUnique":
          case "findUniqueOrThrow":
          case "findFirst":
          case "findFirstOrThrow":
          case "findMany":
          case "count":
          case "aggregate":
          case "groupBy":
          case "update":
          case "delete":
          case "updateMany":
          case "deleteMany":
            return q(withWhere(opaqueArgs, orgId));

          case "create":
          case "createMany":
          case "createManyAndReturn":
            return q(withDataOrg(opaqueArgs, orgId));

          case "upsert": {
            const create = opaqueArgs.create as Record<string, unknown> | undefined;
            return q({
              ...opaqueArgs,
              where: { ...(opaqueArgs.where ?? {}), organizationId: orgId },
              create: { ...(create ?? {}), organizationId: orgId },
            });
          }

          default:
            // Unreachable per Prisma's current operation union, but kept
            // defensively in case future versions add new ops.
            return (query as unknown as (a: unknown) => Promise<unknown>)(args);
        }
      },
    },
  },
});

/**
 * Escape hatch for the rare places that need to bypass the extension
 * (loading the user during `requireAuth` before tenant context exists,
 * for example). Use sparingly.
 */
export const basePrismaUnscoped = basePrisma;
