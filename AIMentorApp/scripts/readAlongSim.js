// Deterministic test of the Read Aloud follow-along alignment.
// Replays the word sequences Vosk emits for slow / fast / skipped /
// mispronounced / punctuation reading and checks the highlight output.
// Tests the ALIGNMENT LOGIC (mirrors ReadAloudScreen.tsx), not Vosk acoustics.

function normalize(w) {
  return w.toLowerCase().replace(/[^a-z']/g, '').replace(/^'+|'+$/g, '');
}
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n; if (n === 0) return m;
  const d = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
  return d[m][n];
}
function fuzzyMatch(spoken, expected) {
  if (spoken === expected) return true;
  if (expected.length <= 4) return spoken === expected;
  const maxDist = expected.length >= 8 ? 2 : 1;
  return levenshtein(spoken, expected) <= maxDist;
}
const FUNCTION_WORDS = new Set([
  'a','an','the','of','in','on','at','to','is','was','he','she','it','we',
  'and','but','or','not','no','do','so','be','by','up','as','if','my','me',
  'us','his','her','its','our','had','has','for','are','were','did','can',
  'may','all','one','two','any','out','with','than','that','this','from',
]);

function makeEngine(passage) {
  const pWords = passage.match(/\S+/g) || [];
  let cursor = 0;
  const statuses = new Array(pWords.length).fill('pending');
  if (statuses.length) statuses[0] = 'current';
  const misreadCandidate = new Set();
  let lastSpoken = [];
  let pendingLongMatch = null; // { pos, skipped: number[], misread: number[] } | null
  let scanPos = 0;
  const LONG_WORD_LEN = 7;

  function advanceHighlightTo(newPos, marks) {
    if (newPos <= cursor) return;
    if (newPos > pWords.length) newPos = pWords.length;
    while (newPos < pWords.length && !/[a-z]/i.test(pWords[newPos])) newPos++; // glide past punctuation
    for (let i = 0; i < newPos; i++) {
      if (statuses[i] === 'pending' || statuses[i] === 'current') {
        statuses[i] = marks?.misread?.includes(i) ? 'misread'
                    : marks?.skipped?.includes(i) ? 'skipped' : 'correct';
      }
    }
    if (newPos < pWords.length) statuses[newPos] = 'current';
    cursor = newPos;
  }

  function followAlong(spoken) {
    if (spoken.length === 0 || cursor >= pWords.length) return;
    const maxLcp = Math.min(lastSpoken.length, spoken.length);
    let lcp = 0;
    while (lcp < maxLcp && lastSpoken[lcp] === spoken[lcp]) lcp++;
    const newWords = spoken.slice(lcp);
    lastSpoken = spoken;
    const pending = pendingLongMatch;
    if (newWords.length === 0) {
      if (pending !== null) {
        pendingLongMatch = null;
        advanceHighlightTo(scanPos, { skipped: pending.skipped, misread: pending.misread });
      }
      return;
    }
    const isCommon = (w) => FUNCTION_WORDS.has(w) || w.length <= 3;
    const recent = newWords;
    if (recent.includes('⍰')) misreadCandidate.add(cursor);
    const skipped = pending ? pending.skipped.slice() : [];
    const misread = pending ? pending.misread.slice() : [];
    let pi = pending ? scanPos : cursor;
    let pendingNow = pending;
    for (const word of recent) {
      if (word === '⍰') {
        misreadCandidate.add(pi);
        continue;
      }
      if (pi >= pWords.length) break;
      const window = isCommon(word) ? 1 : 3;
      let found = -1;
      for (let d = 0; d <= window && pi + d < pWords.length; d++) {
        if (fuzzyMatch(word, normalize(pWords[pi + d]))) { found = d; break; }
      }
      if (found >= 0) {
        const matchedPos = pi + found;
        const expectedWord = normalize(pWords[matchedPos]);
        if (found === 0 && expectedWord.length >= LONG_WORD_LEN && (pendingNow === null || pendingNow.pos !== matchedPos)) {
          pendingNow = { pos: matchedPos, skipped: skipped.slice(), misread: misread.slice() };
          pi = matchedPos + 1;
          continue;
        }
        if (pendingNow !== null && pendingNow.pos === matchedPos) {
          pi = matchedPos + 1;
          continue;
        }
        for (let k = pi; k < pi + found; k++) {
          if (!/[a-z]/i.test(pWords[k])) continue; // punctuation isn't a skip
          if (pendingNow !== null && k === pendingNow.pos) continue;
          if (misreadCandidate.has(k)) misread.push(k); else skipped.push(k);
        }
        if (pendingNow !== null && matchedPos > pendingNow.pos) {
          pendingNow = null;
        }
        pi = matchedPos + 1;
      }
    }
    scanPos = pi;
    pendingLongMatch = pendingNow;
    const commitTo = pendingNow !== null ? pendingNow.pos : pi;
    const commitSkipped = pendingNow !== null ? skipped.filter((k) => k < pendingNow.pos) : skipped;
    const commitMisread = pendingNow !== null ? misread.filter((k) => k < pendingNow.pos) : misread;
    if (commitTo > cursor) advanceHighlightTo(commitTo, { skipped: commitSkipped, misread: commitMisread });
  }

  return { followAlong, get cursor() { return cursor; }, statuses, pWords };
}

function feed(engine, tokens, { perWordReset = false } = {}) {
  if (perWordReset) { for (const t of tokens) engine.followAlong([t]); }
  else { const acc = []; for (const t of tokens) { acc.push(t); engine.followAlong(acc.slice()); } }
}

function report(name, engine, expectMarks) {
  const s = engine.statuses, pWords = engine.pWords, reached = engine.cursor;
  let ok = reached >= pWords.length - 1;
  const issues = [];
  for (let i = 0; i < pWords.length; i++) {
    const want = expectMarks[i] || (/[a-z]/i.test(pWords[i]) ? 'correct' : 'correct');
    if (i === reached && s[i] === 'current') continue;
    if (s[i] !== want) { ok = false; issues.push(`word[${i}] "${pWords[i]}" = ${s[i]} (want ${want})`); }
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — reached ${reached}/${pWords.length - 1}`);
  for (const is of issues) console.log('        · ' + is);
  return ok;
}

const P = 'Throughout history, people have moved from one place to another in search of food, safety, and better opportunities.';
const correct = (passage) => (passage.match(/\S+/g) || []).map(w => normalize(w)).filter(Boolean);

let pass = 0, total = 0;
const run = (name, passage, tokens, opts, expect) => {
  const e = makeEngine(passage); feed(e, tokens, opts); total++; if (report(name, e, expect || {})) pass++;
};

// 1. slow correct (pause per word)
run('slow / correct', P, correct(P), { perWordReset: true }, {});
// 2. fast correct (one burst)
run('fast / correct', P, correct(P), {}, {});
// 3. skip "people" (idx2) → gold
run('skip "people" → gold', P, correct(P).filter((_, i) => i !== 2), {}, { 2: 'skipped' });
// 4. mispronounce "history" (idx1) → pink
{ const t = correct(P).slice(); t[1] = '⍰'; run('mispronounce "history" → pink', P, t, {}, { 1: 'misread' }); }
// 5. fast + skip "place" (idx8) → gold
run('fast + skip "place" → gold', P, correct(P).filter((_, i) => i !== 8), {}, { 8: 'skipped' });
// 6. em-dash transparency: passage with "—"; reader never says it, cursor glides past
{ const PD = 'many reasons — to find work';            // tokens: many reasons — to find work
  const toks = ['many','reasons','to','find','work'];   // dash never spoken
  run('em-dash "—" glides past (not stuck/gold)', PD, toks, {}, {});  // all real words correct, dash correct
}

// 7. long-word "snap-ahead": Vosk's grammar guesses the FULL word the instant
//    it hears the first syllable ("appr…" → "appreciation"). The engine must
//    HOLD it (not mark correct/advance) until confirmed — either by surviving
//    a repeat emission unchanged, or by the reader moving on past it.
{
  const PL = 'We must show appreciation for our teachers';
  const e = makeEngine(PL);
  total++;
  e.followAlong(['we']);
  e.followAlong(['we', 'must']);
  e.followAlong(['we', 'must', 'show']);
  e.followAlong(['we', 'must', 'show', 'appreciation']); // premature snap-ahead guess
  const heldBack = e.cursor === 3 && e.statuses[3] !== 'correct';
  e.followAlong(['we', 'must', 'show', 'appreciation']); // unchanged repeat → confirms
  e.followAlong(['we', 'must', 'show', 'appreciation', 'for', 'our', 'teachers']);
  const ok = heldBack && e.cursor >= 6 && e.statuses[3] === 'correct';
  console.log(`${ok ? 'PASS' : 'FAIL'}  long-word snap-ahead held then confirmed  — reached ${e.cursor}/${e.pWords.length - 1}, word[3]="${e.statuses[3]}"${heldBack ? '' : ' (NOT held back!)'}`);
  if (ok) pass++;
}

// 8. long-word confirmed by "reader moved on" (no repeat emission — transcript
//    jumps straight to the next word once the recognizer finalizes the phrase).
{
  const PL = 'We must show appreciation for our teachers';
  const e = makeEngine(PL);
  total++;
  e.followAlong(['we']);
  e.followAlong(['we', 'must']);
  e.followAlong(['we', 'must', 'show']);
  e.followAlong(['we', 'must', 'show', 'appreciation']); // held
  e.followAlong(['we', 'must', 'show', 'appreciation', 'for']); // moved on → confirms "appreciation"
  e.followAlong(['we', 'must', 'show', 'appreciation', 'for', 'our', 'teachers']);
  const ok = e.cursor >= 6 && e.statuses[3] === 'correct' && e.statuses[3] !== 'skipped';
  console.log(`${ok ? 'PASS' : 'FAIL'}  long-word confirmed by reader moving on  — reached ${e.cursor}/${e.pWords.length - 1}, word[3]="${e.statuses[3]}"`);
  if (ok) pass++;
}

console.log(`\n${pass}/${total} scenarios passed  (alignment logic)`);
process.exit(pass === total ? 0 : 1);
