/**
 * Canonical extraction for the ICSE/Cambridge ingestion pipeline — a
 * dedicated copy of services/syllabusExtraction.js's contract (same
 * canonical JSON shape, same idempotency/caching table, same confidence
 * philosophy), NOT a modification of that file.
 *
 * Why a separate copy instead of reusing syllabusExtraction.js directly:
 * real official documents (Cambridge/ICSE curriculum PDFs) need a larger
 * output-token budget than that file's Gemini call allows for the verbose
 * per-element-confidence schema. Fixing that in syllabusExtraction.js would
 * touch CBSE's shared extraction path, which the founder explicitly asked
 * not to change. This module stays entirely separate — CBSE's behavior is
 * provably unaffected since it never calls this file.
 *
 * Uses Groq (not Gemini) — per explicit instruction (2026-07-21): Gemini
 * quota is limited, so this pipeline runs on Groq like routes/ncert.js's
 * other AI-generation calls (llama-3.3-70b-versatile, same model/pattern).
 */
const crypto = require('crypto');
const supabase = require('../supabase');
const Groq = require('groq-sdk');

// Switched from llama-3.3-70b-versatile after its daily org-wide token quota
// (100k TPD) was exhausted mid-session (2026-07-21) on a large IGCSE Biology
// syllabus. llama-3.1-8b-instant is the other model already used elsewhere
// in this codebase (routes/ncert.js) — separate quota bucket, smaller/faster,
// lower capability for very large documents; if it also struggles, the
// document may need chunked multi-pass extraction instead of one call.
const GROQ_MODEL = 'llama-3.1-8b-instant';

// Lazy-instantiated: the SDK throws synchronously in its constructor if
// GROQ_API_KEY is unset, which would crash this module at require() time
// (e.g. under jest, which doesn't load .env by default) even for tests that
// never actually call the API.
let _groq = null;
function getGroqClient() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

function hashFile(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function logStage(jobId, stage, data = {}) {
  console.log(JSON.stringify({ pipeline: 'curriculum_canonical_extraction', jobId, stage, ts: new Date().toISOString(), ...data }));
}

async function callGroqJSON(prompt) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');
  const response = await getGroqClient().chat.completions.create({
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 8192, // llama-3.1-8b-instant's actual output cap on Groq — 32768 would be rejected
  });
  const choice = response.choices[0];
  const text = choice.message.content || '{}';
  const finishReason = choice.finish_reason === 'length' ? 'MAX_TOKENS' : choice.finish_reason;
  return { text, finishReason };
}

function cleanText(raw) {
  return raw
    .replace(/^Reprint\s+\d{4}-\d{2,4}\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 18000);
}

// Slightly lighter schema than syllabusExtraction.js's (drops per-image/
// per-activity/per-vocab confidence, keeping one topic-level confidence
// instead) — real documents produce fewer, denser tokens this way, reducing
// truncation risk further even with the raised token budget above.
const CANONICAL_PROMPT = (grade, subject, curriculum, rawText) => `You are extracting an OFFICIAL ${curriculum} curriculum/syllabus document into a structured canonical format with a CONFIDENCE score (0-100 integer) per unit and per topic, based on how clearly the source text supports it.

Grade: ${grade || 'unknown'}. Subject: ${subject || 'unknown'}. Curriculum: ${curriculum}.

This is an OFFICIAL CURRICULUM/SYLLABUS document (not a textbook) — extract the curriculum HIERARCHY: subjects -> units/strands -> topics -> learning objectives. Do not invent topics not present in the text.

For the book/document, and every Unit -> Topic, extract:
- name/title + confidence
- "learningObjectives": the actual learning objectives/outcomes stated in the document for that topic, each as {"text":"<objective, from the source>","confidence":<0-100>} — empty array if none stated
- "summary": 1-2 sentences describing what the topic covers, in your own words, based on the source

Also return top-level "overallConfidence" (0-100) and "warnings": [string] for anything unclear or missing.

Return ONLY valid JSON, no markdown, in this exact shape:
{
  "book": {"title": "", "confidence": 0},
  "units": [{"unitNo": 1, "title": "", "confidence": 0, "topics": [{
    "name": "", "confidence": 0, "summary": "", "learningObjectives": []
  }]}],
  "overallConfidence": 0,
  "warnings": []
}

TEXT:
${rawText}`;

/**
 * @param {Buffer} fileBuffer
 * @param {(buf:Buffer)=>Promise<string>} extractRawText
 * @param {{grade:string, subject:string, curriculum:string}} params
 * @returns {Promise<{jobId:string, canonical:object, cached:boolean}>}
 */
async function runCanonicalExtraction(fileBuffer, extractRawText, { grade, subject, curriculum }) {
  const pipelineStart = Date.now();
  const fileHash = hashFile(fileBuffer);
  const jobId = `${fileHash.slice(0, 12)}_${grade}_${subject}_${curriculum}`.replace(/\s+/g, '');
  logStage(jobId, 'upload_received', { fileHash, grade, subject, curriculum });

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
    const { text: rawJsonText, finishReason } = await callGroqJSON(CANONICAL_PROMPT(grade, subject, curriculum, rawText));
    if (finishReason === 'MAX_TOKENS') {
      throw new Error('Groq response was truncated (MAX_TOKENS) even at the raised token budget — document may be too large for a single extraction pass.');
    }
    const jsonMatch = rawJsonText.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in Groq response.');
    canonical = JSON.parse(jsonMatch[0]);
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

module.exports = { runCanonicalExtraction, hashFile, logStage };
