/**
 * test-science-content.js
 * Unit test: verify NCERT Grade 3 Science ("Our Wondrous World") is fully loaded in Qdrant.
 * Checks each chapter has content, chunk quality, and lesson script generation.
 *
 * Usage: node scripts/test-science-content.js
 * Usage (with lesson script test): node scripts/test-science-content.js --lessons
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { client, COLLECTION } = require('../services/qdrant');

const SCIENCE_CHAPTERS = [
  { id: 1,  topic: 'Our Families and Communities',   unit: 'Unit 1' },
  { id: 2,  topic: 'Going to the Mela',              unit: 'Unit 1' },
  { id: 3,  topic: 'Celebrating Festivals',          unit: 'Unit 1' },
  { id: 4,  topic: 'Life Around Us',                 unit: 'Unit 2' },
  { id: 5,  topic: 'Plants and Animals Live Together', unit: 'Unit 2' },
  { id: 6,  topic: 'Living in Harmony',              unit: 'Unit 2' },
  { id: 7,  topic: 'Gifts of Nature',                unit: 'Unit 3' },
  { id: 8,  topic: 'Food We Eat',                    unit: 'Unit 3' },
  { id: 9,  topic: 'Staying Healthy and Happy',      unit: 'Unit 3' },
  { id: 10, topic: 'Things Around Us',               unit: 'Unit 4' },
  { id: 11, topic: 'Making Things',                  unit: 'Unit 4' },
  { id: 12, topic: 'Taking Charge of Waste',         unit: 'Unit 4' },
];

const MIN_CHUNKS_PER_CHAPTER = 3;
const MIN_CHUNK_LENGTH       = 50;
const SERVER_URL             = process.env.SERVER_URL || 'http://localhost:3001';
const TEST_LESSONS           = process.argv.includes('--lessons');

// ── ANSI colours ─────────────────────────────────────────────────────────────
const G = '\x1b[32m'; // green
const R = '\x1b[31m'; // red
const Y = '\x1b[33m'; // yellow
const B = '\x1b[34m'; // blue
const D = '\x1b[0m';  // reset

function pass(msg)  { console.log(`  ${G}✓${D}  ${msg}`); }
function fail(msg)  { console.log(`  ${R}✗${D}  ${msg}`); }
function warn(msg)  { console.log(`  ${Y}⚠${D}  ${msg}`); }
function info(msg)  { console.log(`  ${B}ℹ${D}  ${msg}`); }
function head(msg)  { console.log(`\n${B}${msg}${D}`); }

// ── Test 1: Qdrant Science content audit ─────────────────────────────────────
async function testQdrantContent() {
  head('TEST 1: Qdrant Science Content Audit');

  let totalChunks = 0;
  let passCount   = 0;
  let failCount   = 0;
  const chapterSummary = [];

  for (const ch of SCIENCE_CHAPTERS) {
    process.stdout.write(`  Ch ${ch.id.toString().padStart(2)}: "${ch.topic}" ... `);

    try {
      // Scroll all chunks for this topic
      const result = await client.scroll(COLLECTION, {
        filter: {
          must: [
            { key: 'subject',  match: { value: 'Science' } },
            { key: 'grade',    match: { value: 'Grade 3' } },
            { key: 'topic',    match: { value: ch.topic  } },
          ],
        },
        limit: 100,
        with_payload: true,
        with_vector:  false,
      });

      const chunks = result.points;
      totalChunks += chunks.length;

      if (chunks.length < MIN_CHUNKS_PER_CHAPTER) {
        process.stdout.write(`${R}FAIL${D}\n`);
        fail(`Only ${chunks.length} chunks (need at least ${MIN_CHUNKS_PER_CHAPTER})`);
        failCount++;
        chapterSummary.push({ id: ch.id, topic: ch.topic, chunks: chunks.length, status: 'FAIL' });
        continue;
      }

      // Check chunk quality
      const shortChunks = chunks.filter(c => (c.payload?.content?.length ?? 0) < MIN_CHUNK_LENGTH);
      const emptyChunks = chunks.filter(c => !c.payload?.content);

      if (emptyChunks.length > 0) {
        process.stdout.write(`${R}FAIL${D}\n`);
        fail(`${emptyChunks.length} empty chunks`);
        failCount++;
        chapterSummary.push({ id: ch.id, topic: ch.topic, chunks: chunks.length, status: 'FAIL_EMPTY' });
        continue;
      }

      process.stdout.write(`${G}PASS${D} (${chunks.length} chunks`);
      if (shortChunks.length > 0) process.stdout.write(`, ${Y}${shortChunks.length} short${D}`);
      process.stdout.write(')\n');

      // Print sample chunk for first chapter only
      if (ch.id === 1) {
        const sample = chunks[0].payload?.content?.slice(0, 120) ?? '';
        info(`Sample: "${sample}..."`);
      }

      passCount++;
      chapterSummary.push({ id: ch.id, topic: ch.topic, chunks: chunks.length, status: 'PASS' });

    } catch (err) {
      process.stdout.write(`${R}ERROR${D}\n`);
      fail(`Qdrant error: ${err.message}`);
      failCount++;
      chapterSummary.push({ id: ch.id, topic: ch.topic, chunks: 0, status: 'ERROR' });
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`  Total chapters: ${SCIENCE_CHAPTERS.length}`);
  console.log(`  ${G}Passed: ${passCount}${D}  |  ${R}Failed: ${failCount}${D}  |  Total chunks: ${totalChunks}`);

  return { passCount, failCount, totalChunks, chapterSummary };
}

// ── Test 2: Lesson script API test ──────────────────────────────────────────
async function testLessonScripts(chapterSummary) {
  head('TEST 2: Lesson Script Generation (first 3 chapters with content)');

  const chaptersToTest = chapterSummary.filter(c => c.status === 'PASS').slice(0, 3);

  if (chaptersToTest.length === 0) {
    fail('No chapters with content to test');
    return;
  }

  let passCount = 0;
  let failCount = 0;

  for (const ch of chaptersToTest) {
    console.log(`\n  Chapter: "${ch.topic}"`);
    try {
      // Fetch content chunks
      const contentRes = await fetch(`${SERVER_URL}/ncert/science-chapter-content?topic=${encodeURIComponent(ch.topic)}`);
      if (!contentRes.ok) throw new Error(`content fetch: ${contentRes.status}`);
      const contentData = await contentRes.json();
      const context = (contentData.textChunks ?? []).slice(0, 5).map(c => c.content).join('\n\n');

      // Fetch lesson script
      const scriptRes = await fetch(`${SERVER_URL}/lesson/script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: ch.topic, grade: 'Grade 3', curriculum: 'NCERT', subject: 'Science', context }),
      });
      if (!scriptRes.ok) throw new Error(`script fetch: ${scriptRes.status}`);
      const script = await scriptRes.json();
      const scenes = script.scenes ?? [];

      // Validate scenes
      const emptyTextScenes   = scenes.filter(s => !s.text || s.text.trim().length < 10);
      const checkpointScenes  = scenes.filter(s => s.checkpoint);
      const checkpointAt4     = scenes[3]?.checkpoint;
      const checkpointAt8     = scenes[7]?.checkpoint;
      const checkpointAt12    = scenes[11]?.checkpoint;

      info(`${scenes.length} scenes generated`);

      if (scenes.length < 12) {
        fail(`Too few scenes: ${scenes.length} (expected 14)`);
        failCount++;
      } else {
        pass(`Scene count: ${scenes.length}`);
        passCount++;
      }

      if (emptyTextScenes.length > 0) {
        fail(`${emptyTextScenes.length} scenes with empty/short text (scenes: ${emptyTextScenes.map((_,i) => i+1).join(', ')})`);
        failCount++;
      } else {
        pass('All scenes have text');
        passCount++;
      }

      if (checkpointScenes.length >= 3) {
        pass(`Checkpoints present: ${checkpointScenes.length} (at scenes: ${scenes.map((s,i) => s.checkpoint ? i+1 : null).filter(Boolean).join(', ')})`);
        passCount++;
      } else {
        warn(`Only ${checkpointScenes.length} checkpoints (expected 3 at scenes 4, 8, 12)`);
      }

      if (!checkpointAt4) warn('Scene 4 missing checkpoint');
      else pass('Scene 4 has checkpoint');
      if (!checkpointAt8) warn('Scene 8 missing checkpoint');
      else pass('Scene 8 has checkpoint');
      if (!checkpointAt12) warn('Scene 12 missing checkpoint');
      else pass('Scene 12 has checkpoint');

      // Print first 3 scene texts
      info('First 3 scenes:');
      scenes.slice(0, 3).forEach((s, i) => {
        const preview = (s.text ?? '').slice(0, 80);
        console.log(`    Scene ${i+1} [${s.emotion}]: "${preview}"`);
      });

    } catch (err) {
      fail(`Error: ${err.message}`);
      failCount++;
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`  ${G}Checks passed: ${passCount}${D}  |  ${R}Failed: ${failCount}${D}`);
}

// ── Test 3: Quiz endpoint test ────────────────────────────────────────────────
async function testQuizEndpoints() {
  head('TEST 3: Science Quiz Endpoint');

  const testTopic = 'Food We Eat';
  try {
    const res = await fetch(`${SERVER_URL}/ncert/science-quiz`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ topic: testTopic, context: '' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const qs = data.questions ?? [];

    if (qs.length < 3) {
      fail(`Only ${qs.length} quiz questions (expected 5)`);
    } else {
      pass(`${qs.length} quiz questions generated for "${testTopic}"`);
    }

    qs.slice(0, 2).forEach((q, i) => {
      info(`Q${i+1}: ${q.question?.slice(0, 70)}...`);
    });
  } catch (err) {
    fail(`Quiz endpoint error: ${err.message}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  NCERT Grade 3 Science Content Test Suite');
  console.log('  Book: "Our Wondrous World" | Chapters: 12');
  console.log('='.repeat(60));

  const { passCount, failCount, chapterSummary } = await testQdrantContent();

  if (TEST_LESSONS) {
    await testLessonScripts(chapterSummary);
    await testQuizEndpoints();
  } else {
    console.log(`\n${Y}Tip: Run with --lessons flag to also test lesson script & quiz generation:${D}`);
    console.log('  node scripts/test-science-content.js --lessons');
  }

  console.log('\n' + '='.repeat(60));
  if (failCount === 0) {
    console.log(`  ${G}ALL TESTS PASSED — Science content is ready!${D}`);
  } else {
    console.log(`  ${R}${failCount} chapter(s) have issues. Re-run ingest-ncert-science-grade3.js to fix.${D}`);
  }
  console.log('='.repeat(60) + '\n');

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
