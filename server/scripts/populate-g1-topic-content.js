#!/usr/bin/env node
/**
 * populate-g1-topic-content.js
 *
 * Fills topic_resources with REAL, RAG-grounded per-topic content for the
 * Grade 1 review build (English book aemr1 + Maths book aejm1), so the student
 * LessonScreen (DB path) shows Learn body + Key Learnings + Listen (English
 * only) + Practice + vocab instead of empty "TRY THIS YOURSELF" boxes.
 *
 * Grounding: chapter text is pulled from the existing Qdrant NCERT chunks
 * (grade 1, subject) by matching the topic title — never invented. One LLM
 * call per topic turns that real text into Grade-1 simplified content
 * (intro, key learnings, body, activity, vocab, and for Maths a step-by-step
 * Math Helper + worked example). Maths gets NO audio (founder directive).
 *
 * Idempotent: deletes a topic's existing topic_resources rows before writing.
 *
 * Usage:  node scripts/populate-g1-topic-content.js [--subject English] [--only "Two Little Hands"] [--dry]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const supabase = require('../services/supabase');
const { client, COLLECTION } = require('../services/qdrant');

// Read every chapter PDF for a grade-1 subject once and return { code: text }.
// Used to map a topic title to its real source PDF by scanning the actual book
// text (the chunk `topic` field proved unreliable — title words span chunks).
const _pdfCache = {};
async function loadPdfTexts(folder) {
  if (_pdfCache[folder]) return _pdfCache[folder];
  const dir = path.join(__dirname, '..', 'data', 'ncert_books', 'grade1', folder);
  const map = {};
  for (const f of fs.readdirSync(dir).filter((n) => /\.pdf$/i.test(n))) {
    try { map[f] = (await pdf(fs.readFileSync(path.join(dir, f)))).text.toLowerCase().replace(/\s+/g, ' '); }
    catch { map[f] = ''; }
  }
  _pdfCache[folder] = map;
  return map;
}
// Best PDF for a title: prefer the file where the exact title phrase occurs;
// break ties / fall back on title-token frequency.
function resolvePdf(pdfTexts, title) {
  const t = String(title).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = t.split(/\s+/).filter((w) => w.length > 3);
  let best = '', bestScore = -1;
  for (const [file, text] of Object.entries(pdfTexts)) {
    const norm = text.replace(/[’']/g, "'");
    const phrase = (norm.split(t).length - 1) * 100;
    const tok = tokens.reduce((a, w) => a + (norm.split(w).length - 1), 0);
    const score = phrase + tok;
    if (score > bestScore) { bestScore = score; best = file; }
  }
  return bestScore > 0 ? best : '';
}

const argVal = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const ONLY_SUBJECT = argVal('--subject', null);
const ONLY_TOPIC = argVal('--only', null);
const DRY = process.argv.includes('--dry');
const GRADE = 'Grade 1';

// ── LLM chain: OpenRouter → Groq → NVIDIA (never Grok/Gemini) ──────────────
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
function collectKeys(prefix) {
  const keys = [];
  if (process.env[prefix]) keys.push(process.env[prefix]);
  for (let i = 1; i <= 30; i++) if (process.env[`${prefix}_${i}`]) keys.push(process.env[`${prefix}_${i}`]);
  return [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
}
const EPS = [];
for (const m of ['nvidia/nemotron-3-super-120b-a12b:free', 'openai/gpt-oss-20b:free', 'nvidia/nemotron-nano-9b-v2:free'])
  collectKeys('OPENROUTER_API_KEY').forEach((key) => EPS.push({ provider: 'openrouter', model: m, key }));
for (const m of ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'])
  collectKeys('GROQ_API_KEY').forEach((key) => EPS.push({ provider: 'groq', model: m, key }));
for (const m of ['nvidia/llama-3.3-nemotron-super-49b-v1'])
  collectKeys('NVIDIA_NIM_API_KEY').forEach((key) => EPS.push({ provider: 'nvidia', model: m, key }));

async function callLLM(system, user) {
  if (!EPS.length) throw new Error('No LLM API keys configured');
  let lastErr;
  for (const ep of EPS) {
    const url = ep.provider === 'groq' ? GROQ_URL : ep.provider === 'nvidia' ? NVIDIA_URL : OPENROUTER_URL;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.key}` };
    if (ep.provider === 'openrouter') { headers['HTTP-Referer'] = 'https://aivorah.app'; headers['X-Title'] = 'Aivorah G1 content'; }
    const payload = { model: ep.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.4 };
    if (ep.provider !== 'nvidia') payload.response_format = { type: 'json_object' };
    if (ep.provider === 'nvidia') payload.max_tokens = 1400;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), ep.provider === 'nvidia' ? 200000 : 60000);
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: ctrl.signal });
        clearTimeout(to);
      } catch (e) { lastErr = e; break; }
      if (res.ok) {
        const data = await res.json();
        const c = data.choices?.[0]?.message?.content;
        if (!c) { lastErr = new Error('empty'); break; }
        try { return JSON.parse(c); } catch (_) {
          const m = c.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch (__) {} }
          lastErr = new Error('non-JSON'); break;
        }
      }
      const txt = await res.text();
      if (res.status === 429) {
        if (/per day|daily|quota/i.test(txt)) { console.log(`   ${ep.model} daily quota — rotating`); break; }
        const w = parseFloat(txt.match(/try again in ([\d.]+)s/i)?.[1] || 6) + 1;
        console.log(`   rate limited, waiting ${w}s`); await new Promise((r) => setTimeout(r, w * 1000)); continue;
      }
      if ([404, 500, 502, 503, 504].includes(res.status)) { console.log(`   ${ep.model} ${res.status} — switching`); lastErr = new Error(`${res.status}`); break; }
      lastErr = new Error(`${ep.provider} ${res.status}: ${txt.slice(0, 120)}`); break;
    }
  }
  throw lastErr || new Error('all endpoints failed');
}

// ── RAG: pull real chapter text for a title from Qdrant ────────────────────
// Returns [{text, code}] so we can also identify the SOURCE PDF (the `topic`
// field is the book code, e.g. aemr101 → aemr101.pdf) and show the real book.
async function scrollChunks(must, maxChars) {
  const chunks = []; let offset = null;
  do {
    const r = await client.scroll(COLLECTION, { filter: { must }, limit: 20, offset: offset ?? undefined, with_payload: true, with_vector: false });
    for (const pt of r.points) { const t = pt?.payload?.text || pt?.payload?.content || ''; if (t) chunks.push({ text: t, code: pt?.payload?.topic || '' }); }
    offset = r.next_page_offset ?? null;
  } while (offset !== null && chunks.reduce((a, c) => a + c.text.length, 0) < maxChars);
  return chunks;
}
async function getContext(title, subject, maxChars = 6000) {
  const all = await scrollChunks(
    [{ key: 'grade', match: { value: 1 } }, { key: 'subject', match: { value: subject } }],
    maxChars * 4,
  );
  const t = String(title).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
  const tokens = t.split(/\s+/).filter((w) => w.length > 3);
  const hits = all.filter((c) => { const low = c.text.toLowerCase(); return low.includes(t) || tokens.some((tok) => low.includes(tok)); });
  const used = hits.length ? hits : all;
  const text = used.map((c) => c.text).join('\n\n').slice(0, maxChars);
  // Dominant source code among the hits → the chapter's PDF file.
  const counts = {};
  for (const c of used) if (c.code) counts[c.code] = (counts[c.code] || 0) + 1;
  const code = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
  return { text, code };
}

// Strip NCERT page furniture so the read-aloud voice never speaks date stamps,
// print marks or teacher notes ("18-05-2023 14:39:51 Mridang", "Reprint 2026-27",
// "Chapter 2.indd 79", "Note to the teacher • ...").
function cleanForAudio(text) {
  return String(text)
    .replace(/\d{1,2}-\d{1,2}-\d{2,4}\s*\d{1,2}[:.]\d{2}(?:[:.]\d{2})?/g, ' ')
    .replace(/\bReprint\s*20\d{2}-\d{2}\b/gi, ' ')
    .replace(/Chapter\s*\d+\.indd\s*\d+/gi, ' ')
    .replace(/\bMridang\b/g, ' ')
    // Header/label run that PDF extraction splices mid-text, e.g.
    // "Unit 1 My Family and Me Chapter 1 Two Little Hands Let us sing".
    .replace(/\bUnit\s*\d+\b[^.]*?\bChapter\s*\d+\b[^.]*?(?=\bLet us\b|\bSight words\b|[A-Z][a-z])/gi, ' ')
    .replace(/\bLet us (sing|read|speak|do|write|match|play|learn|listen)\b/gi, ' ')
    // "2 Sight words one to", "Sight words one to" — the sight-word label + its list.
    .replace(/\b\d*\s*Sight words\b[^.]*?(?=[A-Z][a-z])/gi, ' ')
    // "New words sing, they touch ..." and standalone word-list dumps are apparatus.
    .replace(/\bNew words\b[^.]*/gi, ' ')
    // Pedagogical apparatus that always trails the real content in NCERT primers.
    .replace(/\bNote to the teacher\b[^]*/gi, ' ')
    .replace(/\b[A-D]\.\s*(Repeat after the teacher|Talk in pairs|Read|Match|Circle|Look and say|Draw)\b[^]*/gi, ' ')
    .replace(/\b(Teacher|Children|Nitin|Neha)\s*:[^]*/gi, ' ')
    .replace(/\bNow circle\b[^.]*\.?/gi, ' ')
    .replace(/\bAsk your partner\b[^.]*\.?/gi, ' ')
    .replace(/[•·]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Split real text into 2-4 Listen parts (English only).
function toListenParts(text) {
  const clean = cleanForAudio(text).replace(/\s{2,}/g, ' ').trim();
  const sentences = clean.replace(/([.!?])\s+/g, '$1|').split('|').filter(Boolean);
  const target = Math.ceil(sentences.length / 3) || 1;
  const parts = []; let cur = [];
  for (const s of sentences) { cur.push(s); if (cur.length >= target) { parts.push(cur.join(' ')); cur = []; } }
  if (cur.length) parts.push(cur.join(' '));
  return parts.slice(0, 4).map((p, i) => ({ heading: `Part ${i + 1}`, text: p }));
}

async function genEnglish(title, ctx) {
  const system = `You write simplified, warm Grade 1 CBSE English lesson content for a 6-year-old, grounded ONLY in the real textbook text given. Never invent facts. Return strict JSON only.`;
  const user = `Lesson: "${title}" (Grade 1 CBSE English).
Real textbook text from this lesson:
"""${ctx}"""

Return JSON exactly:
{ "intro": "one warm sentence: what you'll learn (Coursera-style preface)",
  "keyLearnings": ["3 to 4 short 'you will learn to...' bullet points, grounded in the text"],
  "body": ["paragraph 1", "paragraph 2", "paragraph 3"],
  "activity": "one tiny try-it-yourself question a 6-year-old can do, from this lesson",
  "vocab": [ {"word":"...","definition":"very simple, max 8 words"} ] }

Rules:
- "vocab": pick 4-6 REAL words the lesson introduces (look for New words / Sight words lists or repeated nouns/verbs). Only words that appear in the text above.
- "body": 3 short paragraphs, 2-3 simple sentences each, plain warm English for a 6-year-old.
- No markdown, no text outside the JSON.`;
  return callLLM(system, user);
}

async function genMaths(title, ctx) {
  const system = `You write simplified Grade 1 CBSE Mathematics lesson content for a 6-year-old, grounded ONLY in the real textbook text given. Return strict JSON only. This is Maths: show a step-by-step worked example, not audio narration.`;
  const user = `Chapter: "${title}" (Grade 1 CBSE Mathematics).
Real textbook text from this chapter:
"""${ctx}"""

Return JSON exactly:
{ "intro": "one warm sentence: what you'll learn",
  "keyLearnings": ["3 to 4 short 'you will learn to...' points grounded in the text"],
  "body": ["paragraph 1", "paragraph 2", "paragraph 3"],
  "keyIdeas": ["2-3 key maths ideas/rules from this chapter, plain words"],
  "formula": "the main rule/formula in words or symbols if any, else empty string",
  "example": { "problem": "one simple worked problem from this chapter's topic",
               "steps": ["Step 1: ...","Step 2: ...","Step 3: ..."],
               "answer": "the final answer as a short sentence" },
  "activity": "one tiny try-it-yourself sum a 6-year-old can do",
  "vocab": [ {"word":"...","definition":"very simple, max 8 words"} ] }

Rules:
- Numbers small and Grade-1 appropriate. Show every step, solve line by line.
- Ground everything in the text above; do not invent unrelated topics.
- No markdown, no text outside the JSON.`;
  return callLLM(system, user);
}

async function writeResources(topicId, isMath, payload) {
  const rows = [
    { topic_id: topicId, resource_type: 'AI_EXPLANATION', status: 'READY', source_tier: 'OFFICIAL_BOOK', source: 'NCERT textbook (RAG-grounded)', static_payload: payload },
    { topic_id: topicId, resource_type: 'PRACTICE', status: 'READY', source_tier: 'ORIGINAL_AI', source: 'Grounded in chapter text', static_payload: { grounded: true } },
    { topic_id: topicId, resource_type: 'BOOK_REFERENCE', status: 'READY', source_tier: 'OFFICIAL_BOOK', source: 'NCERT textbook', static_payload: null },
    { topic_id: topicId, resource_type: 'IMAGES', status: 'NOT_AVAILABLE', source_tier: null, source: null, static_payload: null },
    { topic_id: topicId, resource_type: 'AUDIO', status: isMath ? 'NOT_AVAILABLE' : 'READY', source_tier: isMath ? null : 'OFFICIAL_BOOK', source: isMath ? null : 'Read-aloud of chapter text', static_payload: null },
    { topic_id: topicId, resource_type: 'FLASHCARDS', status: 'NOT_AVAILABLE', source_tier: null, source: null, static_payload: null },
    { topic_id: topicId, resource_type: 'WORKSHEETS', status: 'NOT_AVAILABLE', source_tier: null, source: null, static_payload: null },
    { topic_id: topicId, resource_type: 'OER_MAPPING', status: 'NOT_AVAILABLE', source_tier: null, source: null, static_payload: null },
  ];
  await supabase.from('topic_resources').delete().eq('topic_id', topicId);
  const { error } = await supabase.from('topic_resources').insert(rows);
  if (error) throw new Error(error.message);
}

(async () => {
  const { data: chapters } = await supabase.from('syllabus_chapters')
    .select('id, title, subject').eq('grade', GRADE);
  let subjects = [...new Set((chapters || []).map((c) => c.subject))];
  if (ONLY_SUBJECT) subjects = subjects.filter((s) => new RegExp(ONLY_SUBJECT, 'i').test(s));

  const report = { done: [], flagged: [], failed: [] };
  for (const subject of subjects) {
    const isMath = /math/i.test(subject);
    const chIds = (chapters || []).filter((c) => c.subject === subject).map((c) => c.id);
    // Ordered so the index-based PDF fallback (aejm101, aejm102, …) is correct.
    const { data: chOrder } = await supabase.from('syllabus_chapters').select('id, unit_no').in('id', chIds).order('unit_no');
    const orderIdx = {}; (chOrder || []).forEach((c, i) => { orderIdx[c.id] = i; });
    const bookPrefix = isMath ? 'aejm1' : 'aemr1'; // grade-1 book codes
    const { data: topicsRaw } = await supabase.from('syllabus_topics')
      .select('id, name, chapter_id, topic_order').in('chapter_id', chIds);
    const topics = (topicsRaw || []).sort((a, b) => (orderIdx[a.chapter_id] - orderIdx[b.chapter_id]) || (a.topic_order - b.topic_order));
    const list = topics.filter((t) => !ONLY_TOPIC || t.name === ONLY_TOPIC);
    console.log(`\n=== ${subject}: ${list.length} topic(s) ===`);
    for (let ti = 0; ti < list.length; ti++) {
      const t = list[ti];
      try {
        const { text: ctx } = await getContext(t.name, subject);
        if (ctx.trim().length < 120) { console.log(`  - ${t.name}: NO CONTEXT (${ctx.length} chars) — skipping`); report.flagged.push(`${subject}/${t.name} (no RAG text)`); continue; }
        // Real source PDF for the "View in Book" pane — resolved by scanning the
        // actual book text for the title (accurate), with book-order fallback.
        const folder = isMath ? 'mathematics' : 'english';
        const bookDir = path.join(__dirname, '..', 'data', 'ncert_books', 'grade1', folder);
        const pdfTexts = await loadPdfTexts(folder);
        let pdfFile = resolvePdf(pdfTexts, t.name);
        if (!pdfFile) {
          const idxCode = `${bookPrefix}${String(ti + 1).padStart(2, '0')}`;
          pdfFile = fs.existsSync(path.join(bookDir, `${idxCode}.pdf`)) ? `${idxCode}.pdf` : '';
        }
        const out = isMath ? await genMaths(t.name, ctx) : await genEnglish(t.name, ctx);
        const body = Array.isArray(out.body) ? out.body.filter((p) => typeof p === 'string' && p.trim()) : [];
        if (body.length < 2) { console.log(`  - ${t.name}: thin body — flagged`); report.flagged.push(`${subject}/${t.name} (thin body)`); }
        const payload = {
          intro: out.intro || '',
          keyLearnings: Array.isArray(out.keyLearnings) ? out.keyLearnings : [],
          body,
          activity: out.activity || '',
          vocab: Array.isArray(out.vocab) ? out.vocab.filter((v) => v && v.word) : [],
          grounded: true, grade: GRADE, subject,
          pdfFile: pdfFile || undefined, pdfPage: 1,
        };
        if (isMath) {
          payload.mathHelper = {
            formula: out.formula || '',
            keyIdeas: Array.isArray(out.keyIdeas) ? out.keyIdeas : [],
            example: out.example && out.example.problem ? out.example : null,
          };
        } else {
          payload.listenParts = toListenParts(ctx);
        }
        console.log(`  - ${t.name}: body=${body.length}p vocab=${payload.vocab.length}${isMath ? ' +mathHelper' : ` listen=${payload.listenParts.length}`}`);
        if (!DRY) await writeResources(t.id, isMath, payload);
        report.done.push(`${subject}/${t.name}`);
      } catch (e) {
        console.log(`  - ${t.name}: FAILED ${e.message}`);
        report.failed.push(`${subject}/${t.name}: ${e.message}`);
      }
    }
  }
  console.log('\n===== SUMMARY =====');
  console.log('DONE   :', report.done.length);
  console.log('FLAGGED:', report.flagged.length, report.flagged);
  console.log('FAILED :', report.failed.length, report.failed);
  if (DRY) console.log('(--dry: nothing written)');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
