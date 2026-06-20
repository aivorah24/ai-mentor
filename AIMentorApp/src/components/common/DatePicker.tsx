import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// All dates handled as local 'YYYY-MM-DD' strings (no timezone drift).
function pad(n: number) { return String(n).padStart(2, '0'); }
function toKey(y: number, m: number, d: number) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function parseKey(v?: string): { y: number; m: number; d: number } | null {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}
function formatDisplay(v?: string): string {
  const p = parseKey(v);
  if (!p) return '';
  return `${WEEKDAYS[new Date(p.y, p.m, p.d).getDay()]}, ${p.d} ${MONTHS[p.m].slice(0, 3)} ${p.y}`;
}

interface Props {
  value: string;                 // 'YYYY-MM-DD'
  onChange: (v: string) => void;
  placeholder?: string;
  minDate?: string;              // 'YYYY-MM-DD' — dates before this are disabled
}

export default function DatePicker({ value, onChange, placeholder = 'Select a date', minDate }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const today = new Date();
  const todayKey = toKey(today.getFullYear(), today.getMonth(), today.getDate());

  const selected = parseKey(value);
  // Which month the calendar is currently showing
  const [view, setView] = useState(() => selected || { y: today.getFullYear(), m: today.getMonth(), d: 1 });
  useEffect(() => { if (selected) setView(v => ({ ...v, y: selected.y, m: selected.m })); }, [value]);

  const uid = useRef('dp_' + Math.random().toString(36).slice(2)).current;
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const handler = (e: MouseEvent) => {
      const el = document.querySelector(`[data-datepicker="${uid}"]`);
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, uid]);

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay();   // 0=Sun
    const days = new Date(view.y, view.m + 1, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < first; i++) arr.push(null);
    for (let d = 1; d <= days; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [view.y, view.m]);

  const prevMonth = () => setView(v => { const d = new Date(v.y, v.m - 1, 1); return { y: d.getFullYear(), m: d.getMonth(), d: 1 }; });
  const nextMonth = () => setView(v => { const d = new Date(v.y, v.m + 1, 1); return { y: d.getFullYear(), m: d.getMonth(), d: 1 }; });

  return (
    // @ts-ignore — data attr for web outside-click
    <View data-datepicker={uid} style={{ position: 'relative', zIndex: open ? 1000 : 1 }}>
      <TouchableOpacity
        style={[s.field, { backgroundColor: colors.cardDark, borderColor: open ? colors.primary : colors.borderColor }]}
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.8}
      >
        <Feather name="calendar" size={15} color={colors.primary} style={{ marginRight: 8 }} />
        <Text style={[s.fieldText, { color: value ? colors.textMain : colors.textDim, flex: 1 }]}>
          {value ? formatDisplay(value) : placeholder}
        </Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textDim} />
      </TouchableOpacity>

      {open && (
        <View style={[s.popover, {
          backgroundColor: colors.cardDark, borderColor: colors.borderColor,
          // @ts-ignore
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 1000,
        }]}>
          {/* Header: month + nav */}
          <View style={s.header}>
            <Text style={[s.monthLabel, { color: colors.textMain }]}>{MONTHS[view.m]} {view.y}</Text>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <TouchableOpacity onPress={prevMonth} style={[s.navBtn, { borderColor: colors.borderColor }]} activeOpacity={0.7}>
                <Feather name="chevron-left" size={16} color={colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={nextMonth} style={[s.navBtn, { borderColor: colors.borderColor }]} activeOpacity={0.7}>
                <Feather name="chevron-right" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Weekday row */}
          <View style={s.weekRow}>
            {WEEKDAYS.map(w => (
              <Text key={w} style={[s.weekday, { color: colors.textDim }]}>{w}</Text>
            ))}
          </View>

          {/* Day grid */}
          <View style={s.grid}>
            {cells.map((d, i) => {
              if (d === null) return <View key={i} style={s.cell} />;
              const key = toKey(view.y, view.m, d);
              const isSelected = value === key;
              const isToday = key === todayKey;
              const disabled = !!minDate && key < minDate;
              return (
                <TouchableOpacity
                  key={i}
                  style={s.cell}
                  disabled={disabled}
                  activeOpacity={0.7}
                  onPress={() => { onChange(key); setOpen(false); }}
                >
                  <View style={[
                    s.dayPill,
                    isToday && !isSelected && { borderWidth: 1.5, borderColor: colors.primary },
                    isSelected && { backgroundColor: colors.primary },
                  ]}>
                    <Text style={[
                      s.dayText,
                      { color: disabled ? colors.textDim : colors.textMain },
                      isToday && !isSelected && { color: colors.primary, fontWeight: '700' },
                      isSelected && { color: '#fff', fontWeight: '700' },
                      disabled && { opacity: 0.35 },
                    ]}>{d}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Footer */}
          <View style={[s.footer, { borderTopColor: colors.borderColor }]}>
            <TouchableOpacity onPress={() => { onChange(''); setOpen(false); }} activeOpacity={0.7}>
              <Text style={[s.footerBtn, { color: colors.textMuted }]}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { onChange(todayKey); setOpen(false); }} activeOpacity={0.7}>
              <Text style={[s.footerBtn, { color: colors.primary }]}>Today</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const CELL = 38;
const s = StyleSheet.create({
  field:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10, borderWidth: 1 },
  fieldText:  { fontSize: 14, fontWeight: '500' },
  popover:    { width: CELL * 7 + 24, borderWidth: 1, borderRadius: 14, padding: 12,
                // @ts-ignore
                boxShadow: '0 8px 28px rgba(0,0,0,0.35)' },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  monthLabel: { fontSize: 15, fontWeight: '700' },
  navBtn:     { width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  weekRow:    { flexDirection: 'row', marginBottom: 4 },
  weekday:    { width: CELL, textAlign: 'center', fontSize: 11, fontWeight: '700' },
  grid:       { flexDirection: 'row', flexWrap: 'wrap' },
  cell:       { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' },
  dayPill:    { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dayText:    { fontSize: 13, fontWeight: '500' },
  footer:     { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, marginTop: 8, paddingTop: 10 },
  footerBtn:  { fontSize: 13, fontWeight: '700' },
});
