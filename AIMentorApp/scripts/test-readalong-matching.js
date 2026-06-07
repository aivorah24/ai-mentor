// Standalone test harness for the Read Aloud "follow along" matching algorithm.
// Replays simulated Vosk transcript sequences (including real ones captured from
// the live console log) through the EXACT same matching logic as
// ReadAloudScreen.tsx, to check whether word-tracking behaves like Google Read
// Along: forgiving brief ASR misses, advancing smoothly, not over-penalizing.

const PASSAGE = 'Our solar system is a family of planets orbiting the Sun. The Sun is a giant star that gives us light and warmth. Mercury is the closest planet and moves the fastest. Earth is the third planet and the only one we know that has life. Mars is called the Red Planet because of its dusty red surface.';
const pWords = PASSAGE.match(/\S+/g);

function normalize(w) {
  return w.toLowerCase().replace(/[^a-z']/g, '').replace(/^'+|'+$/g, '');
}
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
  }
  return d[m][n];
}
function fuzzyMatch(spoken, expected) {
  if (spoken === expected) return true;
  if (expected.length <= 4) return spoken === expected;
  const maxDist = expected.length >= 8 ? 2 : 1;
  return levenshtein(spoken, expected) <= maxDist;
}
const FUNCTION_WORDS = new Set(['a','an','the','is','are','was','were','of','to','and','in','on','at','it','its','that','this','we','us','our','i']);
const isCommon = (w) => FUNCTION_WORDS.has(w) || w.length <= 3;

// ── Reproduces followAlong()'s core matching loop ──────────────────────────
function runFollowAlong(cursor, spoken, misreadCandidates) {
  const recent = spoken.slice(-14);
  if (recent.includes('⍰')) misreadCandidates.add(cursor);
  const skipped = [];
  const misread = [];
  let pi = cursor;
  for (const word of recent) {
    if (word === '⍰') continue;
    if (pi >= pWords.length) break;
    if (pi - cursor >= 14) break;
    const window = isCommon(word) ? 1 : 5;
    let found = -1;
    for (let d = 0; d <= window && pi + d < pWords.length; d++) {
      if (fuzzyMatch(word, normalize(pWords[pi + d]))) { found = d; break; }
    }
    if (found >= 0) {
      for (let k = pi; k < pi + found; k++) {
        if (!/[a-z]/i.test(pWords[k])) continue;
        if (misreadCandidates.has(k)) misread.push(k);
        else skipped.push(k);
      }
      pi = pi + found + 1;
    }
  }
  return { newCursor: pi, skipped, misread };
}

// ── Scenario runner ─────────────────────────────────────────────────────────
function runScenario(name, transcripts) {
  console.log(`\n=== ${name} ===`);
  let cursor = 0;
  const misreadCandidates = new Set();
  const allSkipped = new Set();
  const allMisread = new Set();
  for (const spoken of transcripts) {
    const before = cursor;
    const { newCursor, skipped, misread } = runFollowAlong(cursor, spoken, misreadCandidates);
    skipped.forEach(i => allSkipped.add(i));
    misread.forEach(i => allMisread.add(i));
    if (newCursor > cursor) {
      cursor = newCursor;
      console.log(`  heard: [${spoken.join(' ')}]  →  ${before} → ${cursor}/${pWords.length}` +
        (skipped.length ? `  skipped:[${skipped.map(i => pWords[i]).join(',')}]` : '') +
        (misread.length ? `  misread:[${misread.map(i => pWords[i]).join(',')}]` : ''));
    } else {
      console.log(`  heard: [${spoken.join(' ')}]  →  (no advance, waiting)`);
    }
  }
  const falsePositives = [...allSkipped].filter(i => allMisread.has(i));
  console.log(`  FINAL cursor=${cursor}/${pWords.length}  totalSkipped=${allSkipped.size}  totalMisread=${allMisread.size}`);
  return { cursor, allSkipped, allMisread };
}

// 1) EXACT sequence captured from the live console log (real Vosk run) ──────
runScenario('Real captured run (from your console log)', [
  ['solar', 'system', 'is'],
  ['solar', 'system', 'family'],
]);

// 2) Ideal: recognizer catches every word cleanly, no clipping ──────────────
runScenario('Ideal — no startup clipping (what Google Read Along achieves)', [
  ['our', 'solar', 'system', 'is', 'a'],
  ['family', 'of', 'planets', 'orbiting', 'the'],
  ['sun', 'the', 'sun', 'is', 'a', 'giant', 'star'],
]);

// 3) Reader pauses mid-sentence, then continues — does it freeze correctly? ─
runScenario('Mid-passage pause then resume', [
  ['our', 'solar', 'system', 'is', 'a', 'family', 'of'],
  ['noise', 'noise'],                               // silence/breath misheard as noise — should NOT advance
  ['planets', 'orbiting', 'the', 'sun'],
]);

// 4) Misread word (Vosk emits [unk] sentinel) ───────────────────────────────
runScenario('Mispronunciation flagged via [unk]', [
  ['our', 'solar', '⍰', 'is', 'a', 'family'],
  ['of', 'planets', 'orbiting'],
]);

// 5) Fast reader — burst of many words in one partial ───────────────────────
runScenario('Fast reader — long burst', [
  ['our', 'solar', 'system', 'is', 'a', 'family', 'of', 'planets', 'orbiting', 'the', 'sun', 'the', 'sun', 'is'],
]);
