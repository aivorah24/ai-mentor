import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

type AdminCounts = {
  users: number;
  students: number;
  teachers: number;
  parents: number;
  preferencesCaptured: number;
};

type AdminUser = {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  grade?: string;
  curriculum?: string;
  school?: string;
  location?: string;
  xpPoints?: number;
  level?: number;
  currentStreak?: number;
  studyTimeMinutes?: number;
  completedTopicsCount?: number;
  lastLesson?: string;
  avatarStyle?: string;
  learningStyle?: string;
  interests?: string[];
  bio?: string;
};

type AdminOverview = {
  counts: AdminCounts;
  students: AdminUser[];
  teachers: AdminUser[];
  parents: AdminUser[];
};

type AnalyticsUserLastSeen = {
  email: string;
  role: string;
  lastSeen: string;
};

type AnalyticsMetric = {
  eventType: string;
  total: number;
  success: number;
  failed: number;
  avgLatencyMs: number | null;
};

type AnalyticsSummary = {
  totalEvents: number;
  accessCount: number;
  uniqueUsers: number;
  usersLastSeen: AnalyticsUserLastSeen[];
  aiMetrics: AnalyticsMetric[];
  feedback: {
    total: number;
    positive: number;
    neutral: number;
    negative: number;
  };
};

type LLMByModel = {
  model: string;
  provider: string;
  calls: number;
  tokens: number;
  cost: number;
};

type LLMByDay = {
  date: string;
  calls: number;
  tokens: number;
  cost: number;
};

type LLMFeedbackCounts = { 1: number; 2: number; 3: number };

type LLMRecentRow = {
  route: string;
  model: string;
  student_email?: string;
  grade?: string;
  subject?: string;
  topic?: string;
  total_tokens?: number;
  response_time_ms?: number;
  feedback?: string | number;
  created_at: string;
};

type LLMStats = {
  days: number;
  summary: {
    totalCalls: number;
    totalTokens: number;
    totalCost: number;
    avgResponseMs: number;
  };
  byModel: LLMByModel[];
  byDay: LLMByDay[];
  byProvider: { provider: string; calls: number }[];
  feedback: {
    total: number;
    avg: number | null;
    counts: LLMFeedbackCounts;
    recent: LLMRecentRow[];
  };
  recent: LLMRecentRow[];
};

type StudentProgress = {
  xpPoints?: number;
  level?: number;
  currentStreak?: number;
  studyTimeMinutes?: number;
  completedTopicsCount?: number;
  lastLesson?: string;
};

type UserPreference = {
  avatarStyle?: string;
  learningStyle?: string;
  interests?: string[];
  bio?: string;
};

const ALLOWED_ADMINS = new Set([
  'admin@aivorah.ai',
  'preddy6678@gmail.com',
]);

const USER_DISCOVERY_QUERIES = [
  'test',
  'gmail',
  'yahoo',
  'outlook',
  '.ai',
  '.com',
  'school',
  'grade',
  'ib',
  'ncert',
  'mentor',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getWebQueryParam(name: string): string {
  if (Platform.OS !== 'web') return '';
  const win = (globalThis as unknown as { window?: Window }).window;
  const search = win?.location?.search || '';
  const params = new URLSearchParams(search);
  return (params.get(name) || '').trim();
}

function getApiCandidates(): string[] {
  if (Platform.OS !== 'web') return [];
  const win = (globalThis as unknown as { window?: Window }).window;
  const protocol = win?.location?.protocol || 'http:';
  const hostname = win?.location?.hostname || 'localhost';
  const origin = win?.location?.origin || `${protocol}//${hostname}`;
  return Array.from(new Set([`${protocol}//${hostname}:3006`, `${protocol}//${hostname}:3001`, origin]));
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 7000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...(init || {}), signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) throw new Error('Not JSON');
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseSyncUser(data: unknown, fallbackEmail: string): AdminUser | null {
  if (!isRecord(data)) return null;
  const email = String(data.email || fallbackEmail || '').toLowerCase().trim();
  if (!email) return null;
  return {
    id: data.id ? String(data.id) : '',
    name: data.name ? String(data.name) : email.split('@')[0],
    email,
    role: data.role ? String(data.role) : '',
    grade: data.grade ? String(data.grade) : '',
    curriculum: data.curriculum ? String(data.curriculum) : '',
    school: data.school ? String(data.school) : '',
    location: data.location ? String(data.location) : '',
  };
}

function isOverviewShape(data: unknown): data is AdminOverview {
  if (!isRecord(data) || !isRecord(data.counts)) return false;
  return Array.isArray(data.students) && Array.isArray(data.teachers) && Array.isArray(data.parents);
}

function isAnalyticsShape(data: unknown): data is AnalyticsSummary {
  if (!isRecord(data)) return false;
  return typeof data.totalEvents === 'number' && Array.isArray(data.aiMetrics) && isRecord(data.feedback);
}

async function discoverUserEmails(base: string): Promise<string[]> {
  const emails = new Set<string>();
  for (const q of USER_DISCOVERY_QUERIES) {
    try {
      const data = await fetchJson(`${base}/parent/search-student?q=${encodeURIComponent(q)}`, undefined, 4500);
      if (!Array.isArray(data)) continue;
      for (const item of data) {
        if (!isRecord(item)) continue;
        const email = String(item.email || '').toLowerCase().trim();
        if (email) emails.add(email);
      }
    } catch {}
  }
  return Array.from(emails);
}

async function fetchStudentProgress(base: string, studentId: string): Promise<StudentProgress | null> {
  if (!studentId) return null;
  try {
    const data = await fetchJson(`${base}/student/${encodeURIComponent(studentId)}`, undefined, 5000);
    if (!isRecord(data)) return null;
    const completedTopics = Array.isArray(data.completedTopics) ? data.completedTopics.length : 0;
    return {
      xpPoints: typeof data.xpPoints === 'number' ? data.xpPoints : undefined,
      level: typeof data.level === 'number' ? data.level : undefined,
      currentStreak: typeof data.currentStreak === 'number' ? data.currentStreak : undefined,
      studyTimeMinutes: typeof data.studyTimeMinutes === 'number' ? data.studyTimeMinutes : undefined,
      completedTopicsCount: completedTopics,
      lastLesson: data.lastLesson ? String(data.lastLesson) : '',
    };
  } catch {
    return null;
  }
}

async function fetchPreference(base: string, email: string): Promise<UserPreference | null> {
  const data = await fetchJson(`${base}/user/preferences?email=${encodeURIComponent(email)}`, undefined, 4500);
  if (data === null) return null;
  if (!isRecord(data)) return null;
  return {
    avatarStyle: data.avatarStyle ? String(data.avatarStyle) : '',
    learningStyle: data.learningStyle ? String(data.learningStyle) : '',
    interests: Array.isArray(data.interests) ? data.interests.map((x) => String(x)) : [],
    bio: data.bio ? String(data.bio) : '',
  };
}

async function buildLiveAggregateOverview(base: string): Promise<{
  overview: AdminOverview | null;
  preferencesAvailable: boolean;
}> {
  const emails = await discoverUserEmails(base);
  if (emails.length === 0) return { overview: null, preferencesAvailable: false };

  const profileResults = await Promise.all(
    emails.map(async (email) => {
      try {
        const data = await fetchJson(`${base}/user/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        return parseSyncUser(data, email);
      } catch {
        return null;
      }
    }),
  );

  const users = profileResults
    .filter((u): u is AdminUser => !!u?.email)
    .filter((u, idx, arr) => arr.findIndex((x) => x.email === u.email) === idx);

  if (users.length === 0) return { overview: null, preferencesAvailable: false };

  const studentUsers = users.filter((u) => (u.role || '').toLowerCase() === 'student');
  const teacherUsers = users.filter((u) => (u.role || '').toLowerCase() === 'teacher');
  const parentUsers = users.filter((u) => (u.role || '').toLowerCase() === 'parent');

  // Include students visible in leaderboard even if user-discovery missed their emails.
  type LeaderboardEntry = { id?: string; name?: string; grade?: string };
  let leaderboard: LeaderboardEntry[] = [];
  try {
    const lbData = await fetchJson(`${base}/student/leaderboard?limit=200`, undefined, 5000);
    if (Array.isArray(lbData)) leaderboard = lbData as LeaderboardEntry[];
  } catch {}

  const studentById: Record<string, AdminUser> = {};
  for (const s of studentUsers) {
    const id = String(s.id || '');
    if (id) studentById[id] = s;
  }
  for (const lb of leaderboard) {
    const id = String(lb?.id || '');
    if (!id || studentById[id]) continue;
    studentById[id] = {
      id,
      name: lb?.name ? String(lb.name) : 'Student',
      email: '',
      role: 'student',
      grade: lb?.grade ? String(lb.grade) : '',
      curriculum: '',
      school: '',
      location: '',
    };
  }
  const mergedStudents = Object.values(studentById);

  const progressPairs = await Promise.all(
    mergedStudents.map(async (u) => {
      const progress = await fetchStudentProgress(base, String(u.id || ''));
      return [String(u.email), progress] as const;
    }),
  );
  const progressMapByStudentKey: Record<string, StudentProgress | null> = {};
  for (let i = 0; i < mergedStudents.length; i++) {
    const u = mergedStudents[i];
    const key = String(u.id || u.email || `student-${i}`);
    progressMapByStudentKey[key] = progressPairs[i][1];
  }

  let preferencesAvailable = false;
  const preferenceMap: Record<string, UserPreference | null> = {};
  if (users.length > 0) {
    try {
      await fetchPreference(base, String(users[0].email));
      preferencesAvailable = true;
      const prefPairs = await Promise.all(
        users.map(async (u) => {
          try {
            const pref = await fetchPreference(base, String(u.email));
            return [String(u.email), pref] as const;
          } catch {
            return [String(u.email), null] as const;
          }
        }),
      );
      for (const [email, pref] of prefPairs) preferenceMap[email] = pref;
    } catch {
      preferencesAvailable = false;
    }
  }

  const students: AdminUser[] = mergedStudents.map((u, idx) => {
    const email = String(u.email || '');
    const progress = progressMapByStudentKey[String(u.id || u.email || `student-${idx}`)];
    const pref = preferenceMap[email];
    return {
      ...u,
      xpPoints: progress?.xpPoints,
      level: progress?.level,
      currentStreak: progress?.currentStreak,
      studyTimeMinutes: progress?.studyTimeMinutes,
      completedTopicsCount: progress?.completedTopicsCount,
      lastLesson: progress?.lastLesson,
      avatarStyle: pref?.avatarStyle,
      learningStyle: pref?.learningStyle,
      interests: pref?.interests,
      bio: pref?.bio,
    };
  });

  const teachers: AdminUser[] = teacherUsers.map((u) => {
    const pref = preferenceMap[String(u.email || '')];
    return {
      ...u,
      avatarStyle: pref?.avatarStyle,
      learningStyle: pref?.learningStyle,
      interests: pref?.interests,
      bio: pref?.bio,
    };
  });

  const parents: AdminUser[] = parentUsers.map((u) => {
    const pref = preferenceMap[String(u.email || '')];
    return {
      ...u,
      avatarStyle: pref?.avatarStyle,
      learningStyle: pref?.learningStyle,
      interests: pref?.interests,
      bio: pref?.bio,
    };
  });

  const preferencesCaptured = users.filter((u) => {
    const pref = preferenceMap[String(u.email || '')];
    return Boolean(pref && (pref.avatarStyle || pref.learningStyle || (pref.interests || []).length || pref.bio));
  }).length;

  return {
    overview: {
      counts: {
        users: users.length,
        students: students.length,
        teachers: teachers.length,
        parents: parents.length,
        preferencesCaptured,
      },
      students,
      teachers,
      parents,
    },
    preferencesAvailable,
  };
}

export default function AdminPanelScreen() {
  const adminEmail = useMemo(() => getWebQueryParam('email').toLowerCase(), []);
  const adminKey = useMemo(() => getWebQueryParam('key'), []);
  const [apiBase, setApiBase] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [preferencesAvailable, setPreferencesAvailable] = useState(false);
  const [llmStats, setLlmStats] = useState<LLMStats | null>(null);

  const querySuffix = useMemo(() => {
    const params = new URLSearchParams();
    if (adminEmail) params.set('email', adminEmail);
    if (adminKey) params.set('key', adminKey);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [adminEmail, adminKey]);

  const loadOverview = useCallback(async () => {
    if (!adminEmail) {
      setError('Admin email is missing in URL.');
      setOverview(null);
      setAnalytics(null);
      setNotice('');
      return;
    }
    if (!ALLOWED_ADMINS.has(adminEmail)) {
      setError('Unauthorized admin email.');
      setOverview(null);
      setAnalytics(null);
      setNotice('');
      return;
    }

    const candidates = getApiCandidates();
    for (const base of candidates) {
      try {
        const data = await fetchJson(`${base}/admin/overview${querySuffix}`);
        if (!isOverviewShape(data)) continue;
        setApiBase(base);
        setOverview(data);
        setNotice('');
        setError('');

        try {
          const analyticsData = await fetchJson(`${base}/analytics/summary${querySuffix}`);
          if (isAnalyticsShape(analyticsData)) setAnalytics(analyticsData);
          else setAnalytics(null);
        } catch {
          setAnalytics(null);
        }

        try {
          const llmData = await fetchJson(`${base}/admin/llm-stats?days=30${adminEmail ? '&email=' + encodeURIComponent(adminEmail) : ''}`);
          if (isRecord(llmData) && isRecord((llmData as any).summary)) setLlmStats(llmData as LLMStats);
          else setLlmStats(null);
        } catch {
          setLlmStats(null);
        }

        setPreferencesAvailable(true);
        return;
      } catch {}
    }

    for (const base of candidates) {
      try {
        const aggregate = await buildLiveAggregateOverview(base);
        if (!aggregate.overview) continue;
        setApiBase(base);
        setOverview(aggregate.overview);
        setPreferencesAvailable(aggregate.preferencesAvailable);
        setNotice('Loaded live aggregated data from available endpoints. Admin overview endpoint is unavailable on this backend.');
        setError('');

        try {
          const analyticsData = await fetchJson(`${base}/analytics/summary${querySuffix}`);
          if (isAnalyticsShape(analyticsData)) setAnalytics(analyticsData);
          else setAnalytics(null);
        } catch {
          setAnalytics(null);
        }

        try {
          const llmData = await fetchJson(`${base}/admin/llm-stats?days=30${adminEmail ? '&email=' + encodeURIComponent(adminEmail) : ''}`);
          if (isRecord(llmData) && isRecord((llmData as any).summary)) setLlmStats(llmData as LLMStats);
          else setLlmStats(null);
        } catch {
          setLlmStats(null);
        }

        return;
      } catch {}
    }

    setApiBase('');
    setOverview(null);
    setAnalytics(null);
    setLlmStats(null);
    setPreferencesAvailable(false);
    setNotice('');
    setError('Live admin data is unreachable on all detected backends.');
  }, [adminEmail, querySuffix]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      await loadOverview();
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [loadOverview]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOverview();
    setRefreshing(false);
  }, [loadOverview]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#93B0AC" />
        <Text style={styles.loadingText}>Loading Admin Panel...</Text>
      </View>
    );
  }

  const aiRequestTotal = (analytics?.aiMetrics || []).reduce((sum, m) => sum + (m.total || 0), 0);
  const aiFailedTotal = (analytics?.aiMetrics || []).reduce((sum, m) => sum + (m.failed || 0), 0);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Aivorah Admin Panel</Text>
          <Text style={styles.sub}>Signed in as {adminEmail || 'N/A'}</Text>
          {!!apiBase && <Text style={styles.base}>API: {apiBase}</Text>}
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh} activeOpacity={0.85}>
          <Feather name="refresh-cw" size={15} color="#F0EEEC" />
          <Text style={styles.refreshTxt}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {!!notice && (
        <View style={styles.infoCard}>
          <Feather name="alert-circle" size={16} color="#FDE68A" />
          <Text style={styles.infoText}>{notice}</Text>
        </View>
      )}

      {!!error && (
        <View style={styles.errorCard}>
          <Feather name="alert-circle" size={16} color="#FCA5A5" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!!overview && (
        <>
          <View style={styles.cards}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Users</Text>
              <Text style={styles.cardValue}>{overview.counts.users}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Students</Text>
              <Text style={styles.cardValue}>{overview.counts.students}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Teachers</Text>
              <Text style={styles.cardValue}>{overview.counts.teachers}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Parents</Text>
              <Text style={styles.cardValue}>{overview.counts.parents}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Preferences</Text>
              <Text style={styles.cardValue}>{overview.counts.preferencesCaptured}</Text>
            </View>
          </View>

          {!!analytics && (
            <View style={styles.cards}>
              <View style={styles.card}>
                <Text style={styles.cardLabel}>Website Accesses</Text>
                <Text style={styles.cardValue}>{analytics.accessCount}</Text>
              </View>
              <View style={styles.card}>
                <Text style={styles.cardLabel}>Unique Users</Text>
                <Text style={styles.cardValue}>{analytics.uniqueUsers}</Text>
              </View>
              <View style={styles.card}>
                <Text style={styles.cardLabel}>AI Requests</Text>
                <Text style={styles.cardValue}>{aiRequestTotal}</Text>
              </View>
              <View style={styles.card}>
                <Text style={styles.cardLabel}>AI Failures</Text>
                <Text style={styles.cardValue}>{aiFailedTotal}</Text>
              </View>
              <View style={styles.card}>
                <Text style={styles.cardLabel}>Feedback Total</Text>
                <Text style={styles.cardValue}>{analytics.feedback.total}</Text>
              </View>
            </View>
          )}

          {!analytics && (
            <View style={styles.infoCard}>
              <Feather name="info" size={16} color="#93B0AC" />
              <Text style={styles.infoTextSecondary}>
                Feedback and AI performance are unavailable because `/analytics/summary` is not enabled on this backend.
              </Text>
            </View>
          )}

          {!preferencesAvailable && (
            <View style={styles.infoCard}>
              <Feather name="info" size={16} color="#93B0AC" />
              <Text style={styles.infoTextSecondary}>
                Preference endpoint `/user/preferences` is unavailable on this backend. Only core user/progress data is shown.
              </Text>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Students</Text>
            {overview.students.slice(0, 100).map((s, idx) => (
              <View key={`${s.email || s.id || 'student'}-${idx}`} style={styles.row}>
                <Text style={styles.name}>{s.name || 'Unknown'}</Text>
                <Text style={styles.meta}>
                  {s.email || 'no-email'} | {s.grade || '-'} | {s.curriculum || '-'}
                </Text>
                <Text style={styles.meta}>
                  XP: {s.xpPoints ?? 0} | Level: {s.level ?? 1} | Streak: {s.currentStreak ?? 0} | Study min: {s.studyTimeMinutes ?? 0} | Topics: {s.completedTopicsCount ?? 0}
                </Text>
                {(s.avatarStyle || s.learningStyle || (s.interests || []).length > 0 || s.bio) && (
                  <Text style={styles.meta}>
                    Avatar: {s.avatarStyle || '-'} | Learning: {s.learningStyle || '-'} | Interests: {(s.interests || []).join(', ') || '-'}
                  </Text>
                )}
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Teachers</Text>
            {overview.teachers.slice(0, 100).map((t, idx) => (
              <View key={`${t.email || t.id || 'teacher'}-${idx}`} style={styles.row}>
                <Text style={styles.name}>{t.name || 'Unknown'}</Text>
                <Text style={styles.meta}>{t.email || 'no-email'} | {t.school || '-'} | {t.location || '-'}</Text>
                {(t.avatarStyle || t.learningStyle) && (
                  <Text style={styles.meta}>Avatar: {t.avatarStyle || '-'} | Learning: {t.learningStyle || '-'}</Text>
                )}
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Parents</Text>
            {overview.parents.slice(0, 100).map((p, idx) => (
              <View key={`${p.email || p.id || 'parent'}-${idx}`} style={styles.row}>
                <Text style={styles.name}>{p.name || 'Unknown'}</Text>
                <Text style={styles.meta}>{p.email || 'no-email'} | {p.school || '-'} | {p.location || '-'}</Text>
                {(p.avatarStyle || p.learningStyle) && (
                  <Text style={styles.meta}>Avatar: {p.avatarStyle || '-'} | Learning: {p.learningStyle || '-'}</Text>
                )}
              </View>
            ))}
          </View>

          {!!analytics && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>AI Performance Metrics</Text>
              {analytics.aiMetrics.length === 0 && <Text style={styles.meta}>No AI metrics yet.</Text>}
              {analytics.aiMetrics.map((m, idx) => (
                <View key={`${m.eventType}-${idx}`} style={styles.row}>
                  <Text style={styles.name}>{m.eventType}</Text>
                  <Text style={styles.meta}>
                    total: {m.total} | success: {m.success} | failed: {m.failed} | avg latency: {m.avgLatencyMs ?? '-'}ms
                  </Text>
                </View>
              ))}
            </View>
          )}

          {!!llmStats && (
            <>
              {/* LLM Usage Summary */}
              <View style={styles.cards}>
                <View style={styles.card}>
                  <Text style={styles.cardLabel}>AI Calls (30d)</Text>
                  <Text style={styles.cardValue}>{llmStats.summary.totalCalls}</Text>
                </View>
                <View style={styles.card}>
                  <Text style={styles.cardLabel}>Tokens Used</Text>
                  <Text style={styles.cardValue}>{(llmStats.summary.totalTokens / 1000).toFixed(1)}k</Text>
                </View>
                <View style={styles.card}>
                  <Text style={styles.cardLabel}>Avg Response</Text>
                  <Text style={styles.cardValue}>{llmStats.summary.avgResponseMs}ms</Text>
                </View>
                <View style={styles.card}>
                  <Text style={styles.cardLabel}>Est. Cost</Text>
                  <Text style={styles.cardValue}>${llmStats.summary.totalCost.toFixed(4)}</Text>
                </View>
              </View>

              {/* AI Coach Feedback */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Student Feedback</Text>
                {llmStats.feedback.total === 0 ? (
                  <Text style={styles.meta}>No feedback collected yet.</Text>
                ) : (
                  <>
                    {/* Compact summary bar */}
                    <View style={styles.feedbackBar}>
                      {/* Score */}
                      <View style={styles.feedbackScoreBlock}>
                        <Text style={styles.feedbackAvgVal}>{llmStats.feedback.avg ?? '-'}</Text>
                        <Text style={styles.feedbackAvgDenom}> / 3</Text>
                        <Text style={styles.feedbackTotal}>  ({llmStats.feedback.total} rating{llmStats.feedback.total !== 1 ? 's' : ''})</Text>
                      </View>

                      {/* Divider */}
                      <View style={styles.feedbackDivider} />

                      {/* Counts */}
                      <View style={styles.feedbackCountsRow}>
                        <View style={styles.feedbackCountItem}>
                          <Text style={styles.feedbackEmoji}>👍</Text>
                          <Text style={[styles.feedbackCount, { color: '#4ADE80' }]}>{llmStats.feedback.counts[1]}</Text>
                          <Text style={styles.feedbackLbl}>Great (3)</Text>
                        </View>
                        <View style={styles.feedbackCountItem}>
                          <Text style={styles.feedbackEmoji}>😐</Text>
                          <Text style={[styles.feedbackCount, { color: '#FCD34D' }]}>{llmStats.feedback.counts[2]}</Text>
                          <Text style={styles.feedbackLbl}>Okay (2)</Text>
                        </View>
                        <View style={styles.feedbackCountItem}>
                          <Text style={styles.feedbackEmoji}>👎</Text>
                          <Text style={[styles.feedbackCount, { color: '#F87171' }]}>{llmStats.feedback.counts[3]}</Text>
                          <Text style={styles.feedbackLbl}>Poor (1)</Text>
                        </View>
                      </View>

                      {/* Recent users — right aligned */}
                      {llmStats.feedback.recent.length > 0 && (
                        <View style={styles.feedbackRecentBlock}>
                          <Text style={styles.feedbackRecentLbl}>Recent:</Text>
                          <Text style={styles.feedbackRecentNames} numberOfLines={1}>
                            {llmStats.feedback.recent
                              .slice(0, 5)
                              .map(r => (r.student_email || 'anon').split('@')[0])
                              .join(', ')}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Per-user breakdown */}
                    {llmStats.feedback.recent.length > 0 && (
                      <View style={{ marginTop: 14 }}>
                        <Text style={[styles.meta, { marginBottom: 8, color: '#A8B5B3', fontSize: 13 }]}>Who gave feedback</Text>
                        {llmStats.feedback.recent.map((r, idx) => {
                          const rating = Number(r.feedback);
                          const emoji = rating === 1 ? '👍' : rating === 2 ? '😐' : '👎';
                          const label = rating === 1 ? 'Great' : rating === 2 ? 'Okay' : 'Poor';
                          const color = rating === 1 ? '#4ADE80' : rating === 2 ? '#FCD34D' : '#F87171';
                          const username = (r.student_email || 'anonymous').split('@')[0];
                          return (
                            <View key={idx} style={styles.feedbackUserRow}>
                              <Text style={styles.feedbackUserEmoji}>{emoji}</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.name}>{r.student_email || 'Anonymous'}</Text>
                                <Text style={styles.meta}>
                                  {r.subject || '-'}{r.grade ? ` · ${r.grade}` : ''}{r.topic ? ` · ${r.topic}` : ''}
                                </Text>
                              </View>
                              <View style={styles.feedbackUserRight}>
                                <Text style={[styles.feedbackUserLabel, { color }]}>{label}</Text>
                                <Text style={styles.meta}>{new Date(r.created_at).toLocaleDateString()}</Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </>
                )}
              </View>

              {/* Model Breakdown */}
              {llmStats.byModel.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>LLM Model Usage</Text>
                  {llmStats.byModel.map((m, idx) => (
                    <View key={idx} style={styles.row}>
                      <Text style={styles.name}>{m.model}</Text>
                      <Text style={styles.meta}>
                        {m.provider} | calls: {m.calls} | tokens: {(m.tokens / 1000).toFixed(1)}k | cost: ${m.cost.toFixed(4)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F0F0F' },
  content: { padding: 20, paddingBottom: 36 },
  center: {
    flex: 1,
    backgroundColor: '#0F0F0F',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: { color: '#A8B5B3', fontSize: 14 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  title: { fontSize: 30, fontWeight: '800', color: '#F0EEEC' },
  sub: { color: '#A8B5B3', marginTop: 6, fontSize: 14 },
  base: { color: '#93B0AC', marginTop: 4, fontSize: 12 },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1C1C1C',
    borderWidth: 1,
    borderColor: 'rgba(195,220,216,0.22)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  refreshTxt: { color: '#F0EEEC', fontSize: 13, fontWeight: '600' },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(252,165,165,0.4)',
    backgroundColor: 'rgba(127,29,29,0.22)',
    padding: 12,
    marginBottom: 16,
  },
  errorText: { color: '#FECACA', flex: 1, fontSize: 13, lineHeight: 18 },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(253,230,138,0.4)',
    backgroundColor: 'rgba(146,64,14,0.22)',
    padding: 12,
    marginBottom: 16,
  },
  infoText: { color: '#FDE68A', flex: 1, fontSize: 13, lineHeight: 18 },
  infoTextSecondary: { color: '#93B0AC', flex: 1, fontSize: 13, lineHeight: 18 },
  cards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 18,
  },
  card: {
    minWidth: 170,
    flexGrow: 1,
    backgroundColor: '#1C1C1C',
    borderWidth: 1,
    borderColor: 'rgba(195,220,216,0.18)',
    borderRadius: 12,
    padding: 14,
  },
  cardLabel: { color: '#A8B5B3', fontSize: 12, marginBottom: 8 },
  cardValue: { color: '#F0EEEC', fontSize: 26, fontWeight: '800' },
  section: {
    backgroundColor: '#1C1C1C',
    borderWidth: 1,
    borderColor: 'rgba(195,220,216,0.18)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  sectionTitle: { color: '#F0EEEC', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  row: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(195,220,216,0.12)',
  },
  name: { color: '#F0EEEC', fontSize: 14, fontWeight: '600' },
  meta: { color: '#A8B5B3', fontSize: 12, marginTop: 3 },
  // Feedback bar (compact summary row)
  feedbackBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 14,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: 'rgba(195,220,216,0.14)',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 4,
  },
  feedbackScoreBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  feedbackAvgVal: { color: '#F0EEEC', fontSize: 20, fontWeight: '800' },
  feedbackAvgDenom: { color: '#6B7E7C', fontSize: 14, fontWeight: '600' },
  feedbackTotal: { color: '#6B7E7C', fontSize: 12 },
  feedbackDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(195,220,216,0.18)',
  },
  feedbackCountsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  feedbackCountItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  feedbackEmoji: { fontSize: 16 },
  feedbackCount: { fontSize: 16, fontWeight: '700' },
  feedbackLbl: { color: '#6B7E7C', fontSize: 12 },
  feedbackRecentBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  feedbackRecentLbl: { color: '#6B7E7C', fontSize: 12 },
  feedbackRecentNames: { color: '#A8B5B3', fontSize: 12, flexShrink: 1 },
  // Per-user breakdown rows
  feedbackUserRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(195,220,216,0.10)',
  },
  feedbackUserEmoji: { fontSize: 18, marginTop: 1 },
  feedbackUserRight: { alignItems: 'flex-end', gap: 2 },
  feedbackUserLabel: { fontSize: 12, fontWeight: '700' },
  ratingDot: { width: 8, height: 8, borderRadius: 4 },
});
