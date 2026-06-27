import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle, G } from 'react-native-svg';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useAuth } from '../../context/AuthContext';
import { useStudentData, formatStudyTime, formatLevel, xpForNextLevel } from '../../context/StudentDataContext';
import { useTheme } from '../../context/ThemeContext';

import SERVER_URL from '../../config/serverUrl';

// ── Types ────────────────────────────────────────────────────

interface DayActivity {
  date: string;
  day: string;
  studyMinutes: number;
  xp: number;
  topicsCompleted: number;
}

interface CurriculumTopic {
  grade: string;
  subject: string;
  unit: string;
  topic: string;
}

interface CurriculumData {
  grades: string[];
  topics: CurriculumTopic[];
  grouped: Record<string, Record<string, { topic: string; unit: string }[]>>;
  totalTopics: number;
}

// ── Ring Progress SVG ────────────────────────────────────────

function RingProgress({ progress, color, size = 90, strokeWidth = 8 }: {
  progress: number; color: string; size?: number; strokeWidth?: number;
}) {
  const cx = size / 2;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(Math.max(progress, 0), 1));
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cx} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={strokeWidth} fill="none" />
      <G transform={`rotate(-90 ${cx} ${cx})`}>
        <Circle cx={cx} cy={cx} r={r} stroke={color} strokeWidth={strokeWidth} fill="none"
          strokeLinecap="round" strokeDasharray={`${circumference}`} strokeDashoffset={offset} />
      </G>
    </Svg>
  );
}

// ── Subject config ────────────────────────────────────────────

const SUBJECT_CONFIG: Record<string, { color: string; icon: React.ComponentProps<typeof Feather>['name'] }> = {
  Mathematics:          { color: '#9FB2A4', icon: 'trending-up'  },
  Science:              { color: '#7E9A86', icon: 'zap'          },
  English:              { color: '#C9A24E', icon: 'book-open'    },
  'Social Studies':     { color: '#8A8358', icon: 'globe'        },
  Arts:                 { color: '#C9A24E', icon: 'feather'      },
  'Physical Education': { color: '#9FB2A4', icon: 'activity'     },
  ICT:                  { color: '#BAA467', icon: 'monitor'      },
};

function subjectColor(s: string) { return SUBJECT_CONFIG[s]?.color ?? '#9FB2A4'; }
function subjectIcon(s: string): React.ComponentProps<typeof Feather>['name'] { return SUBJECT_CONFIG[s]?.icon ?? 'book-open'; }

// ── Main Screen ───────────────────────────────────────────────

export default function ProgressScreen({ navigation }: any) {
  const [periodTab, setPeriodTab] = useState<'Week' | 'Month'>('Week');
  const { user } = useAuth();
  const { stats, studentId } = useStudentData();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const firstName = user?.name?.split(' ')[0] || 'there';

  const [weeklyDays, setWeeklyDays] = useState<DayActivity[]>([]);
  const [curriculum, setCurriculum] = useState<CurriculumData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) return;
    fetch(`${SERVER_URL}/student/${studentId}/weekly`).then(r => r.json()).catch(() => ({ days: [] }))
      .then((weekly) => {
        setWeeklyDays(weekly.days ?? []);
        setLoading(false);
      });
  }, [studentId]);

  // ── Derived real values ───────────────────────────────────

  const completedSet = useMemo(() => new Set(stats.completedTopics ?? []), [stats.completedTopics]);
  // Use totalTopics from server stats — curriculum-aware (IB PYP Grade 4 = 54, NCERT etc.)
  const totalTopics = stats.totalTopics ?? 0;
  const overallPct = totalTopics > 0 ? Math.min(100, Math.round((completedSet.size / totalTopics) * 100)) : 0;

  // Subject performance: % of topics completed per subject
  const subjectStats = useMemo(() => {
    if (!curriculum) return [];
    const result: { name: string; total: number; done: number }[] = [];
    for (const grade of curriculum.grades) {
      for (const [subject, topics] of Object.entries(curriculum.grouped[grade] ?? {})) {
        const existing = result.find(r => r.name === subject);
        const done = topics.filter(t => completedSet.has(t.topic)).length;
        if (existing) { existing.total += topics.length; existing.done += done; }
        else result.push({ name: subject, total: topics.length, done });
      }
    }
    return result.map(r => ({
      name: r.name,
      total: r.total,
      done: r.done,
      pct: r.total > 0 ? Math.round((r.done / r.total) * 100) : 0,
      color: subjectColor(r.name),
      icon: subjectIcon(r.name),
    }));
  }, [curriculum, completedSet]);

  // Weekly bar chart — real study minutes per day
  const maxMinutes = useMemo(() => Math.max(...weeklyDays.map(d => d.studyMinutes), 1), [weeklyDays]);

  // XP level progress
  const xpInfo = xpForNextLevel(stats.xpPoints);
  const xpProgress = xpInfo.current / xpInfo.needed;

  // Achievements — unlocked based on real milestones
  const achievements = useMemo(() => {
    const list: { label: string; icon: React.ComponentProps<typeof Feather>['name']; color: string; unlocked: boolean }[] = [
      { label: `${stats.currentStreak}-Day Streak`, icon: 'zap',         color: '#8A8358', unlocked: stats.currentStreak >= 1 },
      { label: 'First Topic',     icon: 'book-open',   color: '#9FB2A4', unlocked: completedSet.size >= 1 },
      { label: '5 Topics Done',   icon: 'award',       color: '#BAA467', unlocked: completedSet.size >= 5 },
      { label: '10 Topics Done',  icon: 'star',        color: '#7E9A86', unlocked: completedSet.size >= 10 },
      { label: '500 XP',          icon: 'trending-up', color: '#8A8358', unlocked: stats.xpPoints >= 500 },
      { label: '1 Hour Studied',  icon: 'clock',       color: '#9FB2A4', unlocked: stats.studyTimeMinutes >= 60 },
      { label: 'Level 2+',        icon: 'shield',      color: '#C9A24E', unlocked: stats.level >= 2 },
      { label: 'Challenge Done',  icon: 'target',      color: '#C9A24E', unlocked: stats.challengesCompleted >= 1 },
    ];
    return list;
  }, [stats, completedSet, colors]);

  const unlockedCount = achievements.filter(a => a.unlocked).length;

  if (loading) {
    return (
      <ScreenLayout>
        <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator size="large" color={colors.accentYellow} />
          <Text style={[styles.emptyText, { marginTop: 16 }]}>Loading your progress…</Text>
        </View>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="My Progress"
          subtitle={`Track your growth and achievements, ${firstName}.`}
          searchPlaceholder="Search topics or stats..."
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── HERO BANNER ─────────────────────────────── */}
          <View style={styles.heroBanner}>
            <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
              <View style={{ position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
                <RingProgress progress={overallPct / 100} color="#9FB2A4" size={100} strokeWidth={9} />
                <View style={StyleSheet.absoluteFill as any} pointerEvents="none">
                  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={styles.heroPct}>{overallPct}%</Text>
                    <Text style={styles.heroCircleLabel}>OVERALL</Text>
                  </View>
                </View>
              </View>
            </View>
            <View style={styles.heroText}>
              <Text style={styles.heroTitle}>
                {overallPct === 0
                  ? 'Ready to start learning!'
                  : overallPct < 50
                  ? 'Great start, keep going!'
                  : overallPct < 80
                  ? 'Amazing progress this week!'
                  : 'Outstanding work!'}
              </Text>
              <Text style={styles.heroSub}>
                {completedSet.size} of {totalTopics} topics completed · {stats.currentStreak}-day streak · Level {stats.level}
              </Text>
            </View>
            {/* XP bar */}
            <View style={{ marginBottom: spacing.lg }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={styles.xpLabel}>XP to Level {stats.level + 1}</Text>
                <Text style={[styles.xpLabel, { color: '#8A8358' }]}>{xpInfo.current} / {xpInfo.needed}</Text>
              </View>
              <View style={styles.xpTrack}>
                <View style={[styles.xpFill, { width: `${xpProgress * 100}%` as any }]} />
              </View>
            </View>
            <View style={styles.heroStats}>
              {[
                { val: formatStudyTime(stats.studyTimeMinutes), label: 'Study Time',   color: '#BAA467' },
                { val: stats.xpPoints.toLocaleString(),          label: 'XP Points',   color: '#8A8358' },
                { val: String(stats.currentStreak),              label: 'Day Streak',  color: '#7E9A86' },
                { val: String(completedSet.size),                label: 'Topics Done', color: '#C9A24E' },
                { val: String(Math.floor(stats.xpPoints / 100)), label: 'Credits',     color: '#9FB2A4' },
              ].map((s) => (
                <View key={s.label} style={styles.heroStat}>
                  <Text style={[styles.heroStatVal, { color: s.color }]}>{s.val}</Text>
                  <Text style={styles.heroStatLabel}>{s.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── WEEKLY ACTIVITY ──────────────────────────── */}
          <View style={[styles.glassCard, { marginBottom: spacing.xxl }]}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Weekly Activity</Text>
              <View style={styles.periodTabs}>
                {(['Week', 'Month'] as const).map((p) => (
                  <TouchableOpacity key={p} style={[styles.periodTab, periodTab === p && styles.periodTabActive]} onPress={() => setPeriodTab(p)} activeOpacity={0.7}>
                    <Text style={[styles.periodTabText, periodTab === p && styles.periodTabTextActive]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {weeklyDays.every(d => d.studyMinutes === 0 && d.xp === 0) ? (
              <View style={styles.emptyBar}>
                <Feather name="bar-chart-2" size={28} color={colors.textDim} />
                <Text style={styles.emptyText}>No activity yet this week.{'\n'}Complete lessons to see your chart!</Text>
              </View>
            ) : (
              <View style={styles.barChart}>
                {weeklyDays.map((d, i) => {
                  const heightPct = maxMinutes > 0 ? (d.studyMinutes / maxMinutes) * 100 : 0;
                  const isToday = d.date === new Date().toISOString().split('T')[0];
                  return (
                    <View key={d.date} style={styles.barItem}>
                      <Text style={[styles.barMinute, isToday && { color: '#9FB2A4' }]}>
                        {d.studyMinutes > 0 ? `${d.studyMinutes}m` : ''}
                      </Text>
                      <View style={styles.barWrapper}>
                        <View style={[
                          styles.bar,
                          { height: `${Math.max(heightPct, 6)}%` as any, backgroundColor: isToday ? '#9FB2A4' : colors.borderColor },
                          isToday && styles.barActive,
                        ]} />
                      </View>
                      <Text style={[styles.barLabel, isToday && { color: '#9FB2A4', fontWeight: '700' }]}>{d.day}</Text>
                    </View>
                  );
                })}
              </View>
            )}
            {/* Weekly totals */}
            <View style={styles.weekTotals}>
              {[
                { label: 'Total Study', val: formatStudyTime(weeklyDays.reduce((s, d) => s + d.studyMinutes, 0)), color: '#BAA467' },
                { label: 'XP Earned',   val: `+${weeklyDays.reduce((s, d) => s + d.xp, 0)}`,                      color: '#8A8358' },
                { label: 'Topics',       val: String(weeklyDays.reduce((s, d) => s + d.topicsCompleted, 0)),       color: '#7E9A86' },
              ].map(s => (
                <View key={s.label} style={styles.weekTotal}>
                  <Text style={[styles.weekTotalVal, { color: s.color }]}>{s.val}</Text>
                  <Text style={styles.weekTotalLabel}>{s.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── SUBJECT PERFORMANCE ──────────────────────── */}
          <Text style={styles.sectionTitle}>Subject Performance</Text>
          {subjectStats.length === 0 ? (
            <Text style={styles.emptyText}>Complete lessons to see subject scores.</Text>
          ) : (
            <View style={styles.subjectsGrid}>
              {subjectStats.map((s) => (
                <TouchableOpacity
                  key={s.name}
                  style={styles.subjectCard}
                  onPress={() => navigation.navigate('LearningPaths')}
                  activeOpacity={0.8}
                >
                  <View style={[styles.subjectIcon, { backgroundColor: s.color + '18' }]}>
                    <Feather name={s.icon} size={18} color={s.color} />
                  </View>
                  <Text style={styles.subjectName}>{s.name}</Text>
                  <Text style={[styles.subjectScore, { color: s.color }]}>{s.pct}%</Text>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${s.pct}%` as any, backgroundColor: s.color }]} />
                  </View>
                  <Text style={styles.subjectMeta}>{s.done} / {s.total} topics</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ── COMPLETED TOPICS ─────────────────────────── */}
          {completedSet.size > 0 && (
            <>
              <View style={styles.cardHeader}>
                <Text style={styles.sectionTitle}>Completed Topics</Text>
                <TouchableOpacity onPress={() => navigation.navigate('LearningPaths')} activeOpacity={0.7}>
                  <Text style={[styles.seeAll, { color: '#9FB2A4' }]}>See all →</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.topicsList}>
                {[...completedSet].slice(0, 6).map(topic => (
                  <View key={topic} style={styles.topicChip}>
                    <Feather name="check-circle" size={13} color="#7E9A86" />
                    <Text style={styles.topicChipText} numberOfLines={1}>{topic}</Text>
                  </View>
                ))}
                {completedSet.size > 6 && (
                  <View style={[styles.topicChip, { backgroundColor: 'rgba(255,255,255,0.04)' }]}>
                    <Text style={[styles.topicChipText, { color: colors.textMuted }]}>+{completedSet.size - 6} more</Text>
                  </View>
                )}
              </View>
            </>
          )}

          {/* ── ACHIEVEMENTS ─────────────────────────────── */}
          <View style={styles.cardHeader}>
            <Text style={styles.sectionTitle}>Achievements</Text>
            <Text style={[styles.seeAll, { color: '#8A8358' }]}>{unlockedCount}/{achievements.length} unlocked</Text>
          </View>
          <View style={styles.achieveGrid}>
            {achievements.map((a) => (
              <View key={a.label} style={[styles.achieveCard, !a.unlocked && styles.achieveCardLocked]}>
                <View style={[styles.achieveIcon, {
                  backgroundColor: a.unlocked ? a.color + '18' : 'rgba(255,255,255,0.03)',
                  borderColor:     a.unlocked ? a.color + '40' : 'rgba(255,255,255,0.06)',
                }]}>
                  <Feather name={a.icon} size={22} color={a.unlocked ? a.color : colors.textDim} />
                </View>
                <Text style={[styles.achieveLabel, !a.unlocked && { color: colors.textDim }]}>{a.label}</Text>
                {!a.unlocked && <Text style={styles.lockedText}>Locked</Text>}
              </View>
            ))}
          </View>

        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 40 },

  heroBanner: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.xxl,
  },
  heroPct: { fontSize: 22, fontWeight: '800', color: c.textMain },
  heroCircleLabel: { fontSize: 9, color: c.textMuted, fontWeight: '700', letterSpacing: 0.5 },
  heroText: { alignItems: 'center', marginBottom: spacing.lg },
  heroTitle: { fontSize: 17, fontWeight: '700', color: c.textMain, textAlign: 'center', marginBottom: 6, fontFamily: fonts.serif },
  heroSub: { fontSize: 12, color: c.textMuted, textAlign: 'center', lineHeight: 18 },
  xpLabel: { fontSize: 11, color: c.textMuted, fontWeight: '600' },
  xpTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' },
  xpFill: { height: '100%', borderRadius: 3, backgroundColor: '#8A8358' },
  heroStats: { flexDirection: 'row', justifyContent: 'space-around' },
  heroStat: { alignItems: 'center', gap: 4 },
  heroStatVal: { fontSize: 20, fontWeight: '700', letterSpacing: -0.5 },
  heroStatLabel: { fontSize: 10, color: c.textMuted },

  glassCard: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xl },
  cardTitle: { fontSize: 14, fontWeight: '600', color: c.textMain },
  periodTabs: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: c.borderColor,
  },
  periodTab: { paddingHorizontal: spacing.md, paddingVertical: 6 },
  periodTabActive: { backgroundColor: c.accentYellow },
  periodTabText: { fontSize: 12, color: c.textMuted, fontWeight: '500' },
  periodTabTextActive: { color: 'white' },

  emptyBar: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyText: { fontSize: 12, color: c.textMuted, textAlign: 'center', lineHeight: 18 },

  barChart: { flexDirection: 'row', height: 120, alignItems: 'flex-end', gap: 6, marginBottom: spacing.lg },
  barItem: { flex: 1, alignItems: 'center', gap: 2 },
  barMinute: { fontSize: 9, color: c.textDim, fontWeight: '600', height: 14 },
  barWrapper: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 4, minHeight: 4 },
  barActive: { shadowColor: '#9FB2A4', shadowOffset: { width: 0, height: 0 }, shadowRadius: 8, shadowOpacity: 0.5 },
  barLabel: { fontSize: 10, color: c.textMuted },

  weekTotals: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderTopColor: c.borderColor, paddingTop: spacing.lg },
  weekTotal: { alignItems: 'center', gap: 2 },
  weekTotalVal: { fontSize: 16, fontWeight: '700' },
  weekTotalLabel: { fontSize: 11, color: c.textMuted },

  sectionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.textMain, marginBottom: spacing.lg },
  seeAll: { fontSize: 13, fontWeight: '600' },

  subjectsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.xxl },
  subjectCard: {
    flex: 1,
    minWidth: 140,
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 6,
  },
  subjectIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  subjectName: { fontSize: 13, fontWeight: '600', color: c.textMain },
  subjectScore: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  progressTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  subjectMeta: { fontSize: 11, color: c.textMuted },

  topicsList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.xxl },
  topicChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16,185,129,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.2)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: 200,
  },
  topicChipText: { fontSize: 12, fontWeight: '600', color: '#7E9A86' },

  achieveGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: 20 },
  achieveCard: {
    flex: 1,
    minWidth: 140,
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  achieveCardLocked: { opacity: 0.5 },
  achieveIcon: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  achieveLabel: { fontSize: 12, fontWeight: '600', color: c.textMain, textAlign: 'center' },
  lockedText: { fontSize: 10, color: c.textDim, fontWeight: '600' },

  // ── Rewards ─────────────────────────────────────────────────
  creditsCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md,
  },
  creditsLeft:      { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  creditsIconCircle:{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  creditsCount:     { fontSize: 28, fontWeight: '800' },
  creditsLabel:     { fontSize: 12, fontWeight: '600', marginTop: 1 },
  xpConvertBadge:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  xpConvertText:    { fontSize: 11, fontWeight: '700' },

  taglineRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderWidth: 1, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.lg,
  },
  taglineText: { fontSize: 12, lineHeight: 18, flex: 1, fontStyle: 'italic' },

  merchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: 32 },
  merchCard: {
    width: '47%', borderWidth: 1, borderRadius: radius.lg,
    padding: spacing.md, gap: spacing.sm, alignItems: 'center',
  },
  merchIcon:        { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  merchLabel:       { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  merchDesc:        { fontSize: 11, textAlign: 'center' },
  merchCreditRow:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  merchCreditText:  { fontSize: 11, fontWeight: '700' },
  comingSoonBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  comingSoonBtnText:{ fontSize: 11, fontWeight: '600' },
});
