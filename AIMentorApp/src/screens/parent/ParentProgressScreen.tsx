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

export default function ParentProgressScreen({ navigation, route }: any) {
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
  const [practiceInsights, setPracticeInsights] = useState<any>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const child = children[selectedIdx];

  useEffect(() => {
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setChildren(data);
          const targetChildId = route?.params?.childId;
          if (targetChildId) {
            const idx = data.findIndex((c: any) => c.id === targetChildId);
            if (idx >= 0) setSelectedIdx(idx);
          }
        }
      })
      .catch(() => {});
  }, [parentEmail, route?.params?.childId]);

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
    setInsightsLoading(true);
    try {
      const [statsRes, weeklyRes, trendsRes] = await Promise.all([
        fetch(`${SERVER_URL}/student/${child.id}`).then(r => r.json()),
        fetch(`${SERVER_URL}/student/${child.id}/weekly`).then(r => r.json()),
        fetch(`${SERVER_URL}/student/${child.id}/mistake-trends`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (statsRes && !statsRes.error) setStats(statsRes);
      if (weeklyRes?.days) {
        const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const actMap: Record<string, number> = {};
        weeklyRes.days.forEach((d: any) => { actMap[d.day] = d.studyMinutes; });
        setWeekly(dayOrder.map(d => actMap[d] ?? 0));
      }
      if (trendsRes) setPracticeInsights(trendsRes);
      else setPracticeInsights(null);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
      setInsightsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [selectedIdx, children]);

  const completedTopics: string[] = stats?.completedTopics ?? [];
  const totalTopics = stats?.totalTopics || completedTopics.length || 1;
  const progressPct = Math.min(100, Math.round((completedTopics.length / totalTopics) * 100));
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
              {/* ── Hero stats row ── */}
              <View style={styles.heroRow}>
                {[
                  { icon: 'zap',        val: (stats?.xpPoints ?? 0).toLocaleString(), sub: 'XP Points',  color: '#C4836A' },
                  { icon: 'award',      val: `Lv.${stats?.level ?? 1}`,               sub: 'Level',      color: '#7AADA8' },
                  { icon: 'activity',   val: `${stats?.currentStreak ?? 0}d`,          sub: 'Streak',     color: '#5F8A86' },
                  { icon: 'clock',      val: formatStudyTime(stats?.studyTimeMinutes ?? 0), sub: 'Study Time', color: '#5A8A70' },
                ].map(item => (
                  <View key={item.sub} style={[styles.heroCard, { borderColor: item.color + '30', backgroundColor: item.color + '08' }]}>
                    <Feather name={item.icon as any} size={16} color={item.color} />
                    <Text style={[styles.heroVal, { color: item.color }]}>{item.val}</Text>
                    <Text style={styles.heroSub}>{item.sub}</Text>
                  </View>
                ))}
              </View>

              {/* ── Progress bar card ── */}
              <View style={styles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <View style={{ gap: 2 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textMain }}>Curriculum Progress</Text>
                    <Text style={{ fontSize: 11, color: colors.textDim }}>{completedTopics.length} of {totalTopics} topics completed</Text>
                  </View>
                  <View style={[styles.pctBadge, { borderColor: colors.primary + '40', backgroundColor: colors.primary + '12' }]}>
                    <Text style={{ fontSize: 18, fontWeight: '900', color: colors.primary }}>{progressPct}%</Text>
                  </View>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
                  <View style={[styles.progressFill, { width: `${progressPct}%` as any, backgroundColor: colors.primary }]} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  {[25, 50, 75, 100].map(m => (
                    <Text key={m} style={{ fontSize: 9, color: progressPct >= m ? colors.primary : colors.textDim, fontWeight: '600' }}>{m}%{progressPct >= m ? ' ✓' : ''}</Text>
                  ))}
                </View>
              </View>

              {/* ── This Week's Activity ── */}
              <View style={styles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <View>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textMain }}>This Week's Activity</Text>
                    <Text style={{ fontSize: 11, color: colors.textDim }}>Total: {formatStudyTime(totalWeekMins)}</Text>
                  </View>
                  <View style={{ backgroundColor: colors.primary + '12', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary }}>Goal: 2h/day</Text>
                  </View>
                </View>
                <View style={styles.barsRow}>
                  {WEEK_DAYS.map((day, i) => {
                    const mins = weekly[i];
                    const barH = actMax > 0 ? Math.max(4, (mins / actMax) * 72) : 4;
                    const met = mins >= 120;
                    const barColor = mins === 0 ? colors.borderColor : met ? '#5F8A86' : colors.primary;
                    return (
                      <View key={day} style={styles.barWrapper}>
                        <Text style={[styles.barTimeLabel, { color: mins > 0 ? colors.textMuted : 'transparent' }]}>
                          {formatStudyTime(mins)}
                        </Text>
                        <View style={[styles.barTrack, { backgroundColor: colors.borderColor + '60' }]}>
                          <View style={[styles.barFill, { height: barH, backgroundColor: barColor }]} />
                        </View>
                        <Text style={[styles.barLabel, { color: met ? '#5F8A86' : colors.textDim, fontWeight: met ? '700' : '400' }]}>{day}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* ── Practice Test Results ── */}
              {insightsLoading ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={{ fontSize: 12, color: colors.textDim }}>Loading practice data...</Text>
                </View>
              ) : practiceInsights && (practiceInsights.topics || []).length > 0 ? (
                <View style={styles.card}>
                  {/* Header with summary pills */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textMain }}>Practice Test Results</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <View style={{ backgroundColor: '#5F8A8615', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#5F8A8630' }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#5F8A86' }}>{practiceInsights.summary?.mastered ?? 0} passed</Text>
                      </View>
                      {(practiceInsights.summary?.struggling ?? 0) > 0 && (
                        <View style={{ backgroundColor: '#C8587015', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#C8587030' }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: '#C85870' }}>{practiceInsights.summary.struggling} needs work</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Topic score cards */}
                  {(practiceInsights.topics || []).map((t: any, i: number) => {
                    const score = t.latestScore ?? 0;
                    const passed = t.passed;
                    const scoreColor = score >= 80 ? '#5F8A86' : score >= 60 ? '#7AADA8' : '#C85870';
                    const trendIcon = t.improving ? 'trending-up' : t.struggling ? 'trending-down' : 'minus';
                    return (
                      <View key={t.topic} style={[styles.practiceRow, i < (practiceInsights.topics.length - 1) && { borderBottomWidth: 1, borderBottomColor: colors.borderColor }]}>
                        <View style={[styles.scoreDot, { backgroundColor: scoreColor + '20', borderColor: scoreColor + '40' }]}>
                          <Feather name={trendIcon as any} size={12} color={scoreColor} />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textMain }} numberOfLines={1}>{t.topic}</Text>
                          <Text style={{ fontSize: 11, color: colors.textDim }}>
                            {t.totalAttempts} attempt{t.totalAttempts !== 1 ? 's' : ''}
                            {t.totalAttempts > 1 && t.attempts?.[0]?.score != null ? `  ·  Started at ${t.attempts[0].score}%` : ''}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 2 }}>
                          <Text style={{ fontSize: 18, fontWeight: '900', color: scoreColor }}>{score}%</Text>
                          <View style={[{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }, passed ? { backgroundColor: '#5F8A8615' } : { backgroundColor: '#C8587015' }]}>
                            <Text style={{ fontSize: 9, fontWeight: '700', color: passed ? '#5F8A86' : '#C85870' }}>{passed ? 'PASSED' : 'NOT PASSED'}</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}

                  {/* Total practice time */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.borderColor }}>
                    <Feather name="clock" size={12} color={colors.textDim} />
                    <Text style={{ fontSize: 11, color: colors.textDim }}>
                      Total practice time: {formatStudyTime(Math.round((practiceInsights.summary?.totalPracticeTimeSeconds || 0) / 60))}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={[styles.card, { alignItems: 'center', paddingVertical: 24 }]}>
                  <Feather name="clipboard" size={28} color={colors.textDim} />
                  <Text style={{ fontSize: 13, color: colors.textDim, marginTop: 8 }}>No practice tests taken yet</Text>
                </View>
              )}

              {/* ── Completed Topics ── */}
              {completedTopics.length > 0 && (
                <View style={styles.card}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textMain }}>Completed Topics</Text>
                    <View style={{ backgroundColor: '#5F8A8615', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#5F8A86' }}>{completedTopics.length} done</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {completedTopics.map(topic => (
                      <View key={topic} style={styles.topicChip}>
                        <Feather name="check" size={9} color="#5F8A86" />
                        <Text style={styles.topicChipText}>{topic.replace(/_/g, ' ').replace(/^ch\d+\s*/i, '')}</Text>
                      </View>
                    ))}
                  </View>
                </View>
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
  content: { padding: spacing.xl, paddingBottom: 60, gap: spacing.lg },

  childRow: { flexDirection: 'row', marginBottom: 4 },
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

  // Hero stat row — 4 compact cards
  heroRow: { flexDirection: 'row', gap: spacing.sm },
  heroCard: {
    flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, paddingHorizontal: 8,
    borderRadius: radius.lg, borderWidth: 1,
  },
  heroVal: { fontSize: 14, fontWeight: '900' },
  heroSub: { fontSize: 9, color: c.textDim, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },

  card: {
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.lg,
  },
  pctBadge: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },

  // Weekly bar chart
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 120 },
  barWrapper: { flex: 1, alignItems: 'center', gap: 3 },
  barTimeLabel: { fontSize: 8, fontWeight: '600', height: 12, textAlign: 'center' },
  barTrack: { width: 20, height: 72, borderRadius: 10, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: 10 },
  barLabel: { fontSize: 9 },

  // Practice test topic rows
  practiceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  scoreDot: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  // Completed topics chips
  topicChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#5F8A8612', borderRadius: 8, borderWidth: 1, borderColor: '#5F8A8630',
    paddingHorizontal: 8, paddingVertical: 4,
  },
  topicChipText: { fontSize: 11, color: '#5F8A86', fontWeight: '600' },
});
