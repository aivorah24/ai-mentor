import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  grade: string;
  score: number;
  level: number;
  streak: number;
  topics: number;
}

interface Child { id: string; name: string; }

const MEDAL_COLORS = ['#f59e0b', '#94a3b8', '#cd7c2c'];

function initials(name: string) {
  return name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function ParentLeaderboardScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [childIds, setChildIds] = useState<Set<string>>(new Set());

  const fetchLeaderboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/student/leaderboard?limit=20`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setLeaderboard(data);
      }
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Refresh leaderboard every time the screen gains focus
  useFocusEffect(
    useCallback(() => {
      fetchLeaderboard();
    }, [fetchLeaderboard])
  );

  // Fetch children to know which rows to highlight
  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(user.email)}/children`)
      .then(r => r.ok ? r.json() : [])
      .then((data: Child[]) => {
        if (Array.isArray(data)) setChildIds(new Set(data.map(c => c.id)));
      })
      .catch(() => {});
  }, [user?.email]);

  const myChildren = leaderboard.filter(s => childIds.has(s.id));
  const topChild = myChildren[0] ?? null;

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="Class Leaderboard" subtitle="Live rankings for your child's class" onMenuPress={() => navigation.openDrawer()} />
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchLeaderboard(true)} tintColor={colors.primary} />}
        >
          {/* Your child's rank banner */}
          {topChild && (
            <View style={[styles.myRankBanner, { borderColor: colors.accentYellow + '40', backgroundColor: colors.accentYellow + '0C' }]}>
              <Feather name="award" size={18} color={colors.accentYellow} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.myRankLabel, { color: colors.accentYellow }]}>
                  {topChild.name} is ranked #{topChild.rank}
                </Text>
                <Text style={styles.myRankSub}>{topChild.score.toLocaleString()} XP · {topChild.streak}d streak</Text>
              </View>
              <Text style={[styles.myRankNum, { color: colors.accentYellow }]}>#{topChild.rank}</Text>
            </View>
          )}

          {/* Podium — top 3 */}
          {!loading && leaderboard.length >= 3 && (
            <View style={styles.podiumRow}>
              {[leaderboard[1], leaderboard[0], leaderboard[2]].map((s, podiumIdx) => {
                const isChild = childIds.has(s.id);
                const heights = [72, 92, 60];
                const medalColor = MEDAL_COLORS[s.rank - 1];
                return (
                  <View key={s.id} style={styles.podiumItem}>
                    <View style={[styles.podiumAvatar, isChild && { borderWidth: 2, borderColor: colors.accentYellow }]}>
                      <Text style={[styles.podiumAvatarText, { color: colors.primary }]}>{initials(s.name)}</Text>
                    </View>
                    <Text style={styles.podiumName} numberOfLines={1}>{s.name.split(' ')[0]}</Text>
                    <Text style={[styles.podiumScore, { color: colors.accentYellow }]}>{s.score.toLocaleString()}</Text>
                    <View style={[styles.podiumBlock, { height: heights[podiumIdx], backgroundColor: medalColor + '28', borderTopLeftRadius: 8, borderTopRightRadius: 8 }]}>
                      <Feather name="award" size={18} color={medalColor} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Full list */}
          <View style={styles.listCard}>
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ paddingVertical: 40 }} />
            ) : leaderboard.length === 0 ? (
              <Text style={styles.empty}>No rankings yet.</Text>
            ) : leaderboard.map((s, i) => {
              const medalColor = MEDAL_COLORS[s.rank - 1];
              const isChild = childIds.has(s.id);
              return (
                <View key={s.id} style={[
                  styles.row,
                  i < leaderboard.length - 1 && styles.rowBorder,
                  isChild && { backgroundColor: colors.accentYellow + '0A' },
                ]}>
                  <View style={[styles.rankBadge, { backgroundColor: medalColor ? medalColor + '22' : colors.borderColor }]}>
                    {s.rank <= 3
                      ? <Feather name="award" size={13} color={medalColor} />
                      : <Text style={[styles.rankNum, { color: colors.textMuted }]}>{s.rank}</Text>}
                  </View>
                  <View style={[styles.avatar, { backgroundColor: isChild ? colors.accentYellow + '25' : colors.primary + '20' }]}>
                    <Text style={[styles.avatarText, { color: isChild ? colors.accentYellow : colors.primary }]}>{initials(s.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.name}>{s.name}</Text>
                      {isChild && (
                        <View style={[styles.youBadge, { backgroundColor: colors.accentYellow + '20', borderColor: colors.accentYellow + '40' }]}>
                          <Text style={[styles.youText, { color: colors.accentYellow }]}>Your child</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.grade}>{s.grade} · {s.streak}d streak · {s.topics} topics</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.score, { color: colors.accentYellow }]}>{s.score.toLocaleString()}</Text>
                    <Text style={styles.xpLabel}>XP</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:         { flex: 1, backgroundColor: c.bgDark },
  content:        { padding: spacing.xl, paddingBottom: 40, gap: spacing.lg },
  myRankBanner:   { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: radius.xl, padding: spacing.lg },
  myRankLabel:    { fontSize: 15, fontWeight: '700' },
  myRankSub:      { fontSize: 12, color: c.textDim, marginTop: 2 },
  myRankNum:      { fontSize: 28, fontWeight: '900' },
  podiumRow:      { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: spacing.md, marginBottom: spacing.sm },
  podiumItem:     { alignItems: 'center', flex: 1, gap: 4 },
  podiumAvatar:   { width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary + '20', alignItems: 'center', justifyContent: 'center' },
  podiumAvatarText: { fontSize: 15, fontWeight: '700' },
  podiumName:     { fontSize: 11, fontWeight: '600', color: c.textMuted, maxWidth: 70, textAlign: 'center' },
  podiumScore:    { fontSize: 12, fontWeight: '700' },
  podiumBlock:    { width: '100%', alignItems: 'center', justifyContent: 'center' },
  listCard:       { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, overflow: 'hidden' },
  row:            { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12, paddingHorizontal: spacing.lg },
  rowBorder:      { borderBottomWidth: 1, borderBottomColor: c.borderColor },
  rankBadge:      { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rankNum:        { fontSize: 13, fontWeight: '700' },
  avatar:         { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText:     { fontSize: 13, fontWeight: '700' },
  name:           { fontSize: 14, fontWeight: '600', color: c.textMain },
  grade:          { fontSize: 11, color: c.textDim, marginTop: 2 },
  youBadge:       { borderWidth: 1, borderRadius: 20, paddingHorizontal: 6, paddingVertical: 2 },
  youText:        { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  score:          { fontSize: 16, fontWeight: '800', letterSpacing: -0.5 },
  xpLabel:        { fontSize: 10, color: c.textDim, fontWeight: '600' },
  empty:          { textAlign: 'center', color: c.textMuted, padding: spacing.xl, fontSize: 13 },
});
