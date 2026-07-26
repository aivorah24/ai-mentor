/**
 * derive-topics.cjs — recover real lesson topics for chapters that were ingested
 * WITHOUT a chapter title.
 *
 * Some books ingested with `payload.topic` set to the book's file code
 * ("legy303", "lepy101") instead of a chapter title. `worklist()` in pipeline.cjs
 * skips those (isCodeStub), so those subjects can never generate a lesson even
 * though their text is fully ingested and rich. That single gap is what makes
 * G11/G12 Geography, Sociology and Psychology, G9 Social Science, G5 EVS and
 * every language look "missing".
 *
 * This reads each code-stub chapter's own text and asks the model to name the
 * chapter and list the topics it actually teaches — grounded in that text, never
 * invented — then writes them to data/derived-topics.json. pipeline.cjs merges
 * that file into its worklist, so the normal generate → validate → repair →
 * publish loop then applies unchanged.
 *
 *   node scripts/derive-topics.cjs --grade 12 --subject Geography
 *   node scripts/derive-topics.cjs --grade 12 --subject Geography,Sociology --per-chapter 6
 *   node scripts/derive-topics.cjs --grade 9 --subject "Social Science" --dry
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const GRADE = arg('--grade');
const SUBJECTS = (arg('--subject', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const PER_CHAPTER = +arg('--per-chapter', 6);
const DRY = process.argv.includes('--dry');
const OUT = path.resolve(__dirname, '..', 'data', 'derived-topics.json');

const GROQ_KEYS = (() => {
  const k = [];
  if (process.env.GROQ_API_KEY) k.push(process.env.GROQ_API_KEY);
  for (let i = 1; i <= 10; i++) if (process.env[`GROQ_API_KEY_${i}`]) k.push(process.env[`GROQ_API_KEY_${i}`]);
  return [...new Set(k.map(x => x.trim()).filter(Boolean))];
})();
const MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3.6-27b'];
let keyIdx = 0;

async function callLLM(system, user) {
  for (const model of MODELS) {
    for (let hop = 0; hop < Math.max(1, GROQ_KEYS.length); hop++) {
      const key = GROQ_KEYS[keyIdx % GROQ_KEYS.length]; keyIdx++;
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model, temperature: 0.1, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          }),
          signal: AbortSignal.timeout(90000),
        });
        if (res.status === 429 || !res.ok) continue;
        const d = await res.json();
        const t = d?.choices?.[0]?.message?.content || '';
        try { return JSON.parse(t); } catch { const m = t.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} } }
      } catch { /* try next key/model */ }
    }
  }
  return null;
}

const isStub = (t) => /^[a-z]{3,5}\d{2,4}$/i.test(String(t || '').trim());

(async () => {
  if (!GRADE || !SUBJECTS.length) { console.error('usage: --grade N --subject "A,B"'); process.exit(1); }
  const q = require('../services/qdrant');
  const store = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return {}; } })();

  for (const subject of SUBJECTS) {
    // Gather every chunk for this grade+subject, grouped by chapter code.
    const byCode = {};
    let next = null;
    for (let i = 0; i < 60; i++) {
      const r = await q.client.scroll(q.COLLECTION, {
        limit: 250, offset: next, with_payload: true, with_vector: false,
        filter: { must: [{ key: 'grade', match: { value: Number(GRADE) } }, { key: 'subject', match: { value: subject } }] },
      });
      for (const p of r.points || []) {
        const pl = p.payload || {};
        const code = String(pl.topic || '').trim();
        if (!isStub(code)) continue;                       // already has a real title
        const text = ((pl.content || '') + (pl.text || '')).trim();
        if (text.length < 200) continue;
        (byCode[code] = byCode[code] || []).push(text);
      }
      next = r.next_page_offset; if (!next) break;
    }

    const codes = Object.keys(byCode).sort();
    console.log(`\nG${GRADE} ${subject}: ${codes.length} code-stub chapter(s)`);
    if (!codes.length) continue;

    const out = [];
    for (const code of codes) {
      // Three chunks is enough to identify a chapter without a large prompt.
      const sample = byCode[code].slice(0, 3).map(t => t.slice(0, 1200)).join('\n---\n');
      const system = 'You identify NCERT textbook chapters from their text. Use ONLY the text given. '
        + 'Never invent a topic the text does not cover. Output ONLY valid JSON.';
      const user = `This is text from one chapter of an NCERT Grade ${GRADE} ${subject} textbook.\n\n"""\n${sample}\n"""\n\n`
        + `Return JSON: {"chapterTitle":"the chapter's actual title","topics":["...","..."]}\n`
        + `List up to ${PER_CHAPTER} specific teaching topics this chapter covers. Each topic must be a short `
        + `noun phrase a teacher would put on a lesson plan (3-8 words), not a sentence, not a question, and `
        + `not a file code. Only include topics clearly present in the text.`;
      const r = await callLLM(system, user);
      const title = String(r?.chapterTitle || '').trim();
      const topics = (Array.isArray(r?.topics) ? r.topics : [])
        .map(t => String(t || '').trim())
        .filter(t => t.length >= 3 && t.length <= 80 && !isStub(t) && !/^(this|the)\s+(image|picture)/i.test(t));
      if (!topics.length) { console.log(`  ${code}: could not derive (skipped)`); continue; }
      topics.forEach(t => out.push({ topic: t, code, chapterTitle: title || undefined }));
      console.log(`  ${code} → "${title || '(untitled)'}" · ${topics.length} topic(s)`);
    }

    // De-duplicate topic names within the subject: two chapters can legitimately
    // touch the same idea, but two lessons with the same name cannot coexist.
    const seen = new Set();
    const unique = out.filter(o => { const k = o.topic.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    store[`${GRADE}|${subject}`] = unique;
    console.log(`  → ${unique.length} unique topic(s) for G${GRADE} ${subject}`);
  }

  if (DRY) return console.log('\n--dry: nothing written.');
  fs.writeFileSync(OUT, JSON.stringify(store, null, 1));
  console.log(`\nWrote ${OUT}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
