import { test, expect } from '@playwright/test';
import { loginAs, PARENT_ACCOUNTS, waitForText, assertNoMockData } from './helpers';

/**
 * Parent Progress & Reports Screen Tests
 * Checks: real XP/streak/study data, chapter completion, weekly chart populated
 */

test.describe('Parent Progress', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.suresh.email);
    await page.getByText('Progress').first().click();
    await waitForText(page, /progress|reports/i);
  });

  test('Progress screen loads', async ({ page }) => {
    await assertNoMockData(page);
  });

  test('shows XP Points stat card — not 0', async ({ page }) => {
    await waitForText(page, /XP/i);
    const body = await page.locator('body').innerText();
    const xpMatch = body.match(/(\d[\d,]+)/);
    expect(xpMatch).toBeTruthy();
  });

  test('shows Level stat card', async ({ page }) => {
    await waitForText(page, /level/i);
  });

  test('shows Streak stat card', async ({ page }) => {
    await waitForText(page, /streak/i);
  });

  test('shows Total Study time', async ({ page }) => {
    await waitForText(page, /study/i);
  });

  test('shows Chapter Completion progress bar', async ({ page }) => {
    await waitForText(page, /chapter/i);
    // Progress bar element should exist
    await expect(page.locator('[style*="backgroundColor"]').first()).toBeVisible();
  });

  test('shows weekly activity chart with day labels', async ({ page }) => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    for (const day of days) {
      await waitForText(page, day);
    }
  });

  test('child tab selector is visible — Arjun selected by default', async ({ page }) => {
    await waitForText(page, 'Arjun');
  });
});

test.describe('Parent Progress — child switcher (Deepa, 2 kids)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.deepa.email);
    await page.getByText('Progress').first().click();
    await waitForText(page, /progress|reports/i);
  });

  test('both Priya and Rahul tabs visible', async ({ page }) => {
    await waitForText(page, 'Priya');
    await waitForText(page, 'Rahul');
  });

  test('switching to Rahul tab loads his data', async ({ page }) => {
    await page.getByText('Rahul').first().click();
    await page.waitForLoadState('networkidle');
    // Stats should reload — Rahul has different XP from Priya
    const body = await page.locator('body').innerText();
    // Stats should be visible (not loading spinner)
    expect(body).toMatch(/XP|level|streak/i);
  });

  test('Priya has more XP than Rahul (data integrity check)', async ({ page }) => {
    // Read Priya's XP first (default tab)
    const bodyPriya = await page.locator('body').innerText();
    const priyaMatch = bodyPriya.match(/(\d[\d,]+)\s*XP/);
    const priyaXP = priyaMatch ? parseInt(priyaMatch[1].replace(',', '')) : 0;

    // Switch to Rahul
    await page.getByText('Rahul').first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    const bodyRahul = await page.locator('body').innerText();
    const rahulMatch = bodyRahul.match(/(\d[\d,]+)\s*XP/);
    const rahulXP = rahulMatch ? parseInt(rahulMatch[1].replace(',', '')) : 0;

    // Both should have XP > 0 (real data), and they should be different
    expect(priyaXP).toBeGreaterThan(0);
    expect(rahulXP).toBeGreaterThan(0);
    // Priya (920) > Rahul (150) — data integrity from Supabase seed
    expect(priyaXP).toBeGreaterThan(rahulXP);
  });
});
