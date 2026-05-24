/**
 * Phase 26 — Defender types.
 */

import type { ThreatIntel, ThreatMatch } from "@prisma/client";

/** What we hand the agent at the start of each run. */
export interface DefenderSituation {
  organizationId: string;
  /** UTC ISO date this report represents (YYYY-MM-DD). */
  runDate: string;
  windowHours: number;
  fleet: {
    deviceCount: number;
    osBreakdown: Record<string, number>;
    criticalDeviceCount: number;
    staleDeviceCount: number;
  };
  threatIntel: {
    newKevCount: number;
    newCveCount: number;
    newAdvisoryCount: number;
    newNewsCount: number;
    /** Compact list of highest-severity items the agent should consider. */
    topItems: Array<{ id: string; externalId: string; kind: string; severity: string; title: string; source: string }>;
  };
  threatMatches: {
    openCount: number;
    criticalCount: number;
    topMatches: Array<{ id: string; cveId: string; severity: string; reason: string }>;
  };
  detections: {
    newHitsCount: number;
    /** Top hits the agent should think about. */
    topHits: Array<{ id: string; ruleKey: string; severity: string; count: number }>;
  };
  /** Outcomes from the previous defender run, if any — drives learning. */
  previousRun?: {
    runDate: string;
    decisionsMade: number;
    ticketsOpened: number;
    /** How many of those tickets are now RESOLVED (good signal). */
    ticketsResolved: number;
    /** Matches we dismissed that have since been re-flagged (false negative signal). */
    dismissedThenRefired: number;
  };
}

/** One concrete action the agent took during a run. */
export type DefenderDecision =
  | { kind: "open_ticket"; matchId: string; ticketId: string; refCode: string; priority: string; reason: string }
  | { kind: "ack_match";    matchId: string; reason: string }
  | { kind: "dismiss_match"; matchId: string; reason: string }
  | { kind: "recommend_runbook"; matchId: string; runbookKey: string; reason: string }
  | { kind: "note"; text: string };

/** Snapshot of one Claude tool-use round-trip. */
export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  ts: string;
}

/** Re-export for the routes layer. */
export type { ThreatIntel, ThreatMatch };
