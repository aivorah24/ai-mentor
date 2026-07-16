import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle, G, Ellipse } from 'react-native-svg';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import SERVER_URL from '../../config/serverUrl';

// ─────────────────────────────────────────────────────────
// SVG Ring Chart
// ─────────────────────────────────────────────────────────
function DonutChart({ progress = 0, size = 88, color = '#6366f1', trackColor = 'rgba(255,255,255,0.12)' }: {
  progress?: number; size?: number; color?: string; trackColor?: string;
}) {
  const strokeWidth = 9;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(progress, 1));
  const cx = size / 2;
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cx} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
      <G transform={`rotate(-90 ${cx} ${cx})`}>
        <Circle cx={cx} cy={cx} r={r} stroke={color} strokeWidth={strokeWidth} fill="none"
          strokeLinecap="round" strokeDasharray={`${circumference}`} strokeDashoffset={offset} />
      </G>
    </Svg>
  );
}

function AICardDecoration() {
  return (
    <Svg style={StyleSheet.absoluteFill as any} pointerEvents="none">
      <Ellipse cx="92%" cy="-10%" rx="120" ry="120" fill="rgba(255,255,255,0.06)" />
      <Ellipse cx="85%" cy="110%" rx="90" ry="90" fill="rgba(255,255,255,0.04)" />
      {Array.from({ length: 4 }).flatMap((_, r) =>
        Array.from({ length: 10 }).map((_, c) => (
          <Circle key={`${r}-${c}`} cx={c * 55 + 10} cy={r * 45 + 10} r={1.4} fill="rgba(255,255,255,0.07)" />
        ))
      )}
    </Svg>
  );
}

const QUICK_ACTIONS = [
  { icon: 'plus-circle' as const, label: 'New Assignment', color: '#6366f1', screen: 'TeacherAssignments' },
  { icon: 'edit-3' as const, label: 'Grade Papers', color: '#f59e0b', screen: 'TeacherAssignments' },
  { icon: 'clipboard' as const, label: 'Attendance', color: '#ba905a', screen: 'TeacherAttendance' },
  { icon: 'calendar' as const, label: 'Schedule', color: '#10b981', screen: 'TeacherSchedule' },
  { icon: 'bar-chart-2' as const, label: 'Progress', color: '#06b6d4', screen: 'TeacherProgress' },
  { icon: 'users' as const, label: 'Students', color: '#8b5cf6', screen: 'TeacherStudents' },
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function formatStudyTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// Median resists skew from one outlier student (e.g. one 23h grinder pulling up everyone else's "average")
function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ─────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────
export default function TeacherDashboardScreen({ navigation }: any) {
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const gold = colors.accentYellow;
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [insights, setInsights] = useState<any>({ assignments: [], challenges: [], totals: {} });
  const [activityFeed, setActivityFeed] = useState<any[]>([]);

  const firstName = user?.name?.split(' ')[0] || 'Teacher';
  const ringTrack = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';

  const fetchStudents = async () => {
    try {
      const teacherEmail = user?.email || 'teacher@demo.com';
      const [studRes, insRes, actRes] = await Promise.all([
        fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(teacherEmail)}`),
        fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(teacherEmail)}/insights`),
        fetch(`${SERVER_URL}/student/recent-activity/by-teacher/${encodeURIComponent(teacherEmail)}`),
      ]);
      const data = await studRes.json();
      if (Array.isArray(data)) setStudents(data);
      try { const ins = await insRes.json(); setInsights(ins); } catch {}
      try { const act = await actRes.json(); if (Array.isArray(act)) setActivityFeed(act); } catch {}
    } catch {
      // keep previous data
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Initial fetch + auto-refresh every 30s so Learning Path study time (and
  // any other student stat) stays reasonably current without a manual refresh.
  // (Previously 5s — far more aggressive than every other screen's polling and
  // a real contributor to database connection pressure under load.)
  useEffect(() => {
    fetchStudents();
    const interval = setInterval(fetchStudents, 30 * 1000);
    return () => clearInterval(interval);
  }, [user?.email]);

  // Also refetch immediately whenever this screen regains focus or the browser
  // tab becomes visible again (covers switching tabs back to the teacher view).
  useFocusEffect(useCallback(() => { fetchStudents(); }, [user?.email]));
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => { if (document.visibilityState === 'visible') fetchStudents(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [user?.email]);

  // ── Computed stats ──────────────────────────────────────
  const today = todayISO();
  const totalStudents = students.length;
  const allNeedsAttention = students.filter(s => s.needsAttention);
  const needsAttentionStudents = allNeedsAttention.slice(0, 3); // show max 3 in dashboard card
  const activeToday = students.filter(s => s.lastActive === today).length;
  const avgProgress = totalStudents > 0
    ? Math.round(students.reduce((sum, s) => sum + (s.progressPct || 0), 0) / totalStudents)
    : 0;
  // Learning Path Insights tile shows Learning Path time specifically (not
  // Challenges/Assignments time), so it uses learningPathTime, not the
  // combined studyTime.
  const studyTimes = students.map(s => s.learningPathTime || 0);
  const medianStudyMins = median(studyTimes);
  // Class Progress donut ("Typical Study Time" + Lowest/Typical/Highest) is
  // an overall metric — combine time spent across all 3 streams per student
  // (not just Learning Path) so it reflects total engagement.
  const combinedStudyTimes = students.map(s => (s.learningPathTime || 0) + (s.assignmentTime || 0) + (s.challengeTime || 0));
  const medianCombinedMins = median(combinedStudyTimes);
  const minCombinedMins = combinedStudyTimes.length > 0 ? Math.min(...combinedStudyTimes) : 0;
  const maxCombinedMins = combinedStudyTimes.length > 0 ? Math.max(...combinedStudyTimes) : 0;
  // Per-stream typical time, shown next to each Class Progress bar so time
  // spent isn't only reported as one combined "Typical Study Time" figure.
  const medianAssignmentMins = median(students.map(s => s.assignmentTime || 0));
  const medianChallengeMins = median(students.map(s => s.challengeTime || 0));

  // Class-wide per-subject time (Today + overall Total) — e.g. Mathematics: 12m
  // today / 84m total — for the subject(s) this teacher is actually scoped to,
  // shown directly on the dashboard card instead of only inside the Leaderboard.
  const dashboardSubjectColumns = [...new Set(students.flatMap((s: any) => s.scopedSubjects || []))] as string[];
  const subjectTimeSummary = dashboardSubjectColumns.map(subj => ({
    subject: subj,
    today: students.reduce((sum, s) => sum + ((s.subjectTimeToday || {})[subj] || 0), 0),
    total: students.reduce((sum, s) => sum + ((s.subjectTime || {})[subj] || 0), 0),
  }));

  // Assignment & Challenge completion rates — true volumetric rate (completed ÷ assigned
  // across the whole class), not "% of students who did at least one" which reads as a
  // participation rate rather than a completion rate.
  const ins = insights || { assignments: [], challenges: [], totals: {} };
  const totalAssignmentsAssigned = ins.totals?.totalAssignmentsAssigned || 0;
  const totalAssignmentsSubmitted = ins.totals?.totalSubmissions || 0;
  const assignSubmitPct = totalAssignmentsAssigned > 0
    ? Math.round((totalAssignmentsSubmitted / totalAssignmentsAssigned) * 100)
    : 0;

  const totalChallengesAssigned = ins.totals?.totalChallengesAssigned || 0;
  const totalChallengesCompleted = ins.totals?.totalChallengesCompleted || 0;
  const challCompletePct = totalChallengesAssigned > 0
    ? Math.round((totalChallengesCompleted / totalChallengesAssigned) * 100)
    : 0;
  // Overall class progress = equal-weight average across all 3 tracked activity streams,
  // not just Learning Path — matches industry-standard composite progress rings.
  const classProgressPct = Math.round((avgProgress + assignSubmitPct + challCompletePct) / 3);

  // ── Dynamic curriculum label from real student data ────
  const curriculumLabel = (() => {
    if (students.length === 0) return 'curriculum';
    // Find the most common curriculum + grade combination
    const counts: Record<string, number> = {};
    for (const s of students) {
      const key = [s.curriculum, s.grade].filter(Boolean).join(' ') || 'curriculum';
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'curriculum';
  })();

  // ── AI Insights generated from real data ───────────────
  // ── AI insight computations ────────────────────────────
  const inactiveStudents = students.filter(s => {
    if (!s.lastActive) return true;
    const days = Math.floor((Date.now() - new Date(s.lastActive).getTime()) / 86400000);
    return days >= 3;
  });
  const topStudent = [...students].sort((a, b) => (b.progressPct || 0) - (a.progressPct || 0))[0];
  const pendingAssignments = students.reduce((sum, s) => sum + ((s.assignmentsDone || 0) === 0 ? 1 : 0), 0);

  // Most struggled topic: fewest students completed it
  const topicCounts: Record<string, number> = {};
  students.forEach(s => (s.completedTopics || []).forEach((t: string) => { topicCounts[t] = (topicCounts[t] || 0) + 1; }));
  const hardestTopic = Object.entries(topicCounts).sort((a, b) => a[1] - b[1])[0];

  // Avg study time per student (for insight tile) — Learning Path only
  const totalStudyMins = students.reduce((sum, s) => sum + (s.learningPathTime || 0), 0);

  // ── Insight tile type ─────────────────────────────────────
  type InsightTile = { icon: any; color: string; stat: string; label: string; title: string; body: string; screen: string; params?: Record<string, any> };

  // Assignment insights from server data
  const totals = insights?.totals || {};
  const assignStats = insights?.assignments || [];
  const challStats = insights?.challenges || [];

  const studentsWithSubmissions = assignStats.filter((s: any) => s.submitted > 0).length;
  const studentsWithNoSubmissions = totalStudents - studentsWithSubmissions;
  const classAvgScore = totals.classAvgScore;

  // Class-wide per-subject Assignment breakdown — e.g. Mathematics: 1/3 submitted,
  // English: 2/2 submitted — scoped to the subject(s) this teacher actually teaches,
  // same source as the Learning Path subject scoping.
  const assignSubjectColumns = [...new Set(assignStats.flatMap((s: any) => s.scopedSubjects || []))] as string[];
  const assignSubjectSummary = assignSubjectColumns.map(subj => ({
    subject: subj,
    assigned: assignStats.reduce((sum: number, s: any) => sum + ((s.bySubject || {})[subj]?.assigned || 0), 0),
    submitted: assignStats.reduce((sum: number, s: any) => sum + ((s.bySubject || {})[subj]?.submitted || 0), 0),
  }));
  const assignSubjectSummaryText = assignSubjectSummary.length > 0
    ? assignSubjectSummary.map(x => `${x.subject}: ${x.submitted}/${x.assigned} submitted`).join('  ·  ')
    : '';
  const topAssignStudent = [...assignStats].sort((a: any, b: any) => (b.avgScore || 0) - (a.avgScore || 0))[0];

  const studentsWithChallenges = challStats.filter((s: any) => s.assigned > 0).length;
  const studentsCompletedChallenge = challStats.filter((s: any) => s.completed > 0).length;
  const topChallStudent = [...challStats].sort((a: any, b: any) => (b.avgScore || 0) - (a.avgScore || 0))[0];

  // ── Aivorah gold palette for insight tiles ─────────
  const T = {
    teal:   gold,
    rose:   gold,
    gold:   gold,
    coral:  gold,
    forest: gold,
    mint:   gold,
    blush:  gold,
    slate:  gold,
  };

  // ── SECTION 1: Learning Path Insights ───────────────────
  const learningPathTiles: InsightTile[] = [
    {
      icon: 'book-open', color: T.rose,
      stat: `${allNeedsAttention.length}`,
      label: 'Struggling',
      title: 'Need Support',
      body: `${allNeedsAttention.length} student${allNeedsAttention.length !== 1 ? 's' : ''} need focused review.`,
      screen: 'TeacherStudents', params: { initialTab: 'Needs Attention' },
    },
    {
      icon: 'award', color: T.forest,
      stat: topStudent ? `${topStudent.progressPct}%` : '—',
      label: 'Top Score',
      title: topStudent ? `${topStudent.name?.split(' ')[0]} Leads` : 'No Data Yet',
      body: topStudent
        ? `${topStudent.completedTopics?.length || 0} topics done. Give them a challenge!`
        : 'Assign the first topic to get going.',
      screen: 'TeacherStudents', params: { initialTab: 'Top Performers' },
    },
    {
      icon: 'moon', color: T.gold,
      stat: `${inactiveStudents.length}`,
      label: 'Inactive 3d+',
      title: inactiveStudents.length > 0 ? 'Going Quiet' : 'All Active',
      body: inactiveStudents.length > 0
        ? `${inactiveStudents.slice(0, 2).map(s => s.name?.split(' ')[0]).join(', ')}${inactiveStudents.length > 2 ? ` +${inactiveStudents.length - 2}` : ''} — nudge them back.`
        : 'Great engagement this week!',
      screen: 'TeacherStudents', params: { initialTab: 'Inactive' },
    },
    {
      icon: 'clock', color: T.teal,
      stat: formatStudyTime(totalStudyMins),
      label: 'Study Time',
      title: totalStudyMins > 0 ? `${formatStudyTime(medianStudyMins)} median per student` : 'No Study Yet',
      body: totalStudyMins > 0
        ? `${formatStudyTime(totalStudyMins)} total across ${totalStudents} student${totalStudents !== 1 ? 's' : ''}.`
        : 'Study time appears once students start learning.',
      screen: 'TeacherProgress',
    },
  ];

  // ── SECTION 2: Assignment Insights ──────────────────────
  const assignmentTiles: InsightTile[] = [
    {
      icon: 'clipboard', color: T.mint,
      stat: `${studentsWithNoSubmissions}`,
      label: 'Pending',
      title: studentsWithNoSubmissions > 0 ? 'Not Started' : 'All Submitted',
      body: studentsWithNoSubmissions > 0
        ? `${studentsWithNoSubmissions} student${studentsWithNoSubmissions !== 1 ? 's' : ''} haven't submitted yet.`
        : 'Everyone has submitted. Assign next chapter.',
      screen: 'TeacherAssignments',
    },
    {
      icon: 'bar-chart-2', color: T.slate,
      stat: classAvgScore != null ? `${classAvgScore}%` : '—',
      label: 'Avg Score',
      title: classAvgScore != null ? `Class Avg: ${classAvgScore}%` : 'No Scores Yet',
      body: classAvgScore != null
        ? classAvgScore >= 70
          ? `Strong performance — raise the difficulty.`
          : `Review common mistakes or assign practice.`
        : 'Scores appear once students submit.',
      screen: 'TeacherAssignments',
    },
    {
      icon: 'check-circle', color: T.forest,
      stat: `${studentsWithSubmissions}/${totalStudents}`,
      label: 'Submitted',
      title: studentsWithSubmissions > 0
        ? `${studentsWithSubmissions} Submitted`
        : 'No Submissions',
      body: studentsWithSubmissions > 0
        ? topAssignStudent?.avgScore != null
          ? `${topAssignStudent.name?.split(' ')[0]} leads at ${topAssignStudent.avgScore}%.`
          : `${totals.totalSubmissions || 0} total submissions.`
        : 'Create your first assignment to start.',
      screen: 'TeacherAssignments',
    },
  ];

  // ── SECTION 3: Challenge Insights ───────────────────────
  const challengeTiles: InsightTile[] = [
    {
      icon: 'target', color: T.blush,
      stat: `${studentsWithChallenges}/${totalStudents}`,
      label: 'Attempted',
      title: studentsWithChallenges > 0
        ? `${studentsWithChallenges} of ${totalStudents} Students Have Challenges`
        : 'No Challenges Yet',
      body: studentsWithChallenges > 0
        ? `${totals.totalChallengesAssigned || 0} challenges assigned in total across those ${studentsWithChallenges} student${studentsWithChallenges !== 1 ? 's' : ''}.`
        : 'Assign challenges to test their skills.',
      screen: 'TeacherStudents',
    },
    {
      icon: 'flag', color: T.gold,
      stat: `${studentsCompletedChallenge}`,
      label: 'Completed',
      title: studentsCompletedChallenge > 0
        ? `${studentsCompletedChallenge} Finished`
        : 'None Completed',
      body: studentsCompletedChallenge > 0
        ? `${totals.totalChallengesCompleted || 0} challenges done.`
        : 'Encourage students to attempt challenges.',
      screen: 'TeacherStudents',
    },
    {
      icon: 'trending-up', color: T.teal,
      stat: topChallStudent?.avgScore != null ? `${topChallStudent.avgScore}%` : '—',
      label: 'Top Scorer',
      title: topChallStudent?.avgScore != null
        ? `${topChallStudent.name?.split(' ')[0]} Leads`
        : 'No Scores Yet',
      body: topChallStudent?.avgScore != null
        ? `${topChallStudent.completed || 0} completed — give advanced challenges!`
        : 'Scores appear after completion.',
      screen: 'TeacherStudents',
    },
  ];

  // Combined flat array for modal index lookup (Learning Path 0-3, Assignments 4-6, Challenges 7-9)
  const aiInsightTiles: InsightTile[] = [...learningPathTiles, ...assignmentTiles, ...challengeTiles];

  // ── Recent activity: live event feed (topic/assignment/challenge completions),
  // not a static "Xh total study time" snapshot — shows what students are
  // actually doing, as it happens.
  function formatRelativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    const diffMs = Date.now() - then;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toISOString().split('T')[0];
  }
  const ACTIVITY_ICON: Record<string, any> = { topic: 'book-open', assignment: 'edit-3', challenge: 'target' };
  const recentStudents = activityFeed.slice(0, 3).map((ev, i) => ({
    id: `${ev.studentId}-${i}`,
    initials: (ev.name || '??').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase(),
    name: ev.name || 'Unknown',
    action: ev.text,
    prefix: ev.prefix, title: ev.title, suffix: ev.suffix,
    icon: ACTIVITY_ICON[ev.type] || 'activity',
    time: formatRelativeTime(ev.timestamp),
    studentId: ev.studentId,
  }));

  const aiActionTitle = allNeedsAttention.length > 0
    ? `Review struggling students (${allNeedsAttention.length} flagged)`
    : avgProgress > 0
      ? `Class at ${avgProgress}% — keep pushing!`
      : 'Set up your first assignment to get started';

  const aiActionBody = allNeedsAttention.length > 0
    ? `${needsAttentionStudents[0]?.name?.split(' ')[0] || 'A student'} and others have low progress. Schedule dedicated study hours or assign a practice task to support them.`
    : `Median study time is ${formatStudyTime(medianStudyMins)} per student. Assign a chapter task or quiz to keep them engaged.`;

  // ── Insight filter tab ──────────────────────────────────
  const [insightFilter, setInsightFilter] = useState<'learning' | 'assignments' | 'challenges'>('learning');

  const filteredTiles =
    insightFilter === 'learning' ? learningPathTiles
    : insightFilter === 'assignments' ? assignmentTiles
    : challengeTiles;

  const filterOffset =
    insightFilter === 'learning' ? 0
    : insightFilter === 'assignments' ? learningPathTiles.length
    : learningPathTiles.length + assignmentTiles.length;

  // ── Insight detail modal ───────────────────────────────
  const [insightModal, setInsightModal] = useState<null | { tileIndex: number }>(null);

  function renderInsightModalContent(tileIndex: number) {
    const tile = aiInsightTiles[tileIndex];
    const fmt12 = (n: number) => `${n % 12 || 12}${n < 12 ? 'am' : 'pm'}`;
    const initials = (name: string) => name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();

    switch (tileIndex) {

      case 0: { // Struggling — same population as the outer tile (needsAttention)
        const stuck = [...allNeedsAttention]
          .sort((a, b) => (a.progressPct || 0) - (b.progressPct || 0));
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>{stuck.length} Students</Text>
                <Text style={styles.modalHeading}>Need Support</Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { flex: 2.4 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 1.3 }]}>Topics Done</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'center' }]}>Streak</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Progress</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {stuck.length === 0 ? (
                <View style={styles.modalEmpty}>
                  <Feather name="check-circle" size={28} color="#5A8A70" />
                  <Text style={styles.modalEmptyText}>No students need support right now!</Text>
                </View>
              ) : stuck.map((s, i) => {
                // "Topics Done" must only count the teacher's own subjects (Mathematics,
                // English) — other subjects (PE, Art, ...) are handled by other staff and
                // shouldn't inflate this count. Falls back to the raw count only when this
                // teacher has no subject scoping configured at all.
                const scopedSubjectsForCount: string[] = s.scopedSubjects || [];
                const doneCount = scopedSubjectsForCount.length > 0
                  ? (s.completedTopicsDetailed || []).filter((d: any) => scopedSubjectsForCount.includes(d.subject)).length
                  : (s.completedTopics || []).length;
                const pct = s.progressPct || 0;
                const pctColor = pct < 20 ? '#B8797E' : '#8A8358';
                const streak = s.currentStreak || 0;
                return (
                  <View key={s.id || String(i)} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                    <View style={[styles.tableCell, { flex: 2.4, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                      <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                        <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name || '?')}</Text>
                      </View>
                      <View>
                        <Text style={styles.tableStudentName}>{(s.name || 'Unknown').split(' ')[0]}</Text>
                        <Text style={styles.tableStudentGrade}>{s.grade || '—'}</Text>
                      </View>
                    </View>
                    <View style={[styles.tableCell, { flex: 1.3, alignItems: 'flex-start' }]}>
                      <Text style={[styles.tableChip, doneCount === 0
                        ? { color: '#B8797E', borderColor: '#B8797E40', backgroundColor: '#B8797E10' }
                        : { color: '#5A8A70', borderColor: '#5A8A7040', backgroundColor: '#5A8A7010' }
                      ]}>
                        {doneCount === 0 ? 'None yet' : doneCount + ' topics done'}
                      </Text>
                    </View>
                    <Text style={[styles.tableCell, { flex: 1, textAlign: 'center', color: streak === 0 ? '#B8797E' : colors.textDim, fontSize: 12, fontWeight: '700' }]}>
                      {streak}d
                    </Text>
                    <View style={[styles.tableCell, { flex: 1, alignItems: 'flex-end' }]}>
                      <View style={[styles.pctPill, { backgroundColor: pctColor + '18', borderColor: pctColor + '40' }]}>
                        <Text style={[styles.pctPillText, { color: pctColor }]}>{pct}%</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </>
        );
      }

      case 1: { // Top Performers — leaderboard table
        const ranked = [...students].sort((a, b) => (b.progressPct || 0) - (a.progressPct || 0));
        // One column per subject this teacher is scoped to (e.g. Mathematics, English),
        // each showing Today + Total separately — clearer for real per-subject analysis
        // than cramming both subjects' numbers as sub-text under one combined column.
        const subjectColumns = [...new Set(ranked.flatMap((s: any) => s.scopedSubjects || []))] as string[];
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>Leaderboard</Text>
                <Text style={styles.modalHeading}>All Students Ranked by Progress</Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            {/* Learning Path only, scoped to the subject(s) this teacher handles */}
            <View style={styles.tableHeader}>
              <View style={{ width: 32, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={styles.tableCol}>#</Text>
              </View>
              <View style={{ flex: 2, justifyContent: 'center' }}>
                <Text style={styles.tableCol}>Student</Text>
              </View>
              <View style={{ flex: 2, justifyContent: 'center' }}>
                <Text style={styles.tableCol}>Topics (by subject)</Text>
              </View>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={styles.tableCol}>Streak</Text>
              </View>
              {subjectColumns.length > 0 ? (
                subjectColumns.map(subj => (
                  <View key={subj} style={{ flex: 1.2, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={styles.tableCol}>{subj}</Text>
                  </View>
                ))
              ) : (
                <>
                  <View style={{ flex: 1, justifyContent: 'center' }}>
                    <Text style={styles.tableCol}>Today</Text>
                  </View>
                  <View style={{ flex: 1, justifyContent: 'center' }}>
                    <Text style={styles.tableCol}>Total</Text>
                  </View>
                </>
              )}
              <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center' }}>
                <Text style={styles.tableCol}>Progress</Text>
              </View>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {ranked.map((s, i) => {
                const medal = i === 0 ? '#C5BD96' : i === 1 ? '#7AADA8' : i === 2 ? '#C4836A' : colors.textDim;
                // Group this student's completed topics by subject, e.g. "Mathematics: 2, English: 1".
                // Always show every subject this teacher is scoped to (even at 0 done) so
                // monitoring is complete at a glance, not just whichever subjects happen to
                // have a completion — that's the whole point of per-subject tracking.
                const bySubject: Record<string, number> = {};
                (s.scopedSubjects || []).forEach((subj: string) => { bySubject[subj] = 0; });
                (s.completedTopicsDetailed || []).forEach((d: any) => {
                  if (d.subject) bySubject[d.subject] = (bySubject[d.subject] || 0) + 1;
                });
                const subjectEntries = Object.entries(bySubject);
                // "N done" must match the sum of the scoped-subject breakdown below it —
                // not the raw completedTopics count, which also includes topics from
                // subjects outside this teacher's scope (e.g. Physical Education).
                const scopedDoneCount = subjectEntries.length > 0
                  ? subjectEntries.reduce((sum, [, count]) => sum + count, 0)
                  : (s.completedTopics || []).length;
                return (
                  <View key={s.id || i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                    <View style={{ width: 32, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={[styles.tableCell, { fontWeight: '800', color: medal, fontSize: 14 }]}>{i + 1}</Text>
                    </View>
                    <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                        <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name)}</Text>
                      </View>
                      <View style={{ justifyContent: 'center' }}>
                        <Text style={styles.tableStudentName}>{s.name.split(' ')[0]}</Text>
                        <Text style={styles.tableStudentGrade}>{s.grade}</Text>
                      </View>
                    </View>
                    <View style={{ flex: 2, justifyContent: 'center' }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMain }}>{scopedDoneCount} done</Text>
                      {subjectEntries.length > 0 && (
                        <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 2 }} numberOfLines={2}>
                          {subjectEntries.map(([subj, count]) => `${subj}: ${count}`).join('  ·  ')}
                        </Text>
                      )}
                    </View>
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={[styles.tableCell, { color: colors.textMuted, fontSize: 12 }]}>{s.currentStreak || 0}d</Text>
                    </View>
                    {subjectColumns.length > 0 ? (
                      subjectColumns.map(subj => {
                        const todayMins = (s.subjectTimeToday || {})[subj] || 0;
                        const totalMins = (s.subjectTime || {})[subj] || 0;
                        return (
                          <View key={subj} style={{ flex: 1.2, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMain, textAlign: 'center' }}>
                              {formatStudyTime(todayMins)}
                            </Text>
                            {totalMins > 0 && (
                              <Text style={{ fontSize: 9, color: colors.textDim, marginTop: 1, textAlign: 'center' }}>
                                of {formatStudyTime(totalMins)} total
                              </Text>
                            )}
                          </View>
                        );
                      })
                    ) : (
                      <>
                        <View style={{ flex: 1, justifyContent: 'center' }}>
                          <Text style={[styles.tableCell, { color: colors.textMuted, fontSize: 12 }]}>{formatStudyTime(s.learningPathTimeToday || 0)}</Text>
                        </View>
                        <View style={{ flex: 1, justifyContent: 'center' }}>
                          <Text style={[styles.tableCell, { color: colors.textMuted, fontSize: 12 }]}>{formatStudyTime(s.learningPathTime || 0)}</Text>
                        </View>
                      </>
                    )}
                    <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center' }}>
                      <View style={[styles.pctPill, { backgroundColor: tile.color + '18', borderColor: tile.color + '40' }]}>
                        <Text style={[styles.pctPillText, { color: tile.color }]}>{s.progressPct || 0}%</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </>
        );
      }

      case 2: { // Inactive
        const inactive = students
          .filter(s => { const d = s.lastActive ? Math.floor((Date.now() - new Date(s.lastActive).getTime()) / 86400000) : 999; return d >= 3; })
          .sort((a, b) => (a.lastActive || '').localeCompare(b.lastActive || ''));
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>{inactive.length} Students</Text>
                <Text style={styles.modalHeading}>Inactive for 3+ Days</Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { flex: 2 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'center' }]}>Last Seen</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'center' }]}>Topics</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Progress</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {inactive.map((s, i) => {
                const days = s.lastActive ? Math.floor((Date.now() - new Date(s.lastActive).getTime()) / 86400000) : 999;
                const urgency = days > 7 ? '#B8797E' : tile.color;
                return (
                  <View key={s.id || i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                    <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                      <View style={[styles.modalAvatar, { backgroundColor: urgency + '20', width: 30, height: 30, borderRadius: 15 }]}>
                        <Text style={[styles.modalAvatarText, { color: urgency, fontSize: 10 }]}>{initials(s.name)}</Text>
                      </View>
                      <View>
                        <Text style={styles.tableStudentName}>{s.name.split(' ')[0]}</Text>
                        <Text style={styles.tableStudentGrade}>{s.grade}</Text>
                      </View>
                    </View>
                    <View style={[styles.tableCell, { flex: 1, alignItems: 'center' }]}>
                      <Text style={[styles.tableChip, { alignSelf: 'center', color: urgency, borderColor: urgency + '40', backgroundColor: urgency + '10' }]}>
                        {days === 999 ? 'Never' : `${days}d ago`}
                      </Text>
                    </View>
                    <Text style={[styles.tableCell, { flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: 12 }]}>{(s.completedTopics || []).length} done</Text>
                    <View style={[styles.tableCell, { flex: 1, alignItems: 'flex-end' }]}>
                      <View style={[styles.pctPill, { backgroundColor: urgency + '18', borderColor: urgency + '40' }]}>
                        <Text style={[styles.pctPillText, { color: urgency }]}>{s.progressPct || 0}%</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </>
        );
      }

      case 3: { // Study Time — per-student breakdown (Learning Path only)
        const ranked = [...students].sort((a, b) => (b.learningPathTime || 0) - (a.learningPathTime || 0));
        const maxMins = Math.max(...ranked.map(s => s.learningPathTime || 0), 1);
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>{formatStudyTime(totalStudyMins)}</Text>
                <Text style={styles.modalHeading}>Total Study Time Across Class</Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { flex: 2 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 2 }]}>Time</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Progress</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {ranked.map((s, i) => (
                <View key={s.id || i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                  <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                    <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                      <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name || '?')}</Text>
                    </View>
                    <Text style={styles.tableStudentName}>{(s.name || 'Unknown').split(' ')[0]}</Text>
                  </View>
                  <View style={[styles.tableCell, { flex: 2, gap: 3 }]}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMain }}>{formatStudyTime(s.learningPathTime || 0)}</Text>
                    <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
                      <View style={[styles.progressFill, { width: `${Math.round(((s.learningPathTime || 0) / maxMins) * 100)}%` as any, backgroundColor: tile.color }]} />
                    </View>
                  </View>
                  <View style={[styles.tableCell, { flex: 1, alignItems: 'flex-end' }]}>
                    <View style={[styles.pctPill, { backgroundColor: tile.color + '18', borderColor: tile.color + '40' }]}>
                      <Text style={[styles.pctPillText, { color: tile.color }]}>{s.progressPct || 0}%</Text>
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
          </>
        );
      }

      // ── Assignment Insight Modals (indices 5-7) ─────────
      case 4: { // Pending — students with no submissions
        const noSubs = (assignStats as any[]).filter((s: any) => s.submitted === 0);
        // One Assigned/Submitted pair per subject this teacher teaches (Mathematics,
        // English, ...), plus a Total column — same clear-breakdown approach as the
        // Learning Path Leaderboard, so nothing is a single ambiguous combined number.
        const pendingSubjectCols = [...new Set(noSubs.flatMap((s: any) => s.scopedSubjects || []))] as string[];
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>{noSubs.length} Students</Text>
                <Text style={styles.modalHeading}>No Assignments Submitted Yet</Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { flex: 1.6 }]}>Student</Text>
              {pendingSubjectCols.map(subj => (
                <Text key={subj} style={[styles.tableCol, { flex: 1.3, textAlign: 'center' }]}>{subj}</Text>
              ))}
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'center' }]}>Total</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {noSubs.length === 0 ? (
                <View style={styles.modalEmpty}>
                  <Feather name="check-circle" size={28} color="#5A8A70" />
                  <Text style={styles.modalEmptyText}>Everyone has submitted at least one assignment!</Text>
                </View>
              ) : noSubs.map((s: any, i: number) => (
                <View key={s.id || i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                  <View style={[styles.tableCell, { flex: 1.6, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                    <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                      <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name || '?')}</Text>
                    </View>
                    <Text style={styles.tableStudentName}>{(s.name || 'Unknown').split(' ')[0]}</Text>
                  </View>
                  {pendingSubjectCols.map(subj => {
                    const bySubj = (s.bySubject || {})[subj] || { assigned: 0, submitted: 0 };
                    return (
                      <View key={subj} style={[styles.tableCell, { flex: 1.3, alignItems: 'center' }]}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMain }}>{bySubj.submitted}/{bySubj.assigned}</Text>
                      </View>
                    );
                  })}
                  {(() => {
                    // Total must equal the sum of the subject columns shown — not the raw
                    // assigned/submitted count, which can include legacy assignments from
                    // before subject-tagging existed and would otherwise not add up visibly.
                    const totalAssigned = pendingSubjectCols.reduce((sum, subj) => sum + ((s.bySubject || {})[subj]?.assigned || 0), 0);
                    const totalSubmitted = pendingSubjectCols.reduce((sum, subj) => sum + ((s.bySubject || {})[subj]?.submitted || 0), 0);
                    return (
                      <View style={[styles.tableCell, { flex: 1, alignItems: 'center' }]}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#B8797E' }}>{totalSubmitted}/{totalAssigned}</Text>
                      </View>
                    );
                  })()}
                </View>
              ))}
            </ScrollView>
          </>
        );
      }

      case 5: { // Avg Score — all students ranked by assignment avg score
        const ranked = [...(assignStats as any[])].filter((s: any) => s.avgScore != null).sort((a: any, b: any) => b.avgScore - a.avgScore);
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>{classAvgScore != null ? `${classAvgScore}%` : '—'}</Text>
                <Text style={styles.modalHeading}>Assignment Scores by Student</Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { width: 32, textAlign: 'center' }]}>#</Text>
              <Text style={[styles.tableCol, { flex: 2 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'center' }]}>Submitted</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Avg Score</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {ranked.length === 0 ? (
                <View style={styles.modalEmpty}>
                  <Feather name="bar-chart-2" size={28} color={colors.textDim} />
                  <Text style={styles.modalEmptyText}>No assignment scores yet</Text>
                </View>
              ) : ranked.map((s: any, i: number) => {
                const scoreColor = s.avgScore >= 70 ? '#5A8A70' : s.avgScore >= 40 ? '#8A8358' : '#B8797E';
                return (
                  <View key={s.id || i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                    <Text style={[styles.tableCell, { width: 32, textAlign: 'center', fontWeight: '800', color: i < 3 ? tile.color : colors.textDim, fontSize: 14 }]}>{i + 1}</Text>
                    <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                      <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                        <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name || '?')}</Text>
                      </View>
                      <Text style={styles.tableStudentName}>{(s.name || 'Unknown').split(' ')[0]}</Text>
                    </View>
                    <Text style={[styles.tableCell, { flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: 12 }]}>{s.submitted}</Text>
                    <View style={[styles.tableCell, { flex: 1, alignItems: 'flex-end' }]}>
                      <View style={[styles.pctPill, { backgroundColor: scoreColor + '18', borderColor: scoreColor + '40' }]}>
                        <Text style={[styles.pctPillText, { color: scoreColor }]}>{s.avgScore}%</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </>
        );
      }

      case 6: { // Submitted — all students with submission counts, broken down per subject
        const ranked = [...(assignStats as any[])].sort((a: any, b: any) => b.submitted - a.submitted);
        const submittedSubjectCols = [...new Set(ranked.flatMap((s: any) => s.scopedSubjects || []))] as string[];
        const timeById: Record<string, number> = Object.fromEntries(students.map((st: any) => [st.id, st.assignmentTime || 0]));
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>{studentsWithSubmissions} Students</Text>
                <Text style={styles.modalHeading}>Assignment Submissions Overview</Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { flex: 1.4 }]}>Student</Text>
              {submittedSubjectCols.map(subj => (
                <Text key={subj} style={[styles.tableCol, { flex: 1.1, textAlign: 'center' }]}>{subj}</Text>
              ))}
              <Text style={[styles.tableCol, { flex: 0.9, textAlign: 'center' }]}>Total</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'center' }]}>Time Spent</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Avg Score</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {ranked.map((s: any, i: number) => (
                <View key={s.id || i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                  <View style={[styles.tableCell, { flex: 1.4, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                    <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                      <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name || '?')}</Text>
                    </View>
                    <Text style={styles.tableStudentName}>{(s.name || 'Unknown').split(' ')[0]}</Text>
                  </View>
                  {submittedSubjectCols.map(subj => {
                    const bySubj = (s.bySubject || {})[subj] || { assigned: 0, submitted: 0 };
                    return (
                      <View key={subj} style={[styles.tableCell, { flex: 1.1, alignItems: 'center' }]}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: bySubj.submitted > 0 ? '#5A8A70' : colors.textMain }}>
                          {bySubj.submitted}/{bySubj.assigned}
                        </Text>
                      </View>
                    );
                  })}
                  {(() => {
                    // Total = sum of the subject columns shown, so it can never contradict
                    // what's visible (raw s.assigned/s.submitted can include untagged legacy
                    // assignments that don't belong to any displayed subject column).
                    const totalAssigned = submittedSubjectCols.reduce((sum, subj) => sum + ((s.bySubject || {})[subj]?.assigned || 0), 0);
                    const totalSubmitted = submittedSubjectCols.reduce((sum, subj) => sum + ((s.bySubject || {})[subj]?.submitted || 0), 0);
                    return (
                      <View style={[styles.tableCell, { flex: 0.9, alignItems: 'center' }]}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: totalSubmitted > 0 ? '#5A8A70' : '#B8797E' }}>
                          {totalSubmitted}/{totalAssigned}
                        </Text>
                      </View>
                    );
                  })()}
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: 12 }]}>
                    {formatStudyTime(timeById[s.id] || 0)}
                  </Text>
                  <View style={[styles.tableCell, { flex: 1, alignItems: 'flex-end' }]}>
                    {s.avgScore != null ? (
                      <View style={[styles.pctPill, { backgroundColor: tile.color + '18', borderColor: tile.color + '40' }]}>
                        <Text style={[styles.pctPillText, { color: tile.color }]}>{s.avgScore}%</Text>
                      </View>
                    ) : (
                      <Text style={{ fontSize: 12, color: colors.textDim }}>—</Text>
                    )}
                  </View>
                </View>
              ))}
            </ScrollView>
          </>
        );
      }

      // ── Challenge Insight Modals (indices 8-10) ─────────
      case 7: { // Attempted — students with challenges
        const withCh = (challStats as any[]).filter((s: any) => s.assigned > 0);
        const challTimeById: Record<string, number> = Object.fromEntries(students.map((st: any) => [st.id, st.challengeTime || 0]));
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>{withCh.length} Students</Text>
                <Text style={styles.modalHeading}>Students with Challenges Assigned</Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { flex: 2 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'center' }]}>Assigned</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'center' }]}>Done</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'center' }]}>Time Spent</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Avg Score</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {withCh.length === 0 ? (
                <View style={styles.modalEmpty}>
                  <Feather name="target" size={28} color={colors.textDim} />
                  <Text style={styles.modalEmptyText}>No challenges assigned yet</Text>
                </View>
              ) : withCh.map((s: any, i: number) => (
                <View key={s.id || i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                  <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                    <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                      <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name || '?')}</Text>
                    </View>
                    <Text style={styles.tableStudentName}>{(s.name || 'Unknown').split(' ')[0]}</Text>
                  </View>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: 12 }]}>{s.assigned}</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center', color: s.completed > 0 ? '#5A8A70' : '#B8797E', fontSize: 12, fontWeight: '700' }]}>{s.completed}</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: 12 }]}>{formatStudyTime(challTimeById[s.id] || 0)}</Text>
                  <View style={[styles.tableCell, { flex: 1, alignItems: 'flex-end' }]}>
                    {s.avgScore != null ? (
                      <View style={[styles.pctPill, { backgroundColor: tile.color + '18', borderColor: tile.color + '40' }]}>
                        <Text style={[styles.pctPillText, { color: tile.color }]}>{s.avgScore}%</Text>
                      </View>
                    ) : (
                      <Text style={{ fontSize: 12, color: colors.textDim }}>—</Text>
                    )}
                  </View>
                </View>
              ))}
            </ScrollView>
          </>
        );
      }

      case 8: { // Completed — students who finished challenges
        const done = (challStats as any[]).filter((s: any) => s.completed > 0).sort((a: any, b: any) => b.completed - a.completed);
        const challTimeById: Record<string, number> = Object.fromEntries(students.map((st: any) => [st.id, st.challengeTime || 0]));
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>{done.length} Students</Text>
                <Text style={styles.modalHeading}>Challenges Completed</Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { flex: 2 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'center' }]}>Completed</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'center' }]}>Time Spent</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Avg Score</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {done.length === 0 ? (
                <View style={styles.modalEmpty}>
                  <Feather name="flag" size={28} color={colors.textDim} />
                  <Text style={styles.modalEmptyText}>No challenges completed yet</Text>
                </View>
              ) : done.map((s: any, i: number) => (
                <View key={s.id || i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                  <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                    <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                      <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name || '?')}</Text>
                    </View>
                    <Text style={styles.tableStudentName}>{(s.name || 'Unknown').split(' ')[0]}</Text>
                  </View>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center', color: '#5A8A70', fontSize: 12, fontWeight: '700' }]}>{s.completed}</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: 12 }]}>
                    {formatStudyTime(challTimeById[s.id] || 0)}
                  </Text>
                  <View style={[styles.tableCell, { flex: 1, alignItems: 'flex-end' }]}>
                    {s.avgScore != null ? (
                      <View style={[styles.pctPill, { backgroundColor: tile.color + '18', borderColor: tile.color + '40' }]}>
                        <Text style={[styles.pctPillText, { color: tile.color }]}>{s.avgScore}%</Text>
                      </View>
                    ) : (
                      <Text style={{ fontSize: 12, color: colors.textDim }}>—</Text>
                    )}
                  </View>
                </View>
              ))}
            </ScrollView>
          </>
        );
      }

      case 9: { // Top Scorer — challenge leaderboard
        const ranked = [...(challStats as any[])].filter((s: any) => s.avgScore != null).sort((a: any, b: any) => b.avgScore - a.avgScore);
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>Challenge Leaderboard</Text>
                <Text style={styles.modalHeading}>Students Ranked by Challenge Score</Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { width: 32, textAlign: 'center' }]}>#</Text>
              <Text style={[styles.tableCol, { flex: 2 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'center' }]}>Done</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Avg Score</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {ranked.length === 0 ? (
                <View style={styles.modalEmpty}>
                  <Feather name="trending-up" size={28} color={colors.textDim} />
                  <Text style={styles.modalEmptyText}>No challenge scores yet</Text>
                </View>
              ) : ranked.map((s: any, i: number) => {
                const medal = i === 0 ? '#C5BD96' : i === 1 ? '#7AADA8' : i === 2 ? '#C4836A' : colors.textDim;
                return (
                  <View key={s.id || i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                    <Text style={[styles.tableCell, { width: 32, fontWeight: '800', color: medal, fontSize: 14, textAlign: 'center' }]}>{i + 1}</Text>
                    <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                      <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                        <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name || '?')}</Text>
                      </View>
                      <Text style={styles.tableStudentName}>{(s.name || 'Unknown').split(' ')[0]}</Text>
                    </View>
                    <Text style={[styles.tableCell, { flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: 12 }]}>{s.completed || 0}</Text>
                    <View style={[styles.tableCell, { flex: 1, alignItems: 'flex-end' }]}>
                      <View style={[styles.pctPill, { backgroundColor: tile.color + '18', borderColor: tile.color + '40' }]}>
                        <Text style={[styles.pctPillText, { color: tile.color }]}>{s.avgScore}%</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </>
        );
      }

      default: return null;
    }
  }

  if (loading) {
    return (
      <ScreenLayout>
        <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator color={colors.accentYellow} size="large" />
        </View>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title={`${getGreeting()}, ${firstName}`}
          subtitle={`Your Class · ${totalStudents} Student${totalStudents !== 1 ? 's' : ''}`}
          searchPlaceholder="Search students, assignments..."
          onMenuPress={() => navigation.openDrawer()}
          onProfilePress={() => navigation.navigate('TeacherSettings' as any)}
          notificationCount={allNeedsAttention.length || undefined}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchStudents(); }} tintColor={colors.accentYellow} />}
        >

          {/* ── AI SUGGESTED ACTION ─────────────────────── */}
          <View style={[styles.aiCard, { marginBottom: spacing.xl }]}>
            <AICardDecoration />
            <View style={styles.aiTop}>
              <View style={styles.aiIconWrap}>
                <Feather name="cpu" size={20} color="white" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.aiTag}>AI SUGGESTED ACTION</Text>
                <Text style={styles.aiTitle}>{aiActionTitle}</Text>
                <Text style={styles.aiSub}>{aiActionBody}</Text>
              </View>
            </View>
            <View style={styles.aiBtnRow}>
              {allNeedsAttention.length > 0 ? (
                <>
                  <TouchableOpacity style={styles.aiBtn} activeOpacity={0.85} onPress={() => navigation.navigate('TeacherSchedule' as any)}>
                    <Feather name="calendar" size={14} color={gold} />
                    <Text style={styles.aiBtnText}>Schedule Study Hour</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.aiBtn, { backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: '#fff' }]} 
                    activeOpacity={0.85} 
                    onPress={() => navigation.navigate('TeacherAssignments' as any)}
                  >
                    <Feather name="plus-circle" size={14} color="white" />
                    <Text style={[styles.aiBtnText, { color: 'white' }]}>Assign Practice Task</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={styles.aiBtn} activeOpacity={0.85} onPress={() => navigation.navigate('TeacherAssignments' as any)}>
                  <Feather name="plus-circle" size={14} color={gold} />
                  <Text style={styles.aiBtnText}>
                    {avgProgress > 0 ? 'Assign Task / Quiz' : 'Create First Assignment'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* ── ROW 1: Student Overview + Class Progress ─── */}
          <View style={[styles.row, { marginBottom: spacing.xl }]}>
            {/* Student Overview */}
            <TouchableOpacity style={[styles.card, styles.flex1]} activeOpacity={0.85} onPress={() => navigation.navigate('TeacherStudents' as any)}>
              <View style={styles.cardHeader}>
                <Feather name="users" size={15} color={gold} />
                <Text style={styles.cardTitle}>Student Overview</Text>
              </View>
              <Text style={styles.bigNumber}>{totalStudents}</Text>
              <Text style={[styles.changeText, { color: colors.accentGreen }]}>Total Students</Text>
              <Text style={styles.overviewLabel}>Enrolled in your class</Text>
              <View style={styles.overviewDivider} />
              <View style={styles.overviewRow}>
                <TouchableOpacity style={styles.overviewStat} activeOpacity={0.7}
                  onPress={(e) => { e.stopPropagation(); navigation.navigate('TeacherStudents' as any, { initialTab: 'Active Today' }); }}>
                  <Text style={[styles.overviewVal, { color: colors.accentGreen }]}>{activeToday}</Text>
                  <Text style={styles.overviewKey}>Active Today</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.overviewStat, { borderLeftWidth: 1, borderLeftColor: colors.borderColor }]} activeOpacity={0.7}
                  onPress={(e) => { e.stopPropagation(); navigation.navigate('TeacherStudents' as any, { initialTab: 'Needs Attention' }); }}>
                  <Text style={[styles.overviewVal, { color: colors.accentRed }]}>{allNeedsAttention.length}</Text>
                  <Text style={styles.overviewKey}>Need Attention</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.overviewDivider, { marginTop: spacing.md, marginBottom: spacing.md }]} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={styles.cardTitle}>Recent Activity</Text>
                <Feather name="clock" size={12} color={colors.textDim} />
              </View>
              {recentStudents.length === 0 ? (
                <Text style={[styles.overviewLabel, { textAlign: 'center', marginVertical: spacing.sm }]}>
                  No recent activity
                </Text>
              ) : (
                <View style={{ gap: spacing.xs }}>
                  {recentStudents.map((item, i) => (
                    <TouchableOpacity key={item.id} activeOpacity={0.7}
                      style={[styles.actRowCompact, i < recentStudents.length - 1 && styles.actBorderCompact]}
                      onPress={(e) => { e.stopPropagation(); navigation.navigate('TeacherProgress' as any, { studentId: item.studentId }); }}>
                      <View style={[styles.actAvatarCompact, { backgroundColor: gold + '15' }]}>
                        <Feather name={item.icon} size={13} color={gold} />
                      </View>
                      <View style={styles.actInfoCompact}>
                        <Text style={styles.actNameCompact} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.actActionCompact} numberOfLines={1}>
                          {item.title ? (
                            <>
                              {item.prefix}
                              <Text style={{ fontWeight: '700', color: colors.textMain }}>{item.title}</Text>
                              {item.suffix}
                            </>
                          ) : item.action}
                        </Text>
                      </View>
                      <View style={styles.actRightCompact}>
                        <Text style={styles.actTimeCompact}>{item.time}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </TouchableOpacity>

            {/* Class Progress — Learning Path + Assignments + Challenges */}
            <View style={[styles.card, styles.flex1]}>
              <View style={styles.cardHeader}>
                <Feather name="activity" size={15} color={colors.accentCyan} />
                <Text style={styles.cardTitle}>Class Progress</Text>
              </View>

              {/* Donut + study time */}
              <View style={styles.donutRow}>
                <View style={styles.donutWrap}>
                  <DonutChart progress={classProgressPct / 100} size={72} color={gold} trackColor={ringTrack} />
                  <View style={styles.donutCenter}>
                    <Text style={[styles.donutPct, { color: gold }]}>{classProgressPct}%</Text>
                  </View>
                </View>
                <View style={styles.donutStats}>
                  <Text style={styles.donutStatVal}>{formatStudyTime(medianCombinedMins)}</Text>
                  <Text style={styles.donutStatLabel}>Typical Study Time</Text>
                </View>
              </View>

              {totalStudents > 1 && (
                <View style={{ flexDirection: 'row', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.borderColor }}>
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: colors.accentRed }}>{formatStudyTime(minCombinedMins)}</Text>
                    <Text style={{ fontSize: 9, color: colors.textDim, fontWeight: '600', marginTop: 1 }}>Lowest</Text>
                  </View>
                  <View style={{ flex: 1, alignItems: 'center', borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.borderColor }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: gold }}>{formatStudyTime(medianCombinedMins)}</Text>
                    <Text style={{ fontSize: 9, color: colors.textDim, fontWeight: '600', marginTop: 1 }}>Typical</Text>
                  </View>
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: colors.accentGreen }}>{formatStudyTime(maxCombinedMins)}</Text>
                    <Text style={{ fontSize: 9, color: colors.textDim, fontWeight: '600', marginTop: 1 }}>Highest</Text>
                  </View>
                </View>
              )}

              {/* 3 progress bars */}
              <View style={styles.progressBars}>
                {/* Learning Path */}
                <View style={styles.progressItem}>
                  <View style={styles.progressLabelRow}>
                    <Feather name="map" size={11} color={gold} />
                    <Text style={styles.progressLabel}>Learning Path</Text>
                    <Text style={[styles.progressPct, { color: gold }]}>{avgProgress}%</Text>
                  </View>
                  <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
                    <View style={[styles.progressFill, { width: `${avgProgress}%` as any, backgroundColor: gold }]} />
                  </View>
                </View>

                {/* Assignments */}
                <View style={styles.progressItem}>
                  <View style={styles.progressLabelRow}>
                    <Feather name="edit-3" size={11} color="#8A8358" />
                    <Text style={styles.progressLabel}>Assignments</Text>
                    <Text style={[styles.progressPct, { color: '#8A8358' }]}>
                      {totalAssignmentsSubmitted}/{totalAssignmentsAssigned} · {assignSubmitPct}%
                    </Text>
                  </View>
                  <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
                    <View style={[styles.progressFill, { width: `${assignSubmitPct}%` as any, backgroundColor: '#8A8358' }]} />
                  </View>
                </View>

                {/* Challenges */}
                <View style={styles.progressItem}>
                  <View style={styles.progressLabelRow}>
                    <Feather name="target" size={11} color={gold} />
                    <Text style={styles.progressLabel}>Challenges</Text>
                    <Text style={[styles.progressPct, { color: gold }]}>
                      {totalChallengesCompleted}/{totalChallengesAssigned} · {challCompletePct}%
                    </Text>
                  </View>
                  <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
                    <View style={[styles.progressFill, { width: `${challCompletePct}%` as any, backgroundColor: gold }]} />
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* ── AI Teaching Insights — 3 columns ────────────── */}
          <View style={[styles.insightsCard, { marginBottom: spacing.xl }]}>
            <View style={styles.insightsHeader}>
              <View style={styles.insightsHeaderLeft}>
                <View style={styles.insightsIconWrap}>
                  <Feather name="cpu" size={14} color={gold} />
                </View>
                <Text style={styles.insightsTitle}>AI Teaching Insights</Text>
              </View>
            </View>

            <View style={styles.insightCols}>
              {/* Column 1: Learning Path */}
              <View style={styles.insightCol}>
                <View style={styles.colHeader}>
                  <Feather name="map" size={11} color={gold} />
                  <Text style={[styles.colHeaderText, { color: gold }]}>Learning Path</Text>
                </View>
                {learningPathTiles.map((tile, i) => (
                  <TouchableOpacity key={`lp-${i}`} activeOpacity={0.7}
                    style={[styles.colRow, i < learningPathTiles.length - 1 && styles.colRowBorder]}
                    onPress={() => setInsightModal({ tileIndex: i })}>
                    <View style={[styles.colRowIcon, { backgroundColor: tile.color + '15' }]}>
                      <Feather name={tile.icon} size={11} color={tile.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.colRowTitle} numberOfLines={1}>{tile.title}</Text>
                      <Text style={styles.colRowSub} numberOfLines={1}>{tile.body}</Text>
                    </View>
                    <Text style={[styles.colRowStat, { color: tile.color }]}>{tile.stat}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Column 2: Assignments */}
              <View style={[styles.insightCol, styles.insightColBorder]}>
                <View style={styles.colHeader}>
                  <Feather name="edit-3" size={11} color="#8A8358" />
                  <Text style={[styles.colHeaderText, { color: '#8A8358' }]}>Assignments</Text>
                </View>
                {assignmentTiles.map((tile, i) => {
                  const idx = learningPathTiles.length + i;
                  return (
                    <TouchableOpacity key={`as-${i}`} activeOpacity={0.7}
                      style={[styles.colRow, i < assignmentTiles.length - 1 && styles.colRowBorder]}
                      onPress={() => setInsightModal({ tileIndex: idx })}>
                      <View style={[styles.colRowIcon, { backgroundColor: tile.color + '15' }]}>
                        <Feather name={tile.icon} size={11} color={tile.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.colRowTitle} numberOfLines={1}>{tile.title}</Text>
                        <Text style={styles.colRowSub} numberOfLines={1}>{tile.body}</Text>
                      </View>
                      <Text style={[styles.colRowStat, { color: tile.color }]}>{tile.stat}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Column 3: Challenges */}
              <View style={[styles.insightCol, styles.insightColBorder]}>
                <View style={styles.colHeader}>
                  <Feather name="target" size={11} color="#C49098" />
                  <Text style={[styles.colHeaderText, { color: '#C49098' }]}>Challenges</Text>
                </View>
                {challengeTiles.map((tile, i) => {
                  const idx = learningPathTiles.length + assignmentTiles.length + i;
                  return (
                    <TouchableOpacity key={`ch-${i}`} activeOpacity={0.7}
                      style={[styles.colRow, i < challengeTiles.length - 1 && styles.colRowBorder]}
                      onPress={() => setInsightModal({ tileIndex: idx })}>
                      <View style={[styles.colRowIcon, { backgroundColor: tile.color + '15' }]}>
                        <Feather name={tile.icon} size={11} color={tile.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.colRowTitle} numberOfLines={1}>{tile.title}</Text>
                        <Text style={styles.colRowSub} numberOfLines={1}>{tile.body}</Text>
                      </View>
                      <Text style={[styles.colRowStat, { color: tile.color }]}>{tile.stat}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>


          {/* Recent Activity has been moved to the Student Overview card */}

        </ScrollView>
      </View>

      {/* ── Insight Detail Modal ───────────────────────── */}
      <Modal visible={!!insightModal} transparent animationType="fade" onRequestClose={() => setInsightModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, [1, 4, 6].includes(insightModal?.tileIndex as number) && { maxWidth: 720 }]}>
            {insightModal && renderInsightModalContent(insightModal.tileIndex)}
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

// ─────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────
const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48 },

  aiCard: {
    backgroundColor: c.accentYellow,
    borderRadius: radius.xl,
    padding: spacing.xl,
    overflow: 'hidden',
    position: 'relative',
    gap: spacing.lg,
  },
  aiTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, zIndex: 1 },
  aiIconWrap: {
    width: 42, height: 42, borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  aiTag: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.8)', letterSpacing: 0.9, marginBottom: 4 },
  aiTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 5, letterSpacing: -0.2 },
  aiSub: { fontSize: 13, color: 'rgba(255,255,255,0.78)', lineHeight: 19 },
  aiBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg, paddingVertical: 11,
    borderRadius: radius.md, zIndex: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 4,
  },
  aiBtnText: { fontSize: 13, fontWeight: '700', color: c.accentYellow },

  row: { flexDirection: 'row', gap: spacing.md },
  flex1: { flex: 1 },
  card: {
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.lg,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: spacing.md },
  cardTitle: { fontSize: 13, fontWeight: '700', color: c.textMain, flex: 1 },
  cardSub: { fontSize: 11, color: c.textDim, marginBottom: spacing.md, fontWeight: '500' },

  bigNumber: { fontSize: 36, fontWeight: '900', color: c.textMain, letterSpacing: -1.5 },
  changeText: { fontSize: 11, fontWeight: '600', marginTop: 2, marginBottom: 2 },
  overviewLabel: { fontSize: 11, color: c.textDim, marginBottom: spacing.md },
  overviewDivider: { height: 1, backgroundColor: c.borderColor, marginBottom: spacing.md },
  overviewRow: { flexDirection: 'row' },
  overviewStat: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm },
  overviewVal: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  overviewKey: { fontSize: 10, color: c.textDim, textAlign: 'center', marginTop: 2 },

  donutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  donutWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  donutCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  donutPct: { fontSize: 14, fontWeight: '800', letterSpacing: -0.5 },
  donutStats: { flex: 1 },
  donutStatVal: { fontSize: 15, fontWeight: '800', color: c.textMain },
  donutStatLabel: { fontSize: 10, color: c.textDim, marginTop: 1 },

  // 3 progress bars (Learning Path, Assignments, Challenges)
  progressBars: { gap: spacing.sm },
  progressItem: { gap: 3 },
  progressLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  progressLabel: { flex: 1, fontSize: 10, fontWeight: '600', color: c.textMuted },
  progressPct: { fontSize: 11, fontWeight: '800' },
  progressTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressTimeLabel: { fontSize: 9, fontWeight: '600', color: c.textDim },

  insightRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md, alignItems: 'flex-start' },
  insightBorder: { borderBottomWidth: 1, borderBottomColor: c.borderColor },
  insightIcon: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  insightTitle: { fontSize: 12, fontWeight: '700', color: c.textMain, marginBottom: 3 },
  insightBody: { fontSize: 11, color: c.textMuted, lineHeight: 16 },

  // AI Teaching Insights — Aivorah Enchanting Forest card
  insightsCard: {
    backgroundColor: c.cardDark,
    borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, overflow: 'hidden',
  },
  insightsHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs,
  },
  insightsHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  insightsIconWrap: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: c.accentYellow + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  insightsTitle: { fontSize: 13, fontWeight: '700', color: c.textMain, letterSpacing: -0.2 },

  // Filter tabs — pill style, Enchanting Forest
  filterRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  filterTab: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 16, borderWidth: 1,
    borderColor: c.borderColor,
    backgroundColor: 'transparent',
  },
  filterTabActive: {
    backgroundColor: c.accentYellow + '18',
    borderColor: c.accentYellow + '40',
  },
  filterTabText: { fontSize: 11, fontWeight: '600', color: c.textDim },
  filterTabTextActive: { color: c.accentYellow, fontWeight: '700' },

  // Summary strip — compact horizontal stats
  summaryStrip: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: c.accentYellow + '18',
    borderWidth: 1, borderColor: c.accentYellow + '12',
    marginBottom: spacing.sm,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryVal: { fontSize: 14, fontWeight: '800', color: c.textMain, letterSpacing: -0.3 },
  summaryLabel: { fontSize: 8, fontWeight: '600', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 1 },
  summaryDivider: { width: 1, height: 22, backgroundColor: c.borderColor },

  // 3-column insight layout
  insightCols: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  insightCol: { flex: 1, paddingHorizontal: spacing.xs },
  insightColBorder: { borderLeftWidth: 1, borderLeftColor: c.borderColor },
  colHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingBottom: 6, marginBottom: 2,
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  colHeaderText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  colRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6,
  },
  colRowBorder: { borderBottomWidth: 1, borderBottomColor: c.borderColor + '50' },
  colRowIcon: {
    width: 24, height: 24, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  colRowTitle: { fontSize: 12, fontWeight: '700', color: c.textMain },
  colRowSub: { fontSize: 10, color: c.textDim, marginTop: 1 },
  colRowStat: { fontSize: 13, fontWeight: '900', letterSpacing: -0.3, flexShrink: 0 },

  // Keep tileGrid for modal use (legacy)
  tileGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  // Tile styles (used in modals)
  tileIconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.textMain },

  qaScroll: { marginHorizontal: -spacing.xl },
  qaContent: { paddingHorizontal: spacing.xl, gap: spacing.md },
  qaItem: { alignItems: 'center', gap: 7, width: 76 },
  qaIcon: { width: 56, height: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  qaLabel: { fontSize: 11, fontWeight: '600', color: c.textMuted, textAlign: 'center' },

  activityCard: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, overflow: 'hidden' },
  actRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  actBorder: { borderBottomWidth: 1, borderBottomColor: c.borderColor },
  actAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  actInitials: { fontSize: 12, fontWeight: '800' },
  actInfo: { flex: 1 },
  actName: { fontSize: 13, fontWeight: '600', color: c.textMain },
  actAction: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  actRight: { alignItems: 'flex-end', gap: 4 },
  scorePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  scoreText: { fontSize: 11, fontWeight: '700' },
  actTime: { fontSize: 11, color: c.textDim },

  actRowCompact: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  actBorderCompact: { borderBottomWidth: 1, borderBottomColor: c.borderColor + '40' },
  actAvatarCompact: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  actInitialsCompact: { fontSize: 10, fontWeight: '800' },
  actInfoCompact: { flex: 1 },
  actNameCompact: { fontSize: 12, fontWeight: '600', color: c.textMain },
  actActionCompact: { fontSize: 10, color: c.textMuted, marginTop: 1 },
  actRightCompact: { alignItems: 'flex-end', gap: 2 },
  scorePillCompact: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  scoreTextCompact: { fontSize: 9, fontWeight: '700' },
  actTimeCompact: { fontSize: 9, color: c.textDim },

  // Modal — centered, Enchanting Forest themed
  modalOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', padding: spacing.lg,
  },
  modalSheet: {
    backgroundColor: c.cardDark, borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.borderColor,
    maxHeight: '70%', width: '100%', maxWidth: 440,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: c.accentYellow + '18',
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  modalStat: { fontSize: 18, fontWeight: '900', letterSpacing: -0.5 },
  modalHeading: { fontSize: 11, fontWeight: '600', color: c.textMuted, marginTop: 1 },
  modalClose: {
    padding: 4, borderRadius: 8,
    backgroundColor: c.borderColor + '40',
  },
  modalScroll: { paddingHorizontal: 0 },
  modalEmpty: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  modalEmptyText: { fontSize: 12, color: c.textDim, textAlign: 'center' },
  modalAvatar: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  modalAvatarText: { fontSize: 10, fontWeight: '800' },
  modalRowBorder: { borderBottomWidth: 1, borderBottomColor: c.borderColor },

  // Table layout — compact
  tableHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 6,
    backgroundColor: c.bgDark,
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  tableCol: { fontSize: 9, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.4 },
  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: spacing.md,
  },
  tableRowAlt: { backgroundColor: c.accentYellow + '08' },
  tableCell: {},
  tableStudentName: { fontSize: 12, fontWeight: '700', color: c.textMain },
  tableStudentGrade: { fontSize: 9, color: c.textDim, marginTop: 1 },
  tableChip: {
    fontSize: 9, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 5, borderWidth: 1, alignSelf: 'flex-start',
  },
  pctPill: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, borderWidth: 1,
  },
  pctPillText: { fontSize: 10, fontWeight: '800' },
});
