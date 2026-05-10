import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  useWindowDimensions,
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
const TIMES = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
const CAL_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DURATIONS = ['30 min', '45 min', '1 hr', '1.5 hrs', '2 hrs', '2.5 hrs', '3 hrs'];
const DURATION_MINS: Record<string, number> = {
  '30 min': 30, '45 min': 45, '1 hr': 60,
  '1.5 hrs': 90, '2 hrs': 120, '2.5 hrs': 150, '3 hrs': 180,
};
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const HOUR_HEIGHT = 56;
const DAY_COL_WIDTH = 140;
const TIME_LABEL_WIDTH = 52;
const TIMELINE_START_HOUR = Number(TIMES[0].split(':')[0]);

function calcEventTop(startTime: string): number {
  const [h, m] = startTime.split(':').map(Number);
  return (h - TIMELINE_START_HOUR) * HOUR_HEIGHT + (m / 60) * HOUR_HEIGHT;
}

function calcEventHeight(startTime: string, endTime?: string): number {
  if (!endTime) return HOUR_HEIGHT;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const durationMins = (eh * 60 + em) - (sh * 60 + sm);
  if (durationMins <= 0) return HOUR_HEIGHT;
  return Math.max((durationMins / 60) * HOUR_HEIGHT, 28);
}

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

function toTitleCase(str: string) {
  return String(str || '').replace(/\b\w/g, c => c.toUpperCase());
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
  assignmentId?: string | null;
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
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth() + 1);
  const calWeeks = useMemo(() => buildMonthCalendar(calYear, calMonth), [calYear, calMonth]);

  // Events stored per day
  const [eventsMap, setEventsMap] = useState<Record<string, ScheduleEvent[]>>({});
  const [deadlines, setDeadlines] = useState<ScheduleEvent[]>([]);
  const [eventDates, setEventDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Add event modal
  const [modalVisible, setModalVisible] = useState(false);
  const [modalDate, setModalDate] = useState(todayISO);
  const [newTitle, setNewTitle] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newHour, setNewHour] = useState('09');
  const [newMinute, setNewMinute] = useState('00');
  const newTime = `${newHour}:${newMinute}`;
  const [newDuration, setNewDuration] = useState('1 hr');
  const [newType, setNewType] = useState('assignment');
  const [saving, setSaving] = useState(false);

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
      const weekDates = week.map(d => d.iso);
      const dayFetches = weekDates.map(d =>
        fetch(`${SERVER_URL}/schedule?studentId=${child.id}&date=${d}`)
          .then(r => r.ok ? r.json() : [])
          .then((evs: ScheduleEvent[]) => ({ date: d, events: evs }))
          .catch(() => ({ date: d, events: [] }))
      );
      const [dlRes, monthRes, ...dayResults] = await Promise.all([
        fetch(`${SERVER_URL}/schedule/upcoming?studentId=${child.id}`),
        fetch(`${SERVER_URL}/schedule/month?studentId=${child.id}&year=${calYear}&month=${calMonth}`),
        ...dayFetches,
      ]);

      const map: Record<string, ScheduleEvent[]> = {};
      for (const { date, events } of dayResults as { date: string; events: ScheduleEvent[] }[]) {
        map[date] = events;
      }
      setEventsMap(map);

      if (dlRes.ok) setDeadlines(await dlRes.json());
      if (monthRes.ok) {
        const m = await monthRes.json();
        setEventDates(new Set(m.dates ?? []));
      }
    } catch {}
    setLoading(false);
  }, [child, week, calYear, calMonth]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  function openSlotModal(dayISO: string, timeLabel: string) {
    setModalDate(dayISO);
    setNewHour(timeLabel.split(':')[0]);
    setNewMinute('00');
    setModalVisible(true);
  }

  async function addEvent() {
    if (!newTitle.trim() || !child) return;
    setSaving(true);
    try {
      const res = await fetch(`${SERVER_URL}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:     newTitle,
          date:      modalDate,
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
        setEventsMap(prev => ({
          ...prev,
          [modalDate]: [...(prev[modalDate] ?? []), ev],
        }));
        setEventDates(prev => new Set([...prev, modalDate]));
      }
    } catch {}
    setNewTitle(''); setNewNote(''); setSaving(false); setModalVisible(false);
  }

  async function removeEvent(id: string, dateStr: string) {
    try {
      await fetch(`${SERVER_URL}/schedule/${id}`, { method: 'DELETE' });
      setEventsMap(prev => ({
        ...prev,
        [dateStr]: (prev[dateStr] ?? []).filter(e => e.id !== id),
      }));
    } catch {}
  }

  function prevWeek() { const d = new Date(weekBase); d.setDate(d.getDate() - 7); setWeekBase(d); }
  function nextWeek() { const d = new Date(weekBase); d.setDate(d.getDate() + 7); setWeekBase(d); }

  const { width: screenWidth } = useWindowDimensions();
  const colWidth = Math.max(DAY_COL_WIDTH, Math.floor((screenWidth - TIME_LABEL_WIDTH) / 7));
  const gridHeight = TIMES.length * HOUR_HEIGHT;
  const totalGridWidth = TIME_LABEL_WIDTH + colWidth * 7;

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

          {/* ── Week navigation bar ── */}
          <View style={styles.weekNavBar}>
            <TouchableOpacity style={styles.navArrow} onPress={prevWeek}>
              <Feather name="chevron-left" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.todayBtn} onPress={() => setWeekBase(today)}>
              <Text style={styles.todayBtnText}>Today</Text>
            </TouchableOpacity>
            <Text style={styles.weekLabel}>
              {week[0].day} {week[0].date} — {week[6].day} {week[6].date}
            </Text>
            <TouchableOpacity style={styles.navArrow} onPress={nextWeek}>
              <Feather name="chevron-right" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.mainLayout}>
            {/* ── Left: Week Calendar Grid ── */}
            <View style={styles.calendarContainer}>
              {/* Scrollable: header + time grid together so columns stay aligned */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ width: totalGridWidth }}>
                  {/* Day header row — inside scroll */}
                  <View style={styles.dayHeaderRow}>
                    <View style={{ width: TIME_LABEL_WIDTH }} />
                    {week.map((d) => {
                      const isToday = d.iso === todayISO;
                      const hasDot  = eventDates.has(d.iso);
                      return (
                        <View key={d.iso} style={[styles.dayHeader, { width: colWidth }]}>
                          <Text style={[styles.dayHeaderLabel, isToday && styles.dayHeaderLabelToday]}>{d.day}</Text>
                          <View style={[styles.dayHeaderCircle, isToday && styles.dayHeaderCircleToday]}>
                            <Text style={[styles.dayHeaderDate, isToday && styles.dayHeaderDateToday]}>{d.date}</Text>
                          </View>
                          {hasDot && <View style={[styles.dayDot, isToday && { backgroundColor: colors.primary }]} />}
                        </View>
                      );
                    })}
                  </View>
                  {loading ? (
                    <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.emptyText}>Loading schedule…</Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row' }}>
                      {/* Time label column */}
                      <View style={{ width: TIME_LABEL_WIDTH }}>
                        {TIMES.map((t) => (
                          <View key={t} style={{ height: HOUR_HEIGHT, justifyContent: 'flex-start', paddingTop: 4 }}>
                            <Text style={styles.timeLabel}>{t}</Text>
                          </View>
                        ))}
                      </View>

                      {/* Day columns */}
                      {week.map((d) => {
                        const dayEvents = (eventsMap[d.iso] ?? []).filter(
                          e => e.type !== 'deadline' && e.startTime !== '23:59'
                        );
                        return (
                          <View key={d.iso} style={[styles.dayCol, { width: colWidth, height: gridHeight }]}>
                            {/* Hour grid lines — tappable */}
                            {TIMES.map((t, idx) => (
                              <TouchableOpacity
                                key={t}
                                style={[styles.hourCell, { top: idx * HOUR_HEIGHT }]}
                                onPress={() => openSlotModal(d.iso, t)}
                                activeOpacity={0.3}
                              />
                            ))}
                            {/* Absolutely positioned events */}
                            {dayEvents.map(event => {
                              const top    = calcEventTop(event.startTime);
                              const height = calcEventHeight(event.startTime, event.endTime);
                              const color  = typeColor(event.type, colors);
                              return (
                                <TouchableOpacity
                                  key={event.id}
                                  style={[styles.eventBlock, {
                                    top, height,
                                    backgroundColor: color + '20',
                                    borderLeftColor: color,
                                  }]}
                                  activeOpacity={0.82}
                                  onPress={() => {
                                    const t = event.type;
                                    if (t === 'assignment' || t === 'deadline') navigation.navigate('ParentAssignments' as any, { highlightId: event.assignmentId || event.id } as any);
                                    else if (t === 'challenge') navigation.navigate('ParentChallenges' as any, { highlightId: event.assignmentId || event.id } as any);
                                    else if (t === 'lesson' || t === 'study') navigation.navigate('ParentLearning' as any);
                                  }}
                                >
                                  <Text style={styles.eventTitle} numberOfLines={1}>{toTitleCase(event.title)}</Text>
                                  <Text style={styles.eventTime}>{event.startTime}{event.endTime ? `–${event.endTime}` : ''}</Text>
                                  <TouchableOpacity
                                    style={styles.deleteBtn}
                                    onPress={() => removeEvent(event.id, d.iso)}
                                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                                  >
                                    <Feather name="x" size={10} color={colors.textDim} />
                                  </TouchableOpacity>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              </ScrollView>

              {/* Add event button */}
              <TouchableOpacity style={styles.addEventBtn} onPress={() => { setModalDate(todayISO); setModalVisible(true); }} activeOpacity={0.8}>
                <Feather name="plus" size={16} color={colors.primary} />
                <Text style={styles.addEventText}>Add Event for {child?.name ?? 'Child'}</Text>
              </TouchableOpacity>
            </View>

            {/* ── Right Sidebar ── */}
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
                      const iso        = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(date).padStart(2,'0')}`;
                      const isToday    = iso === todayISO;
                      const isWeekDay  = week.some(d => d.iso === iso);
                      const hasDot     = eventDates.has(iso);
                      return (
                        <View
                          key={di}
                          style={[styles.calDate, isToday && styles.calDateToday, isWeekDay && !isToday && styles.calDateWeekHighlight]}
                        >
                          <Text style={[styles.calDateText, isToday && styles.calDateTextToday, isWeekDay && !isToday && { color: colors.primary }]}>
                            {date}
                          </Text>
                          {hasDot && <View style={[styles.calDot, { backgroundColor: isToday ? 'white' : colors.primary }]} />}
                        </View>
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
                    const urgent   = d.date === todayISO;
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
              <Text style={styles.modalTitle}>Add Event — {modalDate}</Text>
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
                    <Text style={[styles.timeChipText, newType === t && { color: typeColor(t, colors) }]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
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
              {newHour !== '' && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {['00', '15', '30', '45'].map(m => (
                    <TouchableOpacity key={m} style={[styles.timeChip, newMinute === m && styles.timeChipActive]} onPress={() => setNewMinute(m)}>
                      <Text style={[styles.timeChipText, newMinute === m && { color: colors.primary }]}>{newHour}:{m}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
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
  screen:  { flex: 1, backgroundColor: c.bgDark },
  scroll:  { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 40 },

  // Child selector
  childRow:        { flexDirection: 'row', marginBottom: spacing.lg },
  childTab:        { alignItems: 'center', marginRight: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: 'transparent' },
  childTabActive:  { borderColor: c.primary, backgroundColor: c.primaryGlow },
  childTabName:    { fontSize: 14, fontWeight: '700' },
  childTabGrade:   { fontSize: 10, color: c.textDim, marginTop: 2 },

  // Week nav
  weekNavBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.md, marginBottom: spacing.xl,
  },
  navArrow:     { padding: spacing.sm },
  todayBtn:     { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor },
  todayBtnText: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  weekLabel:    { flex: 1, fontSize: 13, fontWeight: '700', color: c.textMain, textAlign: 'center' },

  // Layout
  mainLayout:        { flexDirection: 'row', gap: spacing.xl },
  calendarContainer: { flex: 1.5 },
  sideCol:           { flex: 1, gap: spacing.lg },

  // Day header
  dayHeaderRow:         { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.borderColor, marginBottom: 0 },
  dayHeader:            { alignItems: 'center', paddingVertical: spacing.sm, gap: 2 },
  dayHeaderLabel:       { fontSize: 10, fontWeight: '700', color: c.textDim, letterSpacing: 0.5 },
  dayHeaderLabelToday:  { color: c.accentBlue },
  dayHeaderCircle:      { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dayHeaderCircleToday: { backgroundColor: c.accentBlue },
  dayHeaderDate:        { fontSize: 14, fontWeight: '700', color: c.textMuted },
  dayHeaderDateToday:   { color: 'white' },
  dayDot:               { width: 4, height: 4, borderRadius: 2, backgroundColor: c.textDim },

  // Grid
  dayCol:   { position: 'relative', borderLeftWidth: 1, borderLeftColor: c.borderColor + '50' },
  hourCell: { position: 'absolute', left: 0, right: 0, height: HOUR_HEIGHT, borderTopWidth: 1, borderTopColor: c.borderColor + '40' },
  timeLabel: { fontSize: 10, color: c.textDim, fontWeight: '600', textAlign: 'right', paddingRight: 6 },

  // Events
  eventBlock: {
    position: 'absolute', left: 2, right: 2,
    borderLeftWidth: 3, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 3,
    overflow: 'hidden',
  },
  eventTitle: { fontSize: 11, fontWeight: '600', color: '#ffffff' },
  eventTime:  { fontSize: 10, color: 'rgba(255,255,255,0.8)' },
  deleteBtn:  { position: 'absolute', top: 3, right: 3 },

  addEventBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.lg, paddingVertical: 12, paddingHorizontal: spacing.lg,
    backgroundColor: c.primaryGlow, borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.3)', borderRadius: radius.md,
    borderStyle: 'dashed', justifyContent: 'center',
  },
  addEventText: { fontSize: 13, fontWeight: '600', color: c.primary },
  emptyText:    { fontSize: 12, color: c.textMuted, marginTop: 8 },

  // Sidebar
  sideCard:      { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, padding: spacing.lg },
  calHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  calMonth:      { fontSize: 13, fontWeight: '700', color: c.textMain },
  calDayHeaders: { flexDirection: 'row', marginBottom: spacing.sm },
  calDayHeader:  { flex: 1, fontSize: 10, color: c.textDim, textAlign: 'center', fontWeight: '600' },
  calWeek:       { flexDirection: 'row', marginBottom: 4 },
  calDate:       { flex: 1, alignItems: 'center', paddingVertical: 4, borderRadius: 6, gap: 2 },
  calDateToday:         { backgroundColor: c.accentBlue },
  calDateWeekHighlight: { backgroundColor: c.primaryGlow },
  calDateText:          { fontSize: 12, color: c.textMuted, fontWeight: '500' },
  calDateTextToday:     { color: 'white', fontWeight: '700' },
  calDot:        { width: 4, height: 4, borderRadius: 2 },
  sideTitle:     { fontSize: 14, fontWeight: '700', color: c.textMain, marginBottom: spacing.lg },
  deadlineItem:  { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  deadlineIcon:  { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  deadlineTitle: { fontSize: 12, fontWeight: '600', color: c.textMain },
  deadlineDue:   { fontSize: 11 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: '85%', backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.xl,
    padding: spacing.xxl, gap: spacing.lg,
  },
  modalTitle:       { fontSize: 17, fontWeight: '700', color: c.textMain },
  modalSubtitle:    { fontSize: 12, color: c.textMuted, marginTop: -spacing.sm },
  modalInput:       { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, padding: spacing.md, color: c.textMain, fontSize: 14 },
  modalLabel:       { fontSize: 12, color: c.textMuted, fontWeight: '600' },
  timeChip:         { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor, marginRight: 6 },
  timeChipActive:   { borderColor: c.primary, backgroundColor: c.primaryGlow },
  timeChipText:     { fontSize: 12, color: c.textMuted },
  modalBtns:        { flexDirection: 'row', gap: spacing.md },
  modalCancel:      { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center' },
  modalCancelText:  { fontSize: 13, fontWeight: '600', color: c.textMuted },
  modalConfirm:     { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center' },
  modalConfirmText: { fontSize: 13, fontWeight: '700', color: 'white' },
});
