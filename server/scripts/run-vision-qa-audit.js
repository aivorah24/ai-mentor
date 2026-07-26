/**
 * run-vision-qa-audit.js — drive the real app in a headless browser and check
 * every student-facing surface of a lesson: Learn, Listen, Ask Aivorah,
 * Practice, View in Book, and the AI Tutor buttons.
 *
 * Auth: logs in fresh each run with the seeded test student. Reusing a saved
 * storageState does NOT work here — Firebase v9 keeps its session in IndexedDB,
 * which Playwright's storageState does not capture, so a "saved" session silently
 * lands on the login screen instead.
 *
 *   node scripts/run-vision-qa-audit.js --grades 11 --per-grade 3
 *   node scripts/run-vision-qa-audit.js --grades 1,6,11 --headed
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:3006');
const GRADES = (arg('--grades', '11') || '').split(',').map(n => parseInt(n, 10)).filter(Boolean);
const PER_GRADE = parseInt(arg('--per-grade', '2'), 10);
const HEADED = process.argv.includes('--headed');
const EMAIL = process.env.PW_EMAIL || 'test.student@aivorah.local';
const PASSWORD = process.env.PW_PASSWORD || 'AivorahTest#2026';
const OUT = path.resolve(__dirname, '..', '..', 'STRICT_E2E_NCERT_AUDIT_REPORT.md');
const SHOTS = path.resolve(__dirname, '..', '..', 'test-results', 'vision-qa');

async function login(page) {
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3500);

  // Already signed in from a previous step in this browser context?
  if (await page.locator('text=/Good (morning|afternoon|evening)/i').count()) return true;

  const marketing = page.frames().find(f => f.url().includes('landing.html'));
  const root = marketing || page;
  const loginBtn = root.getByText('Login', { exact: true }).first();
  if (await loginBtn.count()) { await loginBtn.click(); await page.waitForTimeout(1800); }

  const email = page.locator('input[type="email"], input[placeholder*="mail" i]').first();
  const pass = page.locator('input[type="password"], input[placeholder*="assword" i]').first();
  if (!(await email.count())) return false;
  await email.fill(EMAIL);
  await pass.fill(PASSWORD);
  await page.locator('text=/^(Sign In|Log in|Login|Continue)$/i').first().click();

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await page.locator('text=/Good (morning|afternoon|evening)/i').count()) return true;
    await page.waitForTimeout(1500);
  }
  return false;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
  const sb = require('../services/supabase');

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });

  const results = [];
  if (!(await login(page))) {
    await page.screenshot({ path: path.join(SHOTS, 'login-failed.png'), fullPage: true });
    console.error('LOGIN FAILED — see test-results/vision-qa/login-failed.png');
    await browser.close();
    process.exit(1);
  }
  console.log('signed in as', EMAIL);

  for (const grade of GRADES) {
    // Pick real, published topics straight from the database.
    const { data: chs } = await sb.from('syllabus_chapters').select('id,subject,title').eq('grade', `Grade ${grade}`).limit(200);
    const picked = [];
    for (const ch of chs || []) {
      if (picked.length >= PER_GRADE) break;
      const { data: tps } = await sb.from('syllabus_topics').select('id,name').eq('chapter_id', ch.id).limit(1);
      const tp = (tps || [])[0];
      if (!tp) continue;
      const { data: res } = await sb.from('topic_resources')
        .select('static_payload').eq('topic_id', tp.id).eq('resource_type', 'AI_EXPLANATION').eq('status', 'READY').maybeSingle();
      if (!res) continue;
      picked.push({ grade, subject: ch.subject, chapter: ch.title, topicId: tp.id, topicName: tp.name, payload: res.static_payload || {} });
    }

    for (const item of picked) {
      const row = { ...item, tabs: {}, buttons: {}, errors: [] };
      const url = `${BASE}/lesson?topicId=${encodeURIComponent(item.topicId)}&topicName=${encodeURIComponent(item.topicName)}&subject=${encodeURIComponent(item.subject)}&grade=${encodeURIComponent('Grade ' + grade)}`;
      try {
        await page.goto(url);
        await page.waitForTimeout(4000);
        const body = await page.locator('body').innerText();

        // Tabs / surfaces
        row.tabs.Learn = body.length > 200 && !/Illustration coming soon/i.test(body);
        for (const label of ['Listen', 'Ask Aivorah', 'Practice', 'View in Book']) {
          const el = page.getByText(label, { exact: false }).first();
          row.tabs[label] = (await el.count()) > 0;
        }
        // Maths must NOT expose a Listen stage.
        if (/math/i.test(item.subject)) row.tabs['Listen (should be absent)'] = !row.tabs.Listen;

        // AI Tutor buttons live INSIDE the tutor panel, not on the Learn view —
        // searching the default DOM found none of them and read as a total
        // failure. Open the tab first, then assert.
        for (const tab of ['Ask Aivorah', 'AI Tutor', 'Ask']) {
          const t = page.getByText(tab, { exact: false }).first();
          if (await t.count()) {
            await t.click().catch(() => {});
            await page.waitForTimeout(2500);
            break;
          }
        }
        await page.screenshot({ path: path.join(SHOTS, `g${grade}-${item.subject.replace(/\W+/g, '')}-tutor.png`) });

        for (const label of ['Give me a hint', 'Show another example', 'Explain step-by-step', 'Explain differently']) {
          row.buttons[label] = (await page.getByText(label, { exact: false }).first().count()) > 0;
        }

        // Click one and confirm the panel actually responds, rather than only
        // confirming a button exists.
        const firstBtn = ['Give me a hint', 'Explain step-by-step', 'Show another example']
          .map(l => page.getByText(l, { exact: false }).first());
        for (const b of firstBtn) {
          if (await b.count()) {
            const before = (await page.locator('body').innerText()).length;
            await b.click().catch(() => {});
            await page.waitForTimeout(6000);
            const after = (await page.locator('body').innerText()).length;
            row.tutorResponds = after > before + 40;
            break;
          }
        }

        row.genericTitle = /^chapter\s*\d+$/i.test(String(item.chapter).trim());
        row.isSample = !!item.payload.isSample;
        await page.screenshot({ path: path.join(SHOTS, `g${grade}-${item.subject.replace(/\W+/g, '')}-${item.topicId.slice(0, 6)}.png`), fullPage: false });
      } catch (e) {
        row.errors.push(e.message.slice(0, 140));
      }
      results.push(row);
      process.stdout.write(`\rG${grade} ${item.subject} · ${results.length} checked      `);
    }
  }

  await browser.close();

  const L = [];
  L.push('# Strict E2E NCERT Audit', '', `Generated: ${new Date().toISOString()}`, '');
  L.push(`Signed in as \`${EMAIL}\` and driven through the real UI in Chromium.`, '');
  L.push('## Per lesson', '');
  L.push('| Grade | Subject | Topic | Learn | Listen | Ask | Practice | Book | Sample | Generic title |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  const tick = v => (v ? 'yes' : 'NO');
  for (const r of results) {
    L.push(`| G${r.grade} | ${r.subject} | ${String(r.topicName).slice(0, 28)} | ${tick(r.tabs.Learn)} | ${tick(r.tabs.Listen)} | ${tick(r.tabs['Ask Aivorah'])} | ${tick(r.tabs.Practice)} | ${tick(r.tabs['View in Book'])} | ${r.isSample ? 'sample' : 'real'} | ${r.genericTitle ? 'YES' : 'no'} |`);
  }
  const btnNames = ['Give me a hint', 'Show another example', 'Explain step-by-step', 'Explain differently'];
  L.push('', '## AI Tutor buttons present', '');
  L.push('| Button | Found on |'); L.push('|---|---|');
  for (const b of btnNames) L.push(`| ${b} | ${results.filter(r => r.buttons[b]).length} / ${results.length} lessons |`);
  if (consoleErrors.length) {
    L.push('', `## Browser console errors (${consoleErrors.length})`, '');
    [...new Set(consoleErrors)].slice(0, 20).forEach(e => L.push(`- \`${e}\``));
  }
  fs.writeFileSync(OUT, L.join('\n'));
  console.log(`\n\nlessons checked: ${results.length}`);
  console.log(`report -> ${OUT}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
