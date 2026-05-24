import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const tokenFindUnique = vi.fn();
const tokenUpdate = vi.fn();
const deviceUpsert = vi.fn();
const deviceMetricCreate = vi.fn();
const emitFn = vi.fn();

vi.mock("../db.js", () => ({
  basePrismaUnscoped: {
    agentEnrollmentToken: {
      findUnique: (a: unknown) => tokenFindUnique(a),
      update: (a: unknown) => tokenUpdate(a),
    },
  },
  prisma: {
    device: { upsert: (a: unknown) => deviceUpsert(a) },
    deviceMetric: { create: (a: unknown) => deviceMetricCreate(a) },
  },
}));

vi.mock("../tenant/context.js", () => ({
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

vi.mock("../realtime/socket.js", () => ({
  emit: (event: string, payload: unknown) => emitFn(event, payload),
}));

const { computeHealth, performCheckin, resolveAgentToken } = await import("./agent.js");

beforeEach(() => {
  tokenFindUnique.mockReset();
  tokenUpdate.mockReset();
  deviceUpsert.mockReset();
  deviceMetricCreate.mockReset();
  emitFn.mockReset();
  tokenUpdate.mockResolvedValue({});
});

// ─── computeHealth ────────────────────────────────────────────────────

describe("computeHealth", () => {
  it("returns CRITICAL when disk ≥ 95", () => expect(computeHealth(0, 0, 96)).toBe("CRITICAL"));
  it("returns CRITICAL when ram ≥ 95", () => expect(computeHealth(0, 97, 0)).toBe("CRITICAL"));
  it("returns CRITICAL when pendingUpdates ≥ 25", () => expect(computeHealth(0, 0, 0, 30)).toBe("CRITICAL"));
  it("returns WARNING when disk ≥ 80", () => expect(computeHealth(0, 0, 85)).toBe("WARNING"));
  it("returns WARNING when cpu ≥ 90", () => expect(computeHealth(91, 50, 50)).toBe("WARNING"));
  it("returns HEALTHY for normal load", () => expect(computeHealth(20, 40, 50, 0)).toBe("HEALTHY"));
});

// ─── resolveAgentToken ───────────────────────────────────────────────

describe("resolveAgentToken", () => {
  it("returns null for missing header", async () => {
    expect(await resolveAgentToken(undefined)).toBeNull();
  });

  it("returns null for non-Bearer scheme", async () => {
    expect(await resolveAgentToken("Basic foo")).toBeNull();
  });

  it("returns null when the token is unknown", async () => {
    tokenFindUnique.mockResolvedValueOnce(null);
    expect(await resolveAgentToken("Bearer abc")).toBeNull();
  });

  it("returns null when the token is revoked", async () => {
    tokenFindUnique.mockResolvedValueOnce({ id: "t1", organizationId: "org_A", revokedAt: new Date() });
    expect(await resolveAgentToken("Bearer abc")).toBeNull();
  });

  it("resolves a valid token + touches lastUsedAt", async () => {
    tokenFindUnique.mockResolvedValueOnce({ id: "t1", organizationId: "org_A", revokedAt: null });
    const r = await resolveAgentToken("Bearer relay_agent_xyz");
    expect(r).toEqual({ id: "t1", organizationId: "org_A" });
    expect(tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1" }, data: expect.objectContaining({ lastUsedAt: expect.any(Date) }) }),
    );
  });
});

// ─── performCheckin ──────────────────────────────────────────────────

const BASE = {
  hostname: "MBP-TEST", os: "macOS 14.5",
  cpu: 30, ram: 40, disk: 50,
};

describe("performCheckin", () => {
  it("upserts the device + creates a metric using the caller's org", async () => {
    deviceUpsert.mockResolvedValueOnce({ id: "dev1", hostname: "MBP-TEST", healthStatus: "HEALTHY" });
    deviceMetricCreate.mockResolvedValueOnce({});

    const out = await performCheckin("org_A", BASE);

    expect(out).toEqual({ deviceId: "dev1", hostname: "MBP-TEST", healthStatus: "HEALTHY" });

    const upsertArgs = deviceUpsert.mock.calls[0]?.[0] as {
      where: { organizationId_hostname: { organizationId: string; hostname: string } };
      create: { organizationId: string; discoverySource: string; healthStatus: string };
    };
    expect(upsertArgs.where.organizationId_hostname.organizationId).toBe("org_A");
    expect(upsertArgs.create.organizationId).toBe("org_A");
    expect(upsertArgs.create.discoverySource).toBe("AGENT");

    const metricArgs = deviceMetricCreate.mock.calls[0]?.[0] as { data: { organizationId: string; cpu: number } };
    expect(metricArgs.data.organizationId).toBe("org_A");
    expect(metricArgs.data.cpu).toBe(30);

    expect(emitFn).toHaveBeenCalledWith("device:updated", expect.objectContaining({ hostname: "MBP-TEST" }));
  });

  it("translates CRITICAL load into healthStatus", async () => {
    deviceUpsert.mockResolvedValueOnce({ id: "dev1", hostname: "MBP-TEST", healthStatus: "CRITICAL" });
    deviceMetricCreate.mockResolvedValueOnce({});

    await performCheckin("org_A", { ...BASE, disk: 97 });

    const upsertArgs = deviceUpsert.mock.calls[0]?.[0] as { create: { healthStatus: string } };
    expect(upsertArgs.create.healthStatus).toBe("CRITICAL");
  });

  it("formats patchStatus from pendingUpdates", async () => {
    deviceUpsert.mockResolvedValueOnce({ id: "dev1", hostname: "MBP-TEST", healthStatus: "HEALTHY" });
    deviceMetricCreate.mockResolvedValueOnce({});

    await performCheckin("org_A", { ...BASE, pendingUpdates: 3 });

    const upsertArgs = deviceUpsert.mock.calls[0]?.[0] as { create: { patchStatus: string } };
    expect(upsertArgs.create.patchStatus).toBe("3 updates pending");
  });

  it("a fresh org sees independent devices (tenant isolation by token)", async () => {
    // Two concurrent check-ins with different orgs; each upsert's `where`
    // must lock to its own organizationId.
    deviceUpsert.mockResolvedValue({ id: "dev1", hostname: "X", healthStatus: "HEALTHY" });
    deviceMetricCreate.mockResolvedValue({});

    await Promise.all([
      performCheckin("org_A", { ...BASE, hostname: "SHARED-HOSTNAME" }),
      performCheckin("org_B", { ...BASE, hostname: "SHARED-HOSTNAME" }),
    ]);

    const orgs = deviceUpsert.mock.calls.map(
      (c) => (c?.[0] as { where: { organizationId_hostname: { organizationId: string } } })
        .where.organizationId_hostname.organizationId,
    );
    expect(orgs.sort()).toEqual(["org_A", "org_B"]);
  });
});
