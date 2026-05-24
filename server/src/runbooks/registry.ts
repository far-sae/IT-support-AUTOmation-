/**
 * Built-in runbook catalog.
 *
 * Adding a runbook = writing one file + registering it here.
 * Per-organization disable lives in `Organization.settings.disabledRunbooks`.
 */

import type { Runbook } from "./types.js";
// Tier 1 — software-only (Phase 10A)
import { passwordResetRunbook }    from "./password_reset.js";
import { mfaResetRunbook }         from "./mfa_reset.js";
import { accountUnlockRunbook }    from "./account_unlock.js";
import { kbDeflectionRunbook }     from "./kb_deflection.js";
import { licenseAssignRunbook }    from "./license_assign.js";
import { softwareInstallRunbook }  from "./software_install.js";
// Tier 2 — agent-driven local actions (Phase 10C)
import { runDiagnosticRunbook }    from "./run_diagnostic.js";
import { restartServiceRunbook }   from "./restart_service.js";
import { clearCacheRunbook }       from "./clear_cache.js";
import { diskCleanupRunbook }      from "./disk_cleanup.js";
import { applyUpdatesRunbook }     from "./apply_updates.js";
// Tier 3 — external action targets (Phase 11)
import { githubDispatchRunbook }   from "./github_dispatch.js";
// Tier 4 — infrastructure actions (Phase 14)
import { terraformApplyRunbook }   from "./terraform_apply.js";
import { ansiblePlaybookRunbook }  from "./ansible_playbook.js";
import { firewallBlockIpRunbook }  from "./firewall_block_ip.js";
import { itsmSyncRunbook }         from "./itsm_sync.js";

export const RUNBOOKS: readonly Runbook[] = [
  // Tier 1 — identity / account / catalog
  passwordResetRunbook,
  accountUnlockRunbook,
  mfaResetRunbook,
  licenseAssignRunbook,
  softwareInstallRunbook,
  // Tier 2 — local actions on the user's device (more specific first)
  restartServiceRunbook,
  clearCacheRunbook,
  diskCleanupRunbook,
  applyUpdatesRunbook,
  runDiagnosticRunbook,
  // Tier 3 — external operations
  githubDispatchRunbook,
  // Tier 4 — infrastructure actions (HIGH risk; ITSM-sync is LOW)
  terraformApplyRunbook,
  ansiblePlaybookRunbook,
  firewallBlockIpRunbook,
  itsmSyncRunbook,
  // Last-resort catch-all
  kbDeflectionRunbook,
];

export function getRunbook(key: string): Runbook | undefined {
  return RUNBOOKS.find((r) => r.key === key);
}

export function publicCatalog() {
  return RUNBOOKS.map((r) => ({
    key: r.key,
    name: r.name,
    description: r.description,
    risk: r.risk,
  }));
}
