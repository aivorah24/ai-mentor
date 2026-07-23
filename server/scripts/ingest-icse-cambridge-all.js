/**
 * Bulk ingestion driver — ICSE (Class I–X) + Cambridge (Primary Stage 1–6,
 * Lower Secondary 7–9, IGCSE 10–11), ALL board subjects, AI-generated
 * syllabus-aligned content. Licensing-safe: no textbook text is scraped; the
 * syllabus *outline* (subjects → units → topics) is generated from the public
 * curriculum structure, and per-topic content is original AI material tagged
 * contentOrigin: 'ai_generated' (see aiEnrichment.js).
 *
 * Uses the existing generic pipeline:
 *   generate outline (Groq)  ->  previewTopicResources (per topic)
 *     ->  approveAndPublish  ->  Supabase (syllabus_chapters/topics +
 *         topic_resources)  ->  AI-validation gate  ->  Qdrant.
 *
 * Resumable: every completed (curriculum|grade|subject) scope is checkpointed
 * to .icse-cambridge-progress.json. publishUnits is replace-all per scope, so
 * re-running is idempotent — already-done scopes are skipped, and a scope that
 * died mid-run is simply redone cleanly. Rate-limit / daily-quota aware: Groq
 * 429s are retried with backoff; a hard daily cap makes the driver exit(3)
 * gracefully so it can be resumed later without losing prior progress.
 *
 * Usage:  node scripts/ingest-icse-cambridge-all.js
 *         node scripts/ingest-icse-cambridge-all.js --only=ICSE
 *         node scripts/ingest-icse-cambridge-all.js --grade="Class X"
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const { previewTopicResources, approveAndPublish } = require('../services/curriculum/ingestionService');

const GROQ_MODEL = 'llama-3.1-8b-instant';
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PROGRESS_FILE = path.join(__dirname, '.icse-cambridge-progress.json');
const LOG_FILE = path.join(__dirname, 'ingest-icse-cambridge.log');

// ---- scope matrix -------------------------------------------------------
const BOARDS = [
  {
    curriculum: 'ICSE',
    grades: ['Class I', 'Class II', 'Class III', 'Class IV', 'Class V', 'Class VI', 'Class VII', 'Class VIII', 'Class IX', 'Class X'],
  },
  {
    curriculum: 'Cambridge',
    grades: ['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'Stage 5', 'Stage 6', 'Stage 7', 'Stage 8', 'Stage 9', 'IGCSE Year 10', 'IGCSE Year 11'],
  },
];

// ---- cli filters --------------------------------------------------------
const argv = process.argv.slice(2);
const onlyCur = (argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;
const onlyGrade = (argv.find((a) => a.startsWith('--grade=')) || '').split('=')[1] || null;

// ---- helpers ------------------------------------------------------------
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch { return {}; }
}
function saveProgress(p) { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2)); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DailyQuotaError extends Error {}

/** Groq JSON call with retry/backoff; distinguishes transient 429 from daily cap. */
async function groqJSON(prompt, { maxTokens = 4096, tries = 5 } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: maxTokens,
      });
      const choice = res.choices[0];
      if (choice.finish_reason === 'length') throw new Error('truncated (MAX_TOKENS)');
      const raw = (choice.message.content || '{}').replace(/```json|```/g, '');
      const m = raw.match(/[[{][\s\S]*[\]}]/);
      if (!m) throw new Error('no JSON found in response');
      return JSON.parse(m[0]);
    } catch (err) {
      const status = err?.status || err?.response?.status;
      const body = String(err?.message || '') + JSON.stringify(err?.error || err?.response?.data || '');
      const isDaily = /daily|per day|tokens per day|TPD|RPD|quota/i.test(body);
      if (status === 429 && isDaily) throw new DailyQuotaError(body.slice(0, 300));
      if (status === 429 || status === 503 || /truncated|no JSON/.test(err.message)) {
        const wait = Math.min(60000, 2000 * 2 ** (attempt - 1));
        log(`   ! groq ${status || err.message} — retry ${attempt}/${tries} in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw new Error('groqJSON exhausted retries');
}

/** Public-outline subjects offered for a given board + grade. */
async function generateSubjects(curriculum, grade) {
  const arr = await groqJSON(
    `List the standard school subjects taught in ${grade} under the ${curriculum} curriculum, based on the publicly published curriculum framework (not any textbook). ` +
    `Return ONLY a JSON array of subject-name strings, e.g. ["Mathematics","English",...]. 6 to 12 subjects. No commentary.`,
    { maxTokens: 512 }
  );
  return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [];
}

/** Units (chapters) + topics outline for one (grade, subject). */
async function generateOutline(curriculum, grade, subject) {
  const data = await groqJSON(
    `You are mapping the publicly published ${curriculum} ${subject} syllabus outline for ${grade}. ` +
    `Produce the list of units/chapters and, under each, the topics — based on the official curriculum structure only (NOT any textbook text). ` +
    `Return ONLY valid JSON in this exact shape: ` +
    `{"units":[{"unitNo":1,"title":"","topics":["topic name",...]}]}. ` +
    `6 to 12 units; each unit 3 to 8 topics. Topic names should be concise concept names.`,
    { maxTokens: 3072 }
  );
  const units = Array.isArray(data?.units) ? data.units : [];
  return units
    .map((u, i) => ({
      unitNo: Number.isFinite(u.unitNo) ? u.unitNo : i + 1,
      title: String(u.title || `Unit ${i + 1}`).trim(),
      topics: (Array.isArray(u.topics) ? u.topics : []).map((t) => String(t).trim()).filter(Boolean),
    }))
    .filter((u) => u.topics.length);
}

// ---- main ---------------------------------------------------------------
(async () => {
  log('=== ICSE + Cambridge bulk ingestion START ===');
  const progress = loadProgress();
  let scopesDone = 0, topicsPublished = 0, qdrantUpserted = 0;

  for (const board of BOARDS) {
    if (onlyCur && board.curriculum !== onlyCur) continue;
    const { curriculum } = board;

    for (const grade of board.grades) {
      if (onlyGrade && grade !== onlyGrade) continue;

      let subjects;
      const subjKey = `${curriculum}|${grade}|__subjects__`;
      if (progress[subjKey]) {
        subjects = progress[subjKey];
      } else {
        subjects = await generateSubjects(curriculum, grade);
        progress[subjKey] = subjects;
        saveProgress(progress);
      }
      log(`${curriculum} / ${grade}: ${subjects.length} subjects -> ${subjects.join(', ')}`);

      for (const subject of subjects) {
        const key = `${curriculum}|${grade}|${subject}`;
        if (progress[key]?.status === 'done') { log(`   = skip (done) ${subject}`); continue; }

        try {
          const outline = await generateOutline(curriculum, grade, subject);
          if (!outline.length) { log(`   ! ${subject}: empty outline, skipping`); progress[key] = { status: 'empty' }; saveProgress(progress); continue; }

          const units = outline.map((u) => ({ unitNo: u.unitNo, title: u.title, topics: u.topics.map((name) => ({ name })) }));
          const allTopics = outline.flatMap((u) => u.topics);
          const topicPreviews = {};
          for (const topicName of allTopics) {
            topicPreviews[topicName] = await previewTopicResources({ curriculum, grade, subject, topicName });
          }

          const result = await approveAndPublish({ grade, subject, curriculum, units, topicPreviews });
          topicsPublished += result.topicsPublished;
          qdrantUpserted += result.qdrant?.upserted || 0;
          progress[key] = { status: 'done', topics: result.topicsPublished, qdrant: result.qdrant?.upserted || 0, held: !!result.qdrant?.held };
          saveProgress(progress);
          scopesDone++;
          log(`   + ${subject}: ${result.topicsPublished} topics, ${result.qdrant?.upserted || 0} embedded${result.qdrant?.held ? ' (gate HELD: ' + (result.validation?.reasons?.[0] || '') + ')' : ''}`);
        } catch (err) {
          if (err instanceof DailyQuotaError) {
            log(`!!! Groq daily quota reached at ${curriculum}/${grade}/${subject}. Progress saved — re-run to resume. (${err.message})`);
            saveProgress(progress);
            process.exit(3);
          }
          log(`   x ${subject}: FAILED ${err.message}`);
          progress[key] = { status: 'error', error: err.message };
          saveProgress(progress);
        }
      }
    }
  }

  log(`=== DONE. scopes:${scopesDone} topicsPublished:${topicsPublished} qdrantUpserted:${qdrantUpserted} ===`);
  process.exit(0);
})();
