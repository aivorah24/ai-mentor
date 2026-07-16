/**
 * School Admin People — read-only V1 roster of the admin's own school.
 * The backend (GET /school-admin/people) injects school_id server-side;
 * a TSRA admin can never receive another school's users.
 *
 * Styled as a real data table (Google Admin's Users table as the reference
 * point) on desktop/tablet, falling back to a card list on narrow screens so
 * nothing overflows horizontally. Deliberately NOT copied wholesale: no
 * checkboxes/bulk-action toolbar/"Last sign in" column, since none of that
 * exists in this app yet (V1 is read-only, and there's no last-login
 * tracking) — a dead button or fabricated column would be worse than not
 * having the row. Columns are exactly the real fields the API returns:
 * Name, Email, Role, Grade, Joined.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl, TextInput, Pressable, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useResponsive } from '../../hooks/useResponsive';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface Person {
  id: string;
  name: string;
  email: string;
  role: string;
  grade: string | null;
  joinedAt: string;
}

type RoleTab = 'all' | 'student' | 'teacher' | 'parent';
type SortKey = 'name' | 'email' | 'role' | 'joinedAt';

const ROLE_LABEL: Record<string, string> = { student: 'Student', teacher: 'Teacher', parent: 'Parent', school_admin: 'Admin' };

function isSystemGeneratedStudentEmail(email: string) {
  return String(email || '').toLowerCase().trim().endsWith('@aivorah.student');
}

function roleTint(colors: AppColors, role: string): string {
  if (role === 'teacher') return colors.accentOrange;
  if (role === 'parent') return colors.accentRed;
  if (role === 'school_admin') return colors.accentYellow;
  return colors.primary; // student
}

function formatJoined(iso: string): string {
  try {
    const d = new Date(iso);
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diffDays < 1) return 'Today';
    if (diffDays < 30) return `${diffDays}d ago`;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return '—'; }
}

export default function SchoolAdminPeopleScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const { isMobile } = useResponsive();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<RoleTab>((route?.params?.initialTab as RoleTab) || 'all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);

  const load = useCallback(async () => {
    if (!user?.email) return;
    setError('');
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/people?adminEmail=${encodeURIComponent(user.email)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Failed to load people'); return; }
      setPeople(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed to load people. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.email]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useFocusEffect(useCallback(() => {
    if (route?.params?.initialTab) {
      setTab(route.params.initialTab);
      navigation.setParams({ initialTab: undefined });
    }
  }, [route?.params?.initialTab]));

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  const rows = useMemo(() => {
    let list = people;
    if (tab !== 'all') list = list.filter((p) => p.role === tab);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q));
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') cmp = (a.name || a.email).localeCompare(b.name || b.email);
      else if (sortKey === 'email') cmp = (a.email || '').localeCompare(b.email || '');
      else if (sortKey === 'role') cmp = (a.role || '').localeCompare(b.role || '');
      else if (sortKey === 'joinedAt') cmp = new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
      return sortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [people, tab, query, sortKey, sortAsc]);

  const countFor = (role: RoleTab) => role === 'all' ? people.length : people.filter((p) => p.role === role).length;

  function SortHeader({ label, sortKey: key, style }: { label: string; sortKey: SortKey; style?: any }) {
    const active = sortKey === key;
    return (
      <Pressable
        style={({ hovered }: any) => [
          styles.th, style,
          Platform.OS === 'web' && hovered && styles.thHovered,
        ]}
        onPress={() => toggleSort(key)}
        accessibilityRole="button"
        accessibilityLabel={`Sort by ${label}`}
      >
        <Text style={[styles.thText, active && styles.thTextActive]}>{label}</Text>
        {active && <Feather name={sortAsc ? 'arrow-up' : 'arrow-down'} size={11} color={colors.accentYellow} />}
      </Pressable>
    );
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="People"
          subtitle={`Showing ${tab === 'all' ? 'all people' : `${ROLE_LABEL[tab]}s`.toLowerCase()} in your school`}
          onMenuPress={() => navigation?.openDrawer?.()}
        />
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accentYellow} />}
        >
          <View style={styles.toolbar}>
            <View style={styles.searchBox}>
              <Feather name="search" size={14} color={colors.textDim} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name or email"
                placeholderTextColor={colors.textDim}
                style={styles.searchInput}
                accessibilityLabel="Search people"
              />
            </View>
          </View>
          <View style={styles.tabRow}>
            {(['all', 'student', 'teacher', 'parent'] as RoleTab[]).map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setTab(t)}
                style={[styles.tab, tab === t && styles.tabActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: tab === t }}
              >
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t === 'all' ? 'All' : `${ROLE_LABEL[t]}s`} <Text style={styles.tabCount}>{countFor(t)}</Text>
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {loading ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40 }} />
          ) : error ? (
            <View style={styles.emptyBox}>
              <Feather name="alert-circle" size={28} color={colors.textDim} />
              <Text style={styles.emptyText}>{error}</Text>
              <TouchableOpacity onPress={() => { setLoading(true); load(); }} style={styles.retryBtn} accessibilityRole="button">
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="users" size={28} color={colors.textDim} />
              <Text style={styles.emptyText}>
                {people.length === 0
                  ? 'No one is linked to your school yet. Users appear here once their account is connected to your school.'
                  : 'No one matches your search.'}
              </Text>
            </View>
          ) : isMobile ? (
            // Narrow screens: card list — a wide table would force horizontal scroll.
            rows.map((p) => {
              const tint = roleTint(colors, p.role);
              const hideEmail = p.role === 'student' && isSystemGeneratedStudentEmail(p.email);
              return (
                <View key={p.id} style={styles.card}>
                  <View style={[styles.avatar, { backgroundColor: `${tint}22` }]}>
                    <Text style={[styles.avatarText, { color: tint }]}>{(p.name || p.email || '?').slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.cardName} numberOfLines={1}>{p.name || p.email}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {hideEmail ? (p.grade || 'Student') : `${p.email}${p.grade ? `  ·  ${p.grade}` : ''}`}
                    </Text>
                  </View>
                  <View style={[styles.rolePill, { borderColor: `${tint}55` }]}>
                    <Text style={[styles.rolePillText, { color: tint }]}>{ROLE_LABEL[p.role] || p.role}</Text>
                  </View>
                </View>
              );
            })
          ) : (
            // Desktop/tablet: real sortable table.
            <View style={styles.table}>
              <View style={styles.theadRow}>
                <View style={styles.thNameCol}><SortHeader label="Name" sortKey="name" /></View>
                <View style={styles.thEmailCol}><SortHeader label="Email" sortKey="email" /></View>
                <View style={styles.thRoleCol}><SortHeader label="Role" sortKey="role" /></View>
                <View style={styles.thGradeCol}><Text style={[styles.thText, styles.thStatic]}>Grade</Text></View>
                <View style={styles.thJoinedCol}><SortHeader label="Joined" sortKey="joinedAt" /></View>
              </View>
              {rows.map((p, i) => {
                const tint = roleTint(colors, p.role);
                const hideEmail = p.role === 'student' && isSystemGeneratedStudentEmail(p.email);
                return (
                  <Pressable
                    key={p.id}
                    style={({ hovered }: any) => [
                      styles.tr,
                      i === rows.length - 1 && styles.trLast,
                      Platform.OS === 'web' && hovered && { backgroundColor: colors.cardHover },
                    ]}
                  >
                    <View style={styles.thNameCol}>
                      <View style={styles.nameCell}>
                        <View style={[styles.avatar, { backgroundColor: `${tint}22` }]}>
                          <Text style={[styles.avatarText, { color: tint }]}>{(p.name || p.email || '?').slice(0, 2).toUpperCase()}</Text>
                        </View>
                        <Text style={styles.tdName} numberOfLines={1}>{p.name || '—'}</Text>
                      </View>
                    </View>
                    <View style={styles.thEmailCol}>
                      <Text style={styles.td} numberOfLines={1}>{hideEmail ? '—' : p.email}</Text>
                    </View>
                    <View style={styles.thRoleCol}>
                      <View style={[styles.rolePill, { borderColor: `${tint}55`, alignSelf: 'flex-start' }]}>
                        <Text style={[styles.rolePillText, { color: tint }]}>{ROLE_LABEL[p.role] || p.role}</Text>
                      </View>
                    </View>
                    <View style={styles.thGradeCol}>
                      <Text style={styles.td} numberOfLines={1}>{p.grade || '—'}</Text>
                    </View>
                    <View style={styles.thJoinedCol}>
                      <Text style={styles.td} numberOfLines={1}>{formatJoined(p.joinedAt)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    // A generous max-width (not the old 980, which left large dead space on
    // wide monitors) but still capped — an unbounded table on an ultrawide
    // screen would stretch columns into their own awkward empty gaps.
    content: { padding: spacing.xl, paddingBottom: 60, maxWidth: 1240, width: '100%', alignSelf: 'center' },
    toolbar: { marginBottom: spacing.md },
    searchBox: {
      flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 360,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.sm, paddingHorizontal: 10, height: 36,
    },
    searchInput: { flex: 1, fontFamily: fonts.serif, fontSize: 13, color: colors.textMain, height: '100%' },
    tabRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.xl, flexWrap: 'wrap' },
    tab: {
      paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999,
      borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.cardDark,
    },
    tabActive: { borderColor: colors.accentYellow, backgroundColor: `${colors.accentYellow}1F` },
    tabText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textMuted },
    tabTextActive: { color: colors.textHeading },
    tabCount: { fontSize: 11, color: colors.textDim },

    // ── Table (desktop/tablet) ──────────────────────────────────────────
    table: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, overflow: 'hidden',
    },
    theadRow: {
      flexDirection: 'row', alignItems: 'center',
      borderBottomWidth: 1, borderBottomColor: colors.borderColor,
      backgroundColor: colors.cardHover, paddingVertical: 4,
    },
    th: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.sm },
    thHovered: { backgroundColor: colors.cardDark },
    thText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textDim },
    thTextActive: { color: colors.textHeading },
    thStatic: { paddingVertical: 10, paddingHorizontal: 12 },
    // Name/Email flex to absorb extra width (long values benefit from room);
    // Role/Grade/Joined stay fixed-width so short content never stretches
    // into dead mid-row space — matches how Google Admin's table behaves.
    thNameCol: { flex: 1.6, minWidth: 180 },
    thEmailCol: { flex: 1.4, minWidth: 160 },
    thRoleCol: { width: 130 },
    thGradeCol: { width: 100 },
    thJoinedCol: { width: 110 },
    tr: {
      flexDirection: 'row', alignItems: 'center',
      borderBottomWidth: 1, borderBottomColor: colors.borderColor,
      paddingVertical: 8,
    },
    trLast: { borderBottomWidth: 0 },
    nameCell: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
    td: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted, paddingHorizontal: 12 },
    tdName: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading, flexShrink: 1 },

    // ── Card list (mobile) ───────────────────────────────────────────────
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.sm, paddingVertical: 9, paddingHorizontal: 12, marginBottom: 6,
    },
    cardName: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: colors.textHeading },
    cardMeta: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textMuted, marginTop: 1 },

    avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    avatarText: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '700' },
    rolePill: {
      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
      backgroundColor: colors.cardHover, borderWidth: 1, flexShrink: 0,
    },
    rolePillText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700' },
    emptyBox: { alignItems: 'center', paddingTop: 56, gap: 10, paddingHorizontal: 24 },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
    retryBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderColor },
    retryText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },
  });
}
