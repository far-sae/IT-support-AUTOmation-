/**
 * Phase 16 — Inference path for the remediation classifier.
 *
 * `predictSuccess(args)` returns P(success) for the (ticket, runbook,
 * history) combination using the org's currently-active MlModel row.
 *
 * Result is intentionally **optional** — when no model exists yet (cold
 * start, brand-new tenant) the function returns `null` and the caller
 * falls back to the heuristic weighting from learning/store.ts.
 *
 * Models are cached in-process for 5 minutes per (orgId, modelKey) so
 * inference is sub-millisecond on the hot path.
 */

import type { Ticket } from "@prisma/client";
import { prisma } from "../db.js";
import type { RunbookRiskLevel } from "../runbooks/types.js";
import { extractFeatures, FEATURE_NAMES } from "./features.js";
import { predict as predictLogistic, type LogisticModel } from "./logistic.js";
import { predict as predictGbt, type GbtModel } from "./gbt.js";
import { REMEDIATION_MODEL_KEY } from "./trainer.js";

// A stored model can be either logistic (Phase 16) or gbt (Phase 20).
// We dispatch on `kind` — older logistic models have no `kind` field, so we
// treat absence as logistic.
type StoredModel = LogisticModel | GbtModel;

function isGbt(m: StoredModel): m is GbtModel {
  return (m as GbtModel).kind === "gbt";
}

interface CacheEntry {
  model: StoredModel | null;
  loadedAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

function cacheKey(organizationId: string, modelKey: string): string {
  return `${organizationId}|${modelKey}`;
}

export function invalidateModelCache(organizationId?: string): void {
  if (!organizationId) { CACHE.clear(); return; }
  for (const k of CACHE.keys()) {
    if (k.startsWith(`${organizationId}|`)) CACHE.delete(k);
  }
}

async function loadActiveModel(organizationId: string): Promise<StoredModel | null> {
  const key = cacheKey(organizationId, REMEDIATION_MODEL_KEY);
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.loadedAt < TTL_MS) return cached.model;

  const row = await prisma.mlModel.findFirst({
    where: { modelKey: REMEDIATION_MODEL_KEY, active: true },
    orderBy: { version: "desc" },
  });
  const model = row ? (row.weights as unknown as StoredModel) : null;
  CACHE.set(key, { model, loadedAt: Date.now() });
  return model;
}

export interface PredictArgs {
  organizationId: string;
  ticket: Pick<Ticket, "priority" | "category" | "createdAt">;
  runbook: { risk: RunbookRiskLevel };
  matchConfidence: number;
  history: { successes: number; failures: number };
  now?: Date;
}

/**
 * Returns P(success | features) in [0, 1] when an active model exists for
 * the org, otherwise `null` — caller falls back to the heuristic.
 *
 * Gracefully handles dimension mismatch (an old model trained before a
 * feature was added) by returning `null` rather than throwing.
 */
export async function predictSuccess(args: PredictArgs): Promise<number | null> {
  const model = await loadActiveModel(args.organizationId);
  if (!model) return null;

  const features = extractFeatures({
    ticket: args.ticket,
    runbook: args.runbook,
    matchConfidence: args.matchConfidence,
    history: args.history,
    now: args.now,
  });

  try {
    if (isGbt(model)) {
      if (features.length !== model.featureNames.length) {
        invalidateModelCache(args.organizationId);
        return null;
      }
      return predictGbt(model, features);
    }
    // Logistic: weights[0] is bias, so the feature dim is weights.length - 1.
    if (features.length !== model.weights.length - 1) {
      invalidateModelCache(args.organizationId);
      return null;
    }
    if (FEATURE_NAMES.length !== model.weights.length - 1) {
      return null;
    }
    return predictLogistic(model, features);
  } catch {
    return null;
  }
}

// ─── Phase 20 — per-attempt feature logging ───────────────────────────

export interface AttemptLogArgs {
  organizationId: string;
  ticketId: string | null;
  runbookExecutionId: string | null;
  runbookKey: string;
  features: number[];
  /** 1 = SUCCEEDED, 0 = FAILED. Any other outcome is excluded. */
  label: 0 | 1;
}

/**
 * Append one labelled training example to RemediationAttempt. Called from
 * the runbook engine when an execution finalises with a clear outcome.
 * Fire-and-forget; a logging failure must NOT break the runbook flow.
 */
export async function logRemediationAttempt(args: AttemptLogArgs): Promise<void> {
  try {
    await prisma.remediationAttempt.create({
      data: {
        organizationId:     args.organizationId,
        ticketId:           args.ticketId ?? null,
        runbookExecutionId: args.runbookExecutionId ?? null,
        runbookKey:         args.runbookKey,
        featureNames:       FEATURE_NAMES as unknown as object,
        features:           args.features as unknown as object,
        label:              args.label,
      },
    });
  } catch (err) {
    console.error("[ml] remediation-attempt log failed:", (err as Error).message);
  }
}
