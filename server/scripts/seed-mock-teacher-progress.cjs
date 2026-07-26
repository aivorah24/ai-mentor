/**
 * Mock data seeder for the Teacher → Student Progress screen.
 * Links the 5 Grade 4 TSRA students to teacheraivorah@gmail.com and gives them
 * a realistic spread of topic attempts (strong / average / struggling) so the
 * heatmap, trends and AI assistant have something to chew on.
 *
 * Reversible:  node scripts/seed-mock-teacher-progress.cjs --cleanup
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

const TEACHER_EMAIL = 'teacheraivorah@gmail.com';
const SCHOOL = 'The Shri Ram Academy';
const GRADE = 'Grade 4';
const CURRICULUM = 'IB PYP';
const CLEANUP = process.argv.includes('--cleanup');

// Topics drawn from the live Grade 4 IB PYP curriculum, restricted to the subjects
// this teacher is scoped to in Staff Subject Mapping (Science + Social Studies) —
// out-of-scope subjects are filtered out by the by-teacher route and show as zero.
const TOPICS = [
  ['Ecosystems and Food Webs', 'Science'],
  ['Forces and Motion', 'Science'],
  ['Simple Machines', 'Science'],
  ['Electricity and Circuits', 'Science'],
  ['Human Body Systems', 'Science'],
  ['Ancient Civilizations', 'Social Studies'],
  ['Government and Democracy', 'Social Studies'],
  ['Economic Activities', 'Social Studies'],
];

// profile: how each student performs. mastered = passes first try high,
// improving = fails then climbs, struggling = repeated low scores (drives 🚩).
const PROFILES = {
  Zara:         { profile: 'mastered',   topics: 8, xp: 2400, streak: 9, minutes: 640 },
  Saanvi:       { profile: 'improving',  topics: 7, xp: 1500, streak: 4, minutes: 410 },
  Aarav:        { profile: 'average',    topics: 6, xp: 1100, streak: 3, minutes: 320 },
  'Ananya Rao': { profile: 'struggling', topics: 4, xp: 520,  streak: 1, minutes: 180 },
  Sharma:       { profile: 'struggling', topics: 3, xp: 300,  streak: 0, minutes: 95  },
};

// Each profile returns the score sequence for one topic (one entry per attempt).
function attemptsFor(profile, topicIdx) {
  switch (profile) {
    case 'mastered':   return [85 + ((topicIdx * 3) % 12)];
    case 'improving':  return topicIdx % 2 ? [45, 68] : [55, 72, 88];
    case 'average':    return topicIdx % 3 === 0 ? [50, 65] : [70 + ((topicIdx * 5) % 15)];
    case 'struggling': return topicIdx % 2 ? [35, 42] : [28, 40, 48];
    default:           return [60];
  }
}

function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString(); }

(async () => {
  const { data: teachers } = await sb.from('users').select('id, name').eq('email', TEACHER_EMAIL);
  if (!teachers?.length) throw new Error(`Teacher ${TEACHER_EMAIL} not found`);
  const teacherId = teachers[0].id;

  const { data: students } = await sb.from('users')
    .select('id, name')
    .eq('role', 'student').eq('school', SCHOOL).eq('grade', GRADE);
  const targets = (students || []).filter(s => PROFILES[s.name]);
  const ids = targets.map(s => s.id);
  console.log(`Teacher ${teachers[0].name} (${teacherId}) · ${targets.length} students: ${targets.map(s => s.name).join(', ')}`);

  if (CLEANUP) {
    await sb.from('topic_attempts').delete().in('student_id', ids).in('topic', TOPICS.map(t => t[0]));
    await sb.from('teacher_student').delete().eq('teacher_id', teacherId).in('student_id', ids);
    console.log('Cleanup done: links + seeded topic_attempts removed.');
    return;
  }

  // 1. Link students to the teacher (the missing piece — by-teacher returned []).
  const links = ids.map(student_id => ({ teacher_id: teacherId, student_id, subject: CURRICULUM }));
  const { error: linkErr } = await sb.from('teacher_student').upsert(links, { onConflict: 'teacher_id,student_id,subject' });
  if (linkErr) console.error('link error:', linkErr.message); else console.log(`Linked ${links.length} students.`);

  // 2. Topic attempts — the source for scores, trends and the struggled flag.
  const rows = [];
  for (const s of targets) {
    const cfg = PROFILES[s.name];
    TOPICS.slice(0, cfg.topics).forEach(([topic, subject], ti) => {
      attemptsFor(cfg.profile, ti).forEach((score, ai, arr) => {
        const totalQ = 10;
        rows.push({
          student_id: s.id, topic, subject, grade: GRADE, curriculum: CURRICULUM,
          attempt_number: ai + 1,
          total_questions: totalQ,
          correct_answers: Math.round((score / 100) * totalQ),
          score,
          passed: score >= 60,
          time_spent_seconds: 240 + ti * 40 + ai * 60,
          created_at: daysAgo((arr.length - ai) * 3 + ti),
        });
      });
    });
  }
  await sb.from('topic_attempts').delete().in('student_id', ids).in('topic', TOPICS.map(t => t[0]));
  const { error: taErr } = await sb.from('topic_attempts').insert(rows);
  if (taErr) console.error('topic_attempts error:', taErr.message); else console.log(`Inserted ${rows.length} topic attempts.`);

  // 3. student_stats — powers the donuts, XP, streaks and last-active labels.
  const stats = targets.map((s, i) => {
    const cfg = PROFILES[s.name];
    const passed = rows.filter(r => r.student_id === s.id && r.passed).map(r => r.topic);
    return {
      student_id: s.id,
      xp_points: cfg.xp,
      level: Math.max(1, Math.floor(cfg.xp / 500)),
      study_time_minutes: cfg.minutes,
      topics_explored: cfg.topics,
      challenges_completed: Math.max(0, cfg.topics - 2),
      assignments_done: Math.max(0, cfg.topics - 1),
      current_streak: cfg.streak,
      last_active_date: daysAgo(i),
      today_study_minutes: cfg.streak > 0 ? 20 + i * 5 : 0,
      today_xp: cfg.streak > 0 ? 60 + i * 10 : 0,
      completed_topics: [...new Set(passed)],
      updated_at: new Date().toISOString(),
    };
  });
  const { error: ssErr } = await sb.from('student_stats').upsert(stats, { onConflict: 'student_id' });
  if (ssErr) console.error('student_stats error:', ssErr.message); else console.log(`Upserted ${stats.length} student_stats rows.`);

  console.log('\nDone. Refresh Teacher → Student Progress.');
})();
