import { test, expect } from '@playwright/test';

const EMAIL = 'e2e.mathstudent@aivorah.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';

test('CBSE Grade 6 Mathematics syllabus shows real chapters', async ({ page }) => {
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

  await page.goto('/subject-syllabus?subject=Mathematics&curriculum=CBSE&grade=Grade%206');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'e2e/screenshots/math-syllabus.png' });

  // Expand the Fractions chapter (the one real, ready chapter) and open it.
  await page.getByText('Fractions', { exact: false }).first().click({ force: true });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e/screenshots/math-syllabus-fractions-open.png' });
});
