import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
// Default — ES off. Individual tests can mock esEnabled differently.
delete process.env.ELASTICSEARCH_URL;

const ticketFindMany = vi.fn();
vi.mock("../db.js", () => ({
  prisma: { ticket: { findMany: (a: unknown) => ticketFindMany(a) } },
  basePrismaUnscoped: { ticket: { findUnique: vi.fn() } },
}));

const esSearchMock = vi.fn();
const esEnabledMock = vi.fn();
vi.mock("../integrations/elasticsearch.js", () => ({
  esEnabled: () => esEnabledMock(),
  esSearchTickets: (a: unknown) => esSearchMock(a),
}));

vi.mock("../tenant/context.js", () => ({
  getTenantContext: () => ({ organizationId: "org_A" }),
}));

const { searchTickets } = await import("./tickets.js");

beforeEach(() => {
  ticketFindMany.mockReset();
  esSearchMock.mockReset();
  esEnabledMock.mockReset();
});

describe("searchTickets", () => {
  it("returns [] for empty query without hitting any backend", async () => {
    esEnabledMock.mockReturnValue(false);
    const r = await searchTickets("");
    expect(r).toEqual([]);
    expect(ticketFindMany).not.toHaveBeenCalled();
    expect(esSearchMock).not.toHaveBeenCalled();
  });

  it("uses Postgres ILIKE when ES is off", async () => {
    esEnabledMock.mockReturnValue(false);
    ticketFindMany.mockResolvedValueOnce([
      { id: "t1", refCode: "INC-1", description: "outlook is broken" },
    ]);
    const r = await searchTickets("outlook");
    expect(r).toEqual([
      { id: "t1", refCode: "INC-1", description: "outlook is broken", score: 1, source: "postgres" },
    ]);
    expect(esSearchMock).not.toHaveBeenCalled();
  });

  it("uses Elasticsearch when configured", async () => {
    esEnabledMock.mockReturnValue(true);
    esSearchMock.mockResolvedValueOnce([
      { id: "t9", refCode: "INC-9", description: "vpn drops every hour", score: 4.2 },
    ]);
    const r = await searchTickets("vpn");
    expect(r).toEqual([
      { id: "t9", refCode: "INC-9", description: "vpn drops every hour", score: 4.2, source: "elasticsearch" },
    ]);
    expect(ticketFindMany).not.toHaveBeenCalled();
  });
});
