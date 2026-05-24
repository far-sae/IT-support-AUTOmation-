# Relay — Compliance work product

This folder contains the security + compliance documentation an auditor or
customer's security team would review. **None of this is certification.**
SOC2 / HIPAA / ISO 27001 require human auditors over months; this is the
**preparation work** that makes that audit go fast.

## Files

| File | Purpose |
|---|---|
| [soc2-controls.md](soc2-controls.md) | SOC2 Trust Services Criteria mapped to code/process |
| [hipaa-controls.md](hipaa-controls.md) | HIPAA technical safeguards (§164.312) → code |
| [owasp-top10-review.md](owasp-top10-review.md) | OWASP top-10 review against the current codebase |
| [threat-model.md](threat-model.md) | STRIDE-style threat model |
| [data-flow.md](data-flow.md) | Data-flow diagram (text + mermaid) |

## How to use this with an auditor

1. **Print this folder + the SOC2 controls matrix.** They'll ask for it.
2. **Walk every "Evidence" reference.** Each one points at a code file,
   migration, or test. An auditor wants to be able to verify each claim.
3. **Document gaps.** Where a control says "not yet implemented", say so
   honestly. Auditors are not surprised by gaps in early-stage products;
   they're surprised by gaps that aren't acknowledged.

## What's still missing (be honest with customers about this)

- **No external penetration test yet.** Schedule one before any
  enterprise sale; we recommend the standard CREST-certified providers.
- **No SBOM signing pipeline.** Generate one with `npm sbom` + Syft for
  the Docker images; sign with cosign once in production.
- **DPIA + DPA templates for GDPR** — these are organisation-specific and
  out of scope here. Use a privacy lawyer; do not copy boilerplate from
  the internet.
- **Continuous monitoring** (Drata / Vanta / Tugboat) — set up as soon as
  there's a paying customer.
