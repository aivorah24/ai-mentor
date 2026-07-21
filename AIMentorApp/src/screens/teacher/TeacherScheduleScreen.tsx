import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, useWindowDimensions, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';

import SERVER_URL from '../../config/serverUrl';
import TimePicker from '../../components/common/TimePicker';

const TIMES = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
const DAYS_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DURATIONS = ['30 min', '45 min', '1 hr', '1.5 hrs', '2 hrs', '2.5 hrs', '3 hrs'];
const HOUR_HEIGHT = 56;
const DAY_COL_WIDTH = 140;
const TIME_LABEL_WIDTH = 64;
const TIMELINE_START_HOUR = Number(TIMES[0].split(':')[0]);
const DURATION_MINS: Record<string, number> = {
  '30 min': 30, '45 min': 45, '1 hr': 60,
  '1.5 hrs': 90, '2 hrs': 120, '2.5 hrs': 150, '3 hrs': 180,
};

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
  // Minimum tall enough to fit all 3 lines (title, time, student) without
  // clipping — a 30-min slot at HOUR_HEIGHT scale was too short and cut off
  // the bottom line.
  return Math.max((durationMins / 60) * HOUR_HEIGHT, 46);
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
}

interface StudentItem {
  id: string;
  name: string;
  grade: string;
}

// Returns [accentColor, pastelfill, textColor]
function typeColors(type: string): [string, string, string] {
  const map: Record<string, [string, string, string]> = {
    lesson:     ['#9C844A', '#F5EDDA', '#6B5A30'],  // gold accent / warm cream fill / dark gold text
    study:      ['#C9A24E', '#FBF3DA', '#7A5C1E'],  // amber-gold accent / pale gold fill / dark amber text (Aivorah theme)
    challenge:  ['#6B5BA8', '#E8E4F5', '#3F3270'],  // purple accent / lavender fill / dark purple text
    deadline:   ['#B84A3A', '#F5DDD9', '#7A2A1E'],  // red accent / rose fill / dark red text
    assignment: ['#3A8A6A', '#D9F0E8', '#1E5A40'],  // green accent / mint fill / dark green text
    break:      ['#7A7A7A', '#EBEBEB', '#4A4A4A'],  // grey accent / light grey fill / dark grey text
  };
  return map[type] ?? ['#9C844A', '#F5EDDA', '#6B5A30'];
}

const ALL_TAGS = [...ASSIGNMENT_TAGS, ...EVENT_TAGS];

// Prefer the event's own tag color (same swatch shown in Tag Filters and the
// tag picker) so a chip on the calendar always matches its tag — falls back
// to the coarse type-bucket color only for legacy events with no tag.
function tagColors(tag: string | null | undefined, type: string): [string, string, string] {
  const match = tag ? ALL_TAGS.find(t => tag.toLowerCase().includes(t.key.toLowerCase())) : null;
  if (match) return [match.color, match.color + '22', match.color];
  return typeColors(type);
}

function dateISO(d: Date): string {
  return d.toISOString().split('T')[0];
}

function buildWeek(base: Date): { iso: string; day: string; date: number }[] {
  const dow = base.getDay();
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((dow + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { iso: dateISO(d), day: DAYS_SHORT[i], date: d.getDate() };
  });
}

function fmtHour12(hhmm: string): string {
  const h = Number(hhmm.split(':')[0]);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}

export default function TeacherScheduleScreen({ navigation }: any) {
  const { colors } = useTheme();
  const gold = colors.accentYellow;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const today = useMemo(() => new Date(), []);
  const todayISO = useMemo(() => dateISO(today), [today]);
  const [weekBase, setWeekBase] = useState(today);
  const [nowTime, setNowTime] = useState(new Date());
  const week = useMemo(() => buildWeek(weekBase), [weekBase]);

  // Events stored per day
  const [eventsMap, setEventsMap] = useState<Record<string, ScheduleEvent[]>>({});
  const [loading, setLoading] = useState(false);

  // Student list for picker
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [studentSearch, setStudentSearch] = useState('');

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [modalDate, setModalDate] = useState(todayISO);
  const [newTitle, setNewTitle] = useState('');
  const [newStartTime, setNewStartTime] = useState('09:00');
  const [newEndTime, setNewEndTime] = useState('10:00');
  const [isAllDay, setIsAllDay] = useState(false);
  const [newType, setNewType] = useState('lesson');
  const [newTag, setNewTag] = useState('Live Class / Lesson');
  const [newNote, setNewNote] = useState('');
  const [targetStudents, setTargetStudents] = useState<'all' | 'specific'>('all');
  const [selectedStudent, setSelectedStudent] = useState<StudentItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [saveError, setSaveError] = useState('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  // ── Tag-based filter checkboxes ──
  const [enabledAssignmentTags, setEnabledAssignmentTags] = useState<Set<string>>(
    () => new Set(ASSIGNMENT_TAGS.map(t => t.key))
  );
  const [enabledEventTags, setEnabledEventTags] = useState<Set<string>>(
    () => new Set(EVENT_TAGS.map(t => t.key))
  );
  const [showTagPanel, setShowTagPanel] = useState(false);

  const passesTagFilter = useCallback((ev: ScheduleEvent): boolean => {
    const tag = ev.tag || '';
    const isEventTag = EVENT_TAGS.some(t => tag.toLowerCase().includes(t.key.toLowerCase()));
    if (isEventTag) {
      return EVENT_TAGS.some(t => tag.toLowerCase().includes(t.key.toLowerCase()) && enabledEventTags.has(t.key));
    }
    return ASSIGNMENT_TAGS.some(t => tag.toLowerCase().includes(t.key.toLowerCase()) && enabledAssignmentTags.has(t.key))
      || (!ASSIGNMENT_TAGS.some(t => tag.toLowerCase().includes(t.key.toLowerCase())) && enabledAssignmentTags.size > 0);
  }, [enabledAssignmentTags, enabledEventTags]);

  // Compute all-day lane height from events — avoids onLayout feedback loop
  const allDayHeight = useMemo(() => {
    const max = Math.max(
      1,
      ...week.map((d) =>
        (eventsMap[d.iso] ?? []).filter((e) => {
          if (!passesTagFilter(e)) return false;
          const tagLower = (e.tag || '').toLowerCase();
          const isEventTag = ['holiday', 'vacation', 'assembly', 'timeline', 'whole school', 'rotation', 'cycle'].some((k) => tagLower.includes(k));
          return e.startTime === '23:59' || e.isAllDay || e.type === 'deadline' || e.type === 'challenge' || isEventTag;
        }).length
      )
    );
    return Math.max(36, max * 26 + 10);
  }, [eventsMap, week, enabledAssignmentTags, enabledEventTags]);

  // Drag-to-create preview
  const [dragPreviewTeacher, setDragPreviewTeacher] = useState<{ dayIso: string; top: number; height: number; startT: string; endT: string } | null>(null);

  // ── Drag system: pure native DOM ────────────────────────────────────────────
  const dragRef = useRef<{
    eventId: string; dateISO: string;
    startY: number; origTop: number; duration: number;
    moved: boolean; el: HTMLElement;
  } | null>(null);
  const wasDragRef = useRef(false);
  const setEventsMapRef = useRef(setEventsMap);
  setEventsMapRef.current = setEventsMap;

  const startDrag = useCallback((el: HTMLElement, clientY: number) => {
    const eventId  = el.getAttribute('data-eid') || '';
    const dateISO  = el.getAttribute('data-edate') || '';
    const origTop  = parseFloat(el.getAttribute('data-etop') || '0');
    const duration = parseFloat(el.getAttribute('data-edur') || '60');
    dragRef.current = { eventId, dateISO, startY: clientY, origTop, duration, moved: false, el };
    el.style.opacity = '0.85';
    el.style.zIndex = '999';
    el.style.cursor = 'grabbing';
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = e.clientY - d.startY;
      if (!d.moved && Math.abs(delta) < 4) return;
      d.moved = true;
      wasDragRef.current = true;
      d.el.style.top = `${Math.max(0, d.origTop + delta)}px`;
    };
    const onUp = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      d.el.style.opacity = '';
      d.el.style.zIndex = '';
      d.el.style.cursor = 'grab';
      if (!d.moved) { wasDragRef.current = false; return; }
      const rawTop    = Math.max(0, d.origTop + (e.clientY - d.startY));
      const totalMins = Math.round((rawTop / HOUR_HEIGHT) * 4) * 15;
      const clampedH  = Math.min(21, Math.max(TIMELINE_START_HOUR, TIMELINE_START_HOUR + Math.floor(totalMins / 60)));
      const newMinN   = totalMins % 60;
      const snappedTop = (clampedH - TIMELINE_START_HOUR) * HOUR_HEIGHT + (newMinN / 60) * HOUR_HEIGHT;
      const newStart  = `${String(clampedH).padStart(2,'0')}:${String(newMinN).padStart(2,'0')}`;
      const endMins   = clampedH * 60 + newMinN + d.duration;
      const newEnd    = `${String(Math.floor(endMins / 60) % 24).padStart(2,'0')}:${String(endMins % 60).padStart(2,'0')}`;
      d.el.style.top = `${snappedTop}px`;
      setEventsMapRef.current(prev => ({
        ...prev,
        [d.dateISO]: (prev[d.dateISO] ?? []).map(ev =>
          ev.id === d.eventId ? { ...ev, startTime: newStart, endTime: newEnd } : ev
        ),
      }));
      fetch(`${SERVER_URL}/schedule/${d.eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startTime: newStart, endTime: newEnd }),
      }).catch(() => {});
      setTimeout(() => { wasDragRef.current = false; }, 50);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const fetchEvents = useCallback(async () => {
    // Only show the full-page spinner on the very first load.
    // All subsequent fetches (week change, focus, poll) run silently in background.
    if (!firstLoadDoneRef.current) setLoading(true);
    try {
      const email = user?.email ? `&email=${encodeURIComponent(user.email)}` : '';
      const weekDates = week.map(d => d.iso);
      const dayFetches = weekDates.map(d =>
        fetch(`${SERVER_URL}/schedule/teacher?date=${d}${email}`)
          .then(r => r.ok ? r.json() : [])
          .then((evs: ScheduleEvent[]) => ({ date: d, events: evs }))
          .catch(() => ({ date: d, events: [] }))
      );
      const dayResults = await Promise.all(dayFetches);
      const map: Record<string, ScheduleEvent[]> = {};
      for (const { date, events } of dayResults) {
        map[date] = events;
      }
      setEventsMap(map);
    } catch {}
    if (!firstLoadDoneRef.current) {
      firstLoadDoneRef.current = true;
      setLoading(false);
    }
  }, [week, user?.email]);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(() => fetchEvents(), 30 * 1000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  useFocusEffect(useCallback(() => { fetchEvents(); }, [fetchEvents]));

  // Tick every minute: update current-time line + fire 10-min event reminders.
  const notifiedEventsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setNowTime(now);
      // Check today's events for any starting in the next 10 minutes (±1 min window)
      const todayEvs = eventsMap[dateISO(now)] ?? [];
      const nowMins = now.getHours() * 60 + now.getMinutes();
      todayEvs.forEach(ev => {
        if (ev.type === 'deadline') return;
        const [h, m] = (ev.startTime || '').split(':').map(Number);
        const evMins = h * 60 + m;
        const diff = evMins - nowMins;
        if (diff >= 9 && diff <= 11 && !notifiedEventsRef.current.has(ev.id)) {
          notifiedEventsRef.current.add(ev.id);
          if (Platform.OS === 'web' && 'Notification' in window) {
            const show = () => new window.Notification(`Starting in 10 min: ${ev.title}`, {
              body: `${ev.startTime} — ${ev.type}`,
              icon: '/favicon.ico',
            });
            if ((window.Notification as any).permission === 'granted') {
              show();
            } else if ((window.Notification as any).permission !== 'denied') {
              (window.Notification as any).requestPermission().then((p: string) => { if (p === 'granted') show(); });
            }
          }
        }
      });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [eventsMap]);

  // Re-fetch students on every focus so removing a student is reflected immediately
  useFocusEffect(useCallback(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(user.email)}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: StudentItem[]) => setStudents(data))
      .catch(() => {});
  }, [user?.email]));

  function resetModalForm() {
    setNewTitle(''); setNewNote(''); setNewTag('Live Class / Lesson');
    setSelectedStudent(null); setStudentSearch(''); setIsAllDay(false);
    setTargetStudents('all'); setEditingEventId(null);
  }

  function closeModal() {
    setModalVisible(false);
    setEditingEventId(null);
  }

  function openModal(presetDate?: string, presetTime?: string, presetAllDay?: boolean, presetTag?: string) {
    setEditingEventId(null);
    setNewTitle(''); setNewNote(''); setSelectedStudent(null); setStudentSearch(''); setTargetStudents('all');
    setNewTag(presetTag || 'Live Class / Lesson');
    setModalDate(presetDate ?? todayISO);
    setIsAllDay(!!presetAllDay);
    if (presetAllDay) {
      setNewStartTime('23:59');
      setNewEndTime('23:59');
    } else if (presetTime) {
      const [h] = presetTime.split(':');
      const sh = h.padStart(2, '0');
      const eh = String(Math.min(23, parseInt(sh) + 1)).padStart(2, '0');
      setNewStartTime(`${sh}:00`);
      setNewEndTime(`${eh}:00`);
    } else {
      setNewStartTime('09:00');
      setNewEndTime('10:00');
    }
    setSaveError('');
    setModalVisible(true);
  }

  // Pre-fills the same Create Event modal from an existing event so editing
  // reuses one form instead of a second UI — saveEvent() below branches on
  // editingEventId to PATCH instead of POST.
  function openEditModal(ev: any) {
    setSelectedEvent(null);
    setEditingEventId(ev.id);
    setModalDate(ev.date);
    setNewTitle(ev.title || '');
    setNewNote(ev.note || '');
    setNewTag(ev.tag || 'Live Class / Lesson');
    const allDay = ev.startTime === '23:59';
    setIsAllDay(allDay);
    setNewStartTime(allDay ? '23:59' : ev.startTime);
    setNewEndTime(allDay ? '23:59' : (ev.endTime || ev.startTime));
    if (ev.studentId && ev.studentId !== 'all') {
      setTargetStudents('specific');
      const found = students.find(s => s.id === ev.studentId);
      setSelectedStudent(found || { id: ev.studentId, name: ev.studentName || 'Student', grade: '' });
    } else {
      setTargetStudents('all');
      setSelectedStudent(null);
    }
    setStudentSearch('');
    setSaveError('');
    setModalVisible(true);
  }

  async function saveEvent() {
    if (!newTitle.trim()) { setSaveError('Please enter an event title.'); return; }
    const assignTo = targetStudents === 'all' ? 'all' : (selectedStudent?.id ?? 'all');
    const payload = {
      title:     newTitle,
      date:      modalDate,
      startTime: isAllDay ? '23:59' : newStartTime,
      endTime:   isAllDay ? '23:59' : newEndTime,
      type:      deriveTypeFromTag(newTag),
      tag:       newTag || 'Live Class / Lesson',
      note:      newNote,
      studentId: assignTo,
    };
    setSaving(true); setSaveError('');
    try {
      if (editingEventId) {
        const res = await fetch(`${SERVER_URL}/schedule/${editingEventId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const updated = await res.json().catch(() => null);
          const merged = (updated && updated.id) ? updated : { ...payload, id: editingEventId, createdBy: 'teacher', creatorEmail: user?.email || '' };
          setEventsMap(prev => {
            const next: Record<string, ScheduleEvent[]> = {};
            for (const key of Object.keys(prev)) next[key] = prev[key].filter(e => e.id !== editingEventId);
            next[modalDate] = [...(next[modalDate] ?? []), merged];
            return next;
          });
          resetModalForm();
          setSaving(false); setModalVisible(false);
        } else {
          const body = await res.json().catch(() => ({}));
          setSaveError(body.error ?? `Server error ${res.status}`);
          setSaving(false);
        }
      } else {
        const res = await fetch(`${SERVER_URL}/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, createdBy: 'teacher', creatorEmail: user?.email || '' }),
        });
        if (res.ok) {
          const ev = await res.json();
          setEventsMap(prev => ({
            ...prev,
            [modalDate]: [...(prev[modalDate] ?? []), ev],
          }));
          resetModalForm();
          setSaving(false); setModalVisible(false);
        } else {
          const body = await res.json().catch(() => ({}));
          setSaveError(body.error ?? `Server error ${res.status}`);
          setSaving(false);
        }
      }
    } catch (err: any) {
      setSaveError(err?.message ?? 'Network error — is the server running?');
      setSaving(false);
    }
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

  async function confirmDeleteEvent(ev: any) {
    const ok = Platform.OS === 'web' ? window.confirm(`Delete "${ev.title}"? This can't be undone.`) : true;
    if (!ok) return;
    await removeEvent(ev.id, ev.date);
    setSelectedEvent(null);
  }

  const filteredStudents = useMemo(() =>
    students.filter(s =>
      s.name?.toLowerCase().includes(studentSearch.toLowerCase()) ||
      s.grade?.toLowerCase().includes(studentSearch.toLowerCase())
    ),
    [students, studentSearch]
  );

  const gridHeight = TIMES.length * HOUR_HEIGHT;
  const { width: screenWidth } = useWindowDimensions();
  const availableGridWidth = Math.max(700, screenWidth - 260 - 24);
  const colWidth = Math.max(DAY_COL_WIDTH, Math.floor((availableGridWidth - TIME_LABEL_WIDTH) / 7));
  const totalGridWidth = TIME_LABEL_WIDTH + colWidth * 7;

  // Horizontal scroll to today's column + vertical scroll to current time.
  const hScrollRef = useRef<ScrollView>(null);
  const vScrollRef = useRef<ScrollView>(null);
  const firstLoadDoneRef = useRef(false);

  function scrollToTodayCol(base: Date, cw: number) {
    const dow = base.getDay();          // 0=Sun
    const todayCol = (dow + 6) % 7;    // Mon=0 … Sun=6
    hScrollRef.current?.scrollTo({ x: todayCol * cw, animated: true });
  }

  function scrollToCurrentTime(animated = true) {
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const timeOffsetY = Math.max(0, ((currentMins - TIMELINE_START_HOUR * 60 - 60) / 60) * HOUR_HEIGHT);
    setTimeout(() => vScrollRef.current?.scrollTo({ y: timeOffsetY, animated }), 200);
  }

  function goToday() {
    const now = new Date();
    const alreadyOnThisWeek = week.some(d => d.iso === todayISO);
    if (alreadyOnThisWeek) {
      scrollToTodayCol(now, colWidth);
      scrollToCurrentTime();
    } else {
      setWeekBase(now);
    }
  }

  useEffect(() => {
    if (week.some(d => d.iso === todayISO)) {
      setTimeout(() => scrollToTodayCol(weekBase, colWidth), 300);
    }
    scrollToCurrentTime();
  }, [week, todayISO, colWidth]);

  // ── Tag filter helpers ──
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

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        {/* Header row with + New Event button */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Header title="Class Schedule" subtitle="Create sessions and deadlines for students." />
          </View>
          <TouchableOpacity style={styles.addEventBtnTop} onPress={() => openModal()} activeOpacity={0.8}>
            <Feather name="plus" size={15} color="white" />
            <Text style={styles.addEventBtnTopText}>New Event</Text>
          </TouchableOpacity>
        </View>

        <ScrollView ref={vScrollRef} style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* Info banner */}
          <View style={styles.infoBanner}>
            <Feather name="info" size={14} color={colors.accentCyan} />
            <Text style={styles.infoText}>Events you create here are visible to students and parents in their Schedule screen.</Text>
          </View>

          {/* ── Week navigation bar ── */}
          <View style={styles.weekNavBar}>
            <TouchableOpacity style={styles.navArrow} onPress={() => { const d = new Date(weekBase); d.setDate(d.getDate() - 7); setWeekBase(d); }}>
              <Feather name="chevron-left" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.todayBtn} onPress={goToday}>
              <Text style={styles.todayBtnText}>Today</Text>
            </TouchableOpacity>
            <Text style={styles.weekLabel}>
              {week[0].day} {week[0].date} — {week[6].day} {week[6].date}
            </Text>
            <TouchableOpacity style={styles.navArrow} onPress={() => { const d = new Date(weekBase); d.setDate(d.getDate() + 7); setWeekBase(d); }}>
              <Feather name="chevron-right" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* ── Grid: fixed time labels + horizontally scrollable day columns ── */}
          {loading ? (
            <ActivityIndicator size="large" color={gold} style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.mainLayout}>
              {/* ── Left: Week Calendar Grid ── */}
              <View style={styles.calendarContainer}>
                <View style={{ flexDirection: 'row', height: 62 + allDayHeight + gridHeight }}>
                  {/* FIXED LEFT: time label column (never scrolls horizontally) */}
                  <View style={{ width: TIME_LABEL_WIDTH, backgroundColor: colors.bgDark, zIndex: 2, overflow: 'hidden', borderRightWidth: 1, borderRightColor: colors.borderColor }}>
                    {/* Spacer matching day header height with GMT label — Toddle-style: single line, left-aligned */}
                    <View style={[styles.timeColHeader, { justifyContent: 'flex-end', paddingBottom: 6, paddingLeft: 6, alignItems: 'flex-start' }]}>
                      <Text style={{ fontSize: 9, fontWeight: '600', color: colors.textDim }} numberOfLines={1}>GMT+05:30</Text>
                    </View>
                    {/* All-day gutter label matching Toddle */}
                    <View style={[styles.allDayGutter, { height: allDayHeight }]}>
                      <Text style={styles.allDayGutterText}>All day</Text>
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
                onContentSizeChange={() => {
                  // Auto-scroll to today's column whenever the grid re-renders
                  // with today's week (first load or after navigating back via Today btn).
                  if (week.some(d => d.iso === todayISO)) {
                    if (!firstLoadDoneRef.current) {
                      firstLoadDoneRef.current = true;
                      scrollToTodayCol(weekBase, colWidth);
                    }
                  }
                }}
              >
                <View style={{ width: colWidth * 7 }}>
                  {/* Day header row */}
                  <View style={styles.dayHeaderRow}>
                    {week.map((d) => {
                      const isToday = d.iso === todayISO;
                      return (
                        <View key={d.iso} style={[styles.dayHeader, { width: colWidth }, isToday && styles.dayHeaderToday]}>
                          <Text style={[styles.dayHeaderLabel, isToday && styles.dayHeaderLabelToday]}>{String(d.date).padStart(2, '0')} {d.day.charAt(0) + d.day.slice(1).toLowerCase()}</Text>
                        </View>
                      );
                    })}
                  </View>

                  {/* All-day row — deadline/challenge items (stored at 23:59) are excluded
                      from the hourly grid below since a 1-minute-tall block there would be
                      invisible; show them here instead. Not draggable/deletable since these
                      are auto-generated from assignments/challenges, but tappable to view detail. */}
                  {/* All-day row — Toddle style holiday / vacation / timeline / challenge chips */}
                  <View style={[styles.allDayRow, { height: allDayHeight }]}>
                    {week.map((d) => {
                      const allDayEvents = (eventsMap[d.iso] ?? []).filter(e => {
                        if (!passesTagFilter(e)) return false;
                        const tagLower = (e.tag || '').toLowerCase();
                        const isEventTag = ['holiday', 'vacation', 'assembly', 'timeline', 'whole school', 'rotation', 'cycle'].some(k => tagLower.includes(k));
                        return e.startTime === '23:59' || e.isAllDay || e.type === 'deadline' || e.type === 'challenge' || isEventTag;
                      });
                      return (
                        <TouchableOpacity
                          key={d.iso}
                          style={[styles.allDayCol, { width: colWidth, height: allDayHeight }]}
                          onPress={() => openModal(d.iso, undefined, true, 'Holidays and vacations')}
                          activeOpacity={0.8}
                        >
                          {allDayEvents.map(e => {
                            const [accent, fill, textCol] = tagColors(e.tag, e.type);
                            return (
                              <TouchableOpacity
                                key={e.id}
                                style={[styles.allDayChip, { backgroundColor: fill, borderLeftColor: accent }]}
                                onPress={(evt) => {
                                  evt.stopPropagation();
                                  setSelectedEvent({ ...e, accent, fill, textCol });
                                }}
                                activeOpacity={0.75}
                              >
                                <Text style={[styles.allDayChipText, { color: textCol }]} numberOfLines={1}>{e.title}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Day columns */}
                  <View style={{ flexDirection: 'row' }}>
                    {week.map((d) => {
                      const dayEvents = (eventsMap[d.iso] ?? []).filter(
                        e => e.startTime !== '23:59' && passesTagFilter(e)
                      );
                      return (
                        <View
                          key={d.iso}
                          style={[styles.dayCol, { width: colWidth, height: gridHeight }]}
                          // @ts-ignore
                          onMouseDown={(e: any) => {
                            if (e.button !== 0) return;
                            if ((e.target as HTMLElement).closest('[data-delbtn],[data-eid]')) return;
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const startY = e.clientY - rect.top;
                            const gh = gridHeight;
                            const yToT = (y: number) => {
                              const mins = Math.round((Math.max(0, Math.min(y, gh)) / HOUR_HEIGHT * 60 + TIMELINE_START_HOUR * 60) / 15) * 15;
                              return `${String(Math.floor(mins/60)%24).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
                            };
                            setDragPreviewTeacher({ dayIso: d.iso, top: startY, height: 0, startT: yToT(startY), endT: yToT(startY) });
                            e.preventDefault();
                            const onMove = (ev: MouseEvent) => {
                              const curY = ev.clientY - rect.top;
                              setDragPreviewTeacher({ dayIso: d.iso, top: Math.min(startY, curY), height: Math.abs(curY - startY), startT: yToT(Math.min(startY, curY)), endT: yToT(Math.max(startY, curY)) });
                            };
                            const onUp = (ev: MouseEvent) => {
                              window.removeEventListener('mousemove', onMove);
                              window.removeEventListener('mouseup', onUp);
                              setDragPreviewTeacher(null);
                              const curY = ev.clientY - rect.top;
                              const startT = yToT(Math.min(startY, curY));
                              const endT = yToT(Math.max(startY, curY));
                              const [sh, sm] = startT.split(':').map(Number);
                              const [eh, em] = endT.split(':').map(Number);
                              const dur = (eh * 60 + em) - (sh * 60 + sm);
                              const closest = DURATIONS.reduce((best, lbl) => {
                                const mins = DURATION_MINS[lbl] ?? 60;
                                return Math.abs(mins - dur) < Math.abs((DURATION_MINS[best] ?? 60) - dur) ? lbl : best;
                              }, '1 hr');
                              setModalDate(d.iso);
                              setNewStartTime(startT);
                              setNewEndTime(endT);
                              setModalVisible(true);
                            };
                            window.addEventListener('mousemove', onMove);
                            window.addEventListener('mouseup', onUp);
                          }}
                        >
                          {/* Hour grid lines */}
                          {TIMES.map((t, idx) => (
                            <TouchableOpacity
                              key={t}
                              style={[styles.hourCell, { top: idx * HOUR_HEIGHT }]}
                              onPress={() => openModal(d.iso, t)}
                              activeOpacity={0.3}
                            />
                          ))}
                          {/* Current-time red indicator line (today's column only) */}
                          {d.iso === todayISO && (() => {
                            const nowH = nowTime.getHours();
                            const nowM = nowTime.getMinutes();
                            if (nowH < TIMELINE_START_HOUR || nowH > 22) return null;
                            const topPx = (nowH - TIMELINE_START_HOUR) * HOUR_HEIGHT + (nowM / 60) * HOUR_HEIGHT;
                            return (
                              <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: topPx, zIndex: 10 }}>
                                <View style={{ position: 'absolute', left: -6, top: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#E53935' }} />
                                <View style={{ height: 2, backgroundColor: '#E53935', opacity: 0.85 }} />
                              </View>
                            );
                          })()}
                          {/* Drag-to-create preview */}
                          {dragPreviewTeacher?.dayIso === d.iso && dragPreviewTeacher.height > 8 && (
                            <View style={{
                              position: 'absolute', left: 2, right: 2,
                              top: dragPreviewTeacher.top, height: Math.max(dragPreviewTeacher.height, 20),
                              backgroundColor: gold + '28',
                              borderLeftWidth: 3, borderLeftColor: gold,
                              borderRadius: 4, paddingHorizontal: 5, paddingVertical: 3,
                              zIndex: 10, // @ts-ignore
                              pointerEvents: 'none',
                            }}>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: gold }}>
                                {dragPreviewTeacher.startT} – {dragPreviewTeacher.endT}
                              </Text>
                            </View>
                          )}
                          {/* Absolutely positioned events — raw div for reliable drag */}
                          {dayEvents.map(event => {
                            const origTop = calcEventTop(event.startTime);
                            const height  = calcEventHeight(event.startTime, event.endTime);
                            const [accent, fill, textCol] = tagColors(event.tag, event.type);
                            const [sh, sm] = event.startTime.split(':').map(Number);
                            const [eh, em] = (event.endTime || event.startTime).split(':').map(Number);
                            const durationMins = Math.max(30, (eh * 60 + em) - (sh * 60 + sm));
                            const studentLabel = event.studentId === 'all'
                              ? 'All students'
                              : ((event as any).studentName ?? students.find(s => s.id === event.studentId)?.name ?? 'Student');
                            return (
                              <div
                                key={event.id}
                                data-eid={event.id}
                                data-edate={d.iso}
                                data-etop={String(origTop)}
                                data-edur={String(durationMins)}
                                onMouseDown={(e) => {
                                  // Skip if clicking delete button
                                  if ((e.target as HTMLElement).closest('[data-delbtn]')) return;
                                  e.preventDefault();
                                  startDrag(e.currentTarget, e.clientY);
                                }}
                                onClick={(e) => {
                                  // A drag (mousemove past the 4px threshold) sets wasDragRef —
                                  // only open the detail popup for a genuine click, not a drop.
                                  if (wasDragRef.current) return;
                                  if ((e.target as HTMLElement).closest('[data-delbtn]')) return;
                                  setSelectedEvent({ ...event, date: d.iso, accent, fill, textCol });
                                }}
                                style={{
                                  position: 'absolute', left: 2, right: 2,
                                  top: origTop, height,
                                  backgroundColor: fill,
                                  borderLeft: `4px solid ${accent}`,
                                  borderRadius: 4,
                                  paddingLeft: 6, paddingRight: 5, paddingTop: 3, paddingBottom: 3,
                                  overflow: 'hidden',
                                  cursor: 'grab',
                                  userSelect: 'none',
                                  zIndex: 2,
                                  fontFamily: fonts.sans,
                                }}
                              >
                                <div style={{ fontFamily: fonts.sans, fontSize: 11, fontWeight: 700, color: textCol, lineHeight: '13px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{event.title}</div>
                                <div style={{ fontFamily: fonts.sans, fontSize: 10, color: accent, lineHeight: '13px' }}>{event.startTime}{event.endTime ? `–${event.endTime}` : ''}</div>
                                <div style={{ fontFamily: fonts.sans, fontSize: 10, fontWeight: 600, color: textCol, opacity: 0.8, marginTop: 1, lineHeight: '13px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{studentLabel}</div>
                                <div
                                  data-delbtn="1"
                                  onClick={() => removeEvent(event.id, d.iso)}
                                  style={{ position: 'absolute', top: 3, right: 3, cursor: 'pointer', padding: 2 }}
                                >
                                  <Feather name="x" size={10} color={accent} />
                                </div>
                              </div>
                            );
                          })}
                        </View>
                      );
                    })}
                  </View>
                </View>
              </ScrollView>
            </View>{/* end calendarContainer */}
            </View>{/* end mainLayout */}
          )}

          {/* ── Right Sidebar: Tag Filters ── */}
          <View style={styles.sideCol}>

            {/* ── Tag Filter Panel ── */}
            <View style={styles.sideCard}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: showTagPanel ? spacing.md : 0 }}
                onPress={() => setShowTagPanel(!showTagPanel)}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Feather name="filter" size={14} color={gold} />
                  <Text style={styles.sideTitle}>Tag Filters</Text>
                </View>
                <Feather name={showTagPanel ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textDim} />
              </TouchableOpacity>

              {showTagPanel && (
                <View>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}
                    onPress={() => toggleAllAssignment(!allAssignmentOn)}
                    activeOpacity={0.7}
                  >
                    <View style={{
                      width: 18, height: 18, borderRadius: 4,
                      backgroundColor: allAssignmentOn ? gold : 'transparent',
                      borderWidth: 1.5, borderColor: allAssignmentOn ? gold : colors.textDim,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {allAssignmentOn && <Feather name="check" size={12} color="white" />}
                    </View>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textMain, textTransform: 'uppercase', letterSpacing: 0.5 }}>
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
                  <View style={{ height: 1, backgroundColor: colors.borderColor, marginVertical: 14 }} />
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}
                    onPress={() => toggleAllEvent(!allEventOn)}
                    activeOpacity={0.7}
                  >
                    <View style={{
                      width: 18, height: 18, borderRadius: 4,
                      backgroundColor: allEventOn ? gold : 'transparent',
                      borderWidth: 1.5, borderColor: allEventOn ? gold : colors.textDim,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {allEventOn && <Feather name="check" size={12} color="white" />}
                    </View>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: colors.textMain, textTransform: 'uppercase', letterSpacing: 0.5 }}>
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
          </View>
        </View>
        )}
        </ScrollView>

        {/* ── Create / Edit Event Modal ── */}
        <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={closeModal}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closeModal}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[styles.modal, { display: 'flex', flexDirection: 'column' }]}>
              {/* Top Fixed Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.borderColor, paddingBottom: 12, marginBottom: 12 }}>
                <Text style={[styles.modalTitle, { marginBottom: 0 }]}>{editingEventId ? 'Edit Event' : 'Create Event'} — {modalDate}</Text>
                <TouchableOpacity onPress={closeModal} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Feather name="x" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Scrollable Form Content */}
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14, paddingBottom: 6 }}>
                <TextInput
                  style={[styles.modalInput, saveError && !newTitle.trim() && { borderColor: colors.accentRed }]}
                  placeholder="Event title *"
                  placeholderTextColor={saveError && !newTitle.trim() ? colors.accentRed : colors.textDim}
                  value={newTitle}
                  onChangeText={(t) => { setNewTitle(t); if (t.trim()) setSaveError(''); }}
                />
                <TextInput
                  style={[styles.modalInput, { fontSize: 12 }]}
                  placeholder="Note for students (optional)..."
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
                      if (!newTag || newTag === 'Live Class / Lesson') setNewTag('Holidays and vacations');
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

                {/* Assign to */}
                <Text style={styles.modalLabel}>Assign to:</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.timeChip, targetStudents === 'all' && styles.timeChipActive]}
                    onPress={() => { setTargetStudents('all'); setSelectedStudent(null); }}
                  >
                    <Text style={[styles.timeChipText, targetStudents === 'all' && { color: gold }]}>All students</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.timeChip, targetStudents === 'specific' && styles.timeChipActive]}
                    onPress={() => setTargetStudents('specific')}
                  >
                    <Text style={[styles.timeChipText, targetStudents === 'specific' && { color: gold }]}>Specific student</Text>
                  </TouchableOpacity>
                </View>

                {targetStudents === 'specific' && (
                  <View style={styles.studentPickerBox}>
                    {selectedStudent ? (
                      <TouchableOpacity style={styles.selectedStudentChip} onPress={() => setSelectedStudent(null)} activeOpacity={0.7}>
                        <Feather name="user" size={13} color={gold} />
                        <Text style={styles.selectedStudentName}>{selectedStudent.name}</Text>
                        <Text style={styles.selectedStudentGrade}>{selectedStudent.grade}</Text>
                        <Feather name="x" size={13} color={colors.textDim} />
                      </TouchableOpacity>
                    ) : (
                      <>
                        <TextInput
                          style={styles.studentSearch}
                          placeholder="Search student by name..."
                          placeholderTextColor={colors.textDim}
                          value={studentSearch}
                          onChangeText={setStudentSearch}
                        />
                        <ScrollView style={styles.studentList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                          {filteredStudents.length === 0 ? (
                            <View style={{ alignItems: 'center', paddingVertical: 24, paddingHorizontal: 12 }}>
                              <Feather name="users" size={28} color={colors.textDim} style={{ marginBottom: 8 }} />
                              <Text style={{ color: colors.textMain, fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: 4 }}>
                                {students.length === 0 ? 'No students linked yet' : 'No matching students'}
                              </Text>
                              {students.length === 0 && (
                                <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center' }}>
                                  Go to the Students tab to add students to your class.
                                </Text>
                              )}
                            </View>
                          ) : (
                            filteredStudents.map(s => (
                              <TouchableOpacity
                                key={s.id}
                                style={styles.studentRow}
                                onPress={() => { setSelectedStudent(s); setStudentSearch(''); }}
                                activeOpacity={0.7}
                              >
                                <View style={styles.studentAvatar}>
                                  <Text style={styles.studentAvatarText}>{s.name?.[0] ?? '?'}</Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.studentRowName}>{s.name}</Text>
                                  <Text style={styles.studentRowGrade}>{s.grade}</Text>
                                </View>
                                <Feather name="chevron-right" size={14} color={colors.textDim} />
                              </TouchableOpacity>
                            ))
                          )}
                        </ScrollView>
                      </>
                    )}
                  </View>
                )}

                {saveError ? (
                  <View style={styles.errorBox}>
                    <Feather name="alert-circle" size={13} color={colors.accentRed} />
                    <Text style={styles.errorText}>{saveError}</Text>
                  </View>
                ) : null}
              </ScrollView>

              {/* Bottom Fixed Footer (Always visible without scrolling) */}
              <View style={[styles.modalBtns, { paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderColor, marginTop: 12 }]}>
                <TouchableOpacity style={styles.modalCancel} onPress={closeModal}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalConfirm} onPress={saveEvent} disabled={saving}>
                  <Text style={styles.modalConfirmText}>{saving ? 'Saving…' : (editingEventId ? 'Save Changes' : 'Create Event')}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* ── Event Detail Modal — view, edit, or delete an event ── */}
        <Modal visible={!!selectedEvent} transparent animationType="fade" onRequestClose={() => setSelectedEvent(null)}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelectedEvent(null)}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[styles.modal, { borderLeftWidth: 4, borderLeftColor: selectedEvent?.accent || gold }]}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <Text style={[styles.modalTitle, { flex: 1 }]}>{selectedEvent?.title ?? ''}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginLeft: 8 }}>
                  <TouchableOpacity onPress={() => selectedEvent && openEditModal(selectedEvent)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Edit event">
                    <Feather name="edit-2" size={16} color={colors.textDim} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => selectedEvent && confirmDeleteEvent(selectedEvent)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Delete event">
                    <Feather name="trash-2" size={16} color={colors.accentRed} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setSelectedEvent(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Close">
                    <Feather name="x" size={18} color={colors.textDim} />
                  </TouchableOpacity>
                </View>
              </View>
              {selectedEvent?.createdAt ? (
                <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 6 }}>
                  Assigned {new Date(selectedEvent.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} at {new Date(selectedEvent.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                </Text>
              ) : null}
              <Text style={{ fontSize: 12, fontWeight: '700', color: selectedEvent?.accent || gold, marginTop: 4 }}>
                Closes {selectedEvent?.date ? new Date(selectedEvent.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''} at {selectedEvent?.startTime}
              </Text>
              {selectedEvent?.note ? (
                <View style={{ marginTop: 12, backgroundColor: colors.bgDark, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.borderColor }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Note</Text>
                  <Text style={{ fontSize: 13, color: colors.textMain, lineHeight: 19 }}>{selectedEvent.note}</Text>
                </View>
              ) : null}
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
  screen:    { flex: 1, backgroundColor: c.bgDark },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xl },
  addEventBtnTop: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.accentYellow, paddingHorizontal: spacing.lg,
    paddingVertical: 9, borderRadius: radius.lg,
  },
  addEventBtnTopText: { fontSize: 13, fontWeight: '700', color: 'white' },
  scroll:   { flex: 1 },
  content:  { padding: spacing.xl, paddingBottom: 40 },
  infoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.accentCyan + '12', borderWidth: 1,
    borderColor: c.accentCyan + '30', borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.xl,
  },
  infoText: { fontSize: 12, color: c.accentCyan, flex: 1 },

  // Week nav
  weekNavBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.md, marginBottom: spacing.lg,
  },
  navArrow:     { padding: spacing.sm },
  todayBtn:     { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor },
  todayBtnText: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  weekLabel:    { flex: 1, fontSize: 13, fontWeight: '700', color: c.textMain, textAlign: 'center' },

  // Layout
  mainLayout:        { flexDirection: 'row', gap: spacing.xl },
  calendarContainer: { flex: 1 },
  sideCol:           { width: 260, gap: spacing.lg },

  // Day header
  dayHeaderRow: {
    flexDirection: 'row', height: 62, borderBottomWidth: 1,
    borderBottomColor: c.borderColor, marginBottom: 0,
  },
  dayHeader:            { flex: 1, alignItems: 'flex-start', justifyContent: 'center', paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: c.borderColor + '50' },
  dayHeaderToday:       { backgroundColor: c.accentYellow + '12' },
  dayHeaderLabel:       { fontSize: 13.5, fontWeight: '700', color: c.textMuted },
  dayHeaderLabelToday:  { color: c.accentYellow },

  // All-day row (Toddle style holiday/vacation/timeline chips, above hourly grid)
  allDayRow: { flexDirection: 'row', minHeight: 32, borderBottomWidth: 1, borderBottomColor: c.borderColor },
  allDayCol: { paddingHorizontal: 3, paddingVertical: 4, gap: 3, minHeight: 32, borderLeftWidth: 1, borderLeftColor: c.borderColor + '50' },
  allDayGutter: { minHeight: 32, borderBottomWidth: 1, borderBottomColor: c.borderColor, alignItems: 'flex-start', justifyContent: 'center', paddingVertical: 4, paddingLeft: 6 },
  allDayGutterText: { fontSize: 10.5, fontWeight: '600', color: c.textDim },
  allDayChip: { flexDirection: 'row', alignItems: 'center', borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4 },
  allDayChipText: { flex: 1, fontSize: 11, fontWeight: '700' },

  // Grid
  timeColHeader: { height: 62, borderBottomWidth: 1, borderBottomColor: c.borderColor },
  dayCol: { position: 'relative', borderLeftWidth: 1, borderLeftColor: c.borderColor + '50', overflow: 'visible' },
  hourCell: {
    position: 'absolute', left: 0, right: 0, height: HOUR_HEIGHT,
    borderTopWidth: 1, borderTopColor: c.borderColor + '40',
    justifyContent: 'center',
  },
  timeLabel: { fontSize: 10, color: c.textDim, fontWeight: '600', textAlign: 'right', paddingRight: 6 },

  // Events
  eventBlock: {
    position: 'absolute', left: 2, right: 2,
    borderLeftWidth: 3, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 3,
    overflow: 'hidden',
  },
  eventTitle:   { fontSize: 11, fontWeight: '700', color: '#ffffff' },
  eventTime:    { fontSize: 10, color: 'rgba(255,255,255,0.8)' },
  eventStudent: { fontSize: 10, fontWeight: '600', marginTop: 1, color: 'rgba(255,255,255,0.75)' },
  deleteBtn:    { position: 'absolute', top: 3, right: 3 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  modal:        { width: '90%', maxWidth: 480, maxHeight: '88%', backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xl },
  modalTitle:   { fontSize: 17, fontWeight: '700', color: c.textMain },
  modalInput:   { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, padding: spacing.md, color: c.textMain, fontSize: 14 },
  modalLabel:   { fontSize: 12, color: c.textMuted, fontWeight: '600' },
  chipRow:      { height: 40 },
  chipRowContent: { flexDirection: 'row', alignItems: 'center', paddingBottom: 2 },
  timeChip:     { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor, marginRight: 6 },
  timeChipActive: { borderColor: c.accentYellow, backgroundColor: c.accentYellow + '18' },
  timeChipText: { fontSize: 12, color: c.textMuted },
  studentPickerBox: { borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, overflow: 'hidden' },
  studentSearch: { backgroundColor: 'rgba(255,255,255,0.04)', borderBottomWidth: 1, borderBottomColor: c.borderColor, padding: spacing.md, color: c.textMain, fontSize: 13 },
  studentList:  { maxHeight: 160 },
  noStudentsText: { fontSize: 12, color: c.textDim, textAlign: 'center', padding: spacing.lg },
  studentRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: c.borderColor + '60' },
  studentAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.accentYellow + '30', alignItems: 'center', justifyContent: 'center' },
  studentAvatarText: { fontSize: 13, fontWeight: '700', color: c.accentYellow },
  studentRowName:    { fontSize: 13, fontWeight: '600', color: c.textMain },
  studentRowGrade:   { fontSize: 11, color: c.textDim },
  selectedStudentChip: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md, backgroundColor: c.accentYellow + '14' },
  selectedStudentName:  { fontSize: 13, fontWeight: '600', color: c.textMain, flex: 1 },
  selectedStudentGrade: { fontSize: 11, color: c.textDim },
  errorBox:  { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.accentRed + '14', borderWidth: 1, borderColor: c.accentRed + '40', borderRadius: radius.sm, padding: spacing.md },
  errorText: { fontSize: 12, color: c.accentRed, flex: 1 },
  modalBtns:        { flexDirection: 'row', gap: spacing.md },
  modalCancel:      { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center' },
  modalCancelText:  { fontSize: 13, fontWeight: '600', color: c.textMuted },
  modalConfirm:     { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.accentYellow, alignItems: 'center' },
  modalConfirmText: { fontSize: 13, fontWeight: '700', color: 'white' },
  // Sidebar
  sideCard:      { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, padding: spacing.lg },
  sideTitle:     { fontSize: 14, fontWeight: '700', color: c.textMain },
});
