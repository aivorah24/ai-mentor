/**
 * School Admin — Grades & Sections (managed view over academic structure).
 *
 * Student data (users.grade / users.section) is the source of truth for what
 * grades/sections exist and their live counts; a thin overlay on the school
 * (schools.academic_structure) persists structure students don't imply yet
 * (empty sections, freshly added grades, archive flags). The two are merged
 * server-side — this screen just renders and mutates that merged view.
 *
 * Contract:
 *   GET   /school-admin/grades-sections?adminEmail=
 *   POST  /school-admin/grades                    { name }
 *   POST  /school-admin/grades/:grade/sections    { name }
 *   PATCH /school-admin/grades/:grade             { name }  (rename grade — cascades)
 *   PATCH /school-admin/grades/:grade/archive     { archived }
 *   -> all mutations return { ok, grades: [...] }
 */
import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, TextInput, Modal, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface SectionRow { name: string; archived: boolean; studentCount: number; }
interface GradeRow { name: string; archived: boolean; sections: SectionRow[]; unassignedCount: number; totalStudents: number; }

// A single text-prompt modal reused for Add Grade / Add Section / Rename.
type PromptState =
  | { kind: 'addGrade' }
  | { kind: 'addSection'; grade: string }
  | { kind: 'renameGrade'; grade: string }
  | null;

export default function SchoolAdminGradesSectionsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const [prompt, setPrompt] = useState<PromptState>(null);
  const [promptValue, setPromptValue] = useState('');
  const [promptError, setPromptError] = useState('');
  const [promptBusy, setPromptBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user?.email) return;
    setError('');
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/grades-sections?adminEmail=${encodeURIComponent(user.email)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Failed to load grades & sections'); return; }
      setGrades(Array.isArray(data.grades) ? data.grades : []);
    } catch {
      setError('Failed to load grades & sections. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openPrompt(state: PromptState, initial = '') {
    setPrompt(state);
    setPromptValue(initial);
    setPromptError('');
  }

  async function submitPrompt() {
    if (!user?.email || !prompt) return;
    const name = promptValue.trim();
    if (!name) { setPromptError('Please enter a name.'); return; }
    setPromptBusy(true);
    setPromptError('');
    try {
      let url = '';
      let method: 'POST' | 'PATCH' = 'POST';
      const adminQ = `adminEmail=${encodeURIComponent(user.email)}`;
      if (prompt.kind === 'addGrade') {
        url = `${SERVER_URL}/school-admin/grades?${adminQ}`;
      } else if (prompt.kind === 'addSection') {
        url = `${SERVER_URL}/school-admin/grades/${encodeURIComponent(prompt.grade)}/sections?${adminQ}`;
      } else if (prompt.kind === 'renameGrade') {
        url = `${SERVER_URL}/school-admin/grades/${encodeURIComponent(prompt.grade)}?${adminQ}`;
        method = 'PATCH';
      }
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPromptError(data?.error || 'Something went wrong.'); return; }
      if (Array.isArray(data.grades)) setGrades(data.grades);
      setPrompt(null);
      setPromptValue('');
    } catch {
      setPromptError('Something went wrong. Check your connection.');
    } finally {
      setPromptBusy(false);
    }
  }

  async function toggleArchiveGrade(grade: GradeRow) {
    if (!user?.email) return;
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/grades/${encodeURIComponent(grade.name)}/archive?adminEmail=${encodeURIComponent(user.email)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !grade.archived }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.grades)) setGrades(data.grades);
    } catch { /* silent — the row just won't change */ }
  }

  const visibleGrades = useMemo(() => grades.filter((g) => showArchived || !g.archived), [grades, showArchived]);
  const archivedCount = useMemo(() => grades.filter((g) => g.archived).length, [grades]);
  const promptTitle = prompt?.kind === 'addGrade' ? 'Add Grade'
    : prompt?.kind === 'addSection' ? `Add Section to ${prompt.grade}`
    : prompt?.kind === 'renameGrade' ? `Rename ${prompt.grade}` : '';
  const promptPlaceholder = prompt?.kind === 'addSection' ? 'e.g. B' : prompt?.kind === 'addGrade' ? 'e.g. Grade 7' : 'New name';

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Grades & Sections"
          subtitle="Configure your school's academic structure. Grades and sections are fully configurable."
          onMenuPress={() => navigation?.openDrawer?.()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            {archivedCount > 0 ? (
              <TouchableOpacity style={styles.ghostBtn} onPress={() => setShowArchived((v) => !v)} accessibilityRole="button">
                <Feather name={showArchived ? 'eye-off' : 'archive'} size={13} color={colors.textMuted} />
                <Text style={styles.ghostBtnText}>{showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}</Text>
              </TouchableOpacity>
            ) : <View />}
            <TouchableOpacity style={styles.addBtn} onPress={() => openPrompt({ kind: 'addGrade' })} accessibilityRole="button">
              <Feather name="plus" size={15} color="#0B0B0B" />
              <Text style={styles.addBtnText}>Add Grade</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40 }} />
          ) : error ? (
            <View style={styles.emptyBox}>
              <Feather name="alert-circle" size={26} color={colors.textDim} />
              <Text style={styles.emptyText}>{error}</Text>
              <TouchableOpacity onPress={() => { setLoading(true); load(); }} style={styles.retryBtn}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
            </View>
          ) : visibleGrades.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="layers" size={26} color={colors.textDim} />
              <Text style={styles.emptyText}>No grades yet. Add your first grade to define your school's structure.</Text>
            </View>
          ) : (
            <View style={styles.table}>
              {visibleGrades.map((grade, gi) => (
                <View key={grade.name} style={[styles.gradeRow, gi === visibleGrades.length - 1 && styles.gradeRowLast, grade.archived && styles.gradeRowArchived]}>
                  <View style={styles.gradeNameCol}>
                    <Text style={styles.gradeName}>{grade.name}</Text>
                    {grade.archived && <View style={styles.archivedTag}><Text style={styles.archivedTagText}>Archived</Text></View>}
                    <Text style={styles.gradeTotal}>{grade.totalStudents} student{grade.totalStudents === 1 ? '' : 's'}</Text>
                  </View>

                  <View style={styles.chipsCol}>
                    {grade.sections.length === 0 && grade.unassignedCount === 0 ? (
                      <Text style={styles.noSections}>No sections yet</Text>
                    ) : (
                      <>
                        {grade.sections.map((sec) => (
                          <View key={sec.name} style={[styles.chip, sec.archived && styles.chipArchived]}>
                            <Text style={styles.chipText}>Section {sec.name}</Text>
                            <Text style={styles.chipCount}>· {sec.studentCount} student{sec.studentCount === 1 ? '' : 's'}</Text>
                          </View>
                        ))}
                        {grade.unassignedCount > 0 && (
                          <View style={[styles.chip, styles.chipMuted]}>
                            <Text style={styles.chipText}>No section</Text>
                            <Text style={styles.chipCount}>· {grade.unassignedCount}</Text>
                          </View>
                        )}
                      </>
                    )}
                  </View>

                  <View style={styles.actionsCol}>
                    <TouchableOpacity onPress={() => openPrompt({ kind: 'renameGrade', grade: grade.name }, grade.name)} accessibilityRole="button">
                      <Text style={styles.actionLink}>Rename</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => openPrompt({ kind: 'addSection', grade: grade.name })} accessibilityRole="button">
                      <Text style={styles.actionLink}>Add section</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => toggleArchiveGrade(grade)} accessibilityRole="button">
                      <Text style={styles.actionLinkMuted}>{grade.archived ? 'Restore' : 'Archive'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>

      {/* Add / Rename prompt */}
      <Modal visible={!!prompt} transparent animationType="fade" onRequestClose={() => setPrompt(null)}>
        <View style={styles.overlay}>
          <View style={styles.promptCard}>
            <View style={styles.promptHeader}>
              <Text style={styles.promptTitle}>{promptTitle}</Text>
              <TouchableOpacity onPress={() => setPrompt(null)} accessibilityRole="button" accessibilityLabel="Close">
                <Feather name="x" size={18} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <TextInput
              value={promptValue}
              onChangeText={setPromptValue}
              style={styles.promptInput}
              placeholder={promptPlaceholder}
              placeholderTextColor={colors.textDim}
              autoFocus
              onSubmitEditing={submitPrompt}
            />
            {prompt?.kind === 'renameGrade' && (
              <Text style={styles.promptHint}>Every student currently in this grade will be updated to the new name.</Text>
            )}
            {!!promptError && <Text style={styles.promptErr}>{promptError}</Text>}
            <View style={styles.promptFooter}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setPrompt(null)}><Text style={styles.cancelBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={submitPrompt} disabled={promptBusy}>
                {promptBusy ? <ActivityIndicator color="#0B0B0B" size="small" /> : <Text style={styles.saveBtnText}>{prompt?.kind === 'renameGrade' ? 'Rename' : 'Add'}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    content: { padding: spacing.xl, paddingBottom: 60, width: '100%', maxWidth: 1100, alignSelf: 'center' },

    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg, gap: 12, flexWrap: 'wrap' },
    ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.sm },
    ghostBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textMuted },
    addBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingHorizontal: 16, height: 40, marginLeft: 'auto',
    },
    addBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },

    table: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, overflow: 'hidden' },
    gradeRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 16, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.borderColor },
    gradeRowLast: { borderBottomWidth: 0 },
    gradeRowArchived: { opacity: 0.6 },
    gradeNameCol: { width: 130, flexShrink: 0 },
    gradeName: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: colors.textHeading },
    gradeTotal: { fontFamily: fonts.serif, fontSize: 11, color: colors.textDim, marginTop: 3 },
    archivedTag: { alignSelf: 'flex-start', backgroundColor: `${colors.textDim}22`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, marginTop: 4 },
    archivedTagText: { fontFamily: fonts.serif, fontSize: 9.5, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },

    chipsCol: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, minWidth: 0 },
    noSections: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textDim, fontStyle: 'italic' },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark,
      borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
    },
    chipArchived: { opacity: 0.55, borderStyle: 'dashed' },
    chipMuted: { backgroundColor: 'transparent', borderStyle: 'dashed' },
    chipText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textHeading },
    chipCount: { fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted },

    actionsCol: { flexDirection: 'row', alignItems: 'center', gap: 16, flexShrink: 0 },
    actionLink: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },
    actionLinkMuted: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textMuted },

    emptyBox: { alignItems: 'center', paddingTop: 56, gap: 12, paddingHorizontal: 24 },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 360 },
    retryBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderColor },
    retryText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },

    // Prompt modal
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    promptCard: { backgroundColor: colors.cardDark, borderRadius: 18, borderWidth: 1, borderColor: colors.borderColor, padding: 22, width: '100%', maxWidth: 380 },
    promptHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    promptTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700', color: colors.textHeading, flexShrink: 1 },
    promptInput: {
      fontFamily: fonts.serif, fontSize: 14, color: colors.textMain,
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm,
      paddingHorizontal: 12, paddingVertical: 11, backgroundColor: colors.bgDark,
    },
    promptHint: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim, marginTop: 8, lineHeight: 16 },
    promptErr: { fontFamily: fonts.serif, fontSize: 12, color: colors.accentRed, marginTop: 8 },
    promptFooter: { flexDirection: 'row', gap: 10, marginTop: 18 },
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center' },
    cancelBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textMuted },
    saveBtn: { flex: 1, backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center' },
    saveBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },
  });
}
