/**
 * Phase 16 — Pure-TS logistic regression.
 *
 * Tiny batch gradient-descent trainer + sigmoid predictor. We deliberately
 * stay deps-free (no sklearn, no TensorFlow.js) because:
 *
 *   • Model lives in Postgres as JSON; nothing native to package.
 *   • The whole training set is small (RemediationOutcome rows per org,
 *     usually < 10k); a vectorised JS loop is fast enough.
 *   • This is one piece of an autopilot, not a research project — we want
 *     the model to be interpretable and rolling-deployable from a hot
 *     ts file edit.
 *
 * Model shape (the JSON we store on MlModel.weights):
 *
 *   {
 *     featureNames: ["bias", "feature_1", ...],
 *     weights:      [number, ...]   // includes bias as weights[0]
 *   }
 *
 * featureNames[0] is always "bias" and weights[0] is the intercept term.
 */

export interface TrainingExample {
  /** Numeric feature vector — same length + order as `featureNames` (minus the bias slot). */
  features: number[];
  label: 0 | 1;
}

export interface LogisticModel {
  featureNames: string[];   // ["bias", "feat1", "feat2", ...]
  weights: number[];        // weights[0] = bias
}

export interface TrainArgs {
  examples: TrainingExample[];
  featureNames: string[];   // WITHOUT the "bias" prefix; we add it
  epochs?:        number;
  learningRate?:  number;
  l2?:            number;   // ridge regularisation strength
}

export interface TrainResult {
  model: LogisticModel;
  metrics: {
    sampleCount: number;
    positiveCount: number;
    negativeCount: number;
    /** Train-set accuracy at threshold 0.5. */
    accuracy: number;
    /** Final mean log-loss. */
    logLoss: number;
    epochs: number;
  };
}

export function sigmoid(z: number): number {
  // Stable for large +z and small -z.
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Compute P(label=1 | features) using a trained model. */
export function predict(model: LogisticModel, features: number[]): number {
  // model.weights[0] is bias; remaining align to `features`.
  if (features.length !== model.weights.length - 1) {
    throw new Error(
      `feature/weight mismatch: features=${features.length}, weights=${model.weights.length - 1}`,
    );
  }
  let z = model.weights[0]!;
  for (let i = 0; i < features.length; i++) {
    z += model.weights[i + 1]! * features[i]!;
  }
  return sigmoid(z);
}

/**
 * Train a logistic-regression model with batch gradient descent.
 * Returns the trained model + summary metrics.
 */
export function train(args: TrainArgs): TrainResult {
  const { examples, featureNames } = args;
  const epochs       = args.epochs       ?? 200;
  const learningRate = args.learningRate ?? 0.1;
  const l2           = args.l2           ?? 0.01;

  if (examples.length === 0) {
    return {
      model: { featureNames: ["bias", ...featureNames], weights: new Array(featureNames.length + 1).fill(0) },
      metrics: { sampleCount: 0, positiveCount: 0, negativeCount: 0, accuracy: 0, logLoss: 0, epochs: 0 },
    };
  }

  const dim = featureNames.length;
  // Validate examples up-front so a bad row doesn't make training silently weird.
  for (const ex of examples) {
    if (ex.features.length !== dim) {
      throw new Error(`example feature length ${ex.features.length} != dim ${dim}`);
    }
  }

  // weights[0] = bias.
  const weights = new Array<number>(dim + 1).fill(0);
  const n = examples.length;
  let lastLoss = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Compute gradients across the whole batch.
    const grad = new Array<number>(dim + 1).fill(0);
    let loss = 0;
    for (const ex of examples) {
      let z = weights[0]!;
      for (let i = 0; i < dim; i++) z += weights[i + 1]! * ex.features[i]!;
      const p = sigmoid(z);
      // Cross-entropy (clipped to avoid log(0)).
      const clipped = Math.max(1e-9, Math.min(1 - 1e-9, p));
      loss += ex.label === 1 ? -Math.log(clipped) : -Math.log(1 - clipped);
      const err = p - ex.label;
      grad[0]! += err;
      for (let i = 0; i < dim; i++) {
        grad[i + 1]! += err * ex.features[i]!;
      }
    }
    // Average + L2 (don't regularise bias).
    for (let i = 0; i <= dim; i++) grad[i] = grad[i]! / n + (i === 0 ? 0 : l2 * weights[i]!);
    for (let i = 0; i <= dim; i++) weights[i] = weights[i]! - learningRate * grad[i]!;
    lastLoss = loss / n;
  }

  // Compute final accuracy.
  let correct = 0, positives = 0, negatives = 0;
  for (const ex of examples) {
    let z = weights[0]!;
    for (let i = 0; i < dim; i++) z += weights[i + 1]! * ex.features[i]!;
    const p = sigmoid(z);
    const predicted = p >= 0.5 ? 1 : 0;
    if (predicted === ex.label) correct++;
    if (ex.label === 1) positives++; else negatives++;
  }

  return {
    model: { featureNames: ["bias", ...featureNames], weights },
    metrics: {
      sampleCount: n,
      positiveCount: positives,
      negativeCount: negatives,
      accuracy: correct / n,
      logLoss: lastLoss,
      epochs,
    },
  };
}
