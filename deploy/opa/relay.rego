# Relay — sample OPA policy.
#
# Deploy this bundle to your OPA instance and point Relay at it:
#
#   OPA_URL=http://opa:8181
#   OPA_DECISION_PATH=relay/allow
#
# Decision document: data.relay.allow
#
#   { "allow": true }                                        → permit
#   { "allow": false, "reason": "...", "escalate": false }   → deny
#
# OPA can only ADD denials on top of the built-in TypeScript policies —
# the engine consults OPA only when every built-in policy ALLOWed. So
# put org-specific / time-sensitive / contractual constraints here.

package relay

import future.keywords.if
import future.keywords.in

# Default to allow when no rule matches. The engine treats a missing
# decision document as ALLOW too — both paths are safe.
default allow := {"allow": true}

# ──────────────────────────────────────────────────────────────────
# Examples — uncomment + tailor to your environment.
# ──────────────────────────────────────────────────────────────────

# 1. Block every action during a stated change-freeze window.
#
# allow := {"allow": false, "reason": "change-freeze 2026-12-20 → 2026-12-26", "escalate": true} if {
#   t := time.parse_rfc3339_ns(input.now)
#   t >= time.parse_rfc3339_ns("2026-12-20T00:00:00Z")
#   t <  time.parse_rfc3339_ns("2026-12-27T00:00:00Z")
# }

# 2. Block firewall_block_ip against any RFC1918 private range.
#
# allow := {"allow": false, "reason": "won't block RFC1918 private space", "escalate": false} if {
#   input.runbook.key == "firewall_block_ip"
#   net.cidr_contains("10.0.0.0/8",     input.ticket.suspectIp)
# }
# allow := {"allow": false, "reason": "won't block RFC1918 private space", "escalate": false} if {
#   input.runbook.key == "firewall_block_ip"
#   net.cidr_contains("192.168.0.0/16", input.ticket.suspectIp)
# }

# 3. terraform_apply is only allowed from senior-team submitters.
#
# senior_emails := {"sre-lead@acme.io", "platform-lead@acme.io"}
#
# allow := {"allow": false, "reason": "terraform restricted to SRE leads", "escalate": true} if {
#   input.runbook.key == "terraform_apply"
#   not senior_emails[input.ticket.submitterEmail]
# }
