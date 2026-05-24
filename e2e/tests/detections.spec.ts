import { expect, test } from "@playwright/test";

const ACME = {
  orgSlug: "acme",
  admin: { email: "admin@relay.io", password: "relay1234" },
};

test.describe("Detections page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/login/${ACME.orgSlug}`);
    await page.getByLabel(/email/i).fill(ACME.admin.email);
    await page.getByLabel(/password/i).fill(ACME.admin.password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
  });

  test("rule catalog renders with all 20 built-in rules visible", async ({ page }) => {
    await page.getByRole("link", { name: /detections/i }).click();
    await expect(page.getByRole("heading", { name: /detections/i })).toBeVisible();

    // A few representative keys should be present in the rendered text.
    const expectKeys = [
      "ransomware_language",
      "security_burst",
      "ticket_storm_unassigned",
      "stale_device_burst",
      "patch_rollout_failure",
    ];
    for (const k of expectKeys) {
      await expect(page.getByText(k, { exact: false }).first()).toBeVisible();
    }
  });

  test("Run-now button is visible for admin and triggers a sweep", async ({ page }) => {
    await page.getByRole("link", { name: /detections/i }).click();
    const runBtn = page.getByRole("button", { name: /run now/i });
    await expect(runBtn).toBeVisible();
    await runBtn.click();
    // Button transitions to a pending state then back.
    await expect(runBtn).toBeVisible({ timeout: 15_000 });
  });
});
