/**
 * School Admin — Add Teacher (dedicated screen, mirrors Add Student).
 *
 * A teacher can teach different subjects in different grades (e.g. Social
 * Studies in Grade 3, Science in Grade 4) — TeachingEntriesEditor captures
 * that as a repeatable list of {curriculum, grade, subjects} entries.
 *
 * Contract:
 *   POST /school-admin/teachers?adminEmail=<email>
 *        body { firstName, lastName, email?, teaches: [{curriculum, grade, subjects: string[]}] }
 *        -> 201 { id, name, email, password, teaches, subjects, status }
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, TextInput, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';
import TeachingEntriesEditor, { type TeachingEntry, emptyEntry, defaultCurriculumForBase } from './TeachingEntriesEditor';

interface CreateResult {
  id: string;
  name: string;
  email: string;
  password: string;
  subjects: string[];
  status: string;
}

export default function SchoolAdminAddTeacherScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [entries, setEntries] = useState<TeachingEntry[]>([emptyEntry()]);
  const [emailOverride, setEmailOverride] = useState('');
  const [schoolCurriculumBase, setSchoolCurriculumBase] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [result, setResult] = useState<CreateResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.email) return;
      try {
        const res = await fetch(`${SERVER_URL}/school-admin/overview?adminEmail=${encodeURIComponent(user.email)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const base = data?.school?.curriculum || null;
        setSchoolCurriculumBase(base);
        const preset = defaultCurriculumForBase(base);
        if (preset) setEntries((prev) => (prev.length === 1 && !prev[0].curriculum ? [{ ...prev[0], curriculum: preset }] : prev));
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [user?.email]);

  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0;

  const submit = useCallback(async () => {
    if (!user?.email || !canSubmit || submitting) return;
    setSubmitting(true);
    setFormError('');
    try {
      const teaches = entries
        .filter((e) => e.curriculum && e.grade)
        .map((e) => ({
          curriculum: e.curriculum, grade: e.grade,
          subjects: e.subjectsInput.split(/[;,]/).map((s) => s.trim()).filter(Boolean),
        }));
      const body: Record<string, any> = { firstName: firstName.trim(), lastName: lastName.trim(), teaches };
      if (emailOverride.trim()) body.email = emailOverride.trim();
      const res = await fetch(`${SERVER_URL}/school-admin/teachers?adminEmail=${encodeURIComponent(user.email)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setFormError(data?.error || 'Failed to add teacher'); return; }
      setResult(data as CreateResult);
    } catch {
      setFormError('Failed to add teacher. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  }, [user?.email, canSubmit, submitting, firstName, lastName, entries, emailOverride]);

  function goToTeachers() { navigation?.navigate?.('SchoolAdminTeachers'); }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Add Teacher"
          subtitle="Create a single teacher record. Use Import Teachers for bulk additions."
          onMenuPress={() => navigation?.openDrawer?.()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {result ? (
            <>
              <View style={styles.summaryCard}>
                <View style={styles.summaryIcon}><Feather name="check" size={20} color="#0B0B0B" /></View>
                <Text style={styles.summaryTitle}>Teacher added</Text>
                <Text style={styles.warnText}>Save these now — the password won't be shown again.</Text>
              </View>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Login credentials</Text>
                <View style={styles.credRow}><Text style={styles.credLabel}>Name</Text><Text style={styles.credValue}>{result.name}</Text></View>
                <View style={styles.credRow}><Text style={styles.credLabel}>Login email</Text><Text style={styles.credValue} selectable>{result.email}</Text></View>
                <View style={styles.credRow}><Text style={styles.credLabel}>Password</Text><Text style={styles.credValueMono} selectable>{result.password}</Text></View>
                {result.subjects?.length > 0 && (
                  <View style={styles.credRow}><Text style={styles.credLabel}>Subjects</Text><Text style={styles.credValue}>{result.subjects.join(', ')}</Text></View>
                )}
              </View>
              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setResult(null); setFirstName(''); setLastName(''); setEmailOverride(''); setEntries([emptyEntry(defaultCurriculumForBase(schoolCurriculumBase))]); }}>
                  <Text style={styles.secondaryBtnText}>Add another</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryBtn} onPress={goToTeachers}><Text style={styles.primaryBtnText}>Done</Text></TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Basic Information</Text>
                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>First name *</Text>
                    <TextInput value={firstName} onChangeText={setFirstName} style={styles.textInput} placeholder="e.g. Priya" placeholderTextColor={colors.textDim} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Last name *</Text>
                    <TextInput value={lastName} onChangeText={setLastName} style={styles.textInput} placeholder="e.g. Sharma" placeholderTextColor={colors.textDim} />
                  </View>
                </View>
              </View>

              <View style={[styles.card, openDropdown ? { zIndex: 30 } : null]}>
                <Text style={styles.cardTitle}>Teaching & Access</Text>
                <Text style={styles.cardHint}>Add one entry per grade this teacher handles — each grade can have its own subjects.</Text>
                <TeachingEntriesEditor
                  entries={entries} onChange={setEntries}
                  schoolCurriculumBase={schoolCurriculumBase} colors={colors}
                  openDropdown={openDropdown} setOpenDropdown={setOpenDropdown}
                />
                <Text style={styles.formLabel}>Login email (optional)</Text>
                <TextInput
                  value={emailOverride} onChangeText={setEmailOverride} style={styles.textInput}
                  placeholder="Optional — generated if left blank" placeholderTextColor={colors.textDim}
                  autoCapitalize="none" keyboardType="email-address"
                />
                <Text style={styles.hint}>A secure temporary password is generated automatically and shown once after creation. If a real email is given, the login is emailed to the teacher.</Text>
              </View>

              {!!formError && (
                <View style={styles.emptyBox}>
                  <Feather name="alert-circle" size={22} color={colors.textDim} />
                  <Text style={styles.emptyText}>{formError}</Text>
                </View>
              )}

              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={goToTeachers} disabled={submitting}><Text style={styles.secondaryBtnText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.primaryBtn, (!canSubmit || submitting) && styles.primaryBtnDisabled]} onPress={submit} disabled={!canSubmit || submitting}>
                  {submitting ? <ActivityIndicator color="#0B0B0B" size="small" /> : <Text style={styles.primaryBtnText}>Create Teacher</Text>}
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
    card: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg },
    cardTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: colors.textHeading, marginBottom: 4 },
    cardHint: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim, marginBottom: 12, lineHeight: 16 },
    formRow: { flexDirection: 'row', gap: 14 },
    formLabel: { fontFamily: fonts.serif, fontSize: 11.5, fontWeight: '600', color: colors.textMuted, marginBottom: 6, marginTop: 10 },
    textInput: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMain, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.bgDark },
    hint: { fontFamily: fonts.serif, fontSize: 11, color: colors.textDim, marginTop: 10, lineHeight: 16 },
    footerRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: spacing.md },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingHorizontal: 18, height: 42 },
    primaryBtnDisabled: { opacity: 0.45 },
    primaryBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },
    secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingHorizontal: 16, height: 42 },
    secondaryBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading },
    emptyBox: { alignItems: 'center', paddingTop: 12, paddingBottom: 12, gap: 10, paddingHorizontal: 24, marginBottom: spacing.md },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
    summaryCard: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center' },
    summaryIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentGreen, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    summaryTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '700', color: colors.textHeading, marginBottom: 6 },
    warnText: { fontFamily: fonts.serif, fontSize: 12, color: colors.accentYellow, textAlign: 'center' },
    credRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.borderColor },
    credLabel: { fontFamily: fonts.serif, fontSize: 12, color: colors.textDim },
    credValue: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700', color: colors.textHeading, flexShrink: 1, textAlign: 'right' },
    credValueMono: { fontFamily: Platform.select({ web: 'monospace', default: fonts.serif }), fontSize: 12, fontWeight: '700', color: colors.textHeading },
  });
}
