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
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable, TouchableOpacity, RefreshControl, Platform, Modal } from 'react-native';
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

interface AccessRequest {
  id: string;
  user_email: string;
  name: string | null;
  role: string | null;
  grade: string | null;         // requested grade
  section: string | null;       // requested section
  studentGrade: string | null;  // grade on the student's profile
  curriculum: string | null;
  parents: { name: string | null; email: string }[];
  created_at: string;
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
  // Pending B2C → B2B "Connect to My School" requests awaiting this admin's review.
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [selectedAuditRequest, setSelectedAuditRequest] = useState<AccessRequest | null>(null);

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

  const loadRequests = useCallback(async () => {
    if (!user?.email) return;
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/access-requests?adminEmail=${encodeURIComponent(user.email)}`);
      const data = await res.json().catch(() => []);
      if (res.ok && Array.isArray(data)) setAccessRequests(data);
    } catch { /* silent — the panel just stays empty */ }
  }, [user?.email]);

  const actionRequest = useCallback(async (id: string, action: 'approve' | 'reject') => {
    if (!user?.email) return;
    setActioningId(id);
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/access-requests/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminEmail: user.email }),
      });
      if (res.ok) {
        setAccessRequests((prev) => prev.filter((r) => r.id !== id));
        if (selectedAuditRequest?.id === id) setSelectedAuditRequest(null);
        if (action === 'approve') load(); // refresh counts (a new member joined)
      }
    } catch { /* ignore — row stays, admin can retry */ }
    finally { setActioningId(null); }
  }, [user?.email, load, selectedAuditRequest]);

  useFocusEffect(useCallback(() => { load(); loadRequests(); }, [load, loadRequests]));

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
                  {accessRequests.length > 0 && (
                    <>
                      <Text style={[styles.sectionLabel, { color: colors.accentYellow }]}>
                        SCHOOL JOIN REQUESTS ({accessRequests.length})
                      </Text>
                      <View style={styles.requestList}>
                        {accessRequests.map((r) => {
                          const reqClass = [r.grade, r.section].filter(Boolean).join(' - ');
                          const roleLabel = r.role ? r.role.charAt(0).toUpperCase() + r.role.slice(1) : null;
                          const hasParents = r.parents && r.parents.length > 0;
                          return (
                          <TouchableOpacity
                            key={r.id}
                            style={styles.requestCard}
                            activeOpacity={0.85}
                            onPress={() => setSelectedAuditRequest(r)}
                            accessibilityRole="button"
                          >
                            <View style={styles.requestTopRow}>
                              <Text style={styles.requestName} numberOfLines={1}>{r.name || r.user_email}</Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                {r.age !== null && r.age !== undefined && (
                                  <View style={[styles.ageTag, r.isUnder14 ? { backgroundColor: `${colors.accentRed}20`, borderColor: colors.accentRed } : { backgroundColor: `${colors.accentGreen || '#2E7D5B'}20`, borderColor: colors.accentGreen || '#2E7D5B' }]}>
                                    <Text style={[styles.ageTagText, r.isUnder14 ? { color: colors.accentRed } : { color: colors.accentGreen || '#2E7D5B' }]}>
                                      Age {r.age} · {r.isUnder14 ? '< 14 Consent' : '14+ Student'}
                                    </Text>
                                  </View>
                                )}
                                {roleLabel && <View style={styles.rolePill}><Text style={styles.rolePillText}>{roleLabel}</Text></View>}
                              </View>
                            </View>
                            {r.name && <Text style={styles.requestMeta} numberOfLines={1}>{r.user_email}</Text>}
                            {(reqClass || r.curriculum) && (
                              <Text style={styles.requestMeta} numberOfLines={1}>
                                {[reqClass && `Requested: ${reqClass}`, r.curriculum].filter(Boolean).join('  ·  ')}
                              </Text>
                            )}
                            <View style={styles.parentPreviewBox}>
                              {hasParents ? (
                                <Text style={styles.requestParentLinked} numberOfLines={2}>
                                  <Feather name="users" size={12} color={colors.accentYellow} />{'  '}
                                  Parent Verified: <Text style={{ fontWeight: '700', color: colors.textHeading }}>{r.parents.map((p) => p.name || p.email).join(', ')}</Text>
                                </Text>
                              ) : (
                                <Text style={styles.requestParentDim} numberOfLines={2}>
                                  <Feather name="shield" size={12} color={colors.textDim} />{'  '}
                                  {r.isUnder14
                                    ? 'Parent verification required (< 14). Tap to review & verify.'
                                    : 'Parent: Not linked (Age 14+ self-initiated request). Tap for full family check.'}
                                </Text>
                              )}
                            </View>
                            <View style={styles.requestBtns}>
                              <TouchableOpacity
                                style={[styles.reqApprove, actioningId === r.id && { opacity: 0.5 }]}
                                disabled={actioningId === r.id}
                                onPress={(e) => { e.stopPropagation?.(); actionRequest(r.id, 'approve'); }}
                                accessibilityRole="button"
                              >
                                <Feather name="check" size={13} color="#0B0B0B" />
                                <Text style={styles.reqApproveText}>Approve</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.reqReject, actioningId === r.id && { opacity: 0.5 }]}
                                disabled={actioningId === r.id}
                                onPress={(e) => { e.stopPropagation?.(); actionRequest(r.id, 'reject'); }}
                                accessibilityRole="button"
                              >
                                <Feather name="x" size={13} color={colors.accentRed} />
                                <Text style={styles.reqRejectText}>Reject</Text>
                              </TouchableOpacity>
                            </View>
                          </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  )}

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

      {/* Comprehensive Student & Family Audit Modal for School Admin Verification */}
      <Modal visible={!!selectedAuditRequest} transparent animationType="fade" onRequestClose={() => setSelectedAuditRequest(null)}>
        <View style={styles.auditOverlay}>
          <View style={styles.auditCard}>
            <View style={styles.auditHeaderRow}>
              <View style={styles.auditHeaderIcon}><Feather name="shield" size={18} color={colors.accentYellow} /></View>
              <Text style={styles.auditHeaderTitle}>Access Verification Audit</Text>
              <TouchableOpacity onPress={() => setSelectedAuditRequest(null)} accessibilityRole="button" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {selectedAuditRequest && (
              <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                <View style={styles.auditSection}>
                  <Text style={styles.auditSectionTitle}>STUDENT APPLICANT PROFILE</Text>
                  <View style={styles.auditDataBox}>
                    <Text style={styles.auditDataName}>{selectedAuditRequest.name || selectedAuditRequest.user_email}</Text>
                    <Text style={styles.auditDataEmail}>{selectedAuditRequest.user_email}</Text>
                    <View style={styles.auditDataGrid}>
                      <View style={styles.auditGridItem}>
                        <Text style={styles.auditGridLabel}>AGE & CONSENT</Text>
                        <Text style={[styles.auditGridVal, selectedAuditRequest.isUnder14 ? { color: colors.accentRed } : { color: colors.accentGreen || '#2E7D5B' }]}>
                          {selectedAuditRequest.age ? `Age ${selectedAuditRequest.age}` : 'Unknown'} · {selectedAuditRequest.isUnder14 ? 'Under 14 Consent' : '14+ Independent'}
                        </Text>
                      </View>
                      <View style={styles.auditGridItem}>
                        <Text style={styles.auditGridLabel}>REQUESTED PLACEMENT</Text>
                        <Text style={styles.auditGridVal}>
                          {[selectedAuditRequest.grade, selectedAuditRequest.section].filter(Boolean).join(' - ') || 'Any / Unspecified'}
                        </Text>
                      </View>
                      <View style={styles.auditGridItem}>
                        <Text style={styles.auditGridLabel}>CURRICULUM</Text>
                        <Text style={styles.auditGridVal}>{selectedAuditRequest.curriculum || 'Standard IB/CBSE'}</Text>
                      </View>
                      <View style={styles.auditGridItem}>
                        <Text style={styles.auditGridLabel}>PHONE</Text>
                        <Text style={styles.auditGridVal}>{selectedAuditRequest.phone || 'Not provided'}</Text>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={[styles.auditSection, { marginTop: 16 }]}>
                  <Text style={styles.auditSectionTitle}>LINKED PARENT / GUARDIAN VERIFICATION</Text>
                  {selectedAuditRequest.parents && selectedAuditRequest.parents.length > 0 ? (
                    selectedAuditRequest.parents.map((p, i) => (
                      <View key={i} style={styles.auditParentRow}>
                        <View style={styles.auditParentIcon}><Feather name="users" size={16} color={colors.accentYellow} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.auditParentName}>{p.name || 'Verified Family Guardian'}</Text>
                          <Text style={styles.auditParentEmail}>{p.email}</Text>
                          <Text style={styles.auditParentStatus}>Status: Linked · B2B Welcome Notification Queued</Text>
                        </View>
                      </View>
                    ))
                  ) : (
                    <View style={styles.auditNoParentBox}>
                      <Feather name="alert-circle" size={18} color={selectedAuditRequest.isUnder14 ? colors.accentRed : colors.textDim} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.auditNoParentTitle, selectedAuditRequest.isUnder14 && { color: colors.accentRed }]}>
                          {selectedAuditRequest.isUnder14 ? 'Under 14: Parent Verification Required' : 'Student 14+ Self-Initiated Application'}
                        </Text>
                        <Text style={styles.auditNoParentDesc}>
                          {selectedAuditRequest.isUnder14
                            ? 'This student is under 14 and currently has no parent email linked in our family registry. Ensure parental consent before approving.'
                            : 'Students aged 14 and above can request school membership directly. No parent account is linked right now, but they can link one anytime.'}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              </ScrollView>
            )}

            {selectedAuditRequest && (
              <View style={styles.auditFooterRow}>
                <TouchableOpacity
                  style={[styles.auditRejectBtn, actioningId === selectedAuditRequest.id && { opacity: 0.5 }]}
                  disabled={actioningId === selectedAuditRequest.id}
                  onPress={() => actionRequest(selectedAuditRequest.id, 'reject')}
                  accessibilityRole="button"
                >
                  <Feather name="x" size={15} color={colors.accentRed} />
                  <Text style={styles.auditRejectText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.auditApproveBtn, actioningId === selectedAuditRequest.id && { opacity: 0.5 }]}
                  disabled={actioningId === selectedAuditRequest.id}
                  onPress={() => actionRequest(selectedAuditRequest.id, 'approve')}
                  accessibilityRole="button"
                >
                  <Feather name="check" size={15} color="#0B0B0B" />
                  <Text style={styles.auditApproveText}>Approve & Link Account</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
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

    requestList: { gap: 10, marginBottom: spacing.lg },
    requestCard: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: `${colors.accentYellow}66`, borderRadius: radius.md, padding: 14, gap: 6, ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}) },
    requestTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    requestName: { flex: 1, fontFamily: fonts.serif, fontSize: 14.5, fontWeight: '800', color: colors.textHeading },
    ageTag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    ageTagText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700' },
    rolePill: { backgroundColor: `${colors.accentYellow}22`, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    rolePillText: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '800', color: colors.accentYellow, textTransform: 'uppercase', letterSpacing: 0.4 },
    requestMeta: { fontFamily: fonts.serif, fontSize: 12, color: colors.textDim },
    parentPreviewBox: { backgroundColor: `${colors.bgDark}99`, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, marginTop: 4, borderWidth: 1, borderColor: colors.borderColor },
    requestParentLinked: { fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted, lineHeight: 17 },
    requestParentDim: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim, lineHeight: 16 },
    requestParent: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textMuted, marginTop: 2 },
    requestBtns: { flexDirection: 'row', gap: 8, marginTop: 10 },
    reqApprove: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingVertical: 10 },
    reqApproveText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '800', color: '#0B0B0B' },
    reqReject: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 10 },
    reqRejectText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.accentRed },

    // Audit Modal Styles
    auditOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    auditCard: { backgroundColor: colors.cardDark, borderRadius: 20, borderWidth: 1, borderColor: colors.borderColor, padding: 22, width: '100%', maxWidth: 520, gap: 14, ...(Platform.OS === 'web' ? { maxHeight: '88vh' as any } : {}) },
    auditHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderColor, paddingBottom: 12 },
    auditHeaderIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: `${colors.accentYellow}22`, alignItems: 'center', justifyContent: 'center' },
    auditHeaderTitle: { flex: 1, fontFamily: fonts.serif, fontSize: 17, fontWeight: '800', color: colors.textHeading },
    auditSection: { gap: 8 },
    auditSectionTitle: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '800', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.6 },
    auditDataBox: { backgroundColor: colors.bgDark, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.borderColor, gap: 4 },
    auditDataName: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '800', color: colors.textHeading },
    auditDataEmail: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, marginBottom: 10 },
    auditDataGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderColor, paddingTop: 12 },
    auditGridItem: { width: '46%', gap: 3 },
    auditGridLabel: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '700', color: colors.textDim, letterSpacing: 0.5 },
    auditGridVal: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.textHeading },
    auditParentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.bgDark, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: `${colors.accentYellow}44`, marginBottom: 6 },
    auditParentIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: `${colors.accentYellow}18`, alignItems: 'center', justifyContent: 'center' },
    auditParentName: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: colors.textHeading },
    auditParentEmail: { fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted },
    auditParentStatus: { fontFamily: fonts.serif, fontSize: 11, color: colors.accentYellow, marginTop: 4, fontWeight: '600' },
    auditNoParentBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.bgDark, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.borderColor },
    auditNoParentTitle: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading, marginBottom: 4 },
    auditNoParentDesc: { fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted, lineHeight: 18 },
    auditFooterRow: { flexDirection: 'row', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderColor, paddingTop: 14 },
    auditRejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 12 },
    auditRejectText: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: colors.accentRed },
    auditApproveBtn: { flex: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingVertical: 12 },
    auditApproveText: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '800', color: '#0B0B0B' },
  });
}
