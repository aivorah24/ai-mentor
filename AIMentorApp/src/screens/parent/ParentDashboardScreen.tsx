import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Platform,
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
  status: 'on_track' | 'needs_attention' | 'getting_started';
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
  if (diff < 0) return 'Pending';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ── Sub-components ─────────────────────────────────────────

function ChildCard({
  child,
  isSelected,
  onPress,
  onViewCreds,
  colors,
  styles,
}: {
  child: ChildData;
  isSelected: boolean;
  onPress: () => void;
  onViewCreds: (child: ChildData) => void;
  colors: AppColors;
  styles: any;
}) {
  const isNew = child.status === 'getting_started';
  const isOnTrack = child.status === 'on_track';
  const badgeColor = isNew ? colors.accentBlue : isOnTrack ? colors.accentGreen : colors.accentBlue;
  const badgeLabel = isNew ? 'Getting Started' : isOnTrack ? 'On Track' : 'Keep Going';

  return (
    <TouchableOpacity
      style={[styles.childCard, isSelected && styles.childCardActive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Key icon — tap to view login credentials */}
      <TouchableOpacity
        style={styles.childKeyBtn}
        onPress={() => onViewCreds(child)}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        activeOpacity={0.7}
      >
        <Feather name="key" size={11} color={colors.textDim} />
      </TouchableOpacity>

      <View style={[styles.childAvatar, { backgroundColor: badgeColor + '20' }]}>
        <Text style={[styles.childAvatarText, { color: badgeColor }]}>
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

export default function ParentDashboardScreen({ navigation, route }: any) {
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

  // Login credentials modal
  const [credsChild, setCredsChild] = useState<ChildData | null>(null);
  const [creds, setCreds] = useState<any>(null);
  const [loadingCreds, setLoadingCreds] = useState(false);
  const [copiedField, setCopiedField] = useState('');

  function copyToClipboard(text: string, field: string) {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 1500);
  }

  async function fetchCreds(child: ChildData) {
    setCredsChild(child);
    setCreds(null);
    setLoadingCreds(true);
    try {
      const res = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children/${child.id}/credentials`);
      setCreds(res.ok ? await res.json() : null);
    } catch {
      setCreds(null);
    } finally {
      setLoadingCreds(false);
    }
  }

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
            status: (() => { const hasActivity = (c.xpPoints ?? 0) > 0 || (c.studyTimeMinutes ?? 0) > 0 || (c.completedTopics?.length ?? 0) > 0; if (!hasActivity) return 'getting_started'; return (c.currentStreak ?? 0) >= 1 ? 'on_track' : 'needs_attention'; })(),
            xpPoints: c.xpPoints ?? 0,
            completedTopics: c.completedTopics ?? [],
            currentStreak: c.currentStreak ?? 0,
            studyTimeMinutes: c.studyTimeMinutes ?? 0,
            assignmentsDone: c.assignmentsDone ?? 0,
          }));
          setChildren(mapped);
          
          // Auto-select child from navigation params if provided
          const targetChildId = route.params?.childId;
          const found = targetChildId ? mapped.find(c => c.id === targetChildId) : null;
          setSelectedChild(found || mapped[0]);
        }
      })
      .catch(() => {})
      .finally(() => setChildrenLoading(false));
  }, [parentEmail, route.params?.childId]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const startPolling = () => {
      if (interval) return;
      interval = setInterval(() => {
        if (selectedChild.id) {
          fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
            .then(r => r.json())
            .then(data => {
              if (Array.isArray(data) && data.length > 0) {
                const mapped: ChildData[] = data.map(c => ({
                  id: c.id,
                  name: c.name,
                  grade: c.grade,
                  status: (() => { const hasActivity = (c.xpPoints ?? 0) > 0 || (c.studyTimeMinutes ?? 0) > 0 || (c.completedTopics?.length ?? 0) > 0; if (!hasActivity) return 'getting_started'; return (c.currentStreak ?? 0) >= 1 ? 'on_track' : 'needs_attention'; })(),
                  xpPoints: c.xpPoints ?? 0,
                  completedTopics: c.completedTopics ?? [],
                  currentStreak: c.currentStreak ?? 0,
                  studyTimeMinutes: c.studyTimeMinutes ?? 0,
                  assignmentsDone: c.assignmentsDone ?? 0,
                }));
                setChildren(mapped);
                const nextSelected = mapped.find(ch => ch.id === selectedChild.id) ?? mapped[0];
                if (nextSelected) setSelectedChild(nextSelected);
              }
            })
            .catch(() => {});
        }
      }, 30000);
    };

    const unsubFocus = navigation.addListener('focus', () => {
      if (selectedChild.id) {
        fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
          .then(r => r.json())
          .then(data => {
            if (Array.isArray(data) && data.length > 0) {
              const mapped: ChildData[] = data.map(c => ({
                id: c.id,
                name: c.name,
                grade: c.grade,
                status: (() => { const hasActivity = (c.xpPoints ?? 0) > 0 || (c.studyTimeMinutes ?? 0) > 0 || (c.completedTopics?.length ?? 0) > 0; if (!hasActivity) return 'getting_started'; return (c.currentStreak ?? 0) >= 1 ? 'on_track' : 'needs_attention'; })(),
                xpPoints: c.xpPoints ?? 0,
                completedTopics: c.completedTopics ?? [],
                currentStreak: c.currentStreak ?? 0,
                studyTimeMinutes: c.studyTimeMinutes ?? 0,
                assignmentsDone: c.assignmentsDone ?? 0,
              }));
              setChildren(mapped);
              const nextSelected = mapped.find(ch => ch.id === selectedChild.id) ?? mapped[0];
              if (nextSelected) setSelectedChild(nextSelected);
            }
          })
          .catch(() => {});
      }
      startPolling();
    });
    const unsubBlur = navigation.addListener('blur', stopPolling);

    startPolling();

    return () => {
      stopPolling();
      unsubFocus();
      unsubBlur();
    };
  }, [navigation, parentEmail, selectedChild.id]);

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
                    onViewCreds={fetchCreds}
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
                const isOverdue = false; // never show red overdue to parents
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.assignmentRow, idx < assignments.length - 1 && styles.assignmentDivider]}
                    onPress={() => navigation.navigate('ParentAssignments')}
                    activeOpacity={0.7}
                  >
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
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Highlights & Points row */}
          <View style={styles.bottomRow}>
            {/* Highlights — positive reinforcement only */}
            <View style={styles.alertsCard}>
              <Text style={styles.cardTitle}>Highlights</Text>
              {child.currentStreak >= 3 ? (
                <View style={[styles.alertItem, { backgroundColor: colors.accentGreen + '10', borderColor: colors.accentGreen + '30' }]}>
                  <Feather name="zap" size={14} color={colors.accentGreen} />
                  <Text style={[styles.alertText, { color: colors.accentGreen }]}>
                    {child.currentStreak}-day streak! Keep it up!
                  </Text>
                </View>
              ) : (
                <View style={[styles.alertItem, { backgroundColor: colors.accentBlue + '10', borderColor: colors.accentBlue + '30' }]}>
                  <Feather name="star" size={14} color={colors.accentBlue} />
                  <Text style={[styles.alertText, { color: colors.accentBlue }]}>
                    Every day counts — let's learn today!
                  </Text>
                </View>
              )}
              {child.assignmentsDone > 0 ? (
                <View style={[styles.alertItem, { backgroundColor: colors.accentGreen + '10', borderColor: colors.accentGreen + '30' }]}>
                  <Feather name="check-circle" size={14} color={colors.accentGreen} />
                  <Text style={[styles.alertText, { color: colors.accentGreen }]}>
                    {child.assignmentsDone} assignment{child.assignmentsDone > 1 ? 's' : ''} completed!
                  </Text>
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

      {/* Login Credentials Modal */}
      <Modal visible={!!credsChild} transparent animationType="fade" onRequestClose={() => { setCredsChild(null); setCreds(null); }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#5F8A8620', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="key" size={16} color="#5F8A86" />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Login Info</Text>
                  <Text style={styles.modalDesc}>{credsChild?.name}'s credentials</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => { setCredsChild(null); setCreds(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {loadingCreds ? (
              <ActivityIndicator color="#5F8A86" style={{ paddingVertical: 24 }} />
            ) : (
              <View style={{ backgroundColor: colors.bgDark, borderRadius: 12, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.borderColor }}>
                <Text style={[styles.modalDesc, { textAlign: 'center' }]}>Your child uses these to log in as a Student.</Text>

                {[
                  creds?.studentId    ? { label: 'Student ID',       value: creds.studentId,    field: 'dstu'   } : null,
                  creds?.loginId      ? { label: 'Login ID (Email)', value: creds.loginId,      field: 'dlogin' } : null,
                  creds?.initialPassword ? { label: 'Password',     value: creds.initialPassword, field: 'dpass' } : null,
                ].filter(Boolean).map(({ label, value, field }: any) => (
                  <View key={field} style={{ gap: 4 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: copiedField === field ? '#5F8A86' : colors.borderColor, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, gap: 8, backgroundColor: colors.cardDark }}
                      onPress={() => copyToClipboard(value, field)}
                      activeOpacity={0.7}
                    >
                      <Text style={{ flex: 1, color: colors.textMain, fontSize: 13, fontFamily: 'monospace' }} selectable>{value}</Text>
                      <Feather name={copiedField === field ? 'check' : 'copy'} size={14} color={copiedField === field ? '#5F8A86' : colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))}

                {!creds?.initialPassword && (
                  <View style={{ backgroundColor: '#ef444415', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#ef444430' }}>
                    <Text style={{ fontSize: 12, color: '#ef4444', textAlign: 'center', lineHeight: 18 }}>
                      Password not saved for this account.{'\n'}
                      {creds?.loginId?.includes('@aivorah.')
                        ? 'Remove and re-add this child to generate fresh credentials.'
                        : 'Your child can use "Forgot Password" on the login screen.'}
                    </Text>
                  </View>
                )}
              </View>
            )}

            <TouchableOpacity
              style={{ backgroundColor: '#5F8A86', borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 4 }}
              onPress={() => { setCredsChild(null); setCreds(null); }}
              activeOpacity={0.8}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    position: 'relative',
  },
  childKeyBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalBox: { width: '100%', maxWidth: 420, backgroundColor: c.cardDark, borderRadius: radius.xl, borderWidth: 1, borderColor: c.borderColor, padding: 24, gap: 12 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.textMain },
  modalDesc: { fontSize: 13, color: c.textMuted, lineHeight: 20 },
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
