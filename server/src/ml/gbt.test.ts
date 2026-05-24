import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const { train, predict } = await import("./gbt.js");
import type { TrainingExample } from "./gbt.js";

describe("GBT — predict", () => {
  it("respects a single-stump model", () => {
    const model = {
      kind: "gbt" as const,
      featureNames: ["x"],
      bias: 0,
      stumps: [{ feature: 0, threshold: 0.5, left: -1, right: 1 }],
    };
    expect(predict(model, [0.3])).toBeLessThan(0.5);
    expect(predict(model, [0.7])).toBeGreaterThan(0.5);
  });

  it("throws on feature/model dimension mismatch", () => {
    const model = { kind: "gbt" as const, featureNames: ["x"], bias: 0, stumps: [] };
    expect(() => predict(model, [1, 2])).toThrow(/mismatch/);
  });
});

describe("GBT — train", () => {
  it("learns linearly separable y = x > 0.5", () => {
    const examples: TrainingExample[] = [];
    for (let i = 0; i < 80; i++) {
      const x = Math.random();
      examples.push({ features: [x], label: x > 0.5 ? 1 : 0 });
    }
    const r = train({
      examples, featureNames: ["x"], nEstimators: 60, learningRate: 0.2,
    });
    expect(r.metrics.accuracy).toBeGreaterThan(0.85);
    expect(r.model.stumps.length).toBeGreaterThan(0);
    expect(predict(r.model, [0.9])).toBeGreaterThan(0.7);
    expect(predict(r.model, [0.1])).toBeLessThan(0.3);
  });

  it("learns a piecewise step function (0.3 < x < 0.7 → 1) that captures non-monotonicity", () => {
    // Stumps are additive, so they can't do XOR. They CAN combine to model
    // a "band" function — two stumps with opposite contributions on the
    // outer edges + a positive middle.
    const examples: TrainingExample[] = [];
    for (let i = 0; i < 200; i++) {
      const x = Math.random();
      examples.push({ features: [x], label: (x > 0.3 && x < 0.7) ? 1 : 0 });
    }
    const r = train({
      examples, featureNames: ["x"], nEstimators: 80, learningRate: 0.2,
    });
    expect(r.metrics.accuracy).toBeGreaterThan(0.8);
    // Inside band → high, outside → low.
    expect(predict(r.model, [0.5])).toBeGreaterThan(0.6);
    expect(predict(r.model, [0.05])).toBeLessThan(0.4);
    expect(predict(r.model, [0.95])).toBeLessThan(0.4);
  });

  it("returns a zeroed model on empty input", () => {
    const r = train({ examples: [], featureNames: ["a", "b"] });
    expect(r.model.stumps).toEqual([]);
    expect(r.metrics.sampleCount).toBe(0);
  });

  it("rejects examples whose feature length doesn't match dim", () => {
    expect(() => train({
      examples: [{ features: [1, 2, 3], label: 1 }],
      featureNames: ["a"],
    })).toThrow(/dim/);
  });

  it("stops early when the log-loss floor is hit", () => {
    // Two trivially separable classes + high LR — should bottom out at the
    // floor stop condition (loss < 0.05) well before nEstimators.
    const examples: TrainingExample[] = [
      ...Array.from({ length: 30 }, () => ({ features: [0], label: 0 as const })),
      ...Array.from({ length: 30 }, () => ({ features: [1], label: 1 as const })),
    ];
    const r = train({ examples, featureNames: ["x"], nEstimators: 200, learningRate: 1.0 });
    expect(r.metrics.rounds).toBeLessThan(50);
    expect(r.metrics.accuracy).toBeGreaterThanOrEqual(0.99);
  });
});
