import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

// Anthropic SDK might not be needed but env loads it. Set the model before import.
process.env.GITHUB_TOKEN = "ghp_fake_token_xyz";

const { dispatchWorkflow, parseRepoSlug } = await import("./github.js");

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => { delete (global as { fetch?: typeof fetch }).fetch; });

describe("parseRepoSlug", () => {
  it("parses owner/repo", () => {
    expect(parseRepoSlug("acme/relay-runbooks")).toEqual({ owner: "acme", repo: "relay-runbooks" });
  });
  it("rejects bad slugs", () => {
    expect(parseRepoSlug("nope")).toBeNull();
    expect(parseRepoSlug("a/b/c")).toBeNull();
    expect(parseRepoSlug(undefined)).toBeNull();
    expect(parseRepoSlug("")).toBeNull();
  });
});

describe("dispatchWorkflow", () => {
  it("POSTs to GitHub with the right URL and headers, returns ok on 204", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, text: async () => "" } as Response);
    const r = await dispatchWorkflow({
      owner: "acme", repo: "relay-runbooks", workflowFile: "relay-action.yml",
      ref: "main", inputs: { ticket: "INC-1042" },
    });
    expect(r.ok).toBe(true);
    expect(r.statusCode).toBe(204);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/relay-runbooks/actions/workflows/relay-action.yml/dispatches",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer ghp_fake_token_xyz",
          Accept: "application/vnd.github+json",
        }),
      }),
    );
    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(call[1].body)).toEqual({ ref: "main", inputs: { ticket: "INC-1042" } });
  });

  it("returns ok=false on non-204", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, text: async () => "validation failed" } as Response);
    const r = await dispatchWorkflow({
      owner: "acme", repo: "relay-runbooks", workflowFile: "relay-action.yml",
    });
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(422);
    expect(r.output).toMatch(/422/);
  });

  it("returns ok=false when network fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    const r = await dispatchWorkflow({
      owner: "acme", repo: "relay-runbooks", workflowFile: "relay-action.yml",
    });
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/Network error/);
  });
});
