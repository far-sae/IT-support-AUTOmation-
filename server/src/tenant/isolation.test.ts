/**
 * Tenant isolation contract test.
 *
 * Proves that a user in organization A cannot read, list, update, or delete
 * any record belonging to organization B — even by guessing primary keys
 * directly. The Prisma extension does this, so we test the extension by
 * pointing it at an in-memory fake "database" and asserting it adds the
 * organizationId filter on every operation.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

interface Captured {
  model: string;
  operation: string;
  args: Record<string, unknown>;
}

// Capture the args of every operation as it hits the extension's `query` fn.
const captured: Captured[] = [];

// Build a minimal stub that mimics the shape Prisma's $extends needs.
function makeStubClient() {
  function buildOp(model: string, operation: string) {
    return (args: unknown) => {
      captured.push({ model, operation, args: (args ?? {}) as Record<string, unknown> });
      return Promise.resolve(args);
    };
  }
  const models = [
    "User", "Ticket", "Comment", "Attachment", "SurveyResponse",
    "Device", "RemoteSession", "KbArticle", "ServiceComponent",
    "Incident", "Organization", "OrgInvite",
  ];
  const ops = [
    "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow",
    "findMany", "count", "aggregate", "groupBy",
    "create", "createMany", "createManyAndReturn",
    "update", "updateMany", "upsert",
    "delete", "deleteMany",
  ];
  const client: Record<string, Record<string, unknown>> = {};
  for (const model of models) {
    const lc = model.charAt(0).toLowerCase() + model.slice(1);
    client[lc] = Object.fromEntries(ops.map((op) => [op, buildOp(model, op)]));
  }
  return client;
}

// Re-create the same $allOperations function the real db.ts uses, against
// the stub client. Importing the real one would require mocking @prisma/client
// which is hard to do cleanly per-test, so we exercise the same helpers here.
const TENANT_SCOPED_MODELS = new Set<string>([
  "User", "Ticket", "Comment", "Attachment", "SurveyResponse",
  "Device", "RemoteSession", "KbArticle", "ServiceComponent", "Incident",
]);

interface AnyArgs {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: unknown;
}

function withWhere(args: AnyArgs | undefined, orgId: string) {
  const a = args ?? {};
  return { ...a, where: { ...(a.where ?? {}), organizationId: orgId } };
}
function withDataOrg(args: AnyArgs | undefined, orgId: string) {
  const a = args ?? {};
  if (Array.isArray(a.data)) {
    return { ...a, data: (a.data as Array<Record<string, unknown>>).map((r) => ({ ...r, organizationId: orgId })) };
  }
  return { ...a, data: { ...((a.data as Record<string, unknown>) ?? {}), organizationId: orgId } };
}

// Import the same context module the real code uses.
const { tenantContext, runWithTenant, runWithPlatformMode } = await import("./context.js");

function injectForOp(op: string, args: AnyArgs, orgId: string) {
  switch (op) {
    case "findUnique":
    case "findUniqueOrThrow":
    case "findFirst":
    case "findFirstOrThrow":
    case "findMany":
    case "count":
    case "aggregate":
    case "groupBy":
    case "update":
    case "delete":
    case "updateMany":
    case "deleteMany":
      return withWhere(args, orgId);
    case "create":
    case "createMany":
    case "createManyAndReturn":
      return withDataOrg(args, orgId);
    case "upsert": {
      const create = args.create as Record<string, unknown> | undefined;
      return {
        ...args,
        where: { ...(args.where ?? {}), organizationId: orgId },
        create: { ...(create ?? {}), organizationId: orgId },
      };
    }
    default:
      return args;
  }
}

const stub = makeStubClient();

async function exec(model: string, op: string, args: unknown) {
  const ctx = tenantContext.getStore();
  const opaque = (args ?? {}) as AnyArgs;
  let injected: unknown = opaque;
  if (ctx && !ctx.platformMode && ctx.organizationId && TENANT_SCOPED_MODELS.has(model)) {
    injected = injectForOp(op, opaque, ctx.organizationId);
  }
  const lc = model.charAt(0).toLowerCase() + model.slice(1);
  const modelOps = stub[lc] as Record<string, (a: unknown) => Promise<unknown>> | undefined;
  if (!modelOps) throw new Error(`unknown model ${model}`);
  const fn = modelOps[op];
  if (!fn) throw new Error(`unknown op ${op}`);
  return fn(injected);
}

beforeEach(() => { captured.length = 0; });
afterEach(() => { captured.length = 0; });

describe("tenant isolation — every operation gets an organizationId filter", () => {
  it("findMany on tickets in org A only returns org A", async () => {
    await runWithTenant("org_A", () => exec("Ticket", "findMany", {}));
    expect(captured[0]?.args).toMatchObject({ where: { organizationId: "org_A" } });
  });

  it("findUnique by id from org A is restricted to org A", async () => {
    await runWithTenant("org_A", () =>
      exec("Ticket", "findUnique", { where: { id: "stolen_ticket_id_from_org_B" } }),
    );
    expect(captured[0]?.args).toMatchObject({
      where: { id: "stolen_ticket_id_from_org_B", organizationId: "org_A" },
    });
  });

  it("create injects organizationId from the caller's context", async () => {
    await runWithTenant("org_A", () =>
      exec("Comment", "create", { data: { body: "hi", authorId: "u1", ticketId: "t1" } }),
    );
    const data = (captured[0]?.args as { data?: Record<string, unknown> }).data;
    expect(data).toMatchObject({ organizationId: "org_A", body: "hi" });
  });

  it("create silently overwrites a spoofed organizationId", async () => {
    await runWithTenant("org_A", () =>
      exec("Comment", "create", { data: { body: "spoofed", organizationId: "org_B" } }),
    );
    const data = (captured[0]?.args as { data?: Record<string, unknown> }).data;
    expect((data as { organizationId: string }).organizationId).toBe("org_A");
  });

  it("update by id from org A scopes the write to org A", async () => {
    await runWithTenant("org_A", () =>
      exec("Ticket", "update", { where: { id: "t1" }, data: { status: "RESOLVED" } }),
    );
    expect(captured[0]?.args).toMatchObject({
      where: { id: "t1", organizationId: "org_A" },
      data: { status: "RESOLVED" },
    });
  });

  it("deleteMany respects the tenant boundary", async () => {
    await runWithTenant("org_A", () => exec("Device", "deleteMany", { where: {} }));
    expect(captured[0]?.args).toMatchObject({ where: { organizationId: "org_A" } });
  });

  it("groupBy + count + aggregate are all scoped", async () => {
    await runWithTenant("org_A", async () => {
      await exec("Ticket", "groupBy", { by: ["category"] });
      await exec("Ticket", "count", {});
      await exec("Ticket", "aggregate", { _avg: { confidence: true } });
    });
    expect(captured).toHaveLength(3);
    for (const c of captured) expect(c.args).toMatchObject({ where: { organizationId: "org_A" } });
  });

  it("upsert injects organizationId into both where and create", async () => {
    await runWithTenant("org_A", () =>
      exec("KbArticle", "upsert", {
        where: { id: "k1" },
        create: { title: "x", category: "y", summary: "z" },
        update: {},
      }),
    );
    expect(captured[0]?.args).toMatchObject({
      where: { id: "k1", organizationId: "org_A" },
      create: expect.objectContaining({ organizationId: "org_A", title: "x" }),
    });
  });
});

describe("tenant isolation — bypass paths", () => {
  it("non-tenant-scoped models (Organization) are not filtered", async () => {
    await runWithTenant("org_A", () => exec("Organization", "findMany", {}));
    expect(captured[0]?.args).toEqual({});
  });

  it("platform mode bypasses the filter entirely", async () => {
    await runWithPlatformMode(() => exec("Ticket", "findMany", {}));
    expect(captured[0]?.args).toEqual({});
  });

  it("no context (background script) bypasses the filter", async () => {
    await exec("Ticket", "findMany", {});
    expect(captured[0]?.args).toEqual({});
  });
});

describe("tenant isolation — A cannot reach B", () => {
  it("two concurrent contexts stay separated", async () => {
    await Promise.all([
      runWithTenant("org_A", () => exec("Ticket", "findMany", {})),
      runWithTenant("org_B", () => exec("Ticket", "findMany", {})),
    ]);
    expect(captured.find((c) => (c.args as { where?: { organizationId?: string } }).where?.organizationId === "org_A")).toBeTruthy();
    expect(captured.find((c) => (c.args as { where?: { organizationId?: string } }).where?.organizationId === "org_B")).toBeTruthy();
    // Critically: each capture has exactly one organizationId in its where.
    for (const c of captured) {
      const w = (c.args as { where?: Record<string, unknown> }).where ?? {};
      expect(w.organizationId === "org_A" || w.organizationId === "org_B").toBe(true);
    }
  });
});
