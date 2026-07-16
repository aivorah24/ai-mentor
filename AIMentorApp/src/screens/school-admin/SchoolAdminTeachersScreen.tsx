/**
 * School Admin — Teachers (dedicated screen per the approved Claude Design
 * IA, distinct from the generic People roster). Subjects come from real
 * user_preferences.data.teaches (same field the existing admin teacher tools
 * already use). "Class teacher of" from the design is intentionally omitted
 * — no Classes entity exists in the schema yet.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface TeachesEntry { curriculum: string; grade: string; subjects: string[] }
interface TeacherRow {
  id: string;
  name: string;
  email: string;
  subjects: string[];
  teaches: TeachesEntry[];
  grade: string | null;
  curriculum: string | null;
  status: 'invited' | 'active' | 'inactive' | 'archived';
  joinedAt: string;
}

const STATUS_LABEL: Record<string, string> = { invited: 'Invited', active: 'Active', inactive: 'Inactive', archived: 'Archived' };
function statusTint(colors: AppColors, status: string): string {
  if (status === 'active') return colors.accentGreen;
  if (status === 'invited') return colors.accentYellow;
  return colors.textDim;
}

export default function SchoolAdminTeachersScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const [items, setItems] = useState<TeacherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user?.email) return;
    setError('');
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/teachers?adminEmail=${encodeURIComponent(user.email)}`);
      const data = await res.json().catch(() => ([]));
      if (!res.ok) { setError((data as any)?.error || 'Failed to load teachers'); return; }
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed to load teachers. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.email]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="Teachers" subtitle={`${items.length} teacher${items.length === 1 ? '' : 's'} in your school`} onMenuPress={() => navigation?.openDrawer?.()} />
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accentYellow} />}
        >
          <View style={styles.toolbar}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.importBtn} onPress={() => navigation?.navigate?.('SchoolAdminTeacherBulkImport')} accessibilityRole="button">
              <Feather name="upload" size={14} color={colors.textHeading} />
              <Text style={styles.importBtnText}>Import Teachers</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={() => navigation?.navigate?.('SchoolAdminAddTeacher')} accessibilityRole="button">
              <Feather name="user-plus" size={14} color="#0B0B0B" />
              <Text style={styles.addBtnText}>Add Teacher</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40 }} />
          ) : error ? (
            <View style={styles.emptyBox}>
              <Feather name="alert-circle" size={28} color={colors.textDim} />
              <Text style={styles.emptyText}>{error}</Text>
            </View>
          ) : items.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="user" size={28} color={colors.textDim} />
              <Text style={styles.emptyText}>No teachers yet. Add your first teacher to get started.</Text>
            </View>
          ) : (
            <View style={styles.table}>
              <View style={styles.theadRow}>
                <View style={styles.thNameCol}><Text style={styles.thText}>Teacher</Text></View>
                <View style={styles.thGradeCol}><Text style={styles.thText}>Grades taught</Text></View>
                <View style={styles.thSubCol}><Text style={styles.thText}>Subjects</Text></View>
                <View style={styles.thStatusCol}><Text style={styles.thText}>Status</Text></View>
                <View style={styles.thEditCol} />
              </View>
              {items.map((t, i) => {
                const tint = statusTint(colors, t.status);
                const teaches = t.teaches || [];
                const gradeSummary = teaches.length > 0
                  ? teaches.map((e) => `${e.curriculum} · ${e.grade}`).join(', ')
                  : ([t.curriculum, t.grade].filter(Boolean).join(' · ') || '—');
                return (
                  <View key={t.id} style={[styles.tr, i === items.length - 1 && styles.trLast]}>
                    <View style={styles.thNameCol}>
                      <View style={styles.nameCell}>
                        <View style={styles.avatar}><Text style={styles.avatarText}>{(t.name || '?').slice(0, 2).toUpperCase()}</Text></View>
                        <View style={{ minWidth: 0 }}>
                          <Text style={styles.tdName} numberOfLines={1}>{t.name}</Text>
                          <Text style={styles.tdSub} numberOfLines={1}>{t.email}</Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.thGradeCol}>
                      <Text style={styles.td} numberOfLines={2}>{gradeSummary}</Text>
                    </View>
                    <View style={styles.thSubCol}>
                      <Text style={styles.td} numberOfLines={2}>{t.subjects.length ? t.subjects.join(', ') : 'Not assigned'}</Text>
                    </View>
                    <View style={styles.thStatusCol}>
                      <View style={[styles.statusPill, { borderColor: `${tint}55`, backgroundColor: `${tint}18` }]}>
                        <Text style={[styles.statusPillText, { color: tint }]}>{STATUS_LABEL[t.status]}</Text>
                      </View>
                    </View>
                    <View style={styles.thEditCol}>
                      <TouchableOpacity
                        style={styles.editBtn}
                        onPress={() => navigation?.navigate?.('SchoolAdminEditTeacher', { teacher: { id: t.id, name: t.name, email: t.email, teaches } })}
                        accessibilityRole="button"
                      >
                        <Feather name="edit-2" size={14} color={colors.accentYellow} />
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    content: { padding: spacing.xl, paddingBottom: 60, maxWidth: 1080, width: '100%', alignSelf: 'center' },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.lg },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingHorizontal: 14, height: 36 },
    addBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: '#0B0B0B' },
    importBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingHorizontal: 14, height: 36 },
    importBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.textHeading },

    table: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, overflow: 'hidden' },
    theadRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, backgroundColor: colors.cardHover, paddingVertical: 10 },
    thText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textDim, paddingHorizontal: 12 },
    thNameCol: { flex: 1.6, minWidth: 180 },
    thGradeCol: { flex: 1.2, minWidth: 120 },
    thSubCol: { flex: 1.4, minWidth: 140 },
    thStatusCol: { width: 110 },
    thEditCol: { width: 40, alignItems: 'center' },
    editBtn: { padding: 6 },
    tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, paddingVertical: 10 },
    trLast: { borderBottomWidth: 0 },
    nameCell: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
    td: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted, paddingHorizontal: 12 },
    tdName: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading },
    tdSub: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim, marginTop: 1 },

    avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.accentOrange}22` },
    avatarText: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '700', color: colors.accentOrange },
    statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, alignSelf: 'flex-start' },
    statusPillText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700' },

    emptyBox: { alignItems: 'center', paddingTop: 56, gap: 10, paddingHorizontal: 24 },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    formCard: { backgroundColor: colors.cardDark, borderRadius: 20, borderWidth: 1, borderColor: colors.borderColor, padding: 24, width: '100%', maxWidth: 420 },
    formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    formTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '700', color: colors.textHeading },
    formRow: { flexDirection: 'row', gap: 12 },
    formLabel: { fontFamily: fonts.serif, fontSize: 11.5, fontWeight: '600', color: colors.textMuted, marginBottom: 5, marginTop: 8 },
    formInput: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMain, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.bgDark },
    formHint: { fontFamily: fonts.serif, fontSize: 11, color: colors.textDim, marginTop: 8, lineHeight: 16 },
    formError: { fontFamily: fonts.serif, fontSize: 12, color: colors.accentRed, marginTop: 12 },
    formFooter: { flexDirection: 'row', gap: 10, marginTop: 18 },
    formCancelBtn: { flex: 1, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center' },
    formCancelText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textMuted },
    formSubmitBtn: { flex: 1, backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingVertical: 11, alignItems: 'center' },
    formSubmitText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },

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
