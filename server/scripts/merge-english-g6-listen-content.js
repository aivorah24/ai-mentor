/**
 * merge-english-g6-listen-content.js
 * Second (also automated) pipeline step: takes the JSON produced by
 * generate-english-g6-listen-content.js and patches it into
 * AIMentorApp/src/data/cbseG6EnglishSyllabus.ts — adding pdfFile/pdfPage/
 * figureUrl/listenParts/vocab to each topic that doesn't already have them.
 *
 * Safe to re-run: topics that already have `listenParts` are left untouched,
 * UNLESS FORCE=1 is set, in which case their existing listenParts/vocab are
 * replaced with the freshly generated ones (used when the extraction quality
 * was improved and old content needs redoing).
 *
 * Usage: cd server && node scripts/merge-english-g6-listen-content.js
 *        FORCE=1 node scripts/merge-english-g6-listen-content.js
 */
const FORCE = process.env.FORCE === '1';
const fs = require('fs');
const path = require('path');

const JSON_IN = path.join(__dirname, '../data/generated/englishG6ListenContent.json');
const TS_FILE = path.join(__dirname, '../../AIMentorApp/src/data/cbseG6EnglishSyllabus.ts');

function tsStringLiteral(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function formatListenParts(parts) {
  const lines = parts.map((p) => {
    const pieces = [
      `heading: ${tsStringLiteral(p.heading)}`,
      `text: ${tsStringLiteral(p.text)}`,
    ];
    if (p.keyIdea) pieces.push(`keyIdea: ${tsStringLiteral(p.keyIdea)}`);
    if (p.pauseThink) {
      const pt = p.pauseThink;
      pieces.push(
        `pauseThink: { question: ${tsStringLiteral(pt.question)}, options: [${pt.options
          .map(tsStringLiteral)
          .join(', ')}], correctIndex: ${pt.correctIndex} }`,
      );
    }
    return `            {\n              ${pieces.join(',\n              ')},\n            }`;
  });
  return `[\n${lines.join(',\n')},\n          ]`;
}

function formatVocab(vocab) {
  const lines = vocab.map(
    (v) => `            { word: ${tsStringLiteral(v.word)}, definition: ${tsStringLiteral(v.definition)} }`,
  );
  return `[\n${lines.join(',\n')},\n          ]`;
}

function main() {
  const generated = JSON.parse(fs.readFileSync(JSON_IN, 'utf8'));
  let src = fs.readFileSync(TS_FILE, 'utf8');

  let patched = 0;
  let skipped = 0;

  for (const topic of generated) {
    // Find this topic's `name: 'X', kind: ...` line to anchor on.
    const nameEscaped = topic.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameLineRe = new RegExp(`(\\s*)name:\\s*'${nameEscaped}'[^\\n]*\\n`, 'm');
    const nameMatch = src.match(nameLineRe);
    if (!nameMatch) {
      console.warn(`  ! "${topic.name}" not found in cbseG6EnglishSyllabus.ts — skipping`);
      skipped++;
      continue;
    }

    // Already enriched? Check for listenParts within the next ~4000 chars (this topic's block).
    const blockStart = nameMatch.index;
    let blockPreview = src.slice(blockStart, blockStart + 60000);
    const alreadyHasListenParts = /listenParts\s*:/.test(blockPreview);
    if (alreadyHasListenParts && !FORCE) {
      console.log(`  = "${topic.name}" already has listenParts — skipping`);
      skipped++;
      continue;
    }
    if (alreadyHasListenParts && FORCE) {
      // Strip the previously-inserted listenParts + vocab block so we don't
      // end up with two of each (regex below finds a fresh insertion point).
      const stripRe = new RegExp(
        `(\\s*)listenParts:\\s*\\[[\\s\\S]*?\\n(\\s*)\\],\\n\\s*vocab:\\s*\\[[\\s\\S]*?\\n\\s*\\],\\n`,
      );
      const localMatch = blockPreview.match(stripRe);
      if (localMatch) {
        const globalIdx = blockStart + localMatch.index;
        src = src.slice(0, globalIdx) + '\n' + src.slice(globalIdx + localMatch[0].length);
        blockPreview = src.slice(blockStart, blockStart + 60000);
      } else {
        console.warn(`  ! FORCE set but couldn't isolate old listenParts block for "${topic.name}" — skipping`);
        skipped++;
        continue;
      }
    }

    // 1. Add pdfFile/pdfPage right after the name/kind/page line, if not already present.
    if (!/pdfFile\s*:/.test(blockPreview.split('readText:')[0])) {
      src = src.replace(nameLineRe, (whole, indent) => {
        const trimmedLine = whole.trimEnd();
        return `${trimmedLine} pdfFile: ${tsStringLiteral(topic.pdfFile)}, pdfPage: ${topic.pdfPage},\n`;
      });
    }

    // 2. Add figureUrl right before figureCaption (if we found one and it's not set yet).
    if (topic.figureUrl) {
      const figCapRe = new RegExp(
        `(name:\\s*'${nameEscaped}'[\\s\\S]{0,3000}?)(\\s*)(figureCaption:)`,
      );
      if (figCapRe.test(src) && !new RegExp(`name:\\s*'${nameEscaped}'[\\s\\S]{0,3000}?figureUrl:`).test(src)) {
        src = src.replace(figCapRe, (whole, before, indent, figCap) => {
          return `${before}${indent}figureUrl: ${tsStringLiteral(topic.figureUrl)},${indent}${figCap}`;
        });
      }
    }

    // 3. Insert listenParts + vocab right before the closing `activity: ...,\n        },` of readText.
    // Anchor on this topic's `activity:` line, then the next `},` that closes readText.
    const activityRe = new RegExp(
      `(name:\\s*'${nameEscaped}'[\\s\\S]{0,4000}?activity:\\s*'(?:[^'\\\\]|\\\\.)*',\\n)(\\s*)(\\},)`,
    );
    const activityMatch = src.match(activityRe);
    if (!activityMatch) {
      console.warn(`  ! Could not find readText closing brace for "${topic.name}" — listenParts/vocab NOT inserted`);
      skipped++;
      continue;
    }
    const indent = activityMatch[2];
    const insertion =
      `${indent}listenParts: ${formatListenParts(topic.listenParts)},\n` +
      `${indent}vocab: ${formatVocab(topic.vocab)},\n`;
    src = src.replace(activityRe, (whole, before, ind, close) => `${before}${insertion}${ind}${close}`);

    patched++;
    console.log(`  + patched "${topic.name}"`);
  }

  fs.writeFileSync(TS_FILE, src);
  console.log(`\nDone. Patched ${patched} topics, skipped ${skipped}.`);
}

main();
