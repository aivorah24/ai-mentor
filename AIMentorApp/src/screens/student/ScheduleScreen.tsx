import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useStudentData } from '../../context/StudentDataContext';
import { useNotification } from '../../context/NotificationContext';

import SERVER_URL from '../../config/serverUrl';
import TimePicker from '../../components/common/TimePicker';

const DAYS_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const TIMES = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
const CAL_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DURATIONS = ['30 min', '45 min', '1 hr', '1.5 hrs', '2 hrs', '2.5 hrs', '3 hrs'];
const HOUR_HEIGHT = 56;
const DAY_COL_WIDTH = 140;
const TIME_LABEL_WIDTH = 52;
const TIMELINE_START_HOUR = Number(TIMES[0].split(':')[0]);
const DURATION_MINS: Record<string, number> = {
  '30 min': 30, '45 min': 45, '1 hr': 60,
  '1.5 hrs': 90, '2 hrs': 120, '2.5 hrs': 150, '3 hrs': 180,
};
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

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
  // Tall enough for a title that wraps to 2 lines plus the time line.
  return Math.max((durationMins / 60) * HOUR_HEIGHT, 40);
}

function calcEndTime(startTime: string, duration: string): string {
  const [h, m] = startTime.split(':').map(Number);
  const total = h * 60 + m + (DURATION_MINS[duration] ?? 60);
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
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
  tag: string | null;
  assignmentId?: string | null;
}

// Returns [accent, pastelfill, textColor] — same palette as teacher schedule
function typeColors(type: string): [string, string, string] {
  const map: Record<string, [string, string, string]> = {
    lesson:     ['#9C844A', '#F5EDDA', '#6B5A30'],
    study:      ['#C9A24E', '#FBF3DA', '#7A5C1E'],  // amber-gold, matches Aivorah theme
    challenge:  ['#6B5BA8', '#E8E4F5', '#3F3270'],
    deadline:   ['#B84A3A', '#F5DDD9', '#7A2A1E'],
    assignment: ['#3A8A6A', '#D9F0E8', '#1E5A40'],
    break:      ['#7A7A7A', '#EBEBEB', '#4A4A4A'],
  };
  return map[type] ?? ['#9C844A', '#F5EDDA', '#6B5A30'];
}

function toTitleCase(str: string) {
  return String(str || '').replace(/\b\w/g, c => c.toUpperCase());
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

export default function ScheduleScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { clearUnreadEvents } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { studentId } = useStudentData();

  const today = useMemo(() => new Date(), []);
  const [weekBase, setWeekBase] = useState(today);
  const week = useMemo(() => buildWeek(weekBase), [weekBase]);
  const todayISO = useMemo(() => dateISO(today), [today]);

  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth() + 1);
  const calWeeks = useMemo(() => buildMonthCalendar(calYear, calMonth), [calYear, calMonth]);

  // Events stored as map: dateISO -> events[]
  const [eventsMap, setEventsMap] = useState<Record<string, ScheduleEvent[]>>({});
  const [deadlines, setDeadlines] = useState<ScheduleEvent[]>([]);
  const [eventDates, setEventDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Event detail modal — shows the full title/time/note when tapping an event block
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);

  // Modal state — pre-filled date/time when tapping a slot
  const [modalVisible, setModalVisible] = useState(false);
  const [modalDate, setModalDate] = useState(todayISO);
  const [newTitle, setNewTitle] = useState('');
  const [newStartTime, setNewStartTime] = useState('09:00');
  const [newEndTime, setNewEndTime] = useState('10:00');
  const [newType, setNewType] = useState('study');
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchEvents = useCallback(async () => {
    if (!studentId) return;
    // Show the full-screen spinner ONLY for the very first load. Every later fetch
    // (week navigation, 30s poll, focus) keeps the grid mounted — otherwise the grid
    // unmounts and the horizontal scroll resets back to Monday each time.
    if (!firstLoadDoneRef.current) setLoading(true);
    try {
      // Fetch all 7 days of the week in parallel + deadlines + month dots
      const weekDates = week.map(d => d.iso);
      const dayFetches = weekDates.map(d =>
        fetch(`${SERVER_URL}/schedule?studentId=${studentId}&date=${d}`)
          .then(r => r.ok ? r.json() : [])
          .then((evs: ScheduleEvent[]) => ({ date: d, events: evs }))
          .catch(() => ({ date: d, events: [] }))
      );
      const [dlRes, monthRes, ...dayResults] = await Promise.all([
        fetch(`${SERVER_URL}/schedule/upcoming?studentId=${studentId}`),
        fetch(`${SERVER_URL}/schedule/month?studentId=${studentId}&year=${calYear}&month=${calMonth}`),
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
    if (!firstLoadDoneRef.current) { setLoading(false); firstLoadDoneRef.current = true; }
  }, [studentId, week, calYear, calMonth]);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(() => fetchEvents(), 30 * 1000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  useFocusEffect(useCallback(() => { fetchEvents(); clearUnreadEvents(); }, [fetchEvents, clearUnreadEvents]));

  // Browser notifications
  const notifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function checkNotifications() {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const now = new Date();
      const todayStr = dateISO(now);
      const currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const todayEvents = eventsMap[todayStr] ?? [];
      todayEvents.forEach(ev => {
        const notifKey = `${ev.id}_${ev.startTime}`;
        if (notifiedRef.current.has(notifKey)) return;
        if (ev.startTime === currentTime) {
          notifiedRef.current.add(notifKey);
          const n = new Notification(`Aivorah — ${ev.title}`, {
            body: ev.note ? `${ev.startTime}${ev.endTime ? ' – ' + ev.endTime : ''} · ${ev.note}` : `Starting now at ${ev.startTime}`,
            icon: '/favicon.ico',
            tag: notifKey,
          });
          n.onclick = () => { window.focus(); n.close(); };
        }
      });
    }
    checkNotifications();
    const interval = setInterval(checkNotifications, 60000);
    return () => clearInterval(interval);
  }, [eventsMap]);

  function openSlotModal(dateISO: string, timeLabel: string) {
    setModalDate(dateISO);
    const [h] = timeLabel.split(':');
    const startH = h.padStart(2, '0');
    const endH = String(Math.min(23, parseInt(startH) + 1)).padStart(2, '0');
    setNewStartTime(`${startH}:00`);
    setNewEndTime(`${endH}:00`);
    setModalVisible(true);
  }

  async function addEvent() {
    if (!newTitle.trim() || !studentId) return;
    setSaving(true);
    try {
      const res = await fetch(`${SERVER_URL}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:     newTitle,
          date:      modalDate,
          startTime: newStartTime,
          endTime:   newEndTime,
          type:      newType,
          note:      newNote,
          studentId,
          createdBy: studentId,
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
  // Horizontal-scroll the day-grid so today's column is at the left edge —
  // mirrors the Parent schedule's working "Today" behaviour exactly.
  function scrollToToday(cw: number) {
    const dow = today.getDay();          // 0=Sun
    const todayCol = (dow + 6) % 7;      // Mon=0 … Sun=6
    hScrollRef.current?.scrollTo({ x: todayCol * cw, animated: true });
  }
  function goToday() {
    const now = new Date();
    setWeekBase(now);
    setCalYear(now.getFullYear());
    setCalMonth(now.getMonth() + 1);
    setTimeout(() => scrollToToday(colWidth), 100);
    scrollToCurrentTime();
  }

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  // Comfortable column width (matches the Parent schedule). The grid shows a few
  // days at a readable width and scrolls horizontally; the auto-scroll-to-today
  // keeps today's column in view.
  const colWidth = Math.max(DAY_COL_WIDTH, Math.floor((screenWidth - TIME_LABEL_WIDTH) / 7));
  const gridHeight = TIMES.length * HOUR_HEIGHT;
  const totalGridWidth = TIME_LABEL_WIDTH + colWidth * 7;

  const hScrollRef = useRef<ScrollView>(null);
  const vScrollRef = useRef<ScrollView>(null);
  // Guards the one-time auto-scroll-to-today after the grid first lays out.
  const didInitialScrollRef = useRef(false);
  // True once the first events load completes — gates the full-screen spinner so it
  // never reappears (and never resets the scroll) on background refreshes.
  const firstLoadDoneRef = useRef(false);

  // ── Drag-to-create ────────────────────────────────────────────────────────
  const [dragPreview, setDragPreview] = useState<{ dayIso: string; top: number; height: number; startT: string; endT: string } | null>(null);

  const gh = TIMES.length * HOUR_HEIGHT;

  function yToTime(y: number): string {
    const clampedY = Math.max(0, Math.min(y, gh));
    const totalMins = Math.round((clampedY / HOUR_HEIGHT * 60 + TIMELINE_START_HOUR * 60) / 15) * 15;
    const h = Math.floor(totalMins / 60) % 24;
    const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function handleColMouseDown(e: any, dayIso: string) {
    if (Platform.OS !== 'web') return;
    if (e.button !== 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const startY = e.clientY - rect.top;
    setDragPreview({ dayIso, top: startY, height: 0, startT: yToTime(startY), endT: yToTime(startY) });
    e.preventDefault();

    const onMove = (ev: MouseEvent) => {
      const curY = ev.clientY - rect.top;
      const top = Math.min(startY, curY);
      const height = Math.abs(curY - startY);
      setDragPreview({ dayIso, top, height, startT: yToTime(Math.min(startY, curY)), endT: yToTime(Math.max(startY, curY)) });
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragPreview(null);
      const curY = ev.clientY - rect.top;
      const startT = yToTime(Math.min(startY, curY));
      const endT   = yToTime(Math.max(startY, curY));
      const [sh, sm] = startT.split(':').map(Number);
      const [eh, em] = endT.split(':').map(Number);
      const durationMins = (eh * 60 + em) - (sh * 60 + sm);

      if (durationMins >= 15) {
        const closest = Object.entries(DURATION_MINS).reduce<string>((best, [label, mins]) =>
          Math.abs(mins - durationMins) < Math.abs(DURATION_MINS[best] - durationMins) ? label : best, '1 hr');
        setModalDate(dayIso);
        setNewStartTime(startT);
        setNewEndTime(endT);
        setModalVisible(true);
      } else {
        openSlotModal(dayIso, startT);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Auto-scroll horizontal timeline to show today's column
  function scrollToCurrentTime(animated = true) {
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    // Offset within grid: 1 hour before current time so you see context
    const timeOffsetY = Math.max(0, ((currentMins - TIMELINE_START_HOUR * 60 - 60) / 60) * HOUR_HEIGHT);
    setTimeout(() => vScrollRef.current?.scrollTo({ y: timeOffsetY, animated }), 200);
  }

  // Auto-scroll to today whenever the current week is in view (mount + week change),
  // exactly like the Parent schedule.
  useEffect(() => {
    if (week.some(d => d.iso === todayISO)) {
      setTimeout(() => scrollToToday(colWidth), 300);
    }
    // Vertical: scroll outer page ScrollView to current time
    scrollToCurrentTime();
  }, [week, todayISO, colWidth]);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="My Schedule"
          subtitle="Stay organized and hit your goals."
          searchPlaceholder="Search schedule or tasks..."
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView ref={vScrollRef} style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── Week navigation bar ── */}
          <View style={styles.weekNavBar}>
            <TouchableOpacity style={styles.navArrow} onPress={prevWeek}>
              <Feather name="chevron-left" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.todayBtn} onPress={goToday}>
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
              {loading ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <ActivityIndicator size="small" color={colors.accentYellow} />
                  <Text style={styles.emptyText}>Loading schedule…</Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row' }}>
                  {/* FIXED LEFT: time labels (never scroll horizontally) */}
                  <View style={{ width: TIME_LABEL_WIDTH, backgroundColor: colors.bgDark, zIndex: 2 }}>
                    <View style={styles.timeColHeader} />
                    {TIMES.map((t) => (
                      <View key={t} style={{ height: HOUR_HEIGHT, justifyContent: 'flex-start', paddingTop: 4 }}>
                        <Text style={styles.timeLabel}>{t}</Text>
                      </View>
                    ))}
                  </View>

                  {/* SCROLLABLE RIGHT: day headers + columns */}
                  <ScrollView
                    ref={hScrollRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ flex: 1 }}
                    // Scroll to today once the grid content has actually laid out — the
                    // effect alone can fire before the (loading-gated) ScrollView mounts.
                    onContentSizeChange={() => {
                      if (!didInitialScrollRef.current && week.some(d => d.iso === todayISO)) {
                        didInitialScrollRef.current = true;
                        scrollToToday(colWidth);
                      }
                    }}
                  >
                    <View style={{ width: colWidth * 7 }}>
                      {/* Day header row */}
                      <View style={styles.dayHeaderRow}>
                        {week.map((d) => {
                          const isToday = d.iso === todayISO;
                          const hasDot  = eventDates.has(d.iso);
                          return (
                            <View key={d.iso} style={[styles.dayHeader, { width: colWidth }]}>
                              <Text style={[styles.dayHeaderLabel, isToday && styles.dayHeaderLabelToday]}>{d.day}</Text>
                              <View style={[styles.dayHeaderCircle, isToday && styles.dayHeaderCircleToday]}>
                                <Text style={[styles.dayHeaderDate, isToday && styles.dayHeaderDateToday]}>{d.date}</Text>
                              </View>
                              {hasDot && <View style={[styles.dayDot, isToday && { backgroundColor: colors.accentYellow }]} />}
                            </View>
                          );
                        })}
                      </View>

                      {/* Day columns */}
                      <View style={{ flexDirection: 'row' }}>
                        {week.map((d, colIdx) => {
                          const dayEvents = (eventsMap[d.iso] ?? []).filter(
                            e => e.startTime !== '23:59'
                          );
                          return (
                            <View
                              key={d.iso}
                              style={[styles.dayCol, { width: colWidth, height: gridHeight }]}
                              // @ts-ignore — onMouseDown is valid in React Native Web
                              onMouseDown={(e: any) => handleColMouseDown(e, d.iso)}
                            >
                              {TIMES.map((t, idx) => (
                                <View key={t} style={[styles.hourCell, { top: idx * HOUR_HEIGHT }]} />
                              ))}

                              {dragPreview?.dayIso === d.iso && dragPreview.height > 8 && (
                                <View style={{
                                  position: 'absolute', left: 2, right: 2,
                                  top: dragPreview.top, height: Math.max(dragPreview.height, 20),
                                  backgroundColor: colors.accentYellow + '28',
                                  borderLeftWidth: 3, borderLeftColor: colors.accentYellow,
                                  borderRadius: 4, paddingHorizontal: 5, paddingVertical: 3,
                                  zIndex: 10,
                                  // @ts-ignore
                                  pointerEvents: 'none',
                                }}>
                                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.accentYellow }}>
                                    {dragPreview.startT} – {dragPreview.endT}
                                  </Text>
                                </View>
                              )}

                              {dayEvents.map(event => {
                                const top = calcEventTop(event.startTime);
                                const height = calcEventHeight(event.startTime, event.endTime);
                                const [accent, fill, textCol] = typeColors(event.type);
                                return (
                                  <TouchableOpacity
                                    key={event.id}
                                    style={[styles.eventBlock, { top, height, backgroundColor: fill, borderLeftColor: accent, borderLeftWidth: 4 }]}
                                    activeOpacity={0.82}
                                    onPress={() => setSelectedEvent({ ...event, accent, fill, textCol })}
                                    // @ts-ignore — stop the day column's drag-to-create mousedown handler
                                    // from also firing (it bubbles from this chip otherwise), which was
                                    // opening the Add Event modal underneath this event's detail modal.
                                    onMouseDown={(e: any) => e.stopPropagation?.()}
                                  >
                                    <Text style={[styles.eventTitle, { color: textCol }]}>{toTitleCase(event.title)}</Text>
                                    <Text style={[styles.eventTime, { color: accent }]}>{event.startTime}{event.endTime ? `–${event.endTime}` : ''}</Text>
                                    <TouchableOpacity
                                      style={styles.deleteBtn}
                                      onPress={() => removeEvent(event.id, d.iso)}
                                      // @ts-ignore
                                      onMouseDown={(e: any) => e.stopPropagation?.()}
                                      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                                    >
                                      <Feather name="x" size={10} color={accent} />
                                    </TouchableOpacity>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  </ScrollView>
                </View>
              )}

              {/* Add event button */}
              <TouchableOpacity style={styles.addEventBtn} onPress={() => { setModalDate(todayISO); setNewStartTime('09:00'); setNewEndTime('10:00'); setModalVisible(true); }} activeOpacity={0.8}>
                <Feather name="plus" size={16} color={colors.accentYellow} />
                <Text style={styles.addEventText}>Add Event</Text>
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
                      const iso = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(date).padStart(2,'0')}`;
                      const isToday   = iso === todayISO;
                      const isWeekDay = week.some(d => d.iso === iso);
                      const hasDot    = eventDates.has(iso);
                      return (
                        <View
                          key={di}
                          style={[styles.calDate, isToday && styles.calDateToday, isWeekDay && !isToday && styles.calDateWeekHighlight]}
                        >
                          <Text style={[styles.calDateText, isToday && styles.calDateTextToday, isWeekDay && !isToday && { color: colors.accentYellow }]}>
                            {date}
                          </Text>
                          {hasDot && <View style={[styles.calDot, { backgroundColor: isToday ? 'white' : colors.accentYellow }]} />}
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
                  <Text style={styles.emptyText}>No upcoming deadlines.{'\n'}Teacher will add them here.</Text>
                ) : (
                  deadlines.map((d) => {
                    const urgent   = d.date === todayISO;
                    const dueColor = urgent ? colors.accentRed : d.date < todayISO ? colors.accentRed : colors.accentYellow;
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
                  <TouchableOpacity key={t} style={[styles.timeChip, newType === t && { borderColor: typeColors(t)[0], backgroundColor: typeColors(t)[1] }]} onPress={() => setNewType(t)}>
                    <Text style={[styles.timeChipText, newType === t && { color: typeColors(t)[2], fontWeight: '700' }]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4, zIndex: 100 }}>
                <TimePicker label="Start time" value={newStartTime} onChange={(v) => {
                  setNewStartTime(v);
                  if (v >= newEndTime) {
                    const [h, m] = v.split(':').map(Number);
                    const end = new Date(0, 0, 0, h, m + 30);
                    setNewEndTime(`${String(end.getHours()).padStart(2,'0')}:${String(end.getMinutes()).padStart(2,'0')}`);
                  }
                }} />
                <TimePicker label="End time" value={newEndTime} onChange={setNewEndTime} minTime={newStartTime} />
              </View>
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

        {/* ── Event Detail Modal — full title/time/note, tapped from a block ── */}
        <Modal visible={!!selectedEvent} transparent animationType="fade" onRequestClose={() => setSelectedEvent(null)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelectedEvent(null)}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[styles.modal, { borderLeftWidth: 4, borderLeftColor: selectedEvent?.accent || colors.accentYellow }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <Text style={[styles.modalTitle, { flex: 1 }]}>{selectedEvent ? toTitleCase(selectedEvent.title) : ''}</Text>
                <TouchableOpacity onPress={() => setSelectedEvent(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Feather name="x" size={18} color={colors.textDim} />
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: selectedEvent?.accent || colors.accentYellow, marginTop: 4 }}>
                {selectedEvent?.startTime}{selectedEvent?.endTime ? ` – ${selectedEvent.endTime}` : ''}
              </Text>
              {selectedEvent?.note ? (
                <View style={{ marginTop: 12, backgroundColor: colors.bgDark, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.borderColor }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Note</Text>
                  <Text style={{ fontSize: 13, color: colors.textMain, lineHeight: 19 }}>{selectedEvent.note}</Text>
                </View>
              ) : (
                <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 12, fontStyle: 'italic' }}>No note added for this event.</Text>
              )}
              <View style={[styles.modalBtns, { justifyContent: 'center' }]}>
                <TouchableOpacity style={[styles.modalConfirm, { flex: 0, paddingHorizontal: 32 }]} onPress={() => setSelectedEvent(null)}>
                  <Text style={styles.modalConfirmText}>Close</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:  { flex: 1, backgroundColor: c.bgDark },
  scroll:  { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 40 },

  // Week nav
  weekNavBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.md, marginBottom: spacing.xl,
  },
  navArrow:     { padding: spacing.sm },
  todayBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor,
  },
  todayBtnText: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  weekLabel:    { flex: 1, fontSize: 13, fontWeight: '700', color: c.textMain, textAlign: 'center' },

  // Layout
  mainLayout:        { flexDirection: 'row', gap: spacing.xl },
  calendarContainer: { flex: 1.5 },
  sideCol:           { flex: 1, gap: spacing.lg },

  timeColHeader: { height: 60 }, // matches dayHeader height so time labels align with grid
  // Day header row (above grid)
  dayHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: c.borderColor,
    marginBottom: 0,
  },
  dayHeader: {
    alignItems: 'center', paddingVertical: spacing.sm, gap: 2,
  },
  dayHeaderLabel: { fontSize: 10, fontWeight: '700', color: c.textDim, letterSpacing: 0.5 },
  dayHeaderLabelToday: { color: c.accentYellow },
  dayHeaderCircle: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  dayHeaderCircleToday: { backgroundColor: c.accentYellow },
  dayHeaderDate:      { fontSize: 14, fontWeight: '700', color: c.textMuted },
  dayHeaderDateToday: { color: 'white' },
  dayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.textDim },

  // Grid
  dayCol: { position: 'relative', borderLeftWidth: 1, borderLeftColor: c.borderColor + '50' },
  hourCell: {
    position: 'absolute', left: 0, right: 0, height: HOUR_HEIGHT,
    borderTopWidth: 1, borderTopColor: c.borderColor + '40',
  },
  timeLabel: { fontSize: 10, color: c.textDim, fontWeight: '600', textAlign: 'right', paddingRight: 6 },

  // Event blocks
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
    backgroundColor: c.accentYellow + '15', borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.3)', borderRadius: radius.md,
    borderStyle: 'dashed', justifyContent: 'center',
  },
  addEventText: { fontSize: 13, fontWeight: '600', color: c.accentYellow },
  emptyText:    { fontSize: 12, color: c.textMuted, marginTop: 8 },

  // Sidebar
  sideCard:      { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, padding: spacing.lg },
  calHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  calMonth:      { fontSize: 13, fontWeight: '700', color: c.textMain },
  calDayHeaders: { flexDirection: 'row', marginBottom: spacing.sm },
  calDayHeader:  { flex: 1, fontSize: 10, color: c.textDim, textAlign: 'center', fontWeight: '600' },
  calWeek:       { flexDirection: 'row', marginBottom: 4 },
  calDate:       { flex: 1, alignItems: 'center', paddingVertical: 4, borderRadius: 6, gap: 2 },
  calDateToday:          { backgroundColor: c.accentYellow },
  calDateWeekHighlight:  { backgroundColor: c.accentYellow + '15' },
  calDateText:           { fontSize: 12, color: c.textMuted, fontWeight: '500' },
  calDateTextToday:      { color: 'white', fontWeight: '700' },
  calDot:        { width: 4, height: 4, borderRadius: 2 },
  sideTitle:     { fontSize: 14, fontWeight: '700', color: c.textMain, marginBottom: spacing.lg },
  deadlineItem:  { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  deadlineIcon:  { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  deadlineTitle: { fontSize: 12, fontWeight: '600', color: c.textMain },
  deadlineDue:   { fontSize: 11 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  modal: {
    width: '90%', maxWidth: 480, backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md,
  },
  modalTitle:       { fontSize: 17, fontWeight: '700', color: c.textMain, fontFamily: fonts.serif },
  modalInput:       { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, padding: spacing.md, color: c.textMain, fontSize: 14 },
  modalLabel:       { fontSize: 12, color: c.textMuted, fontWeight: '600' },
  timeChip:         { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor, marginRight: 6 },
  timeChipActive:   { borderColor: c.accentYellow + '50', backgroundColor: c.accentYellow + '15' },
  timeChipText:     { fontSize: 12, color: c.textMuted },
  modalBtns:        { flexDirection: 'row', gap: spacing.md },
  modalCancel:      { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center' },
  modalCancelText:  { fontSize: 13, fontWeight: '600', color: c.textMuted },
  modalConfirm:     { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.accentYellow, alignItems: 'center' },
  modalConfirmText: { fontSize: 13, fontWeight: '700', color: 'white' },
});
