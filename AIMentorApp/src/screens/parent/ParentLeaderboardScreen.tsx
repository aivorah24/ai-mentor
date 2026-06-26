import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, useWindowDimensions } from 'react-native';
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

type Scope = 'school' | 'grade' | 'curriculum' | 'overall';
const TABS: { key: Scope; label: string; icon: any }[] = [
  { key: 'school',     label: 'School',     icon: 'home' },
  { key: 'grade',      label: 'Grade',      icon: 'layers' },
  { key: 'curriculum', label: 'Curriculum', icon: 'book-open' },
  { key: 'overall',    label: 'Overall',    icon: 'star' },
];

const MEDAL_COLORS = ['#E8B923', '#9BB0C9', '#CD7F32']; // gold, silver, bronze

function initials(name: string) {
  return name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function ParentLeaderboardScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const wide = width >= 980;

  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChildIdx, setSelectedChildIdx] = useState(0);
  const [tab, setTab] = useState<Scope>('school');

  const childIds = useMemo(() => new Set(children.map(c => c.id)), [children]);
  const selectedChild = children[selectedChildIdx];
  const gold = colors.accentYellow;

  const fetchLeaderboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const child = children[selectedChildIdx];
      const enc = encodeURIComponent;
      let params = '?limit=500'; // show ALL students, not just top 20
      if (child) {
        if (tab === 'school') {
          if (child.school) params += `&school=${enc(child.school)}`;
        } else if (tab === 'grade') {
          if (child.grade)  params += `&grade=${enc(child.grade)}`;
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

  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(user.email)}/children`)
      .then(r => r.ok ? r.json() : [])
      .then((data: Child[]) => { if (Array.isArray(data)) setChildren(data); })
      .catch(() => {});
  }, [user?.email]);

  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);
  useFocusEffect(useCallback(() => { fetchLeaderboard(); }, [fetchLeaderboard]));

  const selectedEntry = leaderboard.find(s => s.id === selectedChild?.id) ?? null;
  const aboveEntry = selectedEntry ? leaderboard.find(e => e.rank === selectedEntry.rank - 1) : null;
  const progressPct = selectedEntry
    ? (selectedEntry.rank === 1 ? 1 : (aboveEntry && aboveEntry.score > 0 ? Math.min(selectedEntry.score / aboveEntry.score, 1) : 0))
    : 0;

  const podium = !loading && leaderboard.length >= 3 ? [leaderboard[1], leaderboard[0], leaderboard[2]] : null;

  // ── Right-side "Your Rank" card ─────────────────────────────────────────────
  const rankCard = selectedEntry ? (
    <View style={styles.rankCard}>
      <View style={styles.trophyCircle}><Feather name="award" size={26} color={gold} /></View>
      <Text style={styles.rankCardTitle}>You're doing great!</Text>
      <Text style={styles.rankCardSub}>Keep the momentum and {selectedChild?.name?.split(' ')[0]} will climb higher.</Text>
      <View style={styles.rankCardBox}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.rankCardBoxLabel}>Their Rank</Text>
          <Text style={[styles.rankCardBoxRank, { color: gold }]}>#{selectedEntry.rank}</Text>
        </View>
        {selectedEntry.rank === 1 ? (
          <Text style={[styles.rankCardProgressTxt, { color: gold }]}>Top of the board! 🏆</Text>
        ) : (
          <>
            <Text style={styles.rankCardProgressTxt}>
              {selectedEntry.score.toLocaleString()} / {aboveEntry?.score.toLocaleString() ?? '—'} XP to reach #{selectedEntry.rank - 1}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(progressPct * 100)}%`, backgroundColor: gold }]} />
            </View>
          </>
        )}
      </View>
      <Text style={styles.rankCardFoot}>Keep learning, keep growing!</Text>
    </View>
  ) : !loading && selectedChild ? (
    <View style={styles.rankCard}>
      <View style={styles.trophyCircle}><Feather name="award" size={26} color={colors.textDim} /></View>
      <Text style={styles.rankCardTitle}>Not ranked yet</Text>
      <Text style={styles.rankCardSub}>{selectedChild.name?.split(' ')[0]} isn't on this board yet — completing lessons earns XP to appear here.</Text>
    </View>
  ) : null;

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="Leaderboard" subtitle="See how your child ranks among their peers" onMenuPress={() => navigation.openDrawer()} />
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchLeaderboard(true)} tintColor={colors.primary} />}
        >
          {/* Top bar: child selector + school chip */}
          <View style={styles.topBar}>
            {children.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }} style={{ flex: 1 }}>
                {children.map((c, i) => {
                  const active = i === selectedChildIdx;
                  return (
                    <TouchableOpacity key={c.id} onPress={() => setSelectedChildIdx(i)} activeOpacity={0.8}
                      style={[styles.childChip, active && { backgroundColor: gold + '20', borderColor: gold }]}>
                      <View style={[styles.childChipAvatar, { backgroundColor: active ? gold + '30' : colors.primary + '20' }]}>
                        <Text style={[styles.childChipInitials, { color: active ? gold : colors.primary }]}>{initials(c.name)}</Text>
                      </View>
                      <View>
                        <Text style={[styles.childChipName, active && { color: gold }]}>{c.name.split(' ')[0]}</Text>
                        {!!c.grade && <Text style={styles.childChipGrade}>{c.grade}</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : <View style={{ flex: 1 }} />}
            {!!selectedChild?.school && (
              <View style={styles.schoolChip}>
                <Feather name="home" size={13} color={gold} />
                <Text style={styles.schoolChipText} numberOfLines={1}>{selectedChild.school}</Text>
              </View>
            )}
          </View>

          {/* Scope tabs */}
          <View style={styles.tabsRow}>
            {TABS.map(t => {
              const active = t.key === tab;
              return (
                <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} activeOpacity={0.8}
                  style={[styles.tab, active && { backgroundColor: gold + '1A', borderColor: gold + '55' }]}>
                  <Feather name={t.icon} size={13} color={active ? gold : colors.textMuted} />
                  <Text style={[styles.tabText, { color: active ? gold : colors.textMuted }]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Two-column on wide screens */}
          <View style={[styles.columns, !wide && { flexDirection: 'column' }]}>
            <View style={{ flex: 1, gap: spacing.lg }}>
              {/* Podium */}
              {podium && (
                <View style={styles.podiumRow}>
                  {podium.map((s, idx) => {
                    const isFirst = idx === 1;
                    const isChild = childIds.has(s.id);
                    const medalColor = MEDAL_COLORS[s.rank - 1];
                    return (
                      <View key={s.id} style={[
                        styles.podiumCard,
                        isFirst && { borderColor: gold, backgroundColor: gold + '12', transform: [{ translateY: -8 }] },
                        isChild && !isFirst && { borderColor: gold + '66' },
                      ]}>
                        <View style={[styles.medalBadge, { backgroundColor: medalColor }]}>
                          <Text style={styles.medalNum}>{s.rank}</Text>
                        </View>
                        <View style={[styles.podiumAvatar, { borderColor: isFirst ? gold : colors.borderColor }]}>
                          <Text style={[styles.podiumAvatarText, { color: isFirst ? gold : colors.primary }]}>{initials(s.name)}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.podiumName} numberOfLines={1}>{s.name}</Text>
                          <Text style={[styles.podiumScore, { color: gold }]}>{s.score.toLocaleString()} XP</Text>
                        </View>
                        <Feather name="award" size={20} color={medalColor} />
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Table */}
              <View style={styles.tableCard}>
                <View style={styles.tableHead}>
                  <Text style={[styles.thRank]}>Rank</Text>
                  <Text style={[styles.thStudent]}>Student</Text>
                  {wide && <Text style={styles.thGrade}>Grade</Text>}
                  <Text style={styles.thXp}>XP Earned</Text>
                  <Text style={styles.thStreak}>Streak</Text>
                </View>
                {loading ? (
                  <ActivityIndicator color={colors.primary} style={{ paddingVertical: 40 }} />
                ) : leaderboard.length === 0 ? (
                  <Text style={styles.empty}>No rankings in this view yet.</Text>
                ) : leaderboard.map((s, i) => {
                  const medalColor = MEDAL_COLORS[s.rank - 1];
                  const isChild = childIds.has(s.id);
                  return (
                    <View key={s.id} style={[styles.tr, i < leaderboard.length - 1 && styles.trBorder, isChild && { backgroundColor: gold + '0E' }]}>
                      <View style={styles.thRank}>
                        <View style={[styles.rankBadge, { backgroundColor: medalColor ? medalColor + '26' : 'transparent' }]}>
                          {s.rank <= 3
                            ? <Feather name="award" size={13} color={medalColor} />
                            : <Text style={[styles.rankNum, { color: colors.textMuted }]}>{s.rank}</Text>}
                        </View>
                      </View>
                      <View style={[styles.thStudent, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }]}>
                        <View style={[styles.avatar, { backgroundColor: isChild ? gold + '25' : colors.primary + '20' }]}>
                          <Text style={[styles.avatarText, { color: isChild ? gold : colors.primary }]}>{initials(s.name)}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                            {isChild && (
                              <View style={[styles.youBadge, { backgroundColor: gold + '20', borderColor: gold + '40' }]}>
                                <Text style={[styles.youText, { color: gold }]}>Your child</Text>
                              </View>
                            )}
                          </View>
                          {!wide && <Text style={styles.gradeSmall}>{s.grade}</Text>}
                        </View>
                      </View>
                      {wide && <Text style={styles.thGrade}><Text style={styles.gradeCell}>{s.grade}</Text></Text>}
                      <View style={styles.thXp}><Text style={[styles.xpCell, { color: gold }]}>{s.score.toLocaleString()}</Text></View>
                      <View style={[styles.thStreak, { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }]}>
                        <Feather name="zap" size={12} color={colors.accentOrange} />
                        <Text style={styles.streakCell}>{s.streak}d</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Right rank card */}
            {wide ? <View style={{ width: 300 }}>{rankCard}</View> : rankCard}
          </View>
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:         { flex: 1, backgroundColor: c.bgDark },
  content:        { padding: spacing.xl, paddingBottom: 40, gap: spacing.lg },
  topBar:         { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  childChip:      { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: c.cardDark },
  childChipAvatar:{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  childChipInitials: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700' },
  childChipName:  { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: c.textMain },
  childChipGrade: { fontFamily: fonts.serif, fontSize: 10, color: c.textDim },
  schoolChip:     { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 9, backgroundColor: c.cardDark, maxWidth: 220 },
  schoolChipText: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: c.textMain },
  tabsRow:        { flexDirection: 'row', gap: spacing.sm },
  tab:            { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, paddingVertical: 10 },
  tabText:        { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700' },
  columns:        { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },

  // Podium
  podiumRow:      { flexDirection: 'row', alignItems: 'stretch', gap: spacing.md, paddingTop: 10 },
  podiumCard:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.md },
  medalBadge:     { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  medalNum:       { fontFamily: fonts.serif, fontSize: 11, fontWeight: '900', color: '#0B0B0B' },
  podiumAvatar:   { width: 40, height: 40, borderRadius: 20, borderWidth: 2, backgroundColor: c.primary + '18', alignItems: 'center', justifyContent: 'center' },
  podiumAvatarText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700' },
  podiumName:     { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: c.textMain },
  podiumScore:    { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', marginTop: 1 },

  // Table
  tableCard:      { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, overflow: 'hidden' },
  tableHead:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.borderColor, backgroundColor: c.bgDark + '80' },
  thRank:         { width: 54, fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5 },
  thStudent:      { flex: 1, fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5 },
  thGrade:        { width: 90, fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5 },
  thXp:           { width: 96, fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right' },
  thStreak:       { width: 72, fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right' },
  tr:             { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: spacing.lg },
  trBorder:       { borderBottomWidth: 1, borderBottomColor: c.borderColor },
  rankBadge:      { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rankNum:        { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700' },
  avatar:         { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarText:     { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700' },
  name:           { fontFamily: fonts.serif, fontSize: 14, fontWeight: '600', color: c.textMain, flexShrink: 1 },
  gradeSmall:     { fontFamily: fonts.serif, fontSize: 11, color: c.textDim, marginTop: 1 },
  gradeCell:      { fontFamily: fonts.serif, fontSize: 13, color: c.textMuted, fontWeight: '600' },
  xpCell:         { fontFamily: fonts.serif, fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  streakCell:     { fontFamily: fonts.serif, fontSize: 13, color: c.textMuted, fontWeight: '700' },
  youBadge:       { borderWidth: 1, borderRadius: 20, paddingHorizontal: 6, paddingVertical: 2 },
  youText:        { fontFamily: fonts.serif, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  empty:          { textAlign: 'center', color: c.textMuted, padding: spacing.xl, fontFamily: fonts.serif, fontSize: 13 },

  // Right rank card
  rankCard:       { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center', gap: 8 },
  trophyCircle:   { width: 56, height: 56, borderRadius: 28, backgroundColor: c.accentYellow + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  rankCardTitle:  { fontFamily: fonts.serif, fontSize: 16, fontWeight: '800', color: c.textMain },
  rankCardSub:    { fontFamily: fonts.serif, fontSize: 12, color: c.textMuted, textAlign: 'center', lineHeight: 18 },
  rankCardBox:    { alignSelf: 'stretch', backgroundColor: c.bgDark, borderRadius: radius.lg, padding: spacing.md, gap: 8, marginTop: 8 },
  rankCardBoxLabel:{ fontFamily: fonts.serif, fontSize: 12, color: c.textMuted, fontWeight: '600' },
  rankCardBoxRank:{ fontFamily: fonts.serif, fontSize: 18, fontWeight: '900' },
  rankCardProgressTxt: { fontFamily: fonts.serif, fontSize: 11, color: c.textDim },
  progressTrack:  { height: 7, borderRadius: 4, backgroundColor: c.borderColor, overflow: 'hidden' },
  progressFill:   { height: '100%', borderRadius: 4 },
  rankCardFoot:   { fontFamily: fonts.serif, fontSize: 11, color: c.textDim, marginTop: 4 },
});
