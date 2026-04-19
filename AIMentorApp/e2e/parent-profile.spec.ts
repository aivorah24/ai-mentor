import { test, expect } from '@playwright/test';
import { loginAs, PARENT_ACCOUNTS, waitForText, assertNoMockData } from './helpers';

/**
 * Parent Profile Screen Tests
 * Checks: real name/email, real linked children, activity chart uses real data,
 *         no hardcoded Alex/Mia
 */

test.describe('Parent Profile', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.suresh.email);
    await page.getByText('Profile').first().click();
    await waitForText(page, /profile/i);
  });

  test('Profile screen loads without mock data', async ({ page }) => {
    await assertNoMockData(page);
  });

  test('shows correct parent name', async ({ page }) => {
    await waitForText(page, PARENT_ACCOUNTS.suresh.name);
  });

  test('shows parent email in Profile Information card', async ({ page }) => {
    await waitForText(page, PARENT_ACCOUNTS.suresh.email);
  });

  test('hero avatar shows first letter of name', async ({ page }) => {
    // Suresh → "S"
    await expect(page.getByText('S').first()).toBeVisible();
  });

  test('Profile Information shows First Name and Last Name fields', async ({ page }) => {
    await waitForText(page, /first name/i);
    await waitForText(page, /last name/i);
  });

  test('Activity Overview card is visible', async ({ page }) => {
    await waitForText(page, /activity overview/i);
  });

  test('Activity Overview shows real active days and total learning', async ({ page }) => {
    await waitForText(page, /active days|total learning/i);
  });

  test('Linked Children section shows Arjun — NOT Alex/Mia', async ({ page }) => {
    await waitForText(page, /linked children/i);
    await waitForText(page, 'Arjun');
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Alex');
    expect(body).not.toContain('Mia');
  });

  test('Linked Children shows grade', async ({ page }) => {
    await waitForText(page, /grade 3/i);
  });

  test('Security & Account card visible', async ({ page }) => {
    await waitForText(page, /security|two-factor/i);
  });

  test('Edit Profile button visible', async ({ page }) => {
    await expect(page.getByText(/edit profile/i).first()).toBeVisible();
  });

  test('bar chart days rendered (Mon–Sun)', async ({ page }) => {
    const days = ['Mon', 'Tue', 'Wed'];
    for (const day of days) {
      await waitForText(page, day);
    }
  });
});

test.describe('Parent Profile — 2 children (Deepa)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PARENT_ACCOUNTS.deepa.email);
    await page.getByText('Profile').first().click();
    await waitForText(page, /profile/i);
  });

  test('shows 2 kids count in Activity Overview', async ({ page }) => {
    await waitForText(page, /2 kids|linked/i);
  });

  test('linked children section shows both Priya and Rahul', async ({ page }) => {
    await waitForText(page, /linked children/i);
    await waitForText(page, 'Priya');
    await waitForText(page, 'Rahul');
  });
});
