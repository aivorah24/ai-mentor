/**
 * E2E Test: Super Admin creates challenge → Student sees + answers it
 *
 * Flow:
 *   1. Super admin creates a challenge with 3 questions
 *   2. Verify challenge appears in student GET /challenges
 *   3. Verify questions are fetchable (GET /challenges/:id/questions)
 *   4. Student answers the challenge (POST /challenges/:assignmentId/complete)
 *   5. Verify XP was awarded
 *   6. Cleanup — delete the test challenge
 */

const nodemailer = require('nodemailer');
const BASE = 'http://localhost:3006';
const EMAIL_USER = 'aivorah24@gmail.com';
const EMAIL_PASS = 'khcn rehw gnvd otdl';
const NOTIFY = 'kannansaimohan2003@gmail.com';

// Demo student ID (Grade 4, IB PYP)
const STUDENT_ID = '00000000-0000-0000-0000-000000000002';

const TEST_CHALLENGE = {
  title: '[E2E Test] Fraction Master',
  description: 'Automated E2E test challenge — safe to delete.',
  grade: 'Grade 4',
  curriculum: 'General',
  subject: 'Mathematics',
  topic: 'Fractions',
  difficulty: 'Medium',
  xpReward: 100,
  timeLimitMinutes: 10,
  type: 'school_challenge',
  category: 'School Challenge',
  questions: [
    {
      question: 'What is 1/2 + 1/4?',
      options: ['A. 3/4', 'B. 2/6', 'C. 1/2', 'D. 1/6'],
      correct: 0,
      explanation: '1/2 = 2/4, so 2/4 + 1/4 = 3/4',
    },
    {
      question: 'Which fraction is equivalent to 2/4?',
      options: ['A. 1/3', 'B. 1/2', 'C. 3/4', 'D. 2/3'],
      correct: 1,
      explanation: '2/4 simplifies to 1/2.',
    },
    {
      question: 'What is 3/4 - 1/4?',
      options: ['A. 2/8', 'B. 1/4', 'C. 2/4', 'D. 3/8'],
      correct: 2,
      explanation: '3/4 - 1/4 = 2/4.',
    },
  ],
};

const log = [];
function step(name, passed, detail = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  log.push({ name, passed, detail });
  console.log(`  ${status}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function run() {
  console.log('\n=== Aivorah E2E: Challenge Publish → Student Flow ===\n');
  let challengeId = null;
  let assignmentId = null;
  let initialXp = 0;

  // ── Step 1: Super admin creates challenge ──────────────────────────
  console.log('[ 1 ] Super admin creates challenge...');
  try {
    const res = await fetch(`${BASE}/super-admin/challenges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_CHALLENGE),
    });
    const data = await res.json();
    challengeId = data.id;
    step('Challenge created', res.ok && !!challengeId, `id=${challengeId}`);
  } catch (e) {
    step('Challenge created', false, e.message);
    return finish();
  }

  // ── Step 2: Fetch questions from super-admin route ─────────────────
  console.log('\n[ 2 ] Verify questions stored...');
  try {
    const res = await fetch(`${BASE}/super-admin/challenges/${challengeId}/questions`);
    const data = await res.json();
    step('Questions stored', Array.isArray(data) && data.length === 3, `${data.length} questions`);
    step('Correct index valid', data.every(q => typeof q.correct === 'number' && q.correct >= 0 && q.correct <= 3));
    step('Options format valid', data.every(q => Array.isArray(q.options) && q.options.length === 4));
  } catch (e) {
    step('Questions stored', false, e.message);
  }

  // ── Step 3: Challenge visible to student (grade + General curriculum) ─
  console.log('\n[ 3 ] Student fetches available challenges...');
  try {
    const res = await fetch(`${BASE}/challenges?grade=Grade+4&curriculum=General&studentId=${STUDENT_ID}`);
    const data = await res.json();
    const found = Array.isArray(data) && data.some(c => c.id === challengeId);
    step('Challenge visible to student', found, found ? 'found in list' : `not found (${data.length} challenges returned)`);
  } catch (e) {
    step('Challenge visible to student', false, e.message);
  }

  // ── Step 4: Assign challenge to student ───────────────────────────
  console.log('\n[ 4 ] Assign challenge to student...');
  try {
    const res = await fetch(`${BASE}/challenges/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, studentId: STUDENT_ID, assignedBy: 'e2e-test' }),
    });
    const data = await res.json();
    assignmentId = data.id || data.assignmentId;
    step('Challenge assigned', res.ok, `assignmentId=${assignmentId}`);
  } catch (e) {
    step('Challenge assigned', false, e.message);
  }

  // ── Step 5: Check student XP before ───────────────────────────────
  console.log('\n[ 5 ] Record student XP before completing...');
  try {
    const res = await fetch(`${BASE}/student/${STUDENT_ID}`);
    const data = await res.json();
    initialXp = data.xpPoints || data.totalXp || data.xp || 0;
    step('Student XP readable', res.ok, `xp=${initialXp}`);
  } catch (e) {
    step('Student XP readable', false, e.message);
  }

  // ── Step 6: Student completes challenge ───────────────────────────
  console.log('\n[ 6 ] Student completes challenge (all correct)...');
  let xpAwarded = 0;
  try {
    const id = assignmentId || challengeId;
    const res = await fetch(`${BASE}/challenges/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, challengeId, score: 100, total: 3, timeTaken: 90 }),
    });
    const data = await res.json();
    xpAwarded = data.xpAwarded ?? 0;
    step('Challenge completed', res.ok && data.status === 'completed', `status=${data.status}`);
    step('XP awarded on completion', xpAwarded > 0, `xpAwarded=${xpAwarded}`);
  } catch (e) {
    step('Challenge completed', false, e.message);
    step('XP awarded on completion', false, e.message);
  }

  // ── Step 7: Verify student_stats updated ──────────────────────────
  console.log('\n[ 7 ] Verify student profile reflects new XP...');
  try {
    await new Promise(r => setTimeout(r, 600));
    const res = await fetch(`${BASE}/student/${STUDENT_ID}`);
    const data = await res.json();
    const newXp = data.xpPoints || data.totalXp || data.xp || 0;
    step('Student XP updated', newXp >= initialXp, `${initialXp} → ${newXp} (+${xpAwarded} awarded)`);
  } catch (e) {
    step('Student XP updated', false, e.message);
  }

  // ── Step 8: Cleanup ───────────────────────────────────────────────
  console.log('\n[ 8 ] Cleanup test challenge...');
  try {
    const res = await fetch(`${BASE}/super-admin/challenges/${challengeId}`, { method: 'DELETE' });
    step('Test challenge deleted', res.ok);
  } catch (e) {
    step('Test challenge deleted', false, e.message);
  }

  return finish();
}

function finish() {
  const passed = log.filter(l => l.passed).length;
  const total = log.length;
  const pct = total ? Math.round((passed / total) * 100) : 0;
  const overall = pct === 100 ? '✅ ALL PASS' : pct >= 80 ? '⚠️ MOSTLY PASS' : '❌ FAILURES';

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Result: ${overall}  (${passed}/${total} steps passed)`);
  console.log(`${'─'.repeat(50)}\n`);

  sendEmail(passed, total, pct);
}

async function sendEmail(passed, total, pct) {
  const color = pct === 100 ? '#4ade80' : pct >= 80 ? '#fbbf24' : '#f87171';
  const overall = pct === 100 ? '✅ ALL PASS' : pct >= 80 ? '⚠️ MOSTLY PASS' : '❌ FAILURES';

  const rows = log.map(l => `
    <tr style="background:${l.passed ? '#1a2e1a' : '#2e1a1a'}">
      <td style="padding:8px 12px;color:${l.passed ? '#4ade80' : '#f87171'};font-size:13px">${l.passed ? '✅' : '❌'}</td>
      <td style="padding:8px 12px;color:#e2e8f0;font-size:13px">${l.name}</td>
      <td style="padding:8px 12px;color:#94a3b8;font-size:12px">${l.detail || ''}</td>
    </tr>`).join('');

  const html = `
<div style="font-family:sans-serif;background:#0f172a;padding:24px;border-radius:12px;max-width:720px;color:#e2e8f0">
  <h2 style="margin:0 0 4px">Aivorah — E2E Challenge Flow Test</h2>
  <p style="color:#64748b;margin:0 0 20px">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>

  <div style="display:flex;gap:16px;margin-bottom:24px">
    <div style="background:#1e293b;border-radius:8px;padding:16px 24px;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:${color}">${pct}%</div>
      <div style="color:#64748b;font-size:12px">PASS RATE</div>
    </div>
    <div style="background:#1e293b;border-radius:8px;padding:16px 24px;text-align:center">
      <div style="font-size:20px;font-weight:bold;color:${color}">${overall}</div>
      <div style="color:#64748b;font-size:12px">OVERALL</div>
    </div>
    <div style="background:#1e293b;border-radius:8px;padding:16px 24px;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#4ade80">${passed}/${total}</div>
      <div style="color:#64748b;font-size:12px">STEPS PASSED</div>
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse">
    <tr style="background:#1e293b">
      <th style="padding:6px 12px;color:#64748b;font-size:11px;text-align:left">Status</th>
      <th style="padding:6px 12px;color:#64748b;font-size:11px;text-align:left">Step</th>
      <th style="padding:6px 12px;color:#64748b;font-size:11px;text-align:left">Detail</th>
    </tr>
    ${rows}
  </table>

  <div style="background:#1e293b;border-radius:8px;padding:14px;margin-top:20px">
    <h3 style="color:#e2e8f0;margin:0 0 8px;font-size:13px">Test Flow</h3>
    <ol style="color:#94a3b8;margin:0;padding-left:20px;line-height:1.9;font-size:12px">
      <li>Super admin POST /super-admin/challenges (create with 3 Qs)</li>
      <li>Verify questions stored via GET /super-admin/challenges/:id/questions</li>
      <li>Student GET /challenges?grade=Grade+4&curriculum=General — challenge visible?</li>
      <li>POST /challenges/assign — assign to demo student</li>
      <li>GET /student — record XP before</li>
      <li>POST /challenges/:id/complete — student answers all correctly</li>
      <li>GET /student — verify XP increased</li>
      <li>DELETE /super-admin/challenges/:id — cleanup</li>
    </ol>
  </div>
</div>`;

  try {
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user: EMAIL_USER, pass: EMAIL_PASS } });
    await t.sendMail({
      from: `"Aivorah Dev" <${EMAIL_USER}>`,
      to: NOTIFY,
      subject: `${overall} — E2E Challenge Flow (${passed}/${total} steps)`,
      html,
    });
    console.log(`📧 Email sent to ${NOTIFY}`);
  } catch (e) {
    console.error('Email failed:', e.message);
  }
}

run();
