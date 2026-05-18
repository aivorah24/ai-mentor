import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useStudentData } from '../../context/StudentDataContext';
import SERVER_URL from '../../config/serverUrl';

const MEDAL_COLORS = ['#f59e0b', '#94a3b8', '#cd7c2c'];

function initials(name: string) {
  return name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function LeaderboardScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { stats, studentId } = useStudentData();

  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const data = await fetch(`${SERVER_URL}/student/leaderboard?limit=20`).then(r => r.json());
      if (Array.isArray(data)) setLeaderboard(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refresh leaderboard every time the screen gains focus
  useFocusEffect(
    useCallback(() => {
      fetchLeaderboard();
    }, [fetchLeaderboard])
  );

  const myRank = leaderboard.find(s => s.id === studentId)?.rank ?? null;

  const topThree = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Leaderboard"
          subtitle="See how you rank among your classmates"
          searchPlaceholder="Search students..."
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLeaderboard(); }} tintColor={colors.primary} />
          }
        >
          {/* Your rank banner */}
          {myRank && (
            <View style={styles.myRankCard}>
              <View style={[styles.myRankIcon, { backgroundColor: colors.primary + '20' }]}>
                <Feather name="award" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.myRankLabel}>Your Current Rank</Text>
                <Text style={styles.myRankValue}>#{myRank} in Class</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.myXP, { color: colors.accentYellow }]}>{stats.xpPoints.toLocaleString()}</Text>
                <Text style={styles.myXPLabel}>XP</Text>
              </View>
            </View>
          )}

          {/* Live badge */}
          <View style={styles.liveRow}>
            <Feather name="users" size={14} color={colors.textMuted} />
            <Text style={styles.liveTitle}>Live Class Rankings</Text>
            <View style={styles.liveBadge}>
              <View style={[styles.liveDot, { backgroundColor: colors.accentGreen }]} />
              <Text style={[styles.liveText, { color: colors.accentGreen }]}>LIVE</Text>
            </View>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 48 }} />
          ) : leaderboard.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="award" size={40} color={colors.textDim} />
              <Text style={styles.emptyText}>No rankings yet.</Text>
              <Text style={styles.emptySubtext}>Start learning to earn XP and claim your spot!</Text>
            </View>
          ) : (
            <>
              {/* Top 3 podium */}
              {topThree.length >= 3 && (
                <View style={styles.podium}>
                  {/* 2nd */}
                  <View style={[styles.podiumItem, { marginTop: 24 }]}>
                    <View style={[styles.podiumAvatar, { backgroundColor: MEDAL_COLORS[1] + '20', borderColor: MEDAL_COLORS[1] }]}>
                      <Text style={[styles.podiumAvatarText, { color: MEDAL_COLORS[1] }]}>{initials(topThree[1]?.name ?? '')}</Text>
                    </View>
                    <Text style={styles.podiumName} numberOfLines={1}>{topThree[1]?.name?.split(' ')[0]}</Text>
                    <Text style={[styles.podiumXP, { color: MEDAL_COLORS[1] }]}>{(topThree[1]?.score ?? 0).toLocaleString()}</Text>
                    <View style={[styles.podiumBase, { backgroundColor: MEDAL_COLORS[1] + '30', height: 56 }]}>
                      <Text style={[styles.podiumRank, { color: MEDAL_COLORS[1] }]}>2</Text>
                    </View>
                  </View>
                  {/* 1st */}
                  <View style={styles.podiumItem}>
                    <View style={[styles.podiumCrown]}>
                      <Feather name="award" size={16} color={MEDAL_COLORS[0]} />
                    </View>
                    <View style={[styles.podiumAvatar, { width: 64, height: 64, borderRadius: 32, backgroundColor: MEDAL_COLORS[0] + '20', borderColor: MEDAL_COLORS[0], borderWidth: 3 }]}>
                      <Text style={[styles.podiumAvatarText, { color: MEDAL_COLORS[0], fontSize: 22 }]}>{initials(topThree[0]?.name ?? '')}</Text>
                    </View>
                    <Text style={styles.podiumName} numberOfLines={1}>{topThree[0]?.name?.split(' ')[0]}</Text>
                    <Text style={[styles.podiumXP, { color: MEDAL_COLORS[0] }]}>{(topThree[0]?.score ?? 0).toLocaleString()}</Text>
                    <View style={[styles.podiumBase, { backgroundColor: MEDAL_COLORS[0] + '30', height: 80 }]}>
                      <Text style={[styles.podiumRank, { color: MEDAL_COLORS[0] }]}>1</Text>
                    </View>
                  </View>
                  {/* 3rd */}
                  <View style={[styles.podiumItem, { marginTop: 40 }]}>
                    <View style={[styles.podiumAvatar, { backgroundColor: MEDAL_COLORS[2] + '20', borderColor: MEDAL_COLORS[2] }]}>
                      <Text style={[styles.podiumAvatarText, { color: MEDAL_COLORS[2] }]}>{initials(topThree[2]?.name ?? '')}</Text>
                    </View>
                    <Text style={styles.podiumName} numberOfLines={1}>{topThree[2]?.name?.split(' ')[0]}</Text>
                    <Text style={[styles.podiumXP, { color: MEDAL_COLORS[2] }]}>{(topThree[2]?.score ?? 0).toLocaleString()}</Text>
                    <View style={[styles.podiumBase, { backgroundColor: MEDAL_COLORS[2] + '30', height: 40 }]}>
                      <Text style={[styles.podiumRank, { color: MEDAL_COLORS[2] }]}>3</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Full list */}
              <View style={styles.listCard}>
                {leaderboard.map((s, i) => {
                  const medalColor = MEDAL_COLORS[s.rank - 1];
                  const isMe = s.id === studentId;
                  return (
                    <View
                      key={s.id}
                      style={[
                        styles.leaderRow,
                        i < leaderboard.length - 1 && styles.leaderBorder,
                        isMe && { backgroundColor: colors.primary + '0C' },
                      ]}
                    >
                      <View style={[styles.rankBadge, { backgroundColor: medalColor ? medalColor + '22' : colors.borderColor }]}>
                        {s.rank <= 3
                          ? <Feather name="award" size={12} color={medalColor} />
                          : <Text style={[styles.rankNum, { color: colors.textMuted }]}>{s.rank}</Text>}
                      </View>
                      <View style={[styles.avatar, { backgroundColor: isMe ? colors.primary + '30' : colors.primary + '14' }]}>
                        <Text style={[styles.avatarText, { color: isMe ? colors.primary : colors.textMuted }]}>{initials(s.name)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[styles.leaderName, isMe && { color: colors.primary }]}>{s.name}</Text>
                          {isMe && <View style={styles.youBadge}><Text style={[styles.youText, { color: colors.primary }]}>You</Text></View>}
                        </View>
                        <Text style={styles.leaderMeta}>{s.grade} · {s.streak}d streak · {s.topics} topics</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.leaderScore, { color: colors.accentYellow }]}>{s.score.toLocaleString()}</Text>
                        <Text style={styles.leaderXP}>XP</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
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

  myRankCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: c.primary + '12',
    borderWidth: 1,
    borderColor: c.primary + '30',
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  myRankIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  myRankLabel: { fontSize: 11, color: c.textMuted },
  myRankValue: { fontSize: 18, fontWeight: '700', color: c.textMain },
  myXP: { fontSize: 20, fontWeight: '800' },
  myXPLabel: { fontSize: 10, color: c.textDim, fontWeight: '600' },

  liveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: c.textMain },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  podium: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  podiumItem: { alignItems: 'center', flex: 1, gap: 4 },
  podiumCrown: { marginBottom: 2 },
  podiumAvatar: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
  },
  podiumAvatarText: { fontSize: 18, fontWeight: '700' },
  podiumName: { fontSize: 12, fontWeight: '700', color: c.textMain, textAlign: 'center' },
  podiumXP: { fontSize: 11, fontWeight: '700' },
  podiumBase: {
    width: '100%', borderTopLeftRadius: 8, borderTopRightRadius: 8,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  podiumRank: { fontSize: 20, fontWeight: '800' },

  listCard: {
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.xl, overflow: 'hidden',
  },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  leaderBorder: { borderBottomWidth: 1, borderBottomColor: c.borderColor },
  rankBadge: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rankNum: { fontSize: 12, fontWeight: '700' },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontSize: 13, fontWeight: '700' },
  leaderName: { fontSize: 14, fontWeight: '600', color: c.textMain },
  leaderMeta: { fontSize: 11, color: c.textDim, marginTop: 1 },
  leaderScore: { fontSize: 15, fontWeight: '800', letterSpacing: -0.5 },
  leaderXP: { fontSize: 10, color: c.textDim, fontWeight: '600' },
  youBadge: { backgroundColor: c.primaryGlow, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  youText: { fontSize: 9, fontWeight: '800' },

  emptyState: { alignItems: 'center', paddingVertical: 60, gap: spacing.md },
  emptyText: { fontSize: 16, fontWeight: '700', color: c.textMain },
  emptySubtext: { fontSize: 13, color: c.textMuted, textAlign: 'center' },
});
