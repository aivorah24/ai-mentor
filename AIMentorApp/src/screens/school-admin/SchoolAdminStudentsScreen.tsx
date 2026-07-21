

1/**
 * School Admin — Student Administration (V1 write access).
 *
 * Ported from the approved Claude Design prototype ("Aivorah Student
 * Administration.dc.html") but re-themed to Aivorah's own system per explicit
 * instruction: Inter (fonts.serif), existing color tokens, existing card/
 * table conventions from SchoolAdminPeopleScreen — not the prototype's
 * Sora/Source Serif fonts or oklch palette.
 *
 * school_admin is an operational manager (confirmed 2026-07-12), so this
 * screen is real write access, not a read-only oversight view: add a
 * student, change status, bulk status change — all scoped server-side to
 * the admin's own school (GET/POST/PATCH /school-admin/students*).
 *
 * Deliberately NOT built: bulk file import (no upload/validation backend
 * yet — shown as a disabled "Coming soon" affordance, not a dead button),
 * and "Grades & Sections" as an editable entity (no backend model — grade/
 * section stay free-text filters here, matching how they're stored on
 * `users`).
 *
 * Also mounted as SchoolAdminArchivedStudents (school-admin/students/archived)
 * — its own route/URL, not a params-only shortcut into this one, so the
 * sidebar highlight, browser URL, and a hard refresh all stay correct. The
 * component tells the two apart via `route.name` (isArchivedRoute below);
 * see Sidebar.tsx / DrawerContent.tsx for the matching nav-item split.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl, TextInput, Pressable, Platform, Modal } from 'react-native';
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

interface StudentRow {
  id: string;
  name: string;
  email: string;
  admissionNumber: string | null;
  grade: string | null;
  section: string | null;
  status: 'invited' | 'active' | 'inactive' | 'archived';
  joinedAt: string;
  lastActiveAt: string | null;
}

interface StudentDetail extends StudentRow {
  parent: { name: string; email: string } | null;
}

type StatusFilter = 'all' | 'invited' | 'active' | 'inactive' | 'archived';
type SortKey = 'name' | 'grade' | 'admissionNumber';

const STATUS_LABEL: Record<string, string> = { invited: 'Invited', active: 'Active', inactive: 'Inactive', archived: 'Archived' };

// Dedicated semantic status colors — NOT the theme's brand accent tokens.
// colors.accentGreen is actually the muted sage brand color (~#9FB2A4), which
// reads as near-invisible pale grey for a status pill on a white/cream card.
// A status chip needs immediate at-a-glance legibility, so these are fixed,
// theme-independent true green/grey/red hues instead.
function statusTint(colors: AppColors, status: string): string {
  if (status === 'active') return '#2F9E44';
  if (status === 'invited') return colors.accentYellow;
  if (status === 'inactive') return '#6B7280';
  return '#DC2626'; // archived
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

function formatLastActive(iso: string | null): string {
  if (!iso) return 'Never signed in';
  try {
    const d = new Date(iso);
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diffDays < 1) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays} days ago`;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return 'Never signed in'; }
}

// ── Lightweight dropdown filter (web + native) ─────────────────────────────
function FilterDropdown({ label, value, options, onChange, colors }: {
  label: string; value: string; options: { value: string; label: string }[];
  onChange: (v: string) => void; colors: AppColors;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label || label;
  return (
    <View style={{ position: 'relative', zIndex: open ? 20 : 1 }}>
      <Pressable style={styles.ddTrigger} onPress={() => setOpen((o) => !o)} accessibilityRole="button">
        <Text style={styles.ddTriggerText} numberOfLines={1}>{current}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textDim} />
      </Pressable>
      {open && (
        <>
          <Pressable style={styles.ddBackdrop} onPress={() => setOpen(false)} />
          <View style={styles.ddMenu}>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {options.map((o) => (
                <Pressable
                  key={o.value}
                  style={({ hovered }: any) => [styles.ddItem, Platform.OS === 'web' && hovered && styles.ddItemHovered, o.value === value && styles.ddItemActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[styles.ddItemText, o.value === value && styles.ddItemTextActive]}>{o.label}</Text>
                  {o.value === value && <Feather name="check" size={13} color={colors.accentYellow} />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </>
      )}
    </View>
  );
}

export default function SchoolAdminStudentsScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const { isMobile } = useResponsive();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  // SchoolAdminArchivedStudents is its own route/URL (school-admin/students/archived),
  // not a filter applied to the regular Students screen — the route is the
  // source of truth for "archived mode", not runtime params, so a hard
  // refresh on that URL still lands here showing only archived students.
  const isArchivedRoute = route?.name === 'SchoolAdminArchivedStudents';

  const [items, setItems] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(isArchivedRoute ? 'archived' : ((route?.params?.initialStatus as StatusFilter) || 'all'));
  const [gradeFilter, setGradeFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('admissionNumber');
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.email) return;
    setError('');
    try {
      // The archived route always queries status=archived regardless of
      // local statusFilter state — the URL is what decides this, not a
      // dropdown value that could drift from it.
      const effectiveStatus = isArchivedRoute ? 'archived' : statusFilter;
      const params = new URLSearchParams({ adminEmail: user.email, sort: sortKey, dir: sortAsc ? 'asc' : 'desc', status: effectiveStatus, limit: '100' });
      if (query.trim()) params.set('search', query.trim());
      if (gradeFilter !== 'all') params.set('grade', gradeFilter);
      if (sectionFilter !== 'all') params.set('section', sectionFilter);
      const res = await fetch(`${SERVER_URL}/school-admin/students?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Failed to load students'); return; }
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(data.total || 0);
    } catch {
      setError('Failed to load students. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.email, query, statusFilter, gradeFilter, sectionFilter, sortKey, sortAsc, isArchivedRoute]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const grades = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => i.grade && set.add(i.grade));
    return Array.from(set).sort();
  }, [items]);

  const sections = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => i.section && set.add(i.section));
    return Array.from(set).sort();
  }, [items]);

  const statusOptions = useMemo(() => ([
    { value: 'all', label: 'All statuses' },
    { value: 'invited', label: 'Invited' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'archived', label: 'Archived' },
  ]), []);
  const gradeOptions = useMemo(() => ([{ value: 'all', label: 'All grades' }, ...grades.map((g) => ({ value: g, label: g }))]), [grades]);
  const sectionOptions = useMemo(() => ([{ value: 'all', label: 'All sections' }, ...sections.map((s) => ({ value: s, label: s }))]), [sections]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => prev.size === items.length ? new Set() : new Set(items.map((i) => i.id)));
  }

  async function applyBulkStatus(status: 'active' | 'inactive' | 'archived') {
    if (!user?.email || selected.size === 0) return;
    try {
      await fetch(`${SERVER_URL}/school-admin/students/bulk-status?adminEmail=${encodeURIComponent(user.email)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: Array.from(selected), status }),
      });
      setSelected(new Set());
      load();
    } catch { setError('Failed to update selected students.'); }
  }

  async function openDetail(id: string) {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/students/${id}?adminEmail=${encodeURIComponent(user!.email)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setDetail(data);
    } finally { setDetailLoading(false); }
  }

  async function changeDetailStatus(status: 'active' | 'inactive' | 'archived') {
    if (!detail || !user?.email) return;
    await fetch(`${SERVER_URL}/school-admin/students/${detail.id}/status?adminEmail=${encodeURIComponent(user.email)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setDetailId(null);
    setDetail(null);
    load();
  }

  function SortHeader({ label, sortKey: key, style }: { label: string; sortKey: SortKey; style?: any }) {
    const active = sortKey === key;
    return (
      <Pressable
        style={({ hovered }: any) => [styles.th, style, Platform.OS === 'web' && hovered && styles.thHovered]}
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
          title={isArchivedRoute ? 'Archived Students' : 'Students'}
          subtitle={isArchivedRoute
            ? `${total} archived student${total === 1 ? '' : 's'}`
            : grades.length > 0
              ? `${total} student${total === 1 ? '' : 's'} across ${grades.length} grade${grades.length === 1 ? '' : 's'}`
              : `${total} student${total === 1 ? '' : 's'} in your school`}
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
                placeholder="Search by name or student ID"
                placeholderTextColor={colors.textDim}
                style={styles.searchInput}
                accessibilityLabel="Search students"
              />
            </View>
            <TouchableOpacity
              style={styles.importBtn}
              onPress={() => navigation?.navigate?.('SchoolAdminBulkImport')}
              accessibilityRole="button"
            >
              <Feather name="upload" size={14} color={colors.textHeading} />
              <Text style={styles.importBtnText}>Import Students</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={() => navigation.navigate('SchoolAdminAddStudent')} accessibilityRole="button">
              <Feather name="user-plus" size={14} color="#0B0B0B" />
              <Text style={styles.addBtnText}>Add Student</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.filterRow}>
            <FilterDropdown label="All grades" value={gradeFilter} onChange={setGradeFilter} options={gradeOptions} colors={colors} />
            <FilterDropdown label="All sections" value={sectionFilter} onChange={setSectionFilter} options={sectionOptions} colors={colors} />
            {/* Status is fixed to "archived" on this route (see isArchivedRoute) —
                no dropdown to switch away from it, so the URL never drifts
                out of sync with what's on screen. */}
            {!isArchivedRoute && (
              <FilterDropdown label="All statuses" value={statusFilter} onChange={(v) => setStatusFilter(v as StatusFilter)} options={statusOptions} colors={colors} />
            )}
            <Text style={styles.resultsCount}>{total} result{total === 1 ? '' : 's'}</Text>
          </View>

          {selected.size > 0 && (
            <View style={styles.bulkBar}>
              <Text style={styles.bulkBarText}>{selected.size} selected</Text>
              <View style={styles.bulkBarActions}>
                <TouchableOpacity style={styles.bulkBtn} onPress={() => applyBulkStatus('active')}>
                  <Text style={styles.bulkBtnText}>Mark Active</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.bulkBtn} onPress={() => applyBulkStatus('inactive')}>
                  <Text style={styles.bulkBtnText}>Mark Inactive</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.bulkBtnDanger} onPress={() => applyBulkStatus('archived')}>
                  <Text style={styles.bulkBtnDangerText}>Archive</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.bulkBtnGhost} onPress={() => setSelected(new Set())}>
                  <Text style={styles.bulkBtnGhostText}>Clear</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

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
          ) : items.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="users" size={28} color={colors.textDim} />
              <Text style={styles.emptyText}>
                {total === 0
                  ? (isArchivedRoute ? 'No archived students.' : 'No students yet. Add your first student to get started.')
                  : 'No students match your filters.'}
              </Text>
            </View>
          ) : isMobile ? (
            items.map((s) => {
              const tint = statusTint(colors, s.status);
              return (
                <TouchableOpacity key={s.id} style={styles.card} onPress={() => openDetail(s.id)} activeOpacity={0.7}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{(s.name || '?').slice(0, 2).toUpperCase()}</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.cardName} numberOfLines={1}>{s.name}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {[s.grade, s.section, s.admissionNumber].filter(Boolean).join('  ·  ') || '—'}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, { borderColor: `${tint}55`, backgroundColor: `${tint}18` }]}>
                    <Text style={[styles.statusPillText, { color: tint }]}>{STATUS_LABEL[s.status]}</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <View style={styles.table}>
              <View style={styles.theadRow}>
                <View style={styles.thCheckCol}>
                  <Pressable onPress={toggleSelectAll} style={styles.checkbox} accessibilityRole="checkbox" accessibilityLabel="Select all students">
                    <Feather name={selected.size === items.length ? 'check-square' : 'square'} size={15} color={selected.size === items.length ? colors.accentYellow : colors.textDim} />
                  </Pressable>
                </View>
                <View style={styles.thNameCol}><SortHeader label="Student" sortKey="name" /></View>
                <View style={styles.thAdmCol}><SortHeader label="Student ID" sortKey="admissionNumber" /></View>
                <View style={styles.thGradeCol}><SortHeader label="Grade · Section" sortKey="grade" /></View>
                <View style={styles.thStatusCol}><Text style={[styles.thText, styles.thStatic]}>Status</Text></View>
                <View style={styles.thJoinedCol}><Text style={[styles.thText, styles.thStatic]}>Last Active</Text></View>
              </View>
              {items.map((s, i) => {
                const tint = statusTint(colors, s.status);
                const isSel = selected.has(s.id);
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => openDetail(s.id)}
                    style={({ hovered }: any) => [
                      styles.tr, i === items.length - 1 && styles.trLast,
                      Platform.OS === 'web' && hovered && { backgroundColor: colors.cardHover },
                      isSel && { backgroundColor: `${colors.accentYellow}0D` },
                    ]}
                  >
                    <View style={styles.thCheckCol}>
                      <Pressable
                        onPress={(e: any) => { e.stopPropagation?.(); toggleSelect(s.id); }}
                        style={styles.checkbox}
                        accessibilityRole="checkbox"
                        accessibilityLabel={`Select ${s.name}`}
                      >
                        <Feather name={isSel ? 'check-square' : 'square'} size={15} color={isSel ? colors.accentYellow : colors.textDim} />
                      </Pressable>
                    </View>
                    <View style={styles.thNameCol}>
                      <View style={styles.nameCell}>
                        <View style={styles.avatar}><Text style={styles.avatarText}>{(s.name || '?').slice(0, 2).toUpperCase()}</Text></View>
                        <View style={{ minWidth: 0, flexShrink: 1 }}>
                          <Text style={styles.tdName} numberOfLines={1}>{s.name || '—'}</Text>
                          <Text style={styles.tdEmail} numberOfLines={1}>{s.email}</Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.thAdmCol}>
                      <Text style={styles.td} numberOfLines={1}>{s.admissionNumber || '—'}</Text>
                    </View>
                    <View style={styles.thGradeCol}>
                      <Text style={styles.td} numberOfLines={1}>{[s.grade, s.section].filter(Boolean).join(' · ') || '—'}</Text>
                    </View>
                    <View style={styles.thStatusCol}>
                      <View style={[styles.statusPill, { borderColor: `${tint}55`, backgroundColor: `${tint}18`, alignSelf: 'flex-start' }]}>
                        <Text style={[styles.statusPillText, { color: tint }]}>{STATUS_LABEL[s.status]}</Text>
                      </View>
                    </View>
                    <View style={styles.thJoinedCol}>
                      <Text style={styles.td} numberOfLines={1}>{formatLastActive(s.lastActiveAt)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>

      <StudentDetailDrawer
        visible={!!detailId}
        loading={detailLoading}
        detail={detail}
        colors={colors}
        onClose={() => { setDetailId(null); setDetail(null); }}
        onChangeStatus={changeDetailStatus}
      />
    </ScreenLayout>
  );
}

// ── Quick-inspect drawer ────────────────────────────────────────────────────
function StudentDetailDrawer({ visible, loading, detail, colors, onClose, onChangeStatus }: {
  visible: boolean; loading: boolean; detail: StudentDetail | null; colors: AppColors;
  onClose: () => void; onChangeStatus: (s: 'active' | 'inactive' | 'archived') => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.drawerCard}>
          {loading || !detail ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginVertical: 40 }} />
          ) : (
            <>
              <View style={styles.formHeader}>
                <Text style={styles.formTitle}>{detail.name}</Text>
                <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
                  <Feather name="x" size={18} color={colors.textDim} />
                </TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
                <Text style={styles.formSection}>Account</Text>
                <DetailRow label="Login email" value={detail.email} colors={colors} />
                <DetailRow label="Status" value={STATUS_LABEL[detail.status]} colors={colors} />
                <DetailRow label="Last active" value={formatLastActive(detail.lastActiveAt)} colors={colors} />

                <Text style={styles.formSection}>Academic</Text>
                <DetailRow label="Grade" value={detail.grade || '—'} colors={colors} />
                <DetailRow label="Section" value={detail.section || '—'} colors={colors} />
                <DetailRow label="Admission #" value={detail.admissionNumber || '—'} colors={colors} />
                <DetailRow label="Joined" value={formatJoined(detail.joinedAt)} colors={colors} />

                <Text style={styles.formSection}>Parent / Guardian</Text>
                {detail.parent ? (
                  <>
                    <DetailRow label="Name" value={detail.parent.name} colors={colors} />
                    <DetailRow label="Email" value={detail.parent.email} colors={colors} />
                  </>
                ) : (
                  <Text style={styles.formHint}>No parent account linked yet.</Text>
                )}

                <Text style={styles.formSection}>Quick Actions</Text>
                <View style={styles.drawerActions}>
                  {detail.status !== 'active' && (
                    <TouchableOpacity style={styles.bulkBtn} onPress={() => onChangeStatus('active')}>
                      <Text style={styles.bulkBtnText}>Mark Active</Text>
                    </TouchableOpacity>
                  )}
                  {detail.status !== 'inactive' && (
                    <TouchableOpacity style={styles.bulkBtn} onPress={() => onChangeStatus('inactive')}>
                      <Text style={styles.bulkBtnText}>Mark Inactive</Text>
                    </TouchableOpacity>
                  )}
                  {detail.status !== 'archived' && (
                    <TouchableOpacity style={styles.bulkBtnDanger} onPress={() => onChangeStatus('archived')}>
                      <Text style={styles.bulkBtnDangerText}>Archive</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function DetailRow({ label, value, colors }: { label: string; value: string; colors: AppColors }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 }}>
      <Text style={{ fontFamily: fonts.serif, fontSize: 12.5, color: colors.textDim }}>{label}</Text>
      <Text style={{ fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textHeading }} selectable>{value}</Text>
    </View>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    content: { padding: spacing.xl, paddingBottom: 60, width: '100%' },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
    searchBox: {
      flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, maxWidth: 360,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.sm, paddingHorizontal: 10, height: 36,
    },
    searchInput: { flex: 1, fontFamily: fonts.serif, fontSize: 13, color: colors.textMain, height: '100%' },
    addBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: colors.accentYellow, borderRadius: radius.sm,
      paddingHorizontal: 14, height: 36,
    },
    addBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: '#0B0B0B' },
    importBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.sm, paddingHorizontal: 14, height: 36,
    },
    importBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.textHeading },

    filterRow: { flexDirection: 'row', gap: 10, marginBottom: spacing.lg, flexWrap: 'wrap', alignItems: 'center', zIndex: 10, position: 'relative' },
    resultsCount: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textDim, marginLeft: 'auto' },

    ddTrigger: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      minWidth: 140, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.cardDark,
      borderRadius: radius.sm, paddingHorizontal: 12, height: 36,
    },
    ddTriggerText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textHeading, flexShrink: 1 },
    ddBackdrop: Platform.select({
      web: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 19 },
      default: { position: 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 19 },
    }) as any,
    ddMenu: {
      position: 'absolute', top: 40, left: 0, minWidth: 180, backgroundColor: colors.cardDark,
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 4,
      zIndex: 21, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
      // maxHeight must live here, not just on the inner ScrollView — an
      // absolutely-positioned, auto-sized container won't clip a long list
      // on web based on a child's maxHeight alone.
      maxHeight: 260, overflow: 'hidden',
    },
    ddItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 9 },
    ddItemHovered: { backgroundColor: colors.cardHover },
    ddItemActive: { backgroundColor: `${colors.accentYellow}14` },
    ddItemText: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted },
    ddItemTextActive: { color: colors.textHeading, fontWeight: '700' },

    bulkBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: `${colors.accentYellow}14`, borderWidth: 1, borderColor: `${colors.accentYellow}40`,
      borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 10, marginBottom: spacing.md,
    },
    bulkBarText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.textHeading },
    bulkBarActions: { flexDirection: 'row', gap: 8 },
    bulkBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.cardDark },
    bulkBtnText: { fontFamily: fonts.serif, fontSize: 11.5, fontWeight: '700', color: colors.textMuted },
    bulkBtnDanger: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: `${colors.accentRed}55`, backgroundColor: `${colors.accentRed}14` },
    bulkBtnDangerText: { fontFamily: fonts.serif, fontSize: 11.5, fontWeight: '700', color: colors.accentRed },
    bulkBtnGhost: { paddingHorizontal: 10, paddingVertical: 7 },
    bulkBtnGhostText: { fontFamily: fonts.serif, fontSize: 11.5, fontWeight: '600', color: colors.textDim },

    // ── Table ───────────────────────────────────────────────────────────
    table: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, overflow: 'hidden', zIndex: 1, position: 'relative' },
    theadRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, backgroundColor: colors.cardHover, paddingVertical: 4 },
    th: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.sm },
    thHovered: { backgroundColor: colors.cardDark },
    thText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textDim },
    thTextActive: { color: colors.textHeading },
    thStatic: { paddingVertical: 10, paddingHorizontal: 12 },
    thCheckCol: { width: 40, alignItems: 'center' },
    // Proportional flex on every column mirrors the Claude design's HTML
    // <table width:100%> auto-layout: all columns scale together and the row
    // always fills its container edge-to-edge, so collapsing/expanding the
    // sidebar just rescales the columns instead of leaving a trailing gap or
    // ballooning one column. Student is the widest (flex 3); minWidths keep
    // things readable when the viewport is narrow.
    thNameCol: { flex: 3, minWidth: 200 },
    thAdmCol: { flex: 1.2, minWidth: 90 },
    thGradeCol: { flex: 1.3, minWidth: 110 },
    thStatusCol: { flex: 1, minWidth: 90 },
    thJoinedCol: { flex: 1.5, minWidth: 120 },
    tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, paddingVertical: 8 },
    trLast: { borderBottomWidth: 0 },
    checkbox: { padding: 4 },
    nameCell: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
    td: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted, paddingHorizontal: 12 },
    tdName: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading, flexShrink: 1 },
    tdEmail: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim, marginTop: 1 },

    // ── Mobile cards ────────────────────────────────────────────────────
    card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 9, paddingHorizontal: 12, marginBottom: 6 },
    cardName: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: colors.textHeading },
    cardMeta: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textMuted, marginTop: 1 },

    avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: `${colors.primary}22` },
    avatarText: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '700', color: colors.primary },
    statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, flexShrink: 0 },
    statusPillText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700' },

    emptyBox: { alignItems: 'center', paddingTop: 56, gap: 10, paddingHorizontal: 24 },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
    retryBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderColor },
    retryText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },

    // ── Modals ──────────────────────────────────────────────────────────
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    formCard: { backgroundColor: colors.cardDark, borderRadius: 20, borderWidth: 1, borderColor: colors.borderColor, padding: 24, width: '100%', maxWidth: 460 },
    drawerCard: { backgroundColor: colors.cardDark, borderRadius: 20, borderWidth: 1, borderColor: colors.borderColor, padding: 24, width: '100%', maxWidth: 420 },
    formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    formTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '700', color: colors.textHeading, flexShrink: 1 },
    formSection: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.textDim, marginTop: 16, marginBottom: 8 },
    formRow: { flexDirection: 'row', gap: 12 },
    formLabel: { fontFamily: fonts.serif, fontSize: 11.5, fontWeight: '600', color: colors.textMuted, marginBottom: 5, marginTop: 8 },
    formInput: {
      fontFamily: fonts.serif, fontSize: 13, color: colors.textMain,
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm,
      paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.bgDark,
    },
    formHint: { fontFamily: fonts.serif, fontSize: 11, color: colors.textDim, marginTop: 6, lineHeight: 16 },
    formError: { fontFamily: fonts.serif, fontSize: 12, color: colors.accentRed, marginTop: 12 },
    formFooter: { flexDirection: 'row', gap: 10, marginTop: 18 },
    formCancelBtn: { flex: 1, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center' },
    formCancelText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textMuted },
    formSubmitBtn: { flex: 1, backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center' },
    formSubmitText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },

    drawerActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },

    credCard: { backgroundColor: colors.cardDark, borderRadius: 20, borderWidth: 1, borderColor: colors.borderColor, padding: 26, width: '100%', maxWidth: 380, alignItems: 'center', gap: 4 },
    credIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentGreen, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    credTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '700', color: colors.textHeading },
    credSub: { fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted, textAlign: 'center', lineHeight: 17, marginBottom: 12 },
    credRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.borderColor },
    credLabel: { fontFamily: fonts.serif, fontSize: 12, color: colors.textDim },
    credValue: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: colors.textHeading },
    credDoneBtn: { marginTop: 16, backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 28 },
    credDoneText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },
  });
}
