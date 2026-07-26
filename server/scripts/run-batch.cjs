// run-batch.cjs — the lean G1-12 batch runner.
// For each generatable topic of a grade: lean Gemini generate → publish live.
// Grounded, official-subject-gated, cheap (~₹0.27/topic), fast (seconds/topic).
//
//   node scripts/run-batch.cjs --grade 1
//   node scripts/run-batch.cjs --grade 1 --limit 5      # cap for a test slice
//   node scripts/run-batch.cjs --grade 1 --subject Mathematics
//
// A budget guard stops the run if cumulative Gemini token cost exceeds --budget
// (rupees, default 200) so it can never blow the cap.
require('dotenv').config();
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const sb = require('../services/supabase');
const { embed } = require('../services/embeddings');
const { searchGrounding } = require('../services/qdrant');
const OFFICIAL = require('./ncert-official-subjects.json').byGrade;

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const isCodeStub = (t) => /^[a-z]{3,5}\d{2,4}$/i.test(String(t || '').trim());
const TMP = path.resolve(require('os').tmpdir(), 'aivorah_batch');
fs.mkdirSync(TMP, { recursive: true });

// GLOBAL spend ledger — a persistent file shared by EVERY run-batch invocation so
// --budget is a hard cap across ALL grades (G1-G12), never per-grade. This is the
// safety guard that guarantees the Gemini cap can't be blown across many runs.
const LEDGER = path.resolve(__dirname, '..', 'data', 'batch-spend-ledger.json');
function readSpend() { try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')).spend || 0; } catch { return 0; } }
function addSpend(rupees) {
  const cur = readSpend() + rupees;
  try { fs.writeFileSync(LEDGER, JSON.stringify({ spend: cur, updated: new Date().toISOString() })); } catch {}
  return cur;
}

async function worklist(grade, subjectFilter) {
  const allowed = (OFFICIAL[String(grade)] || []).map(s => s.toLowerCase());
  const norm = s => (s || '').toLowerCase() === 'evs' ? 'environmental studies' : (s || '').toLowerCase();
  const q = require('../services/qdrant');
  // Filter SERVER-SIDE by grade so Qdrant returns only this grade's points
  // (fast) instead of scrolling the whole 57k-point collection in JS (which hung
  // the batch for hours). grade is stored as an integer in the NCERT collection;
  // we also accept the "Grade N"/"Class N" string variants via a broad match.
  // The NCERT collection stores grade as an integer — filter on that (same as
  // searchContent). Mixing string variants triggered a Bad Request (index is int).
  const filter = { must: [{ key: 'grade', match: { value: Number(grade) } }] };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('scroll timeout')), ms))]);
  async function safeScroll(offset) {
    for (let a = 0; a < 3; a++) {
      try { return await withTimeout(q.client.scroll(q.COLLECTION, { limit: 250, offset, filter, with_payload: true, with_vector: false }), 30000); }
      catch (e) { if (a === 2) throw e; await new Promise(r => setTimeout(r, 2000)); }
    }
  }
  const map = {}; let next = null;
  for (let i = 0; i < 60; i++) {
    const r = await safeScroll(next);
    for (const p of (r.points || [])) {
      const pl = p.payload || {};
      const subj = pl.subject || '';
      if (!allowed.includes(norm(subj))) continue;
      if (subjectFilter && subj.toLowerCase() !== subjectFilter.toLowerCase()) continue;
      const topic = pl.topic || '';
      if (!topic || isCodeStub(topic)) continue;
      const hasText = ((pl.content || '') + (pl.text || '')).trim().length > 40;
      map[subj] = map[subj] || {};
      if (hasText) map[subj][topic] = true;
    }
    next = r.next_page_offset; if (!next) break;
  }
  const list = [];
  for (const [subject, topics] of Object.entries(map)) for (const topic of Object.keys(topics)) list.push({ subject, topic });
  return list.sort((a, b) => a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic));
}

// Pre-fetch ALL published lessons for a grade in a few queries (was 3 PER topic).
// Returns a Map "subject|title" → { payload } so --requalify can re-validate the
// existing lesson and fix it if it fails QA.
async function publishedMap(grade) {
  const map = new Map();
  const { data: chs } = await sb.from('syllabus_chapters').select('id,subject,title').eq('grade', `Grade ${grade}`);
  if (!chs || !chs.length) return map;
  const chById = {}; chs.forEach(c => { chById[c.id] = c; });
  const { data: tps } = await sb.from('syllabus_topics').select('id,chapter_id').in('chapter_id', chs.map(c => c.id));
  if (!tps || !tps.length) return map;
  const tpToCh = {}; tps.forEach(t => { tpToCh[t.id] = t.chapter_id; });
  const { data: res } = await sb.from('topic_resources').select('topic_id,static_payload').eq('resource_type', 'AI_EXPLANATION').eq('status', 'READY').in('topic_id', tps.map(t => t.id));
  (res || []).forEach(r => { const ch = chById[tpToCh[r.topic_id]]; if (ch) map.set(`${ch.subject}|${ch.title}`, { payload: r.static_payload }); });
  return map;
}

// ── INLINE generation (Gemini) + publish — no per-topic process spawns, no
//    MiniLM reload. This is the big speedup: model loads ONCE, everything runs
//    in-process, Gemini (fast) does the work. ~3-4s/topic vs ~15s before.
const GRADE_AGE = { 1: '6', 2: '7', 3: '8', 4: '9', 5: '10', 6: '11', 7: '12', 8: '13', 9: '14', 10: '15', 11: '16', 12: '17' };

// FREE generation — Gemini cap is exhausted, so we use Groq Llama-3.3-70B (fast +
// free) with all GROQ keys rotating on rate-limits, then fall back to the shared
// OpenRouter/NVIDIA chain (callLLM) if every Groq key is throttled.
const GROQ_KEYS = (() => { const k = []; if (process.env.GROQ_API_KEY) k.push(process.env.GROQ_API_KEY); for (let i = 1; i <= 10; i++) if (process.env[`GROQ_API_KEY_${i}`]) k.push(process.env[`GROQ_API_KEY_${i}`]); return [...new Set(k.map(x => x.trim()).filter(Boolean))]; })();
let groqIdx = 0;
let callLLM = null; try { callLLM = require('../services/curriculum-intelligence/callLLM').callLLM; } catch {}

async function callFreeLLM(system, user) {
  // Try Groq 70B across keys first (fast).
  const model = 'llama-3.3-70b-versatile';
  for (let hop = 0; hop < GROQ_KEYS.length * 2; hop++) {
    const key = GROQ_KEYS[groqIdx % GROQ_KEYS.length]; groqIdx++;
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 60000);
    let res;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, response_format: { type: 'json_object' } }),
        signal: ctrl.signal,
      });
    } catch (e) { clearTimeout(to); continue; } finally { clearTimeout(to); }
    if (res.status === 429) { await new Promise(r => setTimeout(r, 1500)); continue; } // rotate key
    if (!res.ok) { continue; }
    const d = await res.json();
    const text = d?.choices?.[0]?.message?.content || '';
    try { return JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} } }
  }
  // Fallback: the shared multi-provider chain (OpenRouter Nemotron → NVIDIA).
  if (callLLM) return await callLLM(system, user, { json: true, temperature: 0.2 });
  throw new Error('all free LLMs unavailable');
}

// Shared automated-QA check (mirrors scripts/qa-validate.cjs) — used as the
// pre-publish gate so no defective lesson is ever published.
const _PLACEHOLDER = /^(welcome to the lesson|summary of|practice .* using a variety|watch the video|this lesson (is about|covers))/i;
function _computeAns(problem) {
  const m = String(problem || '').match(/(\d+)\s*([+\-×x*÷/])\s*(\d+)/);
  if (!m) return null; const a = +m[1], op = m[2], b = +m[3];
  return op === '+' ? a + b : op === '-' ? a - b : (op === '×' || op === 'x' || op === '*') ? a * b : (b ? Math.floor(a / b) : null);
}
function validateLesson(L, isMath) {
  const f = [];
  if (!L) return ['no payload'];
  const body = Array.isArray(L.body) ? L.body : (typeof L.body === 'string' ? [L.body] : []);
  const kl = Array.isArray(L.keyLearnings) ? L.keyLearnings : [];
  if (!L.intro || String(L.intro).length < 15) f.push('intro');
  if (kl.length < 2) f.push('keyLearnings');
  if (body.join(' ').length < 60) f.push('body-thin');
  if (_PLACEHOLDER.test(String(L.intro || '').trim())) f.push('placeholder');
  body.forEach(b => { if (_PLACEHOLDER.test(String(b).trim())) f.push('placeholder-body'); });
  if (isMath && Array.isArray(L.workedExamples)) {
    for (const ex of L.workedExamples) { const want = _computeAns(ex.problem); const gm = String(ex.answer).match(/-?\d+/); const got = gm ? parseInt(gm[0], 10) : NaN; const isDiv = /÷|\//.test(String(ex.problem || '')); if (want != null && !isNaN(got) && want !== got && !isDiv) f.push('bad-math'); }
  }
  const qz = L.quiz || [];
  if (!Array.isArray(qz) || qz.length < 2) f.push('quiz<2');
  qz.forEach((q, i) => {
    const t = String(q.type || '').toLowerCase();
    if (t === 'fill_blank' || t === 'shortanswer') { if (q.correct == null && q.answer == null) f.push(`q${i + 1}-noans`); return; }
    if (t === 'truefalse') { if (q.answer == null && q.correct == null && q.correctIndex == null) f.push(`q${i + 1}-tf`); return; }
    const opts = (q.options || []).map(o => String(o || '').trim());
    const idx = typeof q.correct === 'number' ? q.correct : (typeof q.correctIndex === 'number' ? q.correctIndex : null);
    if (opts.length < 2 || opts.some(o => !o) || new Set(opts).size !== opts.length) f.push(`q${i + 1}-opts`);
    if (idx == null || idx < 0 || idx >= opts.length) f.push(`q${i + 1}-idx`);
    else { const want = _computeAns(q.question); if (want != null && opts[idx] != null) { const got = parseInt(opts[idx].replace(/[^0-9-]/g, ''), 10); if (!isNaN(got) && got !== want) f.push(`q${i + 1}-wrong`); } }
  });
  return f;
}

async function generateLesson(grade, subject, topic) {
  const vector = await embed(`${topic} ${subject} grade ${grade}`);
  const { chunks } = await searchGrounding({ vector, curriculum: 'NCERT', grade, subject, limit: 6 });
  const evidence = (chunks || []).slice(0, 5).map(c => (c.payload?.content || c.payload?.text || '').slice(0, 500)).filter(Boolean).join('\n---\n');
  if (!evidence) return null; // no grounding → never fabricate
  const isMath = /math/i.test(subject);
  const age = GRADE_AGE[grade] || '10';
  const system = `You are an expert NCERT Grade ${grade} ${subject} teacher creating one lesson for a ${age}-year-old. Teach the way a real teacher teaches a child that age. Ground EVERYTHING in the provided evidence — never invent. Output ONLY valid JSON.`;
  const mathRules = isMath ? `\nMaths: every worked example uses the correct STANDARD column method; verify each answer; include 2-3 worked examples.` : '';
  const user = `Create a complete lesson on "${topic}" for NCERT Grade ${grade} ${subject}.\nEVIDENCE:\n"""\n${evidence}\n"""${mathRules}\nReturn ONLY JSON: {"instructionalType":"...","intro":"...","keyLearnings":["..."],"originalLesson":["poem/story lines verbatim, else omit"],"body":["2-4 short paragraphs"],"workedExamples":[${isMath ? '{"problem":"...","steps":["..."],"answer":"..."}' : ''}],"vocab":[{"word":"...","definition":"..."}],"thinkAndReflect":["..."],"keyTakeaways":["..."],"quiz":[{"type":"mcq","question":"...","options":["a","b","c","d"],"correct":0,"hint":"...","explanation":"..."},{"type":"fill_blank","question":"... ___","correct":"word","hint":"...","explanation":"..."}]}\nQuiz ≥3 grounded questions with correct answers. Omit workedExamples if not maths.`;
  // Generate ONCE (no wasteful free-LLM regeneration), then run the automated QA
  // gate. Pass → publish. Fail → return the fails so the caller records it for a
  // targeted QA-SUBAGENT fix pass (a subagent fixes it directly — far better than
  // blindly re-rolling the free model, which usually fails the same way).
  const cand = await callFreeLLM(system, user);
  const fails = validateLesson(cand, isMath);
  if (fails.length > 0) return { lesson: null, rupees: 0, qaFails: fails };
  cand.grade = Number(grade); cand.subject = subject; cand.topic = topic;
  return { lesson: cand, rupees: 0 }; // free models

}

async function publishLesson(grade, subject, topic, L) {
  const payload = {
    instructionalType: L.instructionalType || 'Concept', grade: Number(grade), subject,
    intro: L.intro, keyLearnings: L.keyLearnings || [], whatYoullLearn: L.keyLearnings || [],
    originalLesson: L.originalLesson || undefined, body: L.body || [], workedExamples: L.workedExamples || undefined,
    vocab: L.vocab || [], thinkAndReflect: L.thinkAndReflect || [], keyTakeaways: L.keyTakeaways || [],
    activity: (L.thinkAndReflect || [])[0] || '', practiceQuiz: L.quiz || undefined,
  };
  let { data: ch } = await sb.from('syllabus_chapters').select('id').eq('grade', `Grade ${grade}`).eq('subject', subject).eq('title', topic).maybeSingle();
  if (!ch) { const r = await sb.from('syllabus_chapters').insert({ grade: `Grade ${grade}`, subject, curriculum: 'CBSE', unit_no: 1, title: topic }).select('id').single(); ch = r.data; }
  let { data: tp } = await sb.from('syllabus_topics').select('id').eq('chapter_id', ch.id).eq('name', topic).maybeSingle();
  if (!tp) { const r = await sb.from('syllabus_topics').insert({ chapter_id: ch.id, topic_order: 1, name: topic, kind: 'Chapter', intro: L.intro, content_origin: 'ai_generated' }).select('id').single(); tp = r.data; }
  await sb.from('topic_resources').delete().eq('topic_id', tp.id).in('resource_type', ['AI_EXPLANATION', 'PRACTICE']);
  const rows = [{ topic_id: tp.id, resource_type: 'AI_EXPLANATION', status: 'READY', source_tier: 'ORIGINAL_AI', source: 'Aivorah lean pipeline', static_payload: payload }];
  if (payload.practiceQuiz) rows.push({ topic_id: tp.id, resource_type: 'PRACTICE', status: 'READY', source_tier: 'ORIGINAL_AI', source: 'Grounded quiz', static_payload: { quiz: payload.practiceQuiz } });
  await sb.from('topic_resources').insert(rows);
}

(async () => {
  const grade = arg('--grade');
  if (!grade) { console.error('need --grade'); process.exit(1); }
  const subjectFilter = arg('--subject');
  const limit = parseInt(arg('--limit', '9999'), 10);
  const budget = parseFloat(arg('--budget', '200'));

  const requalify = process.argv.includes('--requalify');
  const [list, pub] = await Promise.all([worklist(grade, subjectFilter).then(l => l.slice(0, limit)), publishedMap(grade)]);
  console.log(`\n=== BATCH Grade ${grade}${subjectFilter ? ' · ' + subjectFilter : ''}: ${list.length} topics (${pub.size} already live)${requalify ? ' [REQUALIFY]' : ''} ===\n`);

  let done = 0, skipped = 0, failed = 0, gradeSpend = 0, requalFixed = 0;
  for (const { subject, topic } of list) {
    const existing = pub.get(`${subject}|${topic}`);
    if (existing) {
      if (!requalify) { skipped++; continue; }
      // REQUALIFY: re-check the published lesson; if it PASSES QA, keep it.
      const fails = validateLesson(existing.payload, /math/i.test(subject));
      if (fails.length === 0) { skipped++; continue; }
      console.log(`🔎 ${subject} / ${topic} — published lesson FAILS QA (${fails.slice(0, 3).join(',')}) → regenerating`);
      requalFixed++; // fall through to regenerate + overwrite below
    }
    if (readSpend() >= budget) { console.log(`\n💰 GLOBAL budget ₹${budget} reached. Stopping — cap protected.`); break; }
    try {
      const gen = await generateLesson(grade, subject, topic);
      if (!gen) { failed++; continue; } // no grounding
      if (!gen.lesson) {
        console.log(`⚠️  ${subject} / ${topic} — failed QA (${(gen.qaFails || []).slice(0, 3).join(',')}) → queued for subagent fix`);
        // Record to the QA-fix queue so a Claude subagent can repair it later.
        const QF = path.resolve(__dirname, '..', 'data', 'qa-fix-queue.json');
        let queue = []; try { queue = JSON.parse(fs.readFileSync(QF, 'utf8')); } catch {}
        queue.push({ grade: Number(grade), subject, topic, fails: gen.qaFails, at: new Date().toISOString() });
        try { fs.writeFileSync(QF, JSON.stringify(queue, null, 1)); } catch {}
        failed++; continue;
      }
      await publishLesson(grade, subject, topic, gen.lesson);
      const total = addSpend(gen.rupees); gradeSpend += gen.rupees;
      console.log(`✅ ${subject} / ${topic}   [GLOBAL ₹${total.toFixed(2)}]`);
      done++;
    } catch (e) { console.log(`❌ ${subject} / ${topic} — ${String(e.message).slice(0, 70)}`); failed++; }
  }
  console.log(`\n=== Grade ${grade} DONE: ${done} published${requalify ? ` (${requalFixed} requalified)` : ''}, ${skipped} kept, ${failed} failed · GLOBAL ₹${readSpend().toFixed(2)} ===`);
})();
