/**
 * Phase 27 — MITRE ATT&CK ingester integration test.
 *
 * Exercises ingestMitreAttack() against a mock STIX bundle that mirrors
 * the real shape (attack-pattern objects with external_references,
 * kill_chain_phases, etc.).
 */

import { describe, expect, it, vi } from "vitest";
import { jsonResponse, withMockServer } from "../../integrations/__test__/mock-server.js";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
process.env.MITRE_ATTACK_URL = "https://mitre-placeholder.invalid/enterprise-attack.json";

const upsertCalls: Array<Record<string, unknown>> = [];
vi.mock("../../db.js", () => ({
  basePrismaUnscoped: {
    attackTechnique: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        upsertCalls.push(args);
        return { id: `t_${upsertCalls.length}` };
      }),
    },
  },
  prisma: {},
}));

const { ingestMitreAttack } = await import("../mitre-ingest.js");

function retargetFetch(mockBaseUrl: string): typeof fetch {
  const real = global.fetch;
  return (async (url: string | URL, init?: RequestInit) => {
    const s = typeof url === "string" ? url : url.toString();
    if (s.includes("mitre-placeholder.invalid")) {
      const u = new URL(s);
      return real(`${mockBaseUrl}${u.pathname}${u.search}`, init);
    }
    return real(url, init);
  }) as typeof fetch;
}

describe("MITRE ATT&CK ingester", () => {
  it("upserts attack-pattern objects + ignores non-pattern STIX types", async () => {
    upsertCalls.length = 0;
    await withMockServer(async ({ baseUrl, requests }) => {
      const realFetch = global.fetch;
      global.fetch = retargetFetch(baseUrl);
      try {
        const r = await ingestMitreAttack();
        expect(r.techniquesUpserted).toBe(2);
        expect(r.techniquesRevoked).toBe(1);
        expect(r.bundleObjects).toBe(4); // 2 patterns + 1 unrelated + 1 marker
        expect(requests[0]?.url).toBe("/enterprise-attack.json");

        // Verify field mapping on the live one.
        const live = upsertCalls.find((c) => {
          const where = c.where as Record<string, unknown>;
          return where.mitreId === "T1059";
        });
        expect(live).toBeDefined();
        const liveCreate = (live!.create) as Record<string, unknown>;
        expect(liveCreate.tactic).toBe("execution");
        expect(liveCreate.revoked).toBe(false);
        expect(liveCreate.platforms).toEqual(["Windows", "Linux", "macOS"]);

        // Verify the revoked one was flagged.
        const revoked = upsertCalls.find((c) => {
          const where = c.where as Record<string, unknown>;
          return where.mitreId === "T9999";
        });
        const revCreate = (revoked!.create) as Record<string, unknown>;
        expect(revCreate.revoked).toBe(true);
      } finally {
        global.fetch = realFetch;
      }
    }, {
      handler: (_req, res) => jsonResponse(res, 200, {
        type: "bundle",
        objects: [
          {
            type: "attack-pattern",
            id: "attack-pattern--abc",
            name: "Command and Scripting Interpreter",
            description: "Adversaries may abuse command and script interpreters to execute commands.",
            external_references: [{ source_name: "mitre-attack", external_id: "T1059", url: "https://attack.mitre.org/techniques/T1059/" }],
            kill_chain_phases: [{ kill_chain_name: "mitre-attack", phase_name: "execution" }],
            x_mitre_platforms: ["Windows", "Linux", "macOS"],
            x_mitre_data_sources: ["Process: Process Creation"],
            modified: "2025-01-15T00:00:00Z",
            revoked: false,
          },
          {
            type: "attack-pattern",
            id: "attack-pattern--def",
            name: "Deprecated technique",
            description: "Old.",
            external_references: [{ source_name: "mitre-attack", external_id: "T9999" }],
            kill_chain_phases: [{ kill_chain_name: "mitre-attack", phase_name: "persistence" }],
            x_mitre_deprecated: true,
            modified: "2020-01-01T00:00:00Z",
          },
          {
            type: "intrusion-set",  // not an attack-pattern; should be skipped
            id: "intrusion-set--xyz",
            name: "APT-Acme",
          },
          {
            type: "marking-definition",  // also not an attack-pattern
            id: "marking-definition--123",
          },
        ],
      }),
    });
  });
});
