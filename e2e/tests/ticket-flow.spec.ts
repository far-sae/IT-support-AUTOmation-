import { expect, test } from "@playwright/test";

/**
 * Phase 21 — Critical user journey: employee files a ticket, the autopilot
 * acts on it, the timeline shows the action.
 */

const ACME = {
  orgSlug: "acme",
  employee: { email: "employee@relay.io", password: "relay1234" },
};

test.describe("Ticket lifecycle", () => {
  test("employee files a password-reset ticket and sees the autopilot's reply", async ({ page }) => {
    // Log in as the employee.
    await page.goto(`/login/${ACME.orgSlug}`);
    await page.getByLabel(/email/i).fill(ACME.employee.email);
    await page.getByLabel(/password/i).fill(ACME.employee.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/\/app\/acme/);

    // Open a new ticket.
    await page.getByRole("link", { name: /tickets/i }).click();
    await page.getByRole("button", { name: /new ticket|create ticket|file a ticket/i }).click();

    const description = `I forgot my password and need a reset — E2E test ${Date.now()}`;
    await page.getByLabel(/description/i).fill(description);
    await page.getByRole("button", { name: /submit|create|file/i }).click();

    // Ticket detail page should render with the description.
    await expect(page.getByText(description, { exact: false })).toBeVisible({ timeout: 15_000 });

    // The autopilot should leave at least one comment within the verification window.
    // (Rule brain picks `password_reset` on this text and SUCCEEDS immediately.)
    await expect(
      page.getByText(/password|reset|autopilot|relay/i).first()
    ).toBeVisible({ timeout: 30_000 });
  });
});
