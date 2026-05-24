/**
 * Phase 20 — Adapter for the Python ML sidecar.
 *
 * When `ML_SIDECAR_URL` is set, the trainer POSTs feature batches to the
 * sidecar and stores the returned `model_id` instead of TS-native weights.
 * Inference then POSTs each feature vector to /predict.
 *
 * Sidecar absence is fine — the trainer falls back to the pure-TS GBT.
 */

import { env } from "../env.js";

export function sidecarEnabled(): boolean {
  return Boolean(env.ML_SIDECAR_URL);
}

export interface SidecarTrainExample {
  features: number[];
  label: 0 | 1;
}

export interface SidecarTrainResult {
  modelId: string;
  metrics: {
    sample_count: number;
    positive_count: number;
    negative_count: number;
    accuracy: number;
    log_loss: number;
    framework: string;
  };
}

export async function sidecarTrain(
  featureNames: string[], examples: SidecarTrainExample[],
): Promise<SidecarTrainResult> {
  if (!env.ML_SIDECAR_URL) throw new Error("ML_SIDECAR_URL not set");
  const url = `${env.ML_SIDECAR_URL.replace(/\/$/, "")}/train`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      feature_names: featureNames,
      examples,
      max_iter: 100,
      learning_rate: 0.1,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`ML sidecar /train ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as { model_id: string; metrics: SidecarTrainResult["metrics"] };
  return { modelId: json.model_id, metrics: json.metrics };
}

export async function sidecarPredict(modelId: string, features: number[]): Promise<number> {
  if (!env.ML_SIDECAR_URL) throw new Error("ML_SIDECAR_URL not set");
  const url = `${env.ML_SIDECAR_URL.replace(/\/$/, "")}/predict`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: modelId, features }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`ML sidecar /predict ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as { probability: number };
  return json.probability;
}
