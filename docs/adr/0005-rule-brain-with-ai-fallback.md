# ADR 0005 — Rule brain first, Claude tool-use as opt-in

**Status:** Accepted
**Date:** 2026-05-22

## Context

The autopilot needs to pick which runbook to fire when a new ticket lands.
Two implementations are reasonable: deterministic rules over keyword
matchers, or an LLM with tool-use for orchestration.

## Options considered

- **AI-only** — Claude tool-use end-to-end. Most flexible but every
  request costs money, has latency, and is hard to test deterministically.
- **Rules-only** — fast, free, fully deterministic, but won't generalise
  to phrasings we didn't anticipate.
- **Hybrid: rule first, AI fallback** — start with the rule brain; let
  admins opt into AI via env. Both paths share the same outcome surface
  so the rest of the system doesn't care which fired.

## Decision

Hybrid. `server/src/brain/index.ts` runs the rule brain by default;
setting `USE_AI_BRAIN=true` + `ANTHROPIC_API_KEY` switches to the
Claude tool-use loop (`runAiBrain`). Both paths share:

- `pickRunbook` for the initial candidate
- `weightConfidence` + ML predict for the blending step
- The same `decideAndExecute` return shape

This means tests of the rule brain don't need AI mocks, and the AI brain
can be turned off mid-incident if cost becomes a concern.

## Consequences

### Positive
- Tests are fast and deterministic.
- The rule brain is good enough for ~80% of real tickets (password
  reset, account unlock, software install, etc.).
- AI brain handles the long tail (ambiguous wording, multi-issue tickets)
  when enabled.

### Negative
- Two code paths to maintain; matchers in `runbooks/*.ts` must work for
  both since the AI brain calls `pickRunbook` as a tool.
- The AI brain can disagree with the rule brain on edge cases — we trust
  the AI when it's on.

### Follow-ups
- Add per-org cost-cap on the AI brain (BRAIN_MAX_ITERATIONS already
  caps per-ticket; consider a daily budget too).
