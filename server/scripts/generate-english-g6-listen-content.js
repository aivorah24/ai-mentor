/**
 * generate-english-g6-listen-content.js
 * Background content pipeline — NOT run through the chat model.
 *
 * For every CBSE Grade 6 English story/poem still missing "Listen tab"
 * enrichment in cbseG6EnglishSyllabus.ts, this:
 *   1. Extracts the REAL story text straight from the source NCERT PDF
 *      (server/data/ncert_books/grade6/english/fepr10X.pdf) — verbatim,
 *      no paraphrasing. This becomes each listenPart's `text`.
 *   2. Looks up the REAL page images already ingested to Cloudinary
 *      (server/data/ncert_image_jsonl/ncert_images_index.json) for the
 *      figure/illustration.
 *   3. Uses Groq (already configured for this app, cheap/fast) to generate
 *      ONLY the supplementary metadata around the real text: a short
 *      heading + "what is happening" summary per part, a comprehension
 *      MCQ for some parts, and a vocab list — same treatment Unit 1 got
 *      by hand, now automated.
 *
 * Output: server/data/generated/englishG6ListenContent.json
 * (a second, tiny manual/scripted merge step copies this into
 * AIMentorApp/src/data/cbseG6EnglishSyllabus.ts — kept separate so this
 * script can be re-run safely without touching the TS file directly.)
 *
 * Usage:
 *   cd server && node scripts/generate-english-g6-listen-content.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const BOOK_DIR = path.join(__dirname, '../data/ncert_books/grade6/english');
const IMAGE_MANIFEST = path.join(__dirname, '../data/ncert_image_jsonl/ncert_images_index.json');
const OUT_DIR = path.join(__dirname, '../data/generated');
const OUT_FILE = path.join(OUT_DIR, 'englishG6ListenContent.json');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Two separate quota pools on Groq — fall back to the smaller/faster model
// once the primary model's daily token budget (TPD) is exhausted, instead of
// blocking the whole pipeline on one model's quota.
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

// Only reprocess these topics (comma-separated names) — set when re-running
// after a partial failure, so already-successful topics aren't redone and
// don't burn more of the (shared, limited) daily quota.
const ONLY_TOPICS = (process.env.ONLY_TOPICS || '').split(',').map((s) => s.trim()).filter(Boolean);

// ── Unit → PDF → topics (in book order) — everything except Unit 1, which
// already has hand-verified content in cbseG6EnglishSyllabus.ts ─────────────
const UNITS = [
  {
    // "A Bottle of Dew" already has hand-curated content — kept in this list
    // (not reprocessed, see ONLY_TOPICS) only so its page range still anchors
    // where "The Raven and the Fox" starts.
    chapter: 1, pdfFile: 'fepr101.pdf',
    topics: [
      { name: 'A Bottle of Dew', match: 'a bottle of dew' },
      { name: 'The Raven and the Fox', match: 'the raven and the fox' },
      { name: 'Rama to the Rescue', match: 'rama to the rescue' },
    ],
  },
  {
    chapter: 2, pdfFile: 'fepr102.pdf',
    topics: [
      { name: 'The Unlikely Best Friends', match: 'unlikely' },
      { name: 'The Chair', match: 'the chair' },
    ],
  },
  {
    chapter: 3, pdfFile: 'fepr103.pdf',
    topics: [
      { name: 'Neem Baba', match: 'neem baba' },
      { name: 'What a Bird Thought', match: 'what a bird thought' },
      { name: 'Spices that Heal Us', match: 'spices that heal' },
    ],
  },
  {
    chapter: 4, pdfFile: 'fepr104.pdf',
    topics: [
      { name: 'Change of Heart', match: 'change of heart' },
      { name: 'The Winner', match: 'the winner' },
      { name: 'Yoga — A Way of Life', match: 'yoga' },
    ],
  },
  {
    chapter: 5, pdfFile: 'fepr105.pdf',
    topics: [
      { name: 'Kalakritiyon ka Bharat', match: 'kalakritiyon' },
      { name: 'The Kites', match: 'the kites' },
      { name: "Ila Sachani: Embroidering Dreams with her Feet", match: 'ila sachani' },
      { name: 'National War Memorial', match: 'national war memorial' },
    ],
  },
];

function normalize(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// pdf-parse sometimes inserts letter-spacing gaps ("W hat a B ird t hought",
// or even "l et us r ead") from kerning in the PDF — strip ALL whitespace
// before matching titles/markers so "what a bird thought" still finds
// "W hat a B ird t hought".
function squash(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Finds `needle` inside `text` tolerating extra whitespace/punctuation
// inserted between characters (the kerning-gap problem above), and returns
// the ORIGINAL string index where the match starts — unlike a plain
// squash-and-includes check, this lets callers slice the real text at the
// right point instead of just knowing a match exists somewhere.
function findFuzzyIndex(text, needle) {
  return findFuzzyRange(text, needle)?.start ?? -1;
}

// Same fuzzy match as findFuzzyIndex, but also returns where the match ENDS
// in the original string — needed to slice cleanly past a kerning-mangled
// marker phrase without guessing a fixed character offset.
function findFuzzyRange(text, needle) {
  const target = squash(needle);
  if (!target) return null;
  let ni = 0;
  let matchStart = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i].toLowerCase();
    if (!/[a-z0-9]/.test(ch)) continue; // skip spaces/punctuation, doesn't break a match
    if (ch === target[ni]) {
      if (ni === 0) matchStart = i;
      ni++;
      if (ni === target.length) return { start: matchStart, end: i + 1 };
    } else if (ch === target[0]) {
      matchStart = i;
      ni = 1;
    } else {
      ni = 0;
      matchStart = -1;
    }
  }
  return null;
}

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

// Strips repeating headers/footers/reprint stamps that aren't part of the story.
function cleanPageText(raw) {
  return raw
    .replace(/Unit\s*\d+\.indd\s*\d+/gi, ' ')
    // Print-run timestamps, both "09-12-24 3:50 PM" and "09-Dec-24 3:50:16 PM" styles.
    .replace(/\d{1,2}-(?:\d{2}|[A-Za-z]{3})-\d{2,4}\s*\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*[AP]M/gi, ' ')
    .replace(/Reprint\s*20\d{2}-\d{2}/gi, ' ')
    .replace(/Poorvi\s*[—\-]?\s*G\s*rade\s*6/gi, ' ')
    .replace(/\bp\s*oorvi\b/gi, ' ')
    // Stray running page numbers left isolated after other cleanup.
    .replace(/(?:^|\s)\d{1,3}(?=\s|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function findStartPage(pages, matchPhrase) {
  const needle = squash(matchPhrase);
  for (let i = 0; i < pages.length; i++) {
    if (squash(pages[i]).includes(needle)) return i; // 0-indexed
  }
  return -1;
}

// Groups raw page text into ~180-260 word chunks for listenParts, splitting
// on sentence boundaries so no sentence is cut mid-way.
function chunkIntoParts(fullText, targetWords = 130) {
  const sentences = fullText
    .replace(/([.!?])\s+/g, '$1|')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

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

// The book's own margin glossary ends up interleaved into the extracted text
// as runs of "word : short definition" pairs (that's literally how NCERT
// lays them out next to the paragraph). Pulling these directly is more
// grounded and complete than asking the LLM to guess useful words.
function extractRealGlossary(rawText) {
  // Two-pass: first find every "word :" marker position, then take each
  // definition as the text up to the NEXT marker — much more reliable than
  // a single regex when several glossary entries run together back-to-back.
  const markers = [];
  const markerRe = /\b([a-z]{3,16})\s*:\s*/g;
  let m;
  while ((m = markerRe.exec(rawText))) {
    markers.push({ word: m[1], start: m.index, defStart: m.index + m[0].length });
  }
  const out = [];
  for (let i = 0; i < markers.length; i++) {
    if (/^(let|note|column|row)$/i.test(markers[i].word)) continue;
    const defEnd = i + 1 < markers.length ? markers[i + 1].start : Math.min(rawText.length, markers[i].defStart + 200);
    let definition = rawText.slice(markers[i].defStart, defEnd).trim();
    const words = definition.split(/\s+/).filter(Boolean);
    if (words.length < 2) continue;
    if (words.length > 12) definition = words.slice(0, 12).join(' ');
    out.push({ word: markers[i].word, definition });
  }
  const seen = new Set();
  return out.filter((v) => {
    const k = v.word.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function callGroq(realTextParts, topicName, kind, hasFigure, realGlossary) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in server/.env');

  const numbered = realTextParts.map((t, i) => `PART ${i + 1}:\n${t}`).join('\n\n');
  const glossaryHint = realGlossary?.length
    ? `\n\nThe textbook's own margin glossary already defines these words from this chapter — you do NOT need to invent definitions for these, just prefer including them if relevant: ${realGlossary.map((g) => g.word).join(', ')}.`
    : '';
  const system = `You write supplementary metadata for a Grade 6 CBSE English "Listen along" reading feature. You are given the REAL, verbatim text of a story/poem, already split into parts. You must NEVER rewrite or paraphrase the given text — only produce metadata ABOUT it. Return strict JSON only, no markdown fences.`;
  const user = `Story/poem: "${topicName}" (${kind}), Grade 6 CBSE English.
${hasFigure ? 'This chapter has a real textbook illustration attached and shown alongside the text on screen.' : 'No illustration is available for this chapter.'}

Here are the real text parts:
${numbered}
${glossaryHint}

Return JSON exactly in this shape:
{
  "parts": [
    { "heading": "short 3-6 word heading for this part", "keyIdea": "one plain-English sentence a Grade 6 student can understand, summarising what happens in this part", "pauseThink": null OR { "question": "...", "options": ["...","...","..."], "correctIndex": 0 } }
  ],
  "vocab": [ { "word": "...", "definition": "one simple sentence, Grade 6 level" } ]
}

Rules:
- "parts" must have exactly ${realTextParts.length} entries, in order, one per PART above.
- Add a "pauseThink" comprehension question to roughly every other part (not every part, not zero) — 3 options, only one correct, options plausible but clearly distinguishable, correctIndex 0-based.
${hasFigure ? '- Exactly ONE part\'s keyIdea (whichever part best matches what the illustration shows) MUST explicitly mention the illustration/picture, e.g. "As shown in the picture, ...". Every other part\'s keyIdea should NOT mention it.' : ''}
- "vocab" should have 6-10 genuinely useful words FROM the given text (not generic words), Grade 6 appropriate. Prioritise real glossary words listed above if given.
- Do not include any text outside the JSON object.`;

  // Groq's free tier is rate-limited both per-minute AND per-day (tokens).
  // Per-minute limits are worth retrying with backoff; a per-day (TPD) limit
  // on one model won't clear during this run, so fall through to the next
  // model in GROQ_MODELS instead of retrying the same exhausted one.
  let lastErr;
  for (const model of GROQ_MODELS) {
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    });

    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
        body,
      });
      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '{}';
        return JSON.parse(content);
      }
      const errText = await res.text();
      if (res.status === 429) {
        const isDailyLimit = /tokens per day|requests per day/i.test(errText);
        if (isDailyLimit) {
          console.log(`  ... ${model} hit its daily quota — switching model`);
          lastErr = new Error(`Groq 429 (daily): ${errText.slice(0, 200)}`);
          break; // stop retrying this model, try the next one in GROQ_MODELS
        }
        const waitMatch = errText.match(/try again in ([\d.]+)s/i);
        const waitSec = waitMatch ? parseFloat(waitMatch[1]) + 1 : 15 * (attempt + 1);
        console.log(`  ... rate limited on ${model}, waiting ${waitSec.toFixed(1)}s (attempt ${attempt + 1}/4)`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        lastErr = new Error(`Groq 429: ${errText.slice(0, 200)}`);
        continue;
      }
      throw new Error(`Groq ${res.status}: ${errText.slice(0, 300)}`);
    }
  }
  throw lastErr;
}

function pickFigureForChapter(manifest, chapter, startPage, endPage) {
  const candidates = manifest.filter(
    (m) => m.subject === 'English' && m.grade === 6 && m.chapter === chapter &&
      m.page >= startPage && m.page <= endPage,
  );
  if (candidates.length === 0) return null;
  // Prefer the largest image (usually the main illustration, not a small icon).
  candidates.sort((a, b) => (b.width * b.height) - (a.width * a.height));
  return candidates[0].url;
}

async function processUnit(unit, manifest) {
  const pdfPath = path.join(BOOK_DIR, unit.pdfFile);
  console.log(`\n=== ${unit.pdfFile} (chapter ${unit.chapter}) ===`);
  const pages = await extractPages(pdfPath);

  // Resolve each topic's start page (0-indexed), end = next topic's start - 1.
  const resolved = unit.topics.map((t) => ({ ...t, startPage: findStartPage(pages, t.match) }));
  for (let i = 0; i < resolved.length; i++) {
    if (resolved[i].startPage === -1) {
      console.warn(`  ! Could not locate "${resolved[i].name}" in ${unit.pdfFile} — skipping`);
    }
  }

  const results = [];
  for (let i = 0; i < resolved.length; i++) {
    const t = resolved[i];
    if (t.startPage === -1) continue;
    const nextStart = i + 1 < resolved.length && resolved[i + 1].startPage !== -1
      ? resolved[i + 1].startPage
      : pages.length;
    const endPage = Math.max(t.startPage, nextStart - 1);

    // Still resolve every topic's page range above (later topics' ranges
    // depend on earlier ones), but skip the expensive Groq call for topics
    // not requested when re-running just a subset.
    if (ONLY_TOPICS.length > 0 && !ONLY_TOPICS.includes(t.name)) continue;

    let rawText = pages.slice(t.startPage, endPage + 1).map(cleanPageText).join(' ');
    // Each chapter opens with a large stylised title (which pdf-parse mangles
    // into letter-spaced garbage like "T he U nlikely B es T F riends") and a
    // "Let us do these activities before we read" pre-reading exercise —
    // neither belongs in the read-aloud narrative. The book itself marks
    // where the real story starts with a "Let us read" section header.
    const readMarker = findFuzzyRange(rawText, 'let us read');
    if (readMarker) {
      rawText = rawText.slice(readMarker.end).trim();
    } else {
      console.warn(`  ! No "Let us read" marker found for "${t.name}" — using full text (title may be garbled)`);
    }
    // The page range runs up to the NEXT story, which sweeps in every
    // grammar/workbook activity after this one too ("Let us learn", "Let us
    // write" fill-in-the-blanks, vocabulary tables, etc.) — none of that is
    // narrative. Cut at the first workbook-only section header; "Let us
    // discuss" is left alone since multi-part stories use it as a brief
    // in-story checkpoint, not an end marker.
    const WORKBOOK_MARKERS = ['let us think and reflect', 'let us learn', 'let us write', 'let us explore', 'let us listen', 'let us speak'];
    let cutAt = rawText.length;
    for (const marker of WORKBOOK_MARKERS) {
      const range = findFuzzyRange(rawText, marker);
      if (range && range.start < cutAt) cutAt = range.start;
    }
    rawText = rawText.slice(0, cutAt).trim();

    const textParts = chunkIntoParts(rawText);
    if (textParts.length === 0) {
      console.warn(`  ! No text extracted for "${t.name}" — skipping`);
      continue;
    }

    console.log(`  - ${t.name}: pages ${t.startPage + 1}-${endPage + 1} (1-indexed), ${textParts.length} parts`);

    const figureUrl = pickFigureForChapter(manifest, unit.chapter, t.startPage + 1, endPage + 1);
    const realGlossary = extractRealGlossary(rawText);

    let enrichment;
    try {
      enrichment = await callGroq(textParts, t.name, 'Story', !!figureUrl, realGlossary);
    } catch (err) {
      console.error(`  ! Groq enrichment failed for "${t.name}": ${err.message}`);
      continue;
    }

    const listenParts = textParts.map((text, idx) => ({
      heading: enrichment.parts?.[idx]?.heading || `Part ${idx + 1}`,
      text,
      keyIdea: enrichment.parts?.[idx]?.keyIdea || undefined,
      pauseThink: enrichment.parts?.[idx]?.pauseThink || undefined,
    }));

    results.push({
      name: t.name,
      pdfFile: unit.pdfFile,
      pdfPage: t.startPage + 1, // 1-indexed, matches how the app opens the PDF
      figureUrl: figureUrl || undefined,
      listenParts,
      vocab: enrichment.vocab || [],
    });
  }
  return results;
}

async function main() {
  if (!GROQ_API_KEY) {
    console.error('GROQ_API_KEY not set — check server/.env');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(IMAGE_MANIFEST, 'utf8'));

  const newResults = [];
  for (const unit of UNITS) {
    const results = await processUnit(unit, manifest);
    newResults.push(...results);
  }

  // Merge into any existing output (by topic name) rather than overwrite —
  // so re-running with ONLY_TOPICS for a couple of failed topics doesn't
  // discard everything that already succeeded.
  let existing = [];
  if (fs.existsSync(OUT_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')); } catch { existing = []; }
  }
  const byName = new Map(existing.map((t) => [t.name, t]));
  for (const t of newResults) byName.set(t.name, t);
  const merged = Array.from(byName.values());

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2));
  console.log(`\nWrote ${merged.length} topics total (${newResults.length} processed this run) → ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
