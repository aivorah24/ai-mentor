// qa-validate.cjs — AUTOMATED QA over published lessons (no subagent needed, so
// it runs in the pipeline). Checks every published lesson for objective defects:
//   1. Structure — intro, keyLearnings, body, quiz present & non-trivial
//   2. Placeholder/meta text — "Welcome to the lesson", "Summary of…" etc.
//   3. Math — every worked-example answer recomputed & must match
//   4. Quiz — MCQ has 4 non-empty distinct options + valid correct index; math
//      MCQ/fill answers arithmetically verified; fill_blank has an answer
//   5. Grounding — content not empty/degenerate
// Reports PASS/FAIL per lesson. With --fix it deletes the FAILED lessons so the
// batch (run-batch.cjs) regenerates them on its next pass.
//
//   node scripts/qa-validate.cjs --grade 2            # one grade
//   node scripts/qa-validate.cjs                      # all grades
//   node scripts/qa-validate.cjs --grade 2 --fix      # also unpublish failures
require('dotenv').config();
const sb = require('../services/supabase');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };

// ALL validation rules live in services/lesson-qa.js — this script is the
// auditor front-end for them. Keeping a second copy here is what let the
// generator publish lessons that this auditor then failed.
const { validateLesson } = require('../services/lesson-qa');
const validate = (L, quiz, grade, subject, topic) =>
  validateLesson(L, quiz, { grade, subject, topic, requireAsset: true });


// Live Ask-Aivorah (AI Coach) probe — the one surface that isn't in the payload.
// Calls /ask for the topic and flags an ungrounded/wrong answer (esp. maths:
// wrong method language or an answer that contradicts the lesson).
async function checkAskAivorah(grade, subject, topic) {
  try {
    const res = await fetch('http://localhost:3006/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: `Explain ${topic} for a Grade ${grade} student with one example.`, grade: `Grade ${grade}`, subject, topic, curriculum: 'CBSE' }),
    });
    if (!res.ok) return [`ask http ${res.status}`];
    const a = (await res.json()).answer || '';
    const f = [];
    if (a.length < 60) f.push('ask: answer too short');
    if (/borrow .* from (a |our )?neighbou?r|give (it |them )?back/i.test(a)) f.push('ask: wrong maths method');
    if (/I'm your school AI Coach|Let's finish|can't help/i.test(a)) f.push('ask: off-topic/refused');
    return f;
  } catch (e) { return [`ask error: ${String(e.message).slice(0, 40)}`]; }
}

(async () => {
  const gradeArg = arg('--grade');
  const fix = process.argv.includes('--fix');
  const live = process.argv.includes('--live'); // also probe Ask Aivorah (slower)
  const grades = gradeArg ? [gradeArg] : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  let total = 0, passed = 0, failed = 0;
  const failList = [];

  for (const g of grades) {
    const { data: chs } = await sb.from('syllabus_chapters').select('id,subject,title').eq('grade', `Grade ${g}`);
    if (!chs || !chs.length) continue;
    for (const ch of chs) {
      const { data: tps } = await sb.from('syllabus_topics').select('id').eq('chapter_id', ch.id);
      for (const tp of (tps || [])) {
        const { data: res } = await sb.from('topic_resources').select('resource_type,static_payload').eq('topic_id', tp.id).eq('status', 'READY');
        const ai = (res || []).find(r => r.resource_type === 'AI_EXPLANATION')?.static_payload;
        const quiz = (res || []).find(r => r.resource_type === 'PRACTICE')?.static_payload?.quiz;
        if (!ai) continue;
        total++;
        const fails = validate(ai, quiz, g, ch.subject, ch.title);
        if (live) { const af = await checkAskAivorah(g, ch.subject, ch.title); fails.push(...af); }
        if (fails.length === 0) { passed++; }
        else {
          failed++; failList.push({ grade: g, subject: ch.subject, title: ch.title, topicId: tp.id, fails });
          console.log(`❌ G${g} ${ch.subject}/${ch.title}: ${fails.slice(0, 3).join('; ')}`);
        }
      }
    }
  }

  console.log(`\n=== QA: ${total} lessons checked · ${passed} PASS · ${failed} FAIL ===`);
  if (fix && failList.length) {
    for (const f of failList) await sb.from('topic_resources').delete().eq('topic_id', f.topicId).in('resource_type', ['AI_EXPLANATION', 'PRACTICE']);
    console.log(`🔧 Unpublished ${failList.length} failed lessons — re-run run-batch to regenerate them.`);
  }
})();
