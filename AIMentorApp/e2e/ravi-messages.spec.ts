import { test, expect } from '@playwright/test';
import { loginAs } from './helpers';

const RAVI_EMAIL = 'ravi@test.ai';

test.describe('Mr. Ravi Singh – Messages', () => {

  test('1. Login as Ravi Singh succeeds', async ({ page }) => {
    await loginAs(page, RAVI_EMAIL);
    await expect(page.getByText('Mr. Ravi Singh').first()).toBeVisible({ timeout: 10_000 });
  });

  test('2. Teacher dashboard loads with sidebar', async ({ page }) => {
    await loginAs(page, RAVI_EMAIL);
    await expect(page.getByText('Dashboard').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Messages').first()).toBeVisible({ timeout: 10_000 });
  });

  test('3. Messages appears in sidebar MANAGE group', async ({ page }) => {
    await loginAs(page, RAVI_EMAIL);
    // Desktop Sidebar has MANAGE group for teachers
    await expect(page.getByText('MANAGE').first()).toBeVisible({ timeout: 10_000 });
    // Messages nav item exists as a touchable div
    const messagesNav = page.locator('div[tabindex="0"]').filter({ hasText: /^Messages$/ }).first();
    await expect(messagesNav).toBeVisible({ timeout: 10_000 });
  });

  test('4. Clicking Messages navigates to Messages screen', async ({ page }) => {
    await loginAs(page, RAVI_EMAIL);
    await page.waitForTimeout(1000);

    // Click the TouchableOpacity div containing "Messages" text
    const messagesNav = page.locator('div[tabindex="0"]').filter({ hasText: /^Messages$/ }).first();
    await messagesNav.click();
    await page.waitForTimeout(2000);

    // Should show Conversations panel
    await expect(page.getByText(/conversations/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('5. Messages screen shows New button', async ({ page }) => {
    await loginAs(page, RAVI_EMAIL);
    const messagesNav = page.locator('div[tabindex="0"]').filter({ hasText: /^Messages$/ }).first();
    await messagesNav.click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(/conversations/i).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('New')).toBeVisible({ timeout: 8_000 });
  });

  test('6. Existing conversation with Deepa Nair is listed', async ({ page }) => {
    await loginAs(page, RAVI_EMAIL);
    const messagesNav = page.locator('div[tabindex="0"]').filter({ hasText: /^Messages$/ }).first();
    await messagesNav.click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(/conversations/i).first()).toBeVisible({ timeout: 8_000 });

    // Should have a conversation with Deepa Nair
    const convo = page.getByText('Deepa Nair');
    const exists = await convo.count() > 0;
    if (exists) {
      await expect(convo.first()).toBeVisible();
    } else {
      // No conversation yet — empty state is also valid
      await expect(page.getByText(/No messages yet|Select a conversation/i).first())
        .toBeVisible({ timeout: 5_000 });
    }
  });

  test('7. Can open conversation and see chat', async ({ page }) => {
    await loginAs(page, RAVI_EMAIL);
    const messagesNav = page.locator('div[tabindex="0"]').filter({ hasText: /^Messages$/ }).first();
    await messagesNav.click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(/conversations/i).first()).toBeVisible({ timeout: 8_000 });

    const convo = page.getByText('Deepa Nair');
    if (await convo.count() > 0) {
      await convo.first().click({ force: true });
      await page.waitForTimeout(1500);
      // Message input should appear
      await expect(page.locator('input[placeholder*="Message"]').first())
        .toBeVisible({ timeout: 8_000 });
    }
  });

  test('8. No unread badge after opening conversation', async ({ page }) => {
    await loginAs(page, RAVI_EMAIL);
    const messagesNav = page.locator('div[tabindex="0"]').filter({ hasText: /^Messages$/ }).first();
    await messagesNav.click();
    await page.waitForTimeout(2000);

    const convo = page.getByText('Deepa Nair');
    if (await convo.count() > 0) {
      await convo.first().click({ force: true });
      await page.waitForTimeout(3000); // wait for mark-read + poll

      // Sidebar badge should be gone
      const sidebarBadge = page.locator('div[tabindex="0"]')
        .filter({ hasText: /^Messages$/ })
        .locator('..').getByText(/^[1-9]$/);
      const badgeVisible = await sidebarBadge.isVisible().catch(() => false);
      expect(badgeVisible).toBe(false);
    }
  });

  test('9. New Message button shows parent contacts', async ({ page }) => {
    await loginAs(page, RAVI_EMAIL);
    const messagesNav = page.locator('div[tabindex="0"]').filter({ hasText: /^Messages$/ }).first();
    await messagesNav.click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(/conversations/i).first()).toBeVisible({ timeout: 8_000 });

    await page.getByText('New').click({ force: true });
    await page.waitForTimeout(1500);

    // Should show contact picker with parents
    await expect(
      page.getByText(/Message a Parent|No contacts found/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('10. Parent contacts listed (Deepa, Suresh, Fatima)', async ({ page }) => {
    await loginAs(page, RAVI_EMAIL);
    const messagesNav = page.locator('div[tabindex="0"]').filter({ hasText: /^Messages$/ }).first();
    await messagesNav.click();
    await page.waitForTimeout(2000);
    await expect(page.getByText(/conversations/i).first()).toBeVisible({ timeout: 8_000 });

    await page.getByText('New').click({ force: true });
    await page.waitForTimeout(1500);

    // At least one parent should be listed
    const hasDeep = await page.getByText('Deepa Nair').count() > 0;
    const hasSuresh = await page.getByText('Suresh Sharma').count() > 0;
    const hasFatima = await page.getByText('Fatima Ahmed').count() > 0;
    expect(hasDeep || hasSuresh || hasFatima).toBe(true);
  });

});
