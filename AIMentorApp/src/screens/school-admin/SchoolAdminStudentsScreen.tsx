

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
  curriculum?: string | null;
  status: 'invited' | 'active' | 'inactive' | 'archived';
  joinedAt: string;
  lastActiveAt: string | null;
}

interface StudentDetail extends StudentRow {
  parent: { name: string; email: string; phone?: string } | null;
}

interface StudentEditPatch {
  name?: string;
  grade?: string;
  section?: string;
  admissionNumber?: string;
  parentName?: string;
  parentPhone?: string;
}

type StatusFilter = 'all' | 'invited' | 'active' | 'inactive' | 'archived';
type SortKey = 'name' | 'grade' | 'admissionNumber';

const STATUS_LABEL: Record<string, string> = { invited: 'Invited', active: 'Active', inactive: 'Inactive', archived: 'Archived' };

// Same list/ranges as the student/parent onboarding flow (getGradesForCurriculum
// in OnboardingScreen.tsx) and SchoolAdminAddStudentScreen.tsx's own copy —
// this is a fixed STRUCTURAL fact (an IB school always has exactly PYP/MYP/DP,
// each spanning a fixed grade range), not something derived from who happens
// to be enrolled. Used here to narrow the Grade filter once a specific IB
// program is chosen in the Curriculum filter — e.g. picking "IB PYP" should
// offer Grade 1-5 even if today's roster only has PYP students in Grade 1-3.
function getGradesForCurriculum(curr: string): string[] | null {
  if (curr === 'IB PYP') return ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'];
  if (curr === 'IB MYP') return ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];
  if (curr === 'IB DP') return ['Grade 11', 'Grade 12'];
  return null; // non-IB curricula don't partition grades — use the school's real facet data instead
}

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
  const [curriculumFilter, setCurriculumFilter] = useState('all');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('admissionNumber');
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // The FULL set of Grade/Section/Curriculum values that exist anywhere in
  // the school — fetched from a dedicated facets endpoint, NOT derived from
  // `items`. `items` is one paginated (and possibly filtered) page of the
  // list, so deriving filter options from it silently hides values that
  // exist outside the current page or filter (e.g. "All grades" only showing
  // Grade 6 because that's all that happened to be loaded). Curriculum is a
  // SEPARATE field from Grade (e.g. grade="Grade 3", curriculum="IB PYP") —
  // IB in particular spans PYP/MYP/DP by grade range within one school — so
  // it's its own filter, not folded into the Grade dropdown.
  const [facetGrades, setFacetGrades] = useState<string[]>([]);
  const [facetSections, setFacetSections] = useState<string[]>([]);
  const [facetCurriculums, setFacetCurriculums] = useState<string[]>([]);

  const [promoteOpen, setPromoteOpen] = useState(false);

  const loadFacets = useCallback(async () => {
    if (!user?.email) return;
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/students/facets?adminEmail=${encodeURIComponent(user.email)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFacetGrades(Array.isArray(data.grades) ? data.grades : []);
        setFacetSections(Array.isArray(data.sections) ? data.sections : []);
        setFacetCurriculums(Array.isArray(data.curriculums) ? data.curriculums : []);
      }
    } catch { /* filter dropdowns just stay at their previous values */ }
  }, [user?.email]);

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
      if (curriculumFilter !== 'all') params.set('curriculum', curriculumFilter);
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
  }, [user?.email, query, statusFilter, curriculumFilter, gradeFilter, sectionFilter, sortKey, sortAsc, isArchivedRoute]);

  useFocusEffect(useCallback(() => { load(); loadFacets(); }, [load, loadFacets]));

  // Once a specific IB program is chosen in the Curriculum filter, Grade
  // narrows to that program's fixed range (e.g. IB PYP -> Grade 1-5)
  // regardless of which of those grades already has enrolled students — same
  // reasoning as why Curriculum itself no longer disappears for an empty
  // program (see facets endpoint comment). Declared here (before the effect
  // below that depends on it) rather than down by gradeOptions — a `const`
  // referenced in an earlier statement's dependency array throws
  // "Cannot access before initialization" at render time, not just a lint
  // warning.
  const curriculumGradeRange = useMemo(() => getGradesForCurriculum(curriculumFilter), [curriculumFilter]);

  // If switching the Curriculum filter makes the current Grade selection
  // fall outside that program's range (e.g. Grade 8 selected, then Curriculum
  // switches to "IB PYP" which only spans Grade 1-5), clear it back to "All
  // grades" rather than silently keeping a filter combo with no possible
  // results.
  React.useEffect(() => {
    if (curriculumGradeRange && gradeFilter !== 'all' && !curriculumGradeRange.includes(gradeFilter)) {
      setGradeFilter('all');
    }
  }, [curriculumGradeRange, gradeFilter]);

  const statusOptions = useMemo(() => ([
    { value: 'all', label: 'All statuses' },
    { value: 'invited', label: 'Invited' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'archived', label: 'Archived' },
  ]), []);
  // Grade options normally come from the server, already sorted with
  // curriculum-aware natural order (Grade 2 before Grade 10) — see
  // sortGradeNames in server/services/academicStructure.js. curriculumGradeRange
  // (declared above, near the effect that depends on it) overrides this list
  // once a specific IB program is chosen in the Curriculum filter.
  const gradeOptions = useMemo(() => {
    const list = curriculumGradeRange || facetGrades;
    return [{ value: 'all', label: 'All grades' }, ...list.map((g) => ({ value: g, label: g }))];
  }, [facetGrades, curriculumGradeRange]);
  const sectionOptions = useMemo(() => ([{ value: 'all', label: 'All sections' }, ...facetSections.map((s) => ({ value: s, label: s }))]), [facetSections]);
  // Curriculum (IB PYP / IB MYP / IB DP / CBSE / ...) — a separate filter
  // from Grade, sorted server-side with sortCurriculumNames.
  const curriculumOptions = useMemo(() => ([{ value: 'all', label: 'All curricula' }, ...facetCurriculums.map((c) => ({ value: c, label: c }))]), [facetCurriculums]);

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

  // "Promote Students" — moves the selected students' Grade (and optionally
  // Section) in one write, mirroring applyBulkStatus's fire-and-refresh
  // pattern exactly. Only grade/section change server-side; id, email,
  // admission number, and every other table (assignments, attendance,
  // reports, stats) are untouched — see POST /students/bulk-grade.
  // Returns an error string on failure, or null on success, so the dialog can
  // stay open and show the message instead of silently closing.
  async function applyPromote(targetGrade: string, targetSection: string, studentIds?: string[]): Promise<string | null> {
    const ids = studentIds && studentIds.length > 0 ? studentIds : Array.from(selected);
    if (!user?.email || ids.length === 0) return 'Select at least one student.';
    try {
      const body: any = { studentIds: ids, grade: targetGrade };
      if (targetSection.trim()) body.section = targetSection.trim();
      const res = await fetch(`${SERVER_URL}/school-admin/students/bulk-grade?adminEmail=${encodeURIComponent(user.email)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data?.error || 'Failed to promote selected students.';
      setSelected(new Set());
      setPromoteOpen(false);
      load();
      loadFacets(); // the target grade may be new, or a grade may have emptied out
      return null;
    } catch {
      return 'Failed to promote. Check your connection.';
    }
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

  // Returns an error string on failure, or null on success — lets the drawer
  // keep its edit form open and show the message inline instead of closing.
  async function saveDetailEdits(patch: StudentEditPatch): Promise<string | null> {
    if (!detail || !user?.email) return 'Not ready';
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/students/${detail.id}?adminEmail=${encodeURIComponent(user.email)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data?.error || 'Failed to save changes.';
      await openDetail(detail.id); // refetch so the drawer shows the saved values
      load();                       // refresh the list row too
      return null;
    } catch {
      return 'Failed to save. Check your connection.';
    }
  }

  async function deleteDetailStudent(): Promise<string | null> {
    if (!detail || !user?.email) return 'Not ready';
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/students/${detail.id}?adminEmail=${encodeURIComponent(user.email)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data?.error || 'Failed to delete student.';
      setDetailId(null);
      setDetail(null);
      load();
      return null;
    } catch {
      return 'Failed to delete. Check your connection.';
    }
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
            : facetGrades.length > 0
              ? `${total} student${total === 1 ? '' : 's'} across ${facetGrades.length} grade${facetGrades.length === 1 ? '' : 's'}`
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
                placeholder="Search by name or admission no"
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
            {curriculumOptions.length > 1 && (
              <FilterDropdown label="All curricula" value={curriculumFilter} onChange={setCurriculumFilter} options={curriculumOptions} colors={colors} />
            )}
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

          {selected.size === 0 && !isArchivedRoute && items.length > 0 && (
            <Text style={styles.promoteHint}>
              To promote students to the next grade, select them below, then tap Promote Students.
            </Text>
          )}

          {selected.size > 0 && (
            <View style={styles.bulkBar}>
              <Text style={styles.bulkBarText}>{selected.size} selected</Text>
              <View style={styles.bulkBarActions}>
                <TouchableOpacity style={styles.bulkBtnPrimary} onPress={() => setPromoteOpen(true)}>
                  <Feather name="arrow-up-circle" size={12.5} color="#0B0B0B" />
                  <Text style={styles.bulkBtnPrimaryText}>Promote Students</Text>
                </TouchableOpacity>
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
                <View style={styles.thAdmCol}><SortHeader label="Admission No" sortKey="admissionNumber" /></View>
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
        onSave={saveDetailEdits}
        onDelete={deleteDetailStudent}
      />

      <PromoteDialog
        visible={promoteOpen}
        allStudents={items}
        preselectedIds={Array.from(selected)}
        facetGrades={facetGrades}
        facetSections={facetSections}
        colors={colors}
        onClose={() => setPromoteOpen(false)}
        onConfirm={applyPromote}
      />
    </ScreenLayout>
  );
}

// ── Quick-inspect drawer (view · edit · delete) ─────────────────────────────
function StudentDetailDrawer({ visible, loading, detail, colors, onClose, onChangeStatus, onSave, onDelete }: {
  visible: boolean; loading: boolean; detail: StudentDetail | null; colors: AppColors;
  onClose: () => void; onChangeStatus: (s: 'active' | 'inactive' | 'archived') => void;
  onSave: (patch: StudentEditPatch) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [mode, setMode] = useState<'view' | 'edit' | 'confirmDelete'>('view');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');

  // Editable field buffers.
  const [fName, setFName] = useState('');
  const [fGrade, setFGrade] = useState('');
  const [fSection, setFSection] = useState('');
  const [fAdm, setFAdm] = useState('');
  const [fParentName, setFParentName] = useState('');
  const [fParentPhone, setFParentPhone] = useState('');

  // Reset to view mode + reseed buffers whenever a different student opens.
  React.useEffect(() => {
    setMode('view');
    setErr('');
    if (detail) {
      setFName(detail.name || '');
      setFGrade(detail.grade || '');
      setFSection(detail.section || '');
      setFAdm(detail.admissionNumber || '');
      setFParentName(detail.parent?.name || '');
      setFParentPhone(detail.parent?.phone || '');
    }
  }, [detail?.id]);

  async function handleSave() {
    if (!detail) return;
    setErr('');
    setSaving(true);
    const patch: StudentEditPatch = {
      name: fName.trim(),
      grade: fGrade.trim(),
      section: fSection.trim(),
      admissionNumber: fAdm.trim(),
    };
    // Only send parent fields when a parent is actually linked (the server
    // applies them to that account; with no parent there's nothing to update).
    if (detail.parent) {
      patch.parentName = fParentName.trim();
      patch.parentPhone = fParentPhone.trim();
    }
    const error = await onSave(patch);
    setSaving(false);
    if (error) { setErr(error); return; }
    setMode('view');
  }

  async function handleDelete() {
    setErr('');
    setDeleting(true);
    const error = await onDelete();
    setDeleting(false);
    if (error) { setErr(error); setMode('view'); return; }
    // On success the parent closes the drawer; nothing else to do here.
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.drawerCard}>
          {loading || !detail ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginVertical: 40 }} />
          ) : (
            <>
              <View style={styles.formHeader}>
                <Text style={styles.formTitle} numberOfLines={1}>
                  {mode === 'edit' ? 'Edit Student' : mode === 'confirmDelete' ? 'Delete Student' : detail.name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  {mode === 'view' && (
                    <TouchableOpacity onPress={() => { setErr(''); setMode('edit'); }} accessibilityRole="button" accessibilityLabel="Edit student">
                      <Feather name="edit-2" size={16} color={colors.textHeading} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
                    <Feather name="x" size={18} color={colors.textDim} />
                  </TouchableOpacity>
                </View>
              </View>

              {mode === 'confirmDelete' ? (
                // ── Delete confirmation ──────────────────────────────────
                <View>
                  <Text style={styles.formHint}>
                    This permanently deletes <Text style={{ fontWeight: '700', color: colors.textHeading }}>{detail.name}</Text>'s
                    account and all of their data (progress, assignments, login). This cannot be undone.
                    {'\n\n'}The linked parent account is not deleted. If you only want to hide this student, use Archive instead.
                  </Text>
                  {!!err && <Text style={styles.formError}>{err}</Text>}
                  <View style={styles.formFooter}>
                    <TouchableOpacity style={styles.formCancelBtn} onPress={() => setMode('view')} disabled={deleting}>
                      <Text style={styles.formCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteConfirmBtn} onPress={handleDelete} disabled={deleting}>
                      {deleting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.deleteConfirmText}>Delete permanently</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : mode === 'edit' ? (
                // ── Edit form ────────────────────────────────────────────
                <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
                  <Text style={styles.formSection}>Account</Text>
                  <DetailRow label="Login email" value={detail.email} colors={colors} />
                  <Text style={styles.formHint}>Login email can't be changed here.</Text>

                  <Text style={styles.formLabel}>Student name</Text>
                  <TextInput style={styles.formInput} value={fName} onChangeText={setFName} placeholder="Full name" placeholderTextColor={colors.textDim} />

                  <Text style={styles.formSection}>Academic</Text>
                  <View style={styles.formRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>Grade</Text>
                      <TextInput style={styles.formInput} value={fGrade} onChangeText={setFGrade} placeholder="Grade 3" placeholderTextColor={colors.textDim} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.formLabel}>Section</Text>
                      <TextInput style={styles.formInput} value={fSection} onChangeText={setFSection} placeholder="A" placeholderTextColor={colors.textDim} />
                    </View>
                  </View>
                  <Text style={styles.formLabel}>Admission #</Text>
                  <TextInput style={styles.formInput} value={fAdm} onChangeText={setFAdm} placeholder="TSRA-1001" placeholderTextColor={colors.textDim} autoCapitalize="characters" />

                  <Text style={styles.formSection}>Parent / Guardian</Text>
                  {detail.parent ? (
                    <>
                      <DetailRow label="Email" value={detail.parent.email} colors={colors} />
                      <Text style={styles.formLabel}>Parent name</Text>
                      <TextInput style={styles.formInput} value={fParentName} onChangeText={setFParentName} placeholder="Parent name" placeholderTextColor={colors.textDim} />
                      <Text style={styles.formLabel}>Parent phone</Text>
                      <TextInput style={styles.formInput} value={fParentPhone} onChangeText={setFParentPhone} placeholder="+91 90000 00000" placeholderTextColor={colors.textDim} keyboardType="phone-pad" />
                    </>
                  ) : (
                    <Text style={styles.formHint}>No parent account linked yet.</Text>
                  )}

                  {!!err && <Text style={styles.formError}>{err}</Text>}
                  <View style={styles.formFooter}>
                    <TouchableOpacity style={styles.formCancelBtn} onPress={() => { setErr(''); setMode('view'); }} disabled={saving}>
                      <Text style={styles.formCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.formSubmitBtn} onPress={handleSave} disabled={saving}>
                      {saving ? <ActivityIndicator color="#0B0B0B" size="small" /> : <Text style={styles.formSubmitText}>Save changes</Text>}
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              ) : (
                // ── View mode ────────────────────────────────────────────
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
                      {!!detail.parent.phone && <DetailRow label="Phone" value={detail.parent.phone} colors={colors} />}
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

                  <Text style={[styles.formSection, { color: colors.accentRed }]}>Danger Zone</Text>
                  <TouchableOpacity style={styles.deleteRowBtn} onPress={() => { setErr(''); setMode('confirmDelete'); }} accessibilityRole="button">
                    <Feather name="trash-2" size={14} color={colors.accentRed} />
                    <Text style={styles.deleteRowText}>Delete this student permanently</Text>
                  </TouchableOpacity>
                </ScrollView>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Promote Students (bulk grade/section move) ──────────────────────────────
// Grade labels are curriculum-specific free text (Grade N, Stage N, PYP/MYP/
// DP N, IGCSE, ...) — never a hardcoded list. Target Grade/Section are typed
// (matching how grade/section are stored everywhere else on `users`), with
// the school's existing values offered as one-tap chips for the common case
// of promoting into a grade/section that already exists.
// Pulls the first number out of a grade label ("Grade 4" -> 4). Promotion
// targets are always a MOVE FORWARD, so this is used to drop any grade at or
// below what the selected students are already in from the picker — a Grade 4
// student has no business being offered "Grade 3" as a promotion target.
function gradeNum(g: string | null | undefined): number | null {
  if (!g) return null;
  const m = String(g).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

const IB_PROGRAMS = ['IB PYP', 'IB MYP', 'IB DP'];

// Every grade the school could plausibly promote into — used as the default
// pool of chips before any programme filter narrows it, so the picker never
// falls back to a blank "type it yourself" box.
const ALL_GRADE_CHIPS = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];

function PromoteDialog({ visible, allStudents, preselectedIds, facetGrades, facetSections, colors, onClose, onConfirm }: {
  visible: boolean; allStudents: StudentRow[]; preselectedIds: string[];
  facetGrades: string[]; facetSections: string[]; colors: AppColors;
  onClose: () => void; onConfirm: (targetGrade: string, targetSection: string, studentIds: string[]) => Promise<string | null>;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [targetGrade, setTargetGrade] = useState('');
  const [targetSection, setTargetSection] = useState('');
  const [targetProgram, setTargetProgram] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  React.useEffect(() => {
    if (visible) { setTargetGrade(''); setTargetSection(''); setTargetProgram(''); setErr(''); }
  }, [visible]);

  const selectedStudents = useMemo(() => allStudents.filter((s) => preselectedIds.includes(s.id)), [allStudents, preselectedIds]);
  const selectedCount = selectedStudents.length;

  const currentGrades = useMemo(() => Array.from(new Set(selectedStudents.map((s) => s.grade).filter(Boolean) as string[])), [selectedStudents]);
  const currentSummary = currentGrades.length === 0 ? 'an unset grade'
    : currentGrades.length === 1 ? currentGrades[0]
    : `multiple grades (${currentGrades.join(', ')})`;

  // Highest grade among the selected students — nobody in the batch should be
  // offered a target at or below this, since that's a demotion, not a promotion.
  const maxCurrentGradeNum = useMemo(() => {
    const nums = currentGrades.map(gradeNum).filter((n): n is number => n !== null);
    return nums.length ? Math.max(...nums) : null;
  }, [currentGrades]);

  // Selected students are on an IB curriculum -> the programme chips (IB PYP /
  // IB MYP / IB DP) narrow the grade chips further, since crossing PYP -> MYP
  // at Grade 5 -> 6 is a curriculum change, not just a grade bump. Left
  // unpicked, grade chips default to the union of every IB programme's grades
  // (still filtered to only what's ahead of the student's current grade) so
  // there's always something tappable — never an empty box needing typing.
  const isIBSelection = useMemo(
    () => selectedStudents.some((s) => (s.curriculum || '').toUpperCase().startsWith('IB')),
    [selectedStudents]
  );

  const gradeChoices = useMemo(() => {
    const pool = isIBSelection
      ? (targetProgram ? getGradesForCurriculum(targetProgram) || [] : ALL_GRADE_CHIPS)
      : (facetGrades.length > 0 ? facetGrades : ALL_GRADE_CHIPS);
    if (maxCurrentGradeNum === null) return pool;
    return pool.filter((g) => {
      const n = gradeNum(g);
      return n === null || n > maxCurrentGradeNum;
    });
  }, [isIBSelection, targetProgram, facetGrades, maxCurrentGradeNum]);

  async function handleConfirm() {
    if (!targetGrade.trim()) { setErr('Pick a target grade.'); return; }
    setErr('');
    setSubmitting(true);
    const error = await onConfirm(targetGrade.trim(), targetSection, preselectedIds);
    setSubmitting(false);
    if (error) setErr(error);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.drawerCard}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Promote Students</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={18} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          <Text style={styles.formHint}>
            Currently: {currentGrades.length > 0 ? currentGrades.join(', ') : '—'}
            {' '}({selectedCount} student{selectedCount === 1 ? '' : 's'} selected)
          </Text>

          {isIBSelection && (
            <>
              <Text style={styles.formLabel}>Target programme</Text>
              <View style={styles.chipRow}>
                {IB_PROGRAMS.map((p) => (
                  <Pressable
                    key={p}
                    style={[styles.chip, targetProgram === p && styles.chipActive]}
                    onPress={() => { setTargetProgram(targetProgram === p ? '' : p); setTargetGrade(''); }}
                  >
                    <Text style={[styles.chipText, targetProgram === p && styles.chipTextActive]}>{p}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={styles.formLabel}>Target grade *</Text>
          {gradeChoices.length > 0 ? (
            <View style={styles.chipRow}>
              {gradeChoices.map((g) => (
                <Pressable key={g} style={[styles.chip, targetGrade === g && styles.chipActive]} onPress={() => setTargetGrade(g)}>
                  <Text style={[styles.chipText, targetGrade === g && styles.chipTextActive]}>{g}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.formHint}>No higher grade available for this selection.</Text>
          )}

          <Text style={styles.formLabel}>Target section (optional)</Text>
          {facetSections.length > 0 ? (
            <View style={styles.chipRow}>
              {facetSections.map((s) => (
                <Pressable key={s} style={[styles.chip, targetSection === s && styles.chipActive]} onPress={() => setTargetSection(targetSection === s ? '' : s)}>
                  <Text style={[styles.chipText, targetSection === s && styles.chipTextActive]}>{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <TextInput
              style={styles.formInput}
              value={targetSection}
              onChangeText={setTargetSection}
              placeholder="Leave blank to keep each student's current section"
              placeholderTextColor={colors.textDim}
            />
          )}

          <Text style={styles.formHint}>
            You are promoting {selectedCount} student{selectedCount === 1 ? '' : 's'} from {currentSummary} to{' '}
            {targetGrade.trim() || '—'}{targetSection.trim() ? ` (Section ${targetSection.trim()})` : ''}.
            {'\n'}Only Grade/Section change — student IDs, login, and all learning history/reports are preserved.
          </Text>

          {!!err && <Text style={styles.formError}>{err}</Text>}

          <View style={styles.formFooter}>
            <TouchableOpacity style={styles.formCancelBtn} onPress={onClose} disabled={submitting}>
              <Text style={styles.formCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.formSubmitBtn} onPress={handleConfirm} disabled={submitting || !targetGrade.trim() || selectedCount === 0}>
              {submitting ? <ActivityIndicator color="#0B0B0B" size="small" /> : <Text style={styles.formSubmitText}>Promote {selectedCount} student{selectedCount === 1 ? '' : 's'}</Text>}
            </TouchableOpacity>
          </View>
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
    promoteHint: { fontFamily: fonts.serif, fontSize: 12, color: colors.textDim, marginBottom: spacing.sm, fontStyle: 'italic' },

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
    bulkBtnPrimary: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: colors.accentYellow },
    bulkBtnPrimaryText: { fontFamily: fonts.serif, fontSize: 11.5, fontWeight: '700', color: '#0B0B0B' },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
    chip: { borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
    chipActive: { backgroundColor: colors.accentYellow, borderColor: colors.accentYellow },
    chipText: { fontFamily: fonts.serif, fontSize: 11.5, fontWeight: '600', color: colors.textMuted },
    chipTextActive: { color: '#0B0B0B', fontWeight: '700' },

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

    deleteRowBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
      borderWidth: 1, borderColor: `${colors.accentRed}55`, backgroundColor: `${colors.accentRed}0F`,
      borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 9, marginTop: 2,
    },
    deleteRowText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentRed },
    deleteConfirmBtn: { flex: 1, backgroundColor: colors.accentRed, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center' },
    deleteConfirmText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#fff' },

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
