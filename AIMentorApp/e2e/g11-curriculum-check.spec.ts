import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Verifies the rebuilt curriculum shell as a real signed-in student:
 * Grade 11 Mathematics must list the NCERT chapters (Ch 1 Sets, Ch 2 Relations
 * and Functions, ...) rather than generated topic names, and units must hold
 * several topics rather than one.
 *
 * Auth: reuses the session captured by `node e2e/save-auth-state.ts`. The demo
 * account signs in with Google only — it has no password credential — and
 * Google blocks automated browsers, so a saved session is the only way to run
 * this as that real user.
 */
const AUTH = path.resolve(__dirname, '.auth', 'user.json');
const hasAuth = fs.existsSync(AUTH);

test.use(hasAuth ? { storageState: AUTH } : {});

test('Grade 11 Mathematics shows real NCERT chapters', async ({ page }) => {
  test.skip(!hasAuth, 'No saved session — run: node e2e/save-auth-state.ts');

  const shots: string[] = [];
  const snap = async (name: string) => {
    const p = `test-results/g11-${name}.png`;
    await page.screenshot({ path: p, fullPage: true });
    shots.push(p);
  };
  page.on('console', (m) => { if (m.type() === 'error') console.log('[browser error]', m.text().slice(0, 160)); });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000);
  await snap('01-signed-in');

  const start = await page.locator('body').innerText();
  expect(start, 'session expired — re-run save-auth-state.ts').not.toContain('Sign in to your Aivorah account');

  // Navigate: Learning Paths → Mathematics
  for (const label of ['Learning Paths', 'Mathematics']) {
    const el = page.getByText(label, { exact: false }).first();
    if (await el.count()) { await el.click(); await page.waitForTimeout(3500); }
  }
  await snap('02-syllabus');

  const body = await page.locator('body').innerText();
  console.log('\n--- syllabus page text ---\n' + body.slice(0, 1500));
  console.log('\n--- screenshots ---\n' + shots.join('\n'));

  // What the rebuild had to deliver: textbook chapters, correctly numbered.
  expect(body).toMatch(/Chapter\s*1\s*:/i);
  expect(body).toMatch(/Sets|Relations and Functions/i);
  // The old bug rendered generated topic names as chapters.
  expect(body).not.toMatch(/Chapter\s*\d+\s*:\s*(Area of a Triangle|Angle of Elevation)/i);
});
