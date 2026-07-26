import { test, expect } from '@playwright/test';

const EMAIL = 'e2e.mathstudent@aivorah.test';
const PASSWORD = process.env.E2E_PASSWORD || 'E2eTest!2026';

async function login(page: any) {
  await page.goto('/');
  await page.waitForTimeout(3000);
  const marketingFrame = page.frames().find((f: any) => f.url().includes('landing.html'));
  if (marketingFrame) await marketingFrame.getByText('Login', { exact: true }).first().click();
  else await page.getByText('Login', { exact: true }).first().click();
  await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('you@example.com').fill(EMAIL);
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByText('Sign In', { exact: true }).click();
  await expect(page.getByText('Welcome back')).not.toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1000);
}

test('Hint and Show Another Example reveal real content, not chat', async ({ page }) => {
  test.setTimeout(120000);
  const consoleErrors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message));

  await login(page);

  // Topic 1: Fractional Units and Equal Shares
  await page.goto('/lesson?subject=Mathematics&curriculum=CBSE&grade=Grade%206&chapterTitle=Fractions&chapterIndex=6&topicIndex=0');
  await page.waitForTimeout(2500);
  await page.getByText('AI Tutor', { exact: true }).click({ force: true });
  await page.waitForTimeout(1000);

  await page.getByText('Give Me a Hint', { exact: true }).click({ force: true });
  await page.waitForTimeout(500);
  await expect(page.getByText('Hint', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/topic1-hint.png' });

  await page.getByText('Show Another Example', { exact: true }).click({ force: true });
  await page.waitForTimeout(500);
  await expect(page.getByText('Another Example', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/topic1-example.png' });

  // Topic 2: Fractional Units as Parts of a Whole — should have a real figureUrl now.
  await page.goto('/lesson?subject=Mathematics&curriculum=CBSE&grade=Grade%206&chapterTitle=Fractions&chapterIndex=6&topicIndex=1');
  await page.waitForTimeout(2500);
  await page.getByText('AI Tutor', { exact: true }).click({ force: true });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e/screenshots/topic2-figure.png' });

  // Topic 3: Addition and Subtraction — no figure, should show "Example from the book" panel.
  await page.goto('/lesson?subject=Mathematics&curriculum=CBSE&grade=Grade%206&chapterTitle=Fractions&chapterIndex=6&topicIndex=2');
  await page.waitForTimeout(2500);
  await page.getByText('AI Tutor', { exact: true }).click({ force: true });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e/screenshots/topic3-panel.png' });

  console.log('=== console errors ===');
  console.log(consoleErrors.join('\n'));
});
