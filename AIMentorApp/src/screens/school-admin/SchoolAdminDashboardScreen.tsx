/**
 * School Admin Overview — redesigned to match the approved Claude Design
 * prototype's IA: a stat bar, a "Manage" list (not tiles), Quick Actions,
 * and a Recent Announcements panel. Re-themed to Aivorah's own Inter font
 * and color tokens rather than the prototype's Sora/oklch palette.
 *
 * "Grades & Sections" appears in Manage per the design, but routes to the
 * Coming Soon screen (no backend model for it yet) rather than showing a
 * fabricated count. "Import students" in Quick Actions is disabled for the
 * same reason — the bulk-upload pipeline isn't built.
 *
 * All data from GET /school-admin/overview (server-scoped to the admin's own
 * school_id — see services/adminScope.js). recentAnnouncements is real data
 * already returned by that endpoint, not invented for this redesign.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable, TouchableOpacity, RefreshControl, Platform } from 'react-native';
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

interface RecentAnnouncement {
  id: string;
  title: string;
  severity: string;
  status: 'published' | 'scheduled' | 'draft' | 'archived';
  createdAt: string;
  startsAt: string | null;
}

interface Overview {
  school: { id: string; name: string };
  counts: {
    students: number;
    teachers: number;
    parents: number;
    publishedAnnouncements: number;
    scheduledAnnouncements: number;
    draftAnnouncements: number;
  };
  recentAnnouncements: RecentAnnouncement[];
}

interface ManageRow {
  key: string;
  icon: string;
  title: string;
  caption: string;
  meta?: string;
  onPress: () => void;
}

function announcementStatusLabel(a: RecentAnnouncement) {
  if (a.status === 'scheduled') return 'Scheduled';
  return 'Published';
}

export default function SchoolAdminDashboardScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { isMobile } = useResponsive();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!user?.email) return;
    setError('');
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/overview?adminEmail=${encodeURIComponent(user.email)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Failed to load school overview'); return; }
      setOverview(data);
    } catch {
      setError('Failed to load school overview. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.email]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const activeAnnouncements = (overview?.counts.publishedAnnouncements ?? 0) + (overview?.counts.scheduledAnnouncements ?? 0);

  const manageRows: ManageRow[] = useMemo(() => [
    {
      key: 'students', icon: 'users', title: 'Students', caption: 'Search, filter, and manage every student record.',
      meta: overview ? `${overview.counts.students} students` : undefined,
      onPress: () => navigation.navigate('SchoolAdminStudents'),
    },
    {
      key: 'announcements', icon: 'volume-2', title: 'Announcements', caption: 'Create, schedule, and publish school communication.',
      meta: overview ? `${activeAnnouncements} active` : undefined,
      onPress: () => navigation.navigate('AnnouncementManager'),
    },
    {
      key: 'grades', icon: 'list', title: 'Grades & Sections', caption: "Configure your school's academic structure.",
      onPress: () => navigation.navigate('SchoolAdminGradesSections'),
    },
    {
      key: 'settings', icon: 'settings', title: 'Workspace Settings', caption: 'General information, branding, and access.',
      onPress: () => navigation.navigate('SchoolAdminSettings'),
    },
  ], [overview, activeAnnouncements, navigation]);

  const filteredRows = query.trim()
    ? manageRows.filter((t) => `${t.title} ${t.caption}`.toLowerCase().includes(query.trim().toLowerCase()))
    : manageRows;

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Overview"
          showSearch
          searchPlaceholder="Search people, announcements, or settings"
          onSearchChange={setQuery}
          onMenuPress={() => navigation?.openDrawer?.()}
        />

        <View style={styles.crumbRow}>
          <Text style={styles.crumb}>School Workspace</Text>
          <Text style={styles.crumbSep}>/</Text>
          <Text style={styles.crumbSchool} numberOfLines={1}>{overview?.school?.name || '...'}</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accentYellow} />}
        >
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
          ) : (
            <>
              <Text style={styles.greeting}>{overview?.school?.name || 'Your school'}</Text>
              <Text style={styles.greetingSub}>Manage your school workspace, people, communication, and settings.</Text>

              {overview && (
                <View style={[styles.statBar, isMobile && styles.statBarMobile]}>
                  <StatItem value={overview.counts.students} label="Students" colors={colors} />
                  <View style={styles.statDivider} />
                  <StatItem value={overview.counts.teachers} label="Teachers" colors={colors} />
                  <View style={styles.statDivider} />
                  <StatItem value={overview.counts.parents} label="Parents" colors={colors} />
                  <View style={styles.statDivider} />
                  <StatItem value={activeAnnouncements} label="Active announcements" colors={colors} />
                </View>
              )}

              <View style={[styles.bodyRow, isMobile && styles.bodyRowMobile]}>
                <View style={styles.mainCol}>
                  <Text style={styles.sectionLabel}>MANAGE</Text>
                  {filteredRows.length === 0 ? (
                    <View style={styles.emptyBox}>
                      <Feather name="search" size={26} color={colors.textDim} />
                      <Text style={styles.emptyText}>Nothing matches "{query}"</Text>
                    </View>
                  ) : (
                    <View style={styles.manageList}>
                      {filteredRows.map((row, i) => (
                        <ManageListRow key={row.key} row={row} colors={colors} isLast={i === filteredRows.length - 1} />
                      ))}
                    </View>
                  )}
                </View>

                <View style={[styles.rail, isMobile && styles.railMobile]}>
                  <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
                  <TouchableOpacity
                    style={styles.primaryAction}
                    onPress={() => navigation.navigate('SchoolAdminStudents', { openAdd: true })}
                    accessibilityRole="button"
                  >
                    <Feather name="user-plus" size={14} color="#0B0B0B" />
                    <Text style={styles.primaryActionText}>Add Student</Text>
                  </TouchableOpacity>
                  <RailLink icon="plus" label="Create announcement" colors={colors} onPress={() => navigation.navigate('AnnouncementManager', { openComposer: true })} />
                  <RailLink icon="upload" label="Import students" colors={colors} disabled disabledHint="Coming soon" onPress={() => navigation.navigate('SchoolAdminBulkImport')} />

                  <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>RECENT ANNOUNCEMENTS</Text>
                  {overview && overview.recentAnnouncements.length > 0 ? (
                    <View style={styles.announcementList}>
                      {overview.recentAnnouncements.map((a, i) => (
                        <Pressable
                          key={a.id}
                          onPress={() => navigation.navigate('AnnouncementManager')}
                          style={({ hovered }: any) => [
                            styles.announcementRow,
                            i === overview.recentAnnouncements.length - 1 && styles.announcementRowLast,
                            Platform.OS === 'web' && hovered && { backgroundColor: colors.cardHover },
                          ]}
                        >
                          <Text style={styles.announcementTitle} numberOfLines={1}>{a.title}</Text>
                          <Text style={styles.announcementMeta}>{announcementStatusLabel(a)}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.railEmpty}>No announcements yet.</Text>
                  )}
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

function StatItem({ value, label, colors }: { value: number; label: string; colors: AppColors }) {
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Text style={{ fontFamily: fonts.serif, fontSize: 20, fontWeight: '800', color: colors.textHeading }}>{value}</Text>
      <Text style={{ fontFamily: fonts.serif, fontSize: 11.5, color: colors.textMuted, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

function ManageListRow({ row, colors, isLast }: { row: ManageRow; colors: AppColors; isLast: boolean }) {
  return (
    <Pressable
      onPress={row.onPress}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}. ${row.caption}`}
      style={({ hovered, pressed }: any) => [
        rowStyles.row,
        { borderColor: colors.borderColor },
        isLast && { borderBottomWidth: 0 },
        Platform.OS === 'web' && hovered && { backgroundColor: colors.cardHover },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[rowStyles.icon, { backgroundColor: `${colors.accentYellow}18` }]}>
        <Feather name={row.icon as any} size={17} color={colors.accentYellow} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[rowStyles.title, { color: colors.textHeading }]}>{row.title}</Text>
        <Text style={[rowStyles.caption, { color: colors.textMuted }]} numberOfLines={1}>{row.caption}</Text>
      </View>
      {row.meta && <Text style={[rowStyles.meta, { color: colors.textDim }]}>{row.meta}</Text>}
      <Feather name="chevron-right" size={16} color={colors.textDim} />
    </Pressable>
  );
}

function RailLink({ icon, label, onPress, colors, disabled, disabledHint }: {
  icon: string; label: string; onPress: () => void; colors: AppColors; disabled?: boolean; disabledHint?: string;
}) {
  const styles = tileStyles;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={disabled ? `${label} (coming soon)` : label}
      accessibilityState={{ disabled }}
      style={({ hovered }: any) => [
        styles.railLink,
        Platform.OS === 'web' && hovered && !disabled && { backgroundColor: colors.cardHover },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Feather name={icon as any} size={14} color={colors.textDim} />
      <Text style={[styles.railLinkText, { color: colors.textMuted }]}>{label}</Text>
      {disabled && disabledHint && <Text style={[styles.railLinkHint, { color: colors.textDim }]}>{disabledHint}</Text>}
    </Pressable>
  );
}

const tileStyles = StyleSheet.create({
  railLink: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 8 },
  railLinkText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '500', flex: 1 },
  railLinkHint: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '600' },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1,
  },
  icon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700' },
  caption: { fontFamily: fonts.serif, fontSize: 12, marginTop: 2 },
  meta: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '600', flexShrink: 0 },
});

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    crumbRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
      borderBottomWidth: 1, borderBottomColor: colors.borderColor,
    },
    crumb: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textDim },
    crumbSep: { fontFamily: fonts.serif, fontSize: 12, color: colors.textDim },
    crumbSchool: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.textHeading, flexShrink: 1 },

    content: { padding: spacing.xl, paddingBottom: 60, maxWidth: 1080, width: '100%', alignSelf: 'center' },

    greeting: { fontFamily: fonts.serif, fontSize: 21, fontWeight: '700', color: colors.textHeading },
    greetingSub: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, marginTop: 3 },

    statBar: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xl,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.xl,
    },
    statBarMobile: { flexWrap: 'wrap', rowGap: spacing.md },
    statDivider: { width: 1, height: 28, backgroundColor: colors.borderColor },

    bodyRow: { flexDirection: 'row', gap: 28 },
    bodyRowMobile: { flexDirection: 'column' },
    mainCol: { flex: 1, minWidth: 0 },

    sectionLabel: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, color: colors.textDim, marginBottom: spacing.sm },

    manageList: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, paddingHorizontal: spacing.md,
    },

    rail: { width: 280 },
    railMobile: { width: '100%', marginTop: spacing.xl },
    railEmpty: { fontFamily: fonts.serif, fontSize: 12, color: colors.textDim, paddingHorizontal: 10, paddingVertical: 6 },

    primaryAction: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingVertical: 11, marginBottom: 6,
    },
    primaryActionText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },

    announcementList: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, paddingHorizontal: spacing.md,
    },
    announcementRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderColor, borderRadius: 6 },
    announcementRowLast: { borderBottomWidth: 0 },
    announcementTitle: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textHeading },
    announcementMeta: { fontFamily: fonts.serif, fontSize: 11, color: colors.textDim, marginTop: 2 },

    emptyBox: { alignItems: 'center', paddingTop: 56, gap: 10 },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center' },
    retryBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderColor },
    retryText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },
  });
}
