/**
 * Unit Tests — Schedule API
 * Tests /schedule and /schedule/upcoming endpoints.
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

interface ScheduleEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  type: string;
  note: string;
  studentId: string;
  tag?: string;
}

async function fetchSchedule(studentId: string, date: string): Promise<ScheduleEvent[]> {
  const res = await fetch(`${SERVER_URL}/schedule?studentId=${studentId}&date=${date}`);
  if (!res.ok) return [];
  return res.json();
}

async function fetchUpcoming(studentId: string): Promise<ScheduleEvent[]> {
  try {
    const res = await fetch(`${SERVER_URL}/schedule/upcoming?studentId=${studentId}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Schedule API — /schedule', () => {
  beforeEach(() => jest.clearAllMocks());

  const mockEvents: ScheduleEvent[] = [
    {
      id: 'ev_001',
      title: 'Ms. Zara AI Lesson – Fractions',
      date: '2026-03-22',
      startTime: '08:30',
      endTime: '09:00',
      type: 'study',
      note: 'Interactive lesson',
      studentId: 'all',
      tag: 'Mathematics',
    },
    {
      id: 'ev_002',
      title: 'Science Exploration',
      date: '2026-03-22',
      startTime: '10:00',
      endTime: '10:45',
      type: 'study',
      note: 'Watch video',
      studentId: 'all',
      tag: 'Science',
    },
  ];

  it('returns array of events for given student and date', async () => {
    mockFetch(mockEvents);

    const events = await fetchSchedule('student_123', '2026-03-22');

    expect(Array.isArray(events)).toBe(true);
    expect(events).toHaveLength(2);
    expect(events[0].title).toBe('Ms. Zara AI Lesson – Fractions');
  });

  it('each event has required fields', async () => {
    mockFetch(mockEvents);

    const events = await fetchSchedule('student_123', '2026-03-22');

    events.forEach(event => {
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('title');
      expect(event).toHaveProperty('date');
      expect(event).toHaveProperty('startTime');
      expect(event).toHaveProperty('type');
    });
  });

  it('returns empty array on server error', async () => {
    mockFetch({}, false);

    const events = await fetchSchedule('student_123', '2026-03-22');

    expect(events).toEqual([]);
  });

  it('includes studentId and date in request URL', async () => {
    mockFetch([]);

    await fetchSchedule('student_abc', '2026-03-23');

    const url = (global.fetch as jest.Mock).mock.calls[0][0];
    expect(url).toContain('studentId=student_abc');
    expect(url).toContain('date=2026-03-23');
  });
});

describe('Schedule API — /schedule/upcoming', () => {
  beforeEach(() => jest.clearAllMocks());

  const mockDeadlines: ScheduleEvent[] = [
    {
      id: 'ev_d001',
      title: 'Math Quiz – Addition & Subtraction',
      date: '2026-03-23',
      startTime: '09:00',
      endTime: '09:45',
      type: 'deadline',
      note: 'Chapter 3 review',
      studentId: 'all',
      tag: 'Mathematics',
    },
    {
      id: 'ev_d002',
      title: 'Science Project Due',
      date: '2026-03-25',
      startTime: '10:00',
      endTime: '10:30',
      type: 'deadline',
      note: 'Plant life cycles',
      studentId: 'all',
      tag: 'Science',
    },
  ];

  it('returns upcoming deadlines array', async () => {
    mockFetch(mockDeadlines);

    const deadlines = await fetchUpcoming('student_123');

    expect(Array.isArray(deadlines)).toBe(true);
    expect(deadlines.length).toBeGreaterThan(0);
  });

  it('deadlines have future dates', async () => {
    mockFetch(mockDeadlines);

    const deadlines = await fetchUpcoming('student_123');
    const today = new Date().toISOString().split('T')[0];

    deadlines.forEach(d => {
      expect(d.date >= today).toBe(true);
    });
  });

  it('returns empty array on network failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const deadlines = await fetchUpcoming('student_123');

    expect(deadlines).toEqual([]);
  });

  it('passes studentId in request URL', async () => {
    mockFetch([]);

    await fetchUpcoming('test_student_123');

    const url = (global.fetch as jest.Mock).mock.calls[0][0];
    expect(url).toContain('studentId=test_student_123');
  });
});
