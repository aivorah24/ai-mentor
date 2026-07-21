/**
 * SlotDetailModal — read/edit surface for a single timetable cell (one day x
 * period). Read view for students/parents; template owners & subject teachers
 * get an Edit view (subject, room, lesson material, or clear the slot).
 * Shared by TimetableScreen and ClassTimetableTab so behaviour is identical.
 */
import React, { useMemo, useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Platform, Linking, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import SERVER_URL from '../../../config/serverUrl';
import { PeriodDef, TimetableSlot, fmtTime, SUBJECT_PALETTE } from '../api/timetableApi';

export interface SlotEdit {
  subject: string; room: string;
  materialUrl: string | null; materialName: string | null;
  color: string | null;
}

export default function SlotDetailModal({
  visible, onClose, classLabel, dayLabel, period, slot, canEdit, saving, onSave, onClear,
}: {
  visible: boolean;
  onClose: () => void;
  classLabel: string;
  dayLabel: string;
  period: PeriodDef | null;
  slot: TimetableSlot | null;
  canEdit: boolean;
  saving?: boolean;
  onSave: (edit: SlotEdit) => void;
  onClear: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState('');
  const [room, setRoom] = useState('');
  const [materialUrl, setMaterialUrl] = useState<string | null>(null);
  const [materialName, setMaterialName] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // Reset local edit state whenever the modal (re)opens for a slot.
  useEffect(() => {
    if (!visible) return;
    setEditing(false); setError('');
    setSubject(slot?.subject || '');
    setRoom(slot?.room || '');
    setMaterialUrl(slot?.materialUrl || null);
    setMaterialName(slot?.materialName || null);
    setColor(slot?.color || null);
  }, [visible, slot]);

  const isBreak = !!period?.isBreak;

  // Web-input file picker (same pattern as PortfolioComposerModal) — avoids a
  // native document-picker dependency; native users attach from the web app.
  const pickAndUpload = () => {
    if (Platform.OS !== 'web') {
      Alert.alert('Lesson material', 'Please attach material from the web app.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.png,.jpg,.jpeg,.gif,.webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { setError('Files must be under 10 MB.'); return; }
      setUploading(true); setError('');
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`${SERVER_URL}/messages/upload`, { method: 'POST', body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) throw new Error(data?.error || 'Upload failed');
        setMaterialUrl(data.url); setMaterialName(data.name || file.name || 'material');
      } catch (e: any) {
        setError(e?.message || 'Could not attach the file');
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const openMaterial = () => { if (materialUrl) Linking.openURL(materialUrl); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{classLabel}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {canEdit && !editing && !isBreak && (
                <TouchableOpacity onPress={() => setEditing(true)} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Feather name="edit-2" size={16} color={colors.accentYellow} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Period + time (always shown) */}
          <Field label="Period" value={period ? `${period.code}${isBreak ? ' · Break' : ''}` : '—'} styles={styles} />
          <Field label="Time" value={period ? `${fmtTime(period.start)} – ${fmtTime(period.end)}` : '—'} styles={styles} />
          <Field label="Day" value={dayLabel} styles={styles} />

          {isBreak ? (
            <Text style={styles.breakNote}>This is a scheduled break.</Text>
          ) : editing ? (
            <>
              <Text style={styles.fieldLabel}>Subject</Text>
              <TextInput style={styles.input} value={subject} onChangeText={setSubject} placeholder="e.g. Mathematics" placeholderTextColor={colors.textDim} />
              <Text style={styles.fieldLabel}>Room</Text>
              <TextInput style={styles.input} value={room} onChangeText={setRoom} placeholder="e.g. PYP 3 Homeroom" placeholderTextColor={colors.textDim} />

              <Text style={styles.fieldLabel}>Lesson material</Text>
              {materialUrl ? (
                <View style={styles.materialRow}>
                  <Feather name="paperclip" size={14} color={colors.accentYellow} />
                  <Text style={styles.materialName} numberOfLines={1}>{materialName || 'Attachment'}</Text>
                  <TouchableOpacity onPress={() => { setMaterialUrl(null); setMaterialName(null); }} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Feather name="x" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.attachBtn} onPress={pickAndUpload} disabled={uploading} accessibilityRole="button">
                  {uploading ? <ActivityIndicator color={colors.accentYellow} /> : (<><Feather name="paperclip" size={14} color={colors.accentYellow} /><Text style={styles.attachText}>Attach PDF or image</Text></>)}
                </TouchableOpacity>
              )}

              <Text style={styles.fieldLabel}>Colour</Text>
              <View style={styles.swatchRow}>
                {SUBJECT_PALETTE.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchActive]}
                    onPress={() => setColor(c)}
                    accessibilityRole="button"
                  >
                    {color === c && <Feather name="check" size={13} color="#333" />}
                  </TouchableOpacity>
                ))}
                {/* Auto = clear override, fall back to subject-derived colour */}
                <TouchableOpacity style={[styles.swatch, styles.swatchAuto, !color && styles.swatchActive]} onPress={() => setColor(null)} accessibilityRole="button">
                  <Text style={styles.swatchAutoText}>Auto</Text>
                </TouchableOpacity>
              </View>

              {!!error && <Text style={styles.error}>{error}</Text>}

              <View style={styles.editBtns}>
                {slot?.subject && (
                  <TouchableOpacity style={styles.clearBtn} onPress={onClear} disabled={saving} accessibilityRole="button">
                    <Feather name="trash-2" size={13} color={colors.accentRed} />
                    <Text style={styles.clearText}>Clear</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.saveBtn, (saving || !subject.trim()) && { opacity: 0.6 }]}
                  disabled={saving || !subject.trim()}
                  onPress={() => onSave({ subject: subject.trim(), room: room.trim(), materialUrl, materialName, color })}
                  accessibilityRole="button"
                >
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Field label="Subject" value={slot?.subject || 'Free period'} styles={styles} strong />
              {!!slot?.room && <Field label="Room" value={slot.room} styles={styles} />}
              {!!slot?.teacherName && <Field label="Teacher" value={slot.teacherName} styles={styles} />}
              {!!slot?.materialUrl && (
                <TouchableOpacity style={styles.materialChip} onPress={openMaterial} accessibilityRole="button">
                  <Feather name="paperclip" size={13} color={colors.accentYellow} />
                  <Text style={styles.materialChipText} numberOfLines={1}>{slot.materialName || 'View material'}</Text>
                  <Feather name="external-link" size={12} color={colors.accentYellow} />
                </TouchableOpacity>
              )}
              {canEdit && (
                <TouchableOpacity style={styles.editCta} onPress={() => setEditing(true)} accessibilityRole="button">
                  <Feather name="edit-2" size={14} color="#fff" />
                  <Text style={styles.editCtaText}>{slot?.subject ? 'Edit this slot' : 'Add a subject'}</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, value, styles, strong }: { label: string; value: string; styles: any; strong?: boolean }) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, strong && styles.fieldValueStrong]}>{value}</Text>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { backgroundColor: c.cardDark, borderRadius: 18, borderWidth: 1, borderColor: c.borderColor, padding: 22, width: '100%', maxWidth: 380, gap: 8 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    title: { flex: 1, fontFamily: fonts.serif, fontSize: 17, fontWeight: '800', color: c.textHeading },
    fieldBlock: { marginTop: 8 },
    fieldLabel: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3, marginTop: 8 },
    fieldValue: { fontFamily: fonts.serif, fontSize: 14, color: c.textMuted },
    fieldValueStrong: { fontSize: 16, fontWeight: '700', color: c.textHeading },
    breakNote: { fontFamily: fonts.serif, fontSize: 13, color: c.textMuted, marginTop: 12 },
    input: { borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.serif, fontSize: 14, color: c.textHeading, backgroundColor: c.bgDark },
    attachBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: c.accentYellow + '66', borderRadius: radius.sm, paddingVertical: 11, marginTop: 2 },
    attachText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: c.accentYellow },
    materialRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 },
    materialName: { flex: 1, fontFamily: fonts.serif, fontSize: 13, color: c.textMuted },
    materialChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.accentYellow + '18', borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10 },
    materialChipText: { flex: 1, fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: c.accentYellow },
    editCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.accentYellow, borderRadius: radius.sm, paddingVertical: 12, marginTop: 16 },
    editCtaText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '800', color: '#fff' },
    swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
    swatch: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.borderColor },
    swatchActive: { borderWidth: 2, borderColor: c.accentYellow },
    swatchAuto: { backgroundColor: c.bgDark, paddingHorizontal: 4, width: 44 },
    swatchAutoText: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '700', color: c.textMuted },
    error: { fontFamily: fonts.serif, fontSize: 12.5, color: c.accentRed, marginTop: 8 },
    editBtns: { flexDirection: 'row', gap: 10, marginTop: 16 },
    clearBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingVertical: 12, paddingHorizontal: 16 },
    clearText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: c.accentRed },
    saveBtn: { flex: 1, backgroundColor: c.accentYellow, borderRadius: radius.sm, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
    saveText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '800', color: '#fff' },
  });
}
