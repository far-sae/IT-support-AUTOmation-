import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const findUniqueMock = vi.fn();
vi.mock("../db.js", () => ({
  basePrismaUnscoped: {
    user: { findUnique: (args: unknown) => findUniqueMock(args) },
  },
  prisma: {},
}));

// Import AFTER the mock + env setup so the modules pick them up.
const { signToken } = await import("./jwt.js");
const { requireAuth, requireRole, requirePlatformAdmin } = await import("./middleware.js");

function makeReqRes(headers: Record<string, string> = {}) {
  const req = { headers, user: undefined } as unknown as Request;
  const res = {} as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

function token(payload: Partial<Parameters<typeof signToken>[0]> = {}): string {
  return signToken({
    userId: "user_1",
    role: Role.EMPLOYEE,
    organizationId: "org_1",
    isPlatformAdmin: false,
    ...payload,
  });
}

function mockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_1", email: "u@relay.io", name: "U", role: Role.AGENT,
    organizationId: "org_1", isPlatformAdmin: false,
    organization: { slug: "acme", suspendedAt: null },
    ...overrides,
  };
}

beforeAll(() => { findUniqueMock.mockReset(); });
afterAll(() => { vi.restoreAllMocks(); });

describe("requireAuth", () => {
  it("rejects when no Authorization header is provided", async () => {
    const { req, res, next } = makeReqRes();
    await requireAuth(req, res, next);
    const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { status: number };
    expect(err.status).toBe(401);
  });

  it("rejects when the scheme isn't Bearer", async () => {
    const { req, res, next } = makeReqRes({ authorization: "Basic abc" });
    await requireAuth(req, res, next);
    const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { status: number };
    expect(err.status).toBe(401);
  });

  it("rejects when the JWT is invalid", async () => {
    const { req, res, next } = makeReqRes({ authorization: "Bearer not-a-jwt" });
    await requireAuth(req, res, next);
    const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { status: number };
    expect(err.status).toBe(401);
  });

  it("rejects when the JWT is valid but the user no longer exists", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    const { req, res, next } = makeReqRes({ authorization: `Bearer ${token()}` });
    await requireAuth(req, res, next);
    const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { status: number };
    expect(err.status).toBe(401);
  });

  it("rejects when the user's organization is suspended", async () => {
    findUniqueMock.mockResolvedValueOnce(mockUser({
      organization: { slug: "acme", suspendedAt: new Date() },
    }));
    const { req, res, next } = makeReqRes({ authorization: `Bearer ${token()}` });
    await requireAuth(req, res, next);
    const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { status: number; code: string };
    expect(err.status).toBe(403);
    expect(err.code).toBe("ORG_SUSPENDED");
  });

  it("attaches req.user with tenancy fields and calls next() on a valid token", async () => {
    findUniqueMock.mockResolvedValueOnce(mockUser());
    const { req, res, next } = makeReqRes({ authorization: `Bearer ${token()}` });
    await requireAuth(req, res, next);
    expect(req.user).toEqual({
      id: "user_1", email: "u@relay.io", name: "U", role: Role.AGENT,
      organizationId: "org_1", organizationSlug: "acme", isPlatformAdmin: false,
    });
    expect((next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]).toEqual([]);
  });
});

describe("requireRole", () => {
  function withUser(role: Role | undefined) {
    const req = {
      user: role
        ? { id: "x", email: "x@x", role, name: "X", organizationId: "org_1", organizationSlug: "acme", isPlatformAdmin: false }
        : undefined,
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;
    return { req, res, next };
  }

  it("401s when no user is attached", () => {
    const { req, res, next } = withUser(undefined);
    requireRole(Role.ADMIN)(req, res, next);
    const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { status: number };
    expect(err.status).toBe(401);
  });

  it("403s when the user's role isn't allowed", () => {
    const { req, res, next } = withUser(Role.EMPLOYEE);
    requireRole(Role.AGENT, Role.ADMIN)(req, res, next);
    const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { status: number };
    expect(err.status).toBe(403);
  });

  it("calls next() when the role is allowed", () => {
    const { req, res, next } = withUser(Role.ADMIN);
    requireRole(Role.ADMIN)(req, res, next);
    expect((next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]).toEqual([]);
  });
});

describe("requirePlatformAdmin", () => {
  function withUser(isPlatformAdmin: boolean | undefined) {
    const req = {
      user: isPlatformAdmin === undefined
        ? undefined
        : { id: "x", email: "x@x", role: Role.EMPLOYEE, name: "X", organizationId: "org_1", organizationSlug: "acme", isPlatformAdmin },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;
    return { req, res, next };
  }

  it("401s when there is no user", () => {
    const { req, res, next } = withUser(undefined);
    requirePlatformAdmin(req, res, next);
    const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { status: number };
    expect(err.status).toBe(401);
  });

  it("403s when the user is not a platform admin", () => {
    const { req, res, next } = withUser(false);
    requirePlatformAdmin(req, res, next);
    const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { status: number };
    expect(err.status).toBe(403);
  });

  it("calls next() when the user is a platform admin", () => {
    const { req, res, next } = withUser(true);
    requirePlatformAdmin(req, res, next);
    expect((next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]).toEqual([]);
  });
});
