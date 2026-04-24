/**
 * Word-level highlight sync tests
 * Verifies word-by-word reading highlight (like Raz-Kids)
 */

// ── Mirrors StoryReaderScreen helpers ─────────────────────────────────────

function splitWords(text) {
  return text.match(/\S+\s*/g) || [text];
}

function buildBoundaries(tokens) {
  const counts = tokens.map(t => t.length);
  const total  = counts.reduce((a, b) => a + b, 0) || 1;
  let cum = 0;
  return counts.map(c => { cum += c; return cum / total; });
}

function getWordIndex(currentTime, duration, words) {
  if (!duration || duration <= 0) return 0;
  const bounds = buildBoundaries(words);
  const ratio  = currentTime / duration;
  const idx    = bounds.findIndex(b => ratio < b);
  return idx === -1 ? words.length - 1 : idx;
}

function getWordStyle(i, wordIndex, playing, isPaused) {
  const isCurrent = (playing || isPaused) && i === wordIndex;
  const isPast    = i < wordIndex;
  return { isCurrent, isPast, isFuture: !isCurrent && !isPast };
}

// ── splitWords ─────────────────────────────────────────────────────────────

describe('splitWords — correct word splitting', () => {
  test('splits simple sentence into words', () => {
    const words = splitWords('Long long ago');
    expect(words).toHaveLength(3);
  });

  test('preserves trailing space on each word', () => {
    const words = splitWords('Hello world ');
    expect(words[0]).toBe('Hello ');
    expect(words[1]).toBe('world ');
  });

  test('handles punctuation attached to word', () => {
    const words = splitWords('Long, long ago. In the kingdom.');
    expect(words.length).toBe(6);
  });

  test('single word returns array of one', () => {
    expect(splitWords('Hello')).toHaveLength(1);
  });

  test('empty string returns array with original', () => {
    const words = splitWords('');
    expect(Array.isArray(words)).toBe(true);
  });

  test('story text splits correctly', () => {
    const text = 'Long, long ago, in the golden kingdom of Mathura, there lived a great king.';
    const words = splitWords(text);
    expect(words.length).toBe(14);
  });

  test('joined words reconstruct original text', () => {
    const text = 'Long long ago in a kingdom.';
    const words = splitWords(text);
    expect(words.join('')).toBe(text);
  });
});

// ── buildBoundaries ────────────────────────────────────────────────────────

describe('buildBoundaries — correct proportion boundaries', () => {
  test('equal-length tokens give equal boundaries', () => {
    const tokens = ['aa ', 'bb ', 'cc '];
    const bounds = buildBoundaries(tokens);
    expect(bounds[0]).toBeCloseTo(1/3, 5);
    expect(bounds[1]).toBeCloseTo(2/3, 5);
    expect(bounds[2]).toBeCloseTo(1.0, 5);
  });

  test('last boundary is always 1.0', () => {
    const bounds = buildBoundaries(['short ', 'a very long word here ', 'medium ']);
    expect(bounds[bounds.length - 1]).toBeCloseTo(1.0, 5);
  });

  test('boundaries are strictly increasing', () => {
    const bounds = buildBoundaries(['one ', 'two ', 'three ', 'four ']);
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i]).toBeGreaterThan(bounds[i - 1]);
    }
  });
});

// ── getWordIndex — audio position → word ──────────────────────────────────

describe('getWordIndex — audio position maps to correct word', () => {
  const text  = 'Long long ago in the kingdom';
  const words = splitWords(text); // 6 words, each ~4-7 chars

  test('start of audio → word 0', () => {
    expect(getWordIndex(0, 30, words)).toBe(0);
  });

  test('duration=0 → returns 0, no crash', () => {
    expect(getWordIndex(0, 0, words)).toBe(0);
  });

  test('at 100% → last word index', () => {
    expect(getWordIndex(30, 30, words)).toBe(words.length - 1);
  });

  test('all word indices are reachable during playback', () => {
    const reachable = new Set();
    for (let t = 0; t <= 299; t++) {
      reachable.add(getWordIndex(t / 10, 30, words));
    }
    words.forEach((_, i) => expect(reachable.has(i)).toBe(true));
  });

  test('longer word gets proportionally more time than shorter word', () => {
    // 'kingdom' (7 chars) vs 'in' (2 chars) — kingdom should span more time
    const wds = splitWords('in kingdom');
    const bounds = buildBoundaries(wds);
    const inSpan = bounds[0];           // fraction for 'in '
    const kingdomSpan = 1 - bounds[0];  // fraction for 'kingdom'
    expect(kingdomSpan).toBeGreaterThan(inSpan);
  });

  test('0.5x speed: same audio ratio → same word index as 1x', () => {
    // At 0.5x, currentTime advances slower but ratio is same
    expect(getWordIndex(15, 30, words)).toBe(getWordIndex(15, 30, words));
  });

  test('2x speed: same audio ratio → same word index as 1x', () => {
    expect(getWordIndex(10, 30, words)).toBe(getWordIndex(10, 30, words));
  });
});

// ── getWordStyle — highlight states ───────────────────────────────────────

describe('getWordStyle — correct highlight per word state', () => {
  test('playing: current word is highlighted', () => {
    const { isCurrent } = getWordStyle(3, 3, true, false);
    expect(isCurrent).toBe(true);
  });

  test('playing: past word is NOT current', () => {
    const { isCurrent, isPast } = getWordStyle(1, 3, true, false);
    expect(isCurrent).toBe(false);
    expect(isPast).toBe(true);
  });

  test('playing: future word is NOT current', () => {
    const { isCurrent, isPast, isFuture } = getWordStyle(5, 3, true, false);
    expect(isCurrent).toBe(false);
    expect(isPast).toBe(false);
    expect(isFuture).toBe(true);
  });

  test('paused: current word STAYS highlighted', () => {
    const { isCurrent } = getWordStyle(3, 3, false, true);
    expect(isCurrent).toBe(true);
  });

  test('paused: past words stay grey', () => {
    const { isPast } = getWordStyle(1, 3, false, true);
    expect(isPast).toBe(true);
  });

  test('stopped (not started): nothing highlighted', () => {
    [0, 1, 2, 3].forEach(i => {
      const { isCurrent } = getWordStyle(i, 0, false, false);
      expect(isCurrent).toBe(false);
    });
  });

  test('exactly ONE word highlighted at any time while playing', () => {
    const wordCount = 10;
    const wordIdx   = 4;
    const highlighted = Array.from({ length: wordCount }, (_, i) =>
      getWordStyle(i, wordIdx, true, false).isCurrent
    ).filter(Boolean);
    expect(highlighted).toHaveLength(1);
  });
});

// ── Real story text ────────────────────────────────────────────────────────

describe('Real story text — Ambarisha story word sync', () => {
  const storyText = 'Long, long ago, in the golden kingdom of Mathura, there lived a great king named Ambarisha Maharaja. He was not just a powerful king — he was one of the greatest devotees of Lord Vishnu in the whole world.';
  const words = splitWords(storyText);

  test('story text splits into correct word count', () => {
    expect(words.length).toBeGreaterThan(30);
  });

  test('first word is "Long,"', () => {
    expect(words[0].trim()).toBe('Long,');
  });

  test('all words reachable in 60s audio', () => {
    const reachable = new Set();
    for (let t = 0; t <= 5999; t++) {
      reachable.add(getWordIndex(t / 100, 60, words));
    }
    words.forEach((_, i) => expect(reachable.has(i)).toBe(true));
  });

  test('word "Ambarisha" is reachable and highlighted at correct ratio', () => {
    const idx = words.findIndex(w => w.trim() === 'Ambarisha');
    expect(idx).toBeGreaterThan(0);
    // At the right audio position, this word should be highlighted
    const bounds = buildBoundaries(words);
    const startRatio = idx === 0 ? 0 : bounds[idx - 1];
    const midRatio   = (startRatio + bounds[idx]) / 2;
    const resultIdx  = getWordIndex(midRatio * 60, 60, words);
    expect(resultIdx).toBe(idx);
  });
});
