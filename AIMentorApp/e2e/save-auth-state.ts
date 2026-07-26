/**
 * save-auth-state.ts — capture a signed-in session for Playwright, headlessly.
 *
 * The founder account signs in with Google only, and Google blocks automated
 * browsers, so tests cannot use it. A dedicated credentialed test student is
 * seeded instead (Firebase auth + Supabase profile) and logged in here through
 * the app's own email/password form — the real login path, not a mocked one.
 *
 *   node e2e/save-auth-state.ts
 *   PW_EMAIL=... PW_PASSWORD=... PW_BASE_URL=http://localhost:3006 node e2e/save-auth-state.ts
 *   node e2e/save-auth-state.ts --headed        # watch it, to debug a failure
 */
import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.PW_BASE_URL || 'http://localhost:3006';
const EMAIL = process.env.PW_EMAIL || 'test.student@aivorah.local';
const PASSWORD = process.env.PW_PASSWORD || 'AivorahTest#2026';
const HEADED = process.argv.includes('--headed');
const OUT = path.resolve(__dirname, '.auth', 'user.json');

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)); });

  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3500);

  // The landing page is either the app itself or a marketing iframe that posts
  // {mode:'login'} to the parent — handle both.
  const marketing = page.frames().find(f => f.url().includes('landing.html'));
  const root: any = marketing || page;
  const loginBtn = root.getByText('Login', { exact: true }).first();
  if (await loginBtn.count()) { await loginBtn.click(); await page.waitForTimeout(1800); }

  const email = page.locator('input[type="email"], input[placeholder*="mail" i]').first();
  const pass = page.locator('input[type="password"], input[placeholder*="assword" i]').first();
  if (!(await email.count()) || !(await pass.count())) {
    await page.screenshot({ path: 'test-results/auth-no-form.png', fullPage: true });
    console.error('Login form not found — see test-results/auth-no-form.png');
    await browser.close();
    process.exit(1);
  }
  await email.fill(EMAIL);
  await pass.fill(PASSWORD);
  await page.locator('text=/^(Sign In|Log in|Login|Continue)$/i').first().click();

  // Wait for Firebase to persist a signed-in user rather than a fixed sleep.
  const deadline = Date.now() + 60_000;
  let signedIn = false;
  while (Date.now() < deadline) {
    try {
      signedIn = await page.evaluate(() =>
        Object.keys(window.localStorage).some(k => k.startsWith('firebase:authUser:')));
    } catch { /* mid-navigation */ }
    if (signedIn) break;
    await page.waitForTimeout(1500);
  }

  if (!signedIn) {
    const body = await page.locator('body').innerText().catch(() => '');
    await page.screenshot({ path: 'test-results/auth-failed.png', fullPage: true });
    console.error('Sign-in did not complete. Page said:\n' + body.slice(0, 400));
    if (errors.length) console.error('console errors:\n  ' + errors.slice(0, 5).join('\n  '));
    await browser.close();
    process.exit(1);
  }

  await page.waitForTimeout(3000);           // let the profile settle into storage
  await context.storageState({ path: OUT });
  const who = await page.evaluate(() => {
    const k = Object.keys(window.localStorage).find(x => x.startsWith('firebase:authUser:'));
    try { return k ? JSON.parse(window.localStorage[k]).email : null; } catch { return null; }
  });
  console.log(`Saved session for ${who || EMAIL} -> ${OUT}`);
  await browser.close();
})();
