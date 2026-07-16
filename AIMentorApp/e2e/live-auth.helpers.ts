import { Page, Frame, expect } from '@playwright/test';

/**
 * aivorah.ai's landing screen is composed of two frames:
 *  - the top-level frame (the actual React app, incl. LoginModal)
 *  - an embedded `landing.html` iframe (marketing hero) that posts
 *    { mode: 'login' } to the parent on "Login" click to trigger the modal
 * Locally (Expo dev server) there's no iframe — "Login" is a button on the page itself.
 */
export async function openLoginModal(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const marketingFrame: Frame | undefined = page
    .frames()
    .find(f => f.url().includes('landing.html'));

  if (marketingFrame) {
    await marketingFrame.getByText('Login', { exact: true }).first().click();
  } else {
    await page.getByText('Login', { exact: true }).first().click();
  }

  await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 10_000 });
}
