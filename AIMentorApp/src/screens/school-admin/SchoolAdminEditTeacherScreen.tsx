/**
 * School Admin — Edit Teacher. Lets an admin fix/update a teacher's
 * grade+subject mapping after creation (multiple grade entries supported —
 * same {curriculum, grade, subjects} shape as SchoolAdminAddTeacherScreen).
 *
 * Receives the teacher row via navigation params (the list screen already
 * has it — no dedicated GET-by-id endpoint exists). Saves through
 * PATCH /user/profile, the same canonical write path used by the Super
 * Admin Staff Subject Mapping screen.
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';
import { useToast } from '../../components/common/Toast';
import TeachingEntriesEditor, { type TeachingEntry, emptyEntry } from './TeachingEntriesEditor';

interface TeacherParam {
  id: string;
  name: string;
  email: string;
  teaches?: { curriculum: string; grade: string; subjects: string[] }[];
}

export default function SchoolAdminEditTeacherScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const { showToast, ToastComponent } = useToast();
  const teacher: TeacherParam | undefined = route?.params?.teacher;

  const [entries, setEntries] = useState<TeachingEntry[]>(() => {
    const teaches = teacher?.teaches || [];
    return teaches.length > 0
      ? teaches.map((e) => ({ curriculum: e.curriculum, grade: e.grade, subjectsInput: (e.subjects || []).join(', ') }))
      : [emptyEntry()];
  });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [schoolCurriculumBase, setSchoolCurriculumBase] = useState<string | null>(null);

  useEffect(() => {
    if (!teacher) navigation?.navigate?.('SchoolAdminTeachers');
  }, [teacher, navigation]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.email) return;
      try {
        const res = await fetch(`${SERVER_URL}/school-admin/overview?adminEmail=${encodeURIComponent(user.email)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setSchoolCurriculumBase(data?.school?.curriculum || null);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [user?.email]);

  const canSubmit = entries.some((e) => e.curriculum && e.grade);

  const save = useCallback(async () => {
    if (!teacher || saving) return;
    setSaving(true);
    setFormError('');
    try {
      const teaches = entries
        .filter((e) => e.curriculum && e.grade)
        .map((e) => ({
          curriculum: e.curriculum, grade: e.grade,
          subjects: e.subjectsInput.split(/[;,]/).map((s) => s.trim()).filter(Boolean),
        }));
      const res = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: teacher.email, teaches }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setFormError(data?.error || 'Failed to save changes'); return; }
      showToast({ title: 'Teacher updated', subtitle: `${teacher.name}'s subject mapping was saved.`, type: 'success' });
      navigation?.navigate?.('SchoolAdminTeachers');
    } catch {
      setFormError('Failed to save changes. Check your connection.');
    } finally {
      setSaving(false);
    }
  }, [teacher, saving, entries, navigation, showToast]);

  function goToTeachers() { navigation?.navigate?.('SchoolAdminTeachers'); }

  if (!teacher) return null;

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Edit Teacher"
          subtitle={`${teacher.name} · ${teacher.email}`}
          onMenuPress={() => navigation?.openDrawer?.()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.card, openDropdown ? { zIndex: 30 } : null]}>
            <Text style={styles.cardTitle}>Teaching & Access</Text>
            <Text style={styles.cardHint}>Add one entry per grade this teacher handles — each grade can have its own subjects.</Text>
            <TeachingEntriesEditor
              entries={entries} onChange={setEntries}
              schoolCurriculumBase={schoolCurriculumBase} colors={colors}
              openDropdown={openDropdown} setOpenDropdown={setOpenDropdown}
            />
          </View>

          {!!formError && (
            <View style={styles.emptyBox}>
              <Feather name="alert-circle" size={22} color={colors.textDim} />
              <Text style={styles.emptyText}>{formError}</Text>
            </View>
          )}

          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={goToTeachers} disabled={saving}><Text style={styles.secondaryBtnText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, (!canSubmit || saving) && styles.primaryBtnDisabled]} onPress={save} disabled={!canSubmit || saving}>
              {saving ? <ActivityIndicator color="#0B0B0B" size="small" /> : <Text style={styles.primaryBtnText}>Save changes</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
      {ToastComponent}
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
    footerRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: spacing.md },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingHorizontal: 18, height: 42 },
    primaryBtnDisabled: { opacity: 0.45 },
    primaryBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },
    secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingHorizontal: 16, height: 42 },
    secondaryBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading },
    emptyBox: { alignItems: 'center', paddingTop: 12, paddingBottom: 12, gap: 10, paddingHorizontal: 24, marginBottom: spacing.md },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
  });
}
