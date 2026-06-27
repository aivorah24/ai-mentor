const { chromium } = require('playwright');
const TEST_EMAIL = `betatest.${Date.now()}@gmail.com`;
const TEST_PASS = 'Test1234!';
const TEST_NAME = 'Beta Tester';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const log = [];
  page.on('console', m => { if (m.text().includes('[Auth]')) log.push(m.text()); });

  await page.goto('http://localhost:3006', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);

  // Step 1: open auth — try common entry buttons
  const tryClick = async (text) => {
    try { await page.getByText(text, { exact: false }).first().click({ timeout: 3000 }); return true; }
    catch { return false; }
  };
  // Open signup. Try "Join Early Access" / "Get Early Access" / "Sign up"
  let opened = await tryClick('Join Early Access') || await tryClick('Get Early Access') || await tryClick('Start Free') || await tryClick('Sign up');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'step1_after_open.png' });
  console.log('TEST_EMAIL=' + TEST_EMAIL);
  console.log('opened entry:', opened);

  // If a role chooser appears, pick "For Students" / Student
  await tryClick('For Students');
  await page.waitForTimeout(800);

  // Try to switch to Sign Up if on login
  await tryClick('Create');  // "Create account" link maybe
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'step2_form.png' });

  // Fill the form by placeholder
  try { await page.getByPlaceholder('Jane Smith').fill(TEST_NAME, { timeout: 3000 }); } catch(e){ console.log('no name field:', e.message); }
  try { await page.getByPlaceholder('you@example.com').first().fill(TEST_EMAIL, { timeout: 3000 }); } catch(e){ console.log('no email field:', e.message); }
  try { await page.getByPlaceholder('At least 6 characters').fill(TEST_PASS, { timeout: 3000 }); } catch(e){ console.log('no pass field:', e.message); }
  await page.screenshot({ path: 'step3_filled.png' });

  // Submit
  await tryClick('Create Free Account');
  await page.waitForTimeout(6000); // allow signup + onAuthStateChanged + guard (300ms) + render
  await page.screenshot({ path: 'step4_after_submit.png' });

  // Check for "Check your inbox"
  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasCheckInbox = /check your inbox/i.test(bodyText);
  console.log('=== RESULT: "Check your inbox" visible =', hasCheckInbox, '===');
  console.log('--- Auth logs ---'); log.forEach(l => console.log(l));

  await browser.close();
})().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exit(1); });
