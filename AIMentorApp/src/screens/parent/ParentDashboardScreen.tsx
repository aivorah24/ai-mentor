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
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import SERVER_URL from '../../config/serverUrl';

// ── Types ──────────────────────────────────────────────────

interface ChildData {
  id: string;
  name: string;
  grade: string;
  status: 'on_track' | 'needs_attention';
  xpPoints: number;
  completedTopics: string[];
  currentStreak: number;
  studyTimeMinutes: number;
  assignmentsDone: number;
}

interface Assignment {
  id: string;
  title: string;
  subject: string;
  dueDate: string;
  status: 'pending' | 'completed';
}

const WEEK_DAYS_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EMPTY_CHILD: ChildData = { id: '', name: '', grade: '', status: 'needs_attention', xpPoints: 0, completedTopics: [], currentStreak: 0, studyTimeMinutes: 0, assignmentsDone: 0 };

// ── Helpers ────────────────────────────────────────────────

function formatStudyTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDueDateShort(iso: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(iso); due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return 'Overdue';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ── Sub-components ─────────────────────────────────────────

function ChildCard({
  child,
  isSelected,
  onPress,
  colors,
  styles,
}: {
  child: ChildData;
  isSelected: boolean;
  onPress: () => void;
  colors: AppColors;
  styles: any;
}) {
  const isOnTrack = child.status === 'on_track';
  const badgeColor = isOnTrack ? colors.accentGreen : colors.accentYellow;
  const badgeLabel = isOnTrack ? 'On Track' : 'Needs Attention';

  return (
    <TouchableOpacity
      style={[styles.childCard, isSelected && styles.childCardActive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.childAvatar, { backgroundColor: isOnTrack ? colors.accentBlue + '20' : colors.accentYellow + '20' }]}>
        <Text style={[styles.childAvatarText, { color: isOnTrack ? colors.accentBlue : colors.accentYellow }]}>
          {child.name[0]}
        </Text>
      </View>
      <Text style={styles.childName}>{child.name}</Text>
      <Text style={styles.childGrade}>{child.grade}</Text>
      <View style={[styles.statusBadge, { backgroundColor: badgeColor + '18', borderColor: badgeColor + '33' }]}>
        <View style={[styles.statusDot, { backgroundColor: badgeColor }]} />
        <Text style={[styles.statusText, { color: badgeColor }]}>{badgeLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  color,
  styles,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  color: string;
  styles: any;
}) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: color + '18' }]}>
        <Feather name={icon as any} size={18} color={color} />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

function ActivityBar({
  height,
  maxHeight,
  label,
  isGoalMet,
  colors,
  styles,
}: {
  height: number;
  maxHeight: number;
  label: string;
  isGoalMet: boolean;
  colors: AppColors;
  styles: any;
}) {
  const barH = maxHeight > 0 ? Math.max(4, (height / maxHeight) * 100) : 4;
  return (
    <View style={styles.barWrapper}>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { height: barH, backgroundColor: isGoalMet ? colors.accentGreen : colors.primary },
          ]}
        />
      </View>
      <Text style={styles.barLabel}>{label}</Text>
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────

export default function ParentDashboardScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { unreadCount, unreadAssignments } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const totalNotifs = unreadCount + unreadAssignments;

  const [children, setChildren] = useState<ChildData[]>([]);
  const [selectedChild, setSelectedChild] = useState<ChildData>(EMPTY_CHILD);
  const [childrenLoading, setChildrenLoading] = useState(true);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [weeklyActivity, setWeeklyActivity] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);

  const parentEmail = user?.email || 'parent@demo.com';

  // Load linked children on mount
  useEffect(() => {
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          const mapped: ChildData[] = data.map(c => ({
            id: c.id,
            name: c.name,
            grade: c.grade,
            status: (c.currentStreak ?? 0) >= 3 ? 'on_track' : 'needs_attention',
            xpPoints: c.xpPoints ?? 0,
            completedTopics: c.completedTopics ?? [],
            currentStreak: c.currentStreak ?? 0,
            studyTimeMinutes: c.studyTimeMinutes ?? 0,
            assignmentsDone: c.assignmentsDone ?? 0,
          }));
          setChildren(mapped);
          setSelectedChild(mapped[0]);
        }
      })
      .catch(() => {})
      .finally(() => setChildrenLoading(false));
  }, [parentEmail]);

  // Load assignments + weekly activity when selected child changes
  useEffect(() => {
    if (!selectedChild.id) return;
    setLoadingAssignments(true);
    setWeeklyActivity([0, 0, 0, 0, 0, 0, 0]);

    fetch(`${SERVER_URL}/student/${selectedChild.id}/weekly`)
      .then(r => r.json())
      .then(data => {
        if (data?.days) {
          const actMap: Record<string, number> = {};
          (data.days as { day: string; studyMinutes: number }[]).forEach(d => { actMap[d.day] = d.studyMinutes; });
          setWeeklyActivity(WEEK_DAYS_ORDER.map(d => actMap[d] ?? 0));
        }
      })
      .catch(() => {});

    fetch(`${SERVER_URL}/assignments?studentId=${selectedChild.id}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAssignments(data.slice(0, 5)); })
      .catch(() => {})
      .finally(() => setLoadingAssignments(false));
  }, [selectedChild.id]);

  const child: ChildData = selectedChild;
  const weeklyStudyH = formatStudyTime(child.studyTimeMinutes);
  const tasksDone = child.assignmentsDone;
  const tasksTotal = Math.max(tasksDone + 6, 14);
  const activityMax = Math.max(...weeklyActivity, 120);

  // Alerts derived from assignments
  const overdueCount = assignments.filter(a => {
    if (a.status !== 'pending') return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return new Date(a.dueDate) < today;
  }).length;

  // Badges
  const badges = [
    child.completedTopics.length >= 1 && { icon: 'star', label: 'First Chapter', color: colors.accentYellow },
    child.completedTopics.length >= 3 && { icon: 'zap', label: 'Hat-trick', color: colors.accentBlue },
    child.currentStreak >= 5 && { icon: 'trending-up', label: '5-Day Streak', color: colors.accentGreen },
    child.xpPoints >= 1000 && { icon: 'award', label: '1000 XP', color: colors.accentPurple },
  ].filter(Boolean) as { icon: string; label: string; color: string }[];

  const parentName = user?.name?.split(' ')[0] ?? 'Parent';

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title={`Welcome, ${parentName}`}
          subtitle="Track your children's learning progress"
          searchPlaceholder="Search..."
          onMenuPress={() => navigation.openDrawer()}
          notificationCount={totalNotifs}
          onNotificationPress={() => navigation.navigate('ParentMessages')}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* New Assignment / Message Alert Banner */}
          {(unreadAssignments > 0 || unreadCount > 0) && (
            <TouchableOpacity
              style={[styles.alertBanner, { backgroundColor: colors.primaryGlow, borderColor: colors.primary + '60' }]}
              onPress={() => unreadAssignments > 0 ? navigation.navigate('ParentAssignments') : navigation.navigate('ParentMessages')}
              activeOpacity={0.8}
            >
              <Feather name={unreadAssignments > 0 ? 'check-square' : 'message-square'} size={16} color={colors.primary} />
              <Text style={[styles.alertBannerText, { color: colors.primary }]}>
                {unreadAssignments > 0
                  ? `${unreadAssignments} new assignment${unreadAssignments > 1 ? 's' : ''} for your child`
                  : `${unreadCount} new message${unreadCount > 1 ? 's' : ''}`}
              </Text>
              <Feather name="chevron-right" size={14} color={colors.primary} />
            </TouchableOpacity>
          )}

          {/* Child Switcher */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Children</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.childRow}>
            {childrenLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginLeft: 8, marginTop: 40 }} />
            ) : children.length === 0 ? (
              <TouchableOpacity style={styles.addChildBtn} activeOpacity={0.7} onPress={() => navigation.navigate('ParentMyKids')}>
                <Feather name="plus" size={20} color={colors.textMuted} />
                <Text style={styles.addChildText}>Add Child</Text>
              </TouchableOpacity>
            ) : (
              <>
                {children.map(ch => (
                  <ChildCard
                    key={ch.id}
                    child={ch}
                    isSelected={selectedChild.id === ch.id}
                    onPress={() => setSelectedChild(ch)}
                    colors={colors}
                    styles={styles}
                  />
                ))}
                <TouchableOpacity style={styles.addChildBtn} activeOpacity={0.7} onPress={() => navigation.navigate('ParentMyKids')}>
                  <Feather name="plus" size={20} color={colors.textMuted} />
                  <Text style={styles.addChildText}>Add Child</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>

          {/* Weekly Snapshot */}
          <View style={[styles.sectionHeader, { marginTop: spacing.xxl }]}>
            <Text style={styles.sectionTitle}>{child.name}'s Weekly Snapshot</Text>
          </View>
          <View style={styles.statsRow}>
            <StatCard
              icon="clock"
              label="Learning Time"
              value={weeklyStudyH}
              color={colors.accentBlue}
              styles={styles}
            />
            <StatCard
              icon="check-square"
              label="Tasks Completed"
              value={`${tasksDone}/${tasksTotal}`}
              color={colors.accentGreen}
              styles={styles}
            />
            <StatCard
              icon="zap"
              label="Points Earned"
              value={child.xpPoints.toLocaleString()}
              color={colors.accentYellow}
              styles={styles}
            />
          </View>

          {/* Activity Chart */}
          <View style={[styles.sectionHeader, { marginTop: spacing.xxl }]}>
            <Text style={styles.sectionTitle}>Activity Overview</Text>
            <Text style={styles.sectionSub}>Daily goal: 2h</Text>
          </View>
          <View style={styles.chartCard}>
            <View style={styles.barsRow}>
              {WEEK_DAYS.map((day, i) => (
                <ActivityBar
                  key={day}
                  height={weeklyActivity[i]}
                  maxHeight={activityMax}
                  label={day}
                  isGoalMet={weeklyActivity[i] >= 120}
                  colors={colors}
                  styles={styles}
                />
              ))}
            </View>
          </View>

          {/* Recent Assignments */}
          <View style={[styles.sectionHeader, { marginTop: spacing.xxl }]}>
            <Text style={styles.sectionTitle}>Recent Assignments</Text>
            <TouchableOpacity onPress={() => navigation.navigate('ParentAssignments')}>
              <Text style={styles.viewAll}>View all</Text>
            </TouchableOpacity>
          </View>

          {loadingAssignments ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
          ) : assignments.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="check-square" size={24} color={colors.textDim} />
              <Text style={styles.emptyText}>No assignments yet</Text>
            </View>
          ) : (
            <View style={styles.assignmentsCard}>
              {assignments.map((a, idx) => {
                const isDone = a.status === 'completed';
                const dueLabel = isDone ? 'Done' : formatDueDateShort(a.dueDate);
                const isOverdue = !isDone && dueLabel === 'Overdue';
                return (
                  <View key={a.id} style={[styles.assignmentRow, idx < assignments.length - 1 && styles.assignmentDivider]}>
                    <View style={[styles.assignmentCheck, isDone && styles.assignmentCheckDone]}>
                      {isDone && <Feather name="check" size={12} color="white" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.assignmentTitle, isDone && { opacity: 0.5 }]} numberOfLines={1}>
                        {a.title}
                      </Text>
                      <Text style={styles.assignmentMeta}>{a.subject}</Text>
                    </View>
                    <Text style={[
                      styles.assignmentDue,
                      { color: isOverdue ? colors.accentRed : isDone ? colors.accentGreen : colors.textMuted },
                    ]}>
                      {dueLabel}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Alerts & Points row */}
          <View style={styles.bottomRow}>
            {/* Alerts */}
            <View style={styles.alertsCard}>
              <Text style={styles.cardTitle}>Alerts</Text>
              {overdueCount > 0 ? (
                <View style={[styles.alertItem, { backgroundColor: colors.accentRed + '10', borderColor: colors.accentRed + '30' }]}>
                  <Feather name="alert-triangle" size={14} color={colors.accentRed} />
                  <Text style={[styles.alertText, { color: colors.accentRed }]}>
                    {overdueCount} overdue assignment{overdueCount > 1 ? 's' : ''}
                  </Text>
                </View>
              ) : null}
              {child.currentStreak < 3 ? (
                <View style={[styles.alertItem, { backgroundColor: colors.accentYellow + '10', borderColor: colors.accentYellow + '30' }]}>
                  <Feather name="alert-circle" size={14} color={colors.accentYellow} />
                  <Text style={[styles.alertText, { color: colors.accentYellow }]}>
                    Low streak — encourage {child.name}!
                  </Text>
                </View>
              ) : null}
              {overdueCount === 0 && child.currentStreak >= 3 ? (
                <View style={[styles.alertItem, { backgroundColor: colors.accentGreen + '10', borderColor: colors.accentGreen + '30' }]}>
                  <Feather name="check-circle" size={14} color={colors.accentGreen} />
                  <Text style={[styles.alertText, { color: colors.accentGreen }]}>All on track!</Text>
                </View>
              ) : null}
            </View>

            {/* Badges */}
            <View style={styles.badgesCard}>
              <Text style={styles.cardTitle}>Badges Earned</Text>
              <View style={styles.badgeGrid}>
                {badges.slice(0, 4).map((b, i) => (
                  <View key={i} style={[styles.badge, { backgroundColor: b.color + '15' }]}>
                    <Feather name={b.icon as any} size={18} color={b.color} />
                    <Text style={[styles.badgeLabel, { color: b.color }]} numberOfLines={1}>{b.label}</Text>
                  </View>
                ))}
                {badges.length === 0 && (
                  <Text style={styles.emptyText}>No badges yet</Text>
                )}
              </View>
            </View>
          </View>

        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

// ── Styles ─────────────────────────────────────────────────

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48 },
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  alertBannerText: { flex: 1, fontSize: 13, fontWeight: '600' },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.textMain },
  sectionSub: { fontSize: 12, color: c.textMuted },
  viewAll: { fontSize: 13, color: c.primary, fontWeight: '600' },

  // Child cards
  childRow: { flexDirection: 'row' },
  childCard: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 6,
    marginRight: spacing.md,
    minWidth: 120,
  },
  childCardActive: {
    borderColor: c.primary,
    backgroundColor: c.primaryGlow,
  },
  childAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  childAvatarText: { fontSize: 20, fontWeight: '700' },
  childName: { fontSize: 14, fontWeight: '700', color: c.textMain },
  childGrade: { fontSize: 11, color: c.textMuted },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '600' },
  addChildBtn: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minWidth: 80,
    borderStyle: 'dashed',
  },
  addChildText: { fontSize: 11, color: c.textMuted },

  // Stats
  statsRow: { flexDirection: 'row', gap: spacing.md },
  statCard: {
    flex: 1,
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 6,
  },
  statIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  statLabel: { fontSize: 11, color: c.textMuted, textAlign: 'center' },
  statValue: { fontSize: 18, fontWeight: '700', letterSpacing: -0.5, textAlign: 'center' },
  statSub: { fontSize: 10, color: c.textDim },

  // Activity chart
  chartCard: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 120 },
  barWrapper: { flex: 1, alignItems: 'center', gap: 6 },
  barTrack: {
    width: 20,
    height: 100,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: 10, minHeight: 4 },
  barLabel: { fontSize: 10, color: c.textDim },

  // Assignments
  assignmentsCard: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  assignmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  assignmentDivider: {
    borderBottomWidth: 1,
    borderBottomColor: c.borderColor,
  },
  assignmentCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: c.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignmentCheckDone: {
    backgroundColor: c.accentGreen,
    borderColor: c.accentGreen,
  },
  assignmentTitle: { fontSize: 13, fontWeight: '600', color: c.textMain },
  assignmentMeta: { fontSize: 11, color: c.textMuted, marginTop: 1 },
  assignmentDue: { fontSize: 11, fontWeight: '600' },

  emptyBox: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 13, color: c.textDim },

  // Bottom row
  bottomRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xxl },
  alertsCard: {
    flex: 1,
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  alertText: { fontSize: 12, fontWeight: '500', flex: 1 },
  badgesCard: {
    flex: 1,
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: c.textMain, marginBottom: 4 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: {
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.md,
    padding: spacing.md,
    minWidth: 60,
  },
  badgeLabel: { fontSize: 9, fontWeight: '600', textAlign: 'center' },
});
