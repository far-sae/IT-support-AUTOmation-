import { describe, expect, it } from "vitest";
import {
  triage,
  generateAutoReply,
  computeSlaDueAt,
  CATEGORY_TO_TEAM,
  PRIORITY_TO_SLA,
  PRIORITY_TO_SLA_MS,
  type Category,
  type Priority,
} from "./triage.js";

describe("triage — categories", () => {
  const cases: Array<{ name: string; text: string; expected: Category }> = [
    { name: "Network",          text: "VPN won't connect, wifi looks fine but the router keeps dropping me.",            expected: "Network" },
    { name: "Hardware",         text: "My laptop's battery is dead — won't turn on even with the charger plugged in.",   expected: "Hardware" },
    { name: "Account & Access", text: "I'm locked out of my account, MFA reset isn't working either, can't sign in.",    expected: "Account & Access" },
    { name: "Email",            text: "Outlook calendar invites aren't syncing and my mailbox keeps crashing.",          expected: "Email" },
    { name: "Security",         text: "I got a suspicious phishing email and I think a coworker's account is compromised.", expected: "Security" },
    { name: "Software",         text: "Slack keeps crashing every time I open a thread and Excel throws a license error.",   expected: "Software" },
  ];

  it.each(cases)("classifies $name", ({ text, expected }) => {
    const r = triage(text);
    expect(r.category).toBe(expected);
    expect(r.assignedTeam).toBe(CATEGORY_TO_TEAM[expected]);
    expect(r.matchedKeywords.length).toBeGreaterThan(0);
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it("defaults to Software with low confidence on empty input", () => {
    const r = triage("");
    expect(r.category).toBe("Software");
    expect(r.priority).toBe("Medium");
    expect(r.confidence).toBeLessThan(0.5);
    expect(r.matchedKeywords).toHaveLength(0);
  });

  it("defaults to Software when no keywords match", () => {
    const r = triage("hello team just checking in for the day");
    expect(r.category).toBe("Software");
  });
});

describe("triage — priorities", () => {
  const cases: Array<{ name: Priority; text: string }> = [
    { name: "Critical", text: "Production is completely down — the entire team can't work, looks like ransomware." },
    { name: "High",     text: "I'm blocked on a deadline, this is urgent, need help asap before the meeting." },
    { name: "Medium",   text: "My VPN has been intermittent and slow today, sometimes drops out, please help." },
    { name: "Low",      text: "Question — how do I install Slack? No rush, whenever you get a chance." },
  ];

  it.each(cases)("classifies $name", ({ name, text }) => {
    const r = triage(text);
    expect(r.priority).toBe(name);
    expect(r.slaTarget).toBe(PRIORITY_TO_SLA[name]);
  });

  it("maps every priority to its documented SLA target", () => {
    expect(PRIORITY_TO_SLA.Critical).toBe("1 hour");
    expect(PRIORITY_TO_SLA.High).toBe("4 hours");
    expect(PRIORITY_TO_SLA.Medium).toBe("1 business day");
    expect(PRIORITY_TO_SLA.Low).toBe("3 business days");
  });
});

describe("triage — team routing", () => {
  it("routes every category to the correct team", () => {
    expect(CATEGORY_TO_TEAM.Network).toBe("Network Operations");
    expect(CATEGORY_TO_TEAM.Hardware).toBe("Desktop Support");
    expect(CATEGORY_TO_TEAM["Account & Access"]).toBe("Identity & Access");
    expect(CATEGORY_TO_TEAM.Email).toBe("Messaging Team");
    expect(CATEGORY_TO_TEAM.Security).toBe("Security Team");
    expect(CATEGORY_TO_TEAM.Software).toBe("Application Support");
  });
});

describe("triage — confidence scales with matches", () => {
  it("rises as more keywords are present", () => {
    const sparse = triage("my laptop");
    const rich = triage("my laptop monitor and keyboard and mouse are all failing, screen is dead, no power");
    expect(rich.confidence).toBeGreaterThan(sparse.confidence);
  });

  it("is capped at 1", () => {
    const blast = triage(
      "vpn wifi dns dhcp router firewall ethernet — outage, production down, entire team can't work, ransomware",
    );
    expect(blast.confidence).toBeLessThanOrEqual(1);
  });
});

describe("computeSlaDueAt", () => {
  it("produces the right offset per priority", () => {
    const base = new Date("2026-05-22T12:00:00Z");
    expect(computeSlaDueAt("Critical", base).getTime() - base.getTime()).toBe(PRIORITY_TO_SLA_MS.Critical);
    expect(computeSlaDueAt("High",     base).getTime() - base.getTime()).toBe(PRIORITY_TO_SLA_MS.High);
    expect(computeSlaDueAt("Medium",   base).getTime() - base.getTime()).toBe(PRIORITY_TO_SLA_MS.Medium);
    expect(computeSlaDueAt("Low",      base).getTime() - base.getTime()).toBe(PRIORITY_TO_SLA_MS.Low);
  });
});

describe("generateAutoReply", () => {
  it("includes the ref code, team, category, priority and SLA target", () => {
    const body = generateAutoReply({
      submitterName: "Jordan Lee",
      refCode: "INC-1042",
      category: "Network",
      priority: "High",
      assignedTeam: "Network Operations",
      slaTarget: "4 hours",
    });
    expect(body).toContain("Jordan");
    expect(body).toContain("INC-1042");
    expect(body).toContain("Network Operations");
    expect(body).toContain("Network");
    expect(body).toContain("High");
    expect(body).toContain("4 hours");
  });

  it("falls back gracefully when the name is empty", () => {
    const body = generateAutoReply({
      submitterName: "",
      refCode: "INC-0001",
      category: "Software",
      priority: "Low",
      assignedTeam: "Application Support",
      slaTarget: "3 business days",
    });
    expect(body).toContain("Hi there");
  });
});
