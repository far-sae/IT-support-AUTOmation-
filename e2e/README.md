# Relay — E2E tests (Playwright)

End-to-end browser tests for the critical user journeys.

## Run

```bash
cd e2e
npm install
npm run install:browsers   # one-time: downloads Chromium
npm test                   # headless against http://localhost:5173
npm run test:headed        # watch the browser
npm run test:debug         # step through

# Against a different env:
BASE_URL=https://relay.acme.io npm test
```

## What's covered

- **auth.spec.ts**: login + bad-password rejection + sidebar nav for ADMIN
- **ticket-flow.spec.ts**: employee files a password-reset ticket, autopilot acts, reply visible
- **detections.spec.ts**: detection rules render, admin can trigger a sweep

## What's NOT covered

These are the "happy path" + a couple of friction points. They are not a substitute for:
- Cross-browser testing (only chromium currently)
- Mobile / responsive testing
- Visual-regression testing (no Percy / Chromatic)
- Accessibility audits beyond what Playwright auto-flags
- API contract testing (vitest integration tests in server/ cover that)
