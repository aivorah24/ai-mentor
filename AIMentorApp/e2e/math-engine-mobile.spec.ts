import { test, expect } from '@playwright/test';

const EMAIL = 'e2e.mathstudent@aivorah.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';

test('MathLessonScreen renders on a narrow viewport', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 800 }); // log in at desktop size first
  await page.goto('/');
  await page.waitForTimeout(3000);
  const marketingFrame = page.frames().find(f => f.url().includes('landing.html'));
  if (marketingFrame) await marketingFrame.getByText('Login', { exact: true }).first().click();
  else await page.getByText('Login', { exact: true }).first().click();
  await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('you@example.com').fill(EMAIL);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByText('Sign In', { exact: true }).click();
  await expect(page.getByText('Welcome back')).not.toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1000);

  await page.setViewportSize({ width: 390, height: 844 }); // iPhone 12-ish
  await page.goto('/math-lesson?grade=Grade%206&subject=Mathematics&topic=fegp107&curriculum=NCERT');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'e2e/screenshots/mobile-concept.png' });

  // Advance to the multi-step guided-solution scene using the actual arrow icon.
  const nextArrow = page.locator('svg').last();
  for (let i = 0; i < 8; i++) {
    await nextArrow.click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.screenshot({ path: 'e2e/screenshots/mobile-steps.png' });
});
