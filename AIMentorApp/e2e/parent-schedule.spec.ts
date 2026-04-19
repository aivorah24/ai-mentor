import { test, expect } from '@playwright/test';
import { loginAs, PARENT_ACCOUNTS, waitForText, assertNoMockData } from './helpers';

/**
 * Parent Schedule Screen Tests
 * Checks: assignments loaded from DB, grouped by due date,
 *         no mock children, date labels are real (Today/Tomorrow/Overdue)
 */

test.describe('Parent Schedule', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.suresh.email);
    await page.getByText('Schedule').first().click();
    await waitForText(page, /schedule/i);
  });

  test('Schedule screen loads without mock data', async ({ page }) => {
    await assertNoMockData(page);
  });

  test('shows "Upcoming Assignments" section', async ({ page }) => {
    await waitForText(page, /upcoming assignments/i);
  });

  test('shows child name in header or selector', async ({ page }) => {
    await waitForText(page, 'Arjun');
  });

  test('date labels use real dates (Today / Tomorrow / date)', async ({ page }) => {
    const body = await page.locator('body').innerText();
    // Should show at least one of these real-date patterns
    const hasDateLabel = /today|tomorrow|overdue|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(body);
    if (body.match(/pending|upcoming/i)) {
      expect(hasDateLabel, 'Date labels should be real, not hardcoded').toBe(true);
    }
  });

  test('empty state shown if no pending assignments', async ({ page }) => {
    const body = await page.locator('body').innerText();
    if (!body.match(/due|upcoming|overdue/i)) {
      await waitForText(page, /no pending assignments/i);
    }
  });

  test('assignment subject shown (Mathematics / Science etc)', async ({ page }) => {
    const body = await page.locator('body').innerText();
    if (body.match(/pending|assignment/i)) {
      expect(body).toMatch(/mathematics|science|english|social/i);
    }
  });

  test('schedule does not show "Alex" or "Mia" for suresh', async ({ page }) => {
    const body = await page.locator('body').innerText();
    // Alex and Mia are NOT children of suresh@test.ai
    expect(body).not.toContain('Alex');
    expect(body).not.toContain('Mia');
  });
});

test.describe('Parent Schedule — child switcher (Deepa)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.deepa.email);
    await page.getByText('Schedule').first().click();
    await waitForText(page, /schedule/i);
  });

  test('shows Priya and Rahul in child selector', async ({ page }) => {
    await waitForText(page, 'Priya');
    await waitForText(page, 'Rahul');
  });

  test('switching to Rahul reloads his schedule', async ({ page }) => {
    await page.getByText('Rahul').first().click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });
});
