/**
 * One-off verification walkthrough for the Math Learning Engine prototype.
 * Not part of the regular suite — ad hoc, run manually:
 *   npx playwright test e2e/math-engine-walkthrough.spec.ts --headed=false
 */
import { test, expect } from '@playwright/test';

const EMAIL = 'e2e.mathstudent@aivorah.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';

test('Math Learning Engine end-to-end walkthrough', async ({ page }) => {
  test.setTimeout(180000);
  const consoleErrors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message));

  // Log in first so the auth guard doesn't bounce the deep link.
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

  await page.goto('/math-lesson?grade=Grade%206&subject=Mathematics&topic=fegp107&curriculum=NCERT');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'e2e/screenshots/10-scene-concept.png' });

  const nextButton = page.getByRole('button').last(); // footer's right-arrow is the last button on the page
  // Click "next" through every scene, screenshotting distinct scene kinds.
  for (let i = 0; i < 10; i++) {
    await page.mouse.click(1250, 688); // footer right-arrow position (bottom-right)
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `e2e/screenshots/11-scene-${i}.png` });
  }

  console.log('=== console errors ===');
  console.log(consoleErrors.join('\n'));
});
