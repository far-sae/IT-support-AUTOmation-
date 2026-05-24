/**
 * Registry of every built-in detection rule.
 *
 * Order is presentational only — the engine evaluates all enabled rules
 * each tick. Per-org disable lives on Organization.settings.disabledDetectionRules.
 */

import {
  securityBurst, ransomwareLanguage, mfaBruteForce,
  runbookFailureSpike, fleetDegradation,
} from "./builtins.js";
import {
  massPasswordResetAttempts, privilegedAccountCreation, suspiciousLoginVolume,
} from "./builtins-identity.js";
import {
  outdatedAgentFleet, staleDeviceBurst, diskFullBurst,
} from "./builtins-fleet.js";
import {
  ticketStormUnassigned, slaBreachSpike, sameSubmitterBurst,
} from "./builtins-service.js";
import {
  agentActionFailureRate, workflowCompensatingBurst, patchRolloutFailure,
} from "./builtins-automation.js";
import {
  encryptionExtensionBurst, afterHoursAdminAction, dataExfilKeywords,
} from "./builtins-security-extra.js";
import { kevMentionedInTicket } from "./builtins-threat.js";
import type { DetectionRule } from "./types.js";

export const DETECTION_RULES: DetectionRule[] = [
  // Critical-first ordering so the highest-priority hits land at the top
  // of the dashboard list (the engine still evaluates every enabled rule
  // each tick — order is presentational).
  kevMentionedInTicket,        // CRITICAL — live KEV correlation
  ransomwareLanguage,
  encryptionExtensionBurst,

  // High
  securityBurst,
  mfaBruteForce,
  massPasswordResetAttempts,
  privilegedAccountCreation,
  ticketStormUnassigned,
  slaBreachSpike,
  workflowCompensatingBurst,
  patchRolloutFailure,
  dataExfilKeywords,
  fleetDegradation,

  // Medium
  runbookFailureSpike,
  suspiciousLoginVolume,
  staleDeviceBurst,
  diskFullBurst,
  agentActionFailureRate,
  afterHoursAdminAction,

  // Low
  outdatedAgentFleet,
  sameSubmitterBurst,
];

export interface PublicDetectionRule {
  key: string;
  name: string;
  description: string;
  severity: DetectionRule["severity"];
  windowMinutes: number;
}

export function publicDetectionCatalog(): PublicDetectionRule[] {
  return DETECTION_RULES.map(({ detect: _detect, ...rest }) => rest);
}
