/**
 * Module 1 — retrievalAgent
 * Single responsibility: pull ONLY the relevant NCERT chunks for a topic from
 * Qdrant (collection aivorah_curriculum_chunks_v1). Never invents textbook
 * content. Grade-1..5 chunks store text on payload.content; newer passes on
 * payload.text — read whichever is present (the "aemr" hallucination bug).
 *
 * Strategy: scroll the grade+subject corpus, then keep only chunks whose text
 * actually mentions the topic title (exact phrase or distinctive tokens). Falls
 * back to the whole grade+subject corpus if the title match is too thin, so we
 * still ground on real book text rather than returning nothing.
 */
const { client, COLLECTION } = require('../qdrant');
const { cleanForCorpus } = require('./textCleaner');

// Scroll the ENTIRE grade+subject corpus (no early char cap — the per-subject
// G1 corpus is a couple dozen codes, and stopping early is exactly what caused
// whole chapters like "Mango Treat" (code aejm103) to never load).
async function scrollAll(must) {
  const chunks = [];
  let offset = null;
  do {
    const r = await client.scroll(COLLECTION, {
      filter: { must }, limit: 50, offset: offset ?? undefined, with_payload: true, with_vector: false,
    });
    for (const pt of r.points) {
      const t = pt?.payload?.text || pt?.payload?.content || '';
      if (t) chunks.push({ text: t, code: pt?.payload?.topic || '' });
    }
    offset = r.next_page_offset ?? null;
  } while (offset !== null);
  return chunks;
}

function normalize(s) {
  return String(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Ground on the SINGLE best-matching chapter, not a concatenation of every
 * token-matched chunk across the grade. We group chunks by their book code
 * (payload.topic, e.g. aejm103), score each code by title phrase + token
 * frequency, and return ONLY the winning code's chunks. This keeps the
 * understanding/generation/validation agents looking at one coherent chapter.
 *
 * @param {{ title:string, subject:string, grade?:number, maxChars?:number }} args
 * @returns {Promise<{ rawText:string, cleanText:string, sourceCode:string, chunkCount:number, matched:boolean, score:number }>}
 */
async function retrieve({ title, subject, grade = 1, maxChars = 6000 }) {
  const all = await scrollAll([{ key: 'grade', match: { value: grade } }, { key: 'subject', match: { value: subject } }]);

  // Group by code.
  const byCode = {};
  for (const c of all) { const k = c.code || '_none'; (byCode[k] = byCode[k] || []).push(c.text); }

  const t = normalize(title);
  const tokens = t.split(/\s+/).filter((w) => w.length > 3);
  const shortTokens = t.split(/\s+/).filter((w) => w.length >= 3); // catch "cap", "two"

  let best = '', bestScore = -1;
  for (const [code, arr] of Object.entries(byCode)) {
    const full = normalize(arr.join(' '));
    const phrase = (full.split(t).length - 1) * 200;               // exact title phrase = strong signal
    const tok = tokens.reduce((a, w) => a + (full.split(w).length - 1), 0);
    const shortTok = shortTokens.reduce((a, w) => a + (full.split(w).length - 1), 0) * 0.5;
    const score = phrase + tok + shortTok;
    if (score > bestScore) { bestScore = score; best = code; }
  }

  const matched = bestScore > 0 && best && best !== '_none';
  const used = matched ? byCode[best] : all.map((c) => c.text);
  const rawText = used.join('\n\n').slice(0, maxChars);
  const cleanText = cleanForCorpus(rawText);

  return {
    rawText, cleanText,
    sourceCode: matched ? best : '',
    chunkCount: used.length,
    matched,
    score: bestScore,
  };
}

module.exports = { retrieve };
