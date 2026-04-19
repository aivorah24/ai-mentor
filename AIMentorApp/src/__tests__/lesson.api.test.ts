/**
 * Unit Tests — Lesson API
 * Tests /lesson/script and /lesson/tts endpoints.
 */

const SERVER_URL = 'http://localhost:3001';

global.fetch = jest.fn();

function mockFetch(data: object, ok = true) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  });
}

interface Scene {
  emotion: 'happy' | 'excited' | 'thinking' | 'celebrating' | 'surprised' | 'questioning';
  text: string;
  duration: number;
  visual?: string;
}

async function fetchLessonScript(topic: string, grade: string): Promise<{ scenes: Scene[] }> {
  const res = await fetch(`${SERVER_URL}/lesson/script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, grade }),
  });
  if (!res.ok) throw new Error('Server error');
  return res.json();
}

async function fetchTTS(text: string): Promise<string | null> {
  try {
    const res = await fetch(`${SERVER_URL}/lesson/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const { audio } = await res.json();
    return audio;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Lesson API — /lesson/script', () => {
  beforeEach(() => jest.clearAllMocks());

  const mockScenes: Scene[] = [
    { emotion: 'excited', text: "Hello friends! Today we learn Addition!", duration: 4, visual: '🌟' },
    { emotion: 'happy', text: "Let's start with 2 + 3.", duration: 5, visual: '2+3=?' },
    { emotion: 'thinking', text: "Can you count with me? One, two... three, four, five!", duration: 5, visual: '🍎🍎🍎🍎🍎' },
    { emotion: 'celebrating', text: "Yes! 2 + 3 = 5. Well done!", duration: 4, visual: '🎉' },
  ];

  it('returns scenes array on success', async () => {
    mockFetch({ scenes: mockScenes });

    const data = await fetchLessonScript('Addition', 'Grade 3');

    expect(Array.isArray(data.scenes)).toBe(true);
    expect(data.scenes.length).toBeGreaterThan(0);
  });

  it('each scene has required fields: emotion, text, duration', async () => {
    mockFetch({ scenes: mockScenes });

    const data = await fetchLessonScript('Addition', 'Grade 3');

    data.scenes.forEach((scene: Scene) => {
      expect(scene).toHaveProperty('emotion');
      expect(scene).toHaveProperty('text');
      expect(scene).toHaveProperty('duration');
      expect(typeof scene.text).toBe('string');
      expect(scene.text.length).toBeGreaterThan(0);
      expect(scene.duration).toBeGreaterThanOrEqual(1);
    });
  });

  it('scene emotions are valid values', async () => {
    mockFetch({ scenes: mockScenes });

    const validEmotions = ['happy', 'excited', 'thinking', 'celebrating', 'surprised', 'questioning'];
    const data = await fetchLessonScript('Subtraction', 'Grade 3');

    data.scenes.forEach((scene: Scene) => {
      expect(validEmotions).toContain(scene.emotion);
    });
  });

  it('sends correct payload to server', async () => {
    mockFetch({ scenes: mockScenes });

    await fetchLessonScript('Fractions', 'Grade 4');

    expect(global.fetch).toHaveBeenCalledWith(
      `${SERVER_URL}/lesson/script`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ topic: 'Fractions', grade: 'Grade 4' }),
      })
    );
  });

  it('throws on server error', async () => {
    mockFetch({}, false);
    await expect(fetchLessonScript('Addition', 'Grade 3')).rejects.toThrow('Server error');
  });
});

describe('Lesson API — /lesson/tts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns base64 audio string on success', async () => {
    const fakeBase64 = 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYw';
    mockFetch({ audio: fakeBase64 });

    const audio = await fetchTTS('Hello friends!');

    expect(audio).toBe(fakeBase64);
  });

  it('returns null when server returns non-ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });

    const audio = await fetchTTS('Hello');

    expect(audio).toBeNull();
  });

  it('returns null on network failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const audio = await fetchTTS('Hello');

    expect(audio).toBeNull();
  });

  it('sends text in request body', async () => {
    mockFetch({ audio: 'abc123' });

    await fetchTTS('Welcome to Ms. Zara class!');

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.text).toBe('Welcome to Ms. Zara class!');
  });
});
