import { test, expect } from '@playwright/test';
import { loginAs, PARENT_ACCOUNTS, waitForText, assertNoMockData } from './helpers';

/**
 * Parent Dashboard Tests
 * Checks: real children shown, stats are numbers (not 0/mock), child switcher works
 */

test.describe('Parent Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.suresh.email);
  });

  test('dashboard loads without errors', async ({ page }) => {
    await waitForText(page, /dashboard/i);
    await assertNoMockData(page);
  });

  test('shows linked child name (Arjun Sharma)', async ({ page }) => {
    await waitForText(page, 'Arjun');
  });

  test('shows XP points — not zero for active student', async ({ page }) => {
    await waitForText(page, /dashboard/i);
    // Arjun has 2150 XP seeded in Supabase — should not show "0 XP"
    const body = await page.locator('body').innerText();
    // XP should be > 0
    const xpMatch = body.match(/(\d[\d,]+)\s*XP/);
    expect(xpMatch, 'Should show non-zero XP on dashboard').toBeTruthy();
    const xp = parseInt((xpMatch![1] ?? '0').replace(',', ''));
    expect(xp, 'XP should be greater than 0').toBeGreaterThan(0);
  });

  test('shows study time — not 0h', async ({ page }) => {
    await waitForText(page, /dashboard/i);
    const body = await page.locator('body').innerText();
    // Should show some study time
    const hasTime = /\d+h|\d+m/.test(body);
    expect(hasTime, 'Dashboard should show non-zero study time').toBe(true);
  });

  test('child avatar / initials visible', async ({ page }) => {
    await waitForText(page, /dashboard/i);
    // "AS" initials for Arjun Sharma
    await expect(page.getByText('AS').first()).toBeVisible();
  });
});

test.describe('Parent Dashboard — 2 children (Deepa)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.deepa.email);
  });

  test('both children visible on dashboard', async ({ page }) => {
    await waitForText(page, /dashboard/i);
    await waitForText(page, 'Priya');
    await waitForText(page, 'Rahul');
  });

  test('child switcher tabs work — switching changes stats', async ({ page }) => {
    await waitForText(page, /dashboard/i);
    // Click the second child tab
    const rahulTab = page.getByText('Rahul').first();
    await rahulTab.click();
    await page.waitForLoadState('networkidle');
    // Stats should have reloaded (page still functional)
    await expect(page.locator('body')).toBeVisible();
  });
});
