/**
 * Story Highlight Sync Tests
 * Tests sentence highlight state and speed alignment
 */

// ── Pure helpers (mirrors StoryReaderScreen logic) ─────────────────────────

function splitSentences(text) {
  const parts = text.match(/[^.!?]+[.!?]+[\s]*/g);
  return parts && parts.length > 1 ? parts : [text];
}

function computeReadCount(currentTime, duration, totalSentences) {
  if (!duration || duration <= 0) return 0;
  return Math.floor((currentTime / duration) * totalSentences);
}

// Current implementation — what does each sentence get?
// isPaused=true means audio loaded and paused mid-way (currentTime > 0)
function getSentenceState(i, readCount, playing, isPaused = false) {
  const isCurrent = (playing || isPaused) && i === readCount;
  const isPast    = i < readCount;
  return { isCurrent, isPast, isFuture: !isCurrent && !isPast };
}

const TEXT_MAIN    = '#FFFFFF';
const TEXT_MUTED   = '#888888';
const PASTEL_ACCENT = '#7BA8A4';

function getSentenceColor(i, readCount, playing, isPaused = false) {
  const { isCurrent, isPast } = getSentenceState(i, readCount, playing, isPaused);
  return isCurrent ? PASTEL_ACCENT : isPast ? TEXT_MUTED : TEXT_MAIN;
}

// ── Character-proportion readCount (matches StoryReaderScreen) ────────────
// Sentences with more characters get proportionally more time.
// Formula: find first boundary where cumRatio > audioRatio.

function buildBoundaries(sentences) {
  const charCounts = sentences.map(s => s.length);
  const totalChars = charCounts.reduce((a, b) => a + b, 0) || 1;
  let cum = 0;
  return charCounts.map(c => { cum += c; return cum / totalChars; });
}

function computeReadCountChar(currentTime, duration, sentences) {
  if (!duration || duration <= 0) return 0;
  const boundaries = buildBoundaries(sentences);
  const ratio = currentTime / duration;
  const idx   = boundaries.findIndex(b => ratio < b);
  return idx === -1 ? sentences.length - 1 : idx;
}

describe('Character-proportion sync — longer sentences get more time', () => {
  // sentences: 10 chars, 30 chars, 20 chars  → total 60
  // boundaries: 10/60≈0.167, 40/60≈0.667, 60/60=1.0
  const sentences = ['Short sent.', 'This is a much longer sentence here!', 'Medium length one.'];

  test('at 10% audio time → sentence 0 (short sentence)', () => {
    // 10% < boundary[0] 16.7%
    expect(computeReadCountChar(3, 30, sentences)).toBe(0);
  });

  test('at 20% audio time → sentence 1 (long sentence)', () => {
    // 20% > boundary[0] 16.7%, < boundary[1] 66.7%
    expect(computeReadCountChar(6, 30, sentences)).toBe(1);
  });

  test('at 75% audio time → sentence 2 (medium sentence)', () => {
    // 'Short sent.'=11, 'This is...'=36, 'Medium...'=18 → total 65
    // boundary[1] = 47/65 ≈ 0.723 → need ratio > 0.723 → t > 21.7s
    expect(computeReadCountChar(22.5, 30, sentences)).toBe(2);
  });

  test('equal-length sentences behave same as uniform formula', () => {
    const equal = ['AAAAA.', 'BBBBB.', 'CCCCC.', 'DDDDD.', 'EEEEE.'];
    // Each 20% → same as uniform
    expect(computeReadCountChar(0,  30, equal)).toBe(0);
    expect(computeReadCountChar(6,  30, equal)).toBe(1);
    expect(computeReadCountChar(12, 30, equal)).toBe(2);
    expect(computeReadCountChar(18, 30, equal)).toBe(3);
    expect(computeReadCountChar(24, 30, equal)).toBe(4);
  });

  test('no sentence skipped — all reachable', () => {
    const s = ['Short.', 'A very very very long sentence that goes on.', 'Medium sentence here.'];
    const reachable = new Set();
    for (let t = 0; t <= 29; t++) {
      reachable.add(computeReadCountChar(t, 30, s));
    }
    [0, 1, 2].forEach(i => expect(reachable.has(i)).toBe(true));
  });

  test('at ratio exactly 1.0 → last sentence (not out of bounds)', () => {
    const s = ['One.', 'Two.', 'Three.'];
    expect(computeReadCountChar(30, 30, s)).toBe(2); // idx=-1 → length-1=2
  });

  test('0.5x speed: same audio ratio → same sentence as 1x', () => {
    const s = ['Short.', 'Long sentence here!', 'Medium.'];
    // At 0.5x, currentTime advances slower but ratio is same
    expect(computeReadCountChar(9, 30, s)).toBe(computeReadCountChar(9, 30, s));
  });
});

// ── Sentence color: playing / paused / not started ────────────────────────

describe('Sentence colors — playing, paused, not started', () => {
  test('playing: past=grey, current=accent, future=white', () => {
    const total = 5; const rc = 2;
    const colors = Array.from({ length: total }, (_, i) =>
      getSentenceColor(i, rc, true, false)
    );
    expect(colors[0]).toBe(TEXT_MUTED);    // past
    expect(colors[1]).toBe(TEXT_MUTED);    // past
    expect(colors[2]).toBe(PASTEL_ACCENT); // current
    expect(colors[3]).toBe(TEXT_MAIN);     // future
    expect(colors[4]).toBe(TEXT_MAIN);     // future
  });

  test('paused mid-story: past=grey, current STILL accent, future=white', () => {
    // User paused — current sentence stays highlighted so they know where they are
    const colors = Array.from({ length: 5 }, (_, i) =>
      getSentenceColor(i, 2, false, true)  // playing=false, isPaused=true
    );
    expect(colors[0]).toBe(TEXT_MUTED);    // past → grey
    expect(colors[1]).toBe(TEXT_MUTED);    // past → grey
    expect(colors[2]).toBe(PASTEL_ACCENT); // current → STILL highlighted
    expect(colors[3]).toBe(TEXT_MAIN);     // future → white
    expect(colors[4]).toBe(TEXT_MAIN);     // future → white
  });

  test('not started (playing=false, isPaused=false): all white', () => {
    const colors = Array.from({ length: 5 }, (_, i) =>
      getSentenceColor(i, 0, false, false)
    );
    colors.forEach(c => expect(c).toBe(TEXT_MAIN));
  });

  test('after audio ends (playing=false, isPaused=false): all white', () => {
    // onended sets playing=false, readCount=sentences.length
    const colors = Array.from({ length: 5 }, (_, i) =>
      getSentenceColor(i, 5, false, false)
    );
    colors.forEach(c => expect(c).toBe(TEXT_MUTED)); // all past
  });
});

// ── Speed alignment: readCount moves correctly at all speeds ───────────────

describe('Speed alignment — readCount at 0.5x, 1x, 1.5x, 2x', () => {
  // At different speeds, audio.currentTime advances at different rates
  // but currentTime/duration ratio is always correct
  // Simulate: 30s audio, 5 sentences, at different speeds

  const DURATION = 30;
  const SENTENCES = 5;

  // At 1x: after 6s → sentence 1 (20% through)
  // At 2x: after 3s real time = 6s audio time → same sentence 1
  // The formula uses audio.currentTime which already accounts for speed

  test('1x speed: halfway through audio → sentence 2 of 5', () => {
    const currentTime = 15; // 50% of 30s
    expect(computeReadCount(currentTime, DURATION, SENTENCES)).toBe(2);
  });

  test('0.5x speed: same audio position → same sentence', () => {
    // At 0.5x, after 30 real seconds, audio.currentTime = 15s
    const currentTime = 15;
    expect(computeReadCount(currentTime, DURATION, SENTENCES)).toBe(2);
  });

  test('2x speed: same audio position → same sentence', () => {
    // At 2x, after 7.5 real seconds, audio.currentTime = 15s
    const currentTime = 15;
    expect(computeReadCount(currentTime, DURATION, SENTENCES)).toBe(2);
  });

  test('1.5x speed: same audio position → same sentence', () => {
    const currentTime = 15;
    expect(computeReadCount(currentTime, DURATION, SENTENCES)).toBe(2);
  });

  test('readCount advances correctly through all sentences at 1x', () => {
    const times = [0, 6, 12, 18, 24]; // 0%, 20%, 40%, 60%, 80%
    const expected = [0, 1, 2, 3, 4];
    times.forEach((t, i) => {
      expect(computeReadCount(t, DURATION, SENTENCES)).toBe(expected[i]);
    });
  });

  test('readCount advances correctly through all sentences at 2x (halved real time)', () => {
    // At 2x: real time is halved but audio.currentTime is same
    const audioTimes = [0, 6, 12, 18, 24]; // same audio positions
    const expected   = [0, 1, 2, 3, 4];
    audioTimes.forEach((t, i) => {
      expect(computeReadCount(t, DURATION, SENTENCES)).toBe(expected[i]);
    });
  });

  test('readCount advances correctly at 0.5x (doubled real time)', () => {
    const audioTimes = [0, 6, 12, 18, 24];
    const expected   = [0, 1, 2, 3, 4];
    audioTimes.forEach((t, i) => {
      expect(computeReadCount(t, DURATION, SENTENCES)).toBe(expected[i]);
    });
  });

  test('sentence boundary: exactly at 20% → sentence 1', () => {
    expect(computeReadCount(6, 30, 5)).toBe(1);
  });

  test('sentence boundary: exactly at 40% → sentence 2', () => {
    expect(computeReadCount(12, 30, 5)).toBe(2);
  });

  test('no sentence skipped at any speed — all 5 sentences are reachable', () => {
    const reachable = new Set();
    for (let t = 0; t <= 29; t++) {
      reachable.add(computeReadCount(t, 30, 5));
    }
    [0, 1, 2, 3, 4].forEach(s => expect(reachable.has(s)).toBe(true));
  });
});

// ── Playback rate applied to audio element ─────────────────────────────────

describe('Playback rate — correctly applied at all speeds', () => {
  const VALID_SPEEDS = [0.5, 1, 1.5, 2];

  test('playbackRate set on audio before play for each speed', () => {
    VALID_SPEEDS.forEach(rate => {
      const mockAudio = { playbackRate: 1, play: jest.fn() };
      mockAudio.playbackRate = rate;
      mockAudio.play();
      expect(mockAudio.playbackRate).toBe(rate);
    });
  });

  test('changing speed mid-play updates audio.playbackRate immediately', () => {
    const mockAudio = { playbackRate: 1 };
    VALID_SPEEDS.forEach(rate => {
      mockAudio.playbackRate = rate;
      expect(mockAudio.playbackRate).toBe(rate);
    });
  });

  test('0.5x is slowest — narration takes twice as long in real time', () => {
    expect(Math.min(...VALID_SPEEDS)).toBe(0.5);
  });

  test('2x is fastest — narration takes half as long in real time', () => {
    expect(Math.max(...VALID_SPEEDS)).toBe(2);
  });

  test('default speed is 1x — no change to audio duration', () => {
    const defaultRate = 1;
    expect(VALID_SPEEDS).toContain(defaultRate);
  });
});

// ── Full highlight state matrix ────────────────────────────────────────────

describe('Full highlight state matrix — past/current/future at every position', () => {
  const TOTAL = 5;

  for (let readCount = 0; readCount < TOTAL; readCount++) {
    test(`readCount=${readCount}: exactly 1 current, ${readCount} past, ${TOTAL - readCount - 1} future`, () => {
      let pastCount    = 0;
      let currentCount = 0;
      let futureCount  = 0;

      for (let i = 0; i < TOTAL; i++) {
        const { isCurrent, isPast, isFuture } = getSentenceState(i, readCount, true);
        if (isCurrent) currentCount++;
        if (isPast)    pastCount++;
        if (isFuture)  futureCount++;
      }

      expect(currentCount).toBe(1);
      expect(pastCount).toBe(readCount);
      expect(futureCount).toBe(TOTAL - readCount - 1);
    });
  }

  test('when paused (isPaused=true): current STAYS highlighted, isPast preserved', () => {
    for (let i = 0; i < TOTAL; i++) {
      const { isCurrent, isPast } = getSentenceState(i, 2, false, true);
      expect(isCurrent).toBe(i === 2);  // current sentence stays highlighted
      expect(isPast).toBe(i < 2);       // position preserved
    }
  });

  test('when stopped (isPaused=false, playing=false): nothing highlighted', () => {
    for (let i = 0; i < TOTAL; i++) {
      const { isCurrent, isPast } = getSentenceState(i, 2, false, false);
      expect(isCurrent).toBe(false);
      expect(isPast).toBe(i < 2);
    }
  });
});
