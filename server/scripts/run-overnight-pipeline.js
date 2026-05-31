/**
 * run-overnight-pipeline.js
 *
 * Overnight automation: runs all content ingestion scripts in sequence.
 * Handles errors gracefully — if one script fails, continues with the next.
 *
 * Usage: node server/scripts/run-overnight-pipeline.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { client, COLLECTION, IB_COLLECTION } = require('../services/qdrant');
const { normalizeCurriculum } = require('../utils/curriculum');

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function countTopics(collection, curriculum, grade) {
  try {
    const mustFilters = [
      { key: 'curriculum', match: { value: curriculum } },
      { key: 'grade',      match: { value: grade } },
    ];
    const seen = new Set();
    let offset = null;
    do {
      const result = await client.scroll(collection, {
        filter:       { must: mustFilters },
        limit:        100,
        offset:       offset ?? undefined,
        with_payload: true,
        with_vector:  false,
      });
      for (const point of result.points) {
        seen.add(`${point.payload.subject}|${point.payload.topic}`);
      }
      offset = result.next_page_offset ?? null;
    } while (offset !== null);
    return seen.size;
  } catch {
    return 0;
  }
}

const SCRIPTS = [
  { name: 'IB PYP Grade 1',    path: './seed-pyp-grade1-full.js' },
  { name: 'IB PYP Grade 2',    path: './seed-pyp-grade2-full.js' },
  { name: 'NCERT Grades 1-5',  path: './seed-ncert-g1-g5-real.js' },
];

async function main() {
  console.log('='.repeat(60));
  console.log('  AIVORAH OVERNIGHT CONTENT PIPELINE');
  console.log(`  Started: ${timestamp()}`);
  console.log('='.repeat(60));

  const results = [];

  for (const script of SCRIPTS) {
    console.log(`\n${'~'.repeat(60)}`);
    console.log(`  Running: ${script.name}`);
    console.log(`  Time: ${timestamp()}`);
    console.log('~'.repeat(60));

    try {
      const runFn = require(script.path);
      await runFn();
      results.push({ name: script.name, status: 'SUCCESS' });
      console.log(`\n  ${script.name}: SUCCESS`);
    } catch (err) {
      results.push({ name: script.name, status: 'FAILED', error: err.message });
      console.error(`\n  ${script.name}: FAILED — ${err.message}`);
    }

    // Brief pause between scripts
    await sleep(2000);
  }

  // ── Verification: count topics per curriculum+grade ──
  console.log('\n' + '='.repeat(60));
  console.log('  VERIFICATION — Topic counts in Qdrant');
  console.log('='.repeat(60));

  const checks = [
    // IB PYP in ai_mentor_content (string grades)
    { label: 'IB PYP Grade 1', collection: IB_COLLECTION, curriculum: 'IB_PYP', grade: 'Grade 1' },
    { label: 'IB PYP Grade 2', collection: IB_COLLECTION, curriculum: 'IB_PYP', grade: 'Grade 2' },
    { label: 'IB PYP Grade 3', collection: IB_COLLECTION, curriculum: 'IB_PYP', grade: 'Grade 3' },
    { label: 'IB PYP Grade 4', collection: IB_COLLECTION, curriculum: 'IB_PYP', grade: 'Grade 4' },
    { label: 'IB PYP Grade 5', collection: IB_COLLECTION, curriculum: 'IB_PYP', grade: 'Grade 5' },
    // NCERT in aivorah_curriculum_chunks_v1 (integer grades)
    { label: 'NCERT Class 1',  collection: COLLECTION, curriculum: 'NCERT', grade: 1 },
    { label: 'NCERT Class 2',  collection: COLLECTION, curriculum: 'NCERT', grade: 2 },
    { label: 'NCERT Class 3',  collection: COLLECTION, curriculum: 'NCERT', grade: 3 },
    { label: 'NCERT Class 4',  collection: COLLECTION, curriculum: 'NCERT', grade: 4 },
    { label: 'NCERT Class 5',  collection: COLLECTION, curriculum: 'NCERT', grade: 5 },
    { label: 'NCERT Class 6',  collection: COLLECTION, curriculum: 'NCERT', grade: 6 },
    { label: 'NCERT Class 7',  collection: COLLECTION, curriculum: 'NCERT', grade: 7 },
    { label: 'NCERT Class 8',  collection: COLLECTION, curriculum: 'NCERT', grade: 8 },
    { label: 'NCERT Class 9',  collection: COLLECTION, curriculum: 'NCERT', grade: 9 },
    { label: 'NCERT Class 10', collection: COLLECTION, curriculum: 'NCERT', grade: 10 },
  ];

  console.log('\n  Curriculum+Grade             | Topics');
  console.log('  ' + '-'.repeat(45));

  for (const c of checks) {
    const topics = await countTopics(c.collection, c.curriculum, c.grade);
    const status = topics > 0 ? 'OK' : 'EMPTY';
    console.log(`  ${c.label.padEnd(30)} | ${String(topics).padStart(5)}  ${status}`);
  }

  // ── Final Summary ──
  console.log('\n' + '='.repeat(60));
  console.log('  PIPELINE RESULTS');
  console.log('='.repeat(60));

  for (const r of results) {
    const icon = r.status === 'SUCCESS' ? 'OK' : 'FAIL';
    console.log(`  [${icon}] ${r.name}${r.error ? ` — ${r.error}` : ''}`);
  }

  const failures = results.filter(r => r.status === 'FAILED').length;
  console.log(`\n  Completed: ${timestamp()}`);
  console.log(`  ${results.length - failures}/${results.length} scripts succeeded`);

  if (failures > 0) {
    console.log(`  WARNING: ${failures} script(s) failed — check logs above`);
  }

  console.log('\n' + '='.repeat(60));
  process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Pipeline fatal error:', err.message);
  process.exit(1);
});
