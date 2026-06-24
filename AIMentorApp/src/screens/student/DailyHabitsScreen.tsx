import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../context/ThemeContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius, fonts } from '../../theme';
import SERVER_URL from '../../config/serverUrl';
import { useAuth } from '../../context/AuthContext';

const TEAL   = '#5F8A86';
const GOLD   = '#C0A07E';
const SAGE   = '#82A896';
const AMBER  = '#C5A56A';   // warm pastel gold — premium

// First N habits are free; rest require premium
const FREE_UNLOCKED = 2;

interface Habit {
  id: string;
  label: string;
  icon: string;
  coins: number;
}

interface TodayData {
  habits: Habit[];
  parentTasks: (Habit & { fromParent: boolean })[];
  today: { completed: string[]; coinsEarned: number };
  streak: number;
  streakBonus: number;
  totalCoins: number;
  journalText: string;
  date: string;
}

const ICON_MAP: Record<string, string> = {
  smile: 'smile', droplet: 'droplet', sun: 'sun', shield: 'shield',
  moon: 'moon', activity: 'activity', 'book-open': 'book-open', sunrise: 'sunrise',
  star: 'star', heart: 'heart', zap: 'zap', check: 'check-circle',
};
function safeIcon(name: string): any {
  return ICON_MAP[name] ?? 'check-circle';
}

export default function DailyHabitsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [data,       setData]       = useState<TodayData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checking,   setChecking]   = useState<string | null>(null);
  const [coinPop,    setCoinPop]    = useState<{ id: string; coins: number } | null>(null);
  const [showJournal,setShowJournal]= useState(false);

  const fetchData = useCallback(async () => {
    if (!user?.email) return;
    try {
      const res = await fetch(`${SERVER_URL}/habits/today?userEmail=${encodeURIComponent(user.email)}`);
      const json = await res.json();
      setData(json);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [user?.email]);

  // Initial load + auto-refresh every 10s so tasks a parent allocates appear
  // without the student manually refreshing the browser.
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Refresh immediately whenever the screen regains focus.
  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  async function toggleHabit(habitId: string) {
    if (!user?.email || checking) return;
    setChecking(habitId);
    try {
      const res = await fetch(`${SERVER_URL}/habits/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: user.email, habitId }),
      });
      const json = await res.json();
      setData(prev => prev ? {
        ...prev,
        today: { completed: json.completed, coinsEarned: json.coinsEarned },
        streak: json.streak,
        totalCoins: json.totalCoins,
        journalText: json.journalText,
      } : prev);
      if (json.checked && json.coinsChange > 0) {
        setCoinPop({ id: habitId, coins: json.coinsChange });
        setTimeout(() => setCoinPop(null), 1800);
      }
    } catch {}
    finally { setChecking(null); }
  }

  const parentTasks    = data?.parentTasks ?? [];
  const completedCount = data?.today?.completed?.length ?? 0;
  const totalHabits    = parentTasks.length;
  const allDone        = totalHabits > 0 && completedCount === totalHabits;
  const progressPct    = totalHabits > 0 ? completedCount / totalHabits : 0;

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Daily Habits"
          subtitle="Build your best self, one day at a time"
          showBack={true}
          onMenuPress={() => navigation.openDrawer()}
          showSearch={false}
        />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={TEAL} />}
        >
          {loading && (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={TEAL} />
            </View>
          )}

          {!loading && data && (
            <>
              {/* ── Stats row ── */}
              <View style={styles.statsRow}>
                {/* Streak */}
                <LinearGradient colors={[GOLD + '30', GOLD + '10']} style={[styles.statCard, { borderColor: GOLD + '40' }]}>
                  <Feather name="zap" size={20} color={GOLD} />
                  <Text style={[styles.statNum, { color: GOLD }]}>{data.streak}</Text>
                  <Text style={[styles.statLabel, { color: colors.textMuted }]}>Day Streak</Text>
                </LinearGradient>

                {/* Coins */}
                <LinearGradient colors={[TEAL + '30', TEAL + '10']} style={[styles.statCard, { borderColor: TEAL + '40' }]}>
                  <Feather name="star" size={20} color={TEAL} />
                  <Text style={[styles.statNum, { color: TEAL }]}>{data.totalCoins}</Text>
                  <Text style={[styles.statLabel, { color: colors.textMuted }]}>Total Coins</Text>
                </LinearGradient>

                {/* Today */}
                <LinearGradient colors={[SAGE + '30', SAGE + '10']} style={[styles.statCard, { borderColor: SAGE + '40' }]}>
                  <Feather name="check-circle" size={20} color={SAGE} />
                  <Text style={[styles.statNum, { color: SAGE }]}>{completedCount}/{totalHabits}</Text>
                  <Text style={[styles.statLabel, { color: colors.textMuted }]}>Today</Text>
                </LinearGradient>
              </View>

              {/* ── Progress bar ── */}
              <View style={[styles.progressCard, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
                <View style={styles.progressTop}>
                  <Text style={[styles.progressTitle, { color: colors.textMain }]}>
                    {allDone ? 'All habits done! Amazing!' : `${completedCount} of ${totalHabits} habits completed`}
                  </Text>
                  <Text style={[styles.progressCoins, { color: GOLD }]}>+{data.today.coinsEarned} coins</Text>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
                  <View style={[styles.progressFill, {
                    width: `${progressPct * 100}%` as any,
                    backgroundColor: allDone ? SAGE : TEAL,
                  }]} />
                </View>
                {data.streak > 0 && data.streak % 10 === 0 && (
                  <View style={styles.streakMilestone}>
                    <Feather name="award" size={13} color={GOLD} />
                    <Text style={[styles.streakMilestoneText, { color: GOLD }]}>
                      {data.streak}-day streak! {data.streak === 100 ? `+${data.streakBonus} bonus coins earned!` : `Keep going to 100 days!`}
                    </Text>
                  </View>
                )}
              </View>

              {/* ── Parent-assigned tasks (only source of habits) ── */}
              <Text style={[styles.sectionTitle, { color: GOLD }]}>TODAY'S HABITS</Text>

              {parentTasks.length === 0 ? (
                <View style={[styles.emptyBox, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
                  <Feather name="inbox" size={36} color={colors.textDim} />
                  <Text style={[styles.emptyTitle, { color: colors.textMain }]}>No habits yet</Text>
                  <Text style={[styles.emptySub, { color: colors.textMuted }]}>Ask your parent to assign daily habits for you.</Text>
                </View>
              ) : (
                <View style={styles.habitGrid}>
                  {parentTasks.map(task => {
                    const done      = data?.today?.completed?.includes(task.id) ?? false;
                    const isLoading = checking === task.id;
                    const popping   = coinPop?.id === task.id;
                    return (
                      <TouchableOpacity
                        key={task.id}
                        style={[styles.habitCard, {
                          backgroundColor: done ? GOLD + '18' : colors.cardDark,
                          borderColor: done ? GOLD + '60' : GOLD + '30',
                        }]}
                        onPress={() => toggleHabit(task.id)}
                        activeOpacity={0.8}
                        disabled={!!checking}
                      >
                        <View style={[styles.habitIcon, { backgroundColor: done ? GOLD + '28' : GOLD + '12' }]}>
                          {isLoading
                            ? <ActivityIndicator size="small" color={GOLD} />
                            : <Feather name={safeIcon(task.icon)} size={14} color={GOLD} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.habitLabel, { color: done ? colors.textMain : colors.textMuted, fontWeight: done ? '700' : '500' }]} numberOfLines={2}>{task.label}</Text>
                          <View style={styles.habitCoinsRow}>
                            <Feather name="star" size={9} color={GOLD} />
                            <Text style={[styles.habitCoins, { color: GOLD }]}>+{task.coins}</Text>
                          </View>
                        </View>
                        <View style={[styles.checkbox, { backgroundColor: done ? GOLD : 'transparent', borderColor: done ? GOLD : GOLD + '50' }]}>
                          {done && <Feather name="check" size={11} color="#fff" />}
                        </View>
                        {popping && (
                          <View style={[styles.coinPop, { backgroundColor: GOLD }]}>
                            <Text style={styles.coinPopText}>+{coinPop!.coins}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* ── Journal ── */}
              {data.journalText ? (
                <View style={[styles.journalCard, { backgroundColor: colors.cardDark, borderColor: SAGE + '40' }]}>
                  <TouchableOpacity style={styles.journalHeader} onPress={() => setShowJournal(p => !p)} activeOpacity={0.8}>
                    <View style={[styles.journalIconWrap, { backgroundColor: SAGE + '20' }]}>
                      <Feather name="book" size={16} color={SAGE} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.journalTitle, { color: SAGE }]}>My Daily Journal</Text>
                      <Text style={[styles.journalSub, { color: colors.textMuted }]}>Auto-generated from today's habits</Text>
                    </View>
                    <Feather name={showJournal ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textDim} />
                  </TouchableOpacity>
                  {showJournal && (
                    <View style={[styles.journalBody, { borderTopColor: colors.borderColor }]}>
                      <Text style={[styles.journalText, { color: colors.textMain }]}>{data.journalText}</Text>
                    </View>
                  )}
                </View>
              ) : null}

              {/* ── Motivation footer ── */}
              <LinearGradient
                colors={[TEAL + '20', SAGE + '15']}
                style={[styles.motivationCard, { borderColor: TEAL + '30' }]}
              >
                <Feather name="heart" size={16} color={TEAL} />
                <Text style={[styles.motivationText, { color: colors.textMuted }]}>
                  {data.streak >= 7
                    ? `${data.streak} days strong! You are building real character.`
                    : 'Every great person started with small daily habits. You\'re on your way!'}
                </Text>
              </LinearGradient>

            </>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: any) => StyleSheet.create({
  screen:  { flex: 1, backgroundColor: c.bgDark },
  content: { padding: spacing.lg, paddingBottom: 48, gap: spacing.md },
  center:  { alignItems: 'center', paddingVertical: 60 },

  statsRow: { flexDirection: 'row', gap: spacing.md },
  statCard: {
    flex: 1, alignItems: 'center', paddingVertical: spacing.lg,
    borderRadius: radius.xl, borderWidth: 1, gap: 4,
  },
  statNum:   { fontSize: 22, fontWeight: '800', fontFamily: fonts.serif },
  statLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  progressCard: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: spacing.sm },
  progressTop:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressTitle:{ fontSize: 13, fontWeight: '700' },
  progressCoins:{ fontSize: 13, fontWeight: '800' },
  progressTrack:{ height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  streakMilestone: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  streakMilestoneText: { fontSize: 12, fontWeight: '600' },

  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },

  premiumBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10, borderRadius: radius.lg, borderWidth: 1,
  },
  premiumText: { flex: 1, fontSize: 11, fontWeight: '600' },
  premiumBtn:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7 },
  premiumBtnText: { fontSize: 10, fontWeight: '800', color: '#fff' },

  habitGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  habitCard: {
    width: '48.5%',
    borderRadius: radius.md, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 8,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  habitCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  habitIcon:    { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  habitLabel:   { fontSize: 12, lineHeight: 16, flex: 1 },
  habitCoinsRow:{ flexDirection: 'row', alignItems: 'center', gap: 2 },
  habitCoins:   { fontSize: 10, fontWeight: '700' },
  coinPop: {
    position: 'absolute', right: 8, top: -8,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10,
  },
  coinPopText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  checkbox: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },

  journalCard: { borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden' },
  journalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  journalIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  journalTitle: { fontSize: 14, fontWeight: '700' },
  journalSub:   { fontSize: 11, marginTop: 1 },
  journalBody:  { borderTopWidth: 1, padding: spacing.lg },
  journalText:  { fontSize: 14, lineHeight: 24 },

  motivationCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.xl, borderWidth: 1,
  },
  motivationText: { flex: 1, fontSize: 13, lineHeight: 20 },

  emptyBox: {
    alignItems: 'center', paddingVertical: 48,
    borderRadius: radius.xl, borderWidth: 1, gap: 10,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
  emptySub: { fontSize: 13, textAlign: 'center', maxWidth: 260, lineHeight: 20 },
});
