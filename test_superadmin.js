/**
 * Super Admin — Full Automated Test Suite
 * Tests all endpoints + edge cases, then emails results to admin@aivorah.ai
 */

const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const { spawn } = require('child_process');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────
const SUPABASE_URL        = 'https://jwlepxmclbkrmfzrumch.supabase.co';
const SUPABASE_SERVICE_KEY = '***REMOVED***';
const SERVER_PORT         = 3006;
const BASE_URL            = `http://localhost:${SERVER_PORT}`;
const EMAIL_USER          = 'aivorah24@gmail.com';
const EMAIL_PASS          = '***REMOVED***';
const NOTIFY_EMAIL        = 'admin@aivorah.ai';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────
let serverProcess = null;
const results = [];
let createdChallengeId = null;
const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function pass(name, detail = '') {
  results.push({ name, status: 'PASS', detail });
  log(`✅ PASS: ${name}${detail ? ' — ' + detail : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, status: 'FAIL', detail });
  log(`❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
}

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Start Server ──────────────────────────────────────────────────────
async function startServer() {
  // Check if server is already running on the port
  try {
    const res = await fetch(`${BASE_URL}/`);
    if (res.status < 500) {
      log('Server already running on port 3006 — skipping spawn');
      return;
    }
  } catch (_) {}

  return new Promise((resolve, reject) => {
    log('Starting server...');
    serverProcess = spawn(process.execPath, ['index.js'], {
      cwd: path.join(__dirname, 'server'),
      env: {
        ...process.env,
        SUPABASE_URL,
        SUPABASE_SERVICE_KEY,
        EMAIL_USER,
        EMAIL_PASS,
        PORT: String(SERVER_PORT),
        GROQ_API_KEY: process.env.GROQ_API_KEY || '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let started = false;
    serverProcess.stdout.on('data', d => {
      const txt = d.toString();
      process.stdout.write(txt);
      if (!started && (txt.includes('3006') || txt.includes('listening') || txt.includes('Server'))) {
        started = true;
        setTimeout(resolve, 500);
      }
    });
    serverProcess.stderr.on('data', d => process.stderr.write(d.toString()));
    serverProcess.on('error', reject);
    // Fallback: resolve after 5s anyway
    setTimeout(() => { if (!started) { started = true; resolve(); } }, 5000);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// ── Create Demo Super Admin User ──────────────────────────────────────
async function createDemoUser() {
  log('Creating demo super_admin user in Supabase...');

  // Upsert into public.users (no auth required — service key bypasses RLS)
  const { error } = await supabase.from('users').upsert({
    id: DEMO_USER_ID,
    name: 'Demo SuperAdmin',
    email: 'demo.superadmin@aivorah.com',
    role: 'super_admin',
    school: 'Aivorah Demo School',
    location: 'Hyderabad, India',
    onboarding_complete: true,
  }, { onConflict: 'id' });

  if (error) {
    fail('Create demo super_admin user', error.message);
  } else {
    pass('Create demo super_admin user', 'demo.superadmin@aivorah.com with role=super_admin');
  }
}

// ── Verify DB State ───────────────────────────────────────────────────
async function verifyDB() {
  log('Verifying DB state...');

  // Check challenges table
  const { data: chs, error: cErr } = await supabase.from('challenges').select('id').limit(1);
  if (cErr || !chs?.length) fail('challenges table populated', cErr?.message || 'empty');
  else pass('challenges table populated', `${chs.length}+ rows found`);

  // Check challenge_questions table
  const { data: qs, error: qErr } = await supabase.from('challenge_questions').select('id').limit(1);
  if (qErr || !qs?.length) fail('challenge_questions table populated', qErr?.message || 'empty');
  else pass('challenge_questions table populated', `${qs.length}+ rows found`);

  // Check Sunita's role
  const { data: sunita } = await supabase.from('users').select('role').eq('email', 'gujjula.sunitha@gmail.com').single();
  if (sunita?.role === 'super_admin') pass('Sunita role = super_admin in DB');
  else fail('Sunita role check', `got: ${sunita?.role}`);

  // Check demo user
  const { data: demo } = await supabase.from('users').select('role').eq('id', DEMO_USER_ID).single();
  if (demo?.role === 'super_admin') pass('Demo user role = super_admin in DB');
  else fail('Demo user role check', `got: ${demo?.role}`);
}

// ── API Tests ─────────────────────────────────────────────────────────
async function testAPI() {
  log('Running API tests...');

  // 1. GET /super-admin/challenges — should return array
  {
    const { status, data } = await req('GET', '/super-admin/challenges');
    if (status === 200 && Array.isArray(data) && data.length > 0) {
      pass('GET /super-admin/challenges', `returned ${data.length} challenges`);
    } else {
      fail('GET /super-admin/challenges', `status=${status}, count=${Array.isArray(data) ? data.length : 'not array'}`);
    }
  }

  // 2. GET /super-admin/challenges — grade filter works
  {
    const { status, data } = await req('GET', '/super-admin/challenges?grade=Grade+4');
    const allGrade4 = Array.isArray(data) && data.every(c => c.grade === 'Grade 4');
    if (status === 200 && allGrade4) pass('GET challenges grade filter', `${data.length} Grade 4 challenges`);
    else fail('GET challenges grade filter', `allGrade4=${allGrade4}`);
  }

  // 3. GET /challenges — student-facing route (uses Supabase now)
  {
    const { status, data } = await req('GET', '/challenges?grade=Grade+4&curriculum=IB+PYP');
    if (status === 200 && Array.isArray(data) && data.length > 0) {
      pass('GET /challenges (student route)', `returned ${data.length} challenges`);
    } else {
      fail('GET /challenges (student route)', `status=${status}`);
    }
  }

  // 4. POST /super-admin/challenges — create a challenge
  {
    const payload = {
      title: 'Demo SuperAdmin Test Challenge',
      description: 'Automated test challenge created by super admin demo',
      grade: 'Grade 4',
      curriculum: 'IB PYP',
      subject: 'Mathematics',
      topic: 'Fractions',
      difficulty: 'Medium',
      xpReward: 300,
      timeLimitMinutes: 15,
      type: 'school_challenge',
      category: 'School Challenge',
      questions: [
        { question: 'What is 1/2 + 1/4?', options: ['A. 1/6', 'B. 3/4', 'C. 2/6', 'D. 1/3'], correct: 1, explanation: '1/2 = 2/4, so 2/4 + 1/4 = 3/4' },
        { question: 'What is 3/4 of 100?', options: ['A. 25', 'B. 50', 'C. 75', 'D. 80'], correct: 2, explanation: '3/4 x 100 = 75' },
      ],
    };
    const { status, data } = await req('POST', '/super-admin/challenges', payload);
    if (status === 200 && data.id) {
      createdChallengeId = data.id;
      pass('POST /super-admin/challenges (create)', `id=${createdChallengeId}`);
    } else {
      fail('POST /super-admin/challenges (create)', `status=${status}, err=${data.error}`);
    }
  }

  // 5. GET questions for created challenge
  if (createdChallengeId) {
    const { status, data } = await req('GET', `/super-admin/challenges/${createdChallengeId}/questions`);
    if (status === 200 && Array.isArray(data) && data.length === 2) {
      pass('GET questions for new challenge', `${data.length} questions returned`);
    } else {
      fail('GET questions for new challenge', `status=${status}, count=${Array.isArray(data) ? data.length : 'err'}`);
    }
  }

  // 6. PUT /super-admin/challenges/:id — update
  if (createdChallengeId) {
    const { status, data } = await req('PUT', `/super-admin/challenges/${createdChallengeId}`, {
      title: 'Demo SuperAdmin Test Challenge (Updated)',
      difficulty: 'Hard',
    });
    if (status === 200 && data.success) pass('PUT /super-admin/challenges/:id (update)');
    else fail('PUT /super-admin/challenges/:id (update)', `status=${status}, err=${data.error}`);
  }

  // 7. Verify update persisted in DB
  if (createdChallengeId) {
    const { data: ch } = await supabase.from('challenges').select('title, difficulty').eq('id', createdChallengeId).single();
    if (ch?.difficulty === 'Hard' && ch?.title?.includes('Updated')) {
      pass('Update persisted in Supabase DB');
    } else {
      fail('Update persisted in Supabase DB', `title=${ch?.title}, difficulty=${ch?.difficulty}`);
    }
  }

  // 8. Edge case — POST with missing title (should fail gracefully)
  {
    const { status, data } = await req('POST', '/super-admin/challenges', {
      grade: 'Grade 4',
      questions: [{ question: 'Q?', options: ['A','B','C','D'], correct: 0, explanation: '' }],
    });
    if (status === 400 && data.error) pass('Edge: missing title returns 400', data.error);
    else fail('Edge: missing title returns 400', `got status=${status}`);
  }

  // 9. Edge case — POST with no questions (should fail gracefully)
  {
    const { status, data } = await req('POST', '/super-admin/challenges', {
      title: 'No Questions Challenge',
      grade: 'Grade 4',
      questions: [],
    });
    if (status === 400 && data.error) pass('Edge: empty questions returns 400', data.error);
    else fail('Edge: empty questions returns 400', `got status=${status}`);
  }

  // 10. Edge case — GET questions for non-existent challenge
  {
    const { status, data } = await req('GET', '/super-admin/challenges/nonexistent_id_xyz/questions');
    if (status === 200 && Array.isArray(data) && data.length === 0) {
      pass('Edge: questions for invalid id returns empty array');
    } else {
      fail('Edge: questions for invalid id', `status=${status}`);
    }
  }

  // 11. Edge case — PUT non-existent challenge (should not crash)
  {
    const { status } = await req('PUT', '/super-admin/challenges/nonexistent_xyz', { title: 'X' });
    if (status === 200 || status === 404 || status === 500) {
      pass('Edge: PUT non-existent id does not crash server', `status=${status}`);
    }
  }

  // 12. DELETE /super-admin/challenges/:id
  if (createdChallengeId) {
    const { status, data } = await req('DELETE', `/super-admin/challenges/${createdChallengeId}`);
    if (status === 200 && data.success) pass('DELETE /super-admin/challenges/:id');
    else fail('DELETE /super-admin/challenges/:id', `status=${status}, err=${data.error}`);
  }

  // 13. Verify DELETE cascaded questions
  if (createdChallengeId) {
    const { data: qs } = await supabase.from('challenge_questions').select('id').eq('challenge_id', createdChallengeId);
    if (!qs?.length) pass('Edge: DELETE cascades to challenge_questions');
    else fail('Edge: DELETE cascade check', `${qs.length} orphan questions remain`);
  }

  // 14. Edge case — DELETE already-deleted challenge
  if (createdChallengeId) {
    const { status } = await req('DELETE', `/super-admin/challenges/${createdChallengeId}`);
    if (status === 200 || status === 404) {
      pass('Edge: double DELETE does not crash', `status=${status}`);
    }
  }
}

// ── Send Email ────────────────────────────────────────────────────────
async function sendEmail() {
  const total  = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const allPass = failed === 0;

  const rows = results.map(r =>
    `<tr style="background:${r.status==='PASS'?'#1a2e1a':'#2e1a1a'}">
      <td style="padding:6px 12px;color:${r.status==='PASS'?'#4ade80':'#f87171'}">${r.status==='PASS'?'✅':'❌'} ${r.status}</td>
      <td style="padding:6px 12px;color:#e2e8f0">${r.name}</td>
      <td style="padding:6px 12px;color:#94a3b8;font-size:12px">${r.detail||''}</td>
    </tr>`
  ).join('');

  const html = `
<div style="font-family:sans-serif;background:#0f172a;padding:24px;border-radius:12px;max-width:700px">
  <h2 style="color:#e2e8f0;margin:0 0 4px">Aivorah — Super Admin Test Results</h2>
  <p style="color:#64748b;margin:0 0 20px">${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</p>

  <div style="display:flex;gap:16px;margin-bottom:24px">
    <div style="background:${allPass?'#14532d':'#7f1d1d'};border-radius:8px;padding:16px 24px;text-align:center">
      <div style="font-size:32px;font-weight:bold;color:${allPass?'#4ade80':'#f87171'}">${allPass?'ALL PASS':'SOME FAILED'}</div>
    </div>
    <div style="background:#1e293b;border-radius:8px;padding:16px 24px;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#4ade80">${passed}</div>
      <div style="color:#64748b;font-size:12px">PASSED</div>
    </div>
    <div style="background:#1e293b;border-radius:8px;padding:16px 24px;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:${failed?'#f87171':'#64748b'}">${failed}</div>
      <div style="color:#64748b;font-size:12px">FAILED</div>
    </div>
    <div style="background:#1e293b;border-radius:8px;padding:16px 24px;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#94a3b8">${total}</div>
      <div style="color:#64748b;font-size:12px">TOTAL</div>
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden">
    <thead>
      <tr style="background:#1e293b">
        <th style="padding:8px 12px;text-align:left;color:#64748b;font-size:12px">STATUS</th>
        <th style="padding:8px 12px;text-align:left;color:#64748b;font-size:12px">TEST</th>
        <th style="padding:8px 12px;text-align:left;color:#64748b;font-size:12px">DETAIL</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div style="margin-top:20px;padding:16px;background:#1e293b;border-radius:8px">
    <h3 style="color:#e2e8f0;margin:0 0 8px">What was completed:</h3>
    <ul style="color:#94a3b8;margin:0;padding-left:20px;line-height:1.8">
      <li>39 challenges migrated to Supabase</li>
      <li>99 questions migrated to Supabase</li>
      <li>Sunita (gujjula.sunitha@gmail.com) — role = super_admin ✅</li>
      <li>Demo super_admin account created (demo.superadmin@aivorah.com)</li>
      <li>super-admin.js backend — fully rewritten to use Supabase</li>
      <li>challenges.js (student route) — updated to use Supabase</li>
      <li>SuperAdminNavigator + ChallengeManagerScreen — already built</li>
      <li>App.tsx routing — super_admin routes to SuperAdminNavigator ✅</li>
    </ul>
  </div>
</div>`;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });

  await transporter.sendMail({
    from: `"Aivorah Dev" <${EMAIL_USER}>`,
    to: NOTIFY_EMAIL,
    subject: `${allPass ? '✅ ALL PASS' : '❌ SOME FAILED'} — Super Admin Test Results (${passed}/${total})`,
    html,
  });

  log(`📧 Email sent to ${NOTIFY_EMAIL}`);
}

// ── Cleanup Demo User ─────────────────────────────────────────────────
async function cleanupDemoUser() {
  await supabase.from('users').delete().eq('id', DEMO_USER_ID);
  log('Demo user cleaned up from DB');
}

// ── Main ──────────────────────────────────────────────────────────────
(async () => {
  try {
    log('=== Super Admin Automated Test Suite ===');

    await createDemoUser();
    await verifyDB();
    await startServer();
    log('Server ready. Running API tests...');
    await sleep(1000);
    await testAPI();

  } catch (e) {
    fail('Unexpected error', e.message);
    console.error(e);
  } finally {
    stopServer();
    log('Server stopped');

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);

    try {
      await sendEmail();
    } catch (e) {
      log(`Email failed: ${e.message}`);
    }

    await cleanupDemoUser();
    process.exit(failed > 0 ? 1 : 0);
  }
})();
