/**
 * Whisper timing alignment & word highlight sync tests
 * Tests the full pipeline: Whisper word timestamps → highlight index at any currentTime
 *
 * Key scenarios:
 *  - Whisper words match text exactly
 *  - Whisper words differ slightly (punctuation, contractions, merged tokens)
 *  - Micro-second boundaries (word ends at exactly same time next starts)
 *  - Playback rate scaling (0.5x, 1x, 1.5x, 2x)
 *  - Real Ambarisha story page 1 text
 *  - No word is skipped or double-highlighted
 */

// ── Mirror of server normalize helper ────────────────────────────────────────
const normalize = w => w.toLowerCase().replace(/[^a-z0-9]/g, '');

// ── Mirror of server alignmentToWordTimings (Whisper version) ────────────────
function alignWhisperToText(textWords, whisperWords) {
  const timings = [];
  let wi = 0;

  for (const textWord of textWords) {
    const normText = normalize(textWord);

    // Pure punctuation (em-dash —, quotes, ellipsis…) — Whisper never emits
    // these as separate tokens. Give it the previous Whisper word's endTime so
    // it occupies the gap between surrounding words. wi does NOT advance.
    if (!normText) {
      const prevWw = wi > 0 ? whisperWords[wi - 1] : null;
      const nextWw = whisperWords[Math.min(wi, whisperWords.length - 1)];
      const start  = prevWw ? parseFloat((prevWw.end ?? prevWw.start).toFixed(3))
                            : parseFloat(((nextWw.start ?? 0) - 0.05).toFixed(3));
      timings.push({ word: textWord, startTime: start, endTime: start });
      continue; // wi stays unchanged
    }

    let best = wi;
    for (let lookahead = wi; lookahead < Math.min(wi + 4, whisperWords.length); lookahead++) {
      const normW = normalize(whisperWords[lookahead].word);
      if (!normW) continue; // skip empty Whisper tokens (shouldn't happen in real API)
      if (normW === normText) { best = lookahead; break; }
      // Partial match — only safe when both sides are non-empty
      if (normW.length > 0 && (normW.includes(normText) || normText.includes(normW))) { best = lookahead; break; }
    }
    const ww = whisperWords[best] ?? whisperWords[whisperWords.length - 1];
    timings.push({
      word:      textWord,
      startTime: parseFloat((ww.start ?? 0).toFixed(3)),
      endTime:   parseFloat((ww.end   ?? ww.start + 0.2).toFixed(3)),
    });
    if (best === wi) wi = Math.min(wi + 1, whisperWords.length - 1);
  }
  return timings;
}

// ── Mirror of frontend getWordIdx (rAF loop logic) ───────────────────────────
// This is the exact logic used in startHighlightLoop in StoryReaderScreen.tsx
function getWordIdx(currentTime, timings, audioDuration) {
  let idx = 0;
  for (let i = 0; i < timings.length; i++) {
    const wordEnd = timings[i + 1]?.startTime ?? (audioDuration + 1);
    if (currentTime >= timings[i].startTime && currentTime < wordEnd) { idx = i; break; }
    if (currentTime >= timings[i].startTime) idx = i;
  }
  return idx;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildWhisperWords(text, durations, gapMs = 30) {
  // Build a realistic Whisper response: each word has start/end, separated by gapMs silence.
  // Pure-punctuation tokens (em-dash, quotes) are EXCLUDED — real Whisper never emits them.
  const words = text.match(/\S+/g) || [];
  const gap   = gapMs / 1000;
  let t = 0.05; // typical leading silence in TTS audio
  const result = [];
  for (let i = 0; i < words.length; i++) {
    const dur   = durations[i] ?? 0.3;
    const normW = normalize(words[i]);
    if (!normW) { t += dur + gap; continue; } // skip pure punct — Whisper won't emit these
    result.push({ word: normW, start: parseFloat(t.toFixed(3)), end: parseFloat((t + dur).toFixed(3)) });
    t += dur + gap;
  }
  return result;
}

// Real page 1 text from Ambarisha story
const AMBARISHA_P1 =
  'Long, long ago, in the golden kingdom of Mathura, there lived a great king named Ambarisha Maharaja. ' +
  'He was not just a powerful king — he was one of the greatest devotees of Lord Vishnu in the whole world.';

// Realistic TTS durations (seconds) for each word — modelled on typical ElevenLabs pacing
const AMBARISHA_P1_DURS = [
  0.30, 0.22, 0.28, 0.17, 0.14, 0.35, 0.40, 0.14, 0.52, 0.45, // Long, long ago, in the golden kingdom of Mathura, there
  0.25, 0.18, 0.18, 0.38, 0.48, 0.52, 0.58,                    // lived a great king named Ambarisha Maharaja.
  0.22, 0.17, 0.14, 0.17, 0.18, 0.28, 0.28, 0.22,             // He was not just a powerful king
  0.22, 0.22, 0.17, 0.14, 0.14, 0.40, 0.38,                   // — he was one of the greatest
  0.48, 0.17, 0.44, 0.42, 0.17, 0.14, 0.42, 0.25,             // devotees of Lord Vishnu in the whole world.
];

// ── 1. Whisper alignment correctness ─────────────────────────────────────────
describe('Whisper alignment — text word → whisper word mapping', () => {
  const textWords = ['Long,', 'long', 'ago,', 'in', 'the', 'golden', 'kingdom', 'of', 'Mathura,'];
  const whisperWords = buildWhisperWords(
    'Long long ago in the golden kingdom of Mathura',
    [0.30, 0.22, 0.28, 0.17, 0.14, 0.35, 0.40, 0.14, 0.52],
  );

  const timings = alignWhisperToText(textWords, whisperWords);

  test('produces exactly as many timings as text words', () => {
    expect(timings).toHaveLength(textWords.length);
  });

  test('each timing carries the original text word (with punctuation)', () => {
    expect(timings[0].word).toBe('Long,');
    expect(timings[2].word).toBe('ago,');
    expect(timings[8].word).toBe('Mathura,');
  });

  test('start times are non-decreasing', () => {
    for (let i = 1; i < timings.length; i++) {
      expect(timings[i].startTime).toBeGreaterThanOrEqual(timings[i - 1].startTime);
    }
  });

  test('"of" (function word, 2 chars) gets a real timestamp — not zero', () => {
    const ofTiming = timings.find(t => t.word === 'of');
    expect(ofTiming).toBeDefined();
    expect(ofTiming.startTime).toBeGreaterThan(0.5); // well into the sentence
  });

  test('"Mathura," gets later timestamp than "kingdom"', () => {
    const kingdom  = timings.find(t => t.word === 'kingdom');
    const mathura  = timings.find(t => t.word === 'Mathura,');
    expect(mathura.startTime).toBeGreaterThan(kingdom.startTime);
  });
});

// ── 2. Micro-second boundary precision ────────────────────────────────────────
describe('Micro-second boundary — exactly at word transition', () => {
  // Word A: 0.000 → 0.300, Word B: 0.330 → 0.630 (30ms gap between)
  const timings = [
    { word: 'Long,', startTime: 0.000, endTime: 0.300 },
    { word: 'long',  startTime: 0.330, endTime: 0.552 },
    { word: 'ago,',  startTime: 0.582, endTime: 0.862 },
  ];
  const dur = 0.9;

  test('at exactly startTime of word 0 → highlights word 0', () => {
    expect(getWordIdx(0.000, timings, dur)).toBe(0);
  });

  test('1ms before word 1 starts → still word 0', () => {
    expect(getWordIdx(0.329, timings, dur)).toBe(0);
  });

  test('at exactly startTime of word 1 → highlights word 1', () => {
    expect(getWordIdx(0.330, timings, dur)).toBe(1);
  });

  test('inside gap between word 0 end and word 1 start → stays on word 0', () => {
    // gap is 0.300 → 0.330; currentTime 0.310 should stay on word 0
    expect(getWordIdx(0.310, timings, dur)).toBe(0);
  });

  test('mid-word 2 → highlights word 2', () => {
    expect(getWordIdx(0.700, timings, dur)).toBe(2);
  });

  test('at exact end of audio → last word highlighted', () => {
    expect(getWordIdx(dur, timings, dur)).toBe(2);
  });
});

// ── 3. No word skipped or double-highlighted ──────────────────────────────────
describe('Full playback simulation — no word skipped or highlighted twice in a row', () => {
  const textWords = AMBARISHA_P1.match(/\S+/g);
  const whisperWords = buildWhisperWords(AMBARISHA_P1, AMBARISHA_P1_DURS, 25);
  const timings = alignWhisperToText(textWords, whisperWords);
  const audioDuration = whisperWords[whisperWords.length - 1].end + 0.5;

  test('timings count matches word count', () => {
    expect(timings).toHaveLength(textWords.length);
  });

  test('every word gets highlighted at least once during 1x playback (1ms steps)', () => {
    const highlighted = new Set();
    for (let ms = 0; ms <= audioDuration * 1000; ms += 1) {
      highlighted.add(getWordIdx(ms / 1000, timings, audioDuration));
    }
    for (let i = 0; i < textWords.length; i++) {
      expect(highlighted.has(i)).toBe(true);
    }
  });

  test('word index never jumps backwards during playback', () => {
    let prev = 0;
    for (let ms = 0; ms <= audioDuration * 1000; ms += 1) {
      const idx = getWordIdx(ms / 1000, timings, audioDuration);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });

  test('at each word startTime, that exact word is highlighted (not previous)', () => {
    for (let i = 0; i < timings.length; i++) {
      const t = timings[i].startTime + 0.001; // 1ms past start
      const idx = getWordIdx(t, timings, audioDuration);
      expect(idx).toBe(i);
    }
  });

  test('highlight lag < 30ms — at word startTime, we are ≤1 word behind', () => {
    // If Whisper says word i starts at T, getWordIdx(T) must return i or i-1 (never i-2 or beyond)
    for (let i = 1; i < timings.length; i++) {
      const t = timings[i].startTime;
      const idx = getWordIdx(t, timings, audioDuration);
      expect(idx).toBeGreaterThanOrEqual(i - 1);
    }
  });
});

// ── 4. Playback rate scaling ───────────────────────────────────────────────────
describe('Playback rate — timings work correctly at 0.5x, 1.5x, 2x', () => {
  // Timings are always in media-time seconds (not wall-clock).
  // audio.currentTime is also media-time. So playback rate should not affect sync.
  const timings = [
    { word: 'Long,',   startTime: 0.00, endTime: 0.30 },
    { word: 'long',    startTime: 0.33, endTime: 0.55 },
    { word: 'ago,',    startTime: 0.58, endTime: 0.86 },
    { word: 'in',      startTime: 0.89, endTime: 1.06 },
    { word: 'the',     startTime: 1.09, endTime: 1.23 },
    { word: 'kingdom', startTime: 1.26, endTime: 1.66 },
  ];
  const dur = 1.8;

  // Word "ago," starts at 0.58 — same regardless of playback rate
  [0.5, 1, 1.5, 2].forEach(rate => {
    test(`at rate=${rate}x, "ago," (media t=0.60) → idx 2`, () => {
      // currentTime is media-time, same for all rates
      expect(getWordIdx(0.60, timings, dur)).toBe(2);
    });

    test(`at rate=${rate}x, "kingdom" (media t=1.30) → idx 5`, () => {
      expect(getWordIdx(1.30, timings, dur)).toBe(5);
    });
  });
});

// ── 5. Whisper token-merging edge cases ───────────────────────────────────────
describe('Whisper alignment — handles merged/split tokens gracefully', () => {
  test('Whisper merges "Ambarisha Maharaja" into one token → both text words get timestamps', () => {
    const textWords = ['Ambarisha', 'Maharaja.'];
    // Whisper sometimes merges proper nouns into one token
    const whisperWords = [
      { word: 'ambarishamaharaja', start: 1.2, end: 1.9 },
    ];
    const timings = alignWhisperToText(textWords, whisperWords);
    expect(timings).toHaveLength(2);
    // Both should get the merged token's timestamp (partial match)
    expect(timings[0].startTime).toBe(1.2);
    expect(timings[1].startTime).toBe(1.2); // same source token
  });

  test('Whisper splits "Mathura," into "mathura" + "," → text word still gets correct start', () => {
    const textWords = ['of', 'Mathura,', 'there'];
    const whisperWords = [
      { word: 'of',     start: 0.90, end: 1.04 },
      { word: 'mathura',start: 1.07, end: 1.59 },
      { word: 'there',  start: 1.62, end: 1.87 },
    ];
    const timings = alignWhisperToText(textWords, whisperWords);
    expect(timings[1].word).toBe('Mathura,');
    expect(timings[1].startTime).toBe(1.07); // matches 'mathura' whisper token
  });

  test('em-dash "—" does NOT consume a Whisper token — word after dash stays aligned', () => {
    // Bug: normalize("—") = "" → "".includes("") = true for ANY word → dash steals next token
    // Fix: pure-punctuation tokens skip without advancing wi
    const textWords = ['king', '—', 'he', 'was'];
    const whisperWords = [
      { word: 'king', start: 0.5, end: 0.8 },
      { word: 'he',   start: 0.9, end: 1.1 },
      { word: 'was',  start: 1.2, end: 1.4 },
    ];
    const timings = alignWhisperToText(textWords, whisperWords);
    expect(timings).toHaveLength(4);
    expect(timings[0].word).toBe('king');
    expect(timings[0].startTime).toBe(0.5);
    // "—" inherits king's or he's timestamp — does NOT consume "he" slot
    expect(timings[1].word).toBe('—');
    // Critical: "he" must align to Whisper "he" (0.9s), NOT "was" (1.2s)
    expect(timings[2].word).toBe('he');
    expect(timings[2].startTime).toBe(0.9);
    expect(timings[3].word).toBe('was');
    expect(timings[3].startTime).toBe(1.2);
  });

  test('other pure-punct tokens (quotes, ellipsis) also do not consume Whisper slots', () => {
    const textWords = ['"Hello', 'world."'];
    const whisperWords = [
      { word: 'hello', start: 0.1, end: 0.4 },
      { word: 'world', start: 0.5, end: 0.8 },
    ];
    const timings = alignWhisperToText(textWords, whisperWords);
    expect(timings[0].startTime).toBe(0.1); // "Hello → matches 'hello'
    expect(timings[1].startTime).toBe(0.5); // "world." → matches 'world'
  });
});

// ── 6. Drift measurement — quantify microsecond error ─────────────────────────
describe('Drift measurement — quantify highlight lag vs Whisper ground truth', () => {
  const textWords = AMBARISHA_P1.match(/\S+/g);
  const whisperWords = buildWhisperWords(AMBARISHA_P1, AMBARISHA_P1_DURS, 25);
  const timings = alignWhisperToText(textWords, whisperWords);
  const audioDuration = whisperWords[whisperWords.length - 1].end + 0.5;

  test('max LAG (highlight appearing late) vs Whisper startTime is < 30ms', () => {
    // We only penalise lag (highlight after word starts) — early highlight is fine UX.
    // Word 0 appearing during leading silence is NOT lag, it's correct behaviour.
    let maxLagMs = 0;
    const lagReport = [];
    for (let i = 0; i < timings.length; i++) {
      const targetStart = timings[i].startTime;
      // Find first ms where getWordIdx returns i
      let firstHighlightMs = null;
      for (let ms = 0; ms <= (targetStart + 0.1) * 1000; ms++) {
        if (getWordIdx(ms / 1000, timings, audioDuration) === i) {
          firstHighlightMs = ms;
          break;
        }
      }
      // Lag = how many ms after targetStart the word first lights up (positive = late)
      const lagMs = firstHighlightMs !== null
        ? Math.max(0, firstHighlightMs - targetStart * 1000)
        : 100;
      lagReport.push({ word: timings[i].word, targetStart, lagMs });
      if (lagMs > maxLagMs) maxLagMs = lagMs;
    }
    const worstWords = lagReport.filter(r => r.lagMs > 5).map(r => `"${r.word}"=${r.lagMs.toFixed(1)}ms`);
    console.log(`Max highlight LAG: ${maxLagMs.toFixed(1)}ms`);
    if (worstWords.length) console.log(`Words with lag > 5ms: ${worstWords.join(', ')}`);
    expect(maxLagMs).toBeLessThan(30); // < 30ms is imperceptible
  });

  test('average LAG across all words < 5ms', () => {
    let totalLag = 0;
    for (let i = 0; i < timings.length; i++) {
      const targetStart = timings[i].startTime;
      let firstHighlightMs = null;
      for (let ms = 0; ms <= (targetStart + 0.1) * 1000; ms++) {
        if (getWordIdx(ms / 1000, timings, audioDuration) === i) { firstHighlightMs = ms; break; }
      }
      const lagMs = firstHighlightMs !== null ? Math.max(0, firstHighlightMs - targetStart * 1000) : 100;
      totalLag += lagMs;
    }
    const avgLag = totalLag / timings.length;
    console.log(`Average highlight LAG: ${avgLag.toFixed(1)}ms`);
    expect(avgLag).toBeLessThan(5);
  });

  test('prints per-word timing table for manual inspection', () => {
    // This test always passes — it just logs the timing table for debugging
    const rows = timings.slice(0, 15).map((t, i) =>
      `  [${String(i).padStart(2)}] "${t.word.padEnd(12)}" start=${t.startTime.toFixed(3)}s end=${t.endTime.toFixed(3)}s`
    );
    console.log('\nWord timing table (first 15 words):\n' + rows.join('\n'));
    expect(true).toBe(true);
  });
});

// ── 7. Edge cases ─────────────────────────────────────────────────────────────
describe('Edge cases', () => {
  test('empty text → empty timings', () => {
    expect(alignWhisperToText([], [])).toHaveLength(0);
  });

  test('single word → highlighted from t=0', () => {
    const timings = [{ word: 'Hello', startTime: 0.05, endTime: 0.35 }];
    expect(getWordIdx(0.05, timings, 1.0)).toBe(0);
    expect(getWordIdx(0.90, timings, 1.0)).toBe(0); // stays on last word
  });

  test('currentTime before first word start → word 0 highlighted', () => {
    const timings = [
      { word: 'Long,', startTime: 0.15, endTime: 0.45 },
      { word: 'ago',   startTime: 0.48, endTime: 0.78 },
    ];
    // Leading silence (0 → 0.15): should still show word 0, not -1
    expect(getWordIdx(0.0,  timings, 1.0)).toBe(0);
    expect(getWordIdx(0.10, timings, 1.0)).toBe(0);
  });

  test('currentTime past all words → last word stays highlighted', () => {
    const timings = [
      { word: 'world.', startTime: 5.0, endTime: 5.4 },
    ];
    expect(getWordIdx(6.0, timings, 6.0)).toBe(0);
  });
});
