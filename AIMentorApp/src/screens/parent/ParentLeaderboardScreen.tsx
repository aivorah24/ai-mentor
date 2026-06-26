import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { spacing, radius, fonts } from '../../theme';
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

interface Child { id: string; name: string; grade?: string; school?: string; curriculum?: string; }

type Scope = 'grade' | 'school' | 'curriculum' | 'overall';
const TABS: { key: Scope; label: string; icon: any }[] = [
  { key: 'grade',      label: 'Grade',      icon: 'layers' },
  { key: 'school',     label: 'School',     icon: 'home' },
  { key: 'curriculum', label: 'Curriculum', icon: 'book-open' },
  { key: 'overall',    label: 'Overall',    icon: 'star' },
];

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
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChildIdx, setSelectedChildIdx] = useState(0);
  const [tab, setTab] = useState<Scope>('grade');

  const childIds = useMemo(() => new Set(children.map(c => c.id)), [children]);
  const selectedChild = children[selectedChildIdx];

  const fetchLeaderboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const child = children[selectedChildIdx];
      const enc = encodeURIComponent;
      let params = '?limit=20';
      if (child) {
        if (tab === 'grade') {
          if (child.grade)  params += `&grade=${enc(child.grade)}`;
          if (child.school) params += `&school=${enc(child.school)}`;
        } else if (tab === 'school') {
          if (child.school) params += `&school=${enc(child.school)}`;
        } else if (tab === 'curriculum') {
          if (child.curriculum) params += `&curriculum=${enc(child.curriculum)}`;
        }
        // 'overall' → no filters
      }
      const res = await fetch(`${SERVER_URL}/student/leaderboard${params}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setLeaderboard(data);
      }
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [children, selectedChildIdx, tab]);

  // Load children (with grade/school/curriculum) once
  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(user.email)}/children`)
      .then(r => r.ok ? r.json() : [])
      .then((data: Child[]) => { if (Array.isArray(data)) setChildren(data); })
      .catch(() => {});
  }, [user?.email]);

  // Refetch whenever the scope (tab) or selected child changes
  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);
  // And on screen focus
  useFocusEffect(useCallback(() => { fetchLeaderboard(); }, [fetchLeaderboard]));

  const selectedEntry = leaderboard.find(s => s.id === selectedChild?.id) ?? null;
  const scopeLabel = tab === 'grade'      ? `${selectedChild?.grade ?? ''}${selectedChild?.school ? ' · ' + selectedChild.school : ''}`
                   : tab === 'school'     ? (selectedChild?.school || 'Your school')
                   : tab === 'curriculum' ? (selectedChild?.curriculum || 'Curriculum')
                   : 'All students';

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="Leaderboard" subtitle="See how your child ranks among their peers" onMenuPress={() => navigation.openDrawer()} />
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchLeaderboard(true)} tintColor={colors.primary} />}
        >
          {/* Child selector — only when more than one child */}
          {children.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {children.map((c, i) => {
                const active = i === selectedChildIdx;
                return (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => setSelectedChildIdx(i)}
                    activeOpacity={0.8}
                    style={[styles.childChip, active && { backgroundColor: colors.accentYellow + '20', borderColor: colors.accentYellow }]}
                  >
                    <View style={[styles.childChipAvatar, { backgroundColor: active ? colors.accentYellow + '30' : colors.primary + '20' }]}>
                      <Text style={[styles.childChipInitials, { color: active ? colors.accentYellow : colors.primary }]}>{initials(c.name)}</Text>
                    </View>
                    <View>
                      <Text style={[styles.childChipName, active && { color: colors.accentYellow }]}>{c.name.split(' ')[0]}</Text>
                      {!!c.grade && <Text style={styles.childChipGrade}>{c.grade}</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Scope tabs */}
          <View style={styles.tabsRow}>
            {TABS.map(t => {
              const active = t.key === tab;
              return (
                <TouchableOpacity
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  activeOpacity={0.8}
                  style={[styles.tab, active && { backgroundColor: colors.accentYellow + '1A', borderColor: colors.accentYellow + '55' }]}
                >
                  <Feather name={t.icon} size={13} color={active ? colors.accentYellow : colors.textMuted} />
                  <Text style={[styles.tabText, { color: active ? colors.accentYellow : colors.textMuted }]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.scopeCaption}>{scopeLabel}</Text>

          {/* Selected child's rank banner */}
          {selectedEntry && (
            <View style={[styles.myRankBanner, { borderColor: colors.accentYellow + '40', backgroundColor: colors.accentYellow + '0C' }]}>
              <Feather name="award" size={18} color={colors.accentYellow} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.myRankLabel, { color: colors.accentYellow }]}>
                  {selectedEntry.name} is ranked #{selectedEntry.rank}
                </Text>
                <Text style={styles.myRankSub}>{selectedEntry.score.toLocaleString()} XP · {selectedEntry.streak}d streak</Text>
              </View>
              <Text style={[styles.myRankNum, { color: colors.accentYellow }]}>#{selectedEntry.rank}</Text>
            </View>
          )}
          {!loading && selectedChild && !selectedEntry && (
            <View style={[styles.myRankBanner, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
              <Feather name="award" size={18} color={colors.textDim} />
              <Text style={[styles.myRankSub, { flex: 1 }]}>{selectedChild.name} isn't in the top 20 for this view yet — keep learning to climb up!</Text>
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
              <Text style={styles.empty}>No rankings in this view yet.</Text>
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
  childChip:      { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: c.cardDark },
  childChipAvatar:{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  childChipInitials: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700' },
  childChipName:  { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: c.textMain },
  childChipGrade: { fontFamily: fonts.serif, fontSize: 10, color: c.textDim },
  tabsRow:        { flexDirection: 'row', gap: spacing.sm },
  tab:            { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, paddingVertical: 9 },
  tabText:        { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700' },
  scopeCaption:   { fontFamily: fonts.serif, fontSize: 12, color: c.textDim, marginTop: -spacing.sm, marginLeft: 2 },
  myRankBanner:   { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: radius.xl, padding: spacing.lg },
  myRankLabel:    { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700' },
  myRankSub:      { fontFamily: fonts.serif, fontSize: 12, color: c.textDim, marginTop: 2 },
  myRankNum:      { fontFamily: fonts.serif, fontSize: 28, fontWeight: '900' },
  podiumRow:      { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: spacing.md, marginBottom: spacing.sm },
  podiumItem:     { alignItems: 'center', flex: 1, gap: 4 },
  podiumAvatar:   { width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary + '20', alignItems: 'center', justifyContent: 'center' },
  podiumAvatarText: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700' },
  podiumName:     { fontFamily: fonts.serif, fontSize: 11, fontWeight: '600', color: c.textMuted, maxWidth: 70, textAlign: 'center' },
  podiumScore:    { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700' },
  podiumBlock:    { width: '100%', alignItems: 'center', justifyContent: 'center' },
  listCard:       { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, overflow: 'hidden' },
  row:            { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12, paddingHorizontal: spacing.lg },
  rowBorder:      { borderBottomWidth: 1, borderBottomColor: c.borderColor },
  rankBadge:      { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rankNum:        { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700' },
  avatar:         { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText:     { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700' },
  name:           { fontFamily: fonts.serif, fontSize: 14, fontWeight: '600', color: c.textMain },
  grade:          { fontFamily: fonts.serif, fontSize: 11, color: c.textDim, marginTop: 2 },
  youBadge:       { borderWidth: 1, borderRadius: 20, paddingHorizontal: 6, paddingVertical: 2 },
  youText:        { fontFamily: fonts.serif, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  score:          { fontFamily: fonts.serif, fontSize: 16, fontWeight: '800', letterSpacing: -0.5 },
  xpLabel:        { fontFamily: fonts.serif, fontSize: 10, color: c.textDim, fontWeight: '600' },
  empty:          { textAlign: 'center', color: c.textMuted, padding: spacing.xl, fontFamily: fonts.serif, fontSize: 13 },
});
