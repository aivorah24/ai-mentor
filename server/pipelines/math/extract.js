/**
 * Stage 1 — Content Extraction (curriculum/grade/subject/chapter-agnostic).
 *
 * Reads one NCERT chapter PDF and pulls out: chapter title, concept
 * narrative, formulas, and any "Q/Ans" exercise pairs already present in the
 * source text (some Ganita Prakash PDFs already carry inline answers under
 * "Figure it out" sections; older-style books use "Exercise N.N" headers
 * instead — this handles both without caring which grade/chapter it is).
 *
 * No grade/subject/chapter-specific logic lives here — everything chapter-
 * specific comes in via the `meta` argument or is discovered generically from
 * the PDF's own text structure.
 */
const fs   = require('fs');
const path = require('path');
const pdf  = require('pdf-parse');

const BOOKS_ROOT = path.join(__dirname, '../../data/ncert_books');

function subjectFolder(subject) {
  return String(subject || '').toLowerCase().trim().replace(/\s+/g, '_');
}

function resolvePdfPath({ grade, subject, chapterCode }) {
  const gradeNum = (String(grade).match(/\d+/) || [''])[0];
  return path.join(BOOKS_ROOT, `grade${gradeNum}`, subjectFolder(subject), `${chapterCode}.pdf`);
}

// Splits the chapter body from its exercise sections. Tries both the newer
// "Figure it out" heading (Ganita Prakash) and the older "Exercise N.N" style.
function splitConceptAndExercises(text) {
  const headingRe = /(Figure it out|Exercise\s+\d+(?:\.\d+)?)/gi;
  const matches = [...text.matchAll(headingRe)];
  if (!matches.length) return { conceptText: text.trim(), exerciseBlocks: [] };

  const conceptText = text.slice(0, matches[0].index).trim();
  const exerciseBlocks = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    exerciseBlocks.push(text.slice(start, end));
  }
  return { conceptText, exerciseBlocks };
}

// Splits one exercise block into individual Q/Ans pairs. Tolerant of the
// PDF's inconsistent numbering ("Q1.", "Q.", "Q2.") and of chapters where no
// inline answer exists (officialAnswer stays null in that case).
// Some NCERT PDFs draw stacked numerator/denominator digits using a private
// font trick that extracts as Hangul Jamo Extended-B codepoints (U+D7B0-
// U+D7FF) instead of real digits — not real content, just OCR noise from the
// font. Stripping them leaves gaps in the sentence (LLM step-generation
// reconstructs the actual values from context; see generate.js's cleanProblem).
function stripFontArtifacts(text) {
  return text.replace(/[\u{D7B0}-\u{D7FF}]/gu, '').replace(/[ \t]{2,}/g, ' ');
}

function extractQaPairs(block) {
  const qaRe = /Q\.?\d*\.\s*([\s\S]*?)(?:Ans\.\s*([\s\S]*?))?(?=Q\.?\d*\.\s|$)/g;
  const pairs = [];
  let m;
  while ((m = qaRe.exec(block)) !== null) {
    const problemText = stripFontArtifacts((m[1] || '').trim());
    const officialAnswer = (m[2] || '').trim() || null;
    if (problemText.length > 5) pairs.push({ problemText, officialAnswer });
  }
  return pairs;
}

// Very loose formula spotter — looks for short lines with math operators
// and no more than ~12 words, from the concept text only (worked examples
// and exercises are handled separately). Good enough as a heuristic seed
// for the LLM stage, which does the real structuring.
function spotFormulas(conceptText) {
  return conceptText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && l.length < 80 && /[=×÷+\-/]/.test(l) && l.split(/\s+/).length <= 12)
    .slice(0, 10);
}

async function extractChapter({ curriculum, grade, subject, chapterCode }) {
  const pdfPath = resolvePdfPath({ grade, subject, chapterCode });
  const buf = fs.readFileSync(pdfPath);
  const data = await pdf(buf);
  const text = data.text || '';

  const firstLine = text.split('\n').map(s => s.trim()).find(Boolean) || chapterCode;
  const { conceptText, exerciseBlocks } = splitConceptAndExercises(text);

  const qaPairs = exerciseBlocks.flatMap(extractQaPairs);
  const formulas = spotFormulas(conceptText);

  return {
    meta: { curriculum, grade, subject, chapterCode },
    chapterTitle: firstLine,
    conceptText,
    formulas,
    qaPairs,
  };
}

module.exports = { extractChapter, resolvePdfPath, subjectFolder };

// CLI entry point: node extract.js --curriculum NCERT --grade 6 --subject Mathematics --code fegp107
if (require.main === module) {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, arg, i, arr) => {
      if (arg.startsWith('--')) acc.push([arg.slice(2), arr[i + 1]]);
      return acc;
    }, [])
  );
  // pdf-parse's underlying PDF.js sometimes writes "Warning: ..." lines to
  // stdout via console.log — silence stdout during extraction so only the
  // final JSON is printed, then restore it before writing the result.
  const realLog = console.log;
  console.log = () => {};
  extractChapter({
    curriculum: args.curriculum || 'NCERT',
    grade: args.grade,
    subject: args.subject,
    chapterCode: args.code,
  }).then(result => {
    console.log = realLog;
    console.log(JSON.stringify(result, null, 2));
  }).catch(err => {
    console.log = realLog;
    console.error('Extraction failed:', err.message);
    process.exit(1);
  });
}
