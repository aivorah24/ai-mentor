import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  PanResponder,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

// ── Constants ────────────────────────────────────────────────────────────────
const DAYS_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const TIMES = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
const TIME_PICKER_SLOTS: string[] = (() => {
  const s: string[] = [];
  for (let h = 6; h <= 22; h++) for (const m of [0,15,30,45]) { if (h===22&&m>0) break; s.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`); }
  return s;
})();
const CAL_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DURATIONS = ['30 min', '45 min', '1 hr', '1.5 hrs', '2 hrs', '2.5 hrs', '3 hrs'];
const DURATION_MINS: Record<string, number> = {
  '30 min': 30, '45 min': 45, '1 hr': 60,
  '1.5 hrs': 90, '2 hrs': 120, '2.5 hrs': 150, '3 hrs': 180,
};
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SLOT_ROW_HEIGHT = 50;

// ── Helpers ──────────────────────────────────────────────────────────────────
function calcEndTime(startTime: string, duration: string): string {
  const [h, m] = startTime.split(':').map(Number);
  const total = h * 60 + m + (DURATION_MINS[duration] ?? 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function dateISO(d: Date): string {
  return d.toISOString().split('T')[0];
}

function buildWeek(baseDate: Date): { iso: string; day: string; date: number }[] {
  const dow = baseDate.getDay();
  const monday = new Date(baseDate);
  monday.setDate(baseDate.getDate() - ((dow + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { iso: dateISO(d), day: DAYS_SHORT[i], date: d.getDate() };
  });
}

function buildMonthCalendar(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const offset = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function typeColor(type: string, colors: any): string {
  const map: Record<string, string> = {
    study:      colors.accentBlue,
    lesson:     colors.accentGreen,
    challenge:  colors.accentPurple,
    deadline:   colors.accentRed,
    assignment: colors.accentYellow,
    break:      colors.textDim,
  };
  return map[type] ?? colors.primary;
}

interface ScheduleEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  type: string;
  note: string;
  studentId: string;
  createdBy: string;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ParentScheduleScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const parentEmail = user?.email || 'parent@demo.com';

  // Children
  const [children, setChildren] = useState<any[]>([]);
  const [selectedChildIdx, setSelectedChildIdx] = useState(0);

  // Calendar state
  const today = useMemo(() => new Date(), []);
  const todayISO = useMemo(() => dateISO(today), [today]);
  const [weekBase, setWeekBase] = useState(today);
  const week = useMemo(() => buildWeek(weekBase), [weekBase]);
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth() + 1);
  const calWeeks = useMemo(() => buildMonthCalendar(calYear, calMonth), [calYear, calMonth]);

  // Events
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [deadlines, setDeadlines] = useState<ScheduleEvent[]>([]);
  const [eventDates, setEventDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Add event modal
  const [modalVisible, setModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newHour, setNewHour] = useState('09');
  const [newMinute, setNewMinute] = useState('00');
  const newTime = `${newHour}:${newMinute}`;
  const [newDuration, setNewDuration] = useState('1 hr');
  const [newType, setNewType] = useState('assignment');
  const [saving, setSaving] = useState(false);
  const [dragRange, setDragRange] = useState<{ start: number; end: number } | null>(null);
  const dragRangeRef = useRef<{ start: number; end: number } | null>(null);

  // Load children
  useEffect(() => {
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data) && data.length > 0) setChildren(data); })
      .catch(() => {});
  }, [parentEmail]);

  const child = children[selectedChildIdx];

  const fetchEvents = useCallback(async () => {
    if (!child) return;
    setLoading(true);
    try {
      const [evRes, dlRes, monthRes] = await Promise.all([
        fetch(`${SERVER_URL}/schedule?studentId=${child.id}&date=${selectedDate}`),
        fetch(`${SERVER_URL}/schedule/upcoming?studentId=${child.id}`),
        fetch(`${SERVER_URL}/schedule/month?studentId=${child.id}&year=${calYear}&month=${calMonth}`),
      ]);
      if (evRes.ok) setEvents(await evRes.json());
      if (dlRes.ok) setDeadlines(await dlRes.json());
      if (monthRes.ok) {
        const m = await monthRes.json();
        setEventDates(new Set(m.dates ?? []));
      }
    } catch {}
    setLoading(false);
  }, [child, selectedDate, calYear, calMonth]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const openModalForRange = useCallback((startIdx: number, endIdx: number) => {
    const start = Math.max(0, Math.min(TIMES.length - 1, Math.min(startIdx, endIdx)));
    const spanHours = Math.max(1, Math.min(3, Math.abs(endIdx - startIdx) + 1));
    const durationLabel = spanHours === 1 ? '1 hr' : spanHours === 2 ? '2 hrs' : '3 hrs';
    setNewHour(TIMES[start].split(':')[0]); setNewMinute('00');
    setNewDuration(durationLabel);
    setModalVisible(true);
  }, []);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_evt, gestureState) => Math.abs(gestureState.dy) > 6,
    onMoveShouldSetPanResponderCapture: (_evt, gestureState) => Math.abs(gestureState.dy) > 6,
    onPanResponderGrant: (evt) => {
      const idx = Math.max(0, Math.min(TIMES.length - 1, Math.floor((evt.nativeEvent.locationY || 0) / SLOT_ROW_HEIGHT)));
      const next = { start: idx, end: idx };
      dragRangeRef.current = next;
      setDragRange(next);
    },
    onPanResponderMove: (evt) => {
      const curr = dragRangeRef.current;
      if (!curr) return;
      const idx = Math.max(0, Math.min(TIMES.length - 1, Math.floor((evt.nativeEvent.locationY || 0) / SLOT_ROW_HEIGHT)));
      const next = { start: curr.start, end: idx };
      dragRangeRef.current = next;
      setDragRange(next);
    },
    onPanResponderRelease: () => {
      const curr = dragRangeRef.current;
      if (curr) openModalForRange(curr.start, curr.end);
      dragRangeRef.current = null;
      setDragRange(null);
    },
    onPanResponderTerminate: () => {
      dragRangeRef.current = null;
      setDragRange(null);
    },
  }), [openModalForRange]);

  async function addEvent() {
    if (!newTitle.trim() || !child) return;
    setSaving(true);
    try {
      const res = await fetch(`${SERVER_URL}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:     newTitle,
          date:      selectedDate,
          startTime: newTime,
          endTime:   calcEndTime(newTime, newDuration),
          type:      newType,
          note:      newNote,
          studentId: child.id,
          createdBy: 'parent',
        }),
      });
      if (res.ok) {
        const ev = await res.json();
        setEvents(prev => [...prev, ev]);
        setEventDates(prev => new Set([...prev, selectedDate]));
      }
    } catch {}
    setNewTitle(''); setNewNote(''); setSaving(false); setModalVisible(false);
  }

  async function removeEvent(id: string) {
    try {
      await fetch(`${SERVER_URL}/schedule/${id}`, { method: 'DELETE' });
      setEvents(prev => prev.filter(e => e.id !== id));
    } catch {}
  }

  function prevWeek() { const d = new Date(weekBase); d.setDate(d.getDate() - 7); setWeekBase(d); }
  function nextWeek() { const d = new Date(weekBase); d.setDate(d.getDate() + 7); setWeekBase(d); }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Schedule"
          subtitle="Manage your children's timetable"
          searchPlaceholder="Search schedule..."
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── Child Selector ── */}
          {children.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.childRow}>
              {children.map((c, i) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.childTab, selectedChildIdx === i && styles.childTabActive]}
                  onPress={() => setSelectedChildIdx(i)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.childTabName, { color: selectedChildIdx === i ? colors.primary : colors.textMuted }]}>{c.name}</Text>
                  <Text style={styles.childTabGrade}>{c.grade}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* ── Day Strip ── */}
          <View style={styles.daySelectorCard}>
            <TouchableOpacity style={styles.navArrow} onPress={prevWeek}>
              <Feather name="chevron-left" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
              {week.map((d) => (
                <TouchableOpacity
                  key={d.iso}
                  style={[styles.dayItem, d.iso === selectedDate && styles.dayItemActive]}
                  onPress={() => setSelectedDate(d.iso)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.dayLabel, d.iso === selectedDate && styles.dayLabelActive]}>{d.day}</Text>
                  <Text style={[styles.dateNum, d.iso === selectedDate && styles.dateNumActive]}>{d.date}</Text>
                  {eventDates.has(d.iso) && <View style={[styles.dayDot, d.iso === selectedDate && { backgroundColor: 'white' }]} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.navArrow} onPress={nextWeek}>
              <Feather name="chevron-right" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* ── Main Layout: Timeline + Sidebar ── */}
          <View style={styles.mainLayout}>

            {/* Timeline */}
            <View style={styles.timelineCol}>
              <Text style={styles.dragHint}>Drag on empty timeline slots to quick-book a time range.</Text>
              {loading ? (
                <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.emptyText}>Loading schedule…</Text>
                </View>
              ) : (
                <View style={styles.timelineDragArea} {...panResponder.panHandlers}>
                {TIMES.map((t, idx) => {
                  const [slotH] = t.split(':').map(Number);
                  const event = events.find((e) => { const [evH] = e.startTime.split(':').map(Number); return evH === slotH; });
                  const isNow = t === todayISO.slice(0, 5) && selectedDate === todayISO;
                  const rangeStart = dragRange ? Math.min(dragRange.start, dragRange.end) : -1;
                  const rangeEnd = dragRange ? Math.max(dragRange.start, dragRange.end) : -1;
                  const inDragRange = idx >= rangeStart && idx <= rangeEnd;
                  return (
                    <View key={t} style={styles.timeRow}>
                      <Text style={[styles.timeLabel, isNow && { color: colors.accentBlue, fontWeight: '800' }]}>{t}</Text>
                      <View style={styles.timeSlot}>
                        {event ? (
                          <View style={[styles.eventBlock, { borderLeftColor: typeColor(event.type, colors) }]}>
                            <View style={styles.eventTopRow}>
                              <Text style={styles.eventTitle}>{event.title}</Text>
                              <View style={styles.eventTags}>
                                {event.type !== 'study' && (
                                  <View style={[styles.tag, { backgroundColor: typeColor(event.type, colors) + '20', borderColor: typeColor(event.type, colors) + '40' }]}>
                                    <Text style={[styles.tagText, { color: typeColor(event.type, colors) }]}>{event.type}</Text>
                                  </View>
                                )}
                                {event.createdBy === 'teacher' && (
                                  <View style={[styles.tag, { backgroundColor: colors.accentPurple + '20', borderColor: colors.accentPurple + '40' }]}>
                                    <Text style={[styles.tagText, { color: colors.accentPurple }]}>Teacher</Text>
                                  </View>
                                )}
                                <TouchableOpacity onPress={() => removeEvent(event.id)} style={styles.deleteBtn}>
                                  <Feather name="x" size={12} color={colors.textDim} />
                                </TouchableOpacity>
                              </View>
                            </View>
                            <Text style={styles.eventTime}>{event.startTime}{event.endTime ? ` – ${event.endTime}` : ''}</Text>
                            {event.note ? <Text style={styles.eventNote}>{event.note}</Text> : null}
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[styles.emptySlot, isNow && { borderTopColor: colors.accentBlue, borderTopWidth: 2 }, inDragRange && styles.draggingSlot]}
                            onPress={() => openModalForRange(idx, idx)}
                            activeOpacity={0.4}
                          >
                            <Feather name="plus" size={12} color={colors.textDim} style={{ opacity: 0.4 }} />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })}
                </View>
              )}
              <TouchableOpacity style={styles.addEventBtn} onPress={() => setModalVisible(true)} activeOpacity={0.8}>
                <Feather name="plus" size={16} color={colors.primary} />
                <Text style={styles.addEventText}>Add Event for {child?.name ?? 'Child'}</Text>
              </TouchableOpacity>
            </View>

            {/* Sidebar */}
            <View style={styles.sideCol}>
              {/* Mini Calendar */}
              <View style={styles.sideCard}>
                <View style={styles.calHeader}>
                  <Text style={styles.calMonth}>{MONTH_NAMES[calMonth - 1]} {calYear}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity onPress={() => { if (calMonth === 1) { setCalMonth(12); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); }}>
                      <Feather name="chevron-left" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { if (calMonth === 12) { setCalMonth(1); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); }}>
                      <Feather name="chevron-right" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.calDayHeaders}>
                  {CAL_DAYS.map((d) => <Text key={d} style={styles.calDayHeader}>{d}</Text>)}
                </View>
                {calWeeks.map((week2, wi) => (
                  <View key={wi} style={styles.calWeek}>
                    {week2.map((date, di) => {
                      if (date === null) return <View key={di} style={styles.calDate} />;
                      const iso = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(date).padStart(2,'0')}`;
                      const isToday = iso === todayISO;
                      const isSelected = iso === selectedDate;
                      const hasDot = eventDates.has(iso);
                      return (
                        <TouchableOpacity
                          key={di}
                          style={[styles.calDate, isSelected && styles.calDateToday]}
                          onPress={() => setSelectedDate(iso)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.calDateText, isToday && { color: colors.accentBlue, fontWeight: '700' }, isSelected && styles.calDateTextToday]}>
                            {date}
                          </Text>
                          {hasDot && <View style={[styles.calDot, { backgroundColor: isSelected ? 'white' : colors.primary }]} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </View>

              {/* Upcoming Deadlines */}
              <View style={styles.sideCard}>
                <Text style={styles.sideTitle}>Upcoming Deadlines</Text>
                {deadlines.length === 0 ? (
                  <Text style={styles.emptyText}>No upcoming deadlines for {child?.name ?? 'this child'}.</Text>
                ) : (
                  deadlines.map((d) => {
                    const urgent = d.date === todayISO;
                    const dueColor = urgent || d.date < todayISO ? colors.accentRed : colors.accentYellow;
                    const dueLabel = urgent ? 'Due Today' : d.date;
                    return (
                      <View key={d.id} style={styles.deadlineItem}>
                        <View style={[styles.deadlineIcon, { backgroundColor: dueColor + '18' }]}>
                          <Feather name="clock" size={14} color={dueColor} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.deadlineTitle}>{d.title}</Text>
                          <Text style={[styles.deadlineDue, { color: dueColor }]}>{dueLabel}</Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            </View>
          </View>
        </ScrollView>

        {/* ── Add Event Modal ── */}
        <Modal visible={modalVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modal}>
              <Text style={styles.modalTitle}>Add Event — {selectedDate}</Text>
              {child && <Text style={styles.modalSubtitle}>For {child.name} ({child.grade})</Text>}
              <TextInput
                style={styles.modalInput}
                placeholder="Event title..."
                placeholderTextColor={colors.textDim}
                value={newTitle}
                onChangeText={setNewTitle}
              />
              <TextInput
                style={[styles.modalInput, { fontSize: 12 }]}
                placeholder="Note (optional)..."
                placeholderTextColor={colors.textDim}
                value={newNote}
                onChangeText={setNewNote}
              />
              <Text style={styles.modalLabel}>Type:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {['study','lesson','challenge','deadline','assignment','break'].map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.timeChip, newType === t && { borderColor: typeColor(t, colors), backgroundColor: typeColor(t, colors) + '18' }]}
                    onPress={() => setNewType(t)}
                  >
                    <Text style={[styles.timeChipText, newType === t && { color: typeColor(t, colors) }]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={styles.modalLabel}>Start time: <Text style={{ color: colors.primary, fontWeight: '800' }}>{newTime}</Text></Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0')).map(h => (
                  <TouchableOpacity key={h} style={[styles.timeChip, newHour === h && styles.timeChipActive]} onPress={() => setNewHour(h)}>
                    <Text style={[styles.timeChipText, newHour === h && { color: colors.primary }]}>{h}:00</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {['00', '15', '30', '45'].map(m => (
                  <TouchableOpacity key={m} style={[styles.timeChip, newMinute === m && styles.timeChipActive]} onPress={() => setNewMinute(m)}>
                    <Text style={[styles.timeChipText, newMinute === m && { color: colors.primary }]}>:{m}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={styles.modalLabel}>Duration:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {DURATIONS.map((d) => (
                  <TouchableOpacity key={d} style={[styles.timeChip, newDuration === d && styles.timeChipActive]} onPress={() => setNewDuration(d)}>
                    <Text style={[styles.timeChipText, newDuration === d && { color: colors.primary }]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setModalVisible(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalConfirm} onPress={addEvent} disabled={saving}>
                  <Text style={styles.modalConfirmText}>{saving ? 'Saving…' : 'Add Event'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </ScreenLayout>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 40 },

  // Child selector
  childRow: { flexDirection: 'row', marginBottom: spacing.lg },
  childTab: {
    alignItems: 'center', marginRight: spacing.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.lg, borderWidth: 1, borderColor: 'transparent',
  },
  childTabActive: { borderColor: c.primary, backgroundColor: c.primaryGlow },
  childTabName: { fontSize: 14, fontWeight: '700' },
  childTabGrade: { fontSize: 10, color: c.textDim, marginTop: 2 },

  // Day strip
  daySelectorCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.xl,
  },
  navArrow: { padding: spacing.sm },
  dayItem: {
    alignItems: 'center', paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm, borderRadius: radius.lg, marginHorizontal: 2, gap: 4,
  },
  dayItemActive: { backgroundColor: c.accentBlue },
  dayLabel: { fontSize: 10, fontWeight: '700', color: c.textMuted, letterSpacing: 0.5 },
  dayLabelActive: { color: 'white' },
  dateNum: { fontSize: 18, fontWeight: '700', color: c.textMuted },
  dateNumActive: { color: 'white' },
  dayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.primary },

  // Layout
  mainLayout: { flexDirection: 'row', gap: spacing.xl },
  timelineCol: { flex: 1.5 },
  sideCol: { flex: 1, gap: spacing.lg },

  // Timeline
  timelineDragArea: { width: '100%' },
  dragHint: { fontSize: 11, color: c.textDim, marginBottom: spacing.sm, marginLeft: spacing.sm },
  timeRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2 },
  timeLabel: { width: 44, fontSize: 11, color: c.textDim, paddingTop: spacing.md, fontWeight: '600' },
  timeSlot: { flex: 1, minHeight: 48 },
  emptySlot: {
    height: 48,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.03)',
    marginLeft: spacing.sm,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  draggingSlot: {
    borderTopColor: c.primary + '85',
    backgroundColor: c.primaryGlow,
  },
  eventBlock: {
    backgroundColor: c.cardDark, borderLeftWidth: 3,
    borderTopRightRadius: radius.sm, borderBottomRightRadius: radius.sm,
    padding: spacing.md, marginLeft: spacing.sm, marginBottom: 2,
  },
  eventTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  eventTitle: { fontSize: 13, fontWeight: '600', color: c.textMain, flex: 1 },
  eventTags: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tag: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: 10, fontWeight: '600' },
  deleteBtn: { padding: 2 },
  eventTime: { fontSize: 11, color: c.textMuted },
  eventNote: { fontSize: 11, color: c.textMuted, marginTop: 3 },
  addEventBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.lg, paddingVertical: 12, paddingHorizontal: spacing.lg,
    backgroundColor: c.primaryGlow, borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.3)', borderRadius: radius.md,
    borderStyle: 'dashed', justifyContent: 'center',
  },
  addEventText: { fontSize: 13, fontWeight: '600', color: c.primary },
  emptyText: { fontSize: 12, color: c.textMuted, marginTop: 8 },

  // Sidebar
  sideCard: {
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.lg, padding: spacing.lg,
  },
  calHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  calMonth: { fontSize: 13, fontWeight: '700', color: c.textMain },
  calDayHeaders: { flexDirection: 'row', marginBottom: spacing.sm },
  calDayHeader: { flex: 1, fontSize: 10, color: c.textDim, textAlign: 'center', fontWeight: '600' },
  calWeek: { flexDirection: 'row', marginBottom: 4 },
  calDate: { flex: 1, alignItems: 'center', paddingVertical: 4, borderRadius: 6, gap: 2 },
  calDateToday: { backgroundColor: c.accentBlue },
  calDateText: { fontSize: 12, color: c.textMuted, fontWeight: '500' },
  calDateTextToday: { color: 'white', fontWeight: '700' },
  calDot: { width: 4, height: 4, borderRadius: 2 },
  sideTitle: { fontSize: 14, fontWeight: '700', color: c.textMain, marginBottom: spacing.lg },
  deadlineItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  deadlineIcon: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  deadlineTitle: { fontSize: 12, fontWeight: '600', color: c.textMain },
  deadlineDue: { fontSize: 11 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: '85%', backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.xl,
    padding: spacing.xxl, gap: spacing.lg,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.textMain },
  modalSubtitle: { fontSize: 12, color: c.textMuted, marginTop: -spacing.sm },
  modalInput: {
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.md,
    padding: spacing.md, color: c.textMain, fontSize: 14,
  },
  modalLabel: { fontSize: 12, color: c.textMuted, fontWeight: '600' },
  timeChip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor, marginRight: 6 },
  timeChipActive: { borderColor: c.primary, backgroundColor: c.primaryGlow },
  timeChipText: { fontSize: 12, color: c.textMuted },
  modalBtns: { flexDirection: 'row', gap: spacing.md },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center' },
  modalCancelText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  modalConfirm: { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center' },
  modalConfirmText: { fontSize: 13, fontWeight: '700', color: 'white' },
});
