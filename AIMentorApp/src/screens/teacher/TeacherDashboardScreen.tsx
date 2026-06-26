import React, { useMemo, useState, useEffect } from 'react';
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

  const firstName = user?.name?.split(' ')[0] || 'Teacher';
  const ringTrack = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';

  const fetchStudents = async () => {
    try {
      const teacherEmail = user?.email || 'teacher@demo.com';
      const [studRes, insRes] = await Promise.all([
        fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(teacherEmail)}`),
        fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(teacherEmail)}/insights`),
      ]);
      const data = await studRes.json();
      if (Array.isArray(data)) setStudents(data);
      try { const ins = await insRes.json(); setInsights(ins); } catch {}
    } catch {
      // keep previous data
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchStudents(); }, [user?.email]);

  // ── Computed stats ──────────────────────────────────────
  const today = todayISO();
  const totalStudents = students.length;
  const allNeedsAttention = students.filter(s => s.needsAttention);
  const needsAttentionStudents = allNeedsAttention.slice(0, 3); // show max 3 in dashboard card
  const activeToday = students.filter(s => s.lastActive === today).length;
  const avgProgress = totalStudents > 0
    ? Math.round(students.reduce((sum, s) => sum + (s.progressPct || 0), 0) / totalStudents)
    : 0;
  const avgStudyMins = totalStudents > 0
    ? Math.round(students.reduce((sum, s) => sum + (s.studyTime || 0), 0) / totalStudents)
    : 0;

  // Assignment & Challenge completion rates (from insights endpoint)
  const ins = insights || { assignments: [], challenges: [], totals: {} };
  const assignSubmitPct = totalStudents > 0
    ? Math.round((ins.assignments.filter((s: any) => s.submitted > 0).length / totalStudents) * 100)
    : 0;
  const challCompletePct = totalStudents > 0
    ? Math.round((ins.challenges.filter((s: any) => s.completed > 0).length / totalStudents) * 100)
    : 0;

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
  const streakAtRisk = students.filter(s => (s.currentStreak || 0) === 1);
  const topStudent = [...students].sort((a, b) => (b.progressPct || 0) - (a.progressPct || 0))[0];
  const pendingAssignments = students.reduce((sum, s) => sum + ((s.assignmentsDone || 0) === 0 ? 1 : 0), 0);

  // Most struggled topic: fewest students completed it
  const topicCounts: Record<string, number> = {};
  students.forEach(s => (s.completedTopics || []).forEach((t: string) => { topicCounts[t] = (topicCounts[t] || 0) + 1; }));
  const hardestTopic = Object.entries(topicCounts).sort((a, b) => a[1] - b[1])[0];

  // Avg study time per student (for insight tile)
  const totalStudyMins = students.reduce((sum, s) => sum + (s.studyTime || 0), 0);

  // ── Insight tile type ─────────────────────────────────────
  type InsightTile = { icon: any; color: string; stat: string; label: string; title: string; body: string; screen: string; params?: Record<string, any> };

  // Assignment insights from server data
  const totals = insights?.totals || {};
  const assignStats = insights?.assignments || [];
  const challStats = insights?.challenges || [];

  const studentsWithSubmissions = assignStats.filter((s: any) => s.submitted > 0).length;
  const studentsWithNoSubmissions = totalStudents - studentsWithSubmissions;
  const classAvgScore = totals.classAvgScore;
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
      stat: hardestTopic ? `${totalStudents - hardestTopic[1]}` : `${allNeedsAttention.length}`,
      label: 'Struggling',
      title: hardestTopic ? `Stuck on "${hardestTopic[0]}"` : 'Need Support',
      body: hardestTopic
        ? `${totalStudents - hardestTopic[1]} haven't completed this topic yet.`
        : `${allNeedsAttention.length} student${allNeedsAttention.length !== 1 ? 's' : ''} need focused review.`,
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
      icon: 'zap', color: T.coral,
      stat: `${streakAtRisk.length}`,
      label: 'Streak Risk',
      title: streakAtRisk.length > 0 ? 'At Risk Today' : 'Streaks Safe',
      body: streakAtRisk.length > 0
        ? `${streakAtRisk.slice(0, 2).map(s => s.name?.split(' ')[0]).join(', ')} on 1-day streak.`
        : 'No streaks at risk today.',
      screen: 'TeacherStudents', params: { initialTab: 'Streak Risk' },
    },
    {
      icon: 'clock', color: T.teal,
      stat: formatStudyTime(totalStudyMins),
      label: 'Study Time',
      title: totalStudyMins > 0 ? `${formatStudyTime(avgStudyMins)} avg per student` : 'No Study Yet',
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
        ? `${studentsWithChallenges} Participating`
        : 'No Challenges Yet',
      body: studentsWithChallenges > 0
        ? `${totals.totalChallengesAssigned || 0} total challenges assigned.`
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

  // Combined flat array for modal index lookup (Learning Path 0-4, Assignments 5-7, Challenges 8-10)
  const aiInsightTiles: InsightTile[] = [...learningPathTiles, ...assignmentTiles, ...challengeTiles];

  // ── Recent activity: students sorted by last active ────
  const recentStudents = [...students]
    .sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''))
    .slice(0, 4)
    .map(s => {
      const isToday = s.lastActive === today;
      const isYesterday = s.lastActive === (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; })();
      const timeLabel = isToday ? 'Today' : isYesterday ? 'Yesterday' : s.lastActive || 'Never';
      return {
        initials: (s.name || '??').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase(),
        name: s.name || 'Unknown',
        action: s.completedTopics?.length > 0
          ? `Completed ${s.completedTopics.length} chapter${s.completedTopics.length > 1 ? 's' : ''}`
          : `${formatStudyTime(s.studyTime || 0)} total study time`,
        score: s.progressPct ? `${s.progressPct}%` : null,
        time: timeLabel,
        scoreGood: (s.progressPct || 0) >= 50,
      };
    });

  const aiActionTitle = allNeedsAttention.length > 0
    ? `Review struggling students (${allNeedsAttention.length} flagged)`
    : avgProgress > 0
      ? `Class at ${avgProgress}% — keep pushing!`
      : 'Set up your first assignment to get started';

  const aiActionBody = allNeedsAttention.length > 0
    ? `${needsAttentionStudents[0]?.name?.split(' ')[0] || 'A student'} and others have low progress or streak. Schedule a review session or send an encouraging message.`
    : `Average study time is ${formatStudyTime(avgStudyMins)} per student. Assign chapter quizzes to boost engagement.`;

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

      case 0: { // Struggling — per-student topic breakdown
        const topic = hardestTopic ? hardestTopic[0] : '';
        const stuck = students
          .filter(s => !topic || !(s.completedTopics || []).includes(topic))
          .sort((a, b) => (a.progressPct || 0) - (b.progressPct || 0));
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>{stuck.length} Students</Text>
                <Text style={styles.modalHeading}>
                  {topic ? 'Not yet completed: "' + topic + '"' : 'Struggling Students'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { flex: 3 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 2 }]}>Topics Done</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Streak</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Progress</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {stuck.length === 0 ? (
                <View style={styles.modalEmpty}>
                  <Feather name="check-circle" size={28} color="#5A8A70" />
                  <Text style={styles.modalEmptyText}>All students have completed this topic!</Text>
                </View>
              ) : stuck.map((s, i) => {
                const doneCount = (s.completedTopics || []).length;
                const pct = s.progressPct || 0;
                const pctColor = pct < 20 ? '#B8797E' : '#8A8358';
                const streak = s.currentStreak || 0;
                return (
                  <View key={s.id || String(i)} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                    <View style={[styles.tableCell, { flex: 3, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                      <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                        <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name || '?')}</Text>
                      </View>
                      <View>
                        <Text style={styles.tableStudentName}>{(s.name || 'Unknown').split(' ')[0]}</Text>
                        <Text style={styles.tableStudentGrade}>{s.grade || '—'}</Text>
                      </View>
                    </View>
                    <View style={[styles.tableCell, { flex: 2 }]}>
                      <Text style={[styles.tableChip, doneCount === 0
                        ? { color: '#B8797E', borderColor: '#B8797E40', backgroundColor: '#B8797E10' }
                        : { color: '#5A8A70', borderColor: '#5A8A7040', backgroundColor: '#5A8A7010' }
                      ]}>
                        {doneCount === 0 ? 'None yet' : doneCount + ' topics done'}
                      </Text>
                    </View>
                    <Text style={[styles.tableCell, { flex: 1, color: streak === 0 ? '#B8797E' : colors.textDim, fontSize: 12, fontWeight: '700' }]}>
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
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { width: 32 }]}>#</Text>
              <Text style={[styles.tableCol, { flex: 2 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Topics</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Streak</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Study</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Progress</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {ranked.map((s, i) => {
                const medal = i === 0 ? '#C5BD96' : i === 1 ? '#7AADA8' : i === 2 ? '#C4836A' : colors.textDim;
                return (
                  <View key={s.id || i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                    <Text style={[styles.tableCell, { width: 32, fontWeight: '800', color: medal, fontSize: 14 }]}>{i + 1}</Text>
                    <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                      <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                        <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name)}</Text>
                      </View>
                      <View>
                        <Text style={styles.tableStudentName}>{s.name.split(' ')[0]}</Text>
                        <Text style={styles.tableStudentGrade}>{s.grade}</Text>
                      </View>
                    </View>
                    <Text style={[styles.tableCell, { flex: 1, color: colors.textMuted, fontSize: 12 }]}>{(s.completedTopics || []).length}</Text>
                    <Text style={[styles.tableCell, { flex: 1, color: colors.textMuted, fontSize: 12 }]}>{s.currentStreak || 0}d</Text>
                    <Text style={[styles.tableCell, { flex: 1, color: colors.textMuted, fontSize: 12 }]}>{formatStudyTime(s.studyTime || 0)}</Text>
                    <View style={[styles.tableCell, { flex: 1, alignItems: 'flex-end' }]}>
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
              <Text style={[styles.tableCol, { flex: 1 }]}>Last Seen</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Topics</Text>
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
                    <View style={[styles.tableCell, { flex: 1 }]}>
                      <Text style={[styles.tableChip, { color: urgency, borderColor: urgency + '40', backgroundColor: urgency + '10' }]}>
                        {days === 999 ? 'Never' : `${days}d ago`}
                      </Text>
                    </View>
                    <Text style={[styles.tableCell, { flex: 1, color: colors.textMuted, fontSize: 12 }]}>{(s.completedTopics || []).length} done</Text>
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

      case 3: { // Streak Risk
        const atRisk = students.filter(s => (s.currentStreak || 0) === 1);
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>{atRisk.length} Students</Text>
                <Text style={styles.modalHeading}>Streaks That Reset Tonight</Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { flex: 2 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Streak</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Study Time</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Progress</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {atRisk.map((s, i) => (
                <View key={s.id || i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                  <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                    <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                      <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name)}</Text>
                    </View>
                    <View>
                      <Text style={styles.tableStudentName}>{s.name.split(' ')[0]}</Text>
                      <Text style={styles.tableStudentGrade}>{s.grade}</Text>
                    </View>
                  </View>
                  <View style={[styles.tableCell, { flex: 1 }]}>
                    <Text style={[styles.tableChip, { color: tile.color, borderColor: tile.color + '40', backgroundColor: tile.color + '10' }]}>
                      1-day streak
                    </Text>
                  </View>
                  <Text style={[styles.tableCell, { flex: 1, color: colors.textMuted, fontSize: 12 }]}>{formatStudyTime(s.studyTime || 0)}</Text>
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

      case 4: { // Study Time — per-student breakdown
        const ranked = [...students].sort((a, b) => (b.studyTime || 0) - (a.studyTime || 0));
        const maxMins = Math.max(...ranked.map(s => s.studyTime || 0), 1);
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
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMain }}>{formatStudyTime(s.studyTime || 0)}</Text>
                    <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
                      <View style={[styles.progressFill, { width: `${Math.round(((s.studyTime || 0) / maxMins) * 100)}%` as any, backgroundColor: tile.color }]} />
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
      case 5: { // Pending — students with no submissions
        const noSubs = (assignStats as any[]).filter((s: any) => s.submitted === 0);
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
              <Text style={[styles.tableCol, { flex: 2 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Submitted</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {noSubs.length === 0 ? (
                <View style={styles.modalEmpty}>
                  <Feather name="check-circle" size={28} color="#5A8A70" />
                  <Text style={styles.modalEmptyText}>Everyone has submitted at least one assignment!</Text>
                </View>
              ) : noSubs.map((s: any, i: number) => (
                <View key={s.id || i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                  <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                    <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                      <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name || '?')}</Text>
                    </View>
                    <Text style={styles.tableStudentName}>{(s.name || 'Unknown').split(' ')[0]}</Text>
                  </View>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'right', color: '#B8797E', fontSize: 12, fontWeight: '700' }]}>0</Text>
                </View>
              ))}
            </ScrollView>
          </>
        );
      }

      case 6: { // Avg Score — all students ranked by assignment avg score
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
              <Text style={[styles.tableCol, { width: 32 }]}>#</Text>
              <Text style={[styles.tableCol, { flex: 2 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Submitted</Text>
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
                    <Text style={[styles.tableCell, { width: 32, fontWeight: '800', color: i < 3 ? tile.color : colors.textDim, fontSize: 14 }]}>{i + 1}</Text>
                    <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                      <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                        <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name || '?')}</Text>
                      </View>
                      <Text style={styles.tableStudentName}>{(s.name || 'Unknown').split(' ')[0]}</Text>
                    </View>
                    <Text style={[styles.tableCell, { flex: 1, color: colors.textMuted, fontSize: 12 }]}>{s.submitted}</Text>
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

      case 7: { // Submitted — all students with submission counts
        const ranked = [...(assignStats as any[])].sort((a: any, b: any) => b.submitted - a.submitted);
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
              <Text style={[styles.tableCol, { flex: 2 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Submitted</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Avg Score</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {ranked.map((s: any, i: number) => (
                <View key={s.id || i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowAlt]}>
                  <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                    <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                      <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name || '?')}</Text>
                    </View>
                    <Text style={styles.tableStudentName}>{(s.name || 'Unknown').split(' ')[0]}</Text>
                  </View>
                  <Text style={[styles.tableCell, { flex: 1, color: s.submitted > 0 ? '#5A8A70' : '#B8797E', fontSize: 12, fontWeight: '700' }]}>{s.submitted}</Text>
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
      case 8: { // Attempted — students with challenges
        const withCh = (challStats as any[]).filter((s: any) => s.assigned > 0);
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
              <Text style={[styles.tableCol, { flex: 1 }]}>Assigned</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Done</Text>
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
                  <Text style={[styles.tableCell, { flex: 1, color: colors.textMuted, fontSize: 12 }]}>{s.assigned}</Text>
                  <Text style={[styles.tableCell, { flex: 1, color: s.completed > 0 ? '#5A8A70' : '#B8797E', fontSize: 12, fontWeight: '700' }]}>{s.completed}</Text>
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

      case 9: { // Completed — students who finished challenges
        const done = (challStats as any[]).filter((s: any) => s.completed > 0).sort((a: any, b: any) => b.completed - a.completed);
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
              <Text style={[styles.tableCol, { flex: 1 }]}>Completed</Text>
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
                  <Text style={[styles.tableCell, { flex: 1, color: '#5A8A70', fontSize: 12, fontWeight: '700' }]}>{s.completed}</Text>
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

      case 10: { // Top Scorer — challenge leaderboard
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
              <Text style={[styles.tableCol, { width: 32 }]}>#</Text>
              <Text style={[styles.tableCol, { flex: 2 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Done</Text>
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
                    <Text style={[styles.tableCell, { width: 32, fontWeight: '800', color: medal, fontSize: 14 }]}>{i + 1}</Text>
                    <View style={[styles.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                      <View style={[styles.modalAvatar, { backgroundColor: tile.color + '20', width: 30, height: 30, borderRadius: 15 }]}>
                        <Text style={[styles.modalAvatarText, { color: tile.color, fontSize: 10 }]}>{initials(s.name || '?')}</Text>
                      </View>
                      <Text style={styles.tableStudentName}>{(s.name || 'Unknown').split(' ')[0]}</Text>
                    </View>
                    <Text style={[styles.tableCell, { flex: 1, color: colors.textMuted, fontSize: 12 }]}>{s.completed || 0}</Text>
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
          <ActivityIndicator color={colors.primary} size="large" />
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchStudents(); }} tintColor={colors.primary} />}
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
            <TouchableOpacity style={styles.aiBtn} activeOpacity={0.85} onPress={() => navigation.navigate('TeacherSchedule' as any)}>
              <Feather name="calendar" size={14} color={gold} />
              <Text style={styles.aiBtnText}>Schedule Session</Text>
            </TouchableOpacity>
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
                  onPress={() => navigation.navigate('TeacherStudents' as any, { initialTab: 'Active Today' })}>
                  <Text style={[styles.overviewVal, { color: colors.accentGreen }]}>{activeToday}</Text>
                  <Text style={styles.overviewKey}>Active Today</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.overviewStat, { borderLeftWidth: 1, borderLeftColor: colors.borderColor }]} activeOpacity={0.7}
                  onPress={() => navigation.navigate('TeacherStudents' as any, { initialTab: 'Needs Attention' })}>
                  <Text style={[styles.overviewVal, { color: colors.accentRed }]}>{allNeedsAttention.length}</Text>
                  <Text style={styles.overviewKey}>Need Attention</Text>
                </TouchableOpacity>
              </View>
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
                  <DonutChart progress={avgProgress / 100} size={72} color={gold} trackColor={ringTrack} />
                  <View style={styles.donutCenter}>
                    <Text style={[styles.donutPct, { color: gold }]}>{avgProgress}%</Text>
                  </View>
                </View>
                <View style={styles.donutStats}>
                  <Text style={styles.donutStatVal}>{formatStudyTime(avgStudyMins)}</Text>
                  <Text style={styles.donutStatLabel}>Avg. Study Time</Text>
                </View>
              </View>

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
                    <Text style={[styles.progressPct, { color: '#8A8358' }]}>{assignSubmitPct}%</Text>
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
                    <Text style={[styles.progressPct, { color: gold }]}>{challCompletePct}%</Text>
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


          {/* ── RECENT ACTIVITY ──────────────────────────── */}
          <Text style={[styles.sectionTitle, { marginBottom: spacing.md }]}>Recent Activity</Text>
          {recentStudents.length === 0 ? (
            <View style={[styles.activityCard, { padding: spacing.xl, alignItems: 'center' }]}>
              <Feather name="clock" size={24} color={colors.textDim} />
              <Text style={[styles.actAction, { marginTop: 8 }]}>No activity yet — students haven't started yet</Text>
            </View>
          ) : (
            <View style={styles.activityCard}>
              {recentStudents.map((item, i) => (
                <View key={i} style={[styles.actRow, i < recentStudents.length - 1 && styles.actBorder]}>
                  <View style={[styles.actAvatar, { backgroundColor: item.scoreGood ? colors.accentGreen + '20' : colors.accentRed + '20' }]}>
                    <Text style={[styles.actInitials, { color: item.scoreGood ? colors.accentGreen : colors.accentRed }]}>{item.initials}</Text>
                  </View>
                  <View style={styles.actInfo}>
                    <Text style={styles.actName}>{item.name}</Text>
                    <Text style={styles.actAction}>{item.action}</Text>
                  </View>
                  <View style={styles.actRight}>
                    {item.score && (
                      <View style={[styles.scorePill, { backgroundColor: colors.accentGreen + '18' }]}>
                        <Text style={[styles.scoreText, { color: colors.accentGreen }]}>{item.score}</Text>
                      </View>
                    )}
                    <Text style={styles.actTime}>{item.time}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

        </ScrollView>
      </View>

      {/* ── Insight Detail Modal ───────────────────────── */}
      <Modal visible={!!insightModal} transparent animationType="fade" onRequestClose={() => setInsightModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
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

  // Modal — centered, Enchanting Forest themed
  modalOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', padding: spacing.lg,
  },
  modalSheet: {
    backgroundColor: c.cardDark, borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.borderColor,
    maxHeight: '70%', width: '100%', maxWidth: 520,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: c.accentYellow + '18',
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  modalStat: { fontSize: 18, fontWeight: '900', letterSpacing: -0.5 },
  modalHeading: { fontSize: 11, fontWeight: '600', color: c.textMuted, marginTop: 1 },
  modalClose: {
    padding: 4, borderRadius: 8,
    backgroundColor: c.borderColor + '40',
  },
  modalScroll: { paddingHorizontal: spacing.md },
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
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
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
