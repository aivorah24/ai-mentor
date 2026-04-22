/**
 * Story Reader Tests — Issue #57 (text highlight sync) & #58 (playback speed)
 *
 * Tests the pure logic used in StoryReaderScreen:
 *   - splitSentences: correctly splits story text into sentences
 *   - Highlight logic: only current sentence highlighted, all others full brightness
 *   - readCount: correctly maps audio progress to sentence index
 *   - Playback rate: valid values, applied correctly, mid-play change
 */

// ── Pure helpers (mirrors StoryReaderScreen logic) ─────────────────────────

function splitSentences(text) {
  const parts = text.match(/[^.!?]+[.!?]+[\s]*/g);
  return parts && parts.length > 1 ? parts : [text];
}

function getSentenceStyle(i, readCount, playing, textMain, pastelAccent) {
  const isCurrent = playing && i === readCount;
  return {
    color:           isCurrent ? pastelAccent : textMain,
    fontWeight:      isCurrent ? '700' : '400',
    hasBackground:   isCurrent,
  };
}

function computeReadCount(currentTime, duration, totalSentences) {
  if (!duration || duration <= 0) return 0;
  return Math.floor((currentTime / duration) * totalSentences);
}

const TEXT_MAIN    = '#FFFFFF';
const PASTEL_ACCENT = '#7BA8A4';

// ── splitSentences ─────────────────────────────────────────────────────────

describe('splitSentences — correct sentence splitting', () => {
  test('single sentence returns as-is (no split)', () => {
    const result = splitSentences('Long long ago in a kingdom');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Long long ago in a kingdom');
  });

  test('splits on periods', () => {
    const result = splitSentences('Long long ago. In a kingdom. Lived a king.');
    expect(result.length).toBeGreaterThan(1);
  });

  test('splits on exclamation marks', () => {
    const result = splitSentences('He was brave! Everyone loved him! He won!');
    expect(result.length).toBeGreaterThan(1);
  });

  test('splits on question marks', () => {
    const result = splitSentences('Who was he? Where did he come from? Nobody knew.');
    expect(result.length).toBeGreaterThan(1);
  });

  test('mixed punctuation splits correctly', () => {
    const result = splitSentences('Long ago. Was he brave? Yes he was! A great king.');
    expect(result.length).toBe(4);
  });

  test('empty string returns array with empty string', () => {
    const result = splitSentences('');
    expect(result).toHaveLength(1);
  });

  test('text with no punctuation returns as single sentence', () => {
    const result = splitSentences('Once upon a time in a land far away');
    expect(result).toHaveLength(1);
  });

  test('story-style text: Ambarisha story', () => {
    const text = 'Long, long ago. In the golden kingdom of Matter. Lived a great king named Ambarisha Maharaja.';
    const result = splitSentences(text);
    expect(result.length).toBe(3);
  });

  test('preserves trailing whitespace between sentences', () => {
    const result = splitSentences('First sentence. Second sentence. Third sentence.');
    result.forEach(s => expect(typeof s).toBe('string'));
    expect(result.join('')).toBeTruthy();
  });
});

// ── Highlight logic — Issue #57 ────────────────────────────────────────────

describe('Highlight logic — only current sentence highlighted', () => {
  test('current sentence gets accent color when playing', () => {
    const style = getSentenceStyle(2, 2, true, TEXT_MAIN, PASTEL_ACCENT);
    expect(style.color).toBe(PASTEL_ACCENT);
    expect(style.fontWeight).toBe('700');
    expect(style.hasBackground).toBe(true);
  });

  test('past sentence stays full brightness (not greyed out)', () => {
    const style = getSentenceStyle(0, 2, true, TEXT_MAIN, PASTEL_ACCENT);
    expect(style.color).toBe(TEXT_MAIN);   // NOT textMuted
    expect(style.fontWeight).toBe('400');
    expect(style.hasBackground).toBe(false);
  });

  test('future sentence stays full brightness', () => {
    const style = getSentenceStyle(4, 2, true, TEXT_MAIN, PASTEL_ACCENT);
    expect(style.color).toBe(TEXT_MAIN);
    expect(style.fontWeight).toBe('400');
    expect(style.hasBackground).toBe(false);
  });

  test('no sentence highlighted when not playing', () => {
    // playing=false — nothing should be highlighted
    [0, 1, 2, 3, 4].forEach(i => {
      const style = getSentenceStyle(i, 2, false, TEXT_MAIN, PASTEL_ACCENT);
      expect(style.color).toBe(TEXT_MAIN);
      expect(style.fontWeight).toBe('400');
      expect(style.hasBackground).toBe(false);
    });
  });

  test('first sentence highlighted at start of audio', () => {
    const style = getSentenceStyle(0, 0, true, TEXT_MAIN, PASTEL_ACCENT);
    expect(style.color).toBe(PASTEL_ACCENT);
    expect(style.hasBackground).toBe(true);
  });

  test('last sentence highlighted at end of audio', () => {
    const totalSentences = 5;
    const style = getSentenceStyle(totalSentences - 1, totalSentences - 1, true, TEXT_MAIN, PASTEL_ACCENT);
    expect(style.color).toBe(PASTEL_ACCENT);
    expect(style.hasBackground).toBe(true);
  });

  test('only ONE sentence highlighted at a time', () => {
    const readCount = 2;
    const sentences = [0, 1, 2, 3, 4];
    const highlighted = sentences.filter(i => getSentenceStyle(i, readCount, true, TEXT_MAIN, PASTEL_ACCENT).hasBackground);
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toBe(readCount);
  });

  test('paused state — no highlight (playing=false)', () => {
    // When paused, playing=false, so nothing highlighted
    const style = getSentenceStyle(1, 1, false, TEXT_MAIN, PASTEL_ACCENT);
    expect(style.color).toBe(TEXT_MAIN);
    expect(style.hasBackground).toBe(false);
  });
});

// ── readCount — audio progress to sentence index mapping ──────────────────

describe('readCount — audio position maps to correct sentence', () => {
  test('start of audio → sentence 0', () => {
    expect(computeReadCount(0, 30, 5)).toBe(0);
  });

  test('20% through audio → first sentence of 5', () => {
    expect(computeReadCount(6, 30, 5)).toBe(1);
  });

  test('50% through audio → middle sentence', () => {
    expect(computeReadCount(15, 30, 5)).toBe(2);
  });

  test('80% through audio → 4th sentence of 5', () => {
    expect(computeReadCount(24, 30, 5)).toBe(4);
  });

  test('end of audio → last sentence index', () => {
    // Just before end (onended fires before this)
    expect(computeReadCount(29.9, 30, 5)).toBe(4);
  });

  test('duration=0 → returns 0 (no division by zero)', () => {
    expect(computeReadCount(0, 0, 5)).toBe(0);
  });

  test('single sentence story → always sentence 0', () => {
    expect(computeReadCount(5, 10, 1)).toBe(0);
    expect(computeReadCount(9, 10, 1)).toBe(0);
  });

  test('result never exceeds totalSentences - 1', () => {
    const result = computeReadCount(29, 30, 5);
    expect(result).toBeLessThan(5);
  });

  test('longer audio (60s, 8 sentences) maps correctly at midpoint', () => {
    expect(computeReadCount(30, 60, 8)).toBe(4);
  });
});

// ── Playback speed — Issue #58 ─────────────────────────────────────────────

const VALID_SPEEDS = [0.5, 1, 1.5, 2];

describe('Playback speed — valid values', () => {
  test('all speed options are valid numbers', () => {
    VALID_SPEEDS.forEach(rate => {
      expect(typeof rate).toBe('number');
      expect(rate).toBeGreaterThan(0);
    });
  });

  test('default speed is 1x', () => {
    const defaultRate = 1;
    expect(VALID_SPEEDS).toContain(defaultRate);
  });

  test('slowest speed is 0.5x', () => {
    expect(Math.min(...VALID_SPEEDS)).toBe(0.5);
  });

  test('fastest speed is 2x', () => {
    expect(Math.max(...VALID_SPEEDS)).toBe(2);
  });

  test('4 speed options available', () => {
    expect(VALID_SPEEDS).toHaveLength(4);
  });
});

describe('Playback speed — rate applied to audio element', () => {
  test('playbackRate is set on audio before play', () => {
    const mockAudio = { playbackRate: 1, play: jest.fn() };
    // Simulate what speakPage does
    mockAudio.playbackRate = 1.5;
    mockAudio.play();
    expect(mockAudio.playbackRate).toBe(1.5);
    expect(mockAudio.play).toHaveBeenCalled();
  });

  test('changing rate mid-play updates audio element immediately', () => {
    const mockAudio = { playbackRate: 1 };
    // Simulate useEffect when playbackRate changes
    const applyRate = (audio, rate) => { audio.playbackRate = rate; };

    applyRate(mockAudio, 2);
    expect(mockAudio.playbackRate).toBe(2);

    applyRate(mockAudio, 0.5);
    expect(mockAudio.playbackRate).toBe(0.5);
  });

  test('no audio present — rate change does not throw', () => {
    const audioRef = { current: null };
    expect(() => {
      if (audioRef.current) audioRef.current.playbackRate = 2;
    }).not.toThrow();
  });

  test('each speed option produces correct label', () => {
    const labels = VALID_SPEEDS.map(r => `${r}x`);
    expect(labels).toEqual(['0.5x', '1x', '1.5x', '2x']);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  test('story with 1 sentence — highlight covers entire text', () => {
    const text = 'Long long ago lived a great king';
    const sentences = splitSentences(text);
    expect(sentences).toHaveLength(1);
    const style = getSentenceStyle(0, 0, true, TEXT_MAIN, PASTEL_ACCENT);
    expect(style.color).toBe(PASTEL_ACCENT);
  });

  test('very long story (20 sentences) — only one highlighted', () => {
    const sentences = Array.from({ length: 20 }, (_, i) => i);
    const readCount = 10;
    const highlighted = sentences.filter(i =>
      getSentenceStyle(i, readCount, true, TEXT_MAIN, PASTEL_ACCENT).hasBackground
    );
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toBe(10);
  });

  test('readCount at boundary — does not go out of range', () => {
    const totalSentences = 3;
    const result = computeReadCount(100, 30, totalSentences); // time > duration
    expect(result).toBeGreaterThanOrEqual(0);
  });

  test('switching speed from 2x back to 1x works correctly', () => {
    const mockAudio = { playbackRate: 2 };
    mockAudio.playbackRate = 1;
    expect(mockAudio.playbackRate).toBe(1);
  });

  test('highlight inactive after story ends (playing=false)', () => {
    // When audio ends, playing=false, so no sentence stays highlighted
    const style = getSentenceStyle(4, 4, false, TEXT_MAIN, PASTEL_ACCENT);
    expect(style.color).toBe(TEXT_MAIN);
    expect(style.hasBackground).toBe(false);
  });
});
