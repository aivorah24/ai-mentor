// lean-generate.cjs — ONE grounded Gemini call → a complete lesson JSON.
// Replaces the slow 8-agent free-model pipeline (35 min/topic) with a single
// fast Gemini 2.5 Flash generation (~seconds), grounded in real Qdrant chunks.
// Correctness is still verified by a Claude subagent afterward (₹0); Gemini just
// produces a strong, fast first draft. Token-budgeted to fit ~₹200 for G1-G6.
//
//   node scripts/lean-generate.cjs --grade 2 --subject Mathematics \
//        --topic "Subtraction with Borrowing" --out draft.json
require('dotenv').config();
const fs = require('fs');
const { embed } = require('../services/embeddings');
const { searchGrounding } = require('../services/qdrant');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();
const MODEL = 'gemini-2.5-flash';

const GRADE_AGE = { 1: '6', 2: '7', 3: '8', 4: '9', 5: '10', 6: '11', 7: '12', 8: '13', 9: '14', 10: '15', 11: '16', 12: '17' };

async function callGemini(system, user) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: system }] },
    contents: [{ parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.2,
      response_mime_type: 'application/json',
      maxOutputTokens: 8192,
      // Cut Gemini's "thinking" tokens — they eat maxOutputTokens (truncating the
      // JSON) and inflate cost. Off = faster + cheaper + full JSON.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (res.status === 429) { await new Promise(r => setTimeout(r, 12000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    const usage = data?.usageMetadata || {};
    try { return { lesson: JSON.parse(text), usage }; }
    catch { const m = text.match(/\{[\s\S]*\}/); if (m) return { lesson: JSON.parse(m[0]), usage }; throw new Error('gemini non-JSON'); }
  }
  throw new Error('gemini rate-limited out');
}

(async () => {
  if (!GEMINI_KEY || GEMINI_KEY.startsWith('your')) { console.error('No GEMINI_API_KEY'); process.exit(1); }
  const grade = arg('--grade'), subject = arg('--subject'), topic = arg('--topic');
  const out = arg('--out', 'lean_draft.json');
  const curriculum = arg('--curriculum', 'NCERT');
  if (!grade || !subject || !topic) { console.error('need --grade --subject --topic'); process.exit(1); }
  const age = GRADE_AGE[grade] || '10';

  // 1. Retrieve real grounding (trimmed for token budget).
  const vector = await embed(`${topic} ${subject} grade ${grade}`);
  const { chunks } = await searchGrounding({ vector, curriculum, grade, subject, limit: 6 });
  const evidence = (chunks || []).slice(0, 5)
    .map(c => (c.payload?.content || c.payload?.text || '').slice(0, 500))
    .filter(Boolean).join('\n---\n');
  if (!evidence) { console.error(`ABORT: no grounding for ${grade}/${subject}/${topic} — will not fabricate.`); process.exit(2); }

  const isMath = /math/i.test(subject);
  const system = `You are an expert NCERT Grade ${grade} ${subject} teacher creating one lesson for a ${age}-year-old child. Teach the way a real teacher teaches a child that age: simple words, short sentences, concrete steps. Ground EVERYTHING in the provided textbook evidence — never invent facts. Output ONLY valid JSON.`;

  const mathRules = isMath ? `
For maths: every worked example MUST use the correct STANDARD method (for subtraction: column borrowing — ones first, borrow 1 ten when the top digit is smaller). Compute and VERIFY every answer. Never write a wrong answer or a made-up method ("borrow from neighbour" is forbidden). Include at least 2-3 worked examples, at least one needing borrowing.` : '';

  const user = `Create a complete lesson on "${topic}" for NCERT Grade ${grade} ${subject}.

TEXTBOOK EVIDENCE (teach strictly from this):
"""
${evidence}
"""
${mathRules}

Return ONLY this JSON shape:
{
  "instructionalType": "Poem|Story|Concept|Mathematics|Experiment|Science|...",
  "intro": "1-2 warm sentences naming what the child will learn",
  "keyLearnings": ["3-4 concrete 'You will ...' objectives"],
  "originalLesson": ["for a Poem/Story ONLY: the source lines verbatim, in order; else omit"],
  "body": ["2-4 short teaching paragraphs, age-appropriate"],
  "workedExamples": [${isMath ? '{"problem":"e.g. 45 - 27 = ?","steps":["real column steps"],"answer":"18"}' : ''}],
  "vocab": [{"word":"...","definition":"kid-friendly meaning"}],
  "thinkAndReflect": ["1-3 open questions"],
  "keyTakeaways": ["2-4 real memorable points"],
  "quiz": [
    {"type":"mcq","question":"...","options":["...","...","...","..."],"correct":0,"hint":"...","explanation":"..."},
    {"type":"fill_blank","question":"... ___ ...","correct":"word","hint":"...","explanation":"..."}
  ]
}
The quiz must have at least 3 grounded questions with correct answers. Omit workedExamples if not a maths/numeric lesson.`;

  const { lesson, usage } = await callGemini(system, user);
  lesson.grade = Number(grade); lesson.subject = subject; lesson.topic = topic;
  fs.writeFileSync(out, JSON.stringify(lesson, null, 1));
  const toks = (usage.totalTokenCount || 0);
  console.log(`✅ ${grade}/${subject}/${topic} → ${out}  [${toks} tokens ≈ ₹${(toks / 1e6 * 80).toFixed(2)}]`);
  console.log(`   type:${lesson.instructionalType} | body:${(lesson.body||[]).length} | examples:${(lesson.workedExamples||[]).length} | quiz:${(lesson.quiz||[]).length}`);
})();
