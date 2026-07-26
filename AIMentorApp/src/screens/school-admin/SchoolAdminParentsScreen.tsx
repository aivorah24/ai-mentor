/**
 * School Admin — Parents (dedicated screen per the approved Claude Design
 * IA). "Linked students" is real data from the parent_children table.
 * "Add Parent" is its own full-page screen (SchoolAdminAddParentScreen),
 * matching how Add Student works — not a popup here.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, RefreshControl, Modal } from 'react-native';
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
  const [selectedParent, setSelectedParent] = useState<ParentRow | null>(null);

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
            <TouchableOpacity style={styles.addBtn} onPress={() => navigation?.navigate?.('SchoolAdminAddParent')} accessibilityRole="button">
              <Feather name="user-plus" size={14} color="#0B0B0B" />
              <Text style={styles.addBtnText}>Add Parent</Text>
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
              <Text style={styles.emptyText}>No parents yet. Add your first parent to get started.</Text>
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
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.tr, i === items.length - 1 && styles.trLast]}
                    onPress={() => setSelectedParent(p)}
                    activeOpacity={0.7}
                  >
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
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* Parent detail — rows had no onPress at all before; tapping one did nothing. */}
        <Modal visible={!!selectedParent} transparent animationType="fade" onRequestClose={() => setSelectedParent(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              {selectedParent && (
                <>
                  <View style={styles.modalHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                      <View style={styles.avatar}><Text style={styles.avatarText}>{(selectedParent.name || '?').slice(0, 2).toUpperCase()}</Text></View>
                      <View style={{ minWidth: 0 }}>
                        <Text style={styles.modalTitle} numberOfLines={1}>{selectedParent.name}</Text>
                        <Text style={styles.tdSub} numberOfLines={1}>{selectedParent.email}</Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => setSelectedParent(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Feather name="x" size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Status</Text>
                    <View style={[styles.statusPill, { borderColor: `${statusTint(colors, selectedParent.status)}55`, backgroundColor: `${statusTint(colors, selectedParent.status)}18` }]}>
                      <Text style={[styles.statusPillText, { color: statusTint(colors, selectedParent.status) }]}>{STATUS_LABEL[selectedParent.status]}</Text>
                    </View>
                  </View>

                  {!!selectedParent.joinedAt && (
                    <View style={styles.modalRow}>
                      <Text style={styles.modalLabel}>Joined</Text>
                      <Text style={styles.modalValue}>{selectedParent.joinedAt}</Text>
                    </View>
                  )}

                  <Text style={[styles.modalLabel, { marginTop: 14, marginBottom: 6 }]}>Linked students</Text>
                  {selectedParent.linkedStudents.length === 0 ? (
                    <Text style={styles.modalValue}>None linked yet.</Text>
                  ) : (
                    selectedParent.linkedStudents.map((s) => (
                      <View key={s} style={styles.linkedStudentRow}>
                        <Feather name="user" size={13} color={colors.textDim} />
                        <Text style={styles.modalValue}>{s}</Text>
                      </View>
                    ))
                  )}

                  <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setSelectedParent(null)}>
                    <Text style={styles.modalCloseBtnText}>Close</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </Modal>
      </View>
    </ScreenLayout>
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

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
    modalBox: { width: '100%', maxWidth: 420, backgroundColor: colors.cardDark, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderColor, padding: 20 },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    modalTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700', color: colors.textHeading },
    modalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
    modalLabel: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim },
    modalValue: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted },
    linkedStudentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    modalCloseBtn: { marginTop: 18, alignSelf: 'center', borderRadius: 20, paddingVertical: 9, paddingHorizontal: 22, backgroundColor: colors.accentYellow },
    modalCloseBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },
  });
}
