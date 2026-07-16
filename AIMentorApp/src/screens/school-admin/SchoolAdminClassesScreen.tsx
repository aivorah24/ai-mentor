/**
 * School Admin — Classes. Every non-archived Grade×Section pair from Grades
 * & Sections is a class; each can have one assigned Class Teacher, stored
 * on the same academic_structure overlay so it survives grade/section
 * renames (server/routes/school-admin.js: buildGradesSectionsView).
 *
 * Contract:
 *   GET   /school-admin/classes?adminEmail=
 *        -> { classes: [{ grade, section, studentCount, classTeacherEmail, classTeacherName }] }
 *   GET   /school-admin/teachers?adminEmail=          (for the assign picker)
 *   PATCH /school-admin/grades/:grade/sections/:section/class-teacher?adminEmail=
 *        body { teacherEmail: string | null } -> { ok }
 */
import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, TextInput, Modal, Pressable, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';
import { useToast } from '../../components/common/Toast';

interface ClassRow { grade: string; section: string; studentCount: number; classTeacherEmail: string | null; classTeacherName: string | null; }
interface TeacherOption { id: string; name: string; email: string; teaches: { grade: string }[]; }

function gradeSortKey(name: string): number {
  const n = parseInt(name.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function GradeFilterDropdown({ value, options, onChange, colors, open, onToggle }: {
  value: string; options: string[]; onChange: (v: string) => void; colors: AppColors; open: boolean; onToggle: () => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ position: 'relative' }}>
      <Pressable style={styles.filterTrigger} onPress={onToggle} accessibilityRole="button">
        <Text style={styles.filterTriggerText}>{value || 'All grades'}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textDim} />
      </Pressable>
      {open && (
        <>
          <Pressable style={Platform.select({ web: styles.ddBackdropWeb, default: styles.ddBackdropNative }) as any} onPress={onToggle} />
          <View style={styles.filterMenu}>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
              <Pressable style={({ hovered }: any) => [styles.ddItem, Platform.OS === 'web' && hovered && styles.ddItemHovered]} onPress={() => { onChange(''); onToggle(); }}>
                <Text style={[styles.ddItemText, !value && styles.ddItemTextActive]}>All grades</Text>
                {!value && <Feather name="check" size={13} color={colors.accentYellow} />}
              </Pressable>
              {options.map((g) => (
                <Pressable key={g} style={({ hovered }: any) => [styles.ddItem, Platform.OS === 'web' && hovered && styles.ddItemHovered]} onPress={() => { onChange(g); onToggle(); }}>
                  <Text style={[styles.ddItemText, value === g && styles.ddItemTextActive]}>{g}</Text>
                  {value === g && <Feather name="check" size={13} color={colors.accentYellow} />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </>
      )}
    </View>
  );
}

export default function SchoolAdminClassesScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const { showToast, ToastComponent } = useToast();

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  const [pickerFor, setPickerFor] = useState<ClassRow | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState('');

  const load = useCallback(async () => {
    if (!user?.email) return;
    setError('');
    try {
      const adminQ = `adminEmail=${encodeURIComponent(user.email)}`;
      const [classesRes, teachersRes] = await Promise.all([
        fetch(`${SERVER_URL}/school-admin/classes?${adminQ}`),
        fetch(`${SERVER_URL}/school-admin/teachers?${adminQ}`),
      ]);
      const classesData = await classesRes.json().catch(() => ({}));
      const teachersData = await teachersRes.json().catch(() => ([]));
      if (!classesRes.ok) { setError((classesData as any)?.error || 'Failed to load classes'); return; }
      setClasses(Array.isArray(classesData.classes) ? classesData.classes : []);
      setTeachers(Array.isArray(teachersData) ? teachersData : []);
    } catch {
      setError('Failed to load classes. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const gradeOptions = useMemo(() => {
    const names = Array.from(new Set(classes.map((c) => c.grade)));
    return names.sort((a, b) => gradeSortKey(a) - gradeSortKey(b) || a.localeCompare(b));
  }, [classes]);

  const visibleClasses = useMemo(() => {
    const filtered = gradeFilter ? classes.filter((c) => c.grade === gradeFilter) : classes;
    return [...filtered].sort((a, b) => gradeSortKey(a.grade) - gradeSortKey(b.grade) || a.grade.localeCompare(b.grade) || a.section.localeCompare(b.section));
  }, [classes, gradeFilter]);

  function openPicker(cls: ClassRow) {
    setPickerFor(cls);
    setPickerSearch('');
    setPickerError('');
  }

  const pickerTeachers = useMemo(() => {
    if (!pickerFor) return [];
    const q = pickerSearch.trim().toLowerCase();
    const filtered = teachers.filter((t) => !q || t.name?.toLowerCase().includes(q) || t.email?.toLowerCase().includes(q));
    // Teachers who already teach this grade surface first — most likely picks.
    return [...filtered].sort((a, b) => {
      const aTeaches = (a.teaches || []).some((e) => e.grade === pickerFor.grade) ? 0 : 1;
      const bTeaches = (b.teaches || []).some((e) => e.grade === pickerFor.grade) ? 0 : 1;
      if (aTeaches !== bTeaches) return aTeaches - bTeaches;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [teachers, pickerFor, pickerSearch]);

  async function assignTeacher(teacherEmail: string | null) {
    if (!user?.email || !pickerFor) return;
    setPickerBusy(true);
    setPickerError('');
    try {
      const url = `${SERVER_URL}/school-admin/grades/${encodeURIComponent(pickerFor.grade)}/sections/${encodeURIComponent(pickerFor.section)}/class-teacher?adminEmail=${encodeURIComponent(user.email)}`;
      const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teacherEmail }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPickerError(data?.error || 'Failed to assign class teacher'); return; }
      setPickerFor(null);
      await load();
      showToast({
        title: teacherEmail ? 'Class teacher assigned' : 'Class teacher removed',
        subtitle: `${pickerFor.grade} · Section ${pickerFor.section}`,
        type: 'success',
      });
    } catch {
      setPickerError('Failed to assign class teacher. Check your connection.');
    } finally {
      setPickerBusy(false);
    }
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="Classes" subtitle="Every grade–section pair is a class. Assign a class teacher to each." onMenuPress={() => navigation?.openDrawer?.()} />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <GradeFilterDropdown value={gradeFilter} options={gradeOptions} onChange={setGradeFilter} colors={colors} open={filterOpen} onToggle={() => setFilterOpen((v) => !v)} />
            <Text style={styles.countText}>{visibleClasses.length} class{visibleClasses.length === 1 ? '' : 'es'}</Text>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40 }} />
          ) : error ? (
            <View style={styles.emptyBox}>
              <Feather name="alert-circle" size={26} color={colors.textDim} />
              <Text style={styles.emptyText}>{error}</Text>
              <TouchableOpacity onPress={() => { setLoading(true); load(); }} style={styles.retryBtn}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
            </View>
          ) : visibleClasses.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="layers" size={26} color={colors.textDim} />
              <Text style={styles.emptyText}>No classes yet. Add grades and sections first in Grades & Sections.</Text>
              <TouchableOpacity onPress={() => navigation?.navigate?.('SchoolAdminGradesSections')} style={styles.retryBtn}><Text style={styles.retryText}>Go to Grades & Sections</Text></TouchableOpacity>
            </View>
          ) : (
            <View style={styles.table}>
              <View style={styles.theadRow}>
                <View style={styles.colClass}><Text style={styles.thText}>Class</Text></View>
                <View style={styles.colTeacher}><Text style={styles.thText}>Class Teacher</Text></View>
                <View style={styles.colStudents}><Text style={styles.thText}>Students</Text></View>
                <View style={styles.colAction} />
              </View>
              {visibleClasses.map((c, i) => {
                const key = `${c.grade}::${c.section}`;
                return (
                  <View key={key} style={[styles.tr, i === visibleClasses.length - 1 && styles.trLast]}>
                    <View style={styles.colClass}><Text style={styles.tdStrong} numberOfLines={1}>{c.grade} · Section {c.section}</Text></View>
                    <View style={styles.colTeacher}>
                      {c.classTeacherName
                        ? <Text style={styles.td} numberOfLines={1}>{c.classTeacherName}</Text>
                        : <Text style={styles.tdUnassigned}>Unassigned</Text>}
                    </View>
                    <View style={styles.colStudents}><Text style={styles.td}>{c.studentCount} student{c.studentCount === 1 ? '' : 's'}</Text></View>
                    <View style={styles.colAction}>
                      <TouchableOpacity onPress={() => openPicker(c)} accessibilityRole="button">
                        <Text style={styles.actionLink}>{c.classTeacherName ? 'Change teacher' : 'Assign teacher'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>

      <Modal visible={!!pickerFor} transparent animationType="fade" onRequestClose={() => setPickerFor(null)}>
        <View style={styles.overlay}>
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.pickerTitle}>Assign Class Teacher</Text>
                <Text style={styles.pickerSub}>{pickerFor?.grade} · Section {pickerFor?.section}</Text>
              </View>
              <TouchableOpacity onPress={() => setPickerFor(null)} accessibilityRole="button" accessibilityLabel="Close">
                <Feather name="x" size={18} color={colors.textDim} />
              </TouchableOpacity>
            </View>

            <View style={styles.pickerSearchBar}>
              <Feather name="search" size={14} color={colors.textDim} />
              <TextInput
                style={styles.pickerSearchInput} value={pickerSearch} onChangeText={setPickerSearch}
                placeholder="Search teachers by name or email..." placeholderTextColor={colors.textDim}
              />
            </View>

            {pickerFor?.classTeacherEmail && (
              <TouchableOpacity style={styles.unassignRow} onPress={() => assignTeacher(null)} disabled={pickerBusy} accessibilityRole="button">
                <Feather name="user-x" size={14} color={colors.accentRed || '#F87171'} />
                <Text style={styles.unassignText}>Remove current class teacher</Text>
              </TouchableOpacity>
            )}

            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {pickerTeachers.length === 0 ? (
                <Text style={styles.pickerEmpty}>No teachers match your search.</Text>
              ) : (
                pickerTeachers.map((t) => {
                  const teachesThisGrade = (t.teaches || []).some((e) => e.grade === pickerFor?.grade);
                  const isCurrent = t.email === pickerFor?.classTeacherEmail;
                  return (
                    <TouchableOpacity
                      key={t.id} style={[styles.teacherRow, isCurrent && styles.teacherRowActive]}
                      onPress={() => assignTeacher(t.email)} disabled={pickerBusy} accessibilityRole="button"
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.teacherName} numberOfLines={1}>{t.name}</Text>
                        <Text style={styles.teacherEmail} numberOfLines={1}>{t.email}</Text>
                      </View>
                      {teachesThisGrade && <View style={styles.teachesTag}><Text style={styles.teachesTagText}>Teaches {pickerFor?.grade}</Text></View>}
                      {isCurrent && <Feather name="check" size={16} color={colors.accentYellow} />}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            {pickerBusy && <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 10 }} />}
            {!!pickerError && <Text style={styles.pickerErr}>{pickerError}</Text>}
          </View>
        </View>
      </Modal>
      {ToastComponent}
    </ScreenLayout>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    content: { padding: spacing.xl, paddingBottom: 60, width: '100%', maxWidth: 1100, alignSelf: 'center' },

    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg, gap: 12 },
    filterTrigger: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.cardDark, borderRadius: radius.sm, paddingHorizontal: 14, height: 40, minWidth: 160, justifyContent: 'space-between' },
    filterTriggerText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textHeading },
    countText: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textDim },

    ddBackdropWeb: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 19 },
    ddBackdropNative: { position: 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 19 },
    filterMenu: { position: 'absolute', top: 44, left: 0, minWidth: 200, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 4, zIndex: 21, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
    ddItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 9 },
    ddItemHovered: { backgroundColor: colors.cardHover },
    ddItemText: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted },
    ddItemTextActive: { color: colors.textHeading, fontWeight: '700' },

    table: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, overflow: 'hidden' },
    theadRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, backgroundColor: colors.cardHover, paddingVertical: 10 },
    thText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textDim, paddingHorizontal: 14 },
    tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, paddingVertical: 12 },
    trLast: { borderBottomWidth: 0 },
    colClass: { flex: 1.6, minWidth: 150, paddingHorizontal: 14 },
    colTeacher: { flex: 1.6, minWidth: 140, paddingHorizontal: 14 },
    colStudents: { flex: 1, minWidth: 100, paddingHorizontal: 14 },
    colAction: { width: 140, paddingHorizontal: 14, alignItems: 'flex-end' },
    td: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted },
    tdStrong: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: colors.textHeading },
    tdUnassigned: { fontFamily: fonts.serif, fontSize: 12.5, fontStyle: 'italic', color: colors.textDim },
    actionLink: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },

    emptyBox: { alignItems: 'center', paddingTop: 56, gap: 12, paddingHorizontal: 24 },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 380 },
    retryBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderColor },
    retryText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    pickerCard: { backgroundColor: colors.cardDark, borderRadius: 18, borderWidth: 1, borderColor: colors.borderColor, padding: 22, width: '100%', maxWidth: 460 },
    pickerHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, gap: 10 },
    pickerTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700', color: colors.textHeading },
    pickerSub: { fontFamily: fonts.serif, fontSize: 12, color: colors.textDim, marginTop: 2 },
    pickerSearchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10 },
    pickerSearchInput: { flex: 1, fontFamily: fonts.serif, fontSize: 13, color: colors.textMain },
    unassignRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 4, marginBottom: 6 },
    unassignText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.accentRed || '#F87171' },
    pickerEmpty: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textDim, textAlign: 'center', paddingVertical: 20 },
    teacherRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderRadius: radius.sm },
    teacherRowActive: { backgroundColor: `${colors.accentYellow}14` },
    teacherName: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading },
    teacherEmail: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim, marginTop: 1 },
    teachesTag: { backgroundColor: `${colors.accentYellow}18`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    teachesTagText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', color: colors.accentYellow },
    pickerErr: { fontFamily: fonts.serif, fontSize: 12, color: colors.accentRed, marginTop: 8 },
  });
}
