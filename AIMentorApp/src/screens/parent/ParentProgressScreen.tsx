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
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatStudyTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function ParentProgressScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const parentEmail = user?.email || 'parent@demo.com';

  const [children, setChildren] = useState<any[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [weekly, setWeekly] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const child = children[selectedIdx];

  useEffect(() => {
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data) && data.length > 0) setChildren(data); })
      .catch(() => {});
  }, [parentEmail]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    const refresh = () => {
      if (!child) return;
      fetchData();
      fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
        .then(r => r.json())
        .then(data => { if (Array.isArray(data) && data.length > 0) setChildren(data); })
        .catch(() => {});
    };

    const startPolling = () => {
      if (interval) return;
      interval = setInterval(refresh, 30000);
    };

    const unsubFocus = navigation.addListener('focus', () => {
      refresh();
      startPolling();
    });
    const unsubBlur = navigation.addListener('blur', stopPolling);

    startPolling();

    return () => {
      stopPolling();
      unsubFocus();
      unsubBlur();
    };
  }, [child, navigation, parentEmail]);

  const fetchData = async () => {
    if (!child) return;
    setLoading(true);
    try {
      const [statsRes, weeklyRes] = await Promise.all([
        fetch(`${SERVER_URL}/student/${child.id}`).then(r => r.json()),
        fetch(`${SERVER_URL}/student/${child.id}/weekly`).then(r => r.json()),
      ]);
      if (statsRes && !statsRes.error) setStats(statsRes);
      if (weeklyRes?.days) {
        const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const actMap: Record<string, number> = {};
        weeklyRes.days.forEach((d: any) => { actMap[d.day] = d.studyMinutes; });
        setWeekly(dayOrder.map(d => actMap[d] ?? 0));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, [selectedIdx, children]);

  const completedTopics: string[] = stats?.completedTopics ?? [];
  const totalTopics = 14;
  const progressPct = Math.round((completedTopics.length / totalTopics) * 100);
  const actMax = Math.max(...weekly, 60);
  const totalWeekMins = weekly.reduce((a, b) => a + b, 0);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Progress & Reports"
          subtitle="Detailed academic reports"
          searchPlaceholder="Search..."
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.primary} />}
        >
          {/* Child Selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.childRow}>
            {children.map((c, i) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.childTab, selectedIdx === i && styles.childTabActive]}
                onPress={() => setSelectedIdx(i)}
                activeOpacity={0.8}
              >
                <View style={[styles.childAvatar, { backgroundColor: selectedIdx === i ? colors.primary + '20' : colors.cardDark }]}>
                  <Text style={[styles.childAvatarText, { color: selectedIdx === i ? colors.primary : colors.textMuted }]}>{c.name[0]}</Text>
                </View>
                <Text style={[styles.childTabName, { color: selectedIdx === i ? colors.primary : colors.textMuted }]}>{c.name}</Text>
                <Text style={styles.childTabGrade}>{c.grade}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} size="large" />
          ) : (
            <>
              {/* Summary cards */}
              <View style={styles.statsGrid}>
                {[
                  { icon: 'zap', label: 'XP Points', value: (stats?.xpPoints ?? 0).toLocaleString(), color: colors.accentYellow },
                  { icon: 'award', label: 'Level', value: `Level ${stats?.level ?? 1}`, color: colors.accentPurple },
                  { icon: 'trending-up', label: 'Streak', value: `${stats?.currentStreak ?? 0} days`, color: colors.accentGreen },
                  { icon: 'clock', label: 'Total Study', value: formatStudyTime(stats?.studyTimeMinutes ?? 0), color: colors.accentBlue },
                  { icon: 'book-open', label: 'Chapters Done', value: `${completedTopics.length}/${totalTopics}`, color: colors.primary },
                  { icon: 'clipboard', label: 'Assignments', value: `${stats?.assignmentsDone ?? 0} done`, color: colors.accentCyan },
                ].map(item => (
                  <View key={item.label} style={styles.statCard}>
                    <View style={[styles.statIcon, { backgroundColor: item.color + '18' }]}>
                      <Feather name={item.icon as any} size={18} color={item.color} />
                    </View>
                    <Text style={styles.statLabel}>{item.label}</Text>
                    <Text style={[styles.statValue, { color: item.color }]}>{item.value}</Text>
                  </View>
                ))}
              </View>

              {/* Chapter progress */}
              <Text style={styles.sectionTitle}>Chapter Completion</Text>
              <View style={styles.card}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md }}>
                  <Text style={styles.cardSub}>{completedTopics.length} of {totalTopics} chapters complete</Text>
                  <Text style={[styles.cardSub, { color: colors.primary }]}>{progressPct}%</Text>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
                  <View style={[styles.progressFill, { width: `${progressPct}%`, backgroundColor: colors.primary }]} />
                </View>
              </View>

              {/* Weekly activity */}
              <Text style={styles.sectionTitle}>This Week's Activity</Text>
              <View style={styles.card}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md }}>
                  <Text style={styles.cardSub}>Total: {formatStudyTime(totalWeekMins)}</Text>
                  <Text style={styles.cardSub}>Daily goal: 2h</Text>
                </View>
                <View style={styles.barsRow}>
                  {WEEK_DAYS.map((day, i) => {
                    const barH = actMax > 0 ? Math.max(4, (weekly[i] / actMax) * 80) : 4;
                    const met = weekly[i] >= 120;
                    return (
                      <View key={day} style={styles.barWrapper}>
                        <View style={styles.barTrack}>
                          <View style={[styles.barFill, { height: barH, backgroundColor: met ? colors.accentGreen : colors.primary }]} />
                        </View>
                        <Text style={styles.barLabel}>{day}</Text>
                        {weekly[i] > 0 && <Text style={[styles.barLabel, { color: colors.textMuted }]}>{Math.round(weekly[i])}m</Text>}
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Completed chapters list */}
              {completedTopics.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Completed Chapters</Text>
                  <View style={styles.card}>
                    {completedTopics.map((topic, i) => (
                      <View key={topic} style={[styles.topicRow, i < completedTopics.length - 1 && styles.topicBorder]}>
                        <View style={[styles.topicCheck, { backgroundColor: colors.accentGreen }]}>
                          <Feather name="check" size={12} color="white" />
                        </View>
                        <Text style={styles.topicName}>{topic.replace(/_/g, ' ').replace(/ch\d+\s*/i, '')}</Text>
                        <Text style={[styles.topicStatus, { color: colors.accentGreen }]}>Done</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
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
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.xl },

  childRow: { flexDirection: 'row', marginBottom: spacing.sm },
  childTab: {
    alignItems: 'center', gap: 4, marginRight: spacing.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderRadius: radius.lg, borderWidth: 1, borderColor: 'transparent',
  },
  childTabActive: { borderColor: c.primary, backgroundColor: c.primaryGlow },
  childAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  childAvatarText: { fontSize: 18, fontWeight: '700' },
  childTabName: { fontSize: 13, fontWeight: '700' },
  childTabGrade: { fontSize: 10, color: c.textDim },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statCard: {
    flex: 1, minWidth: 140,
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.lg,
    padding: spacing.lg, alignItems: 'center', gap: 6,
  },
  statIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  statLabel: { fontSize: 11, color: c.textMuted, textAlign: 'center' },
  statValue: { fontSize: 17, fontWeight: '700', textAlign: 'center' },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.textMain },
  card: {
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.lg,
  },
  cardSub: { fontSize: 11, color: c.textDim },

  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },

  barsRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 110 },
  barWrapper: { flex: 1, alignItems: 'center', gap: 4 },
  barTrack: {
    width: 18, height: 80,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 9, justifyContent: 'flex-end', overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: 9 },
  barLabel: { fontSize: 9, color: c.textDim },

  topicRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  topicBorder: { borderBottomWidth: 1, borderBottomColor: c.borderColor },
  topicCheck: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  topicName: { flex: 1, fontSize: 13, color: c.textMain, textTransform: 'capitalize' },
  topicStatus: { fontSize: 11, fontWeight: '600' },
});
