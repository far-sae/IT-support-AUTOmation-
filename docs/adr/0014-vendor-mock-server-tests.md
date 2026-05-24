# ADR 0014 — Integration tests against in-process vendor mocks

**Status:** Accepted
**Date:** 2026-06-02

## Context

Earlier integration tests mocked `global.fetch` with vitest. That caught
basic call shape but missed contract violations: a missing
`Accept: application/vnd.github+json` header, a wrong URL path component,
a Basic-auth string encoded wrong — all would silently pass.

Real vendor accounts (a ServiceNow PDI, a PaloAlto VM) are an option but
require credentials and rate limits we can't ship to every developer.

## Options considered

- **Keep fetch mocks** — fast but low confidence.
- **Wiremock / msw** — capable but adds a dependency for what is
  fundamentally "boot a tiny HTTP server".
- **Custom mock-server harness** using Node's `http.createServer` — 100
  lines, zero deps, captures every request.

## Decision

Option 3. `server/src/integrations/__test__/mock-server.ts` exports
`withMockServer({handler})` that:

- Boots a Node HTTP server on an ephemeral port
- Captures method / URL / headers / parsed body of every request
- Tears down after the callback returns

Each vendor (`itsm`, `firewall`, `observability`, `opa-github-slack`) has
an `.integration.test.ts` file whose handler implements the vendor's
documented API contract. The real integration client is exercised
end-to-end against this mock.

The Azure Monitor test even **recomputes the HMAC server-side** and
asserts it matches the one sent — proves we're not emitting a fixed
string.

## Consequences

### Positive
- Refactors that break vendor contracts get caught immediately.
- Tests run in the same CI lane as unit tests — no separate environment.
- New integrations cost ~30 lines of mock + tests, no infrastructure.

### Negative
- Doesn't verify against real vendor quirks (rate limits, undocumented
  fields, regional endpoints). For that you still want a smoke test
  against the customer's actual instance during onboarding.
- Mock drift: if the vendor changes their API, our mock won't notice.
  Mitigation: subscribe to vendor changelogs + periodically review.

### Follow-ups
- Add a periodic "real vendor smoke test" CI job that runs against
  Anthropic + GitHub + Slack with read-only credentials.
