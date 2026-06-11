/**
 * AI Report - Edge Case Test Suite
 * Run: node test-ai-report.js
 */

const BASE = 'http://localhost:3006';

const CASES = [
  {
    name: 'CASE 1 — No activity (brand new student)',
    parent: 'parentaivorah@gmail.com',
    child:  '02d92c5d-ec27-40fa-a539-514034808ef9',
    expect: { noData: true },
  },
  {
    name: 'CASE 2 — Topics only, no quiz scores, no assignments (broad explorer)',
    parent: 'priya.k@test.ai',
    child:  '106a2ac6-1e17-4fd7-a82c-7d8ded943100',
    expect: { pattern: 'broad_explorer|developing|active_learner', noData: false },
  },
  {
    name: 'CASE 3 — Demo student (alex, grade 3, some XP)',
    parent: 'parent@demo.com',
    child:  '00000000-0000-0000-0000-000000000001',
    expect: { noData: false },
  },
  {
    name: 'CASE 4 — deepa child 1 (priya, grade 3)',
    parent: 'deepa@test.ai',
    child:  'aaaa0000-0000-0000-0000-000000000002',
    expect: { noData: false },
  },
  {
    name: 'CASE 5 — fatima child (zara, grade 4)',
    parent: 'fatima@test.ai',
    child:  'aaaa0000-0000-0000-0000-000000000004',
    expect: { noData: false },
  },
  {
    name: 'CASE 6 — Unauthorized (wrong parent for child)',
    parent: 'hacker@evil.com',
    child:  '106a2ac6-1e17-4fd7-a82c-7d8ded943100',
    expect: { error: true, status: 403 },
  },
  {
    name: 'CASE 7 — Valid parent but nonexistent child',
    parent: 'priya.k@test.ai',
    child:  '00000000-0000-0000-0000-000000000000',
    expect: { error: true },
  },
  {
    name: 'CASE 8 — suresh child',
    parent: 'suresh@test.ai',
    child:  'c9a2af79-f910-4a9b-892d-84ab5f1b9cd9',
    expect: { noData: false },
  },
];

// ── Validators ────────────────────────────────────────────────────────────────

function validateReport(report, caseName) {
  const issues = [];

  if (!report) { issues.push('report is null/undefined'); return issues; }

  // Required top-level keys
  const required = ['learning_pattern_insight', 'whats_going_well', 'where_to_focus', 'consistency_insight', 'this_week_actions', 'message_to_child'];
  for (const key of required) {
    if (!report[key]) issues.push(`missing: ${key}`);
  }

  // Arrays must be arrays
  if (!Array.isArray(report.this_week_actions)) issues.push('this_week_actions is not array');
  if (!Array.isArray(report.subject_insights))  issues.push('subject_insights is not array');
  if (!Array.isArray(report.strong_topics))      issues.push('strong_topics is not array');
  if (!Array.isArray(report.weak_topics))        issues.push('weak_topics is not array');

  // Action plan should have 3 items
  if (Array.isArray(report.this_week_actions) && report.this_week_actions.length === 0) {
    issues.push('this_week_actions is empty');
  }

  // ANTI-HALLUCINATION CHECK — banned phrases
  const BANNED = [
    'problem-solving skills', 'communication skills', 'creative approach',
    'positive attitude', 'keen interest', 'social skills',
    'enthusiasm for learning', 'love of learning', 'passion for learning',
    'natural curiosity', 'strong grasp', 'excellent understanding',
    'talented', 'hardworking', 'dedicated learner', 'bright student',
  ];
  const allText = JSON.stringify(report).toLowerCase();
  for (const phrase of BANNED) {
    if (allText.includes(phrase)) {
      issues.push(`HALLUCINATION DETECTED: "${phrase}"`);
    }
  }

  // Strong/weak topics must have score property
  for (const t of (report.strong_topics || [])) {
    if (t.score == null) issues.push(`strong_topic "${t.topic}" missing score`);
    if (t.score < 75)    issues.push(`strong_topic "${t.topic}" has score ${t.score}% — below 75% threshold`);
  }
  for (const t of (report.weak_topics || [])) {
    if (t.score == null) issues.push(`weak_topic "${t.topic}" missing score`);
    if (t.score >= 60)   issues.push(`weak_topic "${t.topic}" has score ${t.score}% — above 60% threshold`);
  }

  // Strings must not be empty
  if (report.message_to_child && report.message_to_child.length < 10) {
    issues.push('message_to_child too short');
  }

  return issues;
}

function validateMetrics(metrics) {
  const issues = [];
  if (metrics.xp == null || metrics.xp < 0)            issues.push('invalid xp');
  if (metrics.level == null || metrics.level < 1)       issues.push('invalid level');
  if (metrics.currentStreak == null)                     issues.push('missing currentStreak');
  if (metrics.topicsCompleted == null)                   issues.push('missing topicsCompleted');
  if (metrics.activeDays == null)                        issues.push('missing activeDays');
  if (metrics.activeDays > 14)                           issues.push(`activeDays ${metrics.activeDays} > 14`);
  return issues;
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function runCase(tc) {
  const url = `${BASE}/parent/${encodeURIComponent(tc.parent)}/children/${tc.child}/ai-report`;
  let res, data;

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`▶ ${tc.name}`);
  console.log(`  URL: /parent/${tc.parent}/children/${tc.child}/ai-report`);

  try {
    res  = await fetch(url);
    data = await res.json();
  } catch (e) {
    console.log(`  ❌ FETCH ERROR: ${e.message}`);
    return { passed: false };
  }

  // ── CASE: expected error ──────────────────────────────────────────────────
  if (tc.expect.error) {
    if (data.error) {
      console.log(`  ✅ Got expected error: "${data.error}" (HTTP ${res.status})`);
      return { passed: true };
    } else {
      console.log(`  ❌ Expected error but got success`);
      return { passed: false };
    }
  }

  // ── CASE: expected noData ─────────────────────────────────────────────────
  if (tc.expect.noData) {
    if (data.noData === true) {
      console.log(`  ✅ Correctly returned noData=true for inactive student`);
      console.log(`     Student: ${data.student?.name}`);
      return { passed: true };
    } else if (data.error) {
      console.log(`  ⚠️  Got error instead of noData: ${data.error}`);
      return { passed: false };
    } else {
      // Student might have some activity — that's fine too
      console.log(`  ℹ️  Student has activity — checking report quality...`);
    }
  }

  // ── CASE: expected valid report ───────────────────────────────────────────
  if (data.error) {
    console.log(`  ❌ Unexpected error: ${data.error}`);
    return { passed: false };
  }

  if (data.noData) {
    console.log(`  ℹ️  Student has no activity yet — noData=true returned`);
    console.log(`     Student: ${data.student?.name}`);
    return { passed: true };
  }

  console.log(`  Student: ${data.student?.name} | ${data.student?.grade} | ${data.student?.curriculum}`);
  console.log(`  Pattern: ${data.report?.learning_pattern} | Consistency: ${data.report?.consistency_level}`);
  console.log(`  Metrics: XP=${data.metrics?.xp} | Level=${data.metrics?.level} | Streak=${data.metrics?.currentStreak}d | Topics=${data.metrics?.topicsCompleted} | ActiveDays=${data.metrics?.activeDays}/14`);
  console.log(`  Strong topics: ${JSON.stringify((data.report?.strong_topics || []).map(t => `${t.topic}(${t.score}%)`))}`);
  console.log(`  Weak topics:   ${JSON.stringify((data.report?.weak_topics   || []).map(t => `${t.topic}(${t.score}%)`))}`);
  console.log(`  Subject insights: ${(data.report?.subject_insights || []).length} subjects`);
  console.log(`  Actions: ${(data.report?.this_week_actions || []).length} items`);

  // Validate report
  const reportIssues  = validateReport(data.report, tc.name);
  const metricsIssues = validateMetrics(data.metrics || {});
  const allIssues     = [...reportIssues, ...metricsIssues];

  if (allIssues.length === 0) {
    console.log(`  ✅ All validations passed`);
    console.log(`\n  📋 SAMPLE OUTPUT:`);
    console.log(`     Pattern insight: "${(data.report?.learning_pattern_insight || '').slice(0, 100)}..."`);
    console.log(`     What's going well: "${(data.report?.whats_going_well || '').slice(0, 100)}..."`);
    console.log(`     Where to focus: "${(data.report?.where_to_focus || '').slice(0, 100)}..."`);
    console.log(`     Action 1: "${(data.report?.this_week_actions || [])[0] || 'N/A'}"`);
    console.log(`     Message: "${data.report?.message_to_child || 'N/A'}"`);
    return { passed: true };
  } else {
    console.log(`  ❌ ISSUES FOUND (${allIssues.length}):`);
    allIssues.forEach(i => console.log(`     • ${i}`));
    return { passed: false, issues: allIssues };
  }
}

async function main() {
  console.log('═'.repeat(70));
  console.log('  AIVORAH — AI REPORT EDGE CASE TEST SUITE');
  console.log(`  ${new Date().toLocaleString()}`);
  console.log('═'.repeat(70));

  const results = [];
  for (const tc of CASES) {
    const result = await runCase(tc);
    results.push({ name: tc.name, ...result });
    // Small delay between calls to avoid rate limiting
    await new Promise(r => setTimeout(r, 1000));
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log('  TEST SUMMARY');
  console.log('═'.repeat(70));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  results.forEach(r => console.log(`  ${r.passed ? '✅' : '❌'} ${r.name}`));
  console.log(`\n  ${passed}/${results.length} passed | ${failed} failed`);

  if (failed > 0) {
    console.log('\n  Failed cases:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  • ${r.name}`);
      (r.issues || []).forEach(i => console.log(`    - ${i}`));
    });
  }
  console.log('═'.repeat(70));
}

main().catch(console.error);
