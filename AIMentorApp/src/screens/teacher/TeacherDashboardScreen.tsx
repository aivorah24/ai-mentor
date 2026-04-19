import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
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
  const needsAttentionStudents = students.filter(s => s.needsAttention).slice(0, 3);
  const activeToday = students.filter(s => s.lastActive === today).length;
  const avgProgress = totalStudents > 0
    ? Math.round(students.reduce((sum, s) => sum + (s.progressPct || 0), 0) / totalStudents)
    : 0;
  const avgStudyMins = totalStudents > 0
    ? Math.round(students.reduce((sum, s) => sum + (s.studyTime || 0), 0) / totalStudents)
    : 0;

  // ── AI Insights generated from real data ───────────────
  const aiInsights = [
    needsAttentionStudents.length > 0
      ? {
          icon: 'alert-triangle' as const,
          color: '#f59e0b',
          title: `${needsAttentionStudents.length} Student${needsAttentionStudents.length > 1 ? 's' : ''} Need Attention`,
          body: `${needsAttentionStudents.map(s => s.name?.split(' ')[0]).join(', ')} ${needsAttentionStudents.length > 1 ? 'are' : 'is'} falling behind. Consider scheduling focused review sessions.`,
        }
      : {
          icon: 'trending-up' as const,
          color: '#10b981',
          title: 'Class is On Track',
          body: `All students are progressing well. Average completion is ${avgProgress}%. Keep encouraging daily practice!`,
        },
    avgProgress >= 50
      ? {
          icon: 'trending-up' as const,
          color: '#10b981',
          title: `Strong Engagement: ${avgProgress}% Avg. Completion`,
          body: `Students have completed ${avgProgress}% of NCERT Grade 3 Maths. Consider introducing challenge quizzes.`,
        }
      : {
          icon: 'book-open' as const,
          color: '#6366f1',
          title: 'Curriculum Progress',
          body: `Class has covered ${avgProgress}% of NCERT Grade 3 Maths. Focus on chapters with lower completion rates.`,
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

  const aiActionTitle = needsAttentionStudents.length > 0
    ? `Review struggling students (${needsAttentionStudents.length} flagged)`
    : avgProgress > 0
      ? `Class at ${avgProgress}% — keep pushing!`
      : 'Set up your first assignment to get started';

  const aiActionBody = needsAttentionStudents.length > 0
    ? `${needsAttentionStudents[0]?.name?.split(' ')[0] || 'A student'} and others have low progress or streak. Schedule a review session or send an encouraging message.`
    : `Average study time is ${formatStudyTime(avgStudyMins)} per student. Assign chapter quizzes to boost engagement.`;

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
          onProfilePress={() => {}}
          notificationCount={needsAttentionStudents.length || undefined}
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
                <View style={styles.overviewStat}>
                  <Text style={[styles.overviewVal, { color: colors.accentGreen }]}>{activeToday}</Text>
                  <Text style={styles.overviewKey}>Active Today</Text>
                </View>
                <View style={[styles.overviewStat, { borderLeftWidth: 1, borderLeftColor: colors.borderColor }]}>
                  <Text style={[styles.overviewVal, { color: colors.accentRed }]}>{needsAttentionStudents.length}</Text>
                  <Text style={styles.overviewKey}>Need Attention</Text>
                </View>
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
                    <Text style={styles.donutStatVal}>{totalStudents > 0 ? Math.round((students.filter(s => (s.progressPct || 0) >= 50).length / totalStudents) * 100) : 0}%</Text>
                    <View style={[styles.challengeBar, { backgroundColor: colors.borderColor }]}>
                      <View style={[styles.challengeFill, { width: `${totalStudents > 0 ? Math.round((students.filter(s => (s.progressPct || 0) >= 50).length / totalStudents) * 100) : 0}%`, backgroundColor: colors.accentPurple }]} />
                    </View>
                    <Text style={styles.donutStatLabel}>Above 50% completion</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* ── ROW 2: AI Insights + Needs Attention ── */}
          <View style={styles.row}>
            {/* AI Teaching Insights */}
            <View style={[styles.card, styles.flex1]}>
              <View style={styles.cardHeader}>
                <Feather name="zap" size={15} color={colors.accentYellow} />
                <Text style={styles.cardTitle}>AI Teaching Insights</Text>
              </View>
              {aiInsights.map((insight, i) => (
                <View key={i} style={[styles.insightRow, i < aiInsights.length - 1 && styles.insightBorder]}>
                  <View style={[styles.insightIcon, { backgroundColor: insight.color + '18' }]}>
                    <Feather name={insight.icon} size={14} color={insight.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.insightTitle}>{insight.title}</Text>
                    <Text style={styles.insightBody}>{insight.body}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Needs Attention */}
            <View style={[styles.card, styles.flex1]}>
              <View style={styles.cardHeader}>
                <Feather name="alert-circle" size={15} color={colors.accentRed} />
                <Text style={styles.cardTitle}>Needs Attention</Text>
              </View>
              {needsAttentionStudents.length === 0 ? (
                <View style={styles.emptyAttention}>
                  <Feather name="check-circle" size={24} color={colors.accentGreen} />
                  <Text style={[styles.insightBody, { textAlign: 'center', marginTop: 8 }]}>All students are on track!</Text>
                </View>
              ) : needsAttentionStudents.map((s, i) => {
                const color = (s.progressPct || 0) < 20 ? '#ef4444' : '#f59e0b';
                const initials = (s.name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
                const issue = (s.currentStreak || 0) < 2
                  ? `${s.currentStreak || 0}-day streak`
                  : `${s.progressPct || 0}% progress`;
                return (
                  <View key={s.id} style={[styles.attRow, i < needsAttentionStudents.length - 1 && styles.attBorder]}>
                    <View style={[styles.attAvatar, { backgroundColor: color + '20' }]}>
                      <Text style={[styles.attInitials, { color }]}>{initials}</Text>
                    </View>
                    <View style={styles.attInfo}>
                      <Text style={styles.attName}>{s.name || 'Unknown'}</Text>
                      <Text style={styles.attIssue}>{issue}</Text>
                    </View>
                    <TouchableOpacity style={[styles.msgBadge, { borderColor: colors.primary + '40', backgroundColor: colors.primaryGlow }]} activeOpacity={0.75}
                      onPress={() => navigation.navigate('TeacherStudents' as any)}>
                      <Text style={[styles.msgBadgeText, { color: colors.primary }]}>View</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </View>

          {/* ── QUICK ACTIONS ────────────────────────────── */}
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.qaScroll} contentContainerStyle={styles.qaContent}>
            {QUICK_ACTIONS.map((a) => (
              <TouchableOpacity key={a.label} style={styles.qaItem} activeOpacity={0.75} onPress={() => navigation.navigate(a.screen as any)}>
                <View style={[styles.qaIcon, { backgroundColor: a.color + '18', borderColor: a.color + '40' }]}>
                  <Feather name={a.icon} size={20} color={a.color} />
                </View>
                <Text style={styles.qaLabel}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

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

  emptyAttention: { alignItems: 'center', paddingVertical: spacing.xl },

  attRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  attBorder: { borderBottomWidth: 1, borderBottomColor: c.borderColor },
  attAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  attInitials: { fontSize: 12, fontWeight: '800' },
  attInfo: { flex: 1 },
  attName: { fontSize: 13, fontWeight: '600', color: c.textMain },
  attIssue: { fontSize: 11, color: c.textMuted, marginTop: 1 },
  msgBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  msgBadgeText: { fontSize: 10, fontWeight: '700' },

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
});
