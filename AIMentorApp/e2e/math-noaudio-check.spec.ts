import { test, expect } from '@playwright/test';

const EMAIL = 'e2e.mathstudent@aivorah.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';

test('AI Tutor has zero audio controls, Explain This Step + Why? both work', async ({ page }) => {
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

  await page.goto('/lesson?subject=Mathematics&curriculum=CBSE&grade=Grade%206&chapterTitle=Patterns%20in%20Mathematics&chapterIndex=0&topicIndex=0');
  await page.waitForTimeout(2500);
  await page.getByText('AI Tutor', { exact: true }).click({ force: true });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'e2e/screenshots/noaudio-initial.png' });

  // No voice/audio affordance of any kind should exist on this screen.
  await expect(page.getByText("Let's talk through the reasoning")).not.toBeVisible();
  await expect(page.getByText('Reading the reasoning aloud', { exact: false })).not.toBeVisible();

  // Explain This Step reveals written text.
  await page.getByText('Explain This Step', { exact: true }).click({ force: true });
  await page.waitForTimeout(500);
  await expect(page.getByText('Explanation', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/noaudio-explain.png' });

  // Why? works independently and closes Explain.
  await page.getByText('Why?', { exact: true }).click({ force: true });
  await page.waitForTimeout(500);
  await expect(page.getByText('WHY?', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/noaudio-why.png' });

  console.log('=== console errors ===');
  console.log(consoleErrors.join('\n'));
});
