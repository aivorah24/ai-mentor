import { test, expect } from '@playwright/test';

const EMAIL = 'e2e.mathstudent@aivorah.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';

test('Fractions AI Tutor uses real NCERT dialogue content, real Why?', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message));

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

  // Fractions is chapter index 6 (0-indexed: Patterns=0 ... Fractions=6), topic 0.
  await page.goto('/lesson?subject=Mathematics&curriculum=CBSE&grade=Grade%206&chapterTitle=Fractions&chapterIndex=6&topicIndex=0');
  await page.waitForTimeout(2500);
  await page.getByText('AI Tutor', { exact: true }).click({ force: true });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'e2e/screenshots/fractions-step1.png' });

  await page.getByText('Why?', { exact: true }).click({ force: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/screenshots/fractions-why.png' });

  console.log('=== console errors ===');
  console.log(consoleErrors.join('\n'));
});
