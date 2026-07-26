#!/usr/bin/env node
/**
 * prove-curriculum-intelligence-g1.js
 *
 * Proves the 12-module Curriculum Intelligence pipeline
 * (services/curriculum-intelligence/) end-to-end on 4 representative Grade-1
 * topics that exercise different teaching strategies:
 *   - English Poem : "Two Little Hands"
 *   - English Story: "The Cap-seller and the Monkeys"
 *   - Maths        : "Mango Treat" (no audio; step-by-step)
 *   - Concept/Activity: "The Food we Eat"
 *
 * For each topic it runs Retrieve -> Understand -> Strategy -> Generate ->
 * Illustrate -> Audio -> Quiz -> UI -> Validate -> Regenerate(loop) -> Persist
 * -> Final Audit, persists the JSON into topic_resources so the app renders it,
 * and prints the audit. Finally it emits the Playwright QA spec (module 11).
 *
 * Usage: node scripts/prove-curriculum-intelligence-g1.js [--dry] [--only "Mango Treat"]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const supabase = require('../services/supabase');
const { runTopic } = require('../services/curriculum-intelligence/orchestrator');
const { generateSpec } = require('../services/curriculum-intelligence/functionalQaAgent');
const { keyStats } = require('../services/curriculum-intelligence/callLLM');

const argVal = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry');
const ONLY = argVal('--only', null);

const TARGETS = [
  { name: 'Two Little Hands', subject: 'English' },
  { name: 'The Cap-seller and the Monkeys', subject: 'English' },
  { name: 'Mango Treat', subject: 'Mathematics' },
  { name: 'The Food we Eat', subject: 'English' },
];

(async () => {
  console.log('LLM key stats:', keyStats());
  // Resolve topic IDs for the 4 targets.
  const { data: chapters } = await supabase.from('syllabus_chapters').select('id, subject').eq('grade', 'Grade 1');
  const chIds = (chapters || []).map((c) => c.id);
  const { data: allTopics } = await supabase.from('syllabus_topics').select('id, name, chapter_id').in('chapter_id', chIds);
  const findId = (name) => (allTopics || []).find((t) => t.name.toLowerCase().trim() === name.toLowerCase().trim())?.id;

  const results = [];
  const provenForQa = [];
  for (const tgt of TARGETS) {
    if (ONLY && tgt.name !== ONLY) continue;
    const topicId = findId(tgt.name);
    console.log(`\n================ ${tgt.subject}: ${tgt.name} ================`);
    if (!topicId) { console.log('  ! topic not found in DB — skipping'); results.push({ ...tgt, error: 'topic id not found' }); continue; }
    try {
      const r = await runTopic({
        topicId, title: tgt.name, subject: tgt.subject, grade: 1,
        persist: !DRY,
        chapterMeta: {}, // no G1 figures in image index -> prompts only, no placeholder box
      });
      if (!r.ok && !r.audit) { console.log(`  ! ${r.reason}`); results.push({ ...tgt, error: r.reason }); continue; }
      const a = r.audit;
      console.log(`  RESULT: ${a.result}  score=${a.overallScore}  type=${a.instructionalType}  layout=${a.layout_type}  audio=${a.audioApplicable}  quiz=${a.quizCount}  persisted=${r.persisted}`);
      if (a.outstandingDefects.length) console.log('  defects:', a.outstandingDefects.map((d) => `${d.section}:${d.reason}`).join(' | '));
      results.push({ ...tgt, topicId, audit: a, persisted: r.persisted });
      provenForQa.push({ topicId, name: tgt.name, layout_type: a.layout_type, hasAudio: a.audioApplicable });
    } catch (e) {
      console.log(`  ! FAILED: ${e.message}`);
      results.push({ ...tgt, error: e.message });
    }
  }

  // Module 11 — emit Playwright QA spec over the proven set.
  if (provenForQa.length) {
    const specPath = generateSpec({ topics: provenForQa });
    console.log(`\n[functionalQA] wrote Playwright spec -> ${specPath}`);
  }

  console.log('\n===================== FINAL AUDIT SUMMARY =====================');
  for (const r of results) {
    if (r.error) { console.log(`  ${r.name}: ERROR — ${r.error}`); continue; }
    console.log(`  ${r.name} [${r.audit.layout_type}]: ${r.audit.result} (score ${r.audit.overallScore}) persisted=${r.persisted}`);
  }
  const pass = results.filter((r) => r.audit && r.audit.result === 'PASS').length;
  console.log(`\n  ${pass}/${results.length} PASS`);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
