import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;
import { Feather } from '@expo/vector-icons';
import Svg, { Path, Circle, G, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useAuth } from '../../context/AuthContext';
import { useStudentData, formatStudyTime, formatLevel, xpForNextLevel } from '../../context/StudentDataContext';
import { useTheme } from '../../context/ThemeContext';
import { useNotification } from '../../context/NotificationContext';
import { useResponsive } from '../../hooks/useResponsive';
import SERVER_URL from '../../config/serverUrl';

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

interface CurriculumTopic {
  grade: string; subject: string; unit: string; topic: string; content_type: string;
}
interface CurriculumData {
  grades: string[];
  topics: CurriculumTopic[];
  grouped: Record<string, Record<string, { topic: string; unit: string }[]>>;
  totalTopics: number;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

// ── Enchanting Forest palette ──────────────────────────────
// Slightly darkened for use as text/icon on white backgrounds
// Exact landing.html palette: SAGE (#9FB2A4) + GOLD (#BAA467) on #0B0B0B. No purple.
const BRAND = {
  teal:   '#BAA467',   // landing --sage (primary)
  mint:   '#BAA467',   // sage
  rose:   '#C98A8A',   // muted rose (kept for "wrong answer" semantics)
  blush:  '#C99A9A',   // mid-rose
  gold:   '#BAA467',   // landing --gold
  slate:  '#BAA467',   // sage
  silver: '#A9B0AC',   // landing --muted
  // Accents — sage/gold family (no purples/corals)
  violet: '#BAA467',   // → gold
  coral:  '#C9A24E',   // deep gold
  forest: '#BAA467',   // sage
  // Aliases used elsewhere in code
  indigo: '#BAA467',
  violet2: '#BAA467',  // gold
  purple: '#BAA467',   // → gold
  orange: '#C9A24E',   // deep gold
  amber:  '#BAA467',   // landing GOLD
  green:  '#BAA467',   // sage
  cyan:   '#BAA467',   // sage
  blue:   '#BAA467',
  red:    '#C98A8A',   // muted rose
  pink:   '#C98A8A',
};
// Light-mode pastel card backgrounds — warm cream + sage/gold tints.
const PASTEL = {
  blue:   '#E7F1EA',   // pale sage
  teal:   '#D9EEE0',   // mint tint
  green:  '#DCEFE2',   // light green
  orange: '#F4ECD6',   // warm cream-gold
  yellow: '#F1EAD2',   // gold cream
  red:    '#F6E2E2',   // soft rose
  cyan:   '#DEF3E6',   // mint
  indigo: '#E7F1EA',   // pale sage
  pink:   '#F2E3D9',   // warm blush
  purple: '#F1E8D0',   // gold cream (was blush-rose)
  silver: '#ECEFEA',   // soft sage-gray
};

const SUBJECT_COLORS: Record<string, string> = {
  Mathematics: '#BAA467',   // gold
  Science: '#BAA467',       // gold
  'Social Studies': '#BAA467', // gold
};
const SUBJECT_ICONS: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  Mathematics: 'hash', Science: 'zap', 'Social Studies': 'globe',
};

const QUICK_NAV = [
  { label: 'My Learning',  icon: 'book'         as const, color: BRAND.teal,   pastel: PASTEL.teal,   screen: 'LearningPaths', desc: 'My Paths' },
  { label: 'AI Coach',     icon: 'cpu'           as const, color: BRAND.rose,   pastel: PASTEL.pink,   screen: 'AICoach',       desc: 'Ask anything' },
  { label: 'Assignments',  icon: 'check-square'  as const, color: BRAND.gold,   pastel: PASTEL.yellow, screen: 'Assignments',   desc: 'Pending' },
  { label: 'Challenges',   icon: 'target'        as const, color: BRAND.blush,  pastel: PASTEL.red,    screen: 'Challenges',    desc: 'Compete' },
  { label: 'Schedule',     icon: 'calendar'      as const, color: BRAND.silver, pastel: PASTEL.silver, screen: 'Schedule',      desc: 'Timetable' },
  { label: 'Progress',     icon: 'trending-up'   as const, color: BRAND.violet, pastel: PASTEL.purple, screen: 'Progress',      desc: 'Analytics' },
];

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function parseDateOnly(v: string): Date | null {
  const p = v.split('-').map(Number);
  if (p.length !== 3 || p.some(isNaN)) return null;
  return new Date(p[0], p[1] - 1, p[2]);
}
function isDueToday(v: string) {
  const d = parseDateOnly(v); if (!d) return false;
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
function formatDeadline(v: string) {
  if (isDueToday(v)) return 'Due Today';
  const d = parseDateOnly(v);
  return d ? `Due ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : v;
}

function normalizeSearchText(v: string) {
  return (v || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────
// SVG Components
// ─────────────────────────────────────────────────────────

/** Decorative dots pattern for hero */
function HeroDots() {
  const dots: React.ReactElement[] = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 12; c++)
      dots.push(<Circle key={`${r}-${c}`} cx={c * 36 + 10} cy={r * 36 + 10} r={1.6} fill="rgba(255,255,255,0.14)" />);
  return <Svg style={StyleSheet.absoluteFill as any} pointerEvents="none">{dots}</Svg>;
}


/** Ring progress chart */
function RingChart({ progress, color, size = 72, stroke = 8, track = 'rgba(0,0,0,0.1)' }: {
  progress: number; color: string; size?: number; stroke?: number; track?: string;
}) {
  const cx = size / 2, r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(Math.max(progress, 0), 1));
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cx} r={r} stroke={track} strokeWidth={stroke} fill="none" />
      <G transform={`rotate(-90 ${cx} ${cx})`}>
        <Circle cx={cx} cy={cx} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={`${circ}`} strokeDashoffset={offset} />
      </G>
    </Svg>
  );
}

/** SVG Bar Chart for performance */
function PerformanceBarChart({ topics, color, isDark }: { topics: { label: string; pct: number }[]; color: string; isDark: boolean }) {
  const barW = 28, gap = 14, h = 90, labelH = 32;
  const totalW = topics.length * (barW + gap);
  const trackColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  return (
    <Svg width={totalW} height={h + labelH} style={{ marginTop: 4 }}>
      {topics.map((t, i) => {
        const barH = Math.max((t.pct / 100) * h, 4);
        const x = i * (barW + gap);
        const y = h - barH;
        return (
          <G key={i}>
            <Rect x={x} y={0} width={barW} height={h} rx={8} fill={trackColor} />
            <Rect x={x} y={y} width={barW} height={barH} rx={8} fill={color} opacity={0.85 + (i % 2) * 0.15} />
            <Svg x={x} y={h + 6} width={barW} height={26}>
              <G>
                <Rect width={barW} height={26} fill="none" />
              </G>
            </Svg>
          </G>
        );
      })}
    </Svg>
  );
}

/** Flame for streak */
function FlameIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 20 25">
      <Path d="M10 0C8 3.5 5 7.5 5 12.5C5 17 7.2 20 10 20C12.8 20 15 17 15 12.5C15 7.5 12 3.5 10 0Z" fill="#BAA467" />
      <Path d="M10 6.5C9 9 7.5 11 7.5 13.5C7.5 15.5 8.5 17 10 17C11.5 17 12.5 15.5 12.5 13.5C12.5 11 11 9 10 6.5Z" fill="#D4BE7E" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────
// Animated Stat Chip
// ─────────────────────────────────────────────────────────

// ── Static fallback so dashboard never blocks on network ──
const FALLBACK_CURRICULUM: CurriculumData = (() => {
  const chapters = [
    'Where to Look for Numbers', 'Count in Groups', 'Give and Take',
    'Long and Short', 'Shapes and Angles', 'Fun with Give and Take',
    'Can You Share?', 'Jugs and Mugs', 'How Heavy? How Light?',
    'Play with Patterns', 'Tens and Ones', 'Give and Take Part 2',
    'Smart Charts', 'Rupees and Paise',
  ];
  const topics: CurriculumTopic[] = chapters.map(t => ({
    grade: 'Class 3', subject: 'Mathematics', unit: 'Maths Mela', topic: t, content_type: 'text',
  }));
  const grouped: CurriculumData['grouped'] = { 'Class 3': { 'Maths Mela': topics.map(t => ({ topic: t.topic, unit: t.unit })) } };
  return { grades: ['Class 3'], topics, grouped, totalTopics: topics.length };
})();

// ─────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────

export default function DashboardScreen({ navigation, route }: any) {
  const { user, refreshProfile } = useAuth();
  // Re-pull profile on focus so a parent's grade/curriculum edit reflects here without re-login.
  useFocusEffect(useCallback(() => { refreshProfile(); }, []));
  const { stats: ctxStats, studentId } = useStudentData();
  const { colors, isDark } = useTheme();
  const { unreadAssignments, unreadCount } = useNotification();
  const { isMobile, isTablet } = useResponsive();
  const styles = useMemo(() => makeStyles(colors, isMobile, isDark), [colors, isMobile, isDark]);

  // ── Parent-view-as-child override ────────────────────────
  const childOverride = route?.params?.childData as {
    name: string; grade: string; curriculum: string;
    xpPoints: number; level: number; currentStreak: number;
    studyTimeMinutes: number; todayStudyMinutes: number; topicsExplored: number;
    completedTopics: string[]; totalTopics: number;
  } | undefined;

  const stats = childOverride ? {
    ...ctxStats,
    xpPoints: childOverride.xpPoints ?? 0,
    level: childOverride.level ?? 1,
    currentStreak: childOverride.currentStreak ?? 0,
    studyTimeMinutes: childOverride.studyTimeMinutes ?? 0,
    topicsExplored: childOverride.topicsExplored ?? 0,
    completedTopics: childOverride.completedTopics ?? [],
    // Was hardcoded to 0 regardless of the child's real value — this is why
    // "Study Time" on the parent's view of a child's dashboard always showed
    // 0m/0% even when the child had genuinely studied today.
    todayStudyMinutes: childOverride.todayStudyMinutes ?? 0,
  } : ctxStats;

  const [searchQuery, setSearchQuery] = useState('');
  const [curriculum, setCurriculum] = useState<CurriculumData>(FALLBACK_CURRICULUM);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [upcomingDeadlines, setUpcomingDeadlines] = useState<{ id: string; title: string; date: string; note: string }[]>([]);
  // Per-topic quiz scores from analytics events
  const [perfData, setPerfData] = useState<{ topics: Record<string, { avgScore: number | null; quizCount: number; sessions: number; lastActivity?: string }>; avgScore: number | null }>({ topics: {}, avgScore: null });
  const [barSubjectFilter, setBarSubjectFilter] = useState<string>('All');
  const [lessonSubjectFilter, setLessonSubjectFilter] = useState<string>('All');

  const heroAnim  = useRef(new Animated.Value(0)).current;
  const bodyAnim  = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const firstName = (childOverride?.name ?? user?.name)?.split(' ')[0] || 'there';
  const curriculumName = childOverride?.curriculum ?? user?.curriculum ?? 'IB PYP';

  // card surfaces — wired to pastel theme tokens
  const cardBg     = colors.cardDark;
  const cardBorder  = colors.borderColor;
  const subtleBg   = colors.cardHover;
  const ringTrack  = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(139,92,246,0.08)';
  // "Today's Goals" cards always use a light pastel gradient (even in dark theme),
  // so their text/track use fixed light-card values regardless of the app theme.
  const goalText      = '#16241B';
  const goalMutedText = '#5C6F62';
  const goalDimText   = '#9FB0A4';
  const goalRingTrack = 'rgba(0,0,0,0.07)';
  const contentMax = isMobile ? undefined : isTablet ? 920 : 1080;

  // ── Data fetching (cache-first) ──────────────────────────
  const childCurriculum = childOverride?.curriculum ?? user?.curriculum;
  const isIBPYP = !childCurriculum || childCurriculum.toLowerCase().includes('ib');
  const studentGrade = childOverride?.grade ?? user?.grade ?? 'Grade 3';
  // Early Years grades have no curriculum content yet — show "coming soon" copy
  // instead of mock topic counts. (client feedback)
  const noContentGrade = ['Nursery', 'LKG', 'UKG'].includes(studentGrade);
  const CACHE_KEY = `dashboard_curriculum_${isIBPYP ? 'ibpyp' : 'ncert'}_${studentGrade}_v1`;
  const CACHE_TTL = 5 * 60 * 1000; // 5 min

  function parseNCERTCurriculum(data: any): CurriculumData {
    const chs: { id: number; topic: string; unit: string }[] = data.chapters || [];
    const grade = data.grade || 'Class 3';
    const topics: CurriculumTopic[] = chs.map(ch => ({
      grade, subject: 'Mathematics',
      unit: ch.unit || 'General', topic: ch.topic, content_type: 'text',
    }));
    const grouped: CurriculumData['grouped'] = {};
    topics.forEach(t => {
      if (!grouped[t.grade]) grouped[t.grade] = {};
      if (!grouped[t.grade][t.unit]) grouped[t.grade][t.unit] = [];
      grouped[t.grade][t.unit].push({ topic: t.topic, unit: t.unit });
    });
    return { grades: [grade], topics, grouped, totalTopics: topics.length };
  }

  function parseIBPYPCurriculum(data: any): CurriculumData {
    // /curriculum returns { topics: [{grade, subject, unit, topic}], grouped, totalTopics }
    const rawTopics: { grade: string; subject: string; unit: string; topic: string }[] = data.topics || [];
    const topics: CurriculumTopic[] = rawTopics.map(t => ({
      grade: t.grade, subject: t.subject,
      unit: t.unit || 'General', topic: t.topic, content_type: 'text',
    }));
    const grouped: CurriculumData['grouped'] = {};
    topics.forEach(t => {
      if (!grouped[t.grade]) grouped[t.grade] = {};
      if (!grouped[t.grade][t.subject]) grouped[t.grade][t.subject] = [];
      grouped[t.grade][t.subject].push({ topic: t.topic, unit: t.unit });
    });
    const grades = [...new Set(topics.map(t => t.grade))].sort();
    return { grades, topics, grouped, totalTopics: data.totalTopics || topics.length };
  }

  useEffect(() => {
    (async () => {
      try {
        const isGrade3 = studentGrade === 'Grade 3' || studentGrade === 'Class 3';
        const useUnified = childOverride || isIBPYP || !isGrade3;

        // 1. Load cache instantly — no waiting
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached) {
          const { data, ts, type } = JSON.parse(cached);
          setCurriculum((childOverride || type === 'ibpyp') ? parseIBPYPCurriculum(data) : parseNCERTCurriculum(data));
          setLoading(false);
          // If cache is fresh, skip network call
          if (Date.now() - ts < CACHE_TTL) return;
        }
        // 2. Fetch fresh data silently in background
        let data: any;
        if (useUnified) {
          // Use unified endpoint for all curricula when viewing a child's dashboard,
          // for all IB PYP, and for CBSE Grade 1-12 (except Grade 3 which has hardcoded /ncert/chapters)
          const curricParam = encodeURIComponent(isIBPYP ? 'IB_PYP' : (childCurriculum ?? 'NCERT'));
          const gradeParam = encodeURIComponent(studentGrade);
          const res = await fetch(`${SERVER_URL}/curriculum?curriculum=${curricParam}&grade=${gradeParam}`);
          if (!res.ok) throw new Error();
          data = await res.json();
          setCurriculum(parseIBPYPCurriculum(data));
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now(), type: 'ibpyp' }));
        } else {
          const res = await fetch(`${SERVER_URL}/ncert/chapters`);
          if (!res.ok) throw new Error();
          data = await res.json();
          setCurriculum(parseNCERTCurriculum(data));
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now(), type: 'ncert' }));
        }
        setLoading(false);
      } catch {
        // show NCERT fallback so dashboard isn't empty if server is down
        setCurriculum(FALLBACK_CURRICULUM);
        setLoading(false);
      }
    })();
  }, [user?.curriculum, user?.grade, childOverride?.curriculum, childOverride?.grade]);

  useEffect(() => {
    if (!studentId || childOverride) return;
    fetch(`${SERVER_URL}/schedule/upcoming?studentId=${studentId}`)
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setUpcomingDeadlines(d); }).catch(() => {});
  }, [studentId, childOverride]);

  // Fetch real quiz scores — on mount AND every time screen comes back into focus (after quiz)
  const fetchPerfData = useCallback(() => {
    if (!studentId || !user?.email || childOverride) return;
    fetch(`${SERVER_URL}/student/${studentId}/performance?email=${encodeURIComponent(user.email)}`)
      .then(r => r.json())
      .then(d => { if (d.topics) setPerfData(d); })
      .catch(() => {});
  }, [studentId, user?.email]);

  useEffect(() => { fetchPerfData(); }, [fetchPerfData]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', fetchPerfData);
    return unsub;
  }, [navigation, fetchPerfData]);

  // ── Derived ──────────────────────────────────────────────
  const completedSet  = useMemo(() => new Set(stats.completedTopics ?? []), [stats.completedTopics]);
  const allLessons    = useMemo(() => {
    if (!curriculum) return [];
    return curriculum.topics.map(t => {
      const perf = perfData.topics[t.topic];
      // Progress = actual quiz score always; completedSet only used for "Mastered" label (≥80%)
      let progress = 0;
      if (perf?.avgScore != null) progress = perf.avgScore;
      else if (completedSet.has(t.topic)) progress = 100; // legacy: completed with no quiz record
      else if (perf?.sessions && perf.sessions > 0) progress = 30;
      return {
        grade: t.grade, subject: t.subject, topic: t.topic, unit: t.unit,
        color: SUBJECT_COLORS[t.subject] ?? BRAND.violet,
        icon: SUBJECT_ICONS[t.subject] ?? 'book-open' as const,
        progress,
        quizScore: perf?.avgScore ?? null,
        quizCount: perf?.quizCount ?? 0,
      };
    });
  }, [curriculum, completedSet, perfData]);

  const featuredLesson = useMemo(() => {
    // Pick the most recently attempted topic (by lastActivity from perfData)
    const withActivity = allLessons
      .filter(l => perfData.topics[l.topic]?.lastActivity)
      .sort((a, b) => {
        const ta = perfData.topics[a.topic]?.lastActivity ?? '';
        const tb = perfData.topics[b.topic]?.lastActivity ?? '';
        return tb.localeCompare(ta); // most recent first
      });
    return withActivity[0] ?? allLessons.find(l => l.progress > 0) ?? allLessons[0];
  }, [allLessons, perfData]);

  const query = normalizeSearchText(searchQuery);
  const queryTerms = query ? query.split(' ') : [];

  const lessonSubjects = useMemo(() =>
    ['All', ...Array.from(new Set(allLessons.map(l => l.subject))).sort()],
  [allLessons]);

  const filteredLessons = useMemo(() => {
    let list = allLessons;
    if (queryTerms.length > 0) {
      list = list.filter(l => {
        const haystack = normalizeSearchText(`${l.topic} ${l.subject} ${l.grade} ${l.unit}`);
        return queryTerms.every(term => haystack.includes(term));
      });
    }
    if (lessonSubjectFilter !== 'All') {
      list = list.filter(l => l.subject === lessonSubjectFilter);
    }
    return list;
  }, [allLessons, queryTerms, lessonSubjectFilter]);

  const filteredDeadlines = queryTerms.length > 0
    ? upcomingDeadlines.filter((u) => {
        const haystack = normalizeSearchText(`${u.title} ${u.note || ''} ${u.date}`);
        return queryTerms.every(term => haystack.includes(term));
      })
    : upcomingDeadlines.slice(0, 4);

  // Performance bar data — topics the student has actually interacted with (has quiz or session)
  const allBarTopics = useMemo(() => {
    if (!curriculum) return [];
    return curriculum.topics.map(t => {
      const perf = perfData.topics[t.topic];
      // Always use actual quiz score — completion status does NOT override performance
      const pct     = perf?.avgScore ?? 0;
      const hasData = pct > 0 || (perf?.sessions ?? 0) > 0;
      const mastered = completedSet.has(t.topic) || pct >= 80;
      return { label: t.topic.split(' ').slice(0, 2).join(' '), fullLabel: t.topic, subject: t.subject, pct, hasData, mastered };
    }).sort((a, b) => (b.hasData ? 1 : 0) - (a.hasData ? 1 : 0));
  }, [curriculum, completedSet, perfData]);

  const barSubjects = useMemo(() => ['All', ...Array.from(new Set(allBarTopics.map(t => t.subject))).sort()], [allBarTopics]);

  const barTopics = useMemo(() =>
    barSubjectFilter === 'All' ? allBarTopics : allBarTopics.filter(t => t.subject === barSubjectFilter),
  [allBarTopics, barSubjectFilter]);

  const avgScore = useMemo(() => {
    // Use real overall avg from analytics if available, else compute from bar
    if (perfData.avgScore != null) return perfData.avgScore;
    const scored = barTopics.filter(t => t.pct > 0);
    return scored.length ? Math.round(scored.reduce((sum, t) => sum + t.pct, 0) / scored.length) : 0;
  }, [barTopics, perfData.avgScore]);

  // Mastered = max of topics explored (real count) or topics with ≥80% quiz score
  const masteredTopics = useMemo(() => {
    const topicsCap = curriculum ? Math.max(curriculum.totalTopics, 1) : 1;
    const highScoreCount = Object.values(perfData.topics).filter(p => (p.avgScore ?? 0) >= 80).length;
    return Math.min(Math.max(stats.topicsExplored ?? 0, highScoreCount), topicsCap);
  }, [perfData, stats.topicsExplored, curriculum]);

  const consistency = useMemo(() => {
    const attempted = barTopics.filter(t => t.pct > 0);
    if (!attempted.length) return 0;
    return Math.round((attempted.filter(t => t.pct >= 60).length / attempted.length) * 100);
  }, [barTopics]);

  // Best topic — only topics with real quiz data
  const bestTopic = useMemo(() => {
    const withScores = barTopics.filter(t => t.pct > 0);
    return withScores.length ? [...withScores].sort((a, b) => b.pct - a.pct)[0] : null;
  }, [barTopics]);

  // Dynamic insight message below bars
  const perfInsight = useMemo(() => {
    const attempted = barTopics.filter(t => t.pct > 0);
    if (!attempted.length) return 'Start a quiz on any topic to see your scores here.';
    const weak = [...attempted].sort((a, b) => a.pct - b.pct)[0];
    const strong = [...attempted].sort((a, b) => b.pct - a.pct)[0];
    if (avgScore >= 80) return `Outstanding! You're mastering ${strong.fullLabel ?? strong.label}. Keep it up!`;
    if (avgScore >= 60) return `Good progress! Focus a bit more on ${weak.fullLabel ?? weak.label} to level up.`;
    return `Keep practising! ${weak.fullLabel ?? weak.label} needs more attention — you can do it!`;
  }, [barTopics, avgScore]);

  // Goals — Study Time is daily; Topics and XP are lifetime totals
  const studyGoal  = 60;  const studyDone  = Math.min(stats.todayStudyMinutes, studyGoal);
  // Topics goal = total topics in student's curriculum for their grade (dynamic)
  const topicsGoal = curriculum ? Math.max(curriculum.totalTopics, 1) : 1;
  // "Mastered" topics — same count used in the hero ("X of Y topics mastered")
  const topicsMastered = completedSet.size;
  const topicsDone = Math.min(topicsMastered, topicsGoal);
  // Badge thresholds: 25%, 50%, 100% of curriculum — purely percentage-based
  const t25 = Math.floor(topicsGoal * 0.25);
  const t50 = Math.floor(topicsGoal * 0.50);
  // Max XP per grade — accounts for quizzes + challenges + assignments
  const XP_MAX_BY_GRADE: Record<string, number> = {
    'Grade 3': 4000, 'Class 3': 4000,
    'Grade 4': 4500, 'Class 4': 4500,
    'Grade 5': 5000, 'Class 5': 5000,
    'Grade 6': 6000, 'Class 6': 6000,
  };
  const xpGoal = XP_MAX_BY_GRADE[studentGrade] ?? 4000;
  const xpDone = Math.min(stats.xpPoints, xpGoal);
  const xp25   = Math.floor(xpGoal * 0.25);
  const xp50   = Math.floor(xpGoal * 0.50);
  // Max level reachable for this grade — the level the XP cap falls into
  const maxLevel = xpForNextLevel(xpGoal).level;

  const GOALS = [
    { label: 'Study Time', val: formatStudyTime(studyDone), target: '1h',
      sub: 'today', raw: studyDone, goal: studyGoal,
      pct: studyGoal > 0 ? studyDone / studyGoal : 0,
      color: BRAND.teal, pastel: PASTEL.teal, icon: 'clock' as const,
      badges: [
        // Unlock when today's study time crosses the threshold — all badges share the card's teal theme
        { icon: 'zap'   as const, label: 'Early Bird', color: BRAND.teal, bg: PASTEL.teal, unlocked: stats.todayStudyMinutes >= 15, tip: '15 min today' },
        { icon: 'sun'   as const, label: 'Half Hour',  color: BRAND.teal, bg: PASTEL.teal, unlocked: stats.todayStudyMinutes >= 30, tip: '30 min today' },
        { icon: 'award' as const, label: 'Study Hero', color: BRAND.teal, bg: PASTEL.teal, unlocked: stats.todayStudyMinutes >= 60, tip: '60 min today' },
      ]},
    { label: 'Topics', val: `${topicsDone} / ${topicsGoal}`, target: `${topicsGoal} topics`,
      sub: 'total', caption: 'topics mastered', raw: topicsDone, goal: topicsGoal,
      pct: topicsDone / topicsGoal,
      color: BRAND.rose, pastel: PASTEL.pink, icon: 'book-open' as const,
      badges: [
        // 25% → Explorer, 50% → Deep Diver, 100% → Scholar — all badges share the card's rose theme
        { icon: 'compass' as const, label: 'Explorer',   color: BRAND.rose, bg: PASTEL.pink, unlocked: topicsMastered >= t25,       tip: `Master ${t25} topics`       },
        { icon: 'layers'  as const, label: 'Deep Diver', color: BRAND.rose, bg: PASTEL.pink, unlocked: topicsMastered >= t50,       tip: `Master ${t50} topics`       },
        { icon: 'book'    as const, label: 'Scholar',    color: BRAND.rose, bg: PASTEL.pink, unlocked: topicsMastered >= topicsGoal, tip: `Master all ${topicsGoal} topics` },
      ]},
    { label: 'XP Earned', val: stats.xpPoints.toLocaleString(), target: `${xpGoal.toLocaleString()} XP`,
      sub: 'total', caption: 'XP earned', raw: xpDone, goal: xpGoal,
      pct: xpDone / xpGoal,
      color: BRAND.gold, pastel: PASTEL.yellow, icon: 'star' as const,
      badges: [
        // 25% / 50% / 100% of grade max XP — all badges share the card's gold theme
        { icon: 'star'        as const, label: 'XP Spark',  color: BRAND.gold, bg: PASTEL.yellow, unlocked: stats.xpPoints >= xp25,   tip: `Earn ${xp25.toLocaleString()} XP`    },
        { icon: 'trending-up' as const, label: 'Leveling',  color: BRAND.gold, bg: PASTEL.yellow, unlocked: stats.xpPoints >= xp50,   tip: `Earn ${xp50.toLocaleString()} XP`    },
        { icon: 'shield'      as const, label: 'XP Master', color: BRAND.gold, bg: PASTEL.yellow, unlocked: stats.xpPoints >= xpGoal,  tip: `Earn all ${xpGoal.toLocaleString()} XP` },
      ]},
  ];

  const STAT_TILES = [
    { icon: 'clock'       as const, val: formatStudyTime(stats.studyTimeMinutes), label: 'Study Time',  color: BRAND.teal,   pastel: PASTEL.teal,   sub: 'this week',     pct: Math.min(stats.studyTimeMinutes / (7 * 60), 1) },
    { icon: 'zap'         as const, val: String(stats.currentStreak),             label: 'Day Streak',  color: BRAND.rose,   pastel: PASTEL.pink,   sub: 'days in a row', pct: Math.min(stats.currentStreak / 14, 1) },
    { icon: 'star'        as const, val: stats.xpPoints.toLocaleString(),         label: 'Total XP',    color: BRAND.gold,   pastel: PASTEL.yellow, sub: 'points earned', pct: Math.min(stats.xpPoints / 5000, 1) },
    { icon: 'book-open'   as const, val: String(topicsMastered),                  label: 'Topics Done', color: BRAND.forest, pastel: PASTEL.green,  sub: 'mastered',      pct: curriculum ? Math.min(topicsMastered / Math.max(curriculum.totalTopics, 1), 1) : 0 },
  ];


  // Animations
  useEffect(() => {
    if (loading || !curriculum) return;
    heroAnim.setValue(0); bodyAnim.setValue(0);
    Animated.parallel([
      Animated.timing(heroAnim, { toValue: 1, duration: 560, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(bodyAnim, { toValue: 1, duration: 720, delay: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [loading, error, curriculum]);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.04, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  return (
    <ScreenLayout>
      <View style={styles.screen}>
        {/* Ambient bg blobs */}
        <View style={styles.blobTL} pointerEvents="none" />
        <View style={styles.blobBR} pointerEvents="none" />

     <Header
  title={childOverride ? `${firstName}'s Dashboard` : `${getGreeting()}, ${firstName}`}
  subtitle={`${curriculumName} · ${studentGrade}`}
  showSearch={false}
  // On mobile the hamburger menu already doubled as "back" here, but on web/
  // desktop onMenuPress is never wired to a visible button at all (it only
  // renders on isMobile) — so a parent viewing a child's dashboard had no
  // visible way back to My Kids. showBack renders a proper back arrow on
  // every platform, and onBack sends them straight to My Kids explicitly
  // rather than relying on navigation history.
  showBack={!!childOverride}
  onBack={childOverride ? () => navigation.navigate('ParentMyKids') : undefined}
  onMenuPress={childOverride ? () => navigation.goBack() : () => navigation.openDrawer()}
  onProfilePress={childOverride ? undefined : () => navigation.navigate('Profile')}
  notificationCount={childOverride ? 0 : unreadCount}
/>

        {/* ── Loading ─────────────────────────────────────── */}
        {loading && (
          <View style={styles.stateCenter}>
            <View style={[styles.stateIconWrap, { backgroundColor: BRAND.violet + '18' }]}>
              <ActivityIndicator size="large" color={BRAND.violet} />
            </View>
            <Text style={styles.stateTitle}>Loading your dashboard</Text>
            <Text style={styles.stateSub}>Fetching your curriculum…</Text>
          </View>
        )}

        {/* ── Error ───────────────────────────────────────── */}
        {!loading && error !== '' && (
          <View style={styles.stateCenter}>
            <View style={[styles.stateIconWrap, { backgroundColor: BRAND.red + '18' }]}>
              <Feather name="wifi-off" size={26} color={BRAND.red} />
            </View>
            <Text style={styles.stateTitle}>Connection Error</Text>
            <Text style={styles.stateSub}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => setError('')} activeOpacity={0.82}>
              <Feather name="refresh-cw" size={13} color="#fff" />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Main content ─────────────────────────────────── */}
        {!loading && !error && curriculum && (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
            <View style={[styles.pageWrap, contentMax ? { maxWidth: contentMax } : undefined]}>

              {/* ══ HERO ══════════════════════════════════════ */}
              <Animated.View style={[{
                opacity: heroAnim,
                transform: [{ translateY: heroAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
              }]}>
                <LinearGradient
                  colors={['#CDEBD7', '#DFF1E5', '#F6E6BE']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.heroCard}
                >
                  <HeroDots />

                  {/* Glow circles */}
                  <View style={styles.heroGlowLeft} />
                  <View style={styles.heroGlowRight} />

                  {/* Top badges */}
                  <View style={styles.heroBadgeRow}>
                    <View style={styles.levelBadge}>
                      <Feather name="shield" size={12} color="#BAA467" />
                      <Text style={styles.levelTxt}>{formatLevel(stats.level)}</Text>
                    </View>
                    <View style={styles.streakBadge}>
                      <FlameIcon size={13} />
                      <Text style={styles.streakTxt}>{stats.currentStreak} day streak</Text>
                    </View>
                  </View>

                  {/* Greeting */}
                  <Text style={styles.heroGreeting}>{getGreeting()},</Text>
                  <Text style={styles.heroName}>{firstName}</Text>
                  <Text style={styles.heroSub}>
                    {(() => {
                      if (noContentGrade) return `Content for ${studentGrade} is on the way — we're adding it now!`;
                      const total = curriculum.totalTopics;
                      const done  = completedSet.size;
                      if (done === 0)              return `${total} topics ready for your first sprint.`;
                      if (done >= total)           return `You've nailed it! All ${total} topics mastered.`;
                      const pct = Math.round((done / total) * 100);
                      if (pct >= 80)               return `So close! ${total - done} topic${total - done === 1 ? '' : 's'} left to complete.`;
                      return `${done} of ${total} topics mastered. Keep going!`;
                    })()}
                  </Text>

                  {/* Level + weekly consistency bar */}
                  <View style={styles.xpBlock}>
                    <View style={styles.xpLabelRow}>
                      <Text style={styles.xpLbl}>{stats.level >= maxLevel ? `Level ${maxLevel} · Max Level` : `Level ${stats.level} → ${stats.level + 1}`}</Text>
                      <Text style={styles.xpNum}>{Math.min(stats.currentStreak, 7)} of 7 days active this week</Text>
                    </View>
                    <View style={styles.xpTrack}>
                      <View style={[styles.xpFill, { width: `${Math.max((Math.min(stats.currentStreak, 7) / 7) * 100, 2)}%` as any }]} />
                    </View>
                    <Text style={styles.xpTotal}>
                      {stats.currentStreak >= 7
                        ? 'Perfect week — keep your streak going!'
                        : `${7 - Math.min(stats.currentStreak, 7)} more day${7 - Math.min(stats.currentStreak, 7) === 1 ? '' : 's'} to a full week streak!`}
                    </Text>
                  </View>

                  {/* CTA — label and destination change based on completion state */}
                  {(() => {
                    const done  = completedSet.size;
                    const total = curriculum.totalTopics;
                    const isComplete = done >= total && total > 0;
                    const isNew      = done === 0;
                    return (
                      <TouchableOpacity
                        style={styles.heroCta}
                        onPress={() => navigation.navigate(isComplete ? 'Challenges' : 'LearningPaths')}
                        activeOpacity={0.85}
                      >
                        <View style={styles.heroCtaPlay}>
                          <Feather name={isComplete ? 'award' : 'play'} size={13} color={BRAND.indigo} />
                        </View>
                        <Text style={styles.heroCtaTxt}>
                          {isComplete ? 'Explore Challenges' : isNew ? 'Start Learning' : 'Resume Learning Path'}
                        </Text>
                        <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.55)" />
                      </TouchableOpacity>
                    );
                  })()}
                </LinearGradient>

              </Animated.View>

              {/* ══ BODY ══════════════════════════════════════ */}
              <Animated.View style={[styles.body, {
                opacity: bodyAnim,
                transform: [{ translateY: bodyAnim.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }],
              }]}>

                {/* ── DAILY GOALS ─────────────────────────────── */}
                <SectionHeader title="Today's Goals" sub="Daily missions • earn XP" onPress={() => navigation.navigate('Progress')} linkLabel="All progress" />

                {isMobile ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.goalsRowScroll}>
                    {GOALS.map(g => {
                      const pct = Math.round(Math.max(0, Math.min(g.pct, 1)) * 100);
                      const left = Math.max(g.goal - g.raw, 0);
                      const helper = left === 0 ? 'Goal unlocked' : `${g.label === 'Study Time' ? formatStudyTime(left) : left} left`;
                      return (
                        <TouchableOpacity key={g.label} style={[styles.goalCardMobile, { borderColor: cardBorder }]} onPress={() => navigation.navigate('Progress')} activeOpacity={0.8}>
                          <LinearGradient
                            colors={isDark ? [g.pastel, '#FFFFFF'] : [g.color + '24', g.pastel]}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                            style={styles.goalCardGradient}
                          >
                            <View style={styles.goalTopRow}>
                              <View style={[styles.goalIconOrb, { backgroundColor: g.color + '35', borderColor: g.color + '60' }]}>
                                <Feather name={g.icon} size={15} color={g.color} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.goalTitle, { color: goalText }]}>{g.label}</Text>
                                <Text style={[styles.goalMeta, { color: goalMutedText }]}>Target {g.target}</Text>
                              </View>
                              <View style={[styles.goalStatusPill, { backgroundColor: g.color + '28', borderColor: g.color + '55' }]}>
                                <Text style={[styles.goalStatusTxt, { color: g.color }]}>{pct}%</Text>
                              </View>
                            </View>
                            <View style={styles.goalMidRow}>
                              <View style={styles.goalRingWrap}>
                                <RingChart progress={g.pct} color={g.color} size={72} stroke={7} track={goalRingTrack} />
                                <View style={styles.goalRingCenter}>
                                  <Text style={[styles.goalPct, { color: g.color }]}>{pct}%</Text>
                                  <Text style={[styles.goalRingSub, { color: goalMutedText }]}>{pct >= 100 ? 'Done' : 'Go'}</Text>
                                </View>
                              </View>
                              <View style={styles.goalValueWrap}>
                                <Text style={[styles.goalVal, { color: goalText }]}>{g.val}</Text>
                                <Text style={[styles.goalTarget, { color: goalDimText }]}>{(g as any).caption ?? ((g as any).sub === 'total' ? 'total completed' : 'completed today')}</Text>
                                <View style={[styles.goalMiniMeta, { backgroundColor: g.color + '25', borderColor: g.color + '50' }]}>
                                  <Feather name="target" size={10} color={g.color} />
                                  <Text style={[styles.goalMiniMetaTxt, { color: g.color }]}>{helper}</Text>
                                </View>
                              </View>
                            </View>
                          </LinearGradient>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                ) : (
                <View style={styles.goalsRow}>
                  {GOALS.map(g => {
                    const pct = Math.round(Math.max(0, Math.min(g.pct, 1)) * 100);
                    const left = Math.max(g.goal - g.raw, 0);
                    const helper = left === 0 ? 'Goal unlocked' : `${g.label === 'Study Time' ? formatStudyTime(left) : left} left`;
                    return (
                      <TouchableOpacity key={g.label} style={[styles.goalCard, { borderColor: cardBorder }]} onPress={() => navigation.navigate('Progress')} activeOpacity={0.8}>
                        <LinearGradient
                          colors={isDark ? [g.pastel, '#FFFFFF'] : [g.color + '24', g.pastel]}
                          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                          style={styles.goalCardGradient}
                        >
                          {/* Top row: icon + title + meta, no pill (ring shows %) */}
                          <View style={styles.goalTopRow}>
                            <View style={[styles.goalIconOrb, { backgroundColor: g.color + '35', borderColor: g.color + '60' }]}>
                              <Feather name={g.icon} size={15} color={g.color} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.goalTitle, { color: goalText }]}>{g.label}</Text>
                              <Text style={[styles.goalMeta, { color: goalMutedText }]}>Target {g.target}</Text>
                            </View>
                            <View style={[styles.goalStatusPill, { backgroundColor: g.color + '28', borderColor: g.color + '55' }]}>
                              <Text style={[styles.goalStatusTxt, { color: g.color }]}>{pct}%</Text>
                            </View>
                          </View>

                          <View style={styles.goalMidRow}>
                            {/* Ring */}
                            <View style={styles.goalRingWrap}>
                              <RingChart progress={g.pct} color={g.color} size={72} stroke={7} track={goalRingTrack} />
                              <View style={styles.goalRingCenter}>
                                <Text style={[styles.goalPct, { color: g.color }]}>{pct}%</Text>
                                <Text style={[styles.goalRingSub, { color: goalMutedText }]}>{pct >= 100 ? 'Done' : 'Go'}</Text>
                              </View>
                            </View>
                            {/* Value + helper — centered vertically */}
                            <View style={styles.goalValueWrap}>
                              <Text style={[styles.goalVal, { color: goalText }]}>{g.val}</Text>
                              <Text style={[styles.goalTarget, { color: goalDimText }]}>{(g as any).caption ?? ((g as any).sub === 'total' ? 'total completed' : 'completed today')}</Text>
                              <View style={[styles.goalMiniMeta, { backgroundColor: g.color + '25', borderColor: g.color + '50' }]}>
                                <Feather name="target" size={10} color={g.color} />
                                <Text style={[styles.goalMiniMetaTxt, { color: g.color }]}>{helper}</Text>
                              </View>
                            </View>
                            {/* Badges — right column, evenly spaced */}
                            <View style={styles.goalBadgesRight}>
                              {g.badges.map((b) => (
                                <View key={b.label} style={styles.goalBadgeMedalWrap}>
                                  <View style={[styles.goalBadgeMedal, {
                                    backgroundColor: b.unlocked ? b.bg : '#f2f2f2',
                                    borderColor:     b.unlocked ? b.color : '#e0e0e0',
                                    shadowColor:     b.unlocked ? b.color : 'transparent',
                                    shadowOffset:    { width: 0, height: 3 },
                                    shadowOpacity:   b.unlocked ? 0.45 : 0,
                                    shadowRadius:    7,
                                    elevation:       b.unlocked ? 5 : 0,
                                  }]}>
                                    {b.unlocked && <View style={[styles.goalBadgeGlow, { backgroundColor: b.color + '18' }]} />}
                                    <Feather name={b.icon} size={15} color={b.unlocked ? b.color : '#cccccc'} />
                                    {b.unlocked && (
                                      <View style={[styles.goalBadgeCheckDot, { backgroundColor: b.color, borderColor: '#fff' }]}>
                                        <Feather name="check" size={6} color="#fff" />
                                      </View>
                                    )}
                                  </View>
                                  <Text style={[styles.goalBadgeMedalLabel, {
                                    color: b.unlocked ? b.color : '#c0c0c0',
                                    fontWeight: b.unlocked ? '700' : '400',
                                  }]} numberOfLines={1}>{b.label}</Text>
                                </View>
                              ))}
                            </View>
                          </View>

                          <View style={[styles.goalBar, { backgroundColor: g.color + '25' }]}>
                            <View style={[styles.goalBarFill, { width: `${Math.max(g.pct * 100, 3)}%` as any, backgroundColor: g.color }]} />
                          </View>
                        </LinearGradient>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                )}

                {/* ── PERFORMANCE CHART ───────────────────────── */}
                <View style={[styles.perfCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
                  <LinearGradient
                    colors={isDark ? [BRAND.indigo + '40', BRAND.violet + '28'] : [BRAND.indigo + '14', BRAND.violet + '0a']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={styles.perfHeaderGradient}
                  >
                    <View>
                      <Text style={[styles.perfCardTitle, { color: colors.textMain }]}>Performance</Text>
                      <Text style={[styles.perfCardSub, { color: colors.textMuted }]}>Topic scores at a glance</Text>
                    </View>
                    <TouchableOpacity style={[styles.perfViewAll, { backgroundColor: isDark ? BRAND.indigo + '35' : BRAND.indigo + '15', borderColor: isDark ? BRAND.indigo + '65' : BRAND.indigo + '40' }]} onPress={() => navigation.navigate('Progress')} activeOpacity={0.75}>
                      <Text style={[styles.perfViewAllTxt, { color: BRAND.indigo }]}>View all</Text>
                    </TouchableOpacity>
                  </LinearGradient>

                  <View style={styles.perfInsightRow}>
                    <View style={[styles.perfInsightPill, styles.perfInsightPillWide, { backgroundColor: isDark ? BRAND.indigo + '38' : BRAND.indigo + '18', borderColor: isDark ? BRAND.indigo + '70' : BRAND.indigo + '40' }]}>
                      <Text style={[styles.perfInsightValue, { color: BRAND.indigo }]}>{avgScore}%</Text>
                      <Text style={[styles.perfInsightLabel, { color: colors.textMuted }]}>Average score</Text>
                    </View>
                    <View style={[styles.perfInsightPill, { backgroundColor: isDark ? BRAND.green + '38' : BRAND.green + '18', borderColor: isDark ? BRAND.green + '70' : BRAND.green + '40' }]}>
                      <Text style={[styles.perfInsightValue, { color: BRAND.green }]}>{masteredTopics}/{topicsGoal}</Text>
                      <Text style={[styles.perfInsightLabel, { color: colors.textMuted }]}>Mastered</Text>
                    </View>
                    <View style={[styles.perfInsightPill, { backgroundColor: isDark ? BRAND.orange + '38' : BRAND.orange + '18', borderColor: isDark ? BRAND.orange + '70' : BRAND.orange + '40' }]}>
                      <Text style={[styles.perfInsightValue, { color: BRAND.orange }]}>{consistency}%</Text>
                      <Text style={[styles.perfInsightLabel, { color: colors.textMuted }]}>Consistency</Text>
                    </View>
                  </View>

                  <View style={[styles.bestScoreRow, { backgroundColor: isDark ? BRAND.indigo + '20' : BRAND.indigo + '10', borderColor: isDark ? BRAND.indigo + '50' : BRAND.indigo + '30' }]}>
                    <View style={[styles.bestScoreIcon, { backgroundColor: isDark ? BRAND.indigo + '40' : BRAND.indigo + '20' }]}>
                      <Feather name="award" size={14} color={BRAND.indigo} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.bestScoreLabel, { color: colors.textMuted }]}>Best score</Text>
                      <Text style={[styles.bestScoreVal, { color: colors.textMain }]}>
                        {bestTopic ? `${bestTopic.pct}%` : '—'}{' '}
                        <Text style={[styles.bestScoreTopic, { color: colors.textMuted }]}>
                          {bestTopic ? (bestTopic.fullLabel ?? bestTopic.label) : 'No quizzes yet'}
                        </Text>
                      </Text>
                    </View>
                    <View style={styles.bestScoreSplit} />
                    <View style={styles.bestScoreMeta}>
                      <Text style={[styles.bestScoreMetaVal, { color: colors.textMain }]}>{consistency}%</Text>
                      <Text style={[styles.bestScoreMetaLbl, { color: colors.textMuted }]}>weekly consistency</Text>
                    </View>
                    <TouchableOpacity style={[styles.allLessonsBtn, { borderColor: cardBorder }]} onPress={() => navigation.navigate('LearningPaths')} activeOpacity={0.78}>
                      <Text style={[styles.allLessonsTxt, { color: colors.textMuted }]}>All topics</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Subject filter chips */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                    {barSubjects.map(subj => {
                      const active = barSubjectFilter === subj;
                      return (
                        <TouchableOpacity
                          key={subj}
                          onPress={() => setBarSubjectFilter(subj)}
                          style={[styles.barChip, { backgroundColor: active ? BRAND.indigo : (isDark ? BRAND.indigo + '20' : BRAND.indigo + '12'), borderColor: active ? BRAND.indigo : (isDark ? BRAND.indigo + '50' : BRAND.indigo + '30') }]}
                          activeOpacity={0.75}
                        >
                          <Text style={[styles.barChipTxt, { color: active ? '#fff' : BRAND.indigo }]}>{subj}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  {/* Bar chart — all topics, scrollable */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.barScroll} contentContainerStyle={{ gap: 16, paddingVertical: 4, paddingRight: 6 }}>
                    {barTopics.map((t, i) => {
                      const barColors = [
                        ['#BAA467', '#C5BD96'],
                        ['#BAA467', '#C5BD96'],
                        ['#BAA467', '#C5BD96'],
                        ['#BAA467', '#C5BD96'],
                        ['#BAA467', '#C5BD96'],
                        ['#BAA467', '#C5BD96'],
                      ];
                      const [c1, c2] = barColors[i % barColors.length];
                      return (
                        <View key={`${t.fullLabel}-${i}`} style={styles.barCol}>
                          <Text style={[styles.barPct, { color: t.hasData ? c1 : colors.textDim }]}>{t.pct}%</Text>
                          <View style={[styles.barTrack, { borderColor: c1 + '40' }]}>
                            <LinearGradient
                              colors={t.hasData ? [c1, c2] : [colors.borderColor, colors.borderColor]}
                              start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                              style={[styles.barFill, { height: `${Math.max(t.pct, 4)}%` as any }]}
                            />
                          </View>
                          <Text style={[styles.barLabel, { color: colors.textDim }]} numberOfLines={2}>{t.label}</Text>
                          <Text style={[styles.barSubject, { color: colors.textMuted }]} numberOfLines={1}>{t.subject}</Text>
                        </View>
                      );
                    })}
                  </ScrollView>

                  {/* Dynamic insight based on real performance */}
                  <View style={[styles.perfInsightText, { backgroundColor: isDark ? BRAND.indigo + '18' : BRAND.indigo + '0C', borderColor: isDark ? BRAND.indigo + '40' : BRAND.indigo + '25' }]}>
                    <Feather name="zap" size={12} color={BRAND.indigo} />
                    <Text style={[styles.perfInsightMsg, { color: colors.textMuted }]}>{perfInsight}</Text>
                  </View>
                </View>

                {/* ── QUICK ACTIONS ── hidden in parent child-view mode ── */}
                {!childOverride && <SectionHeader title="Quick Actions" sub="Jump anywhere instantly" />}
                {!childOverride && <View style={styles.quickGrid}>
                  {QUICK_NAV.map(item => (
                    <TouchableOpacity
                      key={item.label}
                      style={[styles.quickCard, { backgroundColor: isDark ? cardBg : item.pastel, borderColor: isDark ? item.color + '40' : 'transparent' }]}
                      onPress={() => navigation.navigate(item.screen)}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.quickIconBox, { backgroundColor: isDark ? item.color + '20' : item.color + '22' }]}>
                        <Feather name={item.icon} size={20} color={item.color} />
                      </View>
                      <View style={styles.quickArrowBox}>
                        <Feather name="arrow-up-right" size={13} color={item.color + 'cc'} />
                      </View>
                      <Text style={[styles.quickLabel, { color: colors.textMain }]}>{item.label}</Text>
                      <Text style={[styles.quickDesc, { color: colors.textMuted }]}>{item.desc}</Text>
                    </TouchableOpacity>
                  ))}
                </View>}

                {/* ── CONTINUE LEARNING ───────────────────────── */}
                {featuredLesson && (
                  <>
                    <SectionHeader title="Continue Learning" sub="Pick up where you left off" />
                    <TouchableOpacity
                      style={[styles.clCard, { backgroundColor: cardBg, borderColor: featuredLesson.color + '30' }]}
                      onPress={() => navigation.navigate('VideoLesson', { topic: featuredLesson.topic, grade: featuredLesson.grade, subject: featuredLesson.subject, curriculum: isIBPYP ? 'IB_PYP' : 'NCERT' })}
                      activeOpacity={0.86}
                    >
                      <View style={[styles.clStrip, { backgroundColor: featuredLesson.color }]} />
                      <View style={styles.clBody}>
                        <View style={styles.clTopRow}>
                          <View style={{ flex: 1, gap: 5 }}>
                            <View style={[styles.clSubPill, { backgroundColor: featuredLesson.color + '15', borderColor: featuredLesson.color + '35' }]}>
                              <Feather name={featuredLesson.icon} size={11} color={featuredLesson.color} />
                              <Text style={[styles.clSubText, { color: featuredLesson.color }]}>{featuredLesson.subject} · {featuredLesson.grade}</Text>
                            </View>
                            <Text style={[styles.clTopic, { color: colors.textMain }]}>{featuredLesson.topic}</Text>
                            <Text style={[styles.clUnit, { color: colors.textMuted }]}>{featuredLesson.unit}</Text>
                          </View>
                          {/* Ring on right */}
                          <View style={styles.clRingWrap}>
                            <RingChart progress={featuredLesson.progress / 100} color={featuredLesson.color} size={68} stroke={7} track={ringTrack} />
                            <View style={styles.clRingCenter}>
                              <Text style={[styles.clRingPct, { color: featuredLesson.color }]}>{featuredLesson.progress}%</Text>
                              <Text style={[styles.clRingDone, { color: colors.textDim }]}>done</Text>
                            </View>
                          </View>
                        </View>

                        {/* Stage dots */}
                        <View style={styles.stageRow}>
                          {['Learn', 'Practice', 'Master'].map((s, i, arr) => {
                            const done = featuredLesson.progress >= (i + 1) * 33;
                            return (
                              <React.Fragment key={s}>
                                <View style={styles.stageNode}>
                                  <View style={[styles.stageDot, { backgroundColor: done ? featuredLesson.color : colors.borderColor }]}>
                                    {done && <Feather name="check" size={8} color="#fff" />}
                                  </View>
                                  <Text style={[styles.stageLbl, { color: done ? featuredLesson.color : colors.textDim }]}>{s}</Text>
                                </View>
                                {i < arr.length - 1 && <View style={[styles.stageLine, { backgroundColor: done ? featuredLesson.color + '60' : colors.borderColor }]} />}
                              </React.Fragment>
                            );
                          })}
                        </View>

                        {/* Bottom row */}
                        <View style={styles.clBottomRow}>
                          <Text style={[styles.clHint, { color: colors.textMuted }]}>
                            {featuredLesson.progress >= 100 ? 'Mastered! Review to retain.' : featuredLesson.progress > 0 ? 'Great progress — keep going.' : 'Start to build your foundation.'}
                          </Text>
                          <View style={[styles.clCtaBtn, { backgroundColor: featuredLesson.color }]}>
                            <Text style={styles.clCtaTxt}>{featuredLesson.progress >= 100 ? 'Review' : featuredLesson.progress > 0 ? 'Continue' : 'Start'}</Text>
                            <Feather name="arrow-right" size={12} color="#fff" />
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </>
                )}

                {/* ── AI COACH BANNER ─────────────────────────── */}
                <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                  <TouchableOpacity onPress={() => navigation.navigate('AICoach')} activeOpacity={0.88}>
                    <LinearGradient
                      colors={['#CDEBD7', '#DFF1E5', '#F6E6BE']}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                      style={styles.aiBanner}
                    >
                      <View style={styles.aiGlow} />
                      {/* AI avatar */}
                      <View style={styles.aiAvatarWrap}>
                        <View style={styles.aiAvatarOuter}>
                          <View style={styles.aiAvatarInner}>
                            <Feather name="cpu" size={22} color="#0B0B0B" />
                          </View>
                        </View>
                        <View style={styles.aiOnline} />
                      </View>
                      <View style={styles.aiBannerBody}>
                        <Text style={styles.aiTag}>AIVORAH AI COACH</Text>
                        <Text style={styles.aiTitle}>Ask me anything</Text>
                        <Text style={styles.aiSub}>Maths, Science, any topic — patient & always here.</Text>
                      </View>
                      <View style={styles.aiBannerCta}>
                        <Feather name="message-circle" size={20} color="rgba(11,11,11,0.85)" />
                        <Text style={styles.aiBannerCtaTxt}>Chat now</Text>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                </Animated.View>

                {/* ── PROGRESS SNAPSHOT ───────────────────────── */}
                {/* ── LEARNING PATH ───────────────────────────── */}
                {noContentGrade ? (
                  <View style={[styles.lessonContainer, { backgroundColor: cardBg, borderColor: cardBorder, alignItems: 'center', padding: 28, gap: 10, marginTop: 8 }]}>
                    <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: BRAND.violet + '15', alignItems: 'center', justifyContent: 'center' }}>
                      <Feather name="clock" size={22} color={BRAND.violet} />
                    </View>
                    <Text style={[styles.lessonTopic, { color: colors.textMain, fontSize: 17, textAlign: 'center' }]}>Lessons for {studentGrade} are coming soon</Text>
                    <Text style={[styles.lessonMeta, { color: colors.textMuted, textAlign: 'center', lineHeight: 20, maxWidth: 380 }]}>
                      Our team is carefully crafting playful, age-appropriate learning experiences for {studentGrade}. We'll let you know the moment they're ready to explore.
                    </Text>
                  </View>
                ) : (
                <>
                <SectionHeader title="Learning Path" sub={`${curriculum.totalTopics} topics in your curriculum`} onPress={() => navigation.navigate('LearningPaths')} linkLabel={`See all ${curriculum.totalTopics}`} />

                {/* Subject filter chips */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                  {lessonSubjects.map(subj => {
                    const active = lessonSubjectFilter === subj;
                    return (
                      <TouchableOpacity
                        key={subj}
                        onPress={() => setLessonSubjectFilter(subj)}
                        style={[styles.barChip, { backgroundColor: active ? BRAND.violet : (isDark ? BRAND.violet + '20' : BRAND.violet + '12'), borderColor: active ? BRAND.violet : (isDark ? BRAND.violet + '50' : BRAND.violet + '30') }]}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.barChipTxt, { color: active ? '#fff' : BRAND.violet }]}>{subj}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {filteredLessons.length === 0 ? (
                  <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
                    <Feather name="search" size={22} color={colors.textDim} />
                    <Text style={[styles.emptyTxt, { color: colors.textMuted }]}>No topics match "{searchQuery}"</Text>
                  </View>
                ) : (
                  <View style={[styles.lessonContainer, { backgroundColor: cardBg, borderColor: cardBorder }]}>
                    {filteredLessons.map((item, idx) => {
                      const stage = item.progress >= 100 ? 'Mastered' : item.progress > 0 ? 'In Progress' : 'Not Started';
                      const cta   = item.progress >= 100 ? 'Review' : item.progress > 0 ? 'Continue' : 'Start';
                      const scoreLabel = (item as any).quizScore != null ? `${(item as any).quizScore}%` : null;
                      return (
                        <TouchableOpacity
                          key={`${item.grade}-${item.topic}`}
                          style={[styles.lessonRow, idx < filteredLessons.length - 1 && { borderBottomWidth: 1, borderBottomColor: cardBorder }]}
                          onPress={() => navigation.navigate('VideoLesson', { topic: item.topic, grade: item.grade, subject: item.subject, curriculum: isIBPYP ? 'IB_PYP' : 'NCERT' })}
                          activeOpacity={0.78}
                        >
                          <View style={[styles.lessonDot, { backgroundColor: item.color }]} />
                          <View style={[styles.lessonIconBox, { backgroundColor: item.color + '15' }]}>
                            <Feather name={item.icon} size={15} color={item.color} />
                          </View>
                          <View style={styles.lessonMid}>
                            <Text style={[styles.lessonTopic, { color: colors.textMain }]} numberOfLines={1}>{item.topic}</Text>
                            <Text style={[styles.lessonMeta, { color: colors.textMuted }]}>{item.subject} · {item.grade}</Text>
                            <View style={[styles.lessonBar, { backgroundColor: item.color + '15' }]}>
                              <View style={[styles.lessonBarFill, { width: `${Math.max(item.progress, 3)}%` as any, backgroundColor: item.color }]} />
                            </View>
                          </View>
                          <View style={styles.lessonRight}>
                            <View style={[styles.stagePill, {
                              backgroundColor: item.progress >= 100 ? BRAND.green + '18' : item.progress > 0 ? BRAND.blue + '18' : subtleBg,
                              borderColor:     item.progress >= 100 ? BRAND.green + '45' : item.progress > 0 ? BRAND.blue + '45' : cardBorder,
                            }]}>
                              <Text style={[styles.stagePillTxt, { color: item.progress >= 100 ? BRAND.green : item.progress > 0 ? BRAND.blue : colors.textDim }]}>
                                {scoreLabel ? `${scoreLabel} · ${stage}` : stage}
                              </Text>
                            </View>
                            <View style={[styles.lessonCta, { backgroundColor: item.color + '12', borderColor: item.color + '35' }]}>
                              <Text style={[styles.lessonCtaTxt, { color: item.color }]}>{cta}</Text>
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                </>
                )}

                {/* ── UPCOMING DEADLINES ──────────────────────── */}
                <SectionHeader title="Upcoming Deadlines" sub="Assignments & tasks" onPress={() => navigation.navigate('Assignments')} linkLabel="View all" />

                {filteredDeadlines.length === 0 ? (
                  <View style={[styles.emptyCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
                    <Feather name="calendar" size={22} color={colors.textDim} />
                    <Text style={[styles.emptyTxt, { color: colors.textMuted }]}>
                      {query ? `No deadlines match "${searchQuery}"` : 'No upcoming deadlines. Your teacher will assign work here.'}
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.deadlineCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
                    {filteredDeadlines.map((item, idx) => {
                      const urgent = isDueToday(item.date);
                      return (
                        <TouchableOpacity
                          key={item.id}
                          style={[styles.deadlineRow, idx < filteredDeadlines.length - 1 && { borderBottomWidth: 1, borderBottomColor: cardBorder }]}
                          onPress={() => navigation.navigate('Schedule')}
                          activeOpacity={0.75}
                        >
                          <View style={styles.deadlineTimeline}>
                            <View style={[styles.deadlineDot, { backgroundColor: urgent ? BRAND.red : BRAND.green }]} />
                            {idx < filteredDeadlines.length - 1 && <View style={[styles.deadlineLine, { backgroundColor: cardBorder }]} />}
                          </View>
                          <View style={styles.deadlineBody}>
                            <Text style={[styles.deadlineTitle, { color: colors.textMain }]}>{item.title}</Text>
                            {item.note ? <Text style={[styles.deadlineNote, { color: colors.textMuted }]}>{item.note}</Text> : null}
                          </View>
                          <View style={[styles.dueBadge, { backgroundColor: (urgent ? BRAND.red : BRAND.green) + '15', borderColor: (urgent ? BRAND.red : BRAND.green) + '35' }]}>
                            <Text style={[styles.dueTxt, { color: urgent ? BRAND.red : BRAND.green }]}>{formatDeadline(item.date)}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                <View style={{ height: 36 }} />
              </Animated.View>
            </View>
          </ScrollView>
        )}

      </View>
      
    </ScreenLayout>
  );
}

// ─────────────────────────────────────────────────────────
// Section Header Component
// ─────────────────────────────────────────────────────────

function SectionHeader({ title, sub, onPress, linkLabel }: { title: string; sub?: string; onPress?: () => void; linkLabel?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
      <View>
        <Text style={{ fontSize: 17, fontWeight: '800', color: colors.textMain, letterSpacing: -0.3, fontFamily: fonts.serif }}>{title}</Text>
        {sub ? <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {onPress && linkLabel ? (
        <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: BRAND.violet }}>{linkLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────

const makeStyles = (c: AppColors, isMobile: boolean, isDark: boolean) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  blobTL: { display: 'none' },
  blobBR: { display: 'none' },

  scroll:    { flex: 1 },
  scrollPad: { padding: isMobile ? 14 : 20, paddingBottom: 48 },
  pageWrap:  { width: '100%', alignSelf: 'center', gap: 16 },
  body:      { gap: 14 },

  // State screens
  stateCenter:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  stateIconWrap: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: BRAND.indigo + '18' },
  stateTitle:    { fontSize: 18, fontWeight: '700', color: c.textMain, fontFamily: fonts.serif },
  stateSub:      { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 20 },
  retryBtn:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: BRAND.violet, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12, marginTop: 6 },
  retryText:     { fontSize: 14, fontWeight: '700', color: '#fff' },

  // ── Hero ──────────────────────────────────────────────
  heroCard: {
    borderRadius: 22, padding: 20, paddingBottom: 18, overflow: 'hidden', position: 'relative', minHeight: 165,
    borderWidth: 1, borderColor: 'rgba(245,243,238,0.16)',
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
  },
  heroGlowLeft:  { display: 'none' },
  heroGlowRight: { display: 'none' },

  heroBadgeRow: { flexDirection: 'row', gap: 8, marginBottom: 14, zIndex: 2 },
  levelBadge:   { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(11,11,11,0.12)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(11,11,11,0.18)' },
  levelTxt:     { fontSize: 10, fontWeight: '800', color: '#0B0B0B', letterSpacing: 0.2 },
  streakBadge:  { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(11,11,11,0.12)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(11,11,11,0.18)' },
  streakTxt:    { fontSize: 10, fontWeight: '700', color: '#0B0B0B' },

  heroGreeting: { fontSize: 12, fontWeight: '700', color: 'rgba(11,11,11,0.6)', zIndex: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroName:     { fontFamily: fonts.serif, fontSize: isMobile ? 30 : 38, fontWeight: '500', color: '#0B0B0B', letterSpacing: -0.5, lineHeight: isMobile ? 34 : 44, marginBottom: 4, zIndex: 1 },
  heroSub:      { fontSize: 12, color: 'rgba(11,11,11,0.78)', fontWeight: '500', lineHeight: 18, marginBottom: 14, zIndex: 1, maxWidth: '90%' },

  xpBlock:    { zIndex: 1, marginBottom: 14 },
  xpLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  xpLbl:      { fontSize: 10, fontWeight: '800', color: 'rgba(11,11,11,0.7)' },
  xpNum:      { fontSize: 10, fontWeight: '800', color: 'rgba(11,11,11,0.7)' },
  xpTrack:    { height: 8, backgroundColor: 'rgba(11,11,11,0.18)', borderRadius: 4, overflow: 'hidden' },
  xpFill:     { height: '100%', backgroundColor: '#0B0B0B', borderRadius: 4 },
  xpTotal:    { fontSize: 10, fontWeight: '700', color: 'rgba(11,11,11,0.62)', marginTop: 6 },

  heroCta:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0B0B0B', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'flex-start', zIndex: 1 },
  heroCtaPlay:  { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  heroCtaTxt:   { fontSize: 13, fontWeight: '800', color: '#fff', flex: 1 },

  heroChipOutside: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 1, shadowColor: '#000', shadowOpacity: isDark ? 0.2 : 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  heroChipDot: { width: 6, height: 6, borderRadius: 3 },
  heroChipValOutside: { fontSize: 16, fontWeight: '900', letterSpacing: -0.5 },
  heroChipLblOutside: { fontSize: 10, fontWeight: '600', marginTop: -1 },

  // ── Goals ─────────────────────────────────────────────
  goalsRow:       { flexDirection: 'row', gap: 12 },
  goalsRowMobile: { flexWrap: 'wrap' },
  goalsRowScroll: { flexDirection: 'row', gap: 10, paddingHorizontal: 2, paddingBottom: 4 },
  goalCard: {
    flex: 1,
    borderRadius: 22, borderWidth: 1, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: isDark ? 0.25 : 0.09, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
  },
  goalCardMobile: {
    width: Math.round(SCREEN_WIDTH * 0.72),
    borderRadius: 22, borderWidth: 1, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: isDark ? 0.25 : 0.09, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
  },
  goalCardGradient: { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  goalTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  goalTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  goalIconOrb: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  goalTitle: { fontSize: 13, fontWeight: '800', letterSpacing: -0.2 },
  goalMeta: { fontSize: 9.5, marginTop: 1 },
  goalStatusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  goalStatusTxt: { fontSize: 10, fontWeight: '800' },
  goalMidRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  goalBadgesRight: { flexDirection: 'column', gap: 4, alignItems: 'center', justifyContent: 'space-evenly', alignSelf: 'stretch' },
  goalBadgeMedalWrap: { alignItems: 'center', gap: 2 },
  goalBadgeMedal: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative', overflow: 'visible',
  },
  goalBadgeGlow: {
    position: 'absolute', width: 34, height: 34, borderRadius: 17,
  },
  goalBadgeCheckDot: {
    position: 'absolute', bottom: -2, right: -2,
    width: 12, height: 12, borderRadius: 6, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  goalBadgeMedalLabel: { fontSize: 7.5, textAlign: 'center', letterSpacing: 0.2 },
  goalRingWrap:   { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  goalRingCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  goalPct:        { fontSize: 15, fontWeight: '900', letterSpacing: -0.6 },
  goalRingSub:    { fontSize: 8, fontWeight: '700', marginTop: -1, textTransform: 'uppercase', letterSpacing: 0.5 },
  goalValueWrap:  { flex: 1, gap: 2, justifyContent: 'center' },
  goalVal:        { fontSize: 24, fontWeight: '900', letterSpacing: -1.1, lineHeight: 26 },
  goalTarget:     { fontSize: 10 },
  goalMiniMeta:   { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, marginTop: 2 },
  goalMiniMetaTxt:{ fontSize: 10, fontWeight: '700' },
  goalBar:        { width: '100%', height: 6, borderRadius: 999, overflow: 'hidden' },
  goalBarFill:    { height: '100%', borderRadius: 999 },

  // ── Performance card ──────────────────────────────────
  perfCard: {
    borderRadius: 24, borderWidth: 1, padding: 14,
    shadowColor: '#000', shadowOpacity: isDark ? 0.2 : 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
  },
  perfCardHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  perfHeaderGradient: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 12 },
  perfCardTitle:   { fontSize: 16, fontWeight: '800', letterSpacing: -0.2, fontFamily: fonts.serif },
  perfCardSub:     { fontSize: 11, marginTop: 2 },
  perfViewAll:     { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  perfViewAllTxt:  { fontSize: 11, fontWeight: '700' },
  perfInsightRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  perfInsightPill: { minWidth: 110, flex: 1, borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 9 },
  perfInsightPillWide: { minWidth: 130 },
  perfInsightValue: { fontSize: 17, fontWeight: '900', letterSpacing: -0.6 },
  perfInsightLabel: { fontSize: 10, marginTop: 2 },

  bestScoreRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14 },
  bestScoreIcon:   { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bestScoreLabel:  { fontSize: 10, fontWeight: '600', marginBottom: 2 },
  bestScoreVal:    { fontSize: 18, fontWeight: '900', letterSpacing: -0.5 },
  bestScoreTopic:  { fontSize: 12, fontWeight: '400' },
  bestScoreSplit:  { width: 1, height: 34, backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(2,6,23,0.1)' },
  bestScoreMeta:   { marginRight: 4 },
  bestScoreMetaVal:{ fontSize: 15, fontWeight: '900', letterSpacing: -0.4 },
  bestScoreMetaLbl:{ fontSize: 9, marginTop: 1 },
  allLessonsBtn:   { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  allLessonsTxt:   { fontSize: 11, fontWeight: '600' },
  perfInsightText: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginTop: 4 },
  perfInsightMsg:  { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '500' },
  barChip:         { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  barChipTxt:      { fontSize: 11, fontWeight: '700' },
  barSubject:      { fontSize: 9, fontWeight: '500', textAlign: 'center', marginTop: 2 },

  barScroll: { marginTop: 2 },
  barCol:    { alignItems: 'center', width: 52, gap: 6 },
  barTrack:  { width: 34, height: 116, borderRadius: 12, borderWidth: 1, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(2,6,23,0.04)', overflow: 'hidden', justifyContent: 'flex-end', padding: 2 },
  barFill:   { width: '100%', borderRadius: 10 },
  barPct:    { fontSize: 11, fontWeight: '900' },
  barLabel:  { fontSize: 9, textAlign: 'center', lineHeight: 12, width: 52 },

  // ── Quick actions ─────────────────────────────────────
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickCard: {
    width: isMobile ? Math.floor((SCREEN_WIDTH - 28 - 28 - 10) / 2) : '32.1%',
    borderWidth: 1, borderRadius: 18, padding: 14, gap: 8,
    shadowColor: '#000', shadowOpacity: isDark ? 0.15 : 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
  },
  quickIconBox:  { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  quickArrowBox: { position: 'absolute', top: 14, right: 14 },
  quickLabel:    { fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  quickDesc:     { fontSize: 11 },

  // ── Continue learning ─────────────────────────────────
  clCard: {
    borderRadius: 22, borderWidth: 1, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: isDark ? 0.2 : 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
  },
  clStrip: { height: 5 },
  clBody:  { padding: 16, gap: 10 },
  clTopRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  clSubPill:  { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  clSubText:  { fontSize: 10, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase' },
  clTopic:    { fontSize: isMobile ? 18 : 21, fontWeight: '900', letterSpacing: -0.5, lineHeight: isMobile ? 22 : 26, fontFamily: fonts.serif },
  clUnit:     { fontSize: 12, fontStyle: 'italic' },
  clRingWrap:   { position: 'relative', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  clRingCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  clRingPct:    { fontSize: 14, fontWeight: '900', letterSpacing: -0.5 },
  clRingDone:   { fontSize: 9, fontWeight: '600' },

  stageRow:  { flexDirection: 'row', alignItems: 'center' },
  stageNode: { alignItems: 'center', gap: 5 },
  stageDot:  { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  stageLbl:  { fontSize: 10, fontWeight: '700' },
  stageLine: { flex: 1, height: 2, marginBottom: 18 },

  clBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  clHint:      { flex: 1, fontSize: 12, lineHeight: 17 },
  clCtaBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  clCtaTxt:    { fontSize: 13, fontWeight: '800', color: '#fff' },

  // ── AI banner ─────────────────────────────────────────
  aiBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 22, overflow: 'hidden', position: 'relative',
    shadowColor: '#BAA467', shadowOpacity: isDark ? 0.5 : 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 8 },
  },
  aiGlow:       { position: 'absolute', right: -50, top: -50, width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(11,11,11,0.04)' },
  aiAvatarWrap: { position: 'relative', flexShrink: 0 },
  aiAvatarOuter:{ width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(11,11,11,0.10)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(11,11,11,0.18)' },
  aiAvatarInner:{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(11,11,11,0.08)', alignItems: 'center', justifyContent: 'center' },
  aiOnline:     { position: 'absolute', bottom: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: '#2E7D52', borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
  aiBannerBody: { flex: 1, gap: 2 },
  aiTag:        { fontSize: 9, fontWeight: '800', color: 'rgba(11,11,11,0.55)', letterSpacing: 1 },
  aiTitle:      { fontSize: 17, fontWeight: '900', color: '#0B0B0B', letterSpacing: -0.3, fontFamily: fonts.serif },
  aiSub:        { fontSize: 12, color: 'rgba(11,11,11,0.72)', lineHeight: 17 },
  aiBannerCta:  { alignItems: 'center', gap: 4, flexShrink: 0 },
  aiBannerCtaTxt:{ fontSize: 11, fontWeight: '800', color: 'rgba(11,11,11,0.85)' },

  // ── Stats grid ────────────────────────────────────────
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    width: isMobile ? Math.floor((SCREEN_WIDTH - 28 - 28 - 10) / 2) : '23.8%', borderWidth: 1, borderRadius: 18,
    paddingVertical: 16, paddingHorizontal: 12, alignItems: 'center', gap: 4,
    shadowColor: '#000', shadowOpacity: isDark ? 0.15 : 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
  },
  statIconBox: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statVal:     { fontSize: 22, fontWeight: '900', letterSpacing: -0.8 },
  statLabel:   { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  statSub:     { fontSize: 10, textAlign: 'center' },
  statBar:     { width: '88%', height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 6 },
  statBarFill: { height: '100%', borderRadius: 3 },

  // ── Lesson list ───────────────────────────────────────
  emptyCard:   { borderWidth: 1, borderRadius: 16, padding: 30, alignItems: 'center', gap: 10 },
  emptyTxt:    { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  lessonContainer: { borderWidth: 1, borderRadius: 20, overflow: 'hidden', shadowColor: '#000', shadowOpacity: isDark ? 0.15 : 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  lessonRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, position: 'relative' },
  lessonDot:   { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  lessonIconBox:{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  lessonMid:   { flex: 1, gap: 3 },
  lessonTopic: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  lessonMeta:  { fontSize: 11 },
  lessonBar:   { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  lessonBarFill:{ height: '100%', borderRadius: 2 },
  lessonRight: { gap: 6, alignItems: 'flex-end', flexShrink: 0 },
  stagePill:   { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  stagePillTxt:{ fontSize: 10, fontWeight: '700' },
  lessonCta:   { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  lessonCtaTxt:{ fontSize: 11, fontWeight: '800' },

  // ── Deadlines ─────────────────────────────────────────
  deadlineCard: { borderWidth: 1, borderRadius: 20, overflow: 'hidden', shadowColor: '#000', shadowOpacity: isDark ? 0.15 : 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  deadlineRow:  { flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 12 },
  deadlineTimeline: { alignItems: 'center', paddingTop: 3, width: 14 },
  deadlineDot:  { width: 10, height: 10, borderRadius: 5 },
  deadlineLine: { width: 2, flex: 1, marginTop: 5 },
  deadlineBody: { flex: 1, gap: 3 },
  deadlineTitle:{ fontSize: 14, fontWeight: '700' },
  deadlineNote: { fontSize: 12, lineHeight: 17 },
  dueBadge:     { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  dueTxt:       { fontSize: 11, fontWeight: '800' },

  // ── Notification modal ────────────────────────────────
  modalOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  notifPanel:      { borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '78%', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 30, shadowOffset: { width: 0, height: -10 } },
  notifHeaderGrad: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 18 },
  notifTitle:      { fontSize: 18, fontWeight: '900', fontFamily: fonts.serif },
  notifSub:        { fontSize: 12, marginTop: 2 },
  notifHeaderRight:{ flexDirection: 'row', alignItems: 'center', gap: 10 },
  markAllBtn:      { borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  markAllTxt:      { fontSize: 11, fontWeight: '700' },
  closeBtn:        { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  notifItem:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  notifItemIcon:   { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  notifItemBody:   { flex: 1, gap: 2 },
  notifItemTitle:  { fontSize: 14, fontWeight: '700' },
  notifItemBody2:  { fontSize: 12, lineHeight: 17 },
  notifItemTime:   { fontSize: 11, marginTop: 2 },
  notifSep:        { height: 1, marginHorizontal: 20 },
  unreadDot:       { width: 8, height: 8, borderRadius: 4, marginTop: 6, flexShrink: 0 },
});
