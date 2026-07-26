/**
 * School Admin — Add Parent (dedicated full-page screen, replacing the old
 * "Invite Parent" popup + checkbox student-picker on SchoolAdminParentsScreen).
 *
 * Same visual language as SchoolAdminAddStudentScreen (card sections,
 * primary/secondary footer buttons, a credentials success state).
 *
 * Linking a child is done by typed identifying details, not a pick-list —
 * the admin enters a student's Admission No (preferred, exact) or Name +
 * Grade + Section, and the backend resolves that to a real student row in
 * this school. A parent can link multiple children (one row each, "Add
 * another child"). If any entry can't be resolved to exactly one student,
 * the whole request is rejected with a clear per-row reason before anything
 * is created — so an account is never linked to the wrong (or no) child by
 * a stale pick-list or a typo.
 *
 * Contract: POST /school-admin/parents?adminEmail=<email>
 *   body { firstName, lastName, phone?, children?: [{ admissionNumber?, name?, grade?, section? }] }
 *   -> 201 { id, name, email, password, status }
 *   -> 400 { error, unresolved?: [{ index, reason }] } if any child entry didn't match exactly one student
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, TextInput, Platform, Share, Alert, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface ChildEntry {
  key: string;
  admissionNumber: string;
  name: string;
  curriculum: string;
  grade: string;
  section: string;
}

interface CreateResult {
  id: string;
  name: string;
  email: string;
  password: string;
  status: string;
}

function newChildEntry(): ChildEntry {
  return { key: `${Date.now()}-${Math.random()}`, admissionNumber: '', name: '', curriculum: '', grade: '', section: '' };
}

// Same curriculum/grade lists as SchoolAdminAddStudentScreen, so the Grade
// dropdown offered here for "Child N" matches the ranges students were
// actually created with — the curriculum picker here is purely a UI filter
// for narrowing the Grade options; it isn't sent to the backend, which only
// resolves a child by admission number, or by name+grade+section.
const CURRICULA = ['IB PYP', 'IB MYP', 'IB DP', 'CBSE', 'ICSE', 'Cambridge'];

function getGradesForCurriculum(curr: string): string[] {
  if (curr === 'IB PYP') return ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'];
  if (curr === 'IB MYP') return ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];
  if (curr === 'IB DP') return ['Grade 11', 'Grade 12'];
  if (curr === 'Cambridge') return ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];
  return ['Nursery', 'LKG', 'UKG', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];
}

function curriculaForBase(base: string | null): string[] {
  if (base === 'IB') return ['IB PYP', 'IB MYP', 'IB DP'];
  if (base && CURRICULA.includes(base)) return [base];
  return CURRICULA;
}

// Lightweight dropdown — same pattern as SchoolAdminAddStudentScreen's
// FormDropdown, kept local here to avoid coupling the two screens together.
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

export default function SchoolAdminAddParentScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [children, setChildren] = useState<ChildEntry[]>([newChildEntry()]);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [unresolved, setUnresolved] = useState<{ index: number; reason: string }[]>([]);
  const [result, setResult] = useState<CreateResult | null>(null);

  // Section options come from Grades & Sections config (same source as Add
  // Student) so the Section dropdown offers real, configured section names
  // instead of free text the admin has to remember/retype correctly.
  const [sectionsByGrade, setSectionsByGrade] = useState<Record<string, string[]>>({});
  const [allSections, setAllSections] = useState<string[]>([]);
  const [schoolCurriculumBase, setSchoolCurriculumBase] = useState<string | null>(null);
  // Which dropdown is open, keyed as `${childKey}:curriculum|grade|section` —
  // only one open at a time, and lets the owning child row raise its zIndex.
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      if (!user?.email) return;
      try {
        const [gsRes, overviewRes] = await Promise.all([
          fetch(`${SERVER_URL}/school-admin/grades-sections?adminEmail=${encodeURIComponent(user.email)}`),
          fetch(`${SERVER_URL}/school-admin/overview?adminEmail=${encodeURIComponent(user.email)}`),
        ]);
        const gsData = await gsRes.json().catch(() => ({}));
        const overviewData = await overviewRes.json().catch(() => ({}));
        if (cancelled) return;
        const gs: { name: string; sections?: { name: string; archived?: boolean }[] }[] = Array.isArray(gsData.grades) ? gsData.grades : [];
        const byGrade: Record<string, string[]> = {};
        const all = new Set<string>();
        gs.forEach((g) => {
          const secs = (g.sections || []).filter((s) => !s.archived).map((s) => s.name);
          byGrade[g.name] = secs;
          secs.forEach((s) => all.add(s));
        });
        setSectionsByGrade(byGrade);
        setAllSections(Array.from(all).sort());
        setSchoolCurriculumBase(overviewData?.school?.curriculum || null);
      } catch {
        // Non-fatal — dropdowns fall back to the full unfiltered lists.
      }
    }
    loadOptions();
    return () => { cancelled = true; };
  }, [user?.email]);

  const curriculumOptions = useMemo(() => curriculaForBase(schoolCurriculumBase).map((c) => ({ value: c, label: c })), [schoolCurriculumBase]);
  function gradeOptionsFor(curriculum: string) {
    return (curriculum ? getGradesForCurriculum(curriculum) : getGradesForCurriculum('')).map((g) => ({ value: g, label: g }));
  }
  function sectionOptionsFor(grade: string) {
    const forGrade = grade && sectionsByGrade[grade] ? sectionsByGrade[grade] : [];
    const list = forGrade.length > 0 ? forGrade : allSections;
    return list.map((s) => ({ value: s, label: s }));
  }

  // React Navigation reuses this screen instance rather than remounting it —
  // without this, tapping "Add Parent" again after a successful create kept
  // showing the PREVIOUS parent's "Parent added" success screen (with their
  // real password still on it) instead of a fresh blank form.
  useFocusEffect(useCallback(() => {
    setFirstName(''); setLastName(''); setPhone('');
    setChildren([newChildEntry()]);
    setSubmitting(false); setFormError(''); setUnresolved([]); setResult(null);
  }, []));

  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0;

  function updateChild(key: string, patch: Partial<ChildEntry>) {
    setChildren((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }
  function addChild() {
    setChildren((prev) => [...prev, newChildEntry()]);
  }
  function removeChild(key: string) {
    setChildren((prev) => (prev.length === 1 ? prev : prev.filter((c) => c.key !== key)));
  }

  const submit = useCallback(async () => {
    if (!user?.email || !canSubmit || submitting) return;
    setSubmitting(true);
    setFormError('');
    setUnresolved([]);
    try {
      // Only send rows the admin actually filled in — a blank leftover "Add
      // another child" row shouldn't count as a failed match.
      const childPayload = children
        .filter((c) => c.admissionNumber.trim() || c.name.trim())
        .map((c) => ({
          admissionNumber: c.admissionNumber.trim() || undefined,
          name: c.name.trim() || undefined,
          grade: c.grade.trim() || undefined,
          section: c.section.trim() || undefined,
        }));

      const body: Record<string, any> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      };
      if (phone.trim()) body.phone = phone.trim();
      if (childPayload.length > 0) body.children = childPayload;

      const res = await fetch(`${SERVER_URL}/school-admin/parents?adminEmail=${encodeURIComponent(user.email)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data?.error || 'Failed to add parent');
        if (Array.isArray(data?.unresolved)) setUnresolved(data.unresolved);
        return;
      }
      setResult(data as CreateResult);
    } catch {
      setFormError('Failed to add parent. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  }, [user?.email, canSubmit, submitting, firstName, lastName, phone, children]);

  async function shareCredentials() {
    if (!result) return;
    const message = `${result.name}'s Aivorah login:\nEmail: ${result.email}\nPassword: ${result.password}`;
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

  function goToParents() {
    navigation?.navigate?.('SchoolAdminParents');
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Add Parent"
          subtitle="Create a parent/guardian account and link them to their child."
          onMenuPress={() => navigation?.openDrawer?.()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {result ? (
            <>
              <View style={styles.summaryCard}>
                <View style={styles.summaryIcon}><Feather name="check" size={20} color="#0B0B0B" /></View>
                <Text style={styles.summaryTitle}>Parent added</Text>
                <Text style={styles.warnText}>Save these now — the password won't be shown again.</Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Login credentials</Text>
                <View style={styles.credBlock}>
                  <View style={styles.credRow}><Text style={styles.credLabel}>Name</Text><Text style={styles.credValue}>{result.name}</Text></View>
                  <View style={styles.credRow}><Text style={styles.credLabel}>Login email</Text><Text style={styles.credValue} selectable>{result.email}</Text></View>
                  <View style={styles.credRow}><Text style={styles.credLabel}>Password</Text><Text style={styles.credValueMono} selectable>{result.password}</Text></View>
                </View>
                <TouchableOpacity style={styles.shareBtn} onPress={shareCredentials} activeOpacity={0.8}>
                  <Feather name="share-2" size={14} color={colors.accentYellow} />
                  <Text style={styles.shareBtnText}>Share Login Details</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.footerRow, { justifyContent: 'center' }]}>
                <TouchableOpacity style={styles.primaryBtn} onPress={goToParents} accessibilityRole="button">
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
                    <TextInput value={firstName} onChangeText={setFirstName} style={styles.textInput} placeholder="e.g. Reddy" placeholderTextColor={colors.textDim} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Last name *</Text>
                    <TextInput value={lastName} onChangeText={setLastName} style={styles.textInput} placeholder="e.g. Emandi" placeholderTextColor={colors.textDim} />
                  </View>
                </View>
                <Text style={styles.formLabel}>Phone</Text>
                <TextInput
                  value={phone} onChangeText={setPhone} style={styles.textInput}
                  placeholder="Optional — for contact" placeholderTextColor={colors.textDim}
                  keyboardType="phone-pad"
                />
              </View>

              <View style={[styles.card, openDropdown && { zIndex: 30 }]}>
                <Text style={styles.cardTitle}>Link to Child</Text>
                <Text style={styles.cardHint}>
                  Enter the student's Admission No (fastest, exact match) — or their Name, Grade, and Section.
                  We'll match this to their existing record in your school. A parent can be linked to more than one child.
                </Text>
                {children.map((c, idx) => {
                  const rowIssue = unresolved.find((u) => u.index === idx);
                  const curriculumOpen = openDropdown === `${c.key}:curriculum`;
                  const gradeOpen = openDropdown === `${c.key}:grade`;
                  const sectionOpen = openDropdown === `${c.key}:section`;
                  const rowZIndex = curriculumOpen ? 32 : gradeOpen ? 31 : sectionOpen ? 30 : 1;
                  return (
                    <View key={c.key} style={[styles.childCard, { zIndex: rowZIndex }]}>
                      <View style={styles.childCardHeader}>
                        <Text style={styles.childCardTitle}>Child {idx + 1}</Text>
                        {children.length > 1 && (
                          <TouchableOpacity onPress={() => removeChild(c.key)} accessibilityRole="button" accessibilityLabel="Remove this child">
                            <Feather name="x" size={16} color={colors.textDim} />
                          </TouchableOpacity>
                        )}
                      </View>
                      <Text style={styles.formLabel}>Admission No</Text>
                      <TextInput
                        value={c.admissionNumber} onChangeText={(v) => updateChild(c.key, { admissionNumber: v })}
                        style={styles.textInput} placeholder="e.g. TSRA-1005" placeholderTextColor={colors.textDim}
                        autoCapitalize="characters"
                      />
                      <Text style={styles.formLabelOr}>— or —</Text>
                      <Text style={styles.formLabel}>Student name</Text>
                      <TextInput value={c.name} onChangeText={(v) => updateChild(c.key, { name: v })} style={styles.textInput} placeholder="e.g. Vihaan Kapoor" placeholderTextColor={colors.textDim} />

                      {/* Curriculum + Grade as a 2-column row (matches Add Student's layout).
                          zIndex is elevated on the ROW itself, not just the inner column — a
                          zIndex on an inner cell alone doesn't out-rank a LATER sibling row
                          that has no zIndex set, which is why the open dropdown was painting
                          behind the row below it. */}
                      <View style={[styles.formRow, curriculumOpen && { zIndex: 23 }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.formLabel}>Curriculum</Text>
                          <FormDropdown
                            value={c.curriculum}
                            placeholder="Select curriculum"
                            options={curriculumOptions}
                            onChange={(v) => updateChild(c.key, { curriculum: v, grade: '', section: '' })}
                            colors={colors}
                            open={curriculumOpen}
                            onToggle={() => setOpenDropdown((p) => (p === `${c.key}:curriculum` ? null : `${c.key}:curriculum`))}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.formLabel}>Grade</Text>
                          <FormDropdown
                            value={c.grade}
                            placeholder={c.curriculum ? 'Select grade' : 'Select a curriculum first'}
                            options={gradeOptionsFor(c.curriculum)}
                            onChange={(v) => updateChild(c.key, { grade: v, section: '' })}
                            colors={colors}
                            open={gradeOpen}
                            onToggle={() => { if (c.curriculum) setOpenDropdown((p) => (p === `${c.key}:grade` ? null : `${c.key}:grade`)); }}
                          />
                        </View>
                      </View>
                      <View style={[styles.formRow, (gradeOpen || sectionOpen) && { zIndex: 22 }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.formLabel}>Section</Text>
                          <FormDropdown
                            value={c.section}
                            placeholder="Select section"
                            options={sectionOptionsFor(c.grade)}
                            onChange={(v) => updateChild(c.key, { section: v })}
                            colors={colors}
                            open={sectionOpen}
                            onToggle={() => setOpenDropdown((p) => (p === `${c.key}:section` ? null : `${c.key}:section`))}
                          />
                        </View>
                        <View style={{ flex: 1 }} />
                      </View>
                      {!!rowIssue && <Text style={styles.rowError}>{rowIssue.reason}</Text>}
                    </View>
                  );
                })}
                <TouchableOpacity style={styles.addChildBtn} onPress={addChild} accessibilityRole="button">
                  <Feather name="plus" size={13} color={colors.accentYellow} />
                  <Text style={styles.addChildBtnText}>Add another child</Text>
                </TouchableOpacity>
              </View>

              {!!formError && (
                <View style={styles.emptyBox}>
                  <Feather name="alert-circle" size={22} color={colors.textDim} />
                  <Text style={styles.emptyText}>{formError}</Text>
                </View>
              )}

              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={goToParents} accessibilityRole="button" disabled={submitting}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, (!canSubmit || submitting) && styles.primaryBtnDisabled]}
                  onPress={submit}
                  disabled={!canSubmit || submitting}
                  accessibilityRole="button"
                >
                  {submitting ? <ActivityIndicator color="#0B0B0B" size="small" /> : <Text style={styles.primaryBtnText}>Create Parent</Text>}
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
      borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg,
    },
    cardTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: colors.textHeading, marginBottom: 4 },
    cardHint: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim, lineHeight: 16, marginBottom: 12 },

    formRow: { flexDirection: 'row', gap: 14 },
    formLabel: { fontFamily: fonts.serif, fontSize: 11.5, fontWeight: '600', color: colors.textMuted, marginBottom: 6, marginTop: 10 },
    formLabelOr: { fontFamily: fonts.serif, fontSize: 10.5, color: colors.textDim, textAlign: 'center', marginTop: 10, marginBottom: 2 },
    textInput: {
      fontFamily: fonts.serif, fontSize: 13, color: colors.textMain,
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm,
      paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.bgDark,
    },

    childCard: {
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm,
      padding: spacing.md, marginTop: 10,
    },
    childCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    childCardTitle: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4 },
    addChildBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, alignSelf: 'flex-start' },
    addChildBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },
    rowError: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.accentRed, marginTop: 8 },

    formInput: {
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm,
      paddingHorizontal: 12, height: 40, backgroundColor: colors.bgDark, justifyContent: 'center',
    },
    ddTriggerText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textHeading, flexShrink: 1 },
    ddBackdropWeb: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 29 },
    ddBackdropNative: { position: 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 29 },
    ddMenu: {
      position: 'absolute', top: 44, left: 0, right: 0, backgroundColor: colors.cardDark,
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 4,
      zIndex: 31, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
      maxHeight: 240, overflow: 'hidden',
    },
    ddItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 9 },
    ddItemHovered: { backgroundColor: colors.cardHover },
    ddItemActive: { backgroundColor: `${colors.accentYellow}14` },
    ddItemText: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted },
    ddItemTextActive: { color: colors.textHeading, fontWeight: '700' },

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

    summaryCard: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center',
    },
    summaryIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentGreen, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    summaryTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '700', color: colors.textHeading, marginBottom: 6 },
    warnText: { fontFamily: fonts.serif, fontSize: 12, color: colors.accentYellow, textAlign: 'center' },

    credBlock: { marginTop: 6 },
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
