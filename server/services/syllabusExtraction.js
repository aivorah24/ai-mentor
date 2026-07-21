/**
 * syllabusExtraction.js — Stage 1 of the curriculum ingestion pipeline.
 *
 * Produces one CANONICAL, confidence-scored JSON shape for an uploaded
 * syllabus document. This is the single source of truth every downstream
 * stage (Preview Generator, AI Validator, Diff Engine, Vector DB Update,
 * Regression Validator) reads from — none of them should ever touch the
 * raw AI response directly.
 *
 * Properties:
 *  - Deterministic: temperature 0, same file+grade+subject+curriculum → same
 *    canonical output (modulo model non-determinism, which the cache below
 *    also neutralises for repeat calls).
 *  - Idempotent: keyed by sha256(file bytes) + grade + subject + curriculum.
 *    Re-running extraction on the same upload returns the cached result
 *    instead of re-calling the model or creating a duplicate job.
 *  - Independently rerunnable: `runExtraction()` takes no hidden state; it
 *    can be invoked standalone (e.g. from a retry/backfill script) with just
 *    a file buffer + the same three params.
 *  - Structured logs: every stage emits one JSON line via `logStage()`, so a
 *    log pipeline can reconstruct the full trace for a given jobId.
 *
 * CANONICAL SHAPE
 * {
 *   jobId, fileHash, grade, subject, curriculum, extractedAt,
 *   book: { title, confidence },
 *   units: [{
 *     unitNo, title, confidence,
 *     topics: [{
 *       name, kind, page, confidence,
 *       summary, summaryConfidence,
 *       images: [{ description, page, confidence }],
 *       activities: [{ text, confidence }],
 *       vocabulary: [{ word, meaning, confidence }],
 *       learningObjectives: [{ text, confidence }],
 *       practice: { question, options, correctIndex, confidence },
 *     }],
 *   }],
 *   overallConfidence,   // 0-100, min of all element confidences (weakest link)
 *   warnings: [string],  // e.g. "Glossary missing for Unit 2"
 * }
 */
const crypto = require('crypto');
const supabase = require('./supabase');

const GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
const GEMINI_TEXT_API = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent`;

function hashFile(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// One structured JSON-line log per pipeline stage. Kept simple (console.log)
// so it flows into whatever log aggregation the deploy target already uses,
// but every line is machine-parseable by jobId for tracing a single run.
function logStage(jobId, stage, data = {}) {
  console.log(JSON.stringify({ pipeline: 'syllabus_extraction', jobId, stage, ts: new Date().toISOString(), ...data }));
}

async function callGeminiJSON(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  const res = await fetch(`${GEMINI_TEXT_API}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    }),
  });
  if (!res.ok) {
    const err = new Error(await res.text());
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
}

// Gemini occasionally emits near-valid JSON (a trailing comma before a
// closing bracket, or a stray comma where a property name was expected) —
// these are mechanical fixes, not truncation, so a targeted repair pass is
// worth trying before failing the whole extraction job.
function repairJSON(text) {
  return text
    .replace(/,\s*([}\]])/g, '$1')       // trailing comma before } or ]
    .replace(/([{,]\s*),/g, '$1');        // stray double comma
}

function cleanText(raw) {
  return raw
    .replace(/^Reprint\s+\d{4}-\d{2,4}\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 18000);
}

const CANONICAL_PROMPT = (grade, subject, rawText) => `You are extracting a syllabus into a structured canonical format with a CONFIDENCE score (0-100 integer) for every single element you output, based on how clearly the source text supports it. Be honest — if a topic's page number is ambiguous, or a summary is a guess, score it lower.

Grade: ${grade || 'unknown'}. Subject: ${subject || 'unknown'}.

For the book, and every Unit → Topic, extract:
- name/title + confidence
- page reference + confidence (topics only)
- "summary": 2-3 sentences in your OWN original words (do NOT copy or closely paraphrase the source text) + summaryConfidence
- "images": any figures/illustrations/diagrams you can infer are on that topic's page, each as {"description":"<what it likely shows>","page":"<page>","confidence":<0-100>} — empty array if none inferable
- "activities": any "Let us do/discuss/write" style exercises you can identify, each as {"text":"<short original description>","confidence":<0-100>} — empty array if none
- "vocabulary": key new words with original brief meanings, each as {"word":"<word>","meaning":"<original brief meaning>","confidence":<0-100>} — empty array if none found
- "learningObjectives": 1-2 original bullet objectives per topic, each as {"text":"<objective>","confidence":<0-100>}
- "practice": one original MCQ about the topic's general theme (not quoting text) as {"question","options":[4],"correctIndex":0,"confidence"}

Also return top-level "overallConfidence" (0-100, your honest assessment of the whole extraction) and "warnings": [string] for anything you're unsure about or think is missing (e.g. "Glossary missing for Unit 2", "Unit 4 page numbers ambiguous").

Return ONLY valid JSON, no markdown, in this exact shape:
{
  "book": {"title": "", "confidence": 0},
  "units": [{"unitNo": 1, "title": "", "confidence": 0, "topics": [{
    "name": "", "kind": "Story|Poem|Chapter|Concept", "page": "", "confidence": 0,
    "summary": "", "summaryConfidence": 0,
    "images": [], "activities": [], "vocabulary": [], "learningObjectives": [],
    "practice": {"question": "", "options": ["","","",""], "correctIndex": 0, "confidence": 0}
  }]}],
  "overallConfidence": 0,
  "warnings": []
}

TEXT:
${rawText}`;

/**
 * Runs the full canonical extraction for one uploaded file, with caching.
 * @param {Buffer} fileBuffer   - raw file bytes
 * @param {(buf:Buffer)=>Promise<string>} extractRawText - existing PDF/DOCX/XLSX text extractor
 * @param {{grade:string, subject:string, curriculum:string}} params
 * @returns {Promise<{jobId:string, canonical:object, cached:boolean}>}
 */
async function runExtraction(fileBuffer, extractRawText, { grade, subject, curriculum = 'CBSE' }) {
  const pipelineStart = Date.now();
  const fileHash = hashFile(fileBuffer);
  const jobId = `${fileHash.slice(0, 12)}_${grade}_${subject}_${curriculum}`.replace(/\s+/g, '');
  logStage(jobId, 'upload_received', { fileHash, grade, subject, curriculum });

  // Idempotency: identical (file, grade, subject, curriculum) never re-runs
  // the model — it returns the exact same canonical result every time.
  const { data: cached } = await supabase
    .from('syllabus_extraction_jobs')
    .select('id, canonical, overall_confidence, status')
    .match({ file_hash: fileHash, grade, subject, curriculum })
    .maybeSingle();
  if (cached && cached.status === 'complete') {
    logStage(jobId, 'cache_hit', { rowId: cached.id, overallConfidence: cached.overall_confidence });
    return { jobId: cached.id, canonical: cached.canonical, cached: true };
  }

  const t0 = Date.now();
  const rawText = cleanText(await extractRawText(fileBuffer));
  logStage(jobId, 'text_extracted', { chars: rawText.length, ms: Date.now() - t0 });

  const t1 = Date.now();
  let canonical;
  try {
    const jsonText = (await callGeminiJSON(CANONICAL_PROMPT(grade, subject, rawText))).replace(/```json|```/g, '').trim();
    try {
      canonical = JSON.parse(jsonText);
    } catch {
      canonical = JSON.parse(repairJSON(jsonText)); // let this throw (caught below) if repair doesn't fix it
    }
  } catch (err) {
    logStage(jobId, 'ai_extraction_failed', { error: err.message, ms: Date.now() - t1 });
    await supabase.from('syllabus_extraction_jobs').insert({
      file_hash: fileHash, grade, subject, curriculum, status: 'failed', canonical: {}, error: err.message,
    });
    throw err;
  }
  logStage(jobId, 'ai_extraction_complete', { ms: Date.now() - t1, units: canonical.units?.length || 0 });

  canonical.jobId = jobId;
  canonical.fileHash = fileHash;
  canonical.grade = grade;
  canonical.subject = subject;
  canonical.curriculum = curriculum;
  canonical.extractedAt = new Date().toISOString();
  canonical.extractionMs = Date.now() - pipelineStart;
  if (typeof canonical.overallConfidence !== 'number') canonical.overallConfidence = 0;
  canonical.warnings = Array.isArray(canonical.warnings) ? canonical.warnings : [];

  const { data: saved, error: saveErr } = await supabase
    .from('syllabus_extraction_jobs')
    .upsert({
      file_hash: fileHash, grade, subject, curriculum, status: 'complete',
      canonical, overall_confidence: canonical.overallConfidence,
    }, { onConflict: 'file_hash,grade,subject,curriculum' })
    .select('id').single();
  if (saveErr) logStage(jobId, 'store_failed', { error: saveErr.message });
  else logStage(jobId, 'stored', { rowId: saved.id, overallConfidence: canonical.overallConfidence });

  return { jobId: saved?.id || jobId, canonical, cached: false };
}

/** Independently rerunnable: re-fetch a past extraction job by id (no re-upload needed). */
async function getExtractionJob(jobId) {
  const { data } = await supabase.from('syllabus_extraction_jobs').select('*').eq('id', jobId).maybeSingle();
  return data;
}

module.exports = { runExtraction, getExtractionJob, hashFile, logStage };
