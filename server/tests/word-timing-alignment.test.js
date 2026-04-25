/**
 * Word timing alignment tests
 * Verifies alignmentToWordTimings correctly maps
 * ElevenLabs character-level data → per-word start/end times.
 */

// ── Mirror of server/routes/stories.js alignmentToWordTimings ─────────────

function alignmentToWordTimings(text, alignment) {
  if (!alignment || !alignment.characters) return null;
  const chars  = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends   = alignment.character_end_times_seconds;
  if (!chars.length || !starts.length) return null;

  const wordTimings = [];
  const words = text.match(/\S+/g) || [];
  let ai = 0;

  for (const word of words) {
    while (ai < chars.length && chars[ai] === ' ') ai++;
    const wordStartAi = ai;
    let lettersMatched = 0;
    while (ai < chars.length && lettersMatched < word.length) {
      if (chars[ai] !== ' ') lettersMatched++;
      ai++;
    }
    const wordEndAi = Math.min(ai - 1, chars.length - 1);
    const startTime = starts[wordStartAi] ?? 0;
    const endTime   = ends[wordEndAi]     ?? startTime + 0.1;
    wordTimings.push({ word, startTime, endTime });
  }
  return wordTimings;
}

// ── Mock ElevenLabs alignment builder ─────────────────────────────────────
// Simulates what ElevenLabs actually returns for a given text + per-word durations

function buildMockAlignment(text, wordDurations) {
  const chars   = [];
  const starts  = [];
  const ends    = [];
  const words   = text.match(/\S+/g) || [];
  let t = 0;
  let wordIdx = 0;

  for (let ci = 0; ci < text.length; ci++) {
    const ch = text[ci];
    if (ch === ' ') {
      chars.push(' ');
      starts.push(t);
      ends.push(t);
    } else {
      // Find which word this char belongs to
      const word = words[wordIdx] || '';
      const dur  = wordDurations[wordIdx] || 0.3;
      const charDur = dur / word.length;

      chars.push(ch);
      starts.push(parseFloat(t.toFixed(4)));
      ends.push(parseFloat((t + charDur).toFixed(4)));
      t += charDur;

      // Move to next word when we've consumed all its chars
      if (ci + 1 < text.length && text[ci + 1] === ' ') {
        wordIdx++;
      }
    }
  }
  return { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends };
}

// ── Basic correctness ──────────────────────────────────────────────────────

describe('alignmentToWordTimings — basic correctness', () => {
  test('returns null for missing alignment', () => {
    expect(alignmentToWordTimings('hello world', null)).toBeNull();
    expect(alignmentToWordTimings('hello world', {})).toBeNull();
  });

  test('returns null for empty characters array', () => {
    expect(alignmentToWordTimings('hello', {
      characters: [], character_start_times_seconds: [], character_end_times_seconds: []
    })).toBeNull();
  });

  test('single word — correct timing', () => {
    const alignment = buildMockAlignment('Hello', [0.4]);
    const result = alignmentToWordTimings('Hello', alignment);
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe('Hello');
    expect(result[0].startTime).toBeCloseTo(0, 2);
    expect(result[0].endTime).toBeGreaterThan(0);
  });

  test('two words — each gets correct start time', () => {
    const alignment = buildMockAlignment('Long ago', [0.3, 0.4]);
    const result = alignmentToWordTimings('Long ago', alignment);
    expect(result).toHaveLength(2);
    expect(result[0].word).toBe('Long');
    expect(result[1].word).toBe('ago');
    expect(result[0].startTime).toBeCloseTo(0, 2);
    expect(result[1].startTime).toBeGreaterThan(result[0].startTime);
  });

  test('word count matches text word count', () => {
    const text = 'Long long ago in the kingdom';
    const durs  = [0.3, 0.3, 0.3, 0.2, 0.2, 0.5];
    const alignment = buildMockAlignment(text, durs);
    const result = alignmentToWordTimings(text, alignment);
    expect(result).toHaveLength(6);
  });

  test('words are in correct order', () => {
    const text = 'one two three';
    const alignment = buildMockAlignment(text, [0.3, 0.3, 0.4]);
    const result = alignmentToWordTimings(text, alignment);
    expect(result[0].word).toBe('one');
    expect(result[1].word).toBe('two');
    expect(result[2].word).toBe('three');
  });

  test('start times are strictly increasing', () => {
    const text = 'Long long ago in the golden kingdom';
    const durs  = [0.3, 0.3, 0.35, 0.2, 0.2, 0.4, 0.5];
    const alignment = buildMockAlignment(text, durs);
    const result = alignmentToWordTimings(text, alignment);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].startTime).toBeGreaterThan(result[i-1].startTime);
    }
  });
});

// ── The specific bug: "in the golden kingdom" vs "Mathura" ───────────────

describe('Ambarisha story — audio says "in the golden kingdom" highlights "Mathura"', () => {
  // "Long, long ago, in the golden kingdom of Mathura,"
  // Words:  Long,  long  ago,   in   the  golden kingdom  of  Mathura,
  // Index:   0      1     2      3    4     5       6       7     8
  const text = 'Long, long ago, in the golden kingdom of Mathura,';
  // Simulate realistic TTS durations (ms converted to seconds)
  const wordDurations = [0.35, 0.28, 0.32, 0.18, 0.15, 0.38, 0.45, 0.15, 0.55];

  let timings;
  beforeAll(() => {
    const alignment = buildMockAlignment(text, wordDurations);
    timings = alignmentToWordTimings(text, alignment);
  });

  test('produces 9 word timings', () => {
    expect(timings).toHaveLength(9);
  });

  test('"in" (word 3) starts after "ago," ends before "the"', () => {
    expect(timings[3].word).toBe('in');
    expect(timings[3].startTime).toBeGreaterThan(timings[2].startTime);
    expect(timings[3].startTime).toBeLessThan(timings[4].startTime);
  });

  test('"golden" (word 5) highlighted when audio is at its time — NOT at Mathura time', () => {
    const goldenTiming = timings[5]; // "golden"
    const mathuraTiming = timings[8]; // "Mathura,"
    // At golden's start time, word index should be 5, not 8
    const t = (goldenTiming.startTime + goldenTiming.endTime) / 2;
    const highlighted = timings.findIndex((w, i) => {
      const end = timings[i + 1]?.startTime ?? 999;
      return t >= w.startTime && t < end;
    });
    expect(highlighted).toBe(5);   // "golden" highlighted
    expect(highlighted).not.toBe(8); // NOT "Mathura,"
  });

  test('"Mathura," (word 8) only highlighted when audio reaches its time', () => {
    const mathuraTiming = timings[8];
    const t = mathuraTiming.startTime + 0.05;
    const highlighted = timings.findIndex((w, i) => {
      const end = timings[i + 1]?.startTime ?? 999;
      return t >= w.startTime && t < end;
    });
    expect(highlighted).toBe(8);
  });

  test('NO two different words are highlighted at same audio time', () => {
    // At every 50ms step through the audio, only one word should match
    const totalDur = timings[timings.length - 1].endTime;
    for (let ms = 0; ms <= totalDur * 1000; ms += 50) {
      const t = ms / 1000;
      const matches = timings.filter((w, i) => {
        const end = timings[i + 1]?.startTime ?? 999;
        return t >= w.startTime && t < end;
      });
      expect(matches.length).toBeLessThanOrEqual(1);
    }
  });
});

// ── Punctuation handling ───────────────────────────────────────────────────

describe('Punctuation attached to words', () => {
  test('"Long," treated as one token with correct timing', () => {
    const text = 'Long, long ago.';
    const alignment = buildMockAlignment(text, [0.35, 0.28, 0.40]);
    const result = alignmentToWordTimings(text, alignment);
    expect(result[0].word).toBe('Long,');
    expect(result[2].word).toBe('ago.');
    expect(result[2].startTime).toBeGreaterThan(result[1].startTime);
  });
});

// ── ontimeupdate simulation ────────────────────────────────────────────────

describe('ontimeupdate — word index selected correctly from timings', () => {
  function getWordIdxFromTimings(currentTime, timings, totalDuration) {
    const idx = timings.findIndex((w, i) => {
      const end = timings[i + 1]?.startTime ?? (totalDuration + 1);
      return currentTime >= w.startTime && currentTime < end;
    });
    return idx === -1 ? timings.length - 1 : idx;
  }

  const text = 'Long long ago in the kingdom';
  const durs  = [0.3, 0.3, 0.3, 0.2, 0.2, 0.5];
  const alignment = buildMockAlignment(text, durs);
  const timings = alignmentToWordTimings(text, alignment);
  const totalDur = timings[timings.length - 1].endTime;

  test('at t=0 → word 0 "Long"', () => {
    expect(getWordIdxFromTimings(0, timings, totalDur)).toBe(0);
  });

  test('at "ago" start time → word index 2', () => {
    const t = timings[2].startTime + 0.01;
    expect(getWordIdxFromTimings(t, timings, totalDur)).toBe(2);
  });

  test('at "kingdom" time → last word highlighted', () => {
    const t = timings[5].startTime + 0.1;
    expect(getWordIdxFromTimings(t, timings, totalDur)).toBe(5);
  });

  test('all 6 words are reached during playback', () => {
    const reached = new Set();
    for (let ms = 0; ms <= totalDur * 1000; ms += 10) {
      reached.add(getWordIdxFromTimings(ms / 1000, timings, totalDur));
    }
    [0, 1, 2, 3, 4, 5].forEach(i => expect(reached.has(i)).toBe(true));
  });

  test('word index never goes backwards', () => {
    let prev = -1;
    for (let ms = 0; ms <= totalDur * 1000; ms += 10) {
      const idx = getWordIdxFromTimings(ms / 1000, timings, totalDur);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });
});
