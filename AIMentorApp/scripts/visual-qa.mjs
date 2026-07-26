// visual-qa.mjs — Playwright visual-QA harness. Renders a lesson's tabs in a
// headless browser and screenshots them, so the Vision QA agent can LITERALLY
// SEE each grade's pages (styling, layout, understandability) instead of the
// founder screenshotting every grade by hand.
//
//   node scripts/visual-qa.mjs --topicId <id> --topic "<name>" \
//        --grade "Grade 2" --subject Mathematics --curriculum CBSE --out <dir>
//
// Auth: the app reads a cached student profile from localStorage
// (ai_mentor_user_profile). We inject one before load so the deep-linked lesson
// renders without a real Firebase login. Output: <out>/{learn,aitutor,practice}.png
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };

const BASE = arg('--base', 'http://localhost:3006');
const topicId = arg('--topicId');
const topic = arg('--topic', 'Lesson');
const grade = arg('--grade', 'Grade 2');
const subject = arg('--subject', 'Mathematics');
const curriculum = arg('--curriculum', 'CBSE');
const outDir = arg('--out', path.resolve('visual-qa-out'));

if (!topicId) { console.error('need --topicId'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

const profile = {
  name: 'QA Student', grade, curriculum, email: 'qa.student@aivorah.test',
  role: 'student', activeRole: 'student', school: 'QA', schoolId: null,
  onboardingComplete: true, emailVerified: true, accountStatus: 'active',
  roles: ['student'], authProvider: 'password',
};

const qs = new URLSearchParams({ topicId, topicName: topic, subject, curriculum, grade, chapterTitle: topic, qaPreview: '1', qaProfile: JSON.stringify(profile) }).toString();
const url = `${BASE}/lesson?${qs}`;

const shots = [];
async function shot(page, name) {
  const p = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  shots.push(p);
  console.log(`  📸 ${name}.png`);
}
async function clickTab(page, label) {
  // RN-web tabs are Text inside a pressable; the reliable way is to click the
  // text's on-screen coordinates (a plain .click() sometimes lands on an overlay).
  try {
    const el = page.getByText(label, { exact: true }).first();
    await el.waitFor({ state: 'visible', timeout: 4000 });
    const box = await el.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(2200);
      return true;
    }
  } catch {}
  console.log(`  (tab "${label}" not clickable)`);
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();

  // Inject the cached student profile so the app renders as a logged-in student.
  await page.addInitScript((prof) => {
    try {
      localStorage.setItem('ai_mentor_user_profile', JSON.stringify(prof));
      localStorage.setItem('aivorah_last_active_ts', String(Date.now()));
      sessionStorage.setItem('aivorah_auth_this_session', '1');
    } catch (e) {}
  }, profile);

  // Navigate to a lesson URL and CONFIRM we landed on the lesson (the tab bar
  // with "Learn" is present), not the marketing landing page. On a reload the
  // injected session can lose the auth race and bounce to landing — so retry.
  async function gotoLesson(u, label) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      await page.goto(u, { waitUntil: 'networkidle', timeout: 45000 });
      try {
        // The lesson tab bar shows "Learn" AND "AI Tutor"/"Ask Aivorah"; the
        // landing shows "Get Early Access". Wait for the lesson, reject landing.
        await page.waitForFunction(() => {
          const t = document.body.innerText || '';
          // In-app markers: lesson tabs, OR the quiz runner (Practice mode auto-
          // launches it), OR the AI Coach chat (Ask mode).
          const onApp = /Learn with Aivorah|View in Book|AI Tutor|Ask Aivorah|Check Answer|Question \d|MCQ|Start Practice|AI Coach|My Learning Paths/i.test(t);
          const onLanding = /Get Early Access|AI-Powered Learning/i.test(t) && !onApp;
          return onApp && !onLanding;
        }, { timeout: 12000 });
        await page.waitForTimeout(2500);
        return true;
      } catch {
        console.log(`  (${label}: not on lesson yet, retry ${attempt})`);
        await page.waitForTimeout(1500);
      }
    }
    console.log(`  (${label}: gave up — showing whatever rendered)`);
    return false;
  }

  console.log(`Loading ${url}`);
  await gotoLesson(url, 'learn');
  await shot(page, '01-learn');

  // Deep-link each tab via ?mode= (reliable; RN-web tab clicks are flaky headless).
  for (const [mode, name] of [['listen', '02-aitutor'], ['practice', '03-practice']]) {
    await gotoLesson(`${url}&mode=${mode}`, name);
    await shot(page, name);
  }

  await browser.close();
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ topicId, topic, grade, subject, url, shots }, null, 1));
  console.log(`\n✅ ${shots.length} screenshots → ${outDir}`);
})().catch(e => { console.error('visual-qa failed:', e.message); process.exit(1); });
