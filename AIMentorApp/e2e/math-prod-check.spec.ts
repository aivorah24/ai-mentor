import { test, expect } from '@playwright/test';

const EMAIL = 'e2e.mathstudent@aivorah.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';

test('Mathematics syllabus on the :3006 production-style bundle', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('http://localhost:3006/');
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

  await page.goto('http://localhost:3006/learning-paths');
  await page.waitForTimeout(2500);
  await page.getByText('Mathematics', { exact: false }).first().click({ force: true });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'e2e/screenshots/prod-check.png' });
  console.log('URL:', page.url());
});
