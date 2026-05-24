/**
 * Phase 27 — Demo rule generator.
 *
 * Runs when AI rule-study is disabled (no Anthropic key) but the user
 * clicked "Run study now" anyway. Produces a small set of TEMPLATE rules
 * so the UI demonstration flows end-to-end — approve / reject / test
 * buttons all do something real.
 *
 * IMPORTANT — every generated row carries `createdBy: "demo_template"`
 * and a rationale that explicitly says "DEMO". The UI renders these with
 * a DEMO badge so they cannot be mistaken for AI output.
 *
 * The rules themselves are real and runnable — they just weren't authored
 * by an LLM. They target three of the most-common MITRE techniques every
 * security team has heard of.
 */

import { basePrismaUnscoped } from "../db.js";
import { replayRule } from "./replay.js";
import type { RuleSpec } from "./dsl.js";

interface DemoTemplate {
  mitreId: string;
  title: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  logic: RuleSpec;
  rationale: string;
}

const TEMPLATES: DemoTemplate[] = [
  {
    mitreId: "T1486",
    title: "Ransomware: rapid file-encryption burst on one endpoint",
    description: "Fires when 5+ sensor alerts mentioning encryption land on the same agent within 5 minutes. Classic ransomware signature — bulk encryption is the loudest indicator.",
    severity: "CRITICAL",
    logic: {
      match: { mitreTechniqueId: "T1486", minLevel: 7 },
      window: { minutes: 5 },
      threshold: { count: 5, groupBy: "agentName" },
    },
    rationale: "DEMO — sample rule for UI demonstration. Not AI-generated. Targets MITRE T1486 (Data Encrypted for Impact).",
  },
  {
    mitreId: "T1078",
    title: "Valid Accounts: unusual login concentration from one source IP",
    description: "Fires when 10+ alerts tagged as valid-account abuse come from the same source IP within 15 minutes. Indicates credential-stuffing or password spray with a working credential.",
    severity: "HIGH",
    logic: {
      match: { mitreTechniqueId: "T1078", minLevel: 5 },
      window: { minutes: 15 },
      threshold: { count: 10, groupBy: "srcIp" },
    },
    rationale: "DEMO — sample rule for UI demonstration. Not AI-generated. Targets MITRE T1078 (Valid Accounts).",
  },
  {
    mitreId: "T1059",
    title: "Command interpreter: PowerShell / shell execution storm",
    description: "Fires when 8+ interpreter-execution alerts come from one agent within 10 minutes. Lateral-movement scripts and malware loaders both produce this pattern.",
    severity: "HIGH",
    logic: {
      match: { mitreTechniqueId: "T1059", minLevel: 6 },
      window: { minutes: 10 },
      threshold: { count: 8, groupBy: "agentName" },
    },
    rationale: "DEMO — sample rule for UI demonstration. Not AI-generated. Targets MITRE T1059 (Command and Scripting Interpreter).",
  },
];

export interface DemoResult {
  iterations: number;
  newDraftsCreated: number;
  techniquesConsidered: number;
  mode: "demo";
  /** True when MITRE catalog is empty — caller should ingest first. */
  mitreEmpty?: boolean;
}

export async function runDemoStudyForOrg(organizationId: string): Promise<DemoResult> {
  // We need the MITRE techniques to exist so we can FK the rule to them.
  const techCount = await basePrismaUnscoped.attackTechnique.count();
  if (techCount === 0) {
    return { iterations: 0, newDraftsCreated: 0, techniquesConsidered: 0, mode: "demo", mitreEmpty: true };
  }

  let created = 0;
  let considered = 0;
  for (const tpl of TEMPLATES) {
    considered++;
    const tech = await basePrismaUnscoped.attackTechnique.findUnique({ where: { mitreId: tpl.mitreId } });
    if (!tech) continue;

    // Idempotent — if a DEMO rule for this technique already exists in
    // DRAFT or TESTING, don't pile up duplicates.
    const existing = await basePrismaUnscoped.generatedRule.findFirst({
      where: {
        organizationId, attackTechniqueId: tech.id,
        createdBy: "demo_template",
        status: { in: ["DRAFT", "TESTING"] },
      },
    });
    if (existing) continue;

    const row = await basePrismaUnscoped.generatedRule.create({
      data: {
        organizationId,
        attackTechniqueId: tech.id,
        title: tpl.title,
        description: tpl.description,
        severity: tpl.severity,
        logic: tpl.logic as unknown as object,
        rationale: tpl.rationale,
        createdBy: "demo_template",
        status: "DRAFT",
      },
    });

    // Immediately replay against history so the rule has TESTING-grade
    // test results to look at. Most demo orgs have 0 sensor alerts → the
    // report will be all zeros, which is honest.
    try {
      const report = await replayRule(organizationId, tpl.logic);
      await basePrismaUnscoped.generatedRule.update({
        where: { id: row.id },
        data: { testResults: report as unknown as object, status: "TESTING" },
      });
    } catch (err) {
      console.warn(`[demo-study] replay for ${tpl.mitreId} failed:`, (err as Error).message);
    }
    created++;
  }

  return { iterations: 1, newDraftsCreated: created, techniquesConsidered: considered, mode: "demo" };
}
