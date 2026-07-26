import { test, expect } from '@playwright/test';

const EMAIL = 'e2e.mathstudent@aivorah.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';

test('Tap-to-zoom opens the full-size figure', async ({ page }) => {
  test.setTimeout(120000);
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

  await page.goto('/lesson?subject=Mathematics&curriculum=CBSE&grade=Grade%206&chapterTitle=Patterns%20in%20Mathematics&chapterIndex=0&topicIndex=0');
  await page.waitForTimeout(2500);
  await page.getByText('AI Tutor', { exact: true }).click({ force: true });
  await page.waitForTimeout(1500);

  // Tap the figure image to zoom.
  await page.locator('img').first().click({ force: true });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'e2e/screenshots/zoom-open.png' });
});
