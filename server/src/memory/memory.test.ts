import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const { embed, cosine } = await import("./embeddings.js");

describe("local hashed embeddings", () => {
  it("produces a 256-dim L2-normalised vector", () => {
    const v = embed("Outlook keeps crashing on my laptop");
    expect(v.length).toBe(256);
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it("is deterministic", () => {
    const a = embed("My disk is full and the laptop is slow");
    const b = embed("My disk is full and the laptop is slow");
    expect(a).toEqual(b);
  });

  it("two similar tickets have higher cosine than two unrelated ones", () => {
    const a = embed("Outlook keeps crashing on launch every morning");
    const b = embed("Outlook crashes whenever I open my mailbox");
    const c = embed("I need to install Slack on my new laptop");
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });

  it("empty input doesn't blow up", () => {
    const v = embed("");
    expect(v.length).toBe(256);
    // All zeros — norm is 0, cosine with anything else is 0.
    expect(cosine(v, embed("anything"))).toBe(0);
  });
});
