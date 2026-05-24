/**
 * Phase 11 — automatic rollback on agent-action failure.
 *
 * Each AgentActionKind has at most one inverse. When `settleFromAgentResult`
 * reports a failure (or a verification timeout) on a runbook execution
 * linked to a dispatched action, we queue the inverse on the same device.
 *
 *   APPLY_PENDING_UPDATES → ROLL_BACK_LAST_PATCH
 *   RESTART_SERVICE       → no inverse (restart is idempotent — already self-corrects)
 *   CLEAR_CACHE           → no inverse (cache is rebuilt automatically)
 *   DISK_CLEANUP          → no inverse (delete is non-reversible)
 *   RUN_DIAGNOSTIC        → no inverse (read-only)
 *   TRIGGER_GITHUB_WORKFLOW → no inverse (workflow ought to know how to undo itself)
 */

import { AgentActionKind } from "@prisma/client";
import { prisma } from "../db.js";

export function inverseOf(kind: AgentActionKind): AgentActionKind | null {
  switch (kind) {
    case AgentActionKind.APPLY_PENDING_UPDATES: return AgentActionKind.ROLL_BACK_LAST_PATCH;
    default: return null;
  }
}

/**
 * Look at all AgentActions linked to the given execution; for any that
 * succeeded (and have an inverse), queue the inverse for the same device.
 * The agent picks them up on the next poll and runs them.
 */
export async function dispatchRollbackFor(executionId: string): Promise<number> {
  const successful = await prisma.agentAction.findMany({
    where: { runbookExecutionId: executionId, status: "SUCCEEDED" },
  });

  let count = 0;
  for (const a of successful) {
    const inv = inverseOf(a.kind);
    if (!inv) continue;
    await prisma.agentAction.create({
      data: {
        organizationId: a.organizationId,
        deviceId: a.deviceId,
        kind: inv,
        input: { rollbackOf: a.id, originalKind: a.kind, originalInput: a.input } as object,
        runbookExecutionId: a.runbookExecutionId,
      },
    });
    count += 1;
  }
  return count;
}
