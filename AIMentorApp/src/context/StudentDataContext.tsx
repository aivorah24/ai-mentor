import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import SERVER_URL from '../config/serverUrl';
import { useAuth } from './AuthContext';

// Known email → fixed UUID map (bypasses /user/sync for seeded accounts)
const DEMO_IDS: Record<string, string> = {
  'alex@demo.com':    '00000000-0000-0000-0000-000000000001',
  'mia@demo.com':     '00000000-0000-0000-0000-000000000002',
  'student@demo.com': '00000000-0000-0000-0000-000000000001',
  // IB PYP test accounts (real Supabase UUIDs)
  'aanya@test.ai':    '106a2ac6-1e17-4fd7-a82c-7d8ded943100',
  'ishaan@test.ai':   '8cade9a5-8e27-414c-9087-d95e2ef37d5f',
  'rohan@test.ai':    '2ff12fbc-c676-4b10-a25f-bedabc1a7784',
  'diya@test.ai':     '6015c3bf-774a-4fd2-bf90-4da5b06fdc13',
  // NCERT test accounts
  'arjun@test.ai':    'aaaa0000-0000-0000-0000-000000000001',
  'priya@test.ai':    'aaaa0000-0000-0000-0000-000000000002',
  'rahul@test.ai':    'aaaa0000-0000-0000-0000-000000000003',
  'zara@test.ai':     'aaaa0000-0000-0000-0000-000000000004',
  'kavya@test.ai':    'aaaa0000-0000-0000-0000-000000000005',
};

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export interface StudentStats {
  studyTimeMinutes:    number;
  topicsExplored:      number;
  xpPoints:            number;
  level:               number;
  challengesCompleted: number;
  assignmentsDone:     number;
  currentStreak:       number;
  lastActiveDate:      string;
  todayStudyMinutes:   number;
  todayXP:             number;
  completedTopics:     string[];
  lastLesson:          string;
  totalTopics:         number;
}

interface StudentDataContextType {
  stats:             StudentStats;
  studentId:         string;
  addXP:             (xp: number) => void;
  exploreTopic:      () => void;
  completeLesson:    (topic: string) => void;
  completeChallenge: () => void;
  completeAssignment:() => void;
  recordStudyTime:   (minutes: number) => void;
}

// ─────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────

const ZERO_STATS: StudentStats = {
  studyTimeMinutes:    0,
  topicsExplored:      0,
  xpPoints:            0,
  level:               1,
  challengesCompleted: 0,
  assignmentsDone:     0,
  currentStreak:       0,
  lastActiveDate:      '',
  todayStudyMinutes:   0,
  todayXP:             0,
  completedTopics:     [],
  lastLesson:          '',
  totalTopics:         0,
};

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

export function computeLevel(xp: number): number {
  let level = 1, threshold = 500, total = 0;
  while (xp >= total + threshold) { total += threshold; threshold += 250; level++; }
  return level;
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

// Resolve the Supabase UUID for a logged-in user's email
async function resolveStudentId(email: string): Promise<string> {
  const key = `@student_id_${email}`;

  // 1. Demo shortcut
  if (DEMO_IDS[email]) return DEMO_IDS[email];

  // 2. Cached value
  const cached = await AsyncStorage.getItem(key);
  if (cached && cached.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return cached;
  }

  // 3. Sync with server → get real UUID
  try {
    const res = await fetch(`${SERVER_URL}/user/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role: 'student' }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.id) {
        await AsyncStorage.setItem(key, data.id);
        return data.id;
      }
    }
  } catch { /* offline — fall through */ }

  // 4. Last resort: generate stable offline ID from email hash
  const fallback = await AsyncStorage.getItem(key + '_offline');
  if (fallback) return fallback;
  const offlineId = '00000000-0000-0000-0000-' + [...email].reduce((a, c) => a + c.charCodeAt(0), 0).toString().padStart(12, '0');
  await AsyncStorage.setItem(key + '_offline', offlineId);
  return offlineId;
}

// ─────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────

const StudentDataContext = createContext<StudentDataContextType>({
  stats:             ZERO_STATS,
  studentId:         '',
  addXP:             () => {},
  exploreTopic:      () => {},
  completeLesson:    () => {},
  completeChallenge: () => {},
  completeAssignment:() => {},
  recordStudyTime:   () => {},
});

// ─────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────

export function StudentDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [stats,     setStats]     = useState<StudentStats>(ZERO_STATS);
  const [studentId, setStudentId] = useState('');
  const [loaded,    setLoaded]    = useState(false);

  // ── Load from server — re-run whenever logged-in email changes ──
  useEffect(() => {
    if (!user?.email) return;
    if (user?.role && user.role !== 'student') { setLoaded(true); return; }
    setLoaded(false);
    setStats(ZERO_STATS);

    async function init() {
      const id = await resolveStudentId(user!.email);
      setStudentId(id);
      try {
        const res = await fetch(`${SERVER_URL}/student/${id}`);
        if (res.ok) {
          const data = await res.json();
          setStats({ ...ZERO_STATS, ...data });
        }
      } catch {
        try {
          const raw = await AsyncStorage.getItem(`@stats_${id}`);
          if (raw) setStats({ ...ZERO_STATS, ...JSON.parse(raw) });
        } catch {}
      } finally {
        setLoaded(true);
      }
    }
    init();
  }, [user?.email]);

  // ── Sync to server whenever stats change ──────────────
  useEffect(() => {
    if (!loaded || !studentId) return;
    // Local backup
    AsyncStorage.setItem(`@stats_${studentId}`, JSON.stringify(stats)).catch(() => {});
    // Server sync (fire-and-forget)
    fetch(`${SERVER_URL}/student/${studentId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(stats),
    }).catch(() => {});
  }, [stats, loaded, studentId]);

  // Study time is tracked only in VideoLessonScreen (via recordStudyTime),
  // not globally here, so it reflects actual learning time.

  function recordStudyTime(mins: number) {
    setStats(prev => ({
      ...prev,
      studyTimeMinutes:    prev.studyTimeMinutes    + mins,
      todayStudyMinutes:   prev.todayStudyMinutes   + mins,
      lastActiveDate:      todayISO(),
    }));
    // Also push to server
    fetch(`${SERVER_URL}/student/${studentId}/study-time`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ minutes: mins }),
    }).catch(() => {});
  }

  // ── Actions ─────────────────────────────────────────────

  function addXP(xp: number) {
    setStats(prev => {
      const newXP = prev.xpPoints + xp;
      return { ...prev, xpPoints: newXP, level: computeLevel(newXP), todayXP: prev.todayXP + xp, lastActiveDate: todayISO() };
    });
  }

  function exploreTopic() {
    setStats(prev => ({ ...prev, topicsExplored: prev.topicsExplored + 1, lastActiveDate: todayISO() }));
    addXP(25);
  }

  function completeLesson(topic: string) {
    // Call server to record completion
    fetch(`${SERVER_URL}/student/${studentId}/complete-lesson`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ topic }),
    })
      .then(r => r.json())
      .then(data => setStats(prev => ({ ...prev, ...data })))
      .catch(() => {
        // Offline fallback
        setStats(prev => {
          const already = prev.completedTopics.includes(topic);
          const newXP = already ? prev.xpPoints : prev.xpPoints + 150;
          return {
            ...prev,
            completedTopics: already ? prev.completedTopics : [...prev.completedTopics, topic],
            xpPoints:        newXP,
            level:           computeLevel(newXP),
            todayXP:         already ? prev.todayXP : prev.todayXP + 150,
            topicsExplored:  already ? prev.topicsExplored : prev.topicsExplored + 1,
            lastLesson:      topic,
            lastActiveDate:  todayISO(),
          };
        });
      });
  }

  function completeChallenge() {
    setStats(prev => ({ ...prev, challengesCompleted: prev.challengesCompleted + 1, lastActiveDate: todayISO() }));
    addXP(100);
  }

  function completeAssignment() {
    setStats(prev => ({ ...prev, assignmentsDone: prev.assignmentsDone + 1, lastActiveDate: todayISO() }));
    addXP(75);
  }

  return (
    <StudentDataContext.Provider value={{ stats, studentId, addXP, exploreTopic, completeLesson, completeChallenge, completeAssignment, recordStudyTime }}>
      {children}
    </StudentDataContext.Provider>
  );
}

export function useStudentData() {
  return useContext(StudentDataContext);
}

// ─────────────────────────────────────────────────────────
// Display Helpers
// ─────────────────────────────────────────────────────────

export function formatStudyTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatLevel(level: number): string {
  return `Lvl ${String(level).padStart(2, '0')}`;
}

export function xpForNextLevel(xp: number): { current: number; needed: number; level: number } {
  let level = 1, threshold = 500, total = 0;
  while (xp >= total + threshold) { total += threshold; threshold += 250; level++; }
  return { current: xp - total, needed: threshold, level };
}
