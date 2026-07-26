/**
 * generate-chapter-subject-content.js
 * Generalized version of generate-english-g6-listen-content.js for subjects
 * where each PDF is already exactly one chapter (Science, Social Science) —
 * simpler than English since there's no multi-story-per-PDF boundary search.
 *
 * Real chapter text (verbatim) + real chapter images (Cloudinary) + Groq for
 * supplementary metadata (intro, listen-part headings/key-ideas/questions,
 * vocab, reflection activity) — same principle as the English pipeline.
 *
 * Usage:
 *   cd server && node scripts/generate-chapter-subject-content.js --manifest data/curricula/cbse-g6-science-chapters.json --out AIMentorApp/src/data/cbseG6ScienceSyllabus.ts --varname CBSE_G6_SCIENCE_SYLLABUS --bookdir data/ncert_books/grade6/science --imagesubject Science
 *   Add --only "Chapter Title" to redo a single chapter.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
}
const MANIFEST_FILE = path.resolve(__dirname, '..', argVal('--manifest'));
const OUT_FILE = path.resolve(__dirname, '..', '..', argVal('--out'));
const VAR_NAME = argVal('--varname');
const BOOK_DIR = path.resolve(__dirname, '..', argVal('--bookdir'));
const IMAGE_SUBJECT = argVal('--imagesubject');
const GRADE = parseInt(argVal('--grade', '6'), 10);
const CODE = argVal('--code', null); // book code (e.g. gegp1) — disambiguates multi-volume image matching
const ONLY_CHAPTER = argVal('--only', null);
// Lite mode: ONE LLM call per chapter (intro + simplified body + activity),
// Listen tab kept as raw un-enriched text chunks. ~8x fewer calls than full
// mode so free-tier quotas can cover all of G1-12 in a few daily passes.
const LITE = process.argv.includes('--lite');
const MAX_FIGURES = parseInt(argVal('--maxfigures', '6'), 10);
const MIN_FIGURE_AREA = 20000; // ~140x140px — smaller entries are icons/decorations, not real figures

const IMAGE_MANIFEST = path.join(__dirname, '../data/ncert_image_jsonl/ncert_images_index.json');
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

// Multiple free accounts per provider defeat the per-Gmail daily quota: paste
// each account's key as PREFIX_1, PREFIX_2, ... in .env (the plain unnumbered
// PREFIX is also accepted for backwards compatibility). We collect them all,
// dedupe, and rotate through them when one key hits its daily cap.
function collectKeys(prefix) {
  const keys = [];
  if (process.env[prefix]) keys.push(process.env[prefix]);
  for (let i = 1; i <= 30; i++) {
    const v = process.env[`${prefix}_${i}`];
    if (v) keys.push(v);
  }
  return [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
}

const GROQ_KEYS = collectKeys('GROQ_API_KEY');
const OPENROUTER_KEYS = collectKeys('OPENROUTER_API_KEY');
const NVIDIA_KEYS = collectKeys('NVIDIA_NIM_API_KEY');

// Models per provider, strongest → weakest.
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'deepseek-r1-distill-llama-70b',
  'qwen-2.5-32b',
  'gemma2-9b-it',
  'llama-3.1-8b-instant',
];
const OPENROUTER_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openai/gpt-oss-20b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'google/gemma-4-31b-it:free',
  // qwen3-30b-a3b, deepseek-r1, and llama-3.3-70b-instruct free tiers were
  // retired by OpenRouter (now 404) — replaced with the current free catalog.
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'nvidia/nemotron-nano-9b-v2:free',
];
// Verified live against https://integrate.api.nvidia.com/v1/models. The 49B
// Nemotron-Super responds fast and reliably; the 70B and 9B are backups.
const NVIDIA_MODELS = [
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'meta/llama-3.3-70b-instruct',
  'nvidia/nvidia-nemotron-nano-9b-v2',
];

// Build the fallback chain "rotate key, keep best model": for each model we
// try EVERY account key before dropping to a weaker model, so the strongest
// model is exhausted across all Gmail accounts first. Provider order keeps
// OpenRouter first (historically failed least), then Groq, then NVIDIA — both
// now driven by multiple free accounts per the founder's directive.
function buildEndpoints(provider, models, keys) {
  const eps = [];
  for (const model of models) {
    keys.forEach((key, i) => eps.push({ provider, model, key, keyIndex: i + 1 }));
  }
  return eps;
}

const LLM_ENDPOINTS = [
  ...buildEndpoints('openrouter', OPENROUTER_MODELS, OPENROUTER_KEYS),
  ...buildEndpoints('groq', GROQ_MODELS, GROQ_KEYS),
  ...buildEndpoints('nvidia', NVIDIA_MODELS, NVIDIA_KEYS),
];
 

async function extractPages(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  const pages = [];
  await pdf(buf, {
    pagerender: (pageData) =>
      pageData.getTextContent().then((tc) => {
        const text = tc.items.map((i) => i.str).join(' ');
        pages.push(text);
        return text;
      }),
  });
  return pages;
}

function cleanPageText(raw, bookTitleHint) {
  return raw
    .replace(/Chapter\s*\d+\.indd\s*\d+/gi, ' ')
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}\s*\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*[AP]M/gi, ' ')
    .replace(/\d{1,2}-(?:\d{2}|[A-Za-z]{3})-\d{2,4}\s*\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*[AP]M/gi, ' ')
    .replace(/Reprint\s*20\d{2}-\d{2}/gi, ' ')
    .replace(new RegExp(bookTitleHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
    .replace(/\bChapter\b/g, ' ')
    .replace(/(?:^|\s)\d{1,3}(?=\s|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Strips inline "Activity N.N: ..." instruction call-outs — these are
// workbook prompts, not narrative, similar to how the English pipeline
// excludes "Let us learn/write/explore" sections.
function stripActivityCallouts(text) {
  return text.replace(/Activity\s*\d+\.\d+\s*:[^?]{0,200}\?/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function chunkIntoParts(fullText, targetWords = 280) {
  const sentences = fullText.replace(/([.!?])\s+/g, '$1|').split('|').map((s) => s.trim()).filter(Boolean);
  const chunks = [];
  let cur = [];
  let curWords = 0;
  for (const sent of sentences) {
    const w = sent.split(/\s+/).length;
    if (curWords + w > targetWords && cur.length > 0) {
      chunks.push(cur.join(' '));
      cur = [];
      curWords = 0;
    }
    cur.push(sent);
    curWords += w;
  }
  if (cur.length) chunks.push(cur.join(' '));
  return chunks;
}

// Sorting purely by pixel area picks up page-1 decorative banners/textures
// (wide, low-height header graphics) ahead of actual content photos/diagrams
// — exclude page 1 (title page) and unusually wide-and-short images (aspect
// ratio > 2:1, typically a banner strip, not a real illustration).
function pickImagesForChapter(manifest, chapter) {
  const inChapter = manifest.filter(
    (m) => m.subject === IMAGE_SUBJECT && m.grade === GRADE && m.chapter === chapter && m.page > 1 &&
    // Multi-volume books (e.g. gegp1 + gegp2) reuse chapter numbers 1..N in each
    // volume; the image url/public_id embeds the book code, so require it to
    // match to avoid pulling volume-2 images into a volume-1 chapter.
    (!CODE || (m.url || m.public_id || '').includes(CODE))
  );
  const byArea = (a, b) => b.width * b.height - a.width * a.height;
  // Preferred: real content illustrations (exclude wide-and-short banner strips).
  const contentImgs = inChapter.filter((m) => m.width / m.height < 2).sort(byArea);
  if (contentImgs.length) return contentImgs;
  // Fallback: rather than render a blank placeholder box, accept the best
  // remaining figure for this chapter even if it's a wider graphic — a real
  // on-topic image beats an empty box. Only page-1 title banners stay excluded.
  return inChapter.sort(byArea);
}

// The Learn panel now shows a gallery of the chapter's real illustrations, not
// a single figure. Pick several genuine figures (skip tiny icons), spread them
// across different pages so they track the chapter's flow, and cap the count.
// Generic caption = the chapter title (no per-image captions in the index).
function pickFiguresForChapter(manifest, chapter, chapterTitle) {
  const ranked = pickImagesForChapter(manifest, chapter);
  const figures = [];
  const seenPages = new Set();
  for (const im of ranked) {
    if (im.width * im.height < MIN_FIGURE_AREA) continue; // skip icons/decorations
    if (seenPages.has(im.page)) continue;                 // one per page → spread across the chapter
    seenPages.add(im.page);
    figures.push({ url: im.url, caption: chapterTitle });
    if (figures.length >= MAX_FIGURES) break;
  }
  // If the size filter removed everything, still show the single best image
  // rather than a blank box.
  if (figures.length === 0 && ranked[0]) figures.push({ url: ranked[0].url, caption: chapterTitle });
  return figures;
}

// Provider-agnostic LLM call with an ordered fallback chain (see LLM_ENDPOINTS).
// Returns parsed JSON. On quota/unavailability, drops to the next endpoint; on
// short rate-limits, waits and retries the same one. Named callGroq-compatible
// (callLLM) so existing call sites just work.
async function callLLM(system, user) {
  if (LLM_ENDPOINTS.length === 0) throw new Error('No LLM API key set (OPENROUTER_API_KEY or GROQ_API_KEY)');
  let lastErr;
for (const ep of LLM_ENDPOINTS) {
    console.log(`\n=== Trying ${ep.provider} [acct ${ep.keyIndex}]: ${ep.model} ===`);

    const url = ep.provider === 'groq' ? GROQ_URL : ep.provider === 'nvidia' ? NVIDIA_URL : OPENROUTER_URL;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.key}` };
    if (ep.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://aivorah.app';
      headers['X-Title'] = 'Aivorah content pipeline';
    }
    const payload = {
      model: ep.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.4,
    };
    // NVIDIA NIM doesn't reliably support response_format — rely on JSON salvage.
    if (ep.provider !== 'nvidia') payload.response_format = { type: 'json_object' };
    if (ep.provider === 'nvidia') payload.max_tokens = 1200;
    const body = JSON.stringify(payload);
    // NVIDIA calls run ~70-120s under load; give generous headroom so a slow
    // response completes instead of aborting and wasting the whole call.
    const timeoutMs = ep.provider === 'nvidia' ? 220000 : 60000;
    for (let attempt = 0; attempt < 4; attempt++) {
      let res;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), timeoutMs);
        res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
        clearTimeout(to);
      } catch (e) {
        console.log(`  ... ${ep.model} network/timeout (${e.message}) — switching model`);
        lastErr = e;
        break;
      }
      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) { lastErr = new Error(`${ep.model} empty content`); break; }
        try {
          return JSON.parse(content);
        } catch (_) {
          const m = content.match(/\{[\s\S]*\}/);
          if (m) { try { return JSON.parse(m[0]); } catch (__) {} }
          console.log(`  ... ${ep.model} returned non-JSON — switching model`);
          lastErr = new Error(`${ep.model} non-JSON`);
          break;
        }
      }
      const errText = await res.text();
      if (res.status === 429) {
        if (/per day|daily|quota|free-models-per-day/i.test(errText)) {
          console.log(`  ... ${ep.model} hit its daily quota — switching model`);
          lastErr = new Error('daily quota');
          break;
        }
        const waitMatch = errText.match(/try again in ([\d.]+)s/i);
        const waitSec = waitMatch ? parseFloat(waitMatch[1]) + 1 : 8 * (attempt + 1);
        console.log(`  ... rate limited on ${ep.model}, waiting ${waitSec.toFixed(1)}s`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        lastErr = new Error('rate limited');
        continue;
      }
      if ([404, 500, 502, 503, 504].includes(res.status)) {
        console.log(`  ... ${ep.model} unavailable (${res.status}) — switching model`);
        lastErr = new Error(`${ep.model} ${res.status}`);
        break;
      }
      lastErr = new Error(`${ep.provider} ${res.status}: ${errText.slice(0, 200)}`);
      break;
    }
  }
  throw lastErr || new Error('all LLM endpoints failed');
}

function tsStringLiteral(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// Groq's fallback model has only a 6000 token-per-minute budget — longer
// chapters (Science/Social Science run 6-10 pages) exceed that in a single
// request (413 "too large"). Batch a few parts per call instead of sending
// the whole chapter at once.
const PARTS_PER_BATCH = 4;

async function enrichBatch(ch, batchParts, batchStartIdx, figureUrl, wantIntroActivity) {
  const numbered = batchParts.map((t, i) => `PART ${batchStartIdx + i + 1}:\n${t}`).join('\n\n');
  const system = `You write supplementary metadata for a Grade 6 CBSE ${IMAGE_SUBJECT} "Learn + Listen along" feature. You are given REAL, verbatim textbook text, already split into parts. NEVER rewrite/paraphrase the given text — only produce metadata ABOUT it. Return strict JSON only.`;
  const user = `Chapter: "${ch.title}", Grade 6 CBSE ${IMAGE_SUBJECT}.
${figureUrl ? 'This chapter has a real textbook illustration attached and shown alongside the text.' : 'No illustration available.'}

Real text parts (this is a batch from a longer chapter — only enrich these):
${numbered}

Return JSON exactly:
{
  ${wantIntroActivity ? '"intro": "one sentence overview of what this chapter teaches",\n  "activity": "one short reflection/try-it-yourself question grounded in this chapter\'s content",\n  ' : ''}"parts": [
    { "heading": "short 3-6 word heading", "keyIdea": "one plain-English sentence summarising this part for a Grade 6 student", "pauseThink": null OR { "question": "...", "options": ["...","...","..."], "correctIndex": 0 } }
  ],
  "vocab": [ { "word": "...", "definition": "one simple sentence, Grade 6 level" } ]
}

Rules:
- "parts" must have exactly ${batchParts.length} entries, in order, one per PART above.
- Add "pauseThink" to roughly every other part, not all, not none.
${figureUrl ? '- If any part in this batch matches the illustration, its keyIdea should explicitly reference it (e.g. "As shown in the picture...").' : ''}
- "vocab": 2-4 genuinely useful terms FROM this batch's text.
- Do not include text outside the JSON object.`;

  return callLLM(system, user);
}

// The "Learn with Aivorah — simplified" panel needs genuinely simplified prose,
// NOT the verbatim textbook text (that lives in the Listen tab as listenParts).
// We synthesise 3-4 short Grade-6 paragraphs from the per-part keyIdeas, which
// are concise enough to stay well within the fallback model's token budget.
async function generateSimplifiedBody(ch, listenParts) {
  const ideas = listenParts
    .map((p, i) => `${i + 1}. ${p.keyIdea || p.heading}`)
    .filter(Boolean)
    .join('\n');
  const system = `You write simplified, friendly explanations for a Grade 6 CBSE ${IMAGE_SUBJECT} lesson. Return strict JSON only.`;
  const user = `Chapter: "${ch.title}", Grade 6 CBSE ${IMAGE_SUBJECT}.
Here are the key ideas of the chapter, in order:
${ideas}

Write a simplified retelling for a 11-year-old student who is reading this for the first time.
Return JSON exactly: { "body": ["paragraph 1", "paragraph 2", "paragraph 3"] }

Rules:
- 3 to 4 short paragraphs, each 2-4 sentences, in simple, warm, plain English.
- Cover the chapter's main ideas in a natural flow — do NOT just restate the list.
- No headings, no bullet points, no markdown. Plain sentences only.
- Do not include text outside the JSON object.`;
  const out = await callLLM(system, user);
  const body = Array.isArray(out.body) ? out.body.filter((p) => typeof p === 'string' && p.trim()) : [];
  return body;
}

// Lite mode: produce intro + simplified body + activity in a SINGLE call from
// the raw chapter text (truncated to stay within smaller free models' context).
// No per-part enrichment — that's what makes it ~8x cheaper.
async function generateLiteContent(ch, rawText) {
  const text = rawText.slice(0, 12000);
  const system = `You write simplified, friendly Grade ${GRADE} CBSE ${IMAGE_SUBJECT} lesson content. Return strict JSON only.`;
  const user = `Chapter: "${ch.title}", Grade ${GRADE} CBSE ${IMAGE_SUBJECT}.
Here is the real textbook chapter text (may be truncated):
"""${text}"""

Return JSON exactly:
{ "intro": "one sentence overview of what this chapter teaches",
  "body": ["paragraph 1", "paragraph 2", "paragraph 3"],
  "activity": "one short reflection/try-it-yourself question grounded in this chapter" }

Rules:
- "body": 3-4 short paragraphs, each 2-4 sentences, simple warm plain English for an 11-year-old, covering the chapter's main ideas in a natural flow.
${IMAGE_SUBJECT.toLowerCase().includes('math') ? '- This is Maths: explain concepts in plain words with tiny worked examples; do NOT dump raw symbols/equations.\n' : ''}- No headings, no bullet points, no markdown.
- Do not include text outside the JSON object.`;
  const out = await callLLM(system, user);
  return {
    intro: typeof out.intro === 'string' ? out.intro.trim() : '',
    body: Array.isArray(out.body) ? out.body.filter((p) => typeof p === 'string' && p.trim()) : [],
    activity: typeof out.activity === 'string' ? out.activity.trim() : '',
  };
}

// Pre-publish validation gate: a chapter must have a real multi-paragraph
// simplified body and a real figure before it's allowed into the syllabus.
// Returns { ok, reasons[] } so the caller can retry then flag needs_review.
const MIN_BODY_CHARS = 200;
const MIN_BODY_PARAS = 2;
function validateChapter(c) {
  const reasons = [];
  const bodyText = (c.body || []).join(' ').trim();
  if ((c.body || []).length < MIN_BODY_PARAS) reasons.push(`body has <${MIN_BODY_PARAS} paragraphs`);
  if (bodyText.length < MIN_BODY_CHARS) reasons.push(`body too short (${bodyText.length}<${MIN_BODY_CHARS} chars)`);
  if (bodyText && c.intro && bodyText === c.intro.trim()) reasons.push('body duplicates intro');
  if (!c.figureUrl) reasons.push('no figure image');
  if (!c.listenParts || c.listenParts.length === 0) reasons.push('no listen parts');
  return { ok: reasons.length === 0, reasons };
}

async function processChapter(ch, manifest) {
  console.log(`\n- ${ch.title} (${ch.pdfFile})`);
  const pages = await extractPages(path.join(BOOK_DIR, ch.pdfFile));
  const rawText = stripActivityCallouts(pages.map((p) => cleanPageText(p, ch.title)).join(' '));
  const textParts = chunkIntoParts(rawText);
  if (textParts.length === 0) { console.warn('  ! no text extracted'); return null; }

  const figures = pickFiguresForChapter(manifest, ch.chapter, ch.title);
  const figureUrl = figures[0]?.url; // first image kept for back-compat / validation
  console.log(`  ... ${figures.length} figure(s) selected`);

  let intro, activity;
  const listenParts = [];
  const vocab = [];
  let body = [];

  if (LITE) {
    // One call: intro + simplified body + activity. Listen tab keeps the real
    // text as un-enriched chunks so it's still usable (backfill enrichment later).
    textParts.forEach((text, i) => listenParts.push({ heading: `Part ${i + 1}`, text }));
    for (let attempt = 0; attempt < 3 && body.length < MIN_BODY_PARAS; attempt++) {
      if (attempt > 0) console.log(`  ... lite retry ${attempt}`);
      try {
        const lite = await generateLiteContent(ch, rawText);
        intro = lite.intro || intro;
        activity = lite.activity || activity;
        body = lite.body;
      } catch (err) {
        console.error(`  ! lite attempt ${attempt + 1} failed: ${err.message}`);
      }
    }
  } else {
    for (let i = 0; i < textParts.length; i += PARTS_PER_BATCH) {
      const batch = textParts.slice(i, i + PARTS_PER_BATCH);
      console.log(`  ... enriching parts ${i + 1}-${i + batch.length}/${textParts.length}`);
      let enrichment;
      try {
        enrichment = await enrichBatch(ch, batch, i, figureUrl, i === 0);
      } catch (err) {
        console.error(`  ! batch ${i + 1}-${i + batch.length} failed: ${err.message}`);
        batch.forEach((text, bi) => listenParts.push({ heading: `Part ${i + bi + 1}`, text }));
        continue;
      }
      if (i === 0) { intro = enrichment.intro; activity = enrichment.activity; }
      batch.forEach((text, bi) => {
        listenParts.push({
          heading: enrichment.parts?.[bi]?.heading || `Part ${i + bi + 1}`,
          text,
          keyIdea: enrichment.parts?.[bi]?.keyIdea,
          pauseThink: enrichment.parts?.[bi]?.pauseThink,
        });
      });
      if (enrichment.vocab) vocab.push(...enrichment.vocab);
    }

    // Real simplified body for the Learn panel — retry a couple of times before
    // giving up, since a thin body is the exact bug we're fixing.
    for (let attempt = 0; attempt < 3 && body.length < MIN_BODY_PARAS; attempt++) {
      if (attempt > 0) console.log(`  ... simplified-body retry ${attempt}`);
      try {
        body = await generateSimplifiedBody(ch, listenParts);
      } catch (err) {
        console.error(`  ! simplified-body attempt ${attempt + 1} failed: ${err.message}`);
      }
    }
  }

  const chapter = {
    name: ch.title,
    kind: ch.kind,
    pdfFile: ch.pdfFile,
    pdfPage: 1,
    intro: intro || `Chapter ${ch.chapter}: ${ch.title}.`,
    body,
    figures,
    figureUrl,
    figureCaption: ch.title,
    activity: activity || `What did you learn from "${ch.title}"?`,
    listenParts,
    vocab,
  };

  const check = validateChapter(chapter);
  chapter.needsReview = !check.ok;
  if (!check.ok) console.warn(`  ⚠ NEEDS REVIEW "${ch.title}": ${check.reasons.join('; ')}`);
  return chapter;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  const imageManifest = JSON.parse(fs.readFileSync(IMAGE_MANIFEST, 'utf8'));

  const results = [];
  for (const ch of manifest.chapters) {
    if (ONLY_CHAPTER && ch.title !== ONLY_CHAPTER) continue;
    try {
      const r = await processChapter(ch, imageManifest);
      if (r) results.push(r);
    } catch (err) {
      console.error(`  ! FAILED "${ch.title}": ${err.message}`);
    }
  }

  // Each chapter becomes its own unit with one topic (matches the
  // SyllabusChapter shape English uses — unit title == chapter title here
  // since these books don't group multiple chapters under a named unit).
  const units = results.map((r) => ({
    title: r.name,
    topics: [r],
  }));

  const lp = (parts) => parts.map((p) => {
    const pieces = [`heading: ${tsStringLiteral(p.heading)}`, `text: ${tsStringLiteral(p.text)}`];
    if (p.keyIdea) pieces.push(`keyIdea: ${tsStringLiteral(p.keyIdea)}`);
    if (p.pauseThink) {
      pieces.push(`pauseThink: { question: ${tsStringLiteral(p.pauseThink.question)}, options: [${p.pauseThink.options.map(tsStringLiteral).join(', ')}], correctIndex: ${p.pauseThink.correctIndex} }`);
    }
    return `            {\n              ${pieces.join(',\n              ')},\n            }`;
  }).join(',\n');
  const voc = (vocab) => vocab.map((v) => `            { word: ${tsStringLiteral(v.word)}, definition: ${tsStringLiteral(v.definition)} }`).join(',\n');

  const unitsSrc = units.map((u) => {
    const c = u.topics[0];
    return `  {
    title: ${tsStringLiteral(u.title)},
    topics: [
      {
        name: ${tsStringLiteral(c.name)}, kind: ${tsStringLiteral(c.kind)}, page: 'p.1', pdfFile: ${tsStringLiteral(c.pdfFile)}, pdfPage: ${c.pdfPage},
        readText: {
          intro: ${tsStringLiteral(c.intro)},
          body: [
${(c.body && c.body.length ? c.body : [c.intro]).map((p) => `            ${tsStringLiteral(p)}`).join(',\n')},
          ],
          ${c.figureUrl ? `figureUrl: ${tsStringLiteral(c.figureUrl)},\n          ` : ''}figureCaption: ${tsStringLiteral(c.figureCaption)},
          figures: [
${(c.figures || []).map((f) => `            { url: ${tsStringLiteral(f.url)}, caption: ${tsStringLiteral(f.caption)} }`).join(',\n')},
          ],
          activity: ${tsStringLiteral(c.activity)},
          listenParts: [
${lp(c.listenParts)},
          ],
          vocab: [
${voc(c.vocab)},
          ],
        },
      },
    ],
  },`;
  }).join('\n');

  const fileSrc = `/**
 * Auto-generated by generate-chapter-subject-content.js — real NCERT text +
 * real Cloudinary images + Groq-generated supplementary metadata (headings,
 * key ideas, comprehension questions, vocab). Same structure as
 * cbseG6EnglishSyllabus.ts. Safe to re-run the generator; it overwrites
 * this whole file (or use --only "Chapter Title" + manual merge for one chapter).
 */
import type { SyllabusChapter } from './cbseG6EnglishSyllabus';

export const ${VAR_NAME}: SyllabusChapter[] = [
${unitsSrc}
];
`;

  // Quota guard: if NO chapter produced a real body (all LLM calls failed,
  // almost always daily-quota exhaustion), do NOT overwrite with empty content.
  // Exit non-zero so the orchestrator marks this book for retry on the next
  // pass (when quotas reset) instead of recording it as done.
  const realBodies = results.filter((r) => (r.body || []).join(' ').trim().length >= MIN_BODY_CHARS).length;
  if (results.length > 0 && realBodies === 0) {
    console.error(`\n! ${VAR_NAME}: 0/${results.length} chapters got real content (quota exhausted) — NOT writing, will retry.`);
    process.exit(3);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, fileSrc);
  console.log(`\nWrote ${results.length}/${manifest.chapters.length} chapters → ${OUT_FILE}`);

  const flagged = results.filter((r) => r.needsReview);
  if (flagged.length) {
    console.log(`\n⚠ ${flagged.length} chapter(s) flagged NEEDS REVIEW (published with best-effort content):`);
    flagged.forEach((r) => console.log(`   - ${r.name}`));
  } else {
    console.log('\n✓ All chapters passed the pre-publish validation gate.');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
