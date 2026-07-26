#!/usr/bin/env node
/**
 * run-curriculum-intelligence-grade.js
 *
 * Runs the full 12-module Curriculum Intelligence pipeline over EVERY published
 * topic for a grade, persisting each lesson into topic_resources so the topic
 * screens render (same path proven on Grade 1). Generic over grade/subject.
 *
 *   Retrieve -> Understand -> Strategy -> Generate -> Illustrate -> Audio ->
 *   Quiz -> UI -> Validate -> Regenerate(failed) -> Persist -> Final Audit
 *
 * Maths = no audio + step-by-step Math Helper. English = Learn + sentence Listen.
 *
 * Usage:
 *   node scripts/run-curriculum-intelligence-grade.js --grade "Grade 2" [--subject English] [--only "The Crow"] [--dry] [--resume]
 *
 * --resume skips topics that already have a READY AI_EXPLANATION persisted, so a
 * re-run after an API cap continues where it stopped (never half-written).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const supabase = require('../services/supabase');
const { runTopic } = require('../services/curriculum-intelligence/orchestrator');
const { generateSpec } = require('../services/curriculum-intelligence/functionalQaAgent');
const { keyStats } = require('../services/curriculum-intelligence/callLLM');

const argVal = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const GRADE = argVal('--grade', 'Grade 2');
const ONLY_SUBJECT = argVal('--subject', null);
const ONLY_TOPIC = argVal('--only', null);
const DRY = process.argv.includes('--dry');
const RESUME = process.argv.includes('--resume');

const gradeNum = (GRADE.match(/(\d+)/) || [])[1];
const bookDirFor = (subject) => {
  const folder = /math/i.test(subject) ? 'mathematics' : 'english';
  const dir = path.join(__dirname, '..', 'data', 'ncert_books', `grade${gradeNum}`, folder);
  return fs.existsSync(dir) ? dir : undefined;
};

async function alreadyDone(topicId) {
  const { data } = await supabase.from('topic_resources')
    .select('status, static_payload').eq('topic_id', topicId).eq('resource_type', 'AI_EXPLANATION').maybeSingle();
  return data && data.status === 'READY' && Array.isArray(data.static_payload?.body) && data.static_payload.body.length >= 2;
}

(async () => {
  console.log('LLM key stats:', keyStats());
  console.log(`Grade: ${GRADE}  subjectFilter: ${ONLY_SUBJECT || 'ALL'}  dry:${DRY} resume:${RESUME}\n`);

  const { data: chapters } = await supabase.from('syllabus_chapters').select('id, subject, unit_no').eq('grade', GRADE).order('unit_no');
  const chById = {}; (chapters || []).forEach((c) => { chById[c.id] = c; });
  const chIds = (chapters || []).map((c) => c.id);
  const { data: topicsRaw } = await supabase.from('syllabus_topics').select('id, name, chapter_id, topic_order').in('chapter_id', chIds);
  // Stable order: by chapter unit_no then topic_order.
  const topics = (topicsRaw || []).sort((a, b) =>
    (chById[a.chapter_id].unit_no - chById[b.chapter_id].unit_no) || (a.topic_order - b.topic_order));

  const results = [];
  const provenForQa = [];
  for (const t of topics) {
    const subject = chById[t.chapter_id].subject;
    if (ONLY_SUBJECT && !new RegExp(ONLY_SUBJECT, 'i').test(subject)) continue;
    if (ONLY_TOPIC && t.name !== ONLY_TOPIC) continue;

    if (RESUME && !DRY && await alreadyDone(t.id)) {
      console.log(`\n==== ${subject}: ${t.name} ==== (resume: already done, skip)`);
      results.push({ subject, name: t.name, skipped: true });
      continue;
    }

    console.log(`\n==== ${subject}: ${t.name} ====`);
    try {
      const r = await runTopic({
        topicId: t.id, title: t.name, subject, grade: parseInt(gradeNum, 10),
        bookDir: bookDirFor(subject), persist: !DRY, chapterMeta: {},
      });
      if (!r.audit) { console.log(`  ! ${r.reason}`); results.push({ subject, name: t.name, error: r.reason }); continue; }
      const a = r.audit;
      console.log(`  ${a.result} score=${a.overallScore} type=${a.instructionalType} layout=${a.layout_type} audio=${a.audioApplicable} quiz=${a.quizCount} persisted=${r.persisted}`);
      if (a.outstandingDefects.length) console.log('  DEFECTS:', a.outstandingDefects.map((d) => `${d.section}:${d.reason}`).join(' | '));
      results.push({ subject, name: t.name, topicId: t.id, audit: a, persisted: r.persisted });
      provenForQa.push({ topicId: t.id, name: t.name, layout_type: a.layout_type, hasAudio: a.audioApplicable });
    } catch (e) {
      console.log(`  ! FAILED: ${e.message}`);
      results.push({ subject, name: t.name, error: e.message });
    }
  }

  if (provenForQa.length) {
    const specPath = generateSpec({ topics: provenForQa });
    console.log(`\n[functionalQA] wrote Playwright spec -> ${specPath}`);
  }

  console.log(`\n===================== ${GRADE} AUDIT SUMMARY =====================`);
  const bySub = {};
  for (const r of results) { (bySub[r.subject] = bySub[r.subject] || []).push(r); }
  let pass = 0, fail = 0, err = 0, skip = 0;
  for (const [sub, arr] of Object.entries(bySub)) {
    console.log(`\n--- ${sub} ---`);
    for (const r of arr) {
      if (r.skipped) { skip++; console.log(`  ${r.name}: SKIP (already done)`); continue; }
      if (r.error) { err++; console.log(`  ${r.name}: ERROR — ${r.error}`); continue; }
      if (r.audit.result === 'PASS') pass++; else fail++;
      console.log(`  ${r.name} [${r.audit.layout_type}]: ${r.audit.result} (${r.audit.overallScore}) persisted=${r.persisted}`);
    }
  }
  const rendered = results.filter((r) => r.persisted).length;
  console.log(`\n  PASS=${pass} FAIL=${fail} ERROR=${err} SKIP=${skip} | persisted/rendering=${rendered}`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
