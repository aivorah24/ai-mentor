#!/usr/bin/env node
/**
 * Syllabus-extraction pipeline stage.
 *
 * Turns a stub chapter manifest ("Chapter 1", needsTitleReview) into a real
 * unit -> named-topic structure by reading the actual textbook PDFs, then
 * PUBLISHES it into the DB (syllabus_chapters / syllabus_topics + topic_resources)
 * via the same publishUnits() primitive the teacher upload flow uses.
 *
 * This is what makes a grade/subject render the rich "Full syllabus" screen
 * instead of the raw book-code fallback (aemr101, aemr102, ...).
 *
 * Usage:
 *   node scripts/extract-and-publish-syllabus.js --grade "Grade 1" --subject English --code aemr1 [--curriculum CBSE] [--dry]
 *
 * --dry writes the extracted units[] to stdout + a JSON file and skips publish.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const { publishUnits } = require('../services/curriculum/syllabusPublisher');

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const GRADE = argVal('--grade');
const SUBJECT = argVal('--subject');
const CODE = argVal('--code');
const CURRICULUM = argVal('--curriculum', 'CBSE');
const DRY = process.argv.includes('--dry');
if (!GRADE || !SUBJECT || !CODE) {
  console.error('Required: --grade "Grade N" --subject <Subject> --code <bookcode>');
  process.exit(1);
}

// ── Multi-account LLM (mirror of the generator's rotation) ──────────────────
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
function collectKeys(prefix) {
  const keys = [];
  if (process.env[prefix]) keys.push(process.env[prefix]);
  for (let i = 1; i <= 30; i++) if (process.env[`${prefix}_${i}`]) keys.push(process.env[`${prefix}_${i}`]);
  return [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
}
const GROQ_KEYS = collectKeys('GROQ_API_KEY');
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const LLM_ENDPOINTS = [];
for (const model of GROQ_MODELS) GROQ_KEYS.forEach((key, i) => LLM_ENDPOINTS.push({ model, key, keyIndex: i + 1 }));

async function callLLM(system, user) {
  if (!LLM_ENDPOINTS.length) throw new Error('No GROQ_API_KEY set');
  let lastErr;
  for (const ep of LLM_ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await fetch(GROQ_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.key}` },
          body: JSON.stringify({
            model: ep.model,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            temperature: 0.2,
            response_format: { type: 'json_object' },
          }),
        });
      } catch (e) { lastErr = e; break; }
      if (res.ok) {
        const data = await res.json();
        const c = data.choices?.[0]?.message?.content;
        try { return JSON.parse(c); } catch (_) {
          const m = c && c.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch (__) {} }
          lastErr = new Error('non-JSON'); break;
        }
      }
      const txt = await res.text();
      if (res.status === 429) {
        if (/per day|daily|quota/i.test(txt)) { console.log(`  acct ${ep.keyIndex} daily quota — rotating`); break; }
        const w = (txt.match(/try again in ([\d.]+)s/i)?.[1] || 6) * 1;
        console.log(`  rate limited, waiting ${w}s`); await new Promise((r) => setTimeout(r, w * 1000)); continue;
      }
      lastErr = new Error(`groq ${res.status}: ${txt.slice(0, 120)}`); break;
    }
  }
  throw lastErr || new Error('all LLM endpoints failed');
}

// ── Find the chapter PDFs for this book code ────────────────────────────────
function findChapterPdfs() {
  const root = path.join(__dirname, '..', 'data', 'ncert_books');
  const hits = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (new RegExp(`^${CODE}\\d\\d\\.pdf$`, 'i').test(e.name)) hits.push(p);
    }
  }
  walk(root);
  return hits.sort();
}

function cleanText(raw) {
  return raw
    .replace(/Reprint\s*20\d{2}-\d{2}/gi, ' ')
    .replace(/\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\s*\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*[AP]?M?/gi, ' ')
    .replace(/Chapter\s*\d+\.indd\s*\d+/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function extractOne(pdfPath, chapterNo) {
  const data = await pdf(fs.readFileSync(pdfPath));
  const firstPages = cleanText(data.text.split(/\f/).slice(0, 2).join(' ')).slice(0, 1800);
  const system = `You extract clean syllabus metadata from a raw ${CURRICULUM} ${GRADE} ${SUBJECT} textbook chapter. Return strict JSON only. Never invent — use only what the text shows. If the unit name is not present, set unit to null.`;
  const user = `Raw first-page text of one chapter (page furniture already partly stripped):
"""${firstPages}"""

Return JSON exactly:
{
  "unit": "the thematic unit/section name if the page shows one (e.g. 'My Family and Me'), else null",
  "title": "the real chapter/lesson title (e.g. 'Two Little Hands'), NOT 'Chapter ${chapterNo}'",
  "kind": "one of: Story, Poem, Song, Play, Lesson, Non-fiction, Activity — best fit"
}`;
  const out = await callLLM(system, user);
  // Maths/Science chapters are Lessons — the G1 Maths book uses playful chapter
  // names ("Mango Treat") that the model otherwise misreads as Story/Poem.
  const isNarrative = /english|hindi|literature/i.test(SUBJECT);
  const kind = isNarrative ? (out.kind && String(out.kind).trim()) || 'Lesson' : 'Lesson';
  return {
    chapter: chapterNo,
    pdfFile: path.basename(pdfPath),
    unit: (out.unit && String(out.unit).replace(/^unit\s*\d+\s*[:.\-]?\s*/i, '').trim()) || null,
    title: (out.title && String(out.title).trim()) || `Chapter ${chapterNo}`,
    kind,
  };
}

(async () => {
  const pdfs = findChapterPdfs();
  if (!pdfs.length) { console.error(`No chapter PDFs found for code ${CODE}`); process.exit(1); }
  console.log(`Found ${pdfs.length} chapter PDFs for ${CODE}. Extracting titles...`);

  const chapters = [];
  for (let i = 0; i < pdfs.length; i++) {
    try {
      const c = await extractOne(pdfs[i], i + 1);
      console.log(`  ch${c.chapter}: unit=${c.unit || '—'} | "${c.title}" (${c.kind})`);
      chapters.push(c);
    } catch (e) {
      console.log(`  ch${i + 1}: extraction failed (${e.message}) — keeping placeholder`);
      chapters.push({ chapter: i + 1, pdfFile: path.basename(pdfs[i]), unit: null, title: `Chapter ${i + 1}`, kind: 'Lesson' });
    }
  }

  // Two book shapes:
  //  • Theme-based (English readers): several chapters share a named unit
  //    ("Fables and Folk Tales" → 3 stories). Group topics under their unit.
  //  • Chapter-based (Maths, Science, most others): each chapter stands alone
  //    with no thematic unit. Make each chapter its own collapsible chapter with
  //    a single topic, matching how those textbooks are actually structured.
  const unitCoverage = chapters.filter((c) => c.unit).length / chapters.length;
  const themeBased = unitCoverage >= 0.4;

  const units = [];
  if (themeBased) {
    let cur = null;
    for (const c of chapters) {
      const unitName = c.unit || (cur ? cur.title : SUBJECT);
      if (!cur || cur.title !== unitName) {
        cur = { unitNo: units.length + 1, title: unitName, topics: [] };
        units.push(cur);
      }
      cur.topics.push({ name: c.title, kind: c.kind, page: null, match: c.title.toLowerCase() });
    }
  } else {
    for (const c of chapters) {
      units.push({ unitNo: c.chapter, title: c.title, topics: [{ name: c.title, kind: c.kind, page: null, match: c.title.toLowerCase() }] });
    }
  }

  const payload = { curriculum: CURRICULUM, grade: GRADE, subject: SUBJECT, code: CODE, units };
  const outFile = path.join(__dirname, '..', 'data', 'curricula', `cbse-${GRADE.toLowerCase().replace(/\s+/g, '')}-${SUBJECT.toLowerCase()}-${CODE}-extracted.json`);
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nExtracted ${units.length} units / ${chapters.length} topics -> ${path.basename(outFile)}`);

  if (DRY) { console.log('--dry: skipping publish.'); return; }

  console.log('Publishing to DB (syllabus_chapters / syllabus_topics)...');
  const { diff } = await publishUnits({ grade: GRADE, subject: SUBJECT, curriculum: CURRICULUM, units });
  console.log('Published. Diff vs previous:', JSON.stringify(diff));
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
