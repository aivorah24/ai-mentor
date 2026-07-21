/**
 * scripts/lib/readCurrentSyllabus.js
 * Reads the CURRENT AI-generated learning content straight out of
 * cbseG6EnglishSyllabus.ts (the file the app actually serves to students) —
 * not a possibly-stale copy of the generation pipeline's JSON output. This
 * is what Step 1 ("Load current AI-generated learning content") and Step 4
 * ("improve only the missing sections") both read from and write back to.
 *
 * The .ts file's structure is regular enough (each topic is one object
 * literal with well-known field names) that a string-based parser is
 * reliable without pulling in a TypeScript AST dependency.
 */
const fs = require('fs');
const path = require('path');

const TS_FILE = path.join(__dirname, '../../../AIMentorApp/src/data/cbseG6EnglishSyllabus.ts');

function extractStringLiteral(src, fromIdx) {
  // src[fromIdx] is expected to be the opening quote (' or "). Only used to
  // find where a string ends while scanning for balanced brackets — doesn't
  // need to actually decode escapes, so no JSON.parse (which chokes on
  // control chars that can legitimately appear in extracted book text).
  const quote = src[fromIdx];
  let i = fromIdx + 1;
  let out = '';
  while (i < src.length) {
    if (src[i] === '\\') { out += src[i] + src[i + 1]; i += 2; continue; }
    if (src[i] === quote) return { value: out, end: i + 1 };
    out += src[i];
    i++;
  }
  return { value: out, end: i };
}

// Finds the char range of the top-level object/array starting at `openIdx`
// (which must be '{' or '['), matching brackets/quotes correctly.
function findBalancedEnd(src, openIdx) {
  const open = src[openIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"') {
      const { end } = extractStringLiteral(src, i);
      i = end;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function getAllTopicNames(src) {
  const names = [];
  const re = /name:\s*'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(src))) names.push(m[1].replace(/\\'/g, "'"));
  return names;
}

// Returns { intro, body, figureUrl, figureCaption, activity, listenParts, vocab, pdfFile, pdfPage }
// for the named topic, or null if not found.
function readTopicContent(topicName) {
  const src = fs.readFileSync(TS_FILE, 'utf8');
  const nameEscaped = topicName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRe = new RegExp(`name:\\s*'${nameEscaped}'`);
  const nameMatch = src.match(nameRe);
  if (!nameMatch) return null;
  const blockStart = nameMatch.index;

  // The topic object literal starts at the '{' just before "name:".
  const objStart = src.lastIndexOf('{', blockStart);
  const objEnd = findBalancedEnd(src, objStart);
  const block = src.slice(objStart, objEnd + 1);

  const pdfFileM = block.match(/pdfFile:\s*'((?:[^'\\]|\\.)*)'/);
  const pdfPageM = block.match(/pdfPage:\s*(\d+)/);
  const introM = block.match(/intro:\s*'((?:[^'\\]|\\.)*)'/);
  const figUrlM = block.match(/figureUrl:\s*'((?:[^'\\]|\\.)*)'/);
  const figCapM = block.match(/figureCaption:\s*'((?:[^'\\]|\\.)*)'/);
  const activityM = block.match(/activity:\s*'((?:[^'\\]|\\.)*)'/);

  function unescape(s) { return s ? s.replace(/\\'/g, "'") : s; }

  // body: [ '...', '...' ]
  let body = [];
  const bodyIdx = block.indexOf('body:');
  if (bodyIdx !== -1) {
    const arrStart = block.indexOf('[', bodyIdx);
    const arrEnd = findBalancedEnd(block, arrStart);
    const arrSrc = block.slice(arrStart, arrEnd + 1);
    const strRe = /'((?:[^'\\]|\\.)*)'/g;
    let sm;
    while ((sm = strRe.exec(arrSrc))) body.push(unescape(sm[1]));
  }

  // listenParts: [ { heading:'', text:'', keyIdea:'', pauseThink:{...} }, ... ]
  let listenParts = [];
  const lpIdx = block.indexOf('listenParts:');
  if (lpIdx !== -1) {
    const arrStart = block.indexOf('[', lpIdx);
    const arrEnd = findBalancedEnd(block, arrStart);
    const arrSrc = block.slice(arrStart, arrEnd + 1);
    // Split into individual { ... } part objects at depth 1.
    let i = 1, depth = 0, partStart = -1;
    while (i < arrSrc.length) {
      const ch = arrSrc[i];
      if (ch === "'" || ch === '"') { i = extractStringLiteral(arrSrc, i).end; continue; }
      if (ch === '{') { if (depth === 0) partStart = i; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const partSrc = arrSrc.slice(partStart, i + 1);
          const heading = partSrc.match(/heading:\s*'((?:[^'\\]|\\.)*)'/);
          const text = partSrc.match(/text:\s*'((?:[^'\\]|\\.)*)'/);
          const keyIdea = partSrc.match(/keyIdea:\s*'((?:[^'\\]|\\.)*)'/);
          const hasPauseThink = /pauseThink:\s*\{/.test(partSrc);
          listenParts.push({
            heading: heading ? unescape(heading[1]) : '',
            text: text ? unescape(text[1]) : '',
            keyIdea: keyIdea ? unescape(keyIdea[1]) : undefined,
            hasPauseThink,
          });
        }
      }
      i++;
    }
  }

  // vocab: [ { word:'', definition:'' }, ... ]
  let vocab = [];
  const vIdx = block.indexOf('vocab:');
  if (vIdx !== -1) {
    const arrStart = block.indexOf('[', vIdx);
    const arrEnd = findBalancedEnd(block, arrStart);
    const arrSrc = block.slice(arrStart, arrEnd + 1);
    const entryRe = /\{\s*word:\s*'((?:[^'\\]|\\.)*)'\s*,\s*definition:\s*'((?:[^'\\]|\\.)*)'\s*\}/g;
    let em;
    while ((em = entryRe.exec(arrSrc))) vocab.push({ word: unescape(em[1]), definition: unescape(em[2]) });
  }

  return {
    pdfFile: pdfFileM ? unescape(pdfFileM[1]) : undefined,
    pdfPage: pdfPageM ? parseInt(pdfPageM[1], 10) : undefined,
    intro: introM ? unescape(introM[1]) : '',
    body,
    figureUrl: figUrlM ? unescape(figUrlM[1]) : undefined,
    figureCaption: figCapM ? unescape(figCapM[1]) : '',
    activity: activityM ? unescape(activityM[1]) : '',
    listenParts,
    vocab,
  };
}

module.exports = { readTopicContent, getAllTopicNames, TS_FILE };
