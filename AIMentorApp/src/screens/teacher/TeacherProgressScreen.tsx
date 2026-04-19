import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle, G } from 'react-native-svg';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import SERVER_URL from '../../config/serverUrl';

type Student = {
  id: string;
  name: string;
  grade: string;
  subject: string;
  xpPoints: number;
  level: number;
  currentStreak: number;
  studyTime: number;
  completedTopics: string[];
  progressPct: number;
  assignmentsDone: number;
  lastActive: string;
  needsAttention: boolean;
};

const TOTAL_TOPICS = 14;

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

function avatarColor(name: string) {
  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % COLORS.length;
  return COLORS[h];
}

function hoursLabel(mins: number) {
  if (mins < 60) return `${mins}m`;
  return `${(mins / 60).toFixed(1)}h`;
}

function lastActiveLabel(dateStr?: string) {
  if (!dateStr) return 'Never';
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

function MiniDonut({ pct, color, size = 44 }: { pct: number; color: string; size?: number }) {
  const sw = 5, r = (size - sw) / 2, circ = 2 * Math.PI * r, cx = size / 2;
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cx} r={r} stroke="rgba(255,255,255,0.1)" strokeWidth={sw} fill="none" />
      <G transform={`rotate(-90 ${cx} ${cx})`}>
        <Circle cx={cx} cy={cx} r={r} stroke={color} strokeWidth={sw} fill="none"
          strokeLinecap="round" strokeDasharray={`${circ}`} strokeDashoffset={circ * (1 - Math.min(pct, 100) / 100)} />
      </G>
    </Svg>
  );
}

export default function TeacherProgressScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const teacherId = encodeURIComponent(user?.email || 'teacher@demo.com');
      const res = await fetch(`${SERVER_URL}/student/by-teacher/${teacherId}`);
      if (res.ok) setStudents(await res.json());
    } catch {/* network */} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const filtered = students.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  );

  const classAvg = students.length
    ? Math.round(students.reduce((a, s) => a + s.progressPct, 0) / students.length)
    : 0;
  const totalXP = students.reduce((a, s) => a + s.xpPoints, 0);
  const onTrack = students.filter(s => !s.needsAttention).length;

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Student Progress"
          subtitle="Track every student's learning journey"
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {/* Class Summary */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryLeft}>
              <Text style={styles.summaryLabel}>Class Average Progress</Text>
              <Text style={styles.summaryBig}>{classAvg}%</Text>
              <View style={styles.summaryProgressBg}>
                <View style={[styles.summaryProgressFill, { width: `${classAvg}%` as any }]} />
              </View>
              <View style={styles.summaryStats}>
                <View style={styles.summaryStat}>
                  <Text style={[styles.summaryStatVal, { color: colors.accentGreen }]}>{onTrack}</Text>
                  <Text style={styles.summaryStatLabel}>On Track</Text>
                </View>
                <View style={styles.summaryStat}>
                  <Text style={[styles.summaryStatVal, { color: colors.accentRed }]}>{students.length - onTrack}</Text>
                  <Text style={styles.summaryStatLabel}>At Risk</Text>
                </View>
                <View style={styles.summaryStat}>
                  <Text style={[styles.summaryStatVal, { color: colors.accentYellow }]}>{totalXP.toLocaleString()}</Text>
                  <Text style={styles.summaryStatLabel}>Total XP</Text>
                </View>
              </View>
            </View>
            <View style={styles.summaryDonut}>
              <MiniDonut pct={classAvg} color={colors.primary} size={88} />
              <Text style={[styles.donutLabel, { color: colors.primary }]}>{classAvg}%</Text>
            </View>
          </View>

          {/* Search */}
          <View style={styles.searchWrap}>
            <Feather name="search" size={15} color={colors.textDim} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search students..."
              placeholderTextColor={colors.textDim}
              value={search}
              onChangeText={setSearch}
            />
            {search ? (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Feather name="x" size={15} color={colors.textDim} />
              </TouchableOpacity>
            ) : null}
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <>
              <Text style={styles.sectionTitle}>{filtered.length} Students</Text>

              {filtered.map(s => {
                const color = avatarColor(s.name);
                const isExpanded = expanded === s.id;
                const topicsDone = s.completedTopics.length;

                return (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.studentCard}
                    activeOpacity={0.9}
                    onPress={() => setExpanded(isExpanded ? null : s.id)}
                  >
                    {/* Top Row */}
                    <View style={styles.studentTop}>
                      <View style={[styles.avatar, { backgroundColor: color + '22' }]}>
                        <Text style={[styles.avatarText, { color }]}>{initials(s.name)}</Text>
                      </View>
                      <View style={styles.studentInfo}>
                        <Text style={styles.studentName}>{s.name}</Text>
                        <Text style={styles.studentMeta}>{s.grade} · Lv.{s.level}</Text>
                      </View>
                      <View style={styles.progressCol}>
                        <Text style={[styles.progressPct, { color: s.needsAttention ? colors.accentRed : colors.accentGreen }]}>
                          {s.progressPct}%
                        </Text>
                        <View style={styles.progressBarBg}>
                          <View style={[styles.progressBarFill, {
                            width: `${s.progressPct}%` as any,
                            backgroundColor: s.needsAttention ? colors.accentRed : colors.primary,
                          }]} />
                        </View>
                      </View>
                      <Feather
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={16} color={colors.textDim}
                      />
                    </View>

                    {/* Quick stats always visible */}
                    <View style={styles.quickStats}>
                      <View style={styles.quickStat}>
                        <Feather name="zap" size={11} color={colors.accentYellow} />
                        <Text style={styles.quickStatText}>{s.xpPoints} XP</Text>
                      </View>
                      <View style={styles.quickStat}>
                        <Feather name="book-open" size={11} color={colors.accentCyan} />
                        <Text style={styles.quickStatText}>{topicsDone}/{TOTAL_TOPICS} topics</Text>
                      </View>
                      <View style={styles.quickStat}>
                        <Feather name="clock" size={11} color={colors.textDim} />
                        <Text style={styles.quickStatText}>{hoursLabel(s.studyTime)}</Text>
                      </View>
                      <View style={styles.quickStat}>
                        <Feather name="activity" size={11} color={colors.accentGreen} />
                        <Text style={styles.quickStatText}>{lastActiveLabel(s.lastActive)}</Text>
                      </View>
                    </View>

                    {/* Expanded Detail */}
                    {isExpanded && (
                      <View style={styles.expandedSection}>
                        <View style={styles.expandDivider} />

                        {/* Metrics grid */}
                        <View style={styles.metricsGrid}>
                          {[
                            { label: 'Streak', value: `${s.currentStreak}d`, icon: 'flame' as const, color: colors.accentRed },
                            { label: 'Level', value: `Lv.${s.level}`, icon: 'star' as const, color: colors.accentYellow },
                            { label: 'Assignments', value: s.assignmentsDone, icon: 'check-square' as const, color: colors.accentGreen },
                            { label: 'Study Time', value: hoursLabel(s.studyTime), icon: 'clock' as const, color: colors.accentCyan },
                          ].map(m => (
                            <View key={m.label} style={styles.metricCard}>
                              <Feather name={m.icon} size={16} color={m.color} />
                              <Text style={[styles.metricValue, { color: m.color }]}>{m.value}</Text>
                              <Text style={styles.metricLabel}>{m.label}</Text>
                            </View>
                          ))}
                        </View>

                        {/* Topics completed */}
                        <Text style={styles.topicsTitle}>Completed Topics ({topicsDone}/{TOTAL_TOPICS})</Text>
                        {topicsDone === 0 ? (
                          <Text style={styles.noTopics}>No topics completed yet</Text>
                        ) : (
                          <View style={styles.topicsWrap}>
                            {s.completedTopics.map(t => (
                              <View key={t} style={styles.topicChip}>
                                <Feather name="check" size={10} color={colors.accentGreen} />
                                <Text style={styles.topicText}>{t}</Text>
                              </View>
                            ))}
                          </View>
                        )}

                        {/* Needs Attention flag */}
                        {s.needsAttention && (
                          <View style={styles.attentionWarn}>
                            <Feather name="alert-triangle" size={14} color={colors.accentRed} />
                            <Text style={styles.attentionText}>
                              {s.progressPct < 30
                                ? 'Low progress — only ' + s.progressPct + '% curriculum completed.'
                                : 'Low streak — student may be disengaging.'}
                            </Text>
                          </View>
                        )}

                        <TouchableOpacity
                          style={styles.messageBtn}
                          onPress={() => navigation.navigate('TeacherAssignments' as any)}
                          activeOpacity={0.8}
                        >
                          <Feather name="plus-circle" size={14} color={colors.primary} />
                          <Text style={styles.messageBtnText}>Assign Task</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.lg },

  summaryCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
  },
  summaryLeft: { flex: 1 },
  summaryLabel: { fontSize: 11, color: c.textDim, fontWeight: '600', marginBottom: 4 },
  summaryBig: { fontSize: 40, fontWeight: '900', color: c.textMain, letterSpacing: -2, marginBottom: 8 },
  summaryProgressBg: { height: 6, backgroundColor: c.borderColor, borderRadius: 3, overflow: 'hidden', marginBottom: spacing.md },
  summaryProgressFill: { height: '100%', backgroundColor: c.primary, borderRadius: 3 },
  summaryStats: { flexDirection: 'row', gap: spacing.xl },
  summaryStat: { gap: 2 },
  summaryStatVal: { fontSize: 18, fontWeight: '800' },
  summaryStatLabel: { fontSize: 10, color: c.textDim, fontWeight: '500' },
  summaryDonut: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  donutLabel: { position: 'absolute', fontSize: 16, fontWeight: '800' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: c.textMain, fontSize: 14 },

  sectionTitle: { fontSize: 14, fontWeight: '700', color: c.textMuted },

  studentCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm,
  },
  studentTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '800' },
  studentInfo: { flex: 1 },
  studentName: { fontSize: 15, fontWeight: '700', color: c.textMain },
  studentMeta: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  progressCol: { alignItems: 'flex-end', gap: 4, width: 60 },
  progressPct: { fontSize: 14, fontWeight: '800' },
  progressBarBg: { width: 56, height: 5, backgroundColor: c.borderColor, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },

  quickStats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  quickStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  quickStatText: { fontSize: 11, color: c.textMuted, fontWeight: '600' },

  expandedSection: { gap: spacing.md },
  expandDivider: { height: 1, backgroundColor: c.borderColor },
  metricsGrid: { flexDirection: 'row', gap: spacing.sm },
  metricCard: {
    flex: 1, backgroundColor: c.bgDark, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.borderColor, padding: spacing.md,
    alignItems: 'center', gap: 4,
  },
  metricValue: { fontSize: 15, fontWeight: '800' },
  metricLabel: { fontSize: 10, color: c.textDim, textAlign: 'center' },

  topicsTitle: { fontSize: 12, fontWeight: '700', color: c.textMuted },
  noTopics: { fontSize: 12, color: c.textDim, fontStyle: 'italic' },
  topicsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  topicChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.accentGreen + '15', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: c.accentGreen + '30',
  },
  topicText: { fontSize: 11, color: c.accentGreen, fontWeight: '600' },

  attentionWarn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.accentRed + '15', borderRadius: radius.md,
    padding: spacing.md, borderWidth: 1, borderColor: c.accentRed + '30',
  },
  attentionText: { fontSize: 12, color: c.accentRed, flex: 1, lineHeight: 18 },

  messageBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: c.primaryGlow, borderRadius: radius.md,
    padding: 10, borderWidth: 1, borderColor: c.primary + '40',
  },
  messageBtnText: { fontSize: 13, fontWeight: '700', color: c.primary },
});
