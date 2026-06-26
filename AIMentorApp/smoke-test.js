/**
 * Aivorah — Pre-deploy SMOKE TEST
 * ---------------------------------
 * Proves the critical user flows work on the BUILT bundle before anything ships.
 * Run against the local production-style server (serves AIMentorApp/dist2):
 *
 *     node smoke-test.js            # expects server on http://localhost:3006
 *     SMOKE_URL=http://… node smoke-test.js
 *
 * Exits 0 only if EVERY check passes; non-zero otherwise. The deploy script
 * refuses to push when this fails — that is what stops fixed bugs from silently
 * regressing on the live URL.
 */
const { chromium } = require('playwright');

const BASE = process.env.SMOKE_URL || 'http://localhost:3006';
// A real linked parent + child in the DB (parentaivorah → Sai Mohan, Grade 4).
const STUDENT = { id: 'ee9cc564-16a5-4795-a61d-f8e91d05ea62', email: 'admin@aivorah.ai', name: 'Sai Mohan', role: 'student', grade: 'Grade 4', curriculum: 'IB PYP', onboardingComplete: true };
const PARENT  = { id: '34183dac-4d5b-4a6a-9bd6-f5c4eab9b8a5', email: 'parentaivorah@gmail.com', name: 'Aivorah Parent', role: 'parent', onboardingComplete: true };

const results = [];
function record(name, ok, detail = '') { results.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  — ' + detail : ''}`); }

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── API checks (deterministic, no UI) ───────────────────────────────────────
async function apiChecks() {
  try {
    const h = await getJSON('/health');
    record('Server health', h.status === 'ok', JSON.stringify(h));
  } catch (e) { record('Server health', false, e.message); }

  // Leaderboard is scoped to the requested grade only (feedback: no all-grades)
  try {
    const lb = await getJSON('/student/leaderboard?limit=20&grade=Grade%204');
    const allG4 = Array.isArray(lb) && lb.length > 0 && lb.every(s => s.grade === 'Grade 4');
    record('Leaderboard scoped to grade', allG4, `${lb.length} rows, grades: ${[...new Set(lb.map(s => s.grade))].join(',')}`);
  } catch (e) { record('Leaderboard scoped to grade', false, e.message); }

  // Leaderboard tabs: grade+school narrows further than grade alone; overall is widest
  try {
    const [gradeOnly, gradeSchool, overall] = await Promise.all([
      getJSON('/student/leaderboard?limit=50&grade=Grade%204'),
      getJSON('/student/leaderboard?limit=50&grade=Grade%204&school=TASARA'),
      getJSON('/student/leaderboard?limit=50'),
    ]);
    const ok = gradeSchool.every(s => s.grade === 'Grade 4') && gradeSchool.length <= gradeOnly.length && overall.length >= gradeOnly.length;
    record('Leaderboard tab scoping (grade+school/overall)', ok, `grade:${gradeOnly.length} grade+school:${gradeSchool.length} overall:${overall.length}`);
  } catch (e) { record('Leaderboard tab scoping (grade+school/overall)', false, e.message); }

  // Lower-grade challenges exist (feedback: add LKG/UKG/Grade1/2)
  for (const [grade, curr] of [['LKG', 'CBSE'], ['UKG', 'CBSE'], ['Grade 1', 'IB PYP'], ['Grade 2', 'ICSE']]) {
    try {
      const ch = await getJSON(`/challenges?grade=${encodeURIComponent(grade)}&curriculum=${encodeURIComponent(curr)}`);
      record(`Challenges exist: ${curr} ${grade}`, Array.isArray(ch) && ch.length > 0, `${ch.length} challenges`);
    } catch (e) { record(`Challenges exist: ${curr} ${grade}`, false, e.message); }
  }

  // Curated questions serve for a lower-grade challenge
  try {
    const q = await (await fetch(`${BASE}/ncert/quiz`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: 'Numbers & Counting', challengeId: 'cbse_lkg_fun', grade: 'LKG' }) })).json();
    record('Lower-grade challenge questions serve', Array.isArray(q.questions) && q.questions.length > 0, `${(q.questions || []).length} questions`);
  } catch (e) { record('Lower-grade challenge questions serve', false, e.message); }

  // Notifications summary endpoint responds with the expected shape
  try {
    const s = await getJSON(`/messages/notifications-summary?userEmail=${encodeURIComponent(PARENT.email)}`);
    const okShape = typeof s.messages === 'number' && typeof s.assignments === 'number' && typeof s.challenges === 'number';
    record('Parent notifications-summary responds', okShape, `messages:${s.messages} assignments:${s.assignments} challenges:${s.challenges}`);
  } catch (e) { record('Parent notifications-summary responds', false, e.message); }

  // Schedule sync is symmetric: an event read back for the student id
  try {
    const ev = await getJSON(`/schedule?studentId=${STUDENT.id}&date=2026-06-26`);
    record('Schedule endpoint responds', Array.isArray(ev), `${Array.isArray(ev) ? ev.length : '?'} events`);
  } catch (e) { record('Schedule endpoint responds', false, e.message); }
}

// ── UI render checks (catch runtime crashes like `isDark is not defined`) ────
async function uiChecks() {
  const browser = await chromium.launch();
  try {
    for (const [profile, routes] of [
      [STUDENT, ['/settings', '/assignments', '/schedule', '/challenges', '/leaderboard']],
      [PARENT,  ['/settings', '/schedule', '/leaderboard']],
    ]) {
      const page = await browser.newPage();
      await page.addInitScript((p) => { try { window.localStorage.setItem('ai_mentor_user_profile', JSON.stringify(p)); } catch {} }, profile);
      for (const route of routes) {
        const errs = [];
        const onErr = (e) => errs.push(e.message);
        page.on('pageerror', onErr);
        try { await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 }); } catch (e) { errs.push('GOTO ' + e.message); }
        await page.waitForTimeout(2000);
        page.off('pageerror', onErr);
        record(`UI renders (${profile.role}) ${route}`, errs.length === 0, errs.slice(0, 1).join(''));
      }
      await page.close();
    }
  } finally { await browser.close(); }
}

(async () => {
  console.log(`\n── Aivorah smoke test → ${BASE} ──\n`);
  await apiChecks();
  await uiChecks();
  const failed = results.filter(r => !r.ok);
  console.log(`\n── ${results.length - failed.length}/${results.length} passed ──`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach(f => console.log(`  ✗ ${f.name}  ${f.detail}`));
    process.exit(1);
  }
  console.log('All critical flows OK. Safe to deploy.\n');
  process.exit(0);
})().catch(e => { console.error('Smoke test crashed:', e); process.exit(1); });
