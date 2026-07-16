/**
 * School Admin — Import History. A log of every bulk-import run (students or
 * teachers), who ran it, and its result. Backed by public.import_runs, written
 * once by the server at the end of each bulk-import request (see
 * server/routes/school-admin.js: logImportRun). Per-row result detail isn't
 * persisted (only the run's totals are) — "View results" is a placeholder
 * until that's built, same as the source design's own scoped stub.
 *
 * Contract:
 *   GET /school-admin/import-history?adminEmail=
 *       -> [{ id, type, fileName, runByEmail, importedCount, skippedCount, status, createdAt }]
 */
import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Modal, Pressable } from 'react-native';
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

interface ImportRun {
  id: string;
  type: 'students' | 'teachers';
  fileName: string;
  runByEmail: string;
  importedCount: number;
  skippedCount: number;
  status: string;
  createdAt: string;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function statusTone(colors: AppColors, status: string): { dot: string; text: string; bg: string } {
  if (status === 'Completed') return { dot: colors.accentGreen, text: colors.accentGreen, bg: `${colors.accentGreen}22` };
  if (status === 'Failed') return { dot: colors.accentRed, text: colors.accentRed, bg: `${colors.accentRed}22` };
  return { dot: colors.accentYellow, text: colors.accentYellow, bg: `${colors.accentYellow}26` }; // Completed with errors
}

export default function SchoolAdminImportHistoryScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const { showToast, ToastComponent } = useToast();

  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ImportRun | null>(null);

  const load = useCallback(async () => {
    if (!user?.email) return;
    setError('');
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/import-history?adminEmail=${encodeURIComponent(user.email)}`);
      const data = await res.json().catch(() => ([]));
      if (!res.ok) { setError((data as any)?.error || 'Failed to load import history'); return; }
      setRuns(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed to load import history. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Import History"
          subtitle="Every bulk import, who ran it, and its results."
          onMenuPress={() => navigation?.openDrawer?.()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <Text style={styles.countText}>{runs.length} import{runs.length === 1 ? '' : 's'}</Text>
            <TouchableOpacity style={styles.newImportBtn} onPress={() => navigation?.navigate?.('SchoolAdminBulkImport')} accessibilityRole="button">
              <Feather name="upload" size={14} color="#0B0B0B" />
              <Text style={styles.newImportBtnText}>New Import</Text>
            </TouchableOpacity>
          </View>
          {loading ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40 }} />
          ) : error ? (
            <View style={styles.emptyBox}>
              <Feather name="alert-circle" size={26} color={colors.textDim} />
              <Text style={styles.emptyText}>{error}</Text>
              <TouchableOpacity onPress={() => { setLoading(true); load(); }} style={styles.retryBtn}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : runs.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="clock" size={26} color={colors.textDim} />
              <Text style={styles.emptyText}>No imports yet. Bulk-import a CSV of students or teachers and it'll show up here.</Text>
              <TouchableOpacity onPress={() => navigation?.navigate?.('SchoolAdminBulkImport')} style={styles.retryBtn}>
                <Text style={styles.retryText}>Go to Bulk Import</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.table}>
              <View style={styles.theadRow}>
                <View style={styles.colFile}><Text style={styles.thText}>File</Text></View>
                <View style={styles.colCount}><Text style={styles.thText}>Imported</Text></View>
                <View style={styles.colCount}><Text style={styles.thText}>Skipped</Text></View>
                <View style={styles.colStatus}><Text style={styles.thText}>Status</Text></View>
                <View style={styles.colAction} />
              </View>
              {runs.map((r, i) => {
                const tone = statusTone(colors, r.status);
                return (
                  <View key={r.id} style={[styles.tr, i === runs.length - 1 && styles.trLast]}>
                    <View style={styles.colFile}>
                      <Text style={styles.tdStrong} numberOfLines={1}>{r.fileName}</Text>
                      <Text style={styles.tdSub} numberOfLines={1}>
                        Run by {r.runByEmail === user?.email ? 'you' : r.runByEmail} · {formatWhen(r.createdAt)} · {r.type === 'teachers' ? 'Teachers' : 'Students'}
                      </Text>
                    </View>
                    <View style={styles.colCount}><Text style={styles.td}>{r.importedCount} row{r.importedCount === 1 ? '' : 's'}</Text></View>
                    <View style={styles.colCount}><Text style={styles.td}>{r.skippedCount} row{r.skippedCount === 1 ? '' : 's'}</Text></View>
                    <View style={styles.colStatus}>
                      <View style={[styles.badge, { backgroundColor: tone.bg }]}>
                        <View style={[styles.badgeDot, { backgroundColor: tone.dot }]} />
                        <Text style={[styles.badgeText, { color: tone.text }]}>{r.status}</Text>
                      </View>
                    </View>
                    <View style={styles.colAction}>
                      <TouchableOpacity
                        onPress={() => setSelected(r)}
                        accessibilityRole="button"
                      >
                        <Text style={styles.actionLink}>View results</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelected(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            {selected && (() => {
              const tone = statusTone(colors, selected.status);
              return (
                <>
                  <View style={styles.modalHeader}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.modalTitle} numberOfLines={1}>{selected.fileName}</Text>
                      <Text style={styles.modalSub}>
                        {selected.type === 'teachers' ? 'Teacher import' : 'Student import'} · Run by {selected.runByEmail === user?.email ? 'you' : selected.runByEmail}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => setSelected(null)} style={styles.modalClose} accessibilityRole="button">
                      <Feather name="x" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <View style={[styles.badge, styles.modalStatus, { backgroundColor: tone.bg }]}>
                    <View style={[styles.badgeDot, { backgroundColor: tone.dot }]} />
                    <Text style={[styles.badgeText, { color: tone.text }]}>{selected.status}</Text>
                  </View>

                  <View style={styles.statRow}>
                    <View style={[styles.statCard, { backgroundColor: `${colors.accentGreen}18` }]}>
                      <Text style={[styles.statNum, { color: colors.accentGreen }]}>{selected.importedCount}</Text>
                      <Text style={styles.statLabel}>Imported</Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: selected.skippedCount > 0 ? `${colors.accentYellow}20` : colors.bgDark }]}>
                      <Text style={[styles.statNum, { color: selected.skippedCount > 0 ? colors.accentYellow : colors.textMuted }]}>{selected.skippedCount}</Text>
                      <Text style={styles.statLabel}>Skipped</Text>
                    </View>
                    <View style={[styles.statCard, { backgroundColor: colors.bgDark }]}>
                      <Text style={[styles.statNum, { color: colors.textHeading }]}>{selected.importedCount + selected.skippedCount}</Text>
                      <Text style={styles.statLabel}>Total rows</Text>
                    </View>
                  </View>

                  <View style={styles.metaList}>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Type</Text>
                      <Text style={styles.metaValue}>{selected.type === 'teachers' ? 'Teachers' : 'Students'}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Run by</Text>
                      <Text style={styles.metaValue} numberOfLines={1}>{selected.runByEmail}</Text>
                    </View>
                    <View style={[styles.metaRow, { borderBottomWidth: 0 }]}>
                      <Text style={styles.metaLabel}>When</Text>
                      <Text style={styles.metaValue}>{formatWhen(selected.createdAt)}</Text>
                    </View>
                  </View>

                  {selected.skippedCount > 0 && (
                    <View style={styles.noteBox}>
                      <Feather name="alert-triangle" size={13} color={colors.accentYellow} />
                      <Text style={styles.noteText}>
                        {selected.skippedCount} row{selected.skippedCount === 1 ? ' was' : 's were'} skipped — usually a missing name or a duplicate email already in the system. Re-upload just those rows to add them.
                      </Text>
                    </View>
                  )}
                </>
              );
            })()}
          </Pressable>
        </Pressable>
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
    countText: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textDim },

    newImportBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 7,
      backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingHorizontal: 16, height: 38,
    },
    newImportBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: '#0B0B0B' },

    table: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, overflow: 'hidden' },
    theadRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, backgroundColor: colors.cardHover, paddingVertical: 10 },
    thText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textDim },
    tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, paddingVertical: 12 },
    trLast: { borderBottomWidth: 0 },
    colFile: { flex: 2.4, minWidth: 200, paddingHorizontal: 14 },
    colCount: { flex: 1, minWidth: 90, paddingHorizontal: 14 },
    colStatus: { flex: 1.5, minWidth: 150, paddingHorizontal: 14 },
    colAction: { width: 110, paddingHorizontal: 14, alignItems: 'flex-end' },
    td: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted },
    tdStrong: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: colors.textHeading },
    tdSub: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim, marginTop: 2 },
    actionLink: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },

    badge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999 },
    badgeDot: { width: 6, height: 6, borderRadius: 3 },
    badgeText: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '700' },

    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    modalCard: {
      width: '100%', maxWidth: 440, backgroundColor: colors.cardDark, borderRadius: radius.lg,
      borderWidth: 1, borderColor: colors.borderColor, padding: spacing.xl, gap: spacing.md,
    },
    modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    modalTitle: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700', color: colors.textHeading },
    modalSub: { fontFamily: fonts.serif, fontSize: 12, color: colors.textDim, marginTop: 3 },
    modalClose: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.borderColor, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    modalStatus: { marginTop: 2 },
    statRow: { flexDirection: 'row', gap: 10 },
    statCard: { flex: 1, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', gap: 3 },
    statNum: { fontFamily: fonts.serif, fontSize: 22, fontWeight: '800' },
    statLabel: { fontFamily: fonts.serif, fontSize: 11, color: colors.textMuted, fontWeight: '600' },
    metaList: { borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, paddingHorizontal: 14 },
    metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.borderColor, gap: 16 },
    metaLabel: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted },
    metaValue: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textHeading, flexShrink: 1, textAlign: 'right' },
    noteBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: `${colors.accentYellow}12`, borderRadius: radius.md, padding: 12 },
    noteText: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textMuted, lineHeight: 16, flex: 1 },

    emptyBox: { alignItems: 'center', paddingTop: 56, gap: 12, paddingHorizontal: 24 },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 420 },
    retryBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderColor },
    retryText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.accentYellow },
  });
}
