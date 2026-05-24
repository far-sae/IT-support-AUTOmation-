/**
 * Phase 16 — Training pipeline for the remediation classifier.
 *
 * Reads every `RemediationOutcome` row in the org, expands it into
 * (success_count) positive + (failure_count) negative training examples,
 * trains a logistic regression model, and writes a new `MlModel` row.
 *
 * Each RemediationOutcome stores aggregate counts — we synthesise one
 * example per count rather than re-replaying every historical attempt
 * (which would need a per-attempt log we don't keep). The signature
 * encodes the ticket pattern; we recover priority/category from the
 * signature's category prefix + a sensible default (we lose per-attempt
 * priority detail in aggregation — acceptable for v1).
 *
 * Training is idempotent: each run inserts a new version + marks it active,
 * deactivating the previous active version. Old rows stay for audit.
 */

import { basePrismaUnscoped, prisma } from "../db.js";
import { runWithTenant } from "../tenant/context.js";
import { getRunbook } from "../runbooks/registry.js";
import { extractFeatures, FEATURE_NAMES } from "./features.js";
import { train, type TrainingExample, type TrainResult } from "./logistic.js";
import { train as trainGbt, type GbtTrainResult } from "./gbt.js";
import { env } from "../env.js";

export const REMEDIATION_MODEL_KEY = "remediation_classifier";

export interface TrainOrgResult {
  organizationId: string;
  version: number;
  modelKind: "logistic" | "gbt";
  metrics: TrainResult["metrics"] | GbtTrainResult["metrics"];
}

/**
 * Train the remediation classifier for a single org. Returns null when
 * there isn't enough data (need both positives + negatives).
 */
export async function trainRemediationModel(organizationId: string): Promise<TrainOrgResult | null> {
  return runWithTenant(organizationId, async () => {
    // Phase 20: prefer per-attempt features (real per-attempt rows with the
    // exact feature vector + label), fall back to aggregate counts only if
    // we don't have enough per-attempt data yet.
    const attempts = await prisma.remediationAttempt.findMany({
      orderBy: { recordedAt: "desc" }, take: 10_000,
    });

    let examples: TrainingExample[];
    if (attempts.length >= 50) {
      // Per-attempt path — the feature vectors are already stored.
      examples = attempts
        .map((a) => {
          const features = a.features as unknown as number[];
          if (!Array.isArray(features) || features.length !== FEATURE_NAMES.length) return null;
          return { features, label: a.label === 1 ? 1 : 0 } as TrainingExample;
        })
        .filter((x): x is TrainingExample => x !== null);
    } else {
      // Aggregate-history fallback (Phase 16 behaviour).
      const outcomes = await prisma.remediationOutcome.findMany({
        orderBy: { updatedAt: "desc" }, take: 5000,
      });
      if (outcomes.length === 0) return null;
      examples = [];
      for (const o of outcomes) {
        const rb = getRunbook(o.runbookKey);
        if (!rb) continue;
        const parts = o.signature.split("|");
        const category = parts[0] ?? "Other";
        const features = extractFeatures({
          ticket: { priority: "Medium", category, createdAt: o.updatedAt } as Parameters<typeof extractFeatures>[0]["ticket"],
          runbook: { risk: rb.risk },
          matchConfidence: 0.6,
          history: { successes: 0, failures: 0 },
        });
        for (let s = 0; s < o.successes; s++) examples.push({ features, label: 1 });
        for (let f = 0; f < o.failures + o.escalations; f++) examples.push({ features, label: 0 });
      }
    }

    const positives = examples.filter((e) => e.label === 1).length;
    const negatives = examples.length - positives;
    if (positives < 3 || negatives < 3) return null;

    // Pick model family: GBT for richer data (per-attempt), logistic
    // otherwise. Or honour the env override.
    const family = env.ML_FAMILY === "logistic" ? "logistic"
                 : env.ML_FAMILY === "gbt"      ? "gbt"
                 : examples.length >= 50         ? "gbt"
                 :                                  "logistic";

    let modelJson: object;
    let metrics: TrainResult["metrics"] | GbtTrainResult["metrics"];
    if (family === "gbt") {
      const r = trainGbt({
        examples, featureNames: [...FEATURE_NAMES],
        nEstimators: 60, learningRate: 0.1, splitCandidates: 16,
      });
      modelJson = r.model as unknown as object;
      metrics = r.metrics;
    } else {
      const r = train({
        examples, featureNames: [...FEATURE_NAMES],
        epochs: 200, learningRate: 0.1, l2: 0.01,
      });
      modelJson = r.model as unknown as object;
      metrics = r.metrics;
    }

    // Bump version + flip active flag.
    const last = await prisma.mlModel.findFirst({
      where: { modelKey: REMEDIATION_MODEL_KEY },
      orderBy: { version: "desc" }, select: { version: true },
    });
    const nextVersion = (last?.version ?? 0) + 1;
    await prisma.mlModel.updateMany({
      where: { modelKey: REMEDIATION_MODEL_KEY, active: true },
      data: { active: false },
    });
    await prisma.mlModel.create({
      data: {
        organizationId,
        modelKey: REMEDIATION_MODEL_KEY,
        version: nextVersion,
        active: true,
        weights: modelJson,
        metrics: { ...metrics, modelKind: family } as unknown as object,
      },
    });

    return { organizationId, version: nextVersion, modelKind: family, metrics };
  });
}

/** Train every non-platform org. Used by the cron + admin route. */
export async function trainAllOrgs(): Promise<TrainOrgResult[]> {
  const orgs = await basePrismaUnscoped.organization.findMany({
    where: { slug: { not: "platform" }, suspendedAt: null },
    select: { id: true },
  });
  const results: TrainOrgResult[] = [];
  for (const o of orgs) {
    try {
      const r = await trainRemediationModel(o.id);
      if (r) results.push(r);
    } catch (err) {
      console.error(`[ml] training failed for ${o.id}:`, err);
    }
  }
  return results;
}
