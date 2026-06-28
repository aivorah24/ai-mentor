/**
 * Seeds CBSE Grade 3/4/5 CHALLENGES grounded in the real NCERT chapters that are
 * already ingested in the vector DB (via seed-cbse-grades3to6.js).
 *   - One "Chapter Quiz" challenge per real NCERT chapter (questions are generated
 *     by the existing RAG pipeline from the actual book content — not mock).
 *   - A few "School Challenge" composites per grade/subject.
 * Usage: node scripts/seed-cbse-challenges-g3to5.js [--commit]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../services/supabase');

// ── Pull the EXACT chapter list from the content seed file (single source of truth)
function loadChapters() {
  const src = fs.readFileSync(path.join(__dirname, 'seed-cbse-grades3to6.js'), 'utf8');
  const i = src.indexOf('const CHAPTERS');
  const s = src.indexOf('[', i);
  let depth = 0, e = s;
  for (; e < src.length; e++) { if (src[e] === '[') depth++; else if (src[e] === ']') { depth--; if (depth === 0) break; } }
  // eslint-disable-next-line no-eval
  return eval(src.slice(s, e + 1));
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const GRADE_CFG = {
  'Grade 3': { diff: 'Easy',   xp: 120, qs: 5, time: 10 },
  'Grade 4': { diff: 'Medium', xp: 160, qs: 5, time: 12 },
  'Grade 5': { diff: 'Medium', xp: 200, qs: 6, time: 14 },
};

function build() {
  const chapters = loadChapters().filter(c => ['Grade 3','Grade 4','Grade 5'].includes(c.grade));
  const rows = [];
  // Chapter quizzes
  for (const c of chapters) {
    const cfg = GRADE_CFG[c.grade];
    const gNum = c.grade.replace('Grade ', '');
    rows.push({
      id: `cbse_g${gNum}_${slug(c.subject)}_${slug(c.topic)}`.slice(0, 60),
      title: `${c.topic}`,
      description: (c.desc || `Quiz on ${c.topic}.`).slice(0, 240),
      grade: c.grade, curriculum: 'CBSE', subject: c.subject, topic: c.topic,
      difficulty: cfg.diff, xp_reward: cfg.xp, question_count: cfg.qs,
      time_limit_minutes: cfg.time, type: 'chapter_quiz', category: 'Chapter Quiz', is_published: true,
    });
  }
  // School-challenge composites (one per grade per subject)
  const subjectsByGrade = {};
  chapters.forEach(c => { (subjectsByGrade[c.grade] = subjectsByGrade[c.grade] || new Set()).add(c.subject); });
  for (const [grade, subs] of Object.entries(subjectsByGrade)) {
    const gNum = grade.replace('Grade ', '');
    for (const subject of subs) {
      rows.push({
        id: `cbse_g${gNum}_${slug(subject)}_school`,
        title: `${subject} Challenge — ${grade}`,
        description: `A mixed school challenge covering key ${subject} chapters for ${grade} (CBSE/NCERT).`,
        grade, curriculum: 'CBSE', subject, topic: `${subject} Mastery`,
        difficulty: 'Hard', xp_reward: 350, question_count: 8, time_limit_minutes: 18,
        type: 'school_challenge', category: 'School Challenge', is_published: true,
      });
    }
  }
  return rows;
}

(async () => {
  const rows = build();
  // dedupe by id
  const seen = new Set(); const uniq = rows.filter(r => !seen.has(r.id) && seen.add(r.id));
  console.log(`Built ${uniq.length} CBSE G3-5 challenges (${rows.length - uniq.length} dupes removed)`);
  const byGrade = {}; uniq.forEach(r => { const k = `${r.grade}/${r.type}`; byGrade[k] = (byGrade[k]||0)+1; });
  console.log(byGrade);
  if (!process.argv.includes('--commit')) { console.log('DRY RUN — pass --commit to upsert.'); console.log('sample:', JSON.stringify(uniq[0])); process.exit(0); }
  // Upsert in batches
  for (let i = 0; i < uniq.length; i += 50) {
    const batch = uniq.slice(i, i + 50);
    const { error } = await supabase.from('challenges').upsert(batch, { onConflict: 'id' });
    if (error) { console.error('Upsert error:', error.message); process.exit(1); }
  }
  console.log(`✅ Upserted ${uniq.length} CBSE Grade 3/4/5 challenges.`);
  process.exit(0);
})();
