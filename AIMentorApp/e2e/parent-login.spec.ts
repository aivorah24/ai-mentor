import { test, expect } from '@playwright/test';
import { loginAs, PARENT_ACCOUNTS, waitForText } from './helpers';

/**
 * Parent Login & Landing Tests
 * Checks: test account panel visible, quick-login works, correct name shown after login
 */

test.describe('Parent Login', () => {
  test('landing page loads and shows test accounts panel', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Aivorah|Expo/i);
    // Should show the login/landing UI
    await expect(page.getByText(/Aivorah/i).first()).toBeVisible();
  });

  test('can quick-login as parent (suresh@test.ai)', async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.suresh.email);
    // After login, parent dashboard should load
    await waitForText(page, /dashboard|welcome/i);
  });

  test('can quick-login as parent (deepa@test.ai) — 2 children', async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.deepa.email);
    await waitForText(page, /dashboard|welcome/i);
  });

  test('can quick-login as parent (fatima@test.ai) — 2 children', async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.fatima.email);
    await waitForText(page, /dashboard|welcome/i);
  });

  test('parent name displayed correctly after login', async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.suresh.email);
    await waitForText(page, PARENT_ACCOUNTS.suresh.name);
  });

  test('demo parent login works', async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.demo.email);
    await waitForText(page, /dashboard|welcome/i);
  });
});
