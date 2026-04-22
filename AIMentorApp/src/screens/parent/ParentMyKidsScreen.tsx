import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, TextInput, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

function formatStudyTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function ChildCard({ child, colors, styles, navigation, onRemove }: any) {
  const progressPct = Math.round(((child.completedTopics?.length ?? 0) / 14) * 100);
  const isOnTrack = (child.currentStreak ?? 0) >= 3 && progressPct >= 20;
  const badgeColor = isOnTrack ? colors.accentGreen : colors.accentYellow;
  const badgeLabel = isOnTrack ? 'On Track' : 'Needs Attention';

  return (
    <View style={styles.childCard}>
      <View style={styles.childCardHeader}>
        <View style={[styles.avatar, { backgroundColor: isOnTrack ? colors.accentBlue + '20' : colors.accentYellow + '20' }]}>
          <Text style={[styles.avatarText, { color: isOnTrack ? colors.accentBlue : colors.accentYellow }]}>
            {child.name[0].toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.childName}>{child.name}</Text>
          <Text style={styles.childSub}>{child.grade}{child.school ? ` · ${child.school}` : ''}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[styles.badge, { backgroundColor: badgeColor + '18', borderColor: badgeColor + '33' }]}>
            <Text style={[styles.badgeText, { color: badgeColor }]}>{badgeLabel}</Text>
          </View>
          <TouchableOpacity onPress={() => onRemove(child)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={16} color={colors.textDim} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Study Time</Text>
          <Text style={styles.statValue}>{formatStudyTime(child.studyTimeMinutes ?? 0)}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Chapters Done</Text>
          <Text style={[styles.statValue, { color: progressPct >= 50 ? colors.accentGreen : colors.textMain }]}>
            {child.completedTopics?.length ?? 0}/14
          </Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>Streak</Text>
          <Text style={[styles.statValue, { color: (child.currentStreak ?? 0) >= 3 ? colors.accentGreen : colors.accentYellow }]}>
            {child.currentStreak ?? 0}d
          </Text>
        </View>
      </View>

      <View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={styles.statLabel}>Chapter Progress</Text>
          <Text style={[styles.statLabel, { color: colors.primary }]}>{progressPct}%</Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
          <View style={[styles.progressFill, { width: `${progressPct}%` as any, backgroundColor: colors.primary }]} />
        </View>
      </View>

      <View style={styles.quickNav}>
        {[
          { icon: 'grid', label: 'Dashboard', screen: 'ParentDashboard' },
          { icon: 'book-open', label: 'Learning', screen: 'ParentLearning' },
          { icon: 'bar-chart-2', label: 'Progress', screen: 'ParentProgress' },
          { icon: 'calendar', label: 'Schedule', screen: 'ParentSchedule' },
        ].map((btn) => (
          <TouchableOpacity
            key={btn.label}
            style={styles.quickBtn}
            onPress={() => navigation.navigate(btn.screen)}
            activeOpacity={0.7}
          >
            <Feather name={btn.icon as any} size={14} color={colors.primary} />
            <Text style={[styles.quickBtnText, { color: colors.primary }]}>{btn.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.recentSection}>
        <View style={styles.activityRow}>
          <Feather name="zap" size={13} color={colors.accentYellow} />
          <Text style={styles.activityText}>{child.xpPoints ?? 0} XP earned · Level {child.level ?? 1}</Text>
        </View>
        {child.lastLesson ? (
          <View style={styles.activityRow}>
            <Feather name="check-circle" size={13} color={colors.accentGreen} />
            <Text style={styles.activityText}>Last lesson: {child.lastLesson}</Text>
          </View>
        ) : null}
        {(child.assignmentsDone ?? 0) > 0 && (
          <View style={styles.activityRow}>
            <Feather name="clipboard" size={13} color={colors.accentBlue} />
            <Text style={styles.activityText}>{child.assignmentsDone} assignment{child.assignmentsDone > 1 ? 's' : ''} completed</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function ParentMyKidsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const [children, setChildren] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Add child modal
  const [showModal, setShowModal] = useState(false);
  const [childEmail, setChildEmail] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');

  const parentEmail = user?.email || 'parent@demo.com';

  const DEMO_PARENT_EMAILS = new Set([
    'suresh@test.ai', 'deepa@test.ai', 'fatima@test.ai', 'prakash@test.ai', 'parent@demo.com',
  ]);
  const isDemo = DEMO_PARENT_EMAILS.has(parentEmail.toLowerCase());

  const DEMO_STATS: Record<string, object> = {
    'aanya@test.ai':  { xpPoints: 850,  currentStreak: 5, completedTopics: ['Number Sense', 'Addition', 'Shapes'],   studyTimeMinutes: 120, grade: 'Grade 3', school: 'Hyderabad International School' },
    'ishaan@test.ai': { xpPoints: 1050, currentStreak: 3, completedTopics: ['Fractions', 'Multiplication', 'Time'],  studyTimeMinutes: 180, grade: 'Grade 4', school: 'Hyderabad International School' },
    'rohan@test.ai':  { xpPoints: 1200, currentStreak: 2, completedTopics: ['Decimals', 'Area & Perimeter'],          studyTimeMinutes: 150, grade: 'Grade 5', school: 'Hyderabad International School' },
    'diya@test.ai':   { xpPoints: 780,  currentStreak: 7, completedTopics: ['Patterns', 'Counting', 'Measurement'],  studyTimeMinutes: 100, grade: 'Grade 3', school: 'Hyderabad International School' },
  };

  const fetchChildren = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setChildren(data);
        } else if (isDemo) {
          const derived = (user?.children ?? []).map((c: any, i: number) => ({
            id: c.email || `child-${i}`, name: c.name, email: c.email, grade: c.grade,
            ...(DEMO_STATS[c.email] ?? {}),
          }));
          setChildren(derived);
        } else {
          setChildren([]);
        }
      } else if (isDemo) {
        const derived = (user?.children ?? []).map((c: any, i: number) => ({
          id: c.email || `child-${i}`, name: c.name, email: c.email, grade: c.grade,
          ...(DEMO_STATS[c.email] ?? {}),
        }));
        setChildren(derived);
      } else {
        setChildren([]);
      }
    } catch {
      if (isDemo) {
        const derived = (user?.children ?? []).map((c: any, i: number) => ({
          id: c.email || `child-${i}`, name: c.name, email: c.email, grade: c.grade,
          ...(DEMO_STATS[c.email] ?? {}),
        }));
        setChildren(derived);
      } else {
        setChildren([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [parentEmail, isDemo, user]);

  useEffect(() => { fetchChildren(); }, [fetchChildren]);

  async function addChild() {
    if (!childEmail.trim()) return;
    setLinking(true);
    setLinkError('');
    try {
      const res = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childEmail: childEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLinkError(data.error || 'Could not link child.');
        return;
      }
      setChildEmail('');
      setShowModal(false);
      setLoading(true);
      fetchChildren();
    } catch {
      setLinkError('Network error. Please try again.');
    } finally {
      setLinking(false);
    }
  }

  function confirmRemove(child: any) {
    Alert.alert(
      'Remove Child',
      `Remove ${child.name} from your account? Their data will not be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeChild(child.id) },
      ]
    );
  }

  async function removeChild(childId: string) {
    try {
      await fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children/${childId}`, { method: 'DELETE' });
      setChildren(prev => prev.filter(c => c.id !== childId));
    } catch { /* ignore */ }
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="My Kids"
          subtitle="Managed Accounts"
          searchPlaceholder="Search kids..."
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchChildren(); }} tintColor={colors.primary} />}
        >
          <View style={{ marginBottom: spacing.xl }}>
            <Text style={styles.pageTitle}>Managed Accounts</Text>
            <Text style={styles.pageSubtitle}>View progress, manage controls, and update settings for your children.</Text>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: 48 }} />
          ) : (
            <View style={styles.cardsRow}>
              {children.map((child) => (
                <ChildCard
                  key={child.id}
                  child={child}
                  colors={colors}
                  styles={styles}
                  navigation={navigation}
                  onRemove={confirmRemove}
                />
              ))}

              {children.length === 0 && (
                <View style={styles.emptyState}>
                  <Feather name="users" size={40} color={colors.textDim} />
                  <Text style={styles.emptyTitle}>No children linked yet</Text>
                  <Text style={styles.emptySub}>Add your child's account using their registered email address.</Text>
                </View>
              )}

              <TouchableOpacity style={styles.addChildCard} activeOpacity={0.7} onPress={() => { setLinkError(''); setChildEmail(''); setShowModal(true); }}>
                <Feather name="plus" size={28} color={colors.textDim} />
                <Text style={styles.addChildTitle}>Add {children.length > 0 ? 'Another' : 'a'} Child</Text>
                <Text style={styles.addChildSub}>Link your child's account to track their progress.</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>

      {/* Add Child Modal */}
      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Link Child Account</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Enter your child's registered email address. They must have a student account already.
            </Text>

            <TextInput
              style={[styles.input, linkError ? { borderColor: colors.accentRed } : {}]}
              placeholder="child@example.com"
              placeholderTextColor={colors.textMuted}
              value={childEmail}
              onChangeText={t => { setChildEmail(t); setLinkError(''); }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {linkError ? (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={13} color={colors.accentRed} />
                <Text style={[styles.errorText, { color: colors.accentRed }]}>{linkError}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.linkBtn, (!childEmail.trim() || linking) && { opacity: 0.5 }]}
              onPress={addChild}
              disabled={!childEmail.trim() || linking}
              activeOpacity={0.8}
            >
              {linking
                ? <ActivityIndicator color="white" size="small" />
                : <Text style={styles.linkBtnText}>Link Child</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48 },

  pageTitle: { fontSize: 22, fontWeight: '700', color: c.textMain, marginBottom: 6 },
  pageSubtitle: { fontSize: 13, color: c.textMuted },

  cardsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },

  childCard: {
    flex: 1, minWidth: 280,
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.xl,
    padding: spacing.xl, gap: spacing.lg,
  },
  childCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 22, fontWeight: '700' },
  childName: { fontSize: 18, fontWeight: '700', color: c.textMain },
  childSub: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '600' },

  statsRow: {
    flexDirection: 'row', backgroundColor: c.bgDark,
    borderRadius: radius.lg, borderWidth: 1, borderColor: c.borderColor, overflow: 'hidden',
  },
  statBox: { flex: 1, padding: spacing.md, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: c.borderColor },
  statLabel: { fontSize: 11, color: c.textMuted, marginBottom: 4 },
  statValue: { fontSize: 16, fontWeight: '700', color: c.textMain },

  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },

  quickNav: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  quickBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.primaryGlow, borderWidth: 1,
    borderColor: c.primary + '40', borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  quickBtnText: { fontSize: 12, fontWeight: '600' },

  recentSection: { gap: 8, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: c.borderColor },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activityText: { fontSize: 12, color: c.textMuted, flex: 1 },

  emptyState: { flex: 1, minWidth: 280, alignItems: 'center', paddingVertical: 48, gap: spacing.md },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: c.textMain },
  emptySub: { fontSize: 13, color: c.textMuted, textAlign: 'center', maxWidth: 260 },

  addChildCard: {
    flex: 1, minWidth: 200,
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderStyle: 'dashed',
    borderRadius: radius.xl, padding: spacing.xxl,
    alignItems: 'center', justifyContent: 'center', gap: spacing.md,
  },
  addChildTitle: { fontSize: 16, fontWeight: '700', color: c.textMain, textAlign: 'center' },
  addChildSub: { fontSize: 12, color: c.textMuted, textAlign: 'center' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalBox: {
    width: '100%', maxWidth: 420,
    backgroundColor: c.cardDark, borderRadius: radius.xl,
    borderWidth: 1, borderColor: c.borderColor, padding: spacing.xl, gap: spacing.lg,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.textMain },
  modalDesc: { fontSize: 13, color: c.textMuted, lineHeight: 20 },
  input: {
    borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md,
    padding: spacing.md, fontSize: 14, color: c.textMain,
    backgroundColor: c.bgDark,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { fontSize: 12, flex: 1 },
  linkBtn: {
    backgroundColor: c.primary, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center',
  },
  linkBtnText: { fontSize: 15, fontWeight: '700', color: 'white' },
});
