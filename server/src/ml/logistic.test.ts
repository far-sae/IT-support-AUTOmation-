import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const { sigmoid, predict, train } = await import("./logistic.js");
import type { TrainingExample } from "./logistic.js";

describe("sigmoid", () => {
  it("σ(0) = 0.5", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 6);
  });
  it("σ(large positive) ≈ 1", () => {
    expect(sigmoid(20)).toBeGreaterThan(0.999);
  });
  it("σ(large negative) ≈ 0", () => {
    expect(sigmoid(-20)).toBeLessThan(0.001);
  });
});

describe("train", () => {
  it("learns a linearly separable 1-D pattern", () => {
    // y=1 iff x > 0.5. Generate samples both sides.
    const examples: TrainingExample[] = [];
    for (let i = 0; i < 50; i++) {
      const x = Math.random();
      examples.push({ features: [x], label: x > 0.5 ? 1 : 0 });
    }
    const result = train({
      examples, featureNames: ["x"], epochs: 300, learningRate: 0.5, l2: 0,
    });
    expect(result.metrics.accuracy).toBeGreaterThan(0.85);
    expect(result.model.weights).toHaveLength(2); // bias + 1 feat
    // weights[1] should be positive (larger x → more likely 1).
    expect(result.model.weights[1]).toBeGreaterThan(0);
  });

  it("returns a zeroed model on zero examples", () => {
    const r = train({ examples: [], featureNames: ["a", "b"] });
    expect(r.model.weights).toEqual([0, 0, 0]);
    expect(r.metrics.sampleCount).toBe(0);
  });

  it("the predict() helper agrees with what train() produces", () => {
    const examples: TrainingExample[] = [
      { features: [0, 0], label: 0 },
      { features: [0, 1], label: 1 },
      { features: [1, 0], label: 1 },
      { features: [1, 1], label: 1 },
      { features: [0.1, 0.1], label: 0 },
      { features: [0.9, 0.9], label: 1 },
    ];
    const r = train({ examples, featureNames: ["a", "b"], epochs: 300, learningRate: 0.5 });
    expect(predict(r.model, [1, 1])).toBeGreaterThan(0.7);
    expect(predict(r.model, [0, 0])).toBeLessThan(0.3);
  });

  it("rejects examples whose feature length doesn't match the dim", () => {
    expect(() => train({
      examples: [{ features: [1, 2, 3], label: 1 }],
      featureNames: ["a"], // dim=1, example has 3
    })).toThrow(/dim/);
  });
});

describe("predict — dimension guard", () => {
  it("throws on wrong feature length", () => {
    const model = { featureNames: ["bias", "a"], weights: [0, 1] };
    expect(() => predict(model, [1, 2])).toThrow(/mismatch/);
  });
});
