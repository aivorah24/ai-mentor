/**
 * PeriodEditorModal — lets a template owner (school admin / homeroom teacher)
 * edit the bell structure: add / remove / reorder periods, change start-end
 * times, and mark break rows. Saves the whole period_defs array via
 * PUT /timetable/template. Slots keyed by period_code survive as long as the
 * code still exists.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, TextInput, ScrollView, ActivityIndicator, Switch } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import { PeriodDef } from '../api/timetableApi';

// ── 12-hour time helpers ─────────────────────────────────────────────────────
// Times are stored as 24-hour "HH:MM" (backend + grid) but shown/picked in
// friendly 12-hour form. The editor uses a tap-to-pick dropdown (no typing, no
// AM/PM toggle) so the row stays clean and unambiguous.
const pad = (n: number) => String(n).padStart(2, '0');
function fmt12(v: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
  if (!m) return '';
  let h = +m[1]; const mn = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${mn} ${ampm}`;
}
// Selectable times: 6:00 AM → 8:00 PM in 5-minute steps.
const TIME_OPTIONS: { value: string; label: string }[] = [];
for (let h = 6; h <= 20; h++) {
  for (let m = 0; m < 60; m += 5) {
    const v = `${pad(h)}:${pad(m)}`;
    TIME_OPTIONS.push({ value: v, label: fmt12(v) });
  }
}

let _uidSeq = 0;
type Row = PeriodDef & { _uid: number };

function TimePickerField({ value, onChange, styles, colors }: { value: string; onChange: (v: string) => void; styles: any; colors: AppColors }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity style={styles.timeBtn} onPress={() => setOpen(true)} accessibilityRole="button">
        <Text style={[styles.timeBtnText, !value && { color: colors.textDim }]} numberOfLines={1}>{value ? fmt12(value) : 'Set'}</Text>
        <Feather name="chevron-down" size={13} color={colors.textMuted} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.pickerCard}>
            <ScrollView showsVerticalScrollIndicator>
              {TIME_OPTIONS.map((o) => (
                <TouchableOpacity key={o.value} style={[styles.pickerRow, o.value === value && styles.pickerRowActive]} onPress={() => { onChange(o.value); setOpen(false); }} accessibilityRole="button">
                  <Text style={[styles.pickerText, o.value === value && { color: colors.accentYellow, fontWeight: '800' }]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

export default function PeriodEditorModal({
  visible, onClose, initial, saving, onSave,
}: {
  visible: boolean;
  onClose: () => void;
  initial: PeriodDef[];
  saving?: boolean;
  onSave: (periods: PeriodDef[]) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setError('');
    const base = initial.length ? initial : [{ code: 'P1', start: '08:00', end: '08:50', isBreak: false }];
    setRows(base.map((p) => ({ ...p, _uid: ++_uidSeq })));
  }, [visible, initial]);

  const update = (i: number, patch: Partial<PeriodDef>) => setRows((r) => r.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  const remove = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => setRows((r) => {
    const j = i + dir;
    if (j < 0 || j >= r.length) return r;
    const copy = [...r]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
  });
  // Auto-generate a label that isn't already used (labels must be unique because
  // subject slots are keyed by period code). Breaks default to BRK / BRK2 / ...,
  // periods to the next free P number.
  const uniqueCode = (rows: Row[], base: string, startN: number): string => {
    const used = new Set(rows.map((x) => x.code.trim().toUpperCase()));
    let code = base + (startN >= 0 ? String(startN) : '');
    let n = startN < 0 ? 2 : startN + 1;
    while (used.has(code.toUpperCase())) { code = base + (base === 'BRK' ? String(n) : String(n)); n++; }
    return code;
  };
  const addPeriod = () => setRows((r) => [...r, { code: uniqueCode(r, 'P', r.filter((x) => !x.isBreak).length), start: '', end: '', isBreak: false, _uid: ++_uidSeq }]);
  // Breaks never hold subjects, so multiple can share the label "BRK" (cleaner
  // than BRK2/BRK3). Only teaching periods need unique codes.
  const addBreak = () => setRows((r) => [...r, { code: 'BRK', start: '', end: '', isBreak: true, _uid: ++_uidSeq }]);

  const TIME_RE = /^\d{1,2}:\d{2}$/;
  const submit = () => {
    const clean = rows.map((p) => ({ code: p.code.trim(), start: p.start.trim(), end: p.end.trim(), isBreak: !!p.isBreak }));
    if (clean.some((p) => !p.code)) { setError('Every period needs a label (e.g. P1, BRK).'); return; }
    if (clean.some((p) => (p.start && !TIME_RE.test(p.start)) || (p.end && !TIME_RE.test(p.end)))) {
      setError('Times must look like 08:50 (24-hour HH:MM).'); return;
    }
    // Only teaching periods need unique codes (subjects are keyed by them).
    // Break rows carry no subjects, so several may share "BRK"/"Lunch".
    const teachingCodes = clean.filter((p) => !p.isBreak).map((p) => p.code.toUpperCase());
    if (new Set(teachingCodes).size !== teachingCodes.length) { setError('Class period labels (P1, P2 …) must each be unique.'); return; }
    onSave(clean);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Manage periods</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>Set the bell schedule — labels, times, and break rows. Add periods after Lunch here.</Text>

          <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator>
            {/* Column headers */}
            <View style={styles.rowHead}>
              <Text style={[styles.hCell, { width: 50 }]}>Label</Text>
              <Text style={[styles.hCell, { width: 100 }]}>Start</Text>
              <Text style={[styles.hCell, { width: 100 }]}>End</Text>
              <Text style={[styles.hCell, { width: 46, textAlign: 'center' }]}>Break</Text>
              <View style={{ width: 66 }} />
            </View>
            {rows.map((p, i) => (
              <View key={p._uid} style={styles.row}>
                <TextInput style={[styles.cellInput, { width: 50 }]} value={p.code} onChangeText={(t) => update(i, { code: t })} placeholder="P1" placeholderTextColor={colors.textDim} autoCapitalize="characters" />
                <TimePickerField value={p.start} onChange={(v) => update(i, { start: v })} styles={styles} colors={colors} />
                <TimePickerField value={p.end} onChange={(v) => update(i, { end: v })} styles={styles} colors={colors} />
                <View style={styles.breakCell}>
                  <Switch value={p.isBreak} onValueChange={(v) => update(i, { isBreak: v })} />
                </View>
                <View style={styles.rowActions}>
                  <TouchableOpacity onPress={() => move(i, -1)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}><Feather name="chevron-up" size={16} color={colors.textMuted} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => move(i, 1)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}><Feather name="chevron-down" size={16} color={colors.textMuted} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => remove(i)} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}><Feather name="trash-2" size={15} color={colors.accentRed} /></TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.addRow}>
            <TouchableOpacity style={styles.addBtn} onPress={addPeriod} accessibilityRole="button"><Feather name="plus" size={13} color={colors.accentYellow} /><Text style={styles.addText}>Add period</Text></TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={addBreak} accessibilityRole="button"><Feather name="coffee" size={13} color={colors.accentYellow} /><Text style={styles.addText}>Add break</Text></TouchableOpacity>
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={submit} accessibilityRole="button">
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save bell schedule</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    card: { backgroundColor: c.cardDark, borderRadius: 18, borderWidth: 1, borderColor: c.borderColor, padding: 20, width: '100%', maxWidth: 600, gap: 10 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '800', color: c.textHeading },
    subtitle: { fontFamily: fonts.serif, fontSize: 12.5, color: c.textMuted, lineHeight: 18 },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 6 },
    hCell: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'nowrap' },
    cellInput: { flexShrink: 0, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 8, fontFamily: fonts.serif, fontSize: 13, color: c.textHeading, backgroundColor: c.bgDark },
    timeBtn: { flexShrink: 0, width: 100, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: c.bgDark },
    timeBtnText: { fontFamily: fonts.serif, fontSize: 13, color: c.textHeading },
    pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    pickerCard: { backgroundColor: c.cardDark, borderRadius: 14, borderWidth: 1, borderColor: c.borderColor, width: 200, maxHeight: 320, overflow: 'hidden' },
    pickerRow: { paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.borderColor },
    pickerRowActive: { backgroundColor: c.accentYellow + '14' },
    pickerText: { fontFamily: fonts.serif, fontSize: 14, color: c.textMuted },
    breakCell: { flexShrink: 0, width: 46, alignItems: 'center' },
    rowActions: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 8, width: 66, justifyContent: 'flex-end' },
    addRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderStyle: 'dashed', borderColor: c.accentYellow + '66', borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9 },
    addText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: c.accentYellow },
    error: { fontFamily: fonts.serif, fontSize: 12.5, color: c.accentRed },
    saveBtn: { backgroundColor: c.accentYellow, borderRadius: radius.sm, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
    saveText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '800', color: '#fff' },
  });
}
