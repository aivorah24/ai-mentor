/**
 * TimetableGrid — the weekly bell-schedule grid (rows = periods, columns =
 * days). Pastel subject cards, muted full-width break rows, Toddle-style.
 * Tapping a cell calls onCellPress(day, period, slot). Read-only rendering;
 * all editing happens in SlotDetailModal.
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import { Timetable, PeriodDef, TimetableSlot, fmtTime, DAY_LABELS, subjectColor } from '../api/timetableApi';

const COL_W = 150;      // day column width
const TIME_W = 62;      // left time axis width
const ROW_H = 92;       // period row height

export default function TimetableGrid({
  timetable, classLabel, onCellPress,
}: {
  timetable: Timetable;
  classLabel: string;
  onCellPress: (day: string, period: PeriodDef, slot: TimetableSlot | null) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { periodDefs, days, slots } = timetable;

  const slotAt = (day: string, code: string): TimetableSlot | null =>
    slots.find((s) => s.day === day && s.periodCode === code) || null;

  if (!periodDefs || periodDefs.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyTitle}>No bell schedule yet</Text>
        <Text style={styles.emptySub}>Once the class's periods are set up, the weekly timetable appears here.</Text>
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}>
      <View>
        {/* Header row: blank corner + day columns */}
        <View style={styles.row}>
          <View style={[styles.timeCell, styles.headerCell, { width: TIME_W, justifyContent: 'flex-end', paddingBottom: 6 }]}>
            <Text style={{ fontSize: 8.5, fontWeight: '700', color: colors.textDim, textAlign: 'center', lineHeight: 11 }}>GMT{'\n'}+05:30</Text>
          </View>
          {days.map((d) => (
            <View key={d} style={[styles.headerCell, { width: COL_W }]}>
              <Text style={[styles.dayText, d === 'SAT' && { color: colors.accentRed }]}>{DAY_LABELS[d] || d}</Text>
            </View>
          ))}
        </View>

        {/* One row per period */}
        {periodDefs.map((p, pi) => (
          <View key={`${p.code}-${pi}`} style={styles.row}>
            {/* Left time axis */}
            <View style={[styles.timeCell, { width: TIME_W, height: p.isBreak ? undefined : ROW_H }]}>
              <Text style={styles.periodCode}>{p.code}</Text>
              <Text style={styles.timeText}>{fmtTime(p.start)}</Text>
            </View>

            {p.isBreak ? (
              // Break/lunch: one muted full-width strip across all days.
              <View style={[styles.breakStrip, { width: COL_W * days.length }]}>
                <Text style={styles.breakText}>{fmtTime(p.start)} – {fmtTime(p.end)}  ·  {p.code}</Text>
              </View>
            ) : (
              days.map((d) => {
                const slot = slotAt(d, p.code);
                const fill = slot?.color || subjectColor(slot?.subject || null);
                return (
                  <TouchableOpacity
                    key={`${d}-${p.code}`}
                    style={[styles.cell, { width: COL_W, height: ROW_H }]}
                    activeOpacity={0.75}
                    onPress={() => onCellPress(d, p, slot)}
                  >
                    {slot?.subject ? (
                      <View style={[styles.subjectCard, { backgroundColor: fill }]}>
                        <Text style={styles.cardTime}>{fmtTime(p.start)} – {fmtTime(p.end)}</Text>
                        <Text style={styles.cardSubject} numberOfLines={2}>{slot.subject}</Text>
                        {!!slot.room && <Text style={styles.cardRoom} numberOfLines={1}>{slot.room || classLabel}</Text>}
                        {!!slot.materialUrl && (
                          <Text style={styles.cardMaterial}>• material attached</Text>
                        )}
                      </View>
                    ) : (
                      <View style={styles.emptyCell} />
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row' },
    headerCell: { paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderColor: c.borderColor, borderRightWidth: StyleSheet.hairlineWidth },
    dayText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: c.textHeading },
    timeCell: { alignItems: 'center', justifyContent: 'flex-start', paddingTop: 8, borderRightWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark },
    periodCode: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '800', color: c.textMuted },
    timeText: { fontFamily: fonts.serif, fontSize: 10, color: c.textDim, marginTop: 2 },
    cell: { padding: 4, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.borderColor },
    emptyCell: { flex: 1, borderRadius: radius.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: c.borderColor + '80' },
    subjectCard: { flex: 1, borderRadius: radius.sm, padding: 8, justifyContent: 'flex-start' },
    cardTime: { fontFamily: fonts.serif, fontSize: 9.5, color: '#5b5b5b', marginBottom: 2 },
    cardSubject: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '800', color: '#1e1e1e' },
    cardRoom: { fontFamily: fonts.serif, fontSize: 10, color: '#555', marginTop: 3 },
    cardMaterial: { fontFamily: fonts.serif, fontSize: 9, color: '#3a6b4a', marginTop: 3, fontWeight: '700' },
    breakStrip: { backgroundColor: c.bgDark, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.borderColor },
    breakText: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: c.textDim, letterSpacing: 0.4 },
    emptyBox: { alignItems: 'center', padding: spacing.xl, gap: 8 },
    emptyTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '800', color: c.textHeading },
    emptySub: { fontFamily: fonts.serif, fontSize: 12.5, color: c.textMuted, textAlign: 'center' },
  });
}
