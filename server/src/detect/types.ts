/**
 * Phase 12 — Sigma-style detection rule typings.
 *
 * Rules are pure TypeScript objects, not YAML (we're not parsing arbitrary
 * Sigma YAML — the threat model is internal tickets, not raw logs). Each
 * rule declares a name + severity + a `detect()` that reads recent activity
 * and emits zero-or-more `DetectionMatch` records.
 *
 * The engine dedupes by (organizationId, ruleKey, windowStart) so the same
 * burst doesn't pile up new hits each tick.
 */

import type { Prisma } from "@prisma/client";

export type DetectionSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface DetectionMatch {
  /** Aligned bucket start used for deduping the hit. */
  windowStart: Date;
  windowEnd:   Date;
  /** How many underlying things matched (tickets, failed runs, etc.). */
  count:       number;
  /** JSON-safe payload describing what triggered the rule. */
  evidence:    Record<string, unknown>;
}

/**
 * Minimal Prisma surface the built-in rules touch. Using a structural
 * interface (rather than the extended client type) lets tests pass a tiny
 * stub without battling the Prisma `$extends` types.
 *
 * If you add a rule that needs a new model: add it here AND extend the
 * `makePrisma` helper in detect.test.ts.
 */
export interface DetectionPrisma {
  ticket: {
    findMany: (args: unknown) => Promise<Array<{
      id: string; refCode: string; description: string; submitterEmail: string;
      category?: string; priority?: string;
    }>>;
    count: (args: unknown) => Promise<number>;
  };
  runbookExecution: {
    groupBy: (args: unknown) => Promise<Array<{ runbookKey: string; _count: { _all: number } }>>;
    count: (args: unknown) => Promise<number>;
  };
  device: {
    count: (args: unknown) => Promise<number>;
    findMany: (args: unknown) => Promise<Array<{ hostname: string; agentVersion?: string | null; lastCheckInAt?: Date | null }>>;
  };
  // Phase 19 additions:
  user: {
    findMany: (args: unknown) => Promise<Array<{ email: string; name: string; createdAt: Date }>>;
  };
  agentAction: {
    groupBy: (args: unknown) => Promise<Array<{ status: string; _count: { _all: number } }>>;
  };
  workflowExecution: {
    count: (args: unknown) => Promise<number>;
    findMany: (args: unknown) => Promise<Array<{ id: string; workflowKey: string; status: string }>>;
  };
}

export interface DetectRuleContext {
  organizationId: string;
  /** Tenant-extended prisma client — already filters by org. */
  prisma: DetectionPrisma;
  /** `now` is supplied by the engine; tests can pin it. */
  now: Date;
}

export interface DetectionRule {
  key: string;
  name: string;
  description: string;
  severity: DetectionSeverity;
  /** Time bucket size (minutes). Engine aligns windows to this. */
  windowMinutes: number;
  /** Returns 0..n matches for the current bucket. */
  detect: (ctx: DetectRuleContext) => Promise<DetectionMatch[]>;
}

/** Helper — align a Date down to the nearest `windowMinutes` boundary. */
export function alignWindowStart(now: Date, windowMinutes: number): Date {
  const ms = windowMinutes * 60 * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/** Re-export Prisma's Json type for convenience in rule files. */
export type Json = Prisma.JsonValue;
