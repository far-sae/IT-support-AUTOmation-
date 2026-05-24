/**
 * Registry of every built-in workflow.
 *
 * Order matters only for the "pick the first matching workflow" auto-route
 * (`pickWorkflowForTicket`). Manual starts via the API name a workflow
 * directly by key.
 */

import { onboardEmployee, triageNetworkIssue } from "./builtins.js";
import {
  incidentResponse, malwareContainment, accountCompromise, phishingResponse,
} from "./builtins-security.js";
import {
  patchRolloutStaged, certificateRenewal, lostDevice, backupVerification,
} from "./builtins-fleet.js";
import {
  offboarding, contractorAccess, passwordRotation, licenseAudit,
} from "./builtins-identity.js";
import {
  vpnOutageTriage, logAnomalyFollowup, vulnerabilityScan,
} from "./builtins-ops.js";
import type { Workflow } from "./types.js";
import type { Ticket } from "@prisma/client";

export const WORKFLOWS: Workflow[] = [
  // Security
  incidentResponse,
  malwareContainment,
  accountCompromise,
  phishingResponse,
  // Fleet / infrastructure
  patchRolloutStaged,
  certificateRenewal,
  lostDevice,
  backupVerification,
  // Identity lifecycle
  offboarding,
  contractorAccess,
  passwordRotation,
  licenseAudit,
  // Operations
  vpnOutageTriage,
  logAnomalyFollowup,
  vulnerabilityScan,
  // Originals (Phase 13)
  triageNetworkIssue,
  onboardEmployee,
];

export function findWorkflow(key: string): Workflow | undefined {
  return WORKFLOWS.find((w) => w.key === key);
}

export interface PublicWorkflow {
  key: string;
  name: string;
  description: string;
  stepCount: number;
}

export function publicWorkflowCatalog(): PublicWorkflow[] {
  return WORKFLOWS.map((w) => ({
    key: w.key, name: w.name, description: w.description,
    stepCount: w.steps.length,
  }));
}

/**
 * Returns the highest-confidence matching workflow for a ticket, if any.
 * The autopilot can call this on ticket-create to optionally orchestrate a
 * multi-step flow instead of a single runbook.
 */
export function pickWorkflowForTicket(ticket: Ticket): { workflow: Workflow; confidence: number; reason: string } | null {
  let best: { workflow: Workflow; confidence: number; reason: string } | null = null;
  for (const w of WORKFLOWS) {
    if (!w.match) continue;
    const m = w.match(ticket);
    if (!m) continue;
    if (!best || m.confidence > best.confidence) {
      best = { workflow: w, confidence: m.confidence, reason: m.reason };
    }
  }
  return best;
}
