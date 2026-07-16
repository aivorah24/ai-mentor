/**
 * Repeatable Curriculum + Grade + Subjects editor — lets a teacher be mapped
 * to multiple grade/subject combinations (e.g. Social Studies in Grade 3,
 * Science in Grade 4), instead of one curriculum+grade for the whole record.
 * Shared by SchoolAdminAddTeacherScreen and SchoolAdminEditTeacherScreen.
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Pressable, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';

export type TeachingEntry = { curriculum: string; grade: string; subjectsInput: string };

const CURRICULA = ['IB PYP', 'IB MYP', 'IB DP', 'CBSE', 'ICSE', 'Cambridge'];
function getGradesForCurriculum(curr: string): string[] {
  if (curr === 'IB PYP') return ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'];
  if (curr === 'IB MYP') return ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];
  if (curr === 'IB DP') return ['Grade 11', 'Grade 12'];
  if (curr === 'Cambridge') return ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];
  return ['Nursery', 'LKG', 'UKG', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'];
}
export function curriculaForBase(base: string | null): string[] {
  if (base === 'IB') return ['IB PYP', 'IB MYP', 'IB DP'];
  if (base && CURRICULA.includes(base)) return [base];
  return CURRICULA;
}
export function defaultCurriculumForBase(base: string | null): string {
  if (!base) return '';
  return CURRICULA.includes(base) ? base : '';
}
export function emptyEntry(defaultCurriculum = ''): TeachingEntry {
  return { curriculum: defaultCurriculum, grade: '', subjectsInput: '' };
}

function FormDropdown({ value, placeholder, options, onChange, colors, open, onToggle }: {
  value: string; placeholder: string; options: { value: string; label: string }[];
  onChange: (v: string) => void; colors: AppColors; open: boolean; onToggle: () => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const current = options.find((o) => o.value === value)?.label || placeholder;
  return (
    <View style={{ position: 'relative' }}>
      <Pressable style={styles.ddTrigger} onPress={onToggle} accessibilityRole="button">
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
                <Pressable key={o.value} style={({ hovered }: any) => [styles.ddItem, Platform.OS === 'web' && hovered && styles.ddItemHovered, o.value === value && styles.ddItemActive]} onPress={() => { onChange(o.value); onToggle(); }}>
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

export default function TeachingEntriesEditor({
  entries, onChange, schoolCurriculumBase, colors, openDropdown, setOpenDropdown,
}: {
  entries: TeachingEntry[];
  onChange: (entries: TeachingEntry[]) => void;
  schoolCurriculumBase: string | null;
  colors: AppColors;
  openDropdown: string | null;
  setOpenDropdown: (v: string | null) => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const curriculumOptions = useMemo(() => curriculaForBase(schoolCurriculumBase).map((c) => ({ value: c, label: c })), [schoolCurriculumBase]);

  function updateEntry(idx: number, patch: Partial<TeachingEntry>) {
    onChange(entries.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function addEntry() {
    onChange([...entries, emptyEntry(defaultCurriculumForBase(schoolCurriculumBase))]);
  }
  function removeEntry(idx: number) {
    onChange(entries.filter((_, i) => i !== idx));
  }

  return (
    <View>
      {entries.map((entry, idx) => {
        const gradeOptions = entry.curriculum ? getGradesForCurriculum(entry.curriculum).map((g) => ({ value: g, label: g })) : [];
        const curriculumKey = `${idx}-curriculum`;
        const gradeKey = `${idx}-grade`;
        const rowOpen = openDropdown === curriculumKey || openDropdown === gradeKey;
        return (
          <View key={idx} style={[styles.entryCard, rowOpen && { zIndex: 30 }]}>
            {entries.length > 1 && (
              <TouchableOpacity style={styles.removeBtn} onPress={() => removeEntry(idx)} accessibilityRole="button">
                <Feather name="trash-2" size={14} color={colors.accentRed || '#F87171'} />
              </TouchableOpacity>
            )}
            <View style={[styles.formRow, rowOpen && { zIndex: 23 }]}>
              <View style={[{ flex: 1 }, openDropdown === curriculumKey && { zIndex: 22 }]}>
                <Text style={styles.formLabel}>Curriculum</Text>
                <FormDropdown
                  value={entry.curriculum} placeholder="Select curriculum" options={curriculumOptions}
                  onChange={(v) => updateEntry(idx, { curriculum: v, grade: '' })} colors={colors}
                  open={openDropdown === curriculumKey} onToggle={() => setOpenDropdown(openDropdown === curriculumKey ? null : curriculumKey)}
                />
              </View>
              <View style={[{ flex: 1 }, openDropdown === gradeKey && { zIndex: 21 }]}>
                <Text style={styles.formLabel}>Grade</Text>
                <FormDropdown
                  value={entry.grade} placeholder={entry.curriculum ? 'Select grade' : 'Pick curriculum first'} options={gradeOptions}
                  onChange={(v) => updateEntry(idx, { grade: v })} colors={colors}
                  open={openDropdown === gradeKey} onToggle={() => { if (entry.curriculum) setOpenDropdown(openDropdown === gradeKey ? null : gradeKey); }}
                />
              </View>
            </View>
            <Text style={styles.formLabel}>Subjects for this grade (comma-separated)</Text>
            <TextInput
              value={entry.subjectsInput} onChangeText={(v) => updateEntry(idx, { subjectsInput: v })}
              style={styles.textInput} placeholder="e.g. Social Studies" placeholderTextColor={colors.textDim}
            />
          </View>
        );
      })}
      <TouchableOpacity style={styles.addEntryBtn} onPress={addEntry} accessibilityRole="button">
        <Feather name="plus" size={14} color={colors.accentYellow} />
        <Text style={styles.addEntryTxt}>Add another grade</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    entryCard: { backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
    removeBtn: { alignSelf: 'flex-end', padding: 4, marginBottom: 2 },
    formRow: { flexDirection: 'row', gap: 14 },
    formLabel: { fontFamily: fonts.serif, fontSize: 11.5, fontWeight: '600', color: colors.textMuted, marginBottom: 6, marginTop: 10 },
    textInput: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMain, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.cardDark },
    ddTrigger: { borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, height: 40, backgroundColor: colors.cardDark, justifyContent: 'center' },
    ddTriggerText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textHeading, flexShrink: 1 },
    ddBackdropWeb: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 19 },
    ddBackdropNative: { position: 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 19 },
    ddMenu: { position: 'absolute', top: 44, left: 0, right: 0, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 4, zIndex: 21, maxHeight: 240, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
    ddItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 9 },
    ddItemHovered: { backgroundColor: colors.cardHover },
    ddItemActive: { backgroundColor: `${colors.accentYellow}14` },
    ddItemText: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted },
    ddItemTextActive: { color: colors.textHeading, fontWeight: '700' },
    addEntryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, justifyContent: 'center', borderWidth: 1, borderColor: `${colors.accentYellow}60`, borderRadius: radius.md, borderStyle: 'dashed' as const },
    addEntryTxt: { fontFamily: fonts.serif, color: colors.accentYellow, fontSize: 13, fontWeight: '600' },
  });
}
