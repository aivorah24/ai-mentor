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
  Linking,
  Animated,
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
// Full-day axis (12 AM – 11 PM) like Toddle; the grid auto-scrolls to the
// current hour on load (see scrollToCurrentTime) so it opens on relevant hours.
const TIMES = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
const CAL_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DURATIONS = ['30 min', '45 min', '1 hr', '1.5 hrs', '2 hrs', '2.5 hrs', '3 hrs'];

// ── Canonical tag definitions (mirrors Toddle's tag sidebar) ──────────────
const ASSIGNMENT_TAGS = [
  { key: 'Live Class / Lesson', color: '#7FC29B' },
  { key: 'Study Session',       color: '#C9A24E' },
  { key: 'Learning experience', color: '#7FC29B' },
  { key: 'Quick task',          color: '#7FB2D6' },
  { key: 'Worksheet / Assignment', color: '#E3B24C' },
  { key: 'AI Tutor',            color: '#9B8FE8' },
  { key: 'Video meeting',       color: '#E58AA6' },
  { key: 'AI Challenge',        color: '#6B5BA8' },
  { key: 'Deadline',            color: '#B84A3A' },
];

const EVENT_TAGS = [
  { key: 'Holidays and vacations', color: '#E58AA6' },
  { key: 'Whole school events',    color: '#7FC29B' },
  { key: 'Special Assembly',       color: '#7FC29B' },
  { key: 'Working Day / Break',    color: '#C4BCA9' },
  { key: 'MYP Unit Timeline',      color: '#E58AA6' },
  { key: 'Rotation Day Cycle',     color: '#7FB2D6' },
  { key: 'SmartTask Cycle Timeline', color: '#E58AA6' },
];

function deriveTypeFromTag(tag: string): string {
  if (!tag) return 'study';
  const lower = tag.toLowerCase();
  if (lower.includes('lesson') || lower.includes('live class') || lower.includes('video')) return 'lesson';
  if (lower.includes('challenge')) return 'challenge';
  if (lower.includes('deadline')) return 'deadline';
  if (lower.includes('worksheet') || lower.includes('assignment')) return 'assignment';
  if (lower.includes('break') || lower.includes('working day')) return 'break';
  return 'study';
}
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
  tagCategory?: 'assignment' | 'event';
  assignmentId?: string | null;
  createdAt?: string;
  isCompleted?: boolean;
  startDate?: string;
  isTimetableClass?: boolean;
}

// Returns [accent, pastelfill, textColor] — aligned to the Timetable pastel
// palette so the Calendar and Timetable read as one system. Pastel fills carry
// dark ink and render the same in dark/light (like the timetable cards).
function typeColors(type: string): [string, string, string] {
  const map: Record<string, [string, string, string]> = {
    lesson:     ['#7FC29B', '#E4F3E9', '#2E7D5B'],  // live class — mint
    study:      ['#7FB2D6', '#E1EEFA', '#2E6285'],  // daily task / personal study — sky
    challenge:  ['#E58AA6', '#FCE0E9', '#9C3556'],  // challenge — rose
    deadline:   ['#E3B24C', '#FFF6C9', '#6E5410'],  // worksheet / assignment due — gold
    assignment: ['#E3B24C', '#FFF6C9', '#6E5410'],  // worksheet — gold
    break:      ['#C4BCA9', '#EDE9E2', '#6E6A60'],  // neutral
  };
  return map[type] ?? ['#7FB2D6', '#E1EEFA', '#2E6285'];
}

function toTitleCase(str: string) {
  return String(str || '').replace(/\b\w/g, c => c.toUpperCase());
}

// '08:00' → '8 AM', '13:00' → '1 PM' — friendly 12-hour axis (not railway time).
function fmtHour12(hhmm: string): string {
  const h = Number(hhmm.split(':')[0]);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
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

  // Category filters and completion status switch
  const [filterType, setFilterType] = useState<'all' | 'assignments' | 'study' | 'classes'>('all');
  const [hideCompleted, setHideCompleted] = useState(false);

  // ── Tag-based filter checkboxes (like Toddle's sidebar) ──
  const [enabledAssignmentTags, setEnabledAssignmentTags] = useState<Set<string>>(
    () => new Set(ASSIGNMENT_TAGS.map(t => t.key))
  );
  const [enabledEventTags, setEnabledEventTags] = useState<Set<string>>(
    () => new Set(EVENT_TAGS.map(t => t.key))
  );
  const [showTagPanel, setShowTagPanel] = useState(false);
  const [iCalCopied, setICalCopied] = useState(false);
  const [timetableData, setTimetableData] = useState<any | null>(null);

  // Returns true if the event's tag passes the current tag filter checkboxes
  const passesTagFilter = useCallback((ev: ScheduleEvent): boolean => {
    const tag = ev.tag || '';
    // Check event tags
    const isEventTag = EVENT_TAGS.some(t => tag.toLowerCase().includes(t.key.toLowerCase()));
    if (isEventTag) {
      return EVENT_TAGS.some(t => tag.toLowerCase().includes(t.key.toLowerCase()) && enabledEventTags.has(t.key));
    }
    // Check assignment tags
    return ASSIGNMENT_TAGS.some(t => tag.toLowerCase().includes(t.key.toLowerCase()) && enabledAssignmentTags.has(t.key))
      || (!ASSIGNMENT_TAGS.some(t => tag.toLowerCase().includes(t.key.toLowerCase())) && enabledAssignmentTags.size > 0);
  }, [enabledAssignmentTags, enabledEventTags]);

  // Compute all-day lane height from events — avoids onLayout feedback loop
  const allDayHeight = useMemo(() => {
    const max = Math.max(
      1,
      ...week.map((d) =>
        (eventsMap[d.iso] ?? []).filter((e) => {
          if (hideCompleted && e.isCompleted) return false;
          if (filterType === 'study' || filterType === 'classes') return false;
          if (!passesTagFilter(e)) return false;
          const tagLower = (e.tag || '').toLowerCase();
          const isEventTag = ['holiday', 'vacation', 'assembly', 'timeline', 'whole school', 'rotation', 'cycle'].some((k) => tagLower.includes(k));
          return e.startTime === '23:59' || e.isAllDay || e.type === 'deadline' || e.type === 'challenge' || isEventTag;
        }).length
      )
    );
    return Math.max(36, max * 26 + 10);
  }, [eventsMap, week, hideCompleted, filterType, enabledAssignmentTags, enabledEventTags]);

  // Event detail modal — shows the full title/time/note when tapping an event block
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);

  // Modal state — pre-filled date/time when tapping a slot
  const [modalVisible, setModalVisible] = useState(false);
  const [modalDate, setModalDate] = useState(todayISO);
  const [newTitle, setNewTitle] = useState('');
  const [newStartTime, setNewStartTime] = useState('09:00');
  const [newEndTime, setNewEndTime] = useState('10:00');
  const [isAllDay, setIsAllDay] = useState(false);
  const [newType, setNewType] = useState('study');
  const [newTag, setNewTag] = useState('Study Session');
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchEvents = useCallback(async () => {
    if (!studentId) return;
    // Show the full-screen spinner ONLY for the very first load. Every later fetch
    // (week navigation, 30s poll, focus) keeps the grid mounted — otherwise the grid
    // unmounts and the horizontal scroll resets back to Monday each time.
    if (!firstLoadDoneRef.current) setLoading(true);
    try {
      // Fetch all 7 days of the week in parallel + deadlines + month dots + timetable
      const weekDates = week.map(d => d.iso);
      const dayFetches = weekDates.map(d =>
        fetch(`${SERVER_URL}/schedule?studentId=${studentId}&date=${d}&hideCompleted=${hideCompleted}`)
          .then(r => r.ok ? r.json() : [])
          .then((evs: ScheduleEvent[]) => ({ date: d, events: evs }))
          .catch(() => ({ date: d, events: [] }))
      );
      const [dlRes, monthRes, ttRes, ...dayResults] = await Promise.all([
        fetch(`${SERVER_URL}/schedule/upcoming?studentId=${studentId}&hideCompleted=${hideCompleted}`),
        fetch(`${SERVER_URL}/schedule/month?studentId=${studentId}&year=${calYear}&month=${calMonth}&hideCompleted=${hideCompleted}`),
        fetch(`${SERVER_URL}/timetable?studentId=${studentId}`),
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
      if (ttRes.ok) {
        setTimetableData(await ttRes.json());
      }
    } catch {}
    if (!firstLoadDoneRef.current) { setLoading(false); firstLoadDoneRef.current = true; }
  }, [studentId, week, calYear, calMonth, hideCompleted]);

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

  function openSlotModal(dateISO: string, timeLabel?: string, presetAllDay?: boolean, presetTag?: string) {
    setModalDate(dateISO);
    setIsAllDay(!!presetAllDay);
    if (presetTag) setNewTag(presetTag);
    if (presetAllDay) {
      setNewStartTime('23:59');
      setNewEndTime('23:59');
    } else if (timeLabel) {
      const [h] = timeLabel.split(':');
      const startH = h.padStart(2, '0');
      const endH = String(Math.min(23, parseInt(startH) + 1)).padStart(2, '0');
      setNewStartTime(`${startH}:00`);
      setNewEndTime(`${endH}:00`);
    } else {
      setNewStartTime('09:00');
      setNewEndTime('10:00');
    }
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
          startTime: isAllDay ? '23:59' : newStartTime,
          endTime:   isAllDay ? '23:59' : newEndTime,
          type:      deriveTypeFromTag(newTag),
          tag:       newTag || 'Study Session',
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
    setNewTitle(''); setNewNote(''); setNewTag('Study Session'); setIsAllDay(false); setSaving(false); setModalVisible(false);
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
  const availableGridWidth = Math.max(700, screenWidth - 260 - 24);
  const colWidth = Math.max(DAY_COL_WIDTH, Math.floor((availableGridWidth - TIME_LABEL_WIDTH) / 7));
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

  // ── Tag filter helpers ──────────────────────────────────────────────────────
  const toggleAssignmentTag = useCallback((key: string) => {
    setEnabledAssignmentTags(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const toggleEventTag = useCallback((key: string) => {
    setEnabledEventTags(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const toggleAllAssignment = useCallback((on: boolean) => {
    setEnabledAssignmentTags(on ? new Set(ASSIGNMENT_TAGS.map(t => t.key)) : new Set());
  }, []);

  const toggleAllEvent = useCallback((on: boolean) => {
    setEnabledEventTags(on ? new Set(EVENT_TAGS.map(t => t.key)) : new Set());
  }, []);

  const allAssignmentOn = enabledAssignmentTags.size === ASSIGNMENT_TAGS.length;
  const allEventOn = enabledEventTags.size === EVENT_TAGS.length;

  // iCal subscribe URL
  const iCalUrl = useMemo(() => {
    const base = SERVER_URL.replace(/^https?:/, 'webcal:');
    return `${base}/schedule/ical?studentId=${studentId || ''}&role=student`;
  }, [studentId]);

  const iCalHttpUrl = useMemo(() => {
    return `${SERVER_URL}/schedule/ical?studentId=${studentId || ''}&role=student`;
  }, [studentId]);

  const handleSubscribe = useCallback(() => {
    if (Platform.OS === 'web') {
      window.open(iCalUrl, '_blank');
    } else {
      Linking.openURL(iCalUrl);
    }
  }, [iCalUrl]);

  const handleCopyIcal = useCallback(async () => {
    if (Platform.OS === 'web' && navigator?.clipboard) {
      await navigator.clipboard.writeText(iCalHttpUrl);
      setICalCopied(true);
      setTimeout(() => setICalCopied(false), 2000);
    }
  }, [iCalHttpUrl]);

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

          {/* ── Category Filters & Hide Completed Toggle ── */}
          <View style={styles.filterBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, alignItems: 'center' }}>
              {[
                { key: 'all', icon: 'grid', label: 'All Events' },
                { key: 'assignments', icon: 'flag', label: 'Assignments & Deadlines' },
                { key: 'study', icon: 'clock', label: 'Personal Study' },
              ].map(item => {
                const active = filterType === item.key;
                return (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setFilterType(item.key as any)}
                >
                  <Feather name={item.icon as any} size={13} color={active ? colors.accentYellow : colors.textMuted} style={{ marginRight: 6 }} />
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );})}

              <View style={{ width: 1, height: 20, backgroundColor: colors.borderColor, marginHorizontal: 4 }} />

              <TouchableOpacity
                style={[styles.toggleChip, hideCompleted && styles.toggleChipActive]}
                onPress={() => setHideCompleted(!hideCompleted)}
              >
                <Feather name={hideCompleted ? 'check-square' : 'square'} size={15} color={hideCompleted ? colors.accentYellow : colors.textMuted} />
                <Text style={[styles.toggleChipText, hideCompleted && { color: colors.accentYellow, fontWeight: '700' }]}>
                  Hide Completed
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>

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
                <View style={{ flexDirection: 'row', height: 60 + allDayHeight + gridHeight }}>
                  {/* FIXED LEFT: time labels (never scroll horizontally) */}
                  <View style={{ width: TIME_LABEL_WIDTH, backgroundColor: colors.bgDark, zIndex: 2 }}>
                    <View style={[styles.timeColHeader, { justifyContent: 'flex-end', paddingBottom: 6, alignItems: 'center' }]}>
                      <Text style={{ fontSize: 8.5, fontWeight: '700', color: colors.textDim, textAlign: 'center', lineHeight: 11 }}>GMT{'\n'}+05:30</Text>
                    </View>
                    {/* "All-day" gutter label — keeps the time axis aligned with the
                        all-day lane on the right, and labels the lane. */}
                    <View style={[styles.allDayGutter, { height: allDayHeight }]}>
                      <Text style={styles.allDayGutterText}>All{'\n'}day</Text>
                    </View>
                    {TIMES.map((t) => (
                      <View key={t} style={{ height: HOUR_HEIGHT, justifyContent: 'flex-start', paddingTop: 4 }}>
                        <Text style={styles.timeLabel}>{fmtHour12(t)}</Text>
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

                      {/* All-day row — deadline/challenge items (or multi-day assignment ribbons) */}
                      <View style={[styles.allDayRow, { height: allDayHeight }]}>
                        {week.map((d) => {
                          const allDayEvents = (eventsMap[d.iso] ?? []).filter(e => {
                            if (hideCompleted && e.isCompleted) return false;
                            if (filterType === 'study' || filterType === 'classes') return false;
                            if (!passesTagFilter(e)) return false;
                            const tagLower = (e.tag || '').toLowerCase();
                            const isEventTag = ['holiday', 'vacation', 'assembly', 'timeline', 'whole school', 'rotation', 'cycle'].some(k => tagLower.includes(k));
                            return e.startTime === '23:59' || e.isAllDay || e.type === 'deadline' || e.type === 'challenge' || isEventTag;
                          });
                          return (
                            <TouchableOpacity
                              key={d.iso}
                              style={[styles.allDayCol, { width: colWidth, height: allDayHeight }]}
                              onPress={() => openSlotModal(d.iso, undefined, true, 'Holidays and vacations')}
                              activeOpacity={0.8}
                            >
                              {allDayEvents.map(e => {
                                const [accent, fill, textCol] = typeColors(e.type);
                                const isCompleted = !!e.isCompleted;
                                const chipBg = isCompleted ? '#E6F4EA' : fill;
                                const chipBorder = isCompleted ? '#137333' : accent;
                                const chipTextCol = isCompleted ? '#137333' : textCol;
                                const isMultiDay = e.startDate && e.startDate !== e.date;
                                return (
                                  <TouchableOpacity
                                    key={e.id}
                                    style={[styles.allDayChip, { backgroundColor: chipBg, borderLeftColor: chipBorder }]}
                                    onPress={(evt) => {
                                      evt.stopPropagation();
                                      setSelectedEvent({ ...e, accent, fill, textCol });
                                    }}
                                    activeOpacity={0.75}
                                  >
                                    <Feather
                                      name={isCompleted ? 'check' : e.type === 'challenge' ? 'award' : 'flag'}
                                      size={11}
                                      color={chipTextCol}
                                      style={{ marginRight: 5, flexShrink: 0 }}
                                    />
                                    <Text
                                      style={[
                                        styles.allDayChipText,
                                        { color: chipTextCol, textDecorationLine: isCompleted ? 'line-through' : 'none' }
                                      ]}
                                      numberOfLines={1}
                                    >
                                      {isMultiDay ? `Due ${e.date.slice(5)} · ` : ''}{e.title}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Day columns */}
                      <View style={{ flexDirection: 'row' }}>
                        {week.map((d, colIdx) => {
                          // Timed events only. The weekly recurring bell schedule lives on
                          // the dedicated Timetable screen — it is intentionally NOT overlaid
                          // onto this calendar (which shows dated assignments/challenges/tasks
                          // and one-off events).
                          let dayEvents = (eventsMap[d.iso] ?? []).filter(e => {
                            if (e.startTime === '23:59' || e.type === 'deadline' || e.type === 'challenge') return false;
                            if (hideCompleted && e.isCompleted) return false;
                            if (filterType === 'assignments') return false;
                            if (!passesTagFilter(e)) return false;
                            return true;
                          });

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
                                    {!event.isTimetableClass && (
                                      <TouchableOpacity
                                        style={styles.deleteBtn}
                                        onPress={() => removeEvent(event.id, d.iso)}
                                        // @ts-ignore
                                        onMouseDown={(e: any) => e.stopPropagation?.()}
                                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                                      >
                                        <Feather name="x" size={10} color={accent} />
                                      </TouchableOpacity>
                                    )}
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

            {/* ── Right Sidebar: Tag Filters + Mini Calendar + iCal Subscribe ── */}
            <View style={styles.sideCol}>

              {/* ── Tag Filter Panel ── */}
              <View style={styles.sideCard}>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: showTagPanel ? spacing.md : 0 }}
                  onPress={() => setShowTagPanel(!showTagPanel)}
                  activeOpacity={0.7}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name="filter" size={14} color={colors.accentYellow} />
                    <Text style={styles.sideTitle}>Tag Filters</Text>
                  </View>
                  <Feather name={showTagPanel ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textDim} />
                </TouchableOpacity>

                {showTagPanel && (
                  <View>
                    {/* Assignment Tags */}
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}
                      onPress={() => toggleAllAssignment(!allAssignmentOn)}
                      activeOpacity={0.7}
                    >
                      <View style={{
                        width: 18, height: 18, borderRadius: 4,
                        backgroundColor: allAssignmentOn ? colors.accentYellow : 'transparent',
                        borderWidth: 1.5, borderColor: allAssignmentOn ? colors.accentYellow : colors.textDim,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        {allAssignmentOn && <Feather name="check" size={12} color="white" />}
                      </View>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textHeading, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        ASSIGNMENT TAGS
                      </Text>
                    </TouchableOpacity>
                    {ASSIGNMENT_TAGS.map(tag => {
                      const on = enabledAssignmentTags.has(tag.key);
                      return (
                        <TouchableOpacity
                          key={tag.key}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingLeft: 4 }}
                          onPress={() => toggleAssignmentTag(tag.key)}
                          activeOpacity={0.7}
                        >
                          <View style={{
                            width: 18, height: 18, borderRadius: 4,
                            backgroundColor: on ? tag.color : 'transparent',
                            borderWidth: 1.5, borderColor: on ? tag.color : colors.textDim + '60',
                            alignItems: 'center', justifyContent: 'center',
                          }}>
                            {on && <Feather name="check" size={12} color="white" />}
                          </View>
                          <Text style={{ fontSize: 13, color: colors.textMain, fontWeight: '500' }}>{tag.key}</Text>
                        </TouchableOpacity>
                      );
                    })}

                    {/* Divider */}
                    <View style={{ height: 1, backgroundColor: colors.borderColor, marginVertical: 14 }} />

                    {/* Event Tags */}
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}
                      onPress={() => toggleAllEvent(!allEventOn)}
                      activeOpacity={0.7}
                    >
                      <View style={{
                        width: 18, height: 18, borderRadius: 4,
                        backgroundColor: allEventOn ? colors.accentYellow : 'transparent',
                        borderWidth: 1.5, borderColor: allEventOn ? colors.accentYellow : colors.textDim,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        {allEventOn && <Feather name="check" size={12} color="white" />}
                      </View>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textHeading, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        EVENT TAGS
                      </Text>
                    </TouchableOpacity>
                    {EVENT_TAGS.map(tag => {
                      const on = enabledEventTags.has(tag.key);
                      return (
                        <TouchableOpacity
                          key={tag.key}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingLeft: 4 }}
                          onPress={() => toggleEventTag(tag.key)}
                          activeOpacity={0.7}
                        >
                          <View style={{
                            width: 18, height: 18, borderRadius: 4,
                            backgroundColor: on ? tag.color : 'transparent',
                            borderWidth: 1.5, borderColor: on ? tag.color : colors.textDim + '60',
                            alignItems: 'center', justifyContent: 'center',
                          }}>
                            {on && <Feather name="check" size={12} color="white" />}
                          </View>
                          <Text style={{ fontSize: 13, color: colors.textMain, fontWeight: '500' }}>{tag.key}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>

              {/* ── Mini Calendar ── */}
              <View style={styles.sideCard}>
                <View style={styles.calHeader}>
                  <TouchableOpacity onPress={() => {
                    if (calMonth === 1) { setCalMonth(12); setCalYear(calYear - 1); }
                    else setCalMonth(calMonth - 1);
                  }}>
                    <Feather name="chevron-left" size={16} color={colors.textDim} />
                  </TouchableOpacity>
                  <Text style={styles.calMonth}>{MONTH_NAMES[calMonth - 1]} {calYear}</Text>
                  <TouchableOpacity onPress={() => {
                    if (calMonth === 12) { setCalMonth(1); setCalYear(calYear + 1); }
                    else setCalMonth(calMonth + 1);
                  }}>
                    <Feather name="chevron-right" size={16} color={colors.textDim} />
                  </TouchableOpacity>
                </View>
                <View style={styles.calDayHeaders}>
                  {CAL_DAYS.map(d => <Text key={d} style={styles.calDayHeader}>{d}</Text>)}
                </View>
                {calWeeks.map((row, wi) => (
                  <View key={wi} style={styles.calWeek}>
                    {row.map((day, di) => {
                      if (day === null) return <View key={di} style={styles.calDate} />;
                      const dStr = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                      const isToday = dStr === todayISO;
                      const inWeek = week.some(w => w.iso === dStr);
                      const hasEvent = eventDates.has(dStr);
                      return (
                        <TouchableOpacity
                          key={di}
                          style={[styles.calDate, isToday && styles.calDateToday, !isToday && inWeek && styles.calDateWeekHighlight]}
                          onPress={() => {
                            const nd = new Date(calYear, calMonth - 1, day);
                            setWeekBase(nd);
                          }}
                        >
                          <Text style={[styles.calDateText, isToday && styles.calDateTextToday]}>{day}</Text>
                          {hasEvent && <View style={[styles.calDot, { backgroundColor: isToday ? 'white' : colors.accentYellow }]} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </View>

              {/* ── Upcoming Deadlines ── */}
              <View style={styles.sideCard}>
                <Text style={[styles.sideTitle, { marginBottom: spacing.lg }]}>Upcoming Deadlines</Text>
                {deadlines.length === 0 ? (
                  <Text style={styles.emptyText}>No upcoming deadlines 🎉</Text>
                ) : deadlines.slice(0, 6).map(dl => {
                  const [accent, fill] = typeColors(dl.type);
                  return (
                    <View key={dl.id} style={styles.deadlineItem}>
                      <View style={[styles.deadlineIcon, { backgroundColor: fill }]}>
                        <Feather name={dl.type === 'challenge' ? 'award' : 'flag'} size={14} color={accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.deadlineTitle} numberOfLines={1}>{dl.title}</Text>
                        <Text style={[styles.deadlineDue, { color: accent }]}>Due {dl.date}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>


            </View>

          </View>
        </ScrollView>

        {/* ── Add Event Modal ── */}
        {/* ── Add Event Modal ── */}
        <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setModalVisible(false)}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[styles.modal, { display: 'flex', flexDirection: 'column' }]}>
              {/* Top Fixed Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.borderColor, paddingBottom: 12, marginBottom: 12 }}>
                <Text style={[styles.modalTitle, { marginBottom: 0 }]}>Add Event — {modalDate}</Text>
                <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Feather name="x" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Scrollable Form Content */}
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14, paddingBottom: 6 }}>
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
                <Text style={styles.modalLabel}>Category / Tagline * (Links directly to Tag Filters):</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
                  {ASSIGNMENT_TAGS.concat(EVENT_TAGS).map(t => (
                    <TouchableOpacity
                      key={t.key}
                      style={[
                        styles.timeChip,
                        { flexDirection: 'row', alignItems: 'center' },
                        newTag === t.key && { borderColor: t.color, backgroundColor: t.color + '26', borderWidth: 1.5 }
                      ]}
                      onPress={() => setNewTag(t.key)}
                    >
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color, marginRight: 6 }} />
                      <Text style={[styles.timeChipText, newTag === t.key && { color: colors.textMain, fontWeight: '700' }]}>{t.key}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, marginTop: 4 }}
                  onPress={() => {
                    const next = !isAllDay;
                    setIsAllDay(next);
                    if (next) {
                      setNewStartTime('23:59');
                      setNewEndTime('23:59');
                      if (!newTag || newTag === 'Study Session') setNewTag('Holidays and vacations');
                    } else {
                      setNewStartTime('09:00');
                      setNewEndTime('10:00');
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <View style={{
                    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
                    borderColor: isAllDay ? gold : colors.borderColor,
                    backgroundColor: isAllDay ? gold : 'transparent',
                    alignItems: 'center', justifyContent: 'center'
                  }}>
                    {isAllDay && <Feather name="check" size={13} color="white" />}
                  </View>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textMain }}>
                    All-day event (Holiday / Vacation / Assembly / Timeline)
                  </Text>
                </TouchableOpacity>
                {!isAllDay && (
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
                )}
              </ScrollView>

              {/* Bottom Fixed Footer (Always visible without scrolling) */}
              <View style={[styles.modalBtns, { paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderColor, marginTop: 12 }]}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setModalVisible(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalConfirm} onPress={addEvent} disabled={saving}>
                  <Text style={styles.modalConfirmText}>{saving ? 'Saving…' : 'Add Event'}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
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
              {selectedEvent?.assignmentId && (selectedEvent?.type === 'deadline' || selectedEvent?.type === 'challenge') ? (
                <>
                  {selectedEvent?.createdAt ? (
                    <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 6 }}>
                      Assigned {new Date(selectedEvent.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} at {new Date(selectedEvent.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  ) : null}
                  <Text style={{ fontSize: 12, fontWeight: '700', color: selectedEvent?.accent || colors.accentYellow, marginTop: 4 }}>
                    Closes {new Date(selectedEvent.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} at {selectedEvent.startTime}
                  </Text>
                </>
              ) : (
                <Text style={{ fontSize: 13, fontWeight: '700', color: selectedEvent?.accent || colors.accentYellow, marginTop: 4 }}>
                  {selectedEvent?.startTime}{selectedEvent?.endTime ? ` – ${selectedEvent.endTime}` : ''}
                </Text>
              )}
              {selectedEvent?.note ? (
                <View style={{ marginTop: 12, backgroundColor: colors.bgDark, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.borderColor }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Note</Text>
                  <Text style={{ fontSize: 13, color: colors.textMain, lineHeight: 19 }}>{selectedEvent.note}</Text>
                </View>
              ) : (
                <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 12, fontStyle: 'italic' }}>No note added for this event.</Text>
              )}
              {selectedEvent?.assignmentId && !selectedEvent?.isTimetableClass && (
                <TouchableOpacity
                  style={{
                    backgroundColor: colors.accentYellow,
                    borderRadius: radius.md,
                    paddingVertical: 11,
                    paddingHorizontal: 18,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    marginTop: 14,
                  }}
                  onPress={() => {
                    const isChal = selectedEvent?.type === 'challenge';
                    setSelectedEvent(null);
                    if (isChal) {
                      navigation.navigate('Challenges');
                    } else {
                      navigation.navigate('Assignments');
                    }
                  }}
                >
                  <Feather name="external-link" size={16} color={colors.bgDark} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.bgDark }}>
                    {selectedEvent?.type === 'challenge' ? 'Open Challenge' : 'Open Assignment Worksheet'}
                  </Text>
                </TouchableOpacity>
              )}
              <View style={[styles.modalBtns, { justifyContent: 'center', marginTop: 4 }]}>
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

  // Filters & Toggles
  filterBar: { marginBottom: spacing.lg },
  filterChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.full,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
  },
  filterChipActive: {
    backgroundColor: c.accentYellow + '20', borderColor: c.accentYellow,
  },
  filterChipText: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  filterChipTextActive: { color: c.accentYellow, fontWeight: '700' },
  toggleChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.full,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
  },
  toggleChipActive: {
    backgroundColor: c.accentYellow + '18', borderColor: c.accentYellow,
  },
  toggleChipText: { fontSize: 12, fontWeight: '600', color: c.textMuted },

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
  calendarContainer: { flex: 1 },
  sideCol:           { width: 260, gap: spacing.lg },

  timeColHeader: { height: 60 }, // matches dayHeader height so time labels align with grid
  // Day header row (above grid)
  dayHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: c.borderColor,
    marginBottom: 0,
  },
  dayHeader: {
    height: 60, alignItems: 'center', justifyContent: 'center', gap: 2,
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

  // All-day row (deadline/challenge chips, above the hourly grid)
  allDayRow: { flexDirection: 'row', minHeight: 32, borderBottomWidth: 1, borderBottomColor: c.borderColor },
  allDayCol: { paddingHorizontal: 3, paddingVertical: 4, gap: 3, minHeight: 32 },
  allDayGutter: { minHeight: 32, borderBottomWidth: 1, borderBottomColor: c.borderColor, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  allDayGutterText: { fontSize: 8, fontWeight: '700', color: c.textDim, textAlign: 'center', letterSpacing: 0.3, lineHeight: 10, textTransform: 'uppercase' },
  allDayChip: { flexDirection: 'row', alignItems: 'center', borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4 },
  allDayChipText: { flex: 1, fontSize: 10, fontWeight: '700' },

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
  sideTitle:     { fontSize: 14, fontWeight: '700', color: c.textMain },
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
