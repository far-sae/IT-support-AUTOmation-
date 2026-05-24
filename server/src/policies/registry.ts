import type { Policy } from "./types.js";
import {
  noCriticalDuringBusinessHours, requireApprovalForHighRisk,
  noMassAction, quietHours, noUpdatesOnOpenTickets,
} from "./builtins.js";

/**
 * Order matters — the first DENY wins. Tighter / safety-of-business
 * policies sit ahead of generic risk gates.
 */
export const POLICIES: readonly Policy[] = [
  noCriticalDuringBusinessHours,
  noUpdatesOnOpenTickets,
  noMassAction,
  quietHours,
  requireApprovalForHighRisk,
];

export function publicPolicyCatalog() {
  return POLICIES.map((p) => ({ key: p.key, name: p.name, description: p.description }));
}
