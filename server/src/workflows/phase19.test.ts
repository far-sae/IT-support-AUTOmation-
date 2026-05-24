import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const { WORKFLOWS, publicWorkflowCatalog, pickWorkflowForTicket, findWorkflow } = await import("./registry.js");

import type { Ticket } from "@prisma/client";

function ticket(description: string, category = "Software", priority = "Medium"): Ticket {
  return {
    id: "t1", organizationId: "org_A", refCode: "INC-1",
    description, category, priority,
    submitterName: "u", submitterEmail: "u@x.io", submitterUserId: "user_1",
    assignedAgentId: null, source: "PORTAL", assignedTeam: "—",
    slaTarget: "1 day", slaDueAt: new Date(), slaAlertedAt: null,
    confidence: 0.5, status: "OPEN", autoReply: "", resolvedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  } as unknown as Ticket;
}

describe("Phase 19 — workflows registry", () => {
  it("has 17 workflows wired up (2 originals + 15 new)", () => {
    expect(WORKFLOWS.length).toBe(17);
  });

  it("every workflow has a unique key + at least 3 steps + a name/description", () => {
    const keys = new Set<string>();
    for (const w of WORKFLOWS) {
      expect(w.key.length).toBeGreaterThan(0);
      expect(keys.has(w.key)).toBe(false);
      keys.add(w.key);
      expect(w.name.length).toBeGreaterThan(3);
      expect(w.description.length).toBeGreaterThan(20);
      expect(w.steps.length).toBeGreaterThanOrEqual(3);
      // Every step has a unique key within the workflow
      const stepKeys = new Set<string>();
      for (const s of w.steps) {
        expect(stepKeys.has(s.key)).toBe(false);
        stepKeys.add(s.key);
        expect(typeof s.execute).toBe("function");
      }
    }
  });

  it("findWorkflow looks up every workflow by key", () => {
    for (const w of WORKFLOWS) expect(findWorkflow(w.key)?.key).toBe(w.key);
  });

  it("publicWorkflowCatalog has stepCount + no execute closures", () => {
    const cat = publicWorkflowCatalog();
    expect(cat.length).toBe(WORKFLOWS.length);
    for (const c of cat) {
      expect(c.stepCount).toBeGreaterThan(0);
      expect("steps" in c).toBe(false);
    }
  });
});

describe("Phase 19 — workflow matchers", () => {
  it("Critical-priority intrusion ticket → incident_response", () => {
    const pick = pickWorkflowForTicket(ticket("we have an active intrusion on our perimeter", "Security", "Critical"));
    expect(pick?.workflow.key).toBe("incident_response");
  });

  it("lost laptop → lost_device", () => {
    const pick = pickWorkflowForTicket(ticket("I lost my laptop yesterday on the train"));
    expect(pick?.workflow.key).toBe("lost_device");
  });

  it("offboarding mention → offboarding", () => {
    const pick = pickWorkflowForTicket(ticket("please start offboarding for John, last day Friday"));
    expect(pick?.workflow.key).toBe("offboarding");
  });

  it("VPN outage → vpn_outage_triage", () => {
    const pick = pickWorkflowForTicket(ticket("vpn is down for the whole sales team"));
    expect(pick?.workflow.key).toBe("vpn_outage_triage");
  });

  it("phishing report → phishing_response", () => {
    const pick = pickWorkflowForTicket(ticket("forwarded phishing email pretending to be IT"));
    expect(pick?.workflow.key).toBe("phishing_response");
  });

  it("certificate expiring → certificate_renewal", () => {
    const pick = pickWorkflowForTicket(ticket("our wildcard cert is about to expire next week"));
    expect(pick?.workflow.key).toBe("certificate_renewal");
  });

  it("benign hardware ticket → no match", () => {
    const pick = pickWorkflowForTicket(ticket("my monitor brightness button is stuck", "Hardware"));
    expect(pick).toBeNull();
  });
});
