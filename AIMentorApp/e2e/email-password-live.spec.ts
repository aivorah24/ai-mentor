import { test, expect } from '@playwright/test';
import { openLoginModal } from './live-auth.helpers';

/**
 * Email/password login against the live site.
 *
 * Needs a REAL account that already exists on aivorah.ai (this test does not
 * create one — creating throwaway prod accounts isn't something to do without
 * asking). Set before running:
 *   E2E_TEST_EMAIL, E2E_TEST_PASSWORD          (required — required role account)
 *   E2E_TEST_NAME                              (optional — asserts the exact
 *                                                display name lands post-login)
 *
 * Example:
 *   E2E_TEST_EMAIL=parent@example.com E2E_TEST_PASSWORD=xxxx \
 *     npx playwright test e2e/email-password-live.spec.ts --config=playwright.config.ts
 *   (with PW_BASE_URL=https://aivorah.ai if not already the default)
 */
const EMAIL = process.env.E2E_TEST_EMAIL;
const PASSWORD = process.env.E2E_TEST_PASSWORD;
const NAME = process.env.E2E_TEST_NAME;

test.describe('Email/password login', () => {
  test('signs in with valid email/password and lands on the dashboard', async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run this against a real account');
    await openLoginModal(page);

    await page.getByPlaceholder('you@example.com').fill(EMAIL!);
    await page.getByPlaceholder('••••••••').fill(PASSWORD!);
    await page.getByText('Sign In', { exact: true }).click();

    // Modal should close and the app chrome (sidebar/drawer) should replace the landing hero.
    await expect(page.getByText('Welcome back')).not.toBeVisible({ timeout: 15_000 });

    if (NAME) {
      await expect(page.getByText(NAME).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test('rejects an invalid password with a visible error', async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run this against a real account');
    await openLoginModal(page);

    await page.getByPlaceholder('you@example.com').fill(EMAIL!);
    await page.getByPlaceholder('••••••••').fill('definitely-wrong-password-123');
    await page.getByText('Sign In', { exact: true }).click();

    await expect(page.locator('text=/invalid|incorrect|wrong/i').first()).toBeVisible({ timeout: 10_000 });
    // Should NOT have logged in
    await expect(page.getByText('Welcome back')).toBeVisible();
  });

  test('rejects empty fields with a validation message', async ({ page }) => {
    await openLoginModal(page);
    await page.getByText('Sign In', { exact: true }).click();
    await expect(page.getByText(/fill in all fields/i)).toBeVisible({ timeout: 5_000 });
  });
});
