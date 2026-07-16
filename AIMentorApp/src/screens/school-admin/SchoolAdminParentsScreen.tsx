/**
 * School Admin — Parents (dedicated screen per the approved Claude Design
 * IA). "Linked students" is real data from the parent_children table.
 * Invite Parent optionally links one student at creation time.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl, TextInput, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface ParentRow {
  id: string;
  name: string;
  email: string;
  linkedStudents: string[];
  status: 'invited' | 'active' | 'inactive' | 'archived';
  joinedAt: string;
}

interface StudentOption { id: string; name: string; }

const STATUS_LABEL: Record<string, string> = { invited: 'Invited', active: 'Active', inactive: 'Inactive', archived: 'Archived' };
function statusTint(colors: AppColors, status: string): string {
  if (status === 'active') return colors.accentGreen;
  if (status === 'invited') return colors.accentYellow;
  return colors.textDim;
}

export default function SchoolAdminParentsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const [items, setItems] = useState<ParentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{ name: string; email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    if (!user?.email) return;
    setError('');
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/parents?adminEmail=${encodeURIComponent(user.email)}`);
      const data = await res.json().catch(() => ([]));
      if (!res.ok) { setError((data as any)?.error || 'Failed to load parents'); return; }
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed to load parents. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.email]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="Parents" subtitle={`${items.length} parent${items.length === 1 ? '' : 's'} in your school`} onMenuPress={() => navigation?.openDrawer?.()} />
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accentYellow} />}
        >
          <View style={styles.toolbar}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.addBtn} onPress={() => setAddOpen(true)} accessibilityRole="button">
              <Feather name="user-plus" size={14} color="#0B0B0B" />
              <Text style={styles.addBtnText}>Invite Parent</Text>
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
              <Feather name="heart" size={28} color={colors.textDim} />
              <Text style={styles.emptyText}>No parents yet. Invite your first parent to get started.</Text>
            </View>
          ) : (
            <View style={styles.table}>
              <View style={styles.theadRow}>
                <View style={styles.thNameCol}><Text style={styles.thText}>Parent / Guardian</Text></View>
                <View style={styles.thLinkCol}><Text style={styles.thText}>Linked students</Text></View>
                <View style={styles.thStatusCol}><Text style={styles.thText}>Status</Text></View>
              </View>
              {items.map((p, i) => {
                const tint = statusTint(colors, p.status);
                return (
                  <View key={p.id} style={[styles.tr, i === items.length - 1 && styles.trLast]}>
                    <View style={styles.thNameCol}>
                      <View style={styles.nameCell}>
                        <View style={styles.avatar}><Text style={styles.avatarText}>{(p.name || '?').slice(0, 2).toUpperCase()}</Text></View>
                        <View style={{ minWidth: 0 }}>
                          <Text style={styles.tdName} numberOfLines={1}>{p.name}</Text>
                          <Text style={styles.tdSub} numberOfLines={1}>{p.email}</Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.thLinkCol}>
                      <Text style={styles.td} numberOfLines={1}>{p.linkedStudents.length ? p.linkedStudents.join(', ') : 'None linked'}</Text>
                    </View>
                    <View style={styles.thStatusCol}>
                      <View style={[styles.statusPill, { borderColor: `${tint}55`, backgroundColor: `${tint}18` }]}>
                        <Text style={[styles.statusPillText, { color: tint }]}>{STATUS_LABEL[p.status]}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>

      <InviteParentModal
        visible={addOpen}
        colors={colors}
        adminEmail={user?.email}
        onClose={() => setAddOpen(false)}
        onCreated={(c) => { setAddOpen(false); setCreatedCreds(c); load(); }}
      />

      <Modal visible={!!createdCreds} transparent animationType="fade" onRequestClose={() => setCreatedCreds(null)}>
        <View style={styles.overlay}>
          <View style={styles.credCard}>
            <View style={styles.credIcon}><Feather name="check" size={20} color="#0B0B0B" /></View>
            <Text style={styles.credTitle}>Parent invited</Text>
            <Text style={styles.credSub}>Share these sign-in details with the parent. The password won't be shown again.</Text>
            <View style={styles.credRow}><Text style={styles.credLabel}>Name</Text><Text style={styles.credValue}>{createdCreds?.name}</Text></View>
            <View style={styles.credRow}><Text style={styles.credLabel}>Login email</Text><Text style={styles.credValue} selectable>{createdCreds?.email}</Text></View>
            <View style={styles.credRow}><Text style={styles.credLabel}>Password</Text><Text style={styles.credValue} selectable>{createdCreds?.password}</Text></View>
            <TouchableOpacity style={styles.credDoneBtn} onPress={() => setCreatedCreds(null)}>
              <Text style={styles.credDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

function InviteParentModal({ visible, colors, adminEmail, onClose, onCreated }: {
  visible: boolean; colors: AppColors; adminEmail?: string;
  onClose: () => void; onCreated: (c: { name: string; email: string; password: string }) => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useFocusEffect(useCallback(() => {
    if (!visible || !adminEmail) return;
    fetch(`${SERVER_URL}/school-admin/students?adminEmail=${encodeURIComponent(adminEmail)}&limit=100`)
      .then((r) => r.json())
      .then((d) => setStudents((d.items || []).map((s: any) => ({ id: s.id, name: s.name }))))
      .catch(() => {});
  }, [visible, adminEmail]));

  async function submit() {
    if (!adminEmail) return;
    if (!firstName.trim() || !lastName.trim()) { setFormError('First and last name are required.'); return; }
    setSubmitting(true);
    setFormError('');
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/parents?adminEmail=${encodeURIComponent(adminEmail)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), studentId: studentId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setFormError(data?.error || 'Failed to invite parent'); return; }
      onCreated({ name: data.name, email: data.email, password: data.password });
      setFirstName(''); setLastName(''); setStudentId(null);
    } catch {
      setFormError('Failed to invite parent. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.formCard}>
          <View style={styles.formHeader}>
            <Text style={styles.formTitle}>Invite Parent</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={18} color={colors.textDim} />
            </TouchableOpacity>
          </View>
          <View style={styles.formRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.formLabel}>First name</Text>
              <TextInput value={firstName} onChangeText={setFirstName} style={styles.formInput} placeholderTextColor={colors.textDim} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.formLabel}>Last name</Text>
              <TextInput value={lastName} onChangeText={setLastName} style={styles.formInput} placeholderTextColor={colors.textDim} />
            </View>
          </View>
          {students.length > 0 && (
            <>
              <Text style={styles.formLabel}>Link to student (optional)</Text>
              <ScrollView style={{ maxHeight: 140 }} showsVerticalScrollIndicator={false}>
                {students.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.studentOption, studentId === s.id && styles.studentOptionActive]}
                    onPress={() => setStudentId(studentId === s.id ? null : s.id)}
                  >
                    <Feather name={studentId === s.id ? 'check-square' : 'square'} size={14} color={studentId === s.id ? colors.accentYellow : colors.textDim} />
                    <Text style={styles.studentOptionText}>{s.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}
          <Text style={styles.formHint}>A secure temporary password is generated automatically and shown once after creation.</Text>
          {!!formError && <Text style={styles.formError}>{formError}</Text>}
          <View style={styles.formFooter}>
            <TouchableOpacity style={styles.formCancelBtn} onPress={onClose}>
              <Text style={styles.formCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.formSubmitBtn} onPress={submit} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#0B0B0B" size="small" /> : <Text style={styles.formSubmitText}>Invite Parent</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    content: { padding: spacing.xl, paddingBottom: 60, maxWidth: 1080, width: '100%', alignSelf: 'center' },
    toolbar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingHorizontal: 14, height: 36 },
    addBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: '#0B0B0B' },

    table: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, overflow: 'hidden' },
    theadRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, backgroundColor: colors.cardHover, paddingVertical: 10 },
    thText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textDim, paddingHorizontal: 12 },
    thNameCol: { flex: 1.6, minWidth: 180 },
    thLinkCol: { flex: 1.6, minWidth: 160 },
    thStatusCol: { width: 110 },
    tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, paddingVertical: 10 },
    trLast: { borderBottomWidth: 0 },
    nameCell: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
    td: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted, paddingHorizontal: 12 },
    tdName: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading },
    tdSub: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim, marginTop: 1 },

    avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.accentRed}22` },
    avatarText: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '700', color: colors.accentRed },
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

    studentOption: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 6, borderRadius: radius.sm },
    studentOptionActive: { backgroundColor: `${colors.accentYellow}14` },
    studentOptionText: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMain },

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
