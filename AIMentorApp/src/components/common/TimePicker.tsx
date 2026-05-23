import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

// Generate slots from 6:00 AM to 11:45 PM in 15-min increments
const ALL_SLOTS: string[] = [];
for (let h = 6; h < 24; h++) {
  for (const m of [0, 15, 30, 45]) {
    ALL_SLOTS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

export function to12h(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  const m = mStr ?? '00';
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m} ${period}`;
}

interface Props {
  label: string;
  value: string;           // 24h "HH:MM"
  onChange: (v: string) => void;
  minTime?: string;        // 24h — hide slots before this
}

export default function TimePicker({ label, value, onChange, minTime }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<View>(null);

  const slots = minTime
    ? ALL_SLOTS.filter(s => s > minTime)
    : ALL_SLOTS;

  // Close on outside click (web only)
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const handler = (e: MouseEvent) => {
      const el = (containerRef.current as any);
      const domEl = el?._nativeTag ? document.querySelector(`[data-timepicker="${label}"]`) : null;
      if (domEl && !domEl.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, label]);

  return (
    <View style={{ flex: 1 }}>
      <Text style={[s.label, { color: colors.textMuted }]}>{label}</Text>
      {/* @ts-ignore */}
      <View ref={containerRef} data-timepicker={label} style={{ position: 'relative' }}>
        <TouchableOpacity
          style={[s.field, { backgroundColor: colors.cardDark, borderColor: open ? colors.primary : colors.borderColor }]}
          onPress={() => setOpen(o => !o)}
          activeOpacity={0.8}
        >
          <Text style={[s.fieldText, { color: colors.textMain }]}>{to12h(value)}</Text>
          <Text style={[s.chevron, { color: colors.textDim }]}>{open ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {open && (
          <View style={[s.dropdown, { backgroundColor: colors.cardDark, borderColor: colors.borderColor,
            // @ts-ignore
            zIndex: 9999, position: 'absolute', top: '100%', left: 0, right: 0,
          }]}>
            <ScrollView
              style={{ maxHeight: 220 }}
              showsVerticalScrollIndicator={false}
              // scroll selected item into view on open
              onLayout={() => {}}
            >
              {slots.map(slot => {
                const selected = slot === value;
                return (
                  <TouchableOpacity
                    key={slot}
                    style={[s.option, selected && { backgroundColor: colors.primary + '22' }]}
                    onPress={() => { onChange(slot); setOpen(false); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.optionText, { color: selected ? colors.primary : colors.textMain },
                      selected && { fontWeight: '700' }]}>
                      {to12h(slot)}
                    </Text>
                    {selected && <Text style={{ color: colors.primary, fontSize: 12 }}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  label:     { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  field:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
               paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
  fieldText: { fontSize: 14, fontWeight: '500' },
  chevron:   { fontSize: 10, marginLeft: 8 },
  dropdown:  { borderWidth: 1, borderRadius: 8, marginTop: 4,
               // @ts-ignore
               boxShadow: '0 4px 16px rgba(0,0,0,0.4)' },
  option:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
               paddingHorizontal: 14, paddingVertical: 10 },
  optionText:{ fontSize: 13 },
});
