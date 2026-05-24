import { expect, test } from "@playwright/test";

/**
 * Phase 21 — Auth + smoke E2E tests.
 *
 * Uses the seeded Acme org. If the seed has been altered, update the
 * credentials block below to match.
 */

const ACME = {
  orgSlug: "acme",
  admin: { email: "admin@relay.io",    password: "relay1234" },
  agent: { email: "agent@relay.io",    password: "relay1234" },
  employee: { email: "employee@relay.io", password: "relay1234" },
};

async function login(page: import("@playwright/test").Page, user: { email: string; password: string }) {
  await page.goto(`/login/${ACME.orgSlug}`);
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${ACME.orgSlug}(/.*)?$`));
}

test.describe("Authentication", () => {
  test("admin can log in to Acme", async ({ page }) => {
    await login(page, ACME.admin);
    // Sidebar should show ADMIN-only links once logged in.
    await expect(page.getByRole("link", { name: /organization/i })).toBeVisible();
  });

  test("rejects wrong password", async ({ page }) => {
    await page.goto(`/login/${ACME.orgSlug}`);
    await page.getByLabel(/email/i).fill(ACME.admin.email);
    await page.getByLabel(/password/i).fill("not-the-password");
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    // Should stay on the login page with an error.
    await expect(page).toHaveURL(/\/login\/acme/);
  });
});

test.describe("Sidebar navigation", () => {
  test.beforeEach(async ({ page }) => { await login(page, ACME.admin); });

  test("can navigate to every primary section", async ({ page }) => {
    const sections = ["Tickets", "Knowledge", "Detections", "Workflows", "ML Models", "Organization"];
    for (const name of sections) {
      await page.getByRole("link", { name }).click();
      // Each page renders a Header with the section title.
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
  });
});
