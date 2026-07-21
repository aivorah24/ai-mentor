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
const ONLY_CHAPTER = argVal('--only', null);

const IMAGE_MANIFEST = path.join(__dirname, '../data/ncert_image_jsonl/ncert_images_index.json');
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];

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
  return manifest
    .filter((m) => m.subject === IMAGE_SUBJECT && m.grade === 6 && m.chapter === chapter && m.page > 1)
    .filter((m) => m.width / m.height < 2)
    .sort((a, b) => b.width * b.height - a.width * a.height);
}

async function callGroq(system, user) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set');
  let lastErr;
  for (const model of GROQ_MODELS) {
    const body = JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
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
        return JSON.parse(data.choices?.[0]?.message?.content || '{}');
      }
      const errText = await res.text();
      if (res.status === 429) {
        if (/tokens per day|requests per day/i.test(errText)) {
          console.log(`  ... ${model} hit its daily quota — switching model`);
          lastErr = new Error('daily quota');
          break;
        }
        const waitMatch = errText.match(/try again in ([\d.]+)s/i);
        const waitSec = waitMatch ? parseFloat(waitMatch[1]) + 1 : 15 * (attempt + 1);
        console.log(`  ... rate limited on ${model}, waiting ${waitSec.toFixed(1)}s`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        lastErr = new Error('rate limited');
        continue;
      }
      throw new Error(`Groq ${res.status}: ${errText.slice(0, 300)}`);
    }
  }
  throw lastErr;
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

  return callGroq(system, user);
}

async function processChapter(ch, manifest) {
  console.log(`\n- ${ch.title} (${ch.pdfFile})`);
  const pages = await extractPages(path.join(BOOK_DIR, ch.pdfFile));
  const rawText = stripActivityCallouts(pages.map((p) => cleanPageText(p, ch.title)).join(' '));
  const textParts = chunkIntoParts(rawText);
  if (textParts.length === 0) { console.warn('  ! no text extracted'); return null; }

  const images = pickImagesForChapter(manifest, ch.chapter);
  const figureUrl = images[0]?.url;

  let intro, activity;
  const listenParts = [];
  const vocab = [];
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

  return {
    name: ch.title,
    kind: ch.kind,
    pdfFile: ch.pdfFile,
    pdfPage: 1,
    intro: intro || `Chapter ${ch.chapter}: ${ch.title}.`,
    figureUrl,
    figureCaption: ch.title,
    activity: activity || `What did you learn from "${ch.title}"?`,
    listenParts,
    vocab,
  };
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
          body: [ ${tsStringLiteral(c.intro)} ],
          ${c.figureUrl ? `figureUrl: ${tsStringLiteral(c.figureUrl)},\n          ` : ''}figureCaption: ${tsStringLiteral(c.figureCaption)},
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

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, fileSrc);
  console.log(`\nWrote ${results.length}/${manifest.chapters.length} chapters → ${OUT_FILE}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
