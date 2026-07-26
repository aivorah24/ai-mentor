/**
 * pipeline.cjs — the closed-loop content pipeline for G1-G12.
 *
 * Unlike run-batch.cjs (generate once, queue failures for a human/subagent), this
 * REPAIRS what it generates and only publishes what passes. Per topic:
 *
 *     generate → validate → [repair → re-validate] ×N → publish
 *                                  ↓ still failing
 *                             skip + record (never publish a bad lesson)
 *     → attach real book art → final verify (asset gate ON)
 *
 * Repairs are targeted: the model is handed the exact defect list and the current
 * JSON, and told to fix ONLY those fields. Deterministic defects (a broken quiz
 * option, a wrong correct-index, a missing key learning) are fixed in code first,
 * because re-rolling a free model usually reproduces the same mistake.
 *
 * Everything runs on free Groq (the Gemini cap is spent), so cost is ₹0.
 *
 *   node scripts/pipeline.cjs --grade 7                        # whole grade
 *   node scripts/pipeline.cjs --grade 7 --subject Science
 *   node scripts/pipeline.cjs --grades 7,8,9 --per-subject 30  # demo coverage
 *   node scripts/pipeline.cjs --grade 7 --requalify            # re-fix live lessons
 *   node scripts/pipeline.cjs --grade 7 --dry
 *
 * Resumable: progress is checkpointed per topic, so re-running continues.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sb = require('../services/supabase');
const { embed } = require('../services/embeddings');
const { searchGrounding, searchContent } = require('../services/qdrant');
const { validateLesson, optionList } = require('../services/lesson-qa');
const syllabus = require('../services/syllabus-map');
const OFFICIAL = require('./ncert-official-subjects.json').byGrade;

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry');
const REQUALIFY = process.argv.includes('--requalify');
const PER_SUBJECT = parseInt(arg('--per-subject', '9999'), 10);
const MAX_REPAIRS = parseInt(arg('--repairs', '2'), 10);
// Caption-similarity bar for attaching a book image. Real on-topic matches score
// ~0.33-0.50 (captions are prose, topics are short phrases), so 0.42 rejected
// good pictures. At 0.35 we take only the top couple of hits, so the lesson gets
// its most relevant image rather than three loosely-related ones.
const MIN_IMG_SCORE = +arg('--min-score', 0.35);
const MAX_IMAGES = parseInt(arg('--max-images', '2'), 10);
// Units processed in parallel. Each Groq key has its own rate limit and the keys
// rotate, so this scales with how many keys are configured.
const CONCURRENCY = parseInt(arg('--concurrency', '6'), 10);
const NO_OPENROUTER = process.argv.includes('--no-openrouter');
// Repair-only mode: touch ONLY topics that already have a live lesson. Without
// this, a --requalify sweep with a wide worklist would also generate brand-new
// lessons for every ungenerated topic it happened to see.
const ONLY_LIVE = process.argv.includes('--only-live');
const isCodeStub = (t) => /^[a-z]{3,5}\d{2,4}$/i.test(String(t || '').trim());
const CKPT = path.resolve(__dirname, '..', 'data', 'pipeline-checkpoint.json');
const REPORT = path.resolve(__dirname, '..', 'data', 'pipeline-report.json');
const GRADE_AGE = { 1: '6', 2: '7', 3: '8', 4: '9', 5: '10', 6: '11', 7: '12', 8: '13', 9: '14', 10: '15', 11: '16', 12: '17' };

const loadJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const saveJson = (f, v) => { try { fs.writeFileSync(f, JSON.stringify(v, null, 1)); } catch {} };

// ── free LLM (Groq 70B, all keys rotating) ───────────────────────────────────
const GROQ_KEYS = (() => {
  const k = [];
  if (process.env.GROQ_API_KEY) k.push(process.env.GROQ_API_KEY);
  for (let i = 1; i <= 10; i++) if (process.env[`GROQ_API_KEY_${i}`]) k.push(process.env[`GROQ_API_KEY_${i}`]);
  return [...new Set(k.map(x => x.trim()).filter(Boolean))];
})();
let groqIdx = 0;
let callLLM = null; try { callLLM = require('../services/curriculum-intelligence/callLLM').callLLM; } catch {}

// OpenRouter first: Nemotron 120B is far stronger than Groq's 70B, so it writes
// lessons that pass QA on the first attempt and needs fewer repair rounds — which
// makes the whole run FASTER even though each call is a little slower. Groq 70B
// stays as the fallback for when OpenRouter keys are throttled.
const OPENROUTER_KEYS = (() => {
  const k = [];
  if (process.env.OPENROUTER_API_KEY) k.push(process.env.OPENROUTER_API_KEY);
  for (let i = 1; i <= 10; i++) if (process.env[`OPENROUTER_API_KEY_${i}`]) k.push(process.env[`OPENROUTER_API_KEY_${i}`]);
  return [...new Set(k.map(x => x.trim()).filter(Boolean))];
})();
const OR_MODELS = ['nvidia/nemotron-3-super-120b-a12b:free', 'openai/gpt-oss-20b:free'];
let orIdx = 0;

async function callOpenRouter(system, user) {
  for (const model of OR_MODELS) {
    for (let hop = 0; hop < OPENROUTER_KEYS.length; hop++) {
      const key = OPENROUTER_KEYS[orIdx % OPENROUTER_KEYS.length]; orIdx++;
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 120000);
      let res;
      try {
        res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json', Authorization: `Bearer ${key}`,
            'HTTP-Referer': 'https://aivorah.app', 'X-Title': 'Aivorah Pipeline',
          },
          body: JSON.stringify({
            model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            temperature: 0.2, response_format: { type: 'json_object' },
          }),
          signal: ctrl.signal,
        });
      } catch { clearTimeout(to); continue; } finally { clearTimeout(to); }
      if (res.status === 429) continue;           // rotate key, don't sleep
      if (!res.ok) continue;
      const d = await res.json();
      const text = d?.choices?.[0]?.message?.content || '';
      try { return JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} } }
    }
  }
  return null;
}

// STRONG MODELS ONLY. The shared callLLM chain degrades to llama-3.1-8b-instant
// and gemma-9b when the big models are busy, and 8B-grade lessons are exactly the
// quality problem this pipeline exists to prevent. If every strong model is
// throttled we return null — the unit is skipped and retried on the next run,
// which is always better than publishing weak content.
// Ordered strongest-first. Each model has its OWN tokens-per-day allowance, so
// listing several genuinely multiplies daily capacity rather than just retrying.
// (deepseek-r1-distill-llama-70b was here but Groq decommissioned it — it now
// 400s, which the old code mistook for throttling and looped on.)
const GROQ_STRONG = [
  'openai/gpt-oss-120b',        // 120B, strongest available on Groq
  'llama-3.3-70b-versatile',    // 70B — separate TPD bucket
  'qwen/qwen3.6-27b',           // solid 27B, another bucket
];

async function callGroq(model, key, system, user) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, response_format: { type: 'json_object' } }),
      signal: ctrl.signal,
    });
    if (res.status === 429) return { throttled: true };
    if (!res.ok) return null;
    const d = await res.json();
    const text = d?.choices?.[0]?.message?.content || '';
    try { return { json: JSON.parse(text) }; }
    catch { const m = text.match(/\{[\s\S]*\}/); if (m) { try { return { json: JSON.parse(m[0]) }; } catch {} } }
    return null;
  } catch { return null; } finally { clearTimeout(to); }
}

async function callFreeLLM(system, user) {
  if (!NO_OPENROUTER && OPENROUTER_KEYS.length) {
    try { const r = await callOpenRouter(system, user); if (r) return r; } catch {}
  }
  // Rotate every key across the strong Groq models, backing off between rounds.
  for (let round = 0; round < 4; round++) {
    let sawThrottle = false;
    for (const model of GROQ_STRONG) {
      for (let i = 0; i < Math.max(1, GROQ_KEYS.length); i++) {
        const key = GROQ_KEYS[groqIdx % Math.max(1, GROQ_KEYS.length)]; groqIdx++;
        if (!key) break;
        const r = await callGroq(model, key, system, user);
        if (r && r.json) return r.json;
        if (r && r.throttled) sawThrottle = true;
      }
    }
    if (!sawThrottle) break;                       // failing for some other reason
    await new Promise(r => setTimeout(r, 3000 * (round + 1)));
  }
  return null;
}

// ── worklist ─────────────────────────────────────────────────────────────────
async function worklist(grade, subjectFilter) {
  const allowed = (OFFICIAL[String(grade)] || []).map(s => s.toLowerCase());
  const norm = s => (s || '').toLowerCase() === 'evs' ? 'environmental studies' : (s || '').toLowerCase();
  const q = require('../services/qdrant');
  const filter = { must: [{ key: 'grade', match: { value: Number(grade) } }] };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('scroll timeout')), ms))]);
  async function safeScroll(offset) {
    for (let a = 0; a < 3; a++) {
      try { return await withTimeout(q.client.scroll(q.COLLECTION, { limit: 250, offset, filter, with_payload: true, with_vector: false }), 30000); }
      catch (e) { if (a === 2) throw e; await new Promise(r => setTimeout(r, 2000)); }
    }
  }
  const map = {}; let next = null;
  for (let i = 0; i < 80; i++) {
    const r = await safeScroll(next);
    for (const p of (r.points || [])) {
      const pl = p.payload || {};
      const subj = pl.subject || '';
      if (!allowed.includes(norm(subj))) continue;
      if (subjectFilter && subj.toLowerCase() !== subjectFilter.toLowerCase()) continue;
      const topic = String(pl.topic || '').trim();
      if (!topic || isCodeStub(topic)) continue;
      // Never seed a lesson from an image caption — that is where the junk
      // "This image illustrates a banana plantation…" lessons came from.
      if (/^(this|the)\s+(image|picture|photo|figure|comic strip|diagram)\b/i.test(topic) || topic.length > 80) continue;
      const hasText = ((pl.content || '') + (pl.text || '')).trim().length > 40;
      if (!hasText) continue;
      (map[subj] = map[subj] || {})[topic] = true;
    }
    next = r.next_page_offset; if (!next) break;
  }
  // Chapters ingested without a title carry a file code ("legy303") as their
  // topic and are skipped above, which silently hid whole subjects — G11/G12
  // Geography, Sociology and Psychology, G9 Social Science, G5 EVS. Their text
  // is ingested and fine; only the chapter titles were missing.
  // scripts/derive-topics.cjs reads those chapters and recovers real topic
  // names into data/derived-topics.json; merge them in here so they generate
  // through the normal loop.
  const derived = loadJson(path.resolve(__dirname, '..', 'data', 'derived-topics.json'), {});
  for (const [key, topics] of Object.entries(derived)) {
    const [g, subject] = key.split('|');
    if (String(g) !== String(grade)) continue;
    if (!allowed.includes(norm(subject))) continue;
    if (subjectFilter && subject.toLowerCase() !== subjectFilter.toLowerCase()) continue;
    for (const t of topics || []) {
      const topic = String(t && t.topic || '').trim();
      if (topic && !isCodeStub(topic)) (map[subject] = map[subject] || {})[topic] = true;
    }
  }

  const list = [];
  for (const [subject, topics] of Object.entries(map)) {
    Object.keys(topics).sort().slice(0, PER_SUBJECT).forEach(topic => list.push({ subject, topic }));
  }
  return list.sort((a, b) => a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic));
}

async function publishedMap(grade) {
  const map = new Map();
  const { data: chs } = await sb.from('syllabus_chapters').select('id,subject,title').eq('grade', `Grade ${grade}`);
  if (!chs || !chs.length) return map;
  const chById = {}; chs.forEach(c => { chById[c.id] = c; });
  const { data: tps } = await sb.from('syllabus_topics').select('id,chapter_id').in('chapter_id', chs.map(c => c.id));
  if (!tps || !tps.length) return map;
  const tpToCh = {}; tps.forEach(t => { tpToCh[t.id] = t.chapter_id; });
  const { data: res } = await sb.from('topic_resources').select('topic_id,static_payload')
    .eq('resource_type', 'AI_EXPLANATION').eq('status', 'READY').in('topic_id', tps.map(t => t.id));
  (res || []).forEach(r => { const ch = chById[tpToCh[r.topic_id]]; if (ch) map.set(`${ch.subject}|${ch.title}`, r.static_payload); });
  return map;
}

// ── generate ─────────────────────────────────────────────────────────────────
// Returns the grounding text AND which NCERT chapter it came from. The chapter
// codes were being discarded, so a published lesson recorded nothing about its
// own source: the "real book" pane had no PDF to open, and QA could not tell a
// grounded lesson from an invented one (every sampled lesson reported
// `bookLinked: false` even though generation is grounded and refuses to run
// without evidence). Keeping the provenance makes the lesson auditable.
async function getEvidence(grade, subject, topic) {
  const vector = await embed(`${topic} ${subject} grade ${grade}`);
  const { chunks } = await searchGrounding({ vector, curriculum: 'NCERT', grade: Number(grade), subject, limit: 6 });
  const top = (chunks || []).slice(0, 5);
  const text = top
    .map(c => (c.payload?.content || c.payload?.text || '').slice(0, 500))
    .filter(Boolean).join('\n---\n');
  if (!text) return null;
  // Chunk payloads carry the book chapter code (e.g. "lepy101") in `topic`.
  const codes = [...new Set(top
    .map(c => c?.payload?.topic)
    .filter(c => /^[a-z]{4,6}\d{3}$/i.test(c)))];
  return { text, chapterCodes: codes, pdfFile: codes.length ? `${codes[0]}.pdf` : null };
}

function lessonSchemaHint(isMath) {
  return `{"instructionalType":"...","intro":"...","keyLearnings":["...","..."],"originalLesson":["poem/story lines verbatim, else omit"],"body":["2-4 short paragraphs"],"workedExamples":[${isMath ? '{"problem":"...","steps":["step 1","step 2"],"answer":"..."}' : ''}],"vocab":[{"word":"...","definition":"..."}],"thinkAndReflect":["..."],"keyTakeaways":["..."],"quiz":[{"type":"mcq","question":"...","options":["a","b","c","d"],"correct":0,"hint":"...","explanation":"..."},{"type":"fill_blank","question":"... ___","correct":"word","hint":"...","explanation":"..."}]}`;
}

async function generate(grade, subject, topic, evidence) {
  const isMath = /math/i.test(subject);
  const age = GRADE_AGE[grade] || '12';
  const maxWords = grade <= 2 ? 20 : grade <= 5 ? 26 : grade <= 8 ? 32 : 40;
  // Depth and register both scale with grade. The prompt used to call every
  // student "a child" and ask only for "2-4 short paragraphs", which is why
  // senior lessons came out as four generic sentences.
  const senior = Number(grade) >= 9;
  const minWords = Number(grade) >= 11 ? 180 : Number(grade) >= 9 ? 150 : Number(grade) >= 6 ? 110 : 60;
  const system = senior
    ? `You are an expert NCERT Grade ${grade} ${subject} teacher preparing a ${age}-year-old for board examinations. Write with the depth and precision the syllabus demands: correct terminology, exact definitions, real figures/dates/cases, and the standard method the board expects. Do NOT write for a young child and do NOT use childish analogies. Ground EVERYTHING in the provided evidence — never invent. Output ONLY valid JSON.`
    : `You are an expert NCERT Grade ${grade} ${subject} teacher writing one lesson for a ${age}-year-old. Teach the way a real teacher teaches a child that age. Ground EVERYTHING in the provided evidence — never invent. Output ONLY valid JSON.`;
  const mathRules = isMath
    ? `\nMaths rules: use the STANDARD method; give 2-3 worked examples; EVERY worked example needs at least 2 steps; re-check every answer arithmetically before writing it.`
    : '';
  const user = `Create a complete lesson on "${topic}" for NCERT Grade ${grade} ${subject}.
EVIDENCE:
"""
${evidence.text}
"""${mathRules}
Write sentences a ${age}-year-old reads easily — average under ${maxWords} words per sentence.
DEPTH: the "body" must total at least ${minWords} words across its paragraphs, and must teach the actual
content of the chapter — specific facts, figures, dates, named cases, or the steps of the method as the
evidence gives them. Generic filler ("X was an important movement", "this helps in many ways") is a failure:
every sentence must carry information a student could be examined on.${senior ? `
Use the subject's proper terminology and define each term the first time it appears. No childish analogies.` : ''}
Return ONLY JSON: ${lessonSchemaHint(isMath)}
Quiz needs >=3 grounded questions with correct answers. Omit workedExamples if not maths.`;
  return await callFreeLLM(system, user);
}

// ── repair ───────────────────────────────────────────────────────────────────
// Deterministic first: fixes we can make correctly in code, without a model.
function autoFix(L, subject, topic) {
  if (!L || typeof L !== 'object') return L;
  const isMath = /math/i.test(subject || '');

  if (typeof L.body === 'string') L.body = [L.body];
  if (!Array.isArray(L.body)) L.body = [];
  if (!Array.isArray(L.keyLearnings)) L.keyLearnings = [];

  // A quiz question that cannot be repaired is dropped — but only while at least
  // two valid ones remain, so we never trade one defect for "too few questions".
  const qz = Array.isArray(L.quiz) ? L.quiz : (Array.isArray(L.practiceQuiz) ? L.practiceQuiz : []);
  if (qz.length) {
    const good = qz.filter(q => {
      const type = String(q.type || '').toLowerCase();
      if (type === 'fill_blank' || type === 'shortanswer' || type === 'short_answer') return q.correct != null || q.answer != null;
      if (type === 'truefalse' || type === 'true_false') return q.answer != null || q.correct != null || q.correctIndex != null;
      const opts = optionList(q).map(o => String(o || '').trim());
      const idx = typeof q.correct === 'number' ? q.correct : (typeof q.correctIndex === 'number' ? q.correctIndex : null);
      return opts.length >= 2 && !opts.some(o => !o) && new Set(opts).size === opts.length && idx != null && idx >= 0 && idx < opts.length;
    });
    if (good.length >= 2 && good.length < qz.length) L.quiz = good;
  }

  // Worked examples with a single step teach nothing; the tutor needs to walk at
  // least two. Only the model can write the missing reasoning, so flag by leaving
  // it — but drop examples that are entirely empty.
  if (Array.isArray(L.workedExamples)) {
    L.workedExamples = L.workedExamples.filter(e => e && e.problem && e.answer != null);
    // A worked example needs >=2 steps to teach anything, and the QA rulebook
    // treats ANY lesson carrying workedExamples as maths — so a thin example in a
    // non-maths subject (Chemistry, Computer Science) failed the maths rule while
    // the repair prompt, built with isMath=false, showed the model an empty
    // workedExamples slot and gave it nothing to fix. That combination made those
    // lessons permanently "unfixable after 2 repairs".
    //
    // Worked examples are optional outside maths, so drop the thin ones instead of
    // losing the whole lesson. In maths they are the point of the lesson: only drop
    // one while a valid example survives, otherwise leave it for the model to fix.
    const solid = L.workedExamples.filter(e => Array.isArray(e.steps) && e.steps.length >= 2);
    if (solid.length !== L.workedExamples.length && (!isMath || solid.length >= 1)) {
      L.workedExamples = solid;
    }
    if (!L.workedExamples.length) delete L.workedExamples;
  }
  return L;
}

async function repair(L, fails, grade, subject, topic, evidence) {
  const isMath = /math/i.test(subject);
  const age = GRADE_AGE[grade] || '12';
  const maxWords = grade <= 2 ? 20 : grade <= 5 ? 26 : grade <= 8 ? 32 : 40;
  const system = `You are a meticulous NCERT Grade ${grade} ${subject} editor. You are given a lesson JSON and a list of defects found by automated QA. Fix ONLY those defects. Keep everything else byte-identical. Output ONLY the corrected, complete JSON.`;
  const user = `TOPIC: ${topic} (Grade ${grade} ${subject}, reader age ${age})

DEFECTS FOUND BY QA — every one must be gone in your output:
${fails.map((f, i) => `${i + 1}. ${f}`).join('\n')}

HOW TO FIX:
- "bad math"/"wrong answer": recompute the arithmetic yourself and correct the ANSWER (and the option the correct index points at). Mind negative numbers.
- "missing steps": give the worked example at least 2 real steps that show the method.
- "sentences too long": split into shorter sentences, average under ${maxWords} words. Do not lose meaning.
- "no worked examples": add 2 worked examples with problem, >=2 steps, and a verified answer.
- "<2 quiz questions"/option problems: write valid questions with 4 distinct non-empty options and a correct index pointing at the truly correct one.
- "<2 keyLearnings"/"body too thin"/"intro": write real, grounded content from the evidence.
- "placeholder": replace meta text ("Welcome to the lesson") with real teaching.

EVIDENCE (ground everything here, invent nothing):
"""
${evidence.text}
"""

CURRENT LESSON JSON:
${JSON.stringify(L).slice(0, 12000)}

Return ONLY the corrected JSON in the same shape: ${lessonSchemaHint(isMath)}`;
  return await callFreeLLM(system, user);
}

// ── art ──────────────────────────────────────────────────────────────────────
// Figures cropped from the book PDFs, bucketed by chapter code, for the fallback.
const FIG_BY_CODE = (() => {
  const m = new Map();
  try {
    const raw = require(path.resolve(__dirname, '..', 'data', 'ncert_figures_index.json'));
    for (const f of (Array.isArray(raw) ? raw : Object.values(raw).flat())) {
      if (!f || !f.url || !f.code) continue;
      if ((f.w || 0) < 120 || (f.h || 0) < 100) continue;      // slivers/rules
      if ((f.w || 1) / (f.h || 1) > 6) continue;               // banner strips
      if (!m.has(f.code)) m.set(f.code, []);
      m.get(f.code).push(f);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.page || 0) - (b.page || 0));
  } catch {}
  return m;
})();

async function findArt(grade, subject, topic, chapterTitle) {
  const query = `${topic} ${chapterTitle || ''} ${subject} grade ${grade}`;
  // 1. Best: an image whose Vision caption is actually about this topic.
  try {
    const vector = await embed(query);
    const hits = await searchContent({ vector, curriculum: 'NCERT', grade: Number(grade), subject, contentType: 'image', limit: 8 });
    const good = (hits || [])
      .filter(h => h.score >= MIN_IMG_SCORE && h.payload && h.payload.image_url)
      .slice(0, MAX_IMAGES)
      .map(h => ({ image: h.payload.image_url, altText: cleanCaption(h.payload.topic), source: h.payload.source_reference || '', score: +h.score.toFixed(3) }));
    if (good.length) return good;
  } catch {}
  // 2. Fallback: a figure cropped from the chapter this lesson is grounded in.
  //    Weaker relevance than a caption match, but a real picture from the right
  //    chapter still beats an empty "Illustration coming soon" pane.
  try {
    const vector = await embed(query);
    const { chunks } = await searchGrounding({ vector, curriculum: 'NCERT', grade: Number(grade), subject, limit: 6 });
    const codes = [...new Set((chunks || []).map(c => c?.payload?.topic).filter(c => /^[a-z]{4,6}\d{3}$/i.test(c)))];
    const figs = [];
    for (const code of codes) for (const f of FIG_BY_CODE.get(code) || []) if (figs.length < 3) figs.push(f);
    return figs.map((f, i) => ({
      image: f.url,
      altText: `Picture ${i + 1} from your NCERT book — ${chapterTitle || topic} (page ${f.page})`,
      source: `${f.code} p${f.page}`,
    }));
  } catch { return []; }
}
function cleanCaption(raw) {
  let s = String(raw || '').replace(/\*\*/g, '').trim();
  s = s.replace(/^(this|the)\s+(image|picture|photo|figure|comic strip|diagram)\s+(appears to\s+)?(is|shows|depicts|illustrates|represents)\s*/i, '');
  s = s.replace(/\s+/g, ' ');
  const truncated = String(raw || '').trim().length >= 78 && !/[.!?]$/.test(s);
  if (truncated) s = s.replace(/\s+\S*$/, '') + '…';
  if (!s) return 'A picture from your NCERT book.';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── publish ──────────────────────────────────────────────────────────────────
async function publish(grade, subject, topic, L, art, evidence) {
  const payload = {
    instructionalType: L.instructionalType || 'Concept', grade: Number(grade), subject,
    intro: L.intro, keyLearnings: L.keyLearnings || [], whatYoullLearn: L.keyLearnings || [],
    originalLesson: L.originalLesson || undefined, body: L.body || [],
    workedExamples: L.workedExamples || undefined, vocab: L.vocab || [],
    thinkAndReflect: L.thinkAndReflect || [], keyTakeaways: L.keyTakeaways || [],
    activity: (L.thinkAndReflect || [])[0] || '',
    illustrationPrompts: art && art.length ? art : undefined,
    practiceQuiz: L.quiz || undefined,
    // Provenance: which NCERT chapter this lesson was generated from. Drives the
    // "real book" pane and lets QA verify grounding instead of assuming it.
    pdfFile: (evidence && evidence.pdfFile) || undefined,
    sourceChapters: (evidence && evidence.chapterCodes && evidence.chapterCodes.length)
      ? evidence.chapterCodes : undefined,
  };
  // Place the lesson under its REAL textbook chapter. Previously a chapter row
  // was invented per topic with unit_no hardcoded to 1, so the app listed
  // generated topic names as chapters ("Area of a Triangle" instead of Ch 1
  // Sets) and every unit held exactly one topic. The chapter now comes from the
  // syllabus map built from the PDFs, and many topics share one chapter.
  const mapped = syllabus.resolveChapter({
    grade, subject, topic,
    chapterCodes: (evidence && evidence.chapterCodes) || [],
  });
  const chapterTitle = mapped ? mapped.title : topic;
  const unitNo = mapped ? mapped.chapter : 1;
  if (mapped && mapped.bookPath) payload.bookPath = mapped.bookPath;
  if (mapped) payload.chapterTitle = mapped.title;

  let { data: ch } = await sb.from('syllabus_chapters').select('id')
    .eq('grade', `Grade ${grade}`).eq('subject', subject).eq('title', chapterTitle).maybeSingle();
  if (!ch) {
    const r = await sb.from('syllabus_chapters')
      .insert({ grade: `Grade ${grade}`, subject, curriculum: 'CBSE', unit_no: unitNo, title: chapterTitle }).select('id').single();
    ch = r.data;
  } else if (mapped) {
    // Keep the number in step with the book if this row predates the map.
    await sb.from('syllabus_chapters').update({ unit_no: unitNo }).eq('id', ch.id);
  }

  let { data: tp } = await sb.from('syllabus_topics').select('id').eq('chapter_id', ch.id).eq('name', topic).maybeSingle();
  if (!tp) {
    // Order topics by their subtopic position so a unit reads in book order.
    let order = 99;
    if (mapped) {
      const i = (mapped.subtopics || []).findIndex(s =>
        String(topic).toLowerCase().includes(String(s.title || '').toLowerCase()));
      if (i >= 0) order = i + 1;
    }
    const r = await sb.from('syllabus_topics')
      .insert({ chapter_id: ch.id, topic_order: order, name: topic, kind: 'Topic', intro: L.intro, content_origin: 'ai_generated' })
      .select('id').single();
    tp = r.data;
  }
  await sb.from('topic_resources').delete().eq('topic_id', tp.id).in('resource_type', ['AI_EXPLANATION', 'PRACTICE']);
  const rows = [{ topic_id: tp.id, resource_type: 'AI_EXPLANATION', status: 'READY', source_tier: 'ORIGINAL_AI', source: 'Aivorah closed-loop pipeline', static_payload: payload }];
  if (payload.practiceQuiz) rows.push({ topic_id: tp.id, resource_type: 'PRACTICE', status: 'READY', source_tier: 'ORIGINAL_AI', source: 'Grounded quiz', static_payload: { quiz: payload.practiceQuiz } });
  await sb.from('topic_resources').insert(rows);
  return payload;
}

// ── one unit, end to end ─────────────────────────────────────────────────────
async function processTopic(grade, subject, topic, existing) {
  const evidence = await getEvidence(grade, subject, topic);
  if (!evidence) return { status: 'no-grounding' };

  let L = existing ? { ...existing } : null;
  let repairs = 0;
  // A published payload stores its questions as `practiceQuiz`, while generation
  // and publish both speak `quiz`. Normalise on the way in or a requalified
  // lesson would be re-published with its quiz silently dropped.
  if (L && !L.quiz && Array.isArray(L.practiceQuiz)) L.quiz = L.practiceQuiz;

  if (!L) {
    L = await generate(grade, subject, topic, evidence);
    // null means every STRONG model was throttled — skip, never publish a weak
    // lesson. The checkpoint leaves it unrecorded so the next run retries it.
    if (!L) return { status: 'llm-unavailable' };
  }
  L = autoFix(L, subject, topic);

  // Art is attached before the final check so the asset gate is evaluated on
  // exactly what will ship.
  let art = await findArt(grade, subject, topic);
  const opts = { grade, subject, topic, requireAsset: art.length > 0 || !/math/i.test(subject) };

  let fails = validateLesson({ ...L, illustrationPrompts: art }, L.quiz, { ...opts, requireAsset: false });
  while (fails.length && repairs < MAX_REPAIRS) {
    repairs++;
    let fixed = null;
    try { fixed = await repair(L, fails, grade, subject, topic, evidence); } catch { /* keep previous */ }
    if (!fixed) break;
    fixed = autoFix(fixed, subject, topic);
    const newFails = validateLesson({ ...fixed, illustrationPrompts: art }, fixed.quiz, { ...opts, requireAsset: false });
    // Only accept a repair that genuinely improves things.
    if (newFails.length < fails.length) { L = fixed; fails = newFails; }
    if (!fails.length) break;
  }

  if (fails.length) return { status: 'unfixable', fails, repairs };
  if (DRY) return { status: 'would-publish', repairs, art: art.length };

  const published = await publish(grade, subject, topic, L, art, evidence);
  // Final verification against what is actually in the database, asset gate ON.
  const finalFails = validateLesson(published, published.practiceQuiz, { grade, subject, topic, requireAsset: true });
  return { status: finalFails.length ? 'published-with-warnings' : 'published', repairs, art: art.length, finalFails };
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  const gradesArg = arg('--grades') || arg('--grade');
  if (!gradesArg) { console.error('need --grade N or --grades 7,8,9'); process.exit(1); }
  const grades = String(gradesArg).split(',').map(s => s.trim()).filter(Boolean);
  const subjectFilter = arg('--subject');

  const ckpt = loadJson(CKPT, { done: {} });
  const report = loadJson(REPORT, { runs: [] });
  const started = Date.now();

  for (const grade of grades) {
    const [list, pub] = await Promise.all([worklist(grade, subjectFilter), publishedMap(grade)]);
    const bySubject = {};
    list.forEach(x => { (bySubject[x.subject] = bySubject[x.subject] || []).push(x.topic); });

    console.log(`\n${'='.repeat(66)}`);
    console.log(`GRADE ${grade} — ${list.length} topics across ${Object.keys(bySubject).length} subjects${DRY ? ' [DRY]' : ''}`);
    console.log(Object.entries(bySubject).map(([s, t]) => `  ${s}: ${t.length}`).join('\n'));
    console.log('='.repeat(66));

    for (const [subject, topics] of Object.entries(bySubject)) {
      const tally = { published: 0, repaired: 0, kept: 0, unfixable: 0, nogrounding: 0, error: 0 };
      console.log(`\n── G${grade} ${subject} (${topics.length} units) ──`);

      // Work through the unit list with a small pool. Each topic is independent
      // (its own retrieval, generation, repair and publish), and the time is
      // nearly all network wait, so a pool turns ~1 min/unit into a workable rate.
      const queue = topics.slice();
      const worker = async () => {
        for (;;) {
          const topic = queue.shift();
          if (!topic) return;
          const key = `G${grade}|${subject}|${topic}`;
          const live = pub.get(`${subject}|${topic}`);

          if (live && !REQUALIFY) { tally.kept++; continue; }
          if (ckpt.done[key] && !REQUALIFY) { tally.kept++; continue; }
          if (ONLY_LIVE && !live) continue;   // repair-only sweep: nothing to repair

          // REQUALIFY: keep a live lesson that already passes; only repair failures.
          if (live && REQUALIFY) {
            const liveFails = validateLesson(live, live.practiceQuiz, { grade, subject, topic, requireAsset: true });
            if (!liveFails.length) { tally.kept++; ckpt.done[key] = { status: 'passing', at: Date.now() }; continue; }
          }

          try {
            const r = await processTopic(grade, subject, topic, live && REQUALIFY ? live : null);
            if (r.status === 'published' || r.status === 'would-publish') {
              tally.published++; if (r.repairs) tally.repaired++;
              console.log(`  ✅ ${topic}${r.repairs ? ` (repaired ×${r.repairs})` : ''}${r.art ? ` +${r.art} book image` : ''}`);
            } else if (r.status === 'published-with-warnings') {
              tally.published++; if (r.repairs) tally.repaired++;
              console.log(`  ⚠️  ${topic} — published, still: ${(r.finalFails || []).slice(0, 2).join('; ')}`);
            } else if (r.status === 'no-grounding') {
              tally.nogrounding++;
            } else if (r.status === 'llm-unavailable') {
              // Every strong model was throttled. Skip WITHOUT checkpointing so
              // the next run retries it — never publish weak-model content.
              tally.throttled = (tally.throttled || 0) + 1;
              continue;
            } else {
              tally.unfixable++;
              console.log(`  ❌ ${topic} — unfixable after ${r.repairs || 0} repairs: ${(r.fails || []).slice(0, 2).join('; ')}`);
            }
            ckpt.done[key] = { status: r.status, at: Date.now() };
          } catch (e) {
            tally.error++;
            console.log(`  ❌ ${topic} — ${String(e.message).slice(0, 70)}`);
          }
          saveJson(CKPT, ckpt);
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      console.log(`   → ${tally.published} published (${tally.repaired} needed repair) · ${tally.kept} already live · ${tally.unfixable} unfixable · ${tally.nogrounding} no grounding · ${tally.throttled || 0} throttled (will retry) · ${tally.error} errors`);
      report.runs.push({ grade, subject, ...tally, at: new Date().toISOString() });
      saveJson(REPORT, report);
    }
  }
  console.log(`\nDone in ${Math.round((Date.now() - started) / 60000)} min. Report → data/pipeline-report.json`);
})();
