import { describe, expect, it } from "vitest";

process.env.JWT_SECRET = "test-secret-test-secret-test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";

const { terraformApplyRunbook } = await import("./terraform_apply.js");
const { ansiblePlaybookRunbook } = await import("./ansible_playbook.js");
const { firewallBlockIpRunbook } = await import("./firewall_block_ip.js");
const { itsmSyncRunbook } = await import("./itsm_sync.js");

import type { Ticket } from "@prisma/client";
import type { TriageResult } from "../triage.js";

function ticket(description: string, category = "Software"): Ticket {
  return {
    id: "t1", organizationId: "org_A", refCode: "INC-1",
    description, category, priority: "Medium",
    submitterName: "u", submitterEmail: "u@x.io", submitterUserId: "user_1",
    assignedAgentId: null, source: "PORTAL", assignedTeam: "—",
    slaTarget: "1 day", slaDueAt: new Date(), slaAlertedAt: null,
    confidence: 0.5, status: "OPEN", autoReply: "", resolvedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  } as unknown as Ticket;
}

const triage = {
  category: "Software", priority: "Medium",
  assignedTeam: "—", slaTarget: "1 day", confidence: 0.5, matchedKeywords: [],
} as unknown as TriageResult;

describe("Tier 4 risk levels", () => {
  it("terraform/ansible/firewall are HIGH; itsm_sync is LOW", () => {
    expect(terraformApplyRunbook.risk).toBe("HIGH");
    expect(ansiblePlaybookRunbook.risk).toBe("HIGH");
    expect(firewallBlockIpRunbook.risk).toBe("HIGH");
    expect(itsmSyncRunbook.risk).toBe("LOW");
  });
});

describe("terraform_apply.match", () => {
  it("fires on 'terraform apply'", () => {
    expect(terraformApplyRunbook.match({
      ticket: ticket("please run terraform apply for the staging workspace"), triage,
    }).confidence).toBeGreaterThan(0.5);
  });
  it("fires on 'redeploy infrastructure'", () => {
    expect(terraformApplyRunbook.match({
      ticket: ticket("can you redeploy infrastructure for us"), triage,
    }).confidence).toBeGreaterThan(0.3);
  });
  it("doesn't fire on generic deploy language", () => {
    expect(terraformApplyRunbook.match({
      ticket: ticket("the deploy button is broken in our internal tool"), triage,
    }).confidence).toBe(0);
  });
});

describe("ansible_playbook.match", () => {
  it("fires on 'playbook'", () => {
    expect(ansiblePlaybookRunbook.match({
      ticket: ticket("run the patch playbook against the web tier"), triage,
    }).confidence).toBeGreaterThan(0.5);
  });
  it("doesn't fire on unrelated text", () => {
    expect(ansiblePlaybookRunbook.match({
      ticket: ticket("my keyboard is making strange noises"), triage,
    }).confidence).toBe(0);
  });
});

describe("firewall_block_ip.match", () => {
  it("fires on 'block IP' + a real IPv4", () => {
    expect(firewallBlockIpRunbook.match({
      ticket: ticket("please block IP 203.0.113.45 — it's been scanning our perimeter"), triage,
    }).confidence).toBeGreaterThan(0.5);
  });
  it("fires lower (0.2) when the phrase is there but no IPv4", () => {
    expect(firewallBlockIpRunbook.match({
      ticket: ticket("please block traffic from that host"), triage,
    }).confidence).toBe(0.2);
  });
  it("doesn't fire without the block phrase", () => {
    expect(firewallBlockIpRunbook.match({
      ticket: ticket("my home IP is 203.0.113.45 if it helps"), triage,
    }).confidence).toBe(0);
  });
});

describe("itsm_sync.match", () => {
  it("fires on 'create incident in ServiceNow'", () => {
    expect(itsmSyncRunbook.match({
      ticket: ticket("can you create an incident in ServiceNow for this"), triage,
    }).confidence).toBeGreaterThan(0.5);
  });
  it("fires on 'mirror to Jira'", () => {
    expect(itsmSyncRunbook.match({
      ticket: ticket("please mirror this to Jira so the dev team sees it"), triage,
    }).confidence).toBeGreaterThan(0.5);
  });
  it("doesn't fire on plain ticketing-system mention without intent", () => {
    expect(itsmSyncRunbook.match({
      ticket: ticket("our jira is too slow, please fix"), triage,
    }).confidence).toBe(0);
  });
});
