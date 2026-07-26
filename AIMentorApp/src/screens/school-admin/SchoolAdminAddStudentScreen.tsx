/**
 * School Admin — Add Student (dedicated screen, V1 write access).
 *
 * Replaces the old `AddStudentModal` popup on SchoolAdminStudentsScreen with
 * its own full page per the approved design, matching the same visual
 * language as SchoolAdminBulkImportScreen's wizard (card sections, primary/
 * secondary footer buttons, a Results-style success state showing login
 * credentials once).
 *
 * Contract:
 *   POST /school-admin/students?adminEmail=<email>
 *        body { firstName, lastName, grade, section?, email?, initialStatus?,
 *               parentName?, parentEmail?, notes? }
 *        -> 201 { id, name, email, password, admissionNumber, grade, section,
 *                 status, parent?: { name, email, password } }
 *
 * Grade/Section are dropdowns sourced from the school's existing students
 * (GET /school-admin/students?adminEmail=&limit=100, same endpoint the
 * Students list already uses) — deduped + sorted distinct values. If the
 * school has zero students yet, that dropdown falls back to a plain text
 * input so admins aren't stuck with zero options.
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, TextInput, Pressable, Platform, Share, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface Credentials {
  name: string;
  email: string;
  password: string;
}

interface CreateResult {
  id: string;
  name: string;
  email: string;
  password: string;
  admissionNumber: string | null;
  grade: string | null;
  section: string | null;
  status: string;
  parent?: { name: string; email: string; password: string } | null;
}

// ── Lightweight dropdown (same pattern as FilterDropdown / MapDropdown on
// the sibling Students / Bulk Import screens) — controlled by the parent so
// the row that owns the open dropdown can be given elevated zIndex, keeping
// its menu from painting behind the next form section. ──────────────────
function FormDropdown({ value, placeholder, options, onChange, colors, open, onToggle }: {
  value: string; placeholder: string; options: { value: string; label: string }[];
  onChange: (v: string) => void; colors: AppColors; open: boolean; onToggle: () => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const current = options.find((o) => o.value === value)?.label || placeholder;
  return (
    <View style={{ position: 'relative' }}>
      <Pressable style={styles.formInput} onPress={onToggle} accessibilityRole="button">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[styles.ddTriggerText, !value && { color: colors.textDim }]} numberOfLines={1}>{current}</Text>
          <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textDim} />
        </View>
      </Pressable>
      {open && (
        <>
          <Pressable style={Platform.select({ web: styles.ddBackdropWeb, default: styles.ddBackdropNative }) as any} onPress={onToggle} />
          <View style={styles.ddMenu}>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {options.map((o) => (
                <Pressable
                  key={o.value}
                  style={({ hovered }: any) => [styles.ddItem, Platform.OS === 'web' && hovered && styles.ddItemHovered, o.value === value && styles.ddItemActive]}
                  onPress={() => { onChange(o.value); onToggle(); }}
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

const STATUS_OPTIONS = [
  { value: 'invited', label: 'Invited — send activation email' },
  { value: 'active', label: 'Active — skip activation email' },
];

// Curriculum is an explicit choice by the admin — same list and grade ranges
// as the student/parent onboarding flow (getGradesForCurriculum in
// OnboardingScreen.tsx), so IB PYP / IB MYP / IB DP are distinct selectable
// options (not silently derived), and the Grade dropdown then only offers the
// grades that belong to the chosen curriculum.
const CURRICULA = ['IB PYP', 'IB MYP', 'IB DP', 'CBSE', 'ICSE', 'Cambridge'];

function getGradesForCurriculum(curr: string): string[] {
  if (curr === 'IB PYP') return ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'];
  if (curr === 'IB MYP') return ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];
  if (curr === 'IB DP') return ['Grade 11', 'Grade 12'];
  if (curr === 'Cambridge') return ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];
  return ['Nursery', 'LKG', 'UKG', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];
}

// A school follows one board — so the curriculum dropdown only offers the
// options that belong to THIS school's base type. An IB school shows just the
// three IB levels (PYP/MYP/DP); a CBSE school shows only CBSE; a school with
// no base type set falls back to the full list.
function curriculaForBase(base: string | null): string[] {
  if (base === 'IB') return ['IB PYP', 'IB MYP', 'IB DP'];
  if (base && CURRICULA.includes(base)) return [base];
  return CURRICULA;
}

// For a school whose base type is already a single full curriculum (e.g. CBSE)
// we pre-select it; for an IB school the exact level (PYP/MYP/DP) still depends
// on the child, so we leave it unselected for the admin to choose.
function defaultCurriculumForBase(base: string | null): string {
  if (!base) return '';
  return CURRICULA.includes(base) ? base : '';
}

export default function SchoolAdminAddStudentScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  // ── Section options come from the Grades & Sections config ─────────────
  // (grade -> configured section names). Grades still follow the chosen
  // curriculum; sections are what the admin defined for that grade on the
  // Grades & Sections screen. Falls back to the union of all sections when a
  // grade has none configured yet.
  const [sectionsByGrade, setSectionsByGrade] = useState<Record<string, string[]>>({});
  const [allSections, setAllSections] = useState<string[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [schoolCurriculumBase, setSchoolCurriculumBase] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      if (!user?.email) { setOptionsLoading(false); return; }
      try {
        const res = await fetch(`${SERVER_URL}/school-admin/grades-sections?adminEmail=${encodeURIComponent(user.email)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const gs: { name: string; sections?: { name: string; archived?: boolean }[] }[] = Array.isArray(data.grades) ? data.grades : [];
        const byGrade: Record<string, string[]> = {};
        const all = new Set<string>();
        gs.forEach((g) => {
          const secs = (g.sections || []).filter((s) => !s.archived).map((s) => s.name);
          byGrade[g.name] = secs;
          secs.forEach((s) => all.add(s));
        });
        setSectionsByGrade(byGrade);
        setAllSections(Array.from(all).sort());
      } catch {
        // Non-fatal — Section falls back to free-text if this fails.
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    }
    loadOptions();
    return () => { cancelled = true; };
  }, [user?.email]);

  // ── Form state ───────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [curriculum, setCurriculum] = useState('');
  const [admissionNumber, setAdmissionNumber] = useState('');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [emailOverride, setEmailOverride] = useState('');
  const [status, setStatus] = useState<'invited' | 'active'>('invited');
  const [parentName, setParentName] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [parentSectionOpen, setParentSectionOpen] = useState(false);

  // The school's base curriculum type — pre-selects the curriculum dropdown
  // when the school is a single full curriculum (e.g. CBSE). For an IB school
  // the admin still picks the exact level (PYP/MYP/DP).
  useEffect(() => {
    let cancelled = false;
    async function loadSchoolCurriculum() {
      if (!user?.email) return;
      try {
        const res = await fetch(`${SERVER_URL}/school-admin/overview?adminEmail=${encodeURIComponent(user.email)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const base = data?.school?.curriculum || null;
        setSchoolCurriculumBase(base);
        const preset = defaultCurriculumForBase(base);
        if (preset) setCurriculum((cur) => cur || preset);
      } catch {
        // Non-fatal — the admin can still pick a curriculum manually.
      }
    }
    loadSchoolCurriculum();
    return () => { cancelled = true; };
  }, [user?.email]);

  // Grade options follow the chosen curriculum (same ranges as onboarding);
  // sections still come from the school's existing students.
  const curriculumOptions = useMemo(() => curriculaForBase(schoolCurriculumBase).map((c) => ({ value: c, label: c })), [schoolCurriculumBase]);
  const gradeOptions = useMemo(() => (curriculum ? getGradesForCurriculum(curriculum).map((g) => ({ value: g, label: g })) : []), [curriculum]);
  const sectionOptions = useMemo(() => {
    // Prefer the sections configured for the chosen grade; else fall back to
    // the union of all configured sections so the admin still has choices.
    const forGrade = grade && sectionsByGrade[grade] ? sectionsByGrade[grade] : [];
    const list = forGrade.length > 0 ? forGrade : allSections;
    return list.map((s) => ({ value: s, label: s }));
  }, [grade, sectionsByGrade, allSections]);

  // Which dropdown is open — lifted so the containing row can be elevated.
  const [openDropdown, setOpenDropdown] = useState<'curriculum' | 'grade' | 'section' | 'status' | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [result, setResult] = useState<CreateResult | null>(null);

  // React Navigation reuses this screen instance rather than remounting it —
  // without this, tapping "Add Student" again after a successful create kept
  // showing the PREVIOUS student's "Student added" success screen (with their
  // real password still on it) instead of a fresh blank form.
  useFocusEffect(useCallback(() => {
    setFirstName(''); setLastName(''); setAdmissionNumber('');
    setGrade(''); setSection(''); setEmailOverride(''); setStatus('invited');
    setParentName(''); setParentEmail(''); setNotes(''); setParentSectionOpen(false);
    setSubmitting(false); setFormError(''); setResult(null);
    // Curriculum is left as-is — it's re-derived from the school's base type
    // by the effect above, not user-typed state worth wiping every focus.
  }, []));

  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0 && curriculum.trim().length > 0 && grade.trim().length > 0;

  const submit = useCallback(async () => {
    if (!user?.email || !canSubmit || submitting) return;
    setSubmitting(true);
    setFormError('');
    try {
      const body: Record<string, any> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        grade: grade.trim(),
        curriculum: curriculum.trim(),
      };
      if (section.trim()) body.section = section.trim();
      if (admissionNumber.trim()) body.admissionNumber = admissionNumber.trim();
      if (emailOverride.trim()) body.email = emailOverride.trim();
      if (status === 'active') body.initialStatus = 'active';
      if (parentName.trim()) body.parentName = parentName.trim();
      if (parentEmail.trim()) body.parentEmail = parentEmail.trim();
      if (notes.trim()) body.notes = notes.trim();

      const res = await fetch(`${SERVER_URL}/school-admin/students?adminEmail=${encodeURIComponent(user.email)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setFormError(data?.error || 'Failed to add student'); return; }
      setResult(data as CreateResult);
    } catch {
      setFormError('Failed to add student. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  }, [user?.email, canSubmit, submitting, firstName, lastName, curriculum, admissionNumber, grade, section, emailOverride, status, parentName, parentEmail, notes]);

  function goToStudents() {
    navigation?.navigate?.('SchoolAdminStudents');
  }

  // Same share pattern as Add Parent / Teacher Add Student — Web Share API when
  // available, clipboard fallback otherwise. Includes the parent's credentials
  // too when a parent/guardian account was created alongside the student.
  async function shareCredentials() {
    if (!result) return;
    let message = `${result.name}'s Aivorah login:\nEmail: ${result.email}\nPassword: ${result.password}`;
    if (result.parent) {
      message += `\n\n${result.parent.name}'s (Parent) Aivorah login:\nEmail: ${result.parent.email}\nPassword: ${result.parent.password}`;
    }
    if (Platform.OS === 'web') {
      const nav: any = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.share) {
        try { await nav.share({ text: message }); return; } catch { /* cancelled or unsupported */ }
      }
      if (nav?.clipboard) nav.clipboard.writeText(message).catch(() => {});
      Alert.alert('Copied', 'Sharing is not available in this browser — the login details were copied instead, so you can paste them anywhere.');
      return;
    }
    try { await Share.share({ message }); } catch { /* cancelled */ }
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Add Student"
          subtitle="Create a single student record. Use Bulk Import for bulk additions."
          onMenuPress={() => navigation?.openDrawer?.()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {result ? (
            <>
              <View style={styles.summaryCard}>
                <View style={styles.summaryIcon}><Feather name="check" size={20} color="#0B0B0B" /></View>
                <Text style={styles.summaryTitle}>Student added</Text>
                <Text style={styles.warnText}>Save these now — passwords won't be shown again.</Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Login credentials</Text>
                <View style={styles.credBlock}>
                  <Text style={styles.credBlockLabel}>Student</Text>
                  <View style={styles.credRow}><Text style={styles.credLabel}>Name</Text><Text style={styles.credValue}>{result.name}</Text></View>
                  <View style={styles.credRow}><Text style={styles.credLabel}>Login email</Text><Text style={styles.credValue} selectable>{result.email}</Text></View>
                  <View style={styles.credRow}><Text style={styles.credLabel}>Password</Text><Text style={styles.credValueMono} selectable>{result.password}</Text></View>
                </View>

                {!!result.parent && (
                  <View style={[styles.credBlock, { marginTop: 14 }]}>
                    <Text style={styles.credBlockLabel}>Parent / Guardian</Text>
                    <View style={styles.credRow}><Text style={styles.credLabel}>Name</Text><Text style={styles.credValue}>{result.parent.name}</Text></View>
                    <View style={styles.credRow}><Text style={styles.credLabel}>Login email</Text><Text style={styles.credValue} selectable>{result.parent.email}</Text></View>
                    <View style={styles.credRow}><Text style={styles.credLabel}>Password</Text><Text style={styles.credValueMono} selectable>{result.parent.password}</Text></View>
                  </View>
                )}

                <TouchableOpacity style={styles.shareBtn} onPress={shareCredentials} activeOpacity={0.8}>
                  <Feather name="share-2" size={13} color={colors.accentYellow} />
                  <Text style={styles.shareBtnText}>Share Login Details</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.footerRow, { justifyContent: 'center' }]}>
                <TouchableOpacity style={styles.primaryBtn} onPress={goToStudents} accessibilityRole="button">
                  <Text style={styles.primaryBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Basic Information</Text>
                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>First name *</Text>
                    <TextInput value={firstName} onChangeText={setFirstName} style={styles.textInput} placeholder="e.g. Ela" placeholderTextColor={colors.textDim} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Last name *</Text>
                    <TextInput value={lastName} onChangeText={setLastName} style={styles.textInput} placeholder="e.g. Reddy" placeholderTextColor={colors.textDim} />
                  </View>
                </View>
              </View>

              <View style={[styles.card, { zIndex: (openDropdown === 'curriculum' || openDropdown === 'grade' || openDropdown === 'section') ? 30 : 1 }]}>
                <Text style={styles.cardTitle}>Academic Placement</Text>
                <View style={[styles.formRow, openDropdown === 'curriculum' && { zIndex: 22 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Curriculum *</Text>
                    <FormDropdown
                      value={curriculum}
                      placeholder="Select curriculum"
                      options={curriculumOptions}
                      onChange={(v) => { setCurriculum(v); setGrade(''); }}
                      colors={colors}
                      open={openDropdown === 'curriculum'}
                      onToggle={() => setOpenDropdown((p) => (p === 'curriculum' ? null : 'curriculum'))}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Admission Number</Text>
                    <TextInput
                      value={admissionNumber}
                      onChangeText={setAdmissionNumber}
                      style={styles.textInput}
                      placeholder="Optional — auto-generated if left blank"
                      placeholderTextColor={colors.textDim}
                      autoCapitalize="characters"
                    />
                  </View>
                </View>
                <View style={styles.formRow}>
                  <View style={[{ flex: 1 }, openDropdown === 'grade' && { zIndex: 21 }]}>
                    <Text style={styles.formLabel}>Grade *</Text>
                    <FormDropdown
                      value={grade}
                      placeholder={curriculum ? 'Select grade' : 'Select a curriculum first'}
                      options={gradeOptions}
                      onChange={setGrade}
                      colors={colors}
                      open={openDropdown === 'grade'}
                      onToggle={() => { if (curriculum) setOpenDropdown((p) => (p === 'grade' ? null : 'grade')); }}
                    />
                  </View>
                  <View style={[{ flex: 1 }, openDropdown === 'section' && { zIndex: 21 }]}>
                    <Text style={styles.formLabel}>Section</Text>
                    {!optionsLoading && sectionOptions.length === 0 ? (
                      <TextInput value={section} onChangeText={setSection} style={styles.textInput} placeholder="e.g. A" placeholderTextColor={colors.textDim} />
                    ) : (
                      <FormDropdown
                        value={section}
                        placeholder="Select section"
                        options={sectionOptions}
                        onChange={setSection}
                        colors={colors}
                        open={openDropdown === 'section'}
                        onToggle={() => setOpenDropdown((p) => (p === 'section' ? null : 'section'))}
                      />
                    )}
                  </View>
                </View>
              </View>

              <View style={[styles.card, openDropdown === 'status' && { zIndex: 30 }]}>
                <Text style={styles.cardTitle}>Account Access</Text>
                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Student email</Text>
                    <TextInput
                      value={emailOverride} onChangeText={setEmailOverride} style={styles.textInput}
                      placeholder="Optional — generated if left blank" placeholderTextColor={colors.textDim}
                      autoCapitalize="none" keyboardType="email-address"
                    />
                  </View>
                  <View style={[{ flex: 1 }, openDropdown === 'status' && { zIndex: 21 }]}>
                    <Text style={styles.formLabel}>Account status</Text>
                    <FormDropdown
                      value={status}
                      placeholder="Select status"
                      options={STATUS_OPTIONS}
                      onChange={(v) => setStatus(v as 'invited' | 'active')}
                      colors={colors}
                      open={openDropdown === 'status'}
                      onToggle={() => setOpenDropdown((p) => (p === 'status' ? null : 'status'))}
                    />
                  </View>
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.collapseHeader}>
                  <Text style={styles.cardTitle}>Parent / Guardian & Additional Information</Text>
                  <TouchableOpacity onPress={() => setParentSectionOpen((o) => !o)} accessibilityRole="button">
                    <Text style={styles.collapseToggle}>{parentSectionOpen ? 'Hide' : 'Show'}</Text>
                  </TouchableOpacity>
                </View>
                {parentSectionOpen && (
                  <>
                    <View style={styles.formRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.formLabel}>Parent / Guardian name</Text>
                        <TextInput value={parentName} onChangeText={setParentName} style={styles.textInput} placeholder="Optional" placeholderTextColor={colors.textDim} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.formLabel}>Parent / Guardian email</Text>
                        <TextInput
                          value={parentEmail} onChangeText={setParentEmail} style={styles.textInput}
                          placeholder="Optional" placeholderTextColor={colors.textDim}
                          autoCapitalize="none" keyboardType="email-address"
                        />
                      </View>
                    </View>
                    <Text style={styles.formLabel}>Notes</Text>
                    <TextInput
                      value={notes} onChangeText={setNotes}
                      style={[styles.textInput, styles.textArea]}
                      placeholder="Internal note, visible to administrators only"
                      placeholderTextColor={colors.textDim}
                      multiline
                      numberOfLines={3}
                    />
                  </>
                )}
              </View>

              {!!formError && (
                <View style={styles.emptyBox}>
                  <Feather name="alert-circle" size={22} color={colors.textDim} />
                  <Text style={styles.emptyText}>{formError}</Text>
                </View>
              )}

              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={goToStudents} accessibilityRole="button" disabled={submitting}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, (!canSubmit || submitting) && styles.primaryBtnDisabled]}
                  onPress={submit}
                  disabled={!canSubmit || submitting}
                  accessibilityRole="button"
                >
                  {submitting ? <ActivityIndicator color="#0B0B0B" size="small" /> : <Text style={styles.primaryBtnText}>Create Student</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    content: { padding: spacing.xl, paddingBottom: 60, width: '100%', maxWidth: 720, alignSelf: 'center' },

    card: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg, position: 'relative',
    },
    cardTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: colors.textHeading, marginBottom: 4 },

    formRow: { flexDirection: 'row', gap: 14 },
    formLabel: { fontFamily: fonts.serif, fontSize: 11.5, fontWeight: '600', color: colors.textMuted, marginBottom: 6, marginTop: 10 },
    textInput: {
      fontFamily: fonts.serif, fontSize: 13, color: colors.textMain,
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm,
      paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.bgDark,
    },
    textArea: { minHeight: 80, textAlignVertical: 'top' },
    formInput: {
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm,
      paddingHorizontal: 12, height: 40, backgroundColor: colors.bgDark, justifyContent: 'center',
    },

    ddTriggerText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textHeading, flexShrink: 1 },
    ddBackdropWeb: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 19 },
    ddBackdropNative: { position: 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 19 },
    ddMenu: {
      position: 'absolute', top: 44, left: 0, right: 0, backgroundColor: colors.cardDark,
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 4,
      zIndex: 21, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
      // maxHeight must live on THIS absolutely-positioned, auto-sized
      // container, not just the inner ScrollView — react-native-web won't
      // clip an unbounded absolute box based on a child's maxHeight alone,
      // so a long options list (e.g. 12 grades) rendered full-height and
      // overlapped every card below it instead of scrolling in place.
      maxHeight: 240, overflow: 'hidden',
    },
    ddItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 9 },
    ddItemHovered: { backgroundColor: colors.cardHover },
    ddItemActive: { backgroundColor: `${colors.accentYellow}14` },
    ddItemText: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted },
    ddItemTextActive: { color: colors.textHeading, fontWeight: '700' },

    collapseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    collapseToggle: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },

    footerRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: spacing.md },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
      backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingHorizontal: 18, height: 42,
    },
    primaryBtnDisabled: { opacity: 0.45 },
    primaryBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },
    secondaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.sm, paddingHorizontal: 16, height: 42,
    },
    secondaryBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading },

    emptyBox: { alignItems: 'center', paddingTop: 12, paddingBottom: 12, gap: 10, paddingHorizontal: 24, marginBottom: spacing.md },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },

    // ── Success state ────────────────────────────────────────────────────
    summaryCard: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center',
    },
    summaryIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentGreen, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    summaryTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '700', color: colors.textHeading, marginBottom: 6 },
    warnText: { fontFamily: fonts.serif, fontSize: 12, color: colors.accentYellow, textAlign: 'center' },

    credBlock: { marginTop: 6 },
    credBlockLabel: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.textDim, marginBottom: 6 },
    credRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.borderColor },
    credLabel: { fontFamily: fonts.serif, fontSize: 12, color: colors.textDim },
    credValue: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: colors.textHeading },
    credValueMono: { fontFamily: Platform.select({ web: 'monospace', default: fonts.serif }), fontSize: 12, fontWeight: '700', color: colors.textHeading },
    shareBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', gap: 6,
      backgroundColor: `${colors.accentYellow}18`, borderRadius: 20,
      paddingVertical: 8, paddingHorizontal: 16, marginTop: 14,
    },
    shareBtnText: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: colors.accentYellow },
  });
}
