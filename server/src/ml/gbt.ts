/**
 * Phase 20 — Gradient Boosted Decision Stumps (pure-TS).
 *
 * Replaces the logistic-regression baseline for tabular tickets / runbook /
 * device features. Stumps are 1-split decision trees — small enough to keep
 * the model JSON serialisable in Postgres, expressive enough to capture
 * non-linear interactions that the logistic model couldn't.
 *
 * Algorithm:
 *   • Predict the logit of P(y=1) as a sum of stumps.
 *   • Each stump greedily picks (feature, threshold) that maximally reduces
 *     the squared-error of the current residuals.
 *   • Shrink the stump's contribution by learningRate (typ. 0.1) before
 *     adding it to the model — classic Friedman gradient boosting.
 *   • Stop after `nEstimators` rounds or when log-loss plateaus.
 *
 * Model JSON shape:
 *   { kind: "gbt",
 *     featureNames: [...],
 *     bias: 0.12,
 *     stumps: [{ feature: 4, threshold: 0.5, left: -0.3, right: 0.4 }, ...] }
 *
 * Inference: sum bias + each matching stump's contribution → sigmoid.
 */

export interface TrainingExample {
  features: number[];
  label: 0 | 1;
}

export interface Stump {
  feature: number;     // index into the feature vector
  threshold: number;   // value > threshold → right branch
  left: number;        // contribution (logit) on the left branch
  right: number;       // contribution (logit) on the right branch
}

export interface GbtModel {
  kind: "gbt";
  featureNames: string[];
  /** Constant term (initialised from base-rate log-odds). */
  bias: number;
  stumps: Stump[];
}

export interface GbtTrainArgs {
  examples: TrainingExample[];
  featureNames: string[];
  /** How many boosting rounds. Default 50. */
  nEstimators?: number;
  /** Shrinkage. Smaller = more rounds, less overfit. Default 0.1. */
  learningRate?: number;
  /** Candidate split count per feature. Default 16. */
  splitCandidates?: number;
}

export interface GbtTrainResult {
  model: GbtModel;
  metrics: {
    sampleCount: number;
    positiveCount: number;
    negativeCount: number;
    accuracy: number;
    logLoss: number;
    rounds: number;
  };
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Sum the bias + every matching stump's contribution for one feature row. */
function rawScore(model: { bias: number; stumps: Stump[] }, features: number[]): number {
  let z = model.bias;
  for (const s of model.stumps) {
    const v = features[s.feature];
    z += v !== undefined && v > s.threshold ? s.right : s.left;
  }
  return z;
}

export function predict(model: GbtModel, features: number[]): number {
  if (features.length !== model.featureNames.length) {
    throw new Error(`feature/model mismatch: features=${features.length}, model=${model.featureNames.length}`);
  }
  return sigmoid(rawScore(model, features));
}

/**
 * Find the (feature, threshold) split that minimises squared-error of
 * residuals. Returns null if no split beats `0` (i.e. residuals already balanced).
 */
function bestSplit(
  X: number[][], residuals: number[], dim: number, splitCandidates: number,
): { feature: number; threshold: number; leftMean: number; rightMean: number; gain: number } | null {
  const n = X.length;
  let best: ReturnType<typeof bestSplit> = null;

  for (let f = 0; f < dim; f++) {
    // Collect unique values for this feature.
    const vals = X.map((row) => row[f]!).sort((a, b) => a - b);
    if (vals.length === 0) continue;
    const lo = vals[0]!, hi = vals[vals.length - 1]!;
    if (lo === hi) continue;

    const step = (hi - lo) / (splitCandidates + 1);
    for (let s = 1; s <= splitCandidates; s++) {
      const threshold = lo + step * s;
      let leftSum = 0, leftN = 0, rightSum = 0, rightN = 0;
      for (let i = 0; i < n; i++) {
        if (X[i]![f]! > threshold) {
          rightSum += residuals[i]!;
          rightN++;
        } else {
          leftSum += residuals[i]!;
          leftN++;
        }
      }
      if (leftN === 0 || rightN === 0) continue;
      const leftMean  = leftSum / leftN;
      const rightMean = rightSum / rightN;
      // Reduction in squared error from the constant-mean baseline.
      const meanAll = (leftSum + rightSum) / n;
      let ssBefore = 0;
      let ssAfter  = 0;
      for (let i = 0; i < n; i++) {
        const r = residuals[i]!;
        ssBefore += (r - meanAll) ** 2;
        ssAfter  += X[i]![f]! > threshold ? (r - rightMean) ** 2 : (r - leftMean) ** 2;
      }
      const gain = ssBefore - ssAfter;
      if (!best || gain > best.gain) {
        best = { feature: f, threshold, leftMean, rightMean, gain };
      }
    }
  }
  return best;
}

export function train(args: GbtTrainArgs): GbtTrainResult {
  const { examples, featureNames } = args;
  const nEstimators    = args.nEstimators    ?? 50;
  const learningRate   = args.learningRate   ?? 0.1;
  const splitCandidates = args.splitCandidates ?? 16;

  if (examples.length === 0) {
    return {
      model: { kind: "gbt", featureNames, bias: 0, stumps: [] },
      metrics: { sampleCount: 0, positiveCount: 0, negativeCount: 0, accuracy: 0, logLoss: 0, rounds: 0 },
    };
  }

  const dim = featureNames.length;
  for (const ex of examples) {
    if (ex.features.length !== dim) {
      throw new Error(`example feature length ${ex.features.length} != dim ${dim}`);
    }
  }

  const X = examples.map((e) => e.features);
  const y: number[] = examples.map((e) => e.label);
  const n = X.length;

  // Initial bias = log-odds of positive rate (best constant prediction).
  const positives = y.reduce((a, b) => a + b, 0);
  const negatives = n - positives;
  const p0 = positives / n;
  const bias = Math.log(Math.max(1e-9, p0) / Math.max(1e-9, 1 - p0));

  const stumps: Stump[] = [];
  let logLossPrev = Infinity;
  let roundsRun = 0;

  for (let round = 0; round < nEstimators; round++) {
    // Residuals: y - σ(current score). This is the gradient of logistic loss.
    const residuals: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = sigmoid(rawScore({ bias, stumps }, X[i]!));
      residuals[i] = y[i]! - p;
    }
    const split = bestSplit(X, residuals, dim, splitCandidates);
    if (!split || split.gain <= 1e-6) break;

    stumps.push({
      feature: split.feature,
      threshold: split.threshold,
      left:  learningRate * split.leftMean,
      right: learningRate * split.rightMean,
    });
    roundsRun = round + 1;

    // Track log-loss for early-stopping.
    let loss = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(rawScore({ bias, stumps }, X[i]!));
      const clipped = Math.max(1e-9, Math.min(1 - 1e-9, p));
      loss += y[i] === 1 ? -Math.log(clipped) : -Math.log(1 - clipped);
    }
    loss /= n;
    // Two stop conditions:
    //   1. Plateau: log-loss didn't improve by ≥ 0.5% of the previous value.
    //   2. Floor: absolute log-loss already below 0.05 (near-perfect fit;
    //      further rounds would just chase asymptotic residuals).
    const relThreshold = Math.max(1e-5, logLossPrev * 0.005);
    if (loss > logLossPrev - relThreshold) break;
    if (loss < 0.05) { logLossPrev = loss; break; }
    logLossPrev = loss;
  }

  // Final accuracy + log-loss on training set.
  let correct = 0, lossFinal = 0;
  const model: GbtModel = { kind: "gbt", featureNames, bias, stumps };
  for (let i = 0; i < n; i++) {
    const p = predict(model, X[i]!);
    if ((p >= 0.5 ? 1 : 0) === y[i]) correct++;
    const clipped = Math.max(1e-9, Math.min(1 - 1e-9, p));
    lossFinal += y[i] === 1 ? -Math.log(clipped) : -Math.log(1 - clipped);
  }
  return {
    model,
    metrics: {
      sampleCount: n,
      positiveCount: positives,
      negativeCount: negatives,
      accuracy: correct / n,
      logLoss: lossFinal / n,
      rounds: roundsRun,
    },
  };
}
