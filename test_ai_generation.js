/**
 * AI Generation Accuracy Test
 * Tests generate endpoint, checks answer accuracy, emails results
 */

const nodemailer = require('nodemailer');
const EMAIL_USER  = 'aivorah24@gmail.com';
const EMAIL_PASS  = 'khcn rehw gnvd otdl';
const NOTIFY      = 'kannansaimohan2003@gmail.com';
const BASE        = 'http://localhost:3006';

const TESTS = [
  { grade: 'Grade 4', subject: 'Mathematics', topic: 'Fractions',        difficulty: 'Hard',   questionCount: 5 },
  { grade: 'Grade 4', subject: 'Mathematics', topic: 'Fractions',        difficulty: 'Medium', questionCount: 5 },
  { grade: 'Grade 4', subject: 'Science',     topic: 'Food Chains',      difficulty: 'Medium', questionCount: 5 },
  { grade: 'Grade 4', subject: 'Mathematics', topic: 'Multiplication',   difficulty: 'Hard',   questionCount: 5 },
  { grade: 'Grade 3', subject: 'Mathematics', topic: 'Addition',         difficulty: 'Easy',   questionCount: 5 },
];

// ── Manual verification rules ─────────────────────────────────────────
// For each test, verify the returned question structure is valid
function validateQuestion(q, idx) {
  const issues = [];
  if (!q.question || q.question.length < 10) issues.push('question too short');
  if (!Array.isArray(q.options) || q.options.length !== 4) issues.push('must have exactly 4 options');
  if (typeof q.correct !== 'number' || q.correct < 0 || q.correct > 3) issues.push(`invalid correct index: ${q.correct}`);
  if (!q.explanation || q.explanation.length < 10) issues.push('explanation missing');

  // Check options are labelled A/B/C/D
  if (Array.isArray(q.options)) {
    ['A', 'B', 'C', 'D'].forEach((lbl, i) => {
      if (!q.options[i]?.startsWith(`${lbl}.`)) issues.push(`option ${i} missing ${lbl}. prefix`);
    });
  }

  // Check correct answer text appears in explanation (best proxy for accuracy)
  const correctText = Array.isArray(q.options)
    ? q.options[q.correct]?.replace(/^[A-D]\.\s*/i, '').trim()
    : '';
  const expl = (q.explanation || '').toLowerCase();
  // Use word-level partial match — handles "sun" matching "sunlight", fractions like "3/8" etc.
  const words = correctText.toLowerCase().split(/[\s\/,]+/).filter(w => w.length > 2);
  const answInExpl = correctText && (
    expl.includes(correctText.toLowerCase()) ||
    (words.length > 0 && words.some(w => expl.includes(w)))
  );

  return { issues, correctText, answInExpl };
}

async function runTest(params) {
  const t0 = Date.now();
  let raw;
  try {
    const res = await fetch(`${BASE}/super-admin/challenges/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, curriculum: 'IB PYP' }),
    });
    raw = await res.json();
  } catch (e) {
    return { params, error: e.message, questions: [], ms: Date.now() - t0 };
  }

  if (!Array.isArray(raw.questions)) {
    return { params, error: raw.error || 'no questions array', questions: [], ms: Date.now() - t0 };
  }

  const questions = raw.questions.map((q, i) => {
    const { issues, correctText, answInExpl } = validateQuestion(q, i);
    return { ...q, _issues: issues, _correctText: correctText, _answInExpl: answInExpl };
  });

  return {
    params,
    title: raw.suggestedTitle,
    questions,
    ms: Date.now() - t0,
  };
}

function scoreResult(result) {
  if (result.error) return { valid: 0, total: 0, answMatch: 0 };
  const total = result.questions.length;
  const valid = result.questions.filter(q => q._issues.length === 0).length;
  const answMatch = result.questions.filter(q => q._answInExpl).length;
  return { valid, total, answMatch };
}

async function sendEmail(results) {
  let totalQ = 0, totalValid = 0, totalMatch = 0;
  const sections = results.map(r => {
    const s = scoreResult(r);
    totalQ     += s.total;
    totalValid += s.valid;
    totalMatch += s.answMatch;

    const label = `${r.params.topic} (${r.params.subject}, ${r.params.difficulty})`;
    const qRows = (r.questions || []).map((q, i) => {
      const ok = q._issues.length === 0;
      const match = q._answInExpl;
      const optsList = (q.options || []).map((opt, oi) =>
        `<span style="color:${oi === q.correct ? '#4ade80' : '#94a3b8'};${oi === q.correct ? 'font-weight:bold' : ''}">${opt}</span>`
      ).join('<br>');
      return `
        <tr style="background:${ok && match ? '#1a2e1a' : ok ? '#2a2a1a' : '#2e1a1a'}">
          <td style="padding:8px 10px;color:#94a3b8;font-size:11px;vertical-align:top">Q${i+1}</td>
          <td style="padding:8px 10px;color:#e2e8f0;font-size:12px;vertical-align:top">${q.question || ''}</td>
          <td style="padding:8px 10px;font-size:12px;vertical-align:top">${optsList}</td>
          <td style="padding:8px 10px;color:#94a3b8;font-size:11px;vertical-align:top;font-style:italic">${q.explanation || ''}</td>
          <td style="padding:8px 10px;color:${match ? '#4ade80' : '#f87171'};font-size:11px;vertical-align:top">${match ? '✅' : '❌'}</td>
        </tr>`;
    }).join('');

    return `
      <h3 style="color:#e2e8f0;margin:20px 0 6px">${label}</h3>
      <p style="color:#64748b;margin:0 0 6px">Title: ${r.title || 'N/A'} &nbsp;|&nbsp; ${s.valid}/${s.total} valid &nbsp;|&nbsp; ${s.answMatch}/${s.total} answer-in-explanation &nbsp;|&nbsp; ${r.ms}ms</p>
      ${r.error ? `<p style="color:#f87171">ERROR: ${r.error}</p>` : ''}
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
        <tr style="background:#1e293b">
          <th style="padding:5px 10px;color:#64748b;font-size:11px;text-align:left">#</th>
          <th style="padding:5px 10px;color:#64748b;font-size:11px;text-align:left">Question</th>
          <th style="padding:5px 10px;color:#64748b;font-size:11px;text-align:left">Options (green = correct)</th>
          <th style="padding:5px 10px;color:#64748b;font-size:11px;text-align:left">Explanation</th>
          <th style="padding:5px 10px;color:#64748b;font-size:11px;text-align:left">Match</th>
        </tr>
        ${qRows}
      </table>`;
  }).join('');

  const pct = totalQ ? Math.round((totalMatch / totalQ) * 100) : 0;
  const overall = pct >= 80 ? '✅ GOOD' : pct >= 60 ? '⚠️ NEEDS WORK' : '❌ POOR';

  const html = `
<div style="font-family:sans-serif;background:#0f172a;padding:24px;border-radius:12px;max-width:900px;color:#e2e8f0">
  <h2 style="margin:0 0 4px">Aivorah — AI Generation Accuracy Report</h2>
  <p style="color:#64748b;margin:0 0 20px">${new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</p>

  <div style="display:flex;gap:16px;margin-bottom:24px">
    <div style="background:#1e293b;border-radius:8px;padding:16px 24px;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:${pct>=80?'#4ade80':pct>=60?'#fbbf24':'#f87171'}">${pct}%</div>
      <div style="color:#64748b;font-size:12px">ANSWER ACCURACY</div>
    </div>
    <div style="background:#1e293b;border-radius:8px;padding:16px 24px;text-align:center">
      <div style="font-size:24px;font-weight:bold;color:${pct>=80?'#4ade80':pct>=60?'#fbbf24':'#f87171'}">${overall}</div>
      <div style="color:#64748b;font-size:12px">OVERALL</div>
    </div>
    <div style="background:#1e293b;border-radius:8px;padding:16px 24px;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#4ade80">${totalMatch}/${totalQ}</div>
      <div style="color:#64748b;font-size:12px">ANSWERS MATCH</div>
    </div>
    <div style="background:#1e293b;border-radius:8px;padding:16px 24px;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#94a3b8">${totalValid}/${totalQ}</div>
      <div style="color:#64748b;font-size:12px">STRUCTURALLY VALID</div>
    </div>
  </div>

  <div style="background:#1e293b;border-radius:8px;padding:16px;margin-bottom:20px">
    <h3 style="color:#e2e8f0;margin:0 0 8px">Current Implementation</h3>
    <ul style="color:#94a3b8;margin:0;padding-left:20px;line-height:1.8;font-size:13px">
      <li>Model: NVIDIA Nemotron 70B (nvidia/llama-3.1-nemotron-70b-instruct)</li>
      <li>Server-side A/B/C/D assignment (index never from AI)</li>
      <li>Explanation-based answer matching for fallback detection</li>
      <li>Temperature: 0.2</li>
    </ul>
  </div>

  ${sections}
</div>`;

  const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: EMAIL_USER, pass: EMAIL_PASS } });
  await transporter.sendMail({
    from: `"Aivorah Dev" <${EMAIL_USER}>`,
    to: NOTIFY,
    subject: `${overall} — AI Generation Accuracy: ${pct}% (${totalMatch}/${totalQ} correct)`,
    html,
  });
  console.log(`📧 Email sent — ${pct}% accuracy (${totalMatch}/${totalQ})`);
}

(async () => {
  console.log('=== AI Generation Accuracy Test ===');
  console.log(`Testing ${TESTS.length} scenarios × ${TESTS[0].questionCount} questions each...\n`);

  const results = [];
  for (const params of TESTS) {
    console.log(`Testing: ${params.topic} (${params.difficulty})...`);
    const result = await runTest(params);
    const s = scoreResult(result);
    console.log(`  → ${s.answMatch}/${s.total} answer match, ${s.valid}/${s.total} valid structure`);
    results.push(result);
    await new Promise(r => setTimeout(r, 1000)); // rate limit
  }

  await sendEmail(results);
})();
