// Seed demo topic_attempts so the Teacher Class Heatmap shows red/yellow/green
// cells for the founder demo. Idempotent — deletes its own seeded rows first,
// so it's safe to re-run. Targets Anaya Reddy (Grade 4 Maths, under priya.k@test.ai).
//
//   run:  node scripts/seed-demo-heatmap.cjs
//   undo: node scripts/seed-demo-heatmap.cjs --clear
require('dotenv').config();
const sb = require('../services/supabase');

const STUDENT_ID = 'a1000000-0000-0000-0000-000000000001'; // Anaya Reddy
const COMMON = { student_id: STUDENT_ID, subject: 'Mathematics', grade: '4', curriculum: 'IB PYP', total_questions: 5, per_question_results: [] };

// Demo topics chosen to exercise each composite branch. Dates are relative so
// "trying/stuck" recency rules resolve correctly whenever the script is run.
const now = Date.now();
const daysAgo = d => new Date(now - d * 86400000).toISOString();

const SEED_TOPICS = ['Long Division', 'Fraction Word Problems', 'Perimeter'];

const ROWS = [
  // 🟥 STUCK — failed once, never came back
  { ...COMMON, topic: 'Long Division', attempt_number: 1, correct_answers: 2, score: 40, passed: false, time_spent_seconds: 310, created_at: daysAgo(2) },

  // 🟨 TRYING — failing but actively re-attempting, all within the 7-day window
  { ...COMMON, topic: 'Fraction Word Problems', attempt_number: 1, correct_answers: 1, score: 20, passed: false, time_spent_seconds: 400, created_at: daysAgo(3) },
  { ...COMMON, topic: 'Fraction Word Problems', attempt_number: 2, correct_answers: 2, score: 40, passed: false, time_spent_seconds: 350, created_at: daysAgo(1) },
  { ...COMMON, topic: 'Fraction Word Problems', attempt_number: 3, correct_answers: 2, score: 45, passed: false, time_spent_seconds: 300, created_at: daysAgo(0) },

  // 🟩 MASTERED w/ 🚩 STRUGGLED — failed twice, passed on the 3rd try
  { ...COMMON, topic: 'Perimeter', attempt_number: 1, correct_answers: 2, score: 40, passed: false, time_spent_seconds: 330, created_at: daysAgo(5) },
  { ...COMMON, topic: 'Perimeter', attempt_number: 2, correct_answers: 2, score: 45, passed: false, time_spent_seconds: 300, created_at: daysAgo(3) },
  { ...COMMON, topic: 'Perimeter', attempt_number: 3, correct_answers: 4, score: 80, passed: true,  time_spent_seconds: 240, created_at: daysAgo(1) },
];

(async () => {
  const clearOnly = process.argv.includes('--clear');

  // Always clear prior seed rows first (idempotent).
  const { error: delErr } = await sb
    .from('topic_attempts')
    .delete()
    .eq('student_id', STUDENT_ID)
    .in('topic', SEED_TOPICS);
  if (delErr) { console.error('clear failed:', delErr.message); process.exit(1); }
  console.log(`cleared prior seed rows for topics: ${SEED_TOPICS.join(', ')}`);

  if (clearOnly) { console.log('--clear done, no rows inserted.'); return; }

  const { data, error } = await sb.from('topic_attempts').insert(ROWS).select('topic, score, passed');
  if (error) { console.error('insert failed:', error.message); process.exit(1); }
  console.log(`inserted ${data.length} demo attempts:`);
  data.forEach(r => console.log(`  - ${r.topic}: ${r.score}% ${r.passed ? 'PASS' : 'fail'}`));
  console.log('\nExpected heatmap: Long Division=STUCK, Fraction Word Problems=TRYING, Perimeter=MASTERED🚩');
})();
