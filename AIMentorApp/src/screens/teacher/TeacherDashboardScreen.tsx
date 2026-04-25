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
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const firstName = user?.name?.split(' ')[0] || 'Teacher';
  const ringTrack = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';

  const fetchStudents = async () => {
    try {
      const teacherEmail = user?.email || 'teacher@demo.com';
      const res = await fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(teacherEmail)}`);
      const data = await res.json();
      if (Array.isArray(data)) setStudents(data);
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
  // Students above 50% based on their own curriculum's total topics (real data)
  const aboveHalfCount = students.filter(s => (s.progressPct || 0) >= 50).length;
  const aboveHalfPct = totalStudents > 0 ? Math.round((aboveHalfCount / totalStudents) * 100) : 0;
  const avgStudyMins = totalStudents > 0
    ? Math.round(students.reduce((sum, s) => sum + (s.studyTime || 0), 0) / totalStudents)
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

  // Peak learning time: hour with most lastActive students (using lastActive date hour as proxy)
  const hourCounts: Record<number, number> = {};
  students.forEach(s => {
    if (s.lastActive) {
      const h = new Date(s.lastActive).getHours();
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    }
  });
  const peakHour = Object.entries(hourCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  const peakLabel = peakHour
    ? (() => {
        const h = Number(peakHour[0]);
        const fmt = (n: number) => `${n % 12 || 12}${n < 12 ? 'am' : 'pm'}`;
        return `${fmt(h)}–${fmt(h + 1)}`;
      })()
    : null;

  // 6 graphical insight tiles — Aivorah pastel palette
  const aiInsightTiles: { icon: any; color: string; stat: string; label: string; title: string; body: string; screen: string; params?: Record<string, any> }[] = [
    {
      icon: 'book-open',
      color: '#B8797E',
      stat: hardestTopic ? `${totalStudents - hardestTopic[1]}` : `${allNeedsAttention.length}`,
      label: 'Struggling',
      title: hardestTopic ? `Stuck on "${hardestTopic[0]}"` : 'Need Support',
      body: hardestTopic
        ? `${totalStudents - hardestTopic[1]} student${totalStudents - hardestTopic[1] !== 1 ? 's' : ''} haven't completed this topic. Consider a focused group review session.`
        : `${allNeedsAttention.length} student${allNeedsAttention.length !== 1 ? 's' : ''} have low progress. Schedule focused review sessions.`,
      screen: 'TeacherStudents', params: { initialTab: 'Needs Attention' },
    },
    {
      icon: 'award',
      color: '#5A8A70',
      stat: topStudent ? `${topStudent.progressPct}%` : '—',
      label: 'Top Score',
      title: topStudent ? `${topStudent.name?.split(' ')[0]} is Leading` : 'No Data Yet',
      body: topStudent
        ? `${topStudent.name?.split(' ')[0]} leads the class at ${topStudent.progressPct}% with ${topStudent.completedTopics?.length || 0} topics done. Give them an advanced challenge!`
        : 'Students have not started yet. Assign the first topic to get going.',
      screen: 'TeacherStudents', params: { initialTab: 'Top Performers' },
    },
    {
      icon: 'moon',
      color: '#8A8358',
      stat: `${inactiveStudents.length}`,
      label: 'Inactive 3d+',
      title: inactiveStudents.length > 0 ? 'Students Going Quiet' : 'Everyone Active',
      body: inactiveStudents.length > 0
        ? `${inactiveStudents.slice(0, 2).map(s => s.name?.split(' ')[0]).join(', ')}${inactiveStudents.length > 2 ? ` +${inactiveStudents.length - 2} more` : ''} haven't logged in for 3+ days. A quick nudge could bring them back.`
        : 'All students have been active recently. Great engagement this week!',
      screen: 'TeacherStudents', params: { initialTab: 'Inactive' },
    },
    {
      icon: 'zap',
      color: '#C4836A',
      stat: `${streakAtRisk.length}`,
      label: 'Streak Risk',
      title: streakAtRisk.length > 0 ? 'Streaks at Risk Today' : 'Streaks Safe',
      body: streakAtRisk.length > 0
        ? `${streakAtRisk.slice(0, 2).map(s => s.name?.split(' ')[0]).join(', ')} ${streakAtRisk.length > 1 ? 'are' : 'is'} on a 1-day streak. Encourage them to practice today before it resets.`
        : 'No student is at risk of losing their streak today. Keep the momentum going!',
      screen: 'TeacherStudents', params: { initialTab: 'Streak Risk' },
    },
    {
      icon: 'clipboard',
      color: '#7AADA8',
      stat: `${pendingAssignments}`,
      label: 'Pending',
      title: pendingAssignments > 0 ? 'Assignments Not Started' : 'All Submitted',
      body: pendingAssignments > 0
        ? `${pendingAssignments} student${pendingAssignments !== 1 ? 's' : ''} haven't submitted any assignments yet. Send a reminder or reduce difficulty to get them started.`
        : 'All students have submitted at least one assignment. Consider assigning the next chapter.',
      screen: 'TeacherAssignments',
    },
    {
      icon: 'clock',
      color: '#5F8A86',
      stat: peakLabel || '—',
      label: 'Peak Time',
      title: peakLabel ? `Most Active at ${peakLabel}` : 'No Activity Yet',
      body: peakLabel
        ? `Your class is most active around ${peakLabel}. Schedule assignments or reminders just before this window for best engagement.`
        : 'Activity data will appear once students start logging in regularly.',
      screen: 'TeacherSchedule',
    },
  ];

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

      case 4: { // Pending Assignments
        const pending = students.filter(s => (s.assignmentsDone || 0) === 0);
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>{pending.length} Students</Text>
                <Text style={styles.modalHeading}>No Assignments Submitted Yet</Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { flex: 2 }]}>Student</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Submitted</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Study Time</Text>
              <Text style={[styles.tableCol, { flex: 1, textAlign: 'right' }]}>Progress</Text>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {pending.map((s, i) => (
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
                  <Text style={[styles.tableCell, { flex: 1, color: '#B8797E', fontSize: 12, fontWeight: '700' }]}>0</Text>
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

      case 5: { // Peak Time — activity distribution
        const hourBuckets = Array.from({ length: 24 }, (_, h) => ({
          hour: h,
          count: students.filter(s => s.lastActive && new Date(s.lastActive).getHours() === h).length,
        })).filter(b => b.count > 0).sort((a, b) => b.count - a.count);
        const maxCount = Math.max(...hourBuckets.map(b => b.count), 1);
        return (
          <>
            <View style={styles.modalHeader}>
              <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                <Feather name={tile.icon} size={16} color={tile.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalStat, { color: tile.color }]}>{peakLabel || '—'}</Text>
                <Text style={styles.modalHeading}>Class Activity by Time of Day</Text>
              </View>
              <TouchableOpacity onPress={() => setInsightModal(null)} style={styles.modalClose}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <Text style={[styles.tableCol, { marginBottom: spacing.md, marginTop: spacing.sm }]}>
                Students active per hour window (based on last login time)
              </Text>
              {hourBuckets.map((b, i) => (
                <View key={i} style={[styles.peakRow, i < hourBuckets.length - 1 && styles.modalRowBorder]}>
                  <Text style={styles.peakHour}>{fmt12(b.hour)}–{fmt12(b.hour + 1)}</Text>
                  <View style={styles.peakBarWrap}>
                    <View style={[styles.peakBarFill, { width: `${Math.round((b.count / maxCount) * 100)}%` as any, backgroundColor: tile.color }]} />
                  </View>
                  <Text style={[styles.peakCount, { color: tile.color }]}>{b.count} student{b.count !== 1 ? 's' : ''}</Text>
                </View>
              ))}
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
          <View style={styles.aiCard}>
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
              <Feather name="calendar" size={14} color={colors.primary} />
              <Text style={styles.aiBtnText}>Schedule Session</Text>
            </TouchableOpacity>
          </View>

          {/* ── ROW 1: Student Overview + Class Progress ─── */}
          <View style={styles.row}>
            {/* Student Overview */}
            <TouchableOpacity style={[styles.card, styles.flex1]} activeOpacity={0.85} onPress={() => navigation.navigate('TeacherStudents' as any)}>
              <View style={styles.cardHeader}>
                <Feather name="users" size={15} color={colors.primary} />
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

            {/* Class Progress */}
            <View style={[styles.card, styles.flex1]}>
              <View style={styles.cardHeader}>
                <Feather name="activity" size={15} color={colors.accentCyan} />
                <Text style={styles.cardTitle}>Class Progress</Text>
              </View>
              <Text style={styles.cardSub}>Average Completion</Text>
              <View style={styles.donutRow}>
                <View style={styles.donutWrap}>
                  <DonutChart progress={avgProgress / 100} size={88} color={colors.primary} trackColor={ringTrack} />
                  <View style={styles.donutCenter}>
                    <Text style={[styles.donutPct, { color: colors.primary }]}>{avgProgress}%</Text>
                  </View>
                </View>
                <View style={styles.donutStats}>
                  <View style={styles.donutStat}>
                    <Text style={styles.donutStatVal}>{formatStudyTime(avgStudyMins)}</Text>
                    <Text style={styles.donutStatLabel}>Avg. Study Time</Text>
                  </View>
                  <View style={[styles.donutStat, { marginTop: spacing.md }]}>
                    <Text style={styles.donutStatVal}>{aboveHalfPct}%</Text>
                    <View style={[styles.challengeBar, { backgroundColor: colors.borderColor }]}>
                      <View style={[styles.challengeFill, { width: `${aboveHalfPct}%`, backgroundColor: colors.accentPurple }]} />
                    </View>
                    <Text style={styles.donutStatLabel}>Above 50% completion</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* ── AI Teaching Insights (full width, 2-col grid) ── */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Feather name="zap" size={15} color={colors.accentYellow} />
              <Text style={styles.cardTitle}>AI Teaching Insights</Text>
            </View>
            <View style={styles.tileGrid}>
              {aiInsightTiles.map((tile, i) => (
                <TouchableOpacity key={i} activeOpacity={0.8}
                  style={[styles.tile, { borderColor: tile.color + '40', backgroundColor: tile.color + '0C' }]}
                  onPress={() => setInsightModal({ tileIndex: i })}>
                  <View style={styles.tileTop}>
                    <View style={[styles.tileIconWrap, { backgroundColor: tile.color + '25' }]}>
                      <Feather name={tile.icon} size={15} color={tile.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.tileStat, { color: tile.color }]}>{tile.stat}</Text>
                      <Text style={styles.tileLabel}>{tile.label}</Text>
                    </View>
                    <Feather name="chevron-right" size={13} color={tile.color + '80'} />
                  </View>
                  <Text style={styles.tileTitle}>{tile.title}</Text>
                  <Text style={styles.tileBody}>{tile.body}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>


          {/* ── RECENT ACTIVITY ──────────────────────────── */}
          <Text style={styles.sectionTitle}>Recent Activity</Text>
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
      <Modal visible={!!insightModal} transparent animationType="slide" onRequestClose={() => setInsightModal(null)}>
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
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.xl },

  aiCard: {
    backgroundColor: c.primary,
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
  aiBtnText: { fontSize: 13, fontWeight: '700', color: c.primary },

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

  donutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  donutWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  donutCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  donutPct: { fontSize: 17, fontWeight: '800', letterSpacing: -0.5 },
  donutStats: { flex: 1 },
  donutStat: {},
  donutStatVal: { fontSize: 16, fontWeight: '800', color: c.textMain },
  donutStatLabel: { fontSize: 10, color: c.textDim, marginTop: 2 },
  challengeBar: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 4, marginBottom: 2 },
  challengeFill: { height: '100%', borderRadius: 3 },

  insightRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md, alignItems: 'flex-start' },
  insightBorder: { borderBottomWidth: 1, borderBottomColor: c.borderColor },
  insightIcon: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  insightTitle: { fontSize: 12, fontWeight: '700', color: c.textMain, marginBottom: 3 },
  insightBody: { fontSize: 11, color: c.textMuted, lineHeight: 16 },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  tile: {
    flexBasis: '48%', flexGrow: 1, flexShrink: 1,
    borderWidth: 1, borderRadius: radius.lg,
    padding: spacing.md, gap: spacing.sm,
  },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tileIconWrap: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  tileStat: { fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  tileLabel: { fontSize: 9, color: c.textDim, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 },
  tileTitle: { fontSize: 12, fontWeight: '700', color: c.textMain },
  tileBody: { fontSize: 11, color: c.textMuted, lineHeight: 15 },

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

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  modalSheet: {
    backgroundColor: c.cardDark, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    borderWidth: 1, borderColor: c.borderColor, maxHeight: '82%', paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  modalStat: { fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  modalHeading: { fontSize: 12, fontWeight: '600', color: c.textMuted, marginTop: 2 },
  modalClose: { padding: 6 },
  modalScroll: { paddingHorizontal: spacing.xl },
  modalEmpty: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  modalEmptyText: { fontSize: 13, color: c.textDim, textAlign: 'center' },
  modalAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  modalAvatarText: { fontSize: 13, fontWeight: '800' },
  modalRowBorder: { borderBottomWidth: 1, borderBottomColor: c.borderColor },

  // Table layout
  tableHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.sm,
    backgroundColor: c.bgDark, borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  tableCol: { fontSize: 10, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  tableRowAlt: { backgroundColor: c.bgDark + '60' },
  tableCell: {},
  tableStudentName: { fontSize: 13, fontWeight: '700', color: c.textMain },
  tableStudentGrade: { fontSize: 10, color: c.textDim, marginTop: 1 },
  tableChip: {
    fontSize: 10, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 6, borderWidth: 1, alignSelf: 'flex-start',
  },
  pctPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1,
  },
  pctPillText: { fontSize: 11, fontWeight: '800' },

  // Peak time bars
  peakRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  peakHour: { fontSize: 12, fontWeight: '600', color: c.textMuted, width: 80 },
  peakBarWrap: { flex: 1, height: 8, backgroundColor: c.borderColor, borderRadius: 4, overflow: 'hidden' },
  peakBarFill: { height: '100%', borderRadius: 4 },
  peakCount: { fontSize: 12, fontWeight: '700', width: 72, textAlign: 'right' },

  // Legacy (kept for safety)
  modalRow: { paddingVertical: spacing.lg, flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  modalRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalName: { fontSize: 14, fontWeight: '700', color: c.textMain },
  modalPct: { fontSize: 13, fontWeight: '800' },
  modalSub: { fontSize: 12, color: c.textMuted, lineHeight: 16 },
  modalBarBg: { height: 5, backgroundColor: c.borderColor, borderRadius: 3, overflow: 'hidden' },
  modalBarFill: { height: '100%', borderRadius: 3 },
});
