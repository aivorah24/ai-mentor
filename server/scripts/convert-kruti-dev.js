/**
 * convert-kruti-dev.js — turn Kruti-Dev legacy text into Devanagari Unicode.
 *
 * NCERT's Hindi PDFs are typeset in Kruti Dev, a pre-Unicode font where each
 * Devanagari glyph is mapped onto an ASCII codepoint. Extracting text therefore
 * yields Latin gibberish — "ued dk njksxk" is really "नमक का दरोगा" — so chapter
 * titles could not be read from the books at all.
 *
 * Two things make this more than a character swap:
 *   1. The short-i matra is typed BEFORE its consonant in Kruti Dev ("f" + क)
 *      but must follow it in Unicode (क + ि). Every occurrence needs reordering.
 *   2. Half-consonants are written with a trailing "~"/"Ø"-style marker that maps
 *      to virama (्), and several glyphs are two ASCII characters long, so the
 *      mapping must be applied longest-first or short keys eat long ones.
 *
 *   node scripts/convert-kruti-dev.js --text "ued dk njksxk"
 *   node scripts/convert-kruti-dev.js --pdf data/ncert_books/grade11/hindi/kham101.pdf
 */
const fs = require('fs');
const path = require('path');

// Longest keys first — applied in order, so multi-character glyphs win.
const MAP = [
  // conjuncts / two-char sequences
  ['{k', 'क्ष'], ['=k', 'त्र'], ['K', 'ज्ञ'], ['”k', 'श'], ["'k", 'ष'],
  ['Vª', 'ट्र'], ['Mª', 'ड्र'], ['Nk', 'छा'], ['Hk', 'भ'], ['Ük', 'श'],
  ['°', 'ँ'], ['¡', 'ँ'], ['è', 'ध्'], ['Ë', 'ध्'], ['ª', 'र्'],
  // vowels (independent)
  ['v', 'अ'], ['vk', 'आ'], ['b', 'इ'], ['bZ', 'ई'], ['m', 'उ'], ['Å', 'ऊ'],
  ['_', 'ऋ'], [',', 'ए'], [',s', 'ऐ'], ['vks', 'ओ'], ['vkS', 'औ'],
  // consonants
  ['d', 'क'], ['[k', 'ख'], ['x', 'ग'], ['?k', 'घ'], ['³', 'ङ'],
  ['p', 'च'], ['N', 'छ'], ['t', 'ज'], ['>', 'झ'], ['¥', 'ञ'],
  ['V', 'ट'], ['B', 'ठ'], ['M', 'ड'], ['<', 'ढ'], ['.k', 'ण'],
  ['r', 'त'], ['Fk', 'थ'], ['n', 'द'], ['/k', 'ध'], ['u', 'न'],
  ['i', 'प'], ['Q', 'फ'], ['c', 'ब'], ['Hk', 'भ'], ['e', 'म'],
  [';', 'य'], ['j', 'र'], ['y', 'ल'], ['o', 'व'],
  ['l', 'स'], ['g', 'ह'],
  // matras (dependent vowel signs)
  ['k', 'ा'], ['h', 'ी'], ['q', 'ु'], ['w', 'ू'], ['s', 'े'], ['S', 'ै'],
  ['ks', 'ो'], ['kS', 'ौ'], ['`', 'ृ'],
  ['a', 'ं'], ['%', 'ः'], ['å', 'ॉ'],
  // punctuation / digits
  ['A', '।'], ['&', '-'], ['ƒ', '१'], ['„', '२'], ['…', '३'],
];
// Apply longest source first so "vk" is not consumed by "v".
const ORDERED = [...MAP].sort((a, b) => b[0].length - a[0].length);

const CONSONANTS = 'कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसह';

function krutiToUnicode(input) {
  let s = String(input || '');
  if (!s.trim()) return '';
  // Text that is genuinely English ("Reprint 2025-26") must pass through
  // untouched — running it through the table produces confident nonsense.
  if (looksEnglish(s)) return s.trim();

  // Halant: "~" and "Ø" precede a consonant to mean "half form".
  s = s.replace(/Ø/g, '्').replace(/~/g, '्');

  let out = '';
  outer: for (let i = 0; i < s.length;) {
    for (const [k, v] of ORDERED) {
      if (s.startsWith(k, i)) { out += v; i += k.length; continue outer; }
    }
    out += s[i]; i += 1;
  }

  // Nukta: Kruti Dev writes "+" after a consonant to make ड़/ढ़/ज़/फ़ etc.
  // Left raw it shows as a literal plus sign inside the word.
  out = out.replace(/([ऀ-ॿ])\+/g, (m, c) => {
    const NUKTA = { 'ड': 'ड़', 'ढ': 'ढ़', 'ज': 'ज़', 'फ': 'फ़', 'ब': 'ब़', 'क': 'क़', 'ग': 'ग़', 'र': 'ऱ' };
    return NUKTA[c] || (c + '़');
  });

  // Kruti ligature quirks that survive the character table. These are fixed
  // sequences in this font, not guesses: "वेफ" is how it renders के, "पफ" is फ,
  // and the double-quote glyph is ष.
  out = out.replace(/वेफ/g, 'के').replace(/वैफ/g, 'कै').replace(/वुफ/g, 'कु').replace(/वूफ/g, 'कू')
           .replace(/पफ/g, 'फ').replace(/"/g, 'ष').replace(/μ/g, '–')
           .replace(/‘|’/g, '');

  // The short-i matra was typed before its consonant — move it after.
  // "ि" + क  ->  क + "ि"  (also handles a following halant cluster)
  out = out.replace(/ि([ऀ-ॿ])(्[ऀ-ॿ])?/g, (m, c1, cl) => `${c1}${cl || ''}ि`);
  // "f" is the raw Kruti short-i when it survives the table.
  out = out.replace(/f([ऀ-ॿ])(्[ऀ-ॿ])?/g, (m, c1, cl) => `${c1}${cl || ''}ि`);

  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Real English rather than Kruti-Dev bytes. Kruti text is dense in the symbol
 * range (;, k, ', [, /) and rarely forms English words, so a run of ordinary
 * words with few symbols is a reliable signal to leave it alone.
 */
function looksEnglish(s) {
  const words = s.match(/[A-Za-z]{3,}/g) || [];
  const symbols = (s.match(/[;'\[\]{}=<>%~`^]/g) || []).length;
  const COMMON = /(reprint|chapter|unit|page|the|and|of|for|in|to|hindi|english|ncert)/i;
  return (COMMON.test(s) && symbols <= 2) || (words.length >= 3 && symbols === 0);
}

/** Does this look like real Devanagari rather than leftover Latin? */
function isDevanagari(s) {
  const dev = (s.match(/[ऀ-ॿ]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  return dev > 0 && dev >= latin;
}

module.exports = { krutiToUnicode, isDevanagari };

if (require.main === module) {
  const arg = (f) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : null; };
  const text = arg('--text');
  const pdf = arg('--pdf');

  if (text) {
    const out = krutiToUnicode(text);
    console.log('in :', text);
    console.log('out:', out, isDevanagari(out) ? '(devanagari)' : '(NOT devanagari)');
    process.exit(0);
  }
  if (pdf) {
    (async () => {
      const parse = require('pdf-parse');
      const d = await parse(fs.readFileSync(path.resolve(pdf)), { max: 1 });
      const lines = d.text.split(/\n/).map(l => l.trim()).filter(Boolean).slice(0, 12);
      for (const l of lines) {
        const c = krutiToUnicode(l);
        console.log(`${isDevanagari(c) ? 'OK  ' : '    '} ${JSON.stringify(l.slice(0, 40))} -> ${c.slice(0, 50)}`);
      }
    })();
    return;
  }
  console.log('usage: --text "ued dk njksxk"   |   --pdf <file.pdf>');
}
