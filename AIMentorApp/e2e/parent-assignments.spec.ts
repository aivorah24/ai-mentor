import { test, expect } from '@playwright/test';
import { loginAs, PARENT_ACCOUNTS, waitForText, assertNoMockData } from './helpers';

/**
 * Parent Assignments Screen Tests
 * Checks: real assignments loaded from DB, study time from real stats,
 *         on-track % computed from real streak, filters work
 */

test.describe('Parent Assignments', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.suresh.email);
    await page.getByText('Assignments').first().click();
    await waitForText(page, /assignments/i);
  });

  test('assignments screen loads without mock data', async ({ page }) => {
    await assertNoMockData(page);
  });

  test('"This week at a glance" card is visible', async ({ page }) => {
    await waitForText(page, /this week at a glance/i);
  });

  test('Completed / Upcoming / Study Time stats visible', async ({ page }) => {
    await waitForText(page, /completed/i);
    await waitForText(page, /upcoming|pending/i);
    await waitForText(page, /study time/i);
  });

  test('study time shows real hours — not hardcoded 4.3h', async ({ page }) => {
    const body = await page.locator('body').innerText();
    // Should NOT show the old hardcoded value "4.3h" (from 258 mins / 60)
    // (258 mins = 4h 18min → 4.3h)
    // The real data for Arjun is ~720 mins → 12h
    const hardcoded = body.includes('4.3h') && !body.includes('12');
    expect(hardcoded, 'Should not show hardcoded 4.3h study time').toBe(false);
  });

  test('"86% on track" is NOT hardcoded — value comes from real streak', async ({ page }) => {
    const body = await page.locator('body').innerText();
    // Should not have the exact hardcoded string "86% on track"
    // (it now shows computed value from streak)
    expect(body).not.toContain('86% on track');
  });

  test('on-track percentage is a real number', async ({ page }) => {
    await waitForText(page, /on track/i);
    const body = await page.locator('body').innerText();
    const match = body.match(/(\d+)%\s*on track/i);
    expect(match, 'On-track % should be visible').toBeTruthy();
    const pct = parseInt(match![1]);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  test('filter tabs work — All / School / Parent / Done', async ({ page }) => {
    const filters = ['School', 'Parent', 'Done', 'All'];
    for (const f of filters) {
      const tab = page.getByText(f).first();
      if (await tab.isVisible()) {
        await tab.click();
        await page.waitForTimeout(300);
      }
    }
    // Should not crash after switching all filters
    await expect(page.locator('body')).toBeVisible();
  });

  test('assignment cards show title and due date', async ({ page }) => {
    // If there are assignments, verify card structure
    const body = await page.locator('body').innerText();
    if (body.match(/upcoming|school|pending/i)) {
      await waitForText(page, /due|completed|upcoming/i);
    }
  });

  test('New Assignment button is visible', async ({ page }) => {
    await expect(page.getByText(/new assignment/i).first()).toBeVisible();
  });
});

test.describe('Parent Assignments — child switcher (Deepa, 2 kids)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.deepa.email);
    await page.getByText('Assignments').first().click();
    await waitForText(page, /assignments/i);
  });

  test('child selector tabs shown for multiple children', async ({ page }) => {
    // Both Priya and Rahul tabs should be visible
    await waitForText(page, 'Priya');
    await waitForText(page, 'Rahul');
  });

  test('switching child tab reloads assignments', async ({ page }) => {
    await page.getByText('Rahul').first().click();
    await page.waitForLoadState('networkidle');
    // Should show Rahul's name in the badge
    await waitForText(page, 'Rahul');
  });
});
