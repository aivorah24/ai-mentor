/**
 * ConnectSchoolModal — the B2C → B2B bridge. An independent (self-registered)
 * user picks their official school + grade/section and submits a join request.
 * Approval happens on the School Admin side (POST is only a *request* — it never
 * links the account itself). Self-contained controlled <Modal> so it can be
 * dropped into any screen without registering a navigator route.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Platform, TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import SERVER_URL from '../../../config/serverUrl';

type School = { id: string; name: string };
type GradeStruct = { name: string; sections: string[] };

export default function ConnectSchoolModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const email = user?.email || '';

  const [schools, setSchools] = useState<School[]>([]);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [structure, setStructure] = useState<GradeStruct[]>([]);
  const [loadingStructure, setLoadingStructure] = useState(false);
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [openPicker, setOpenPicker] = useState<null | 'grade' | 'section'>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null); // holds school name on success

  // When a school is picked, load its grades + sections for the dropdowns and
  // reset any previously-chosen grade/section (they belong to the old school).
  useEffect(() => {
    setGrade(''); setSection(''); setOpenPicker(null); setStructure([]);
    if (!schoolId) return;
    setLoadingStructure(true);
    fetch(`${SERVER_URL}/user/school-structure?schoolId=${encodeURIComponent(schoolId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not load grades'))))
      .then((data) => setStructure(Array.isArray(data?.grades) ? data.grades : []))
      .catch(() => setStructure([]))
      .finally(() => setLoadingStructure(false));
  }, [schoolId]);

  const sectionsForGrade = structure.find((g) => g.name === grade)?.sections || [];

  useEffect(() => {
    if (!visible) return;
    // Reset each time it opens so a re-open starts clean.
    setSchoolId(null); setGrade(''); setSection(''); setParentEmail(''); setError(''); setDone(null);
    setLoadingSchools(true);
    fetch(`${SERVER_URL}/user/schools`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not load schools'))))
      .then((data) => setSchools(Array.isArray(data) ? data : []))
      .catch((e) => setError(e?.message || 'Could not load schools'))
      .finally(() => setLoadingSchools(false));
  }, [visible]);

  const submit = async () => {
    if (!schoolId) { setError('Please choose your school first.'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await fetch(`${SERVER_URL}/user/request-school-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, schoolId, grade: grade.trim() || undefined, section: section.trim() || undefined, parentEmail: parentEmail.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to submit request');
      setDone(data?.schoolName || schools.find((s) => s.id === schoolId)?.name || 'your school');
    } catch (e: any) {
      setError(e?.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerIcon}><Feather name="home" size={16} color={colors.accentYellow} /></View>
            <Text style={styles.title}>{done ? 'Request Sent' : 'Connect to My School'}</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {done ? (
            <View style={styles.successBox}>
              <View style={styles.successIconOuter}>
                <View style={styles.successIconInner}>
                  <Feather name="check" size={26} color="#2E7D5B" />
                </View>
              </View>
              <Text style={styles.successHeading}>Request Submitted</Text>
              <Text style={styles.successText}>
                Your request to join <Text style={{ fontWeight: '700', color: colors.textHeading }}>{done}</Text> has been sent.
                {"\n\n"}A school administrator will review and approve your profile to unlock your official class schedule and study tools.
              </Text>
              <TouchableOpacity style={styles.doneBtn} onPress={onClose} activeOpacity={0.85} accessibilityRole="button">
                <Text style={styles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.subtitle}>Pick your school and (optionally) your grade & section. Your request goes to the school's admin for approval.</Text>

              <Text style={styles.fieldLabel}>School</Text>
              {loadingSchools ? (
                <ActivityIndicator color={colors.accentYellow} style={{ marginVertical: 16 }} />
              ) : (
                <ScrollView style={styles.schoolList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                  {schools.length === 0 ? (
                    <Text style={styles.emptyHint}>No schools available yet.</Text>
                  ) : schools.map((s) => {
                    const active = s.id === schoolId;
                    return (
                      <TouchableOpacity key={s.id} style={[styles.schoolRow, active && styles.schoolRowActive]} onPress={() => setSchoolId(s.id)} accessibilityRole="button">
                        <Feather name={active ? 'check-circle' : 'circle'} size={16} color={active ? colors.accentYellow : colors.textDim} />
                        <Text style={[styles.schoolName, active && { color: colors.textHeading, fontWeight: '700' }]} numberOfLines={1}>{s.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              {!!schoolId && (
                loadingStructure ? (
                  <ActivityIndicator color={colors.accentYellow} style={{ marginVertical: 12 }} />
                ) : structure.length === 0 ? (
                  <Text style={styles.emptyHint}>This school hasn't published its grades yet — an admin will assign your class on approval.</Text>
                ) : (
                  <View style={styles.gradeRow}>
                    {/* Grade dropdown — the school's real grades (programme is baked
                        into the name, e.g. "PYP 3" / "MYP 1"). */}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>Grade</Text>
                      <TouchableOpacity style={styles.select} onPress={() => setOpenPicker(openPicker === 'grade' ? null : 'grade')} accessibilityRole="button">
                        <Text style={[styles.selectText, !grade && { color: colors.textDim }]} numberOfLines={1}>{grade || 'Choose grade'}</Text>
                        <Feather name={openPicker === 'grade' ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                      {openPicker === 'grade' && (
                        <View style={styles.dropdown}>
                          <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                            {structure.map((g) => (
                              <TouchableOpacity key={g.name} style={styles.dropdownRow} onPress={() => { setGrade(g.name); setSection(''); setOpenPicker(null); }} accessibilityRole="button">
                                <Text style={[styles.dropdownText, g.name === grade && { color: colors.accentYellow, fontWeight: '700' }]}>{g.name}</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      )}
                    </View>

                    {/* Section dropdown — only the sections that exist for the chosen grade. */}
                    <View style={{ width: 120 }}>
                      <Text style={styles.fieldLabel}>Section</Text>
                      <TouchableOpacity
                        style={[styles.select, (!grade || sectionsForGrade.length === 0) && { opacity: 0.5 }]}
                        disabled={!grade || sectionsForGrade.length === 0}
                        onPress={() => setOpenPicker(openPicker === 'section' ? null : 'section')}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.selectText, !section && { color: colors.textDim }]} numberOfLines={1}>{section || (sectionsForGrade.length ? 'Section' : '—')}</Text>
                        <Feather name={openPicker === 'section' ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                      {openPicker === 'section' && (
                        <View style={styles.dropdown}>
                          <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                            {sectionsForGrade.map((s) => (
                              <TouchableOpacity key={s} style={styles.dropdownRow} onPress={() => { setSection(s); setOpenPicker(null); }} accessibilityRole="button">
                                <Text style={[styles.dropdownText, s === section && { color: colors.accentYellow, fontWeight: '700' }]}>{s}</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </View>
                      )}
                    </View>
                  </View>
                )
              )}

              <Text style={styles.fieldLabel}>Parent / Guardian Email (For Family Portal Verification)</Text>
              <TextInput
                style={styles.input}
                placeholder="parent@example.com (Required if < 14, Optional if 14+)"
                placeholderTextColor={colors.textDim}
                value={parentEmail}
                onChangeText={setParentEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              {!!error && <Text style={styles.error}>{error}</Text>}

              <TouchableOpacity style={[styles.primaryBtn, (submitting || !schoolId) && { opacity: 0.6 }]} onPress={submit} disabled={submitting || !schoolId} accessibilityRole="button">
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send Request</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { backgroundColor: c.cardDark, borderRadius: 20, borderWidth: 1, borderColor: c.borderColor, padding: 22, width: '100%', maxWidth: 420, gap: 12, ...(Platform.OS === 'web' ? { maxHeight: '85vh' as any } : {}) },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerIcon: { width: 30, height: 30, borderRadius: radius.sm, backgroundColor: `${c.accentYellow}22`, alignItems: 'center', justifyContent: 'center' },
    title: { flex: 1, fontFamily: fonts.serif, fontSize: 17, fontWeight: '800', color: c.textHeading },
    subtitle: { fontFamily: fonts.serif, fontSize: 12.5, color: c.textMuted, lineHeight: 18 },
    fieldLabel: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 4 },
    schoolList: { maxHeight: 180, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm },
    schoolRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderColor },
    schoolRowActive: { backgroundColor: `${c.accentYellow}12` },
    schoolName: { flex: 1, fontFamily: fonts.serif, fontSize: 13.5, color: c.textMuted },
    emptyHint: { fontFamily: fonts.serif, fontSize: 12.5, color: c.textDim, padding: 14, textAlign: 'center' },
    gradeRow: { flexDirection: 'row', gap: 12, zIndex: 5 },
    select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: c.bgDark },
    selectText: { flex: 1, fontFamily: fonts.serif, fontSize: 14, color: c.textHeading },
    input: { borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: c.bgDark, fontFamily: fonts.serif, fontSize: 13.5, color: c.textHeading },
    dropdown: { marginTop: 4, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, backgroundColor: c.cardDark, overflow: 'hidden' },
    dropdownRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderColor },
    dropdownText: { fontFamily: fonts.serif, fontSize: 13.5, color: c.textMuted },
    error: { fontFamily: fonts.serif, fontSize: 12.5, color: c.accentRed, marginTop: 2 },
    primaryBtn: { backgroundColor: c.accentYellow, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: 8, width: '100%' },
    primaryBtnText: { fontFamily: fonts.serif, fontSize: 14.5, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
    successBox: { alignItems: 'center', gap: 12, paddingVertical: 14, width: '100%' },
    successIconOuter: { width: 68, height: 68, borderRadius: 34, backgroundColor: `${c.accentGreen || '#2E7D5B'}15`, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    successIconInner: { width: 48, height: 48, borderRadius: 24, backgroundColor: `${c.accentGreen || '#2E7D5B'}30`, alignItems: 'center', justifyContent: 'center' },
    successHeading: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '800', color: c.textHeading, textAlign: 'center' },
    successText: { fontFamily: fonts.serif, fontSize: 13.5, color: c.textMuted, textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 },
    doneBtn: { width: '100%', backgroundColor: c.textHeading, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: 14, ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}) },
    doneBtnText: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: c.cardDark, letterSpacing: 0.4 },
  });
}
