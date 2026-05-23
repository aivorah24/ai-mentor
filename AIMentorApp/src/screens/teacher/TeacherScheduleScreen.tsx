import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, useWindowDimensions, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';

import SERVER_URL from '../../config/serverUrl';
import TimePicker from '../../components/common/TimePicker';

const TIMES = ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00'];
const DAYS_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DURATIONS = ['30 min', '45 min', '1 hr', '1.5 hrs', '2 hrs', '2.5 hrs', '3 hrs'];
const HOUR_HEIGHT = 56;
const DAY_COL_WIDTH = 140;
const TIME_LABEL_WIDTH = 52;
const TIMELINE_START_HOUR = Number(TIMES[0].split(':')[0]);
const DURATION_MINS: Record<string, number> = {
  '30 min': 30, '45 min': 45, '1 hr': 60,
  '1.5 hrs': 90, '2 hrs': 120, '2.5 hrs': 150, '3 hrs': 180,
};

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

function typeColor(type: string, colors: any): string {
  const map: Record<string, string> = {
    lesson:     colors.accentGreen,
    study:      colors.accentBlue,
    challenge:  colors.accentPurple,
    deadline:   colors.accentRed,
    assignment: colors.accentYellow,
    break:      colors.textDim,
  };
  return map[type] ?? colors.primary;
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

export default function TeacherScheduleScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const today = useMemo(() => new Date(), []);
  const todayISO = useMemo(() => dateISO(today), [today]);
  const [weekBase, setWeekBase] = useState(today);
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
  const [newType, setNewType] = useState('lesson');
  const [newNote, setNewNote] = useState('');
  const [targetStudents, setTargetStudents] = useState<'all' | 'specific'>('all');
  const [selectedStudent, setSelectedStudent] = useState<StudentItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

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
    setLoading(true);
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
    setLoading(false);
  }, [week, user?.email]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // Fetch students linked to this teacher
  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(user.email)}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: StudentItem[]) => setStudents(data))
      .catch(() => {});
  }, [user?.email]);

  function openModal(presetDate?: string, presetTime?: string) {
    setModalDate(presetDate ?? todayISO);
    if (presetTime) {
      const [h] = presetTime.split(':');
      const sh = h.padStart(2, '0');
      const eh = String(Math.min(23, parseInt(sh) + 1)).padStart(2, '0');
      setNewStartTime(`${sh}:00`);
      setNewEndTime(`${eh}:00`);
    }
    setSaveError('');
    setModalVisible(true);
  }

  async function createEvent() {
    if (!newTitle.trim()) { setSaveError('Please enter an event title.'); return; }
    const assignTo = targetStudents === 'all' ? 'all' : (selectedStudent?.id ?? 'all');
    setSaving(true); setSaveError('');
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
          studentId: assignTo,
          createdBy: 'teacher',
        }),
      });
      if (res.ok) {
        const ev = await res.json();
        setEventsMap(prev => ({
          ...prev,
          [modalDate]: [...(prev[modalDate] ?? []), ev],
        }));
        setNewTitle(''); setNewNote(''); setSelectedStudent(null); setStudentSearch('');
        setSaving(false); setModalVisible(false);
      } else {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.error ?? `Server error ${res.status}`);
        setSaving(false);
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

  const filteredStudents = useMemo(() =>
    students.filter(s =>
      s.name?.toLowerCase().includes(studentSearch.toLowerCase()) ||
      s.grade?.toLowerCase().includes(studentSearch.toLowerCase())
    ),
    [students, studentSearch]
  );

  const gridHeight = TIMES.length * HOUR_HEIGHT;
  const { width: screenWidth } = useWindowDimensions();
  const colWidth = Math.max(DAY_COL_WIDTH, Math.floor((screenWidth - TIME_LABEL_WIDTH) / 7));
  const totalGridWidth = TIME_LABEL_WIDTH + colWidth * 7;

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

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

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
            <TouchableOpacity style={styles.todayBtn} onPress={() => setWeekBase(today)}>
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
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <View style={{ flexDirection: 'row' }}>
              {/* FIXED LEFT: time label column (never scrolls horizontally) */}
              <View style={{ width: TIME_LABEL_WIDTH, backgroundColor: colors.bgDark, zIndex: 2 }}>
                {/* Spacer matching day header height */}
                <View style={styles.timeColHeader} />
                {TIMES.map((t) => (
                  <View key={t} style={{ height: HOUR_HEIGHT, justifyContent: 'flex-start', paddingTop: 4 }}>
                    <Text style={styles.timeLabel}>{t}</Text>
                  </View>
                ))}
              </View>

              {/* SCROLLABLE RIGHT: day headers + columns */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                <View style={{ width: colWidth * 7 }}>
                  {/* Day header row */}
                  <View style={styles.dayHeaderRow}>
                    {week.map((d) => {
                      const isToday = d.iso === todayISO;
                      return (
                        <View key={d.iso} style={[styles.dayHeader, { width: colWidth }]}>
                          <Text style={[styles.dayHeaderLabel, isToday && styles.dayHeaderLabelToday]}>{d.day}</Text>
                          <View style={[styles.dayHeaderCircle, isToday && styles.dayHeaderCircleToday]}>
                            <Text style={[styles.dayHeaderDate, isToday && styles.dayHeaderDateToday]}>{d.date}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>

                  {/* Day columns */}
                  <View style={{ flexDirection: 'row' }}>
                    {week.map((d) => {
                      const dayEvents = (eventsMap[d.iso] ?? []).filter(
                        e => e.type !== 'deadline' && e.startTime !== '23:59'
                      );
                      return (
                        <View
                          key={d.iso}
                          style={[styles.dayCol, { width: colWidth, height: gridHeight }]}
                          // @ts-ignore
                          onMouseDown={(e: any) => {
                            if (e.button !== 0) return;
                            if ((e.target as HTMLElement).closest('[data-delbtn],[data-event]')) return;
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
                          {/* Drag-to-create preview */}
                          {dragPreviewTeacher?.dayIso === d.iso && dragPreviewTeacher.height > 8 && (
                            <View style={{
                              position: 'absolute', left: 2, right: 2,
                              top: dragPreviewTeacher.top, height: Math.max(dragPreviewTeacher.height, 20),
                              backgroundColor: colors.primary + '28',
                              borderLeftWidth: 3, borderLeftColor: colors.primary,
                              borderRadius: 4, paddingHorizontal: 5, paddingVertical: 3,
                              zIndex: 10, // @ts-ignore
                              pointerEvents: 'none',
                            }}>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.primary }}>
                                {dragPreviewTeacher.startT} – {dragPreviewTeacher.endT}
                              </Text>
                            </View>
                          )}
                          {/* Absolutely positioned events — raw div for reliable drag */}
                          {dayEvents.map(event => {
                            const origTop = calcEventTop(event.startTime);
                            const height  = calcEventHeight(event.startTime, event.endTime);
                            const color   = typeColor(event.type, colors);
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
                                style={{
                                  position: 'absolute', left: 2, right: 2,
                                  top: origTop, height,
                                  backgroundColor: color + '25',
                                  borderLeft: `3px solid ${color}`,
                                  borderRadius: 4,
                                  paddingLeft: 5, paddingRight: 5, paddingTop: 3, paddingBottom: 3,
                                  overflow: 'hidden',
                                  cursor: 'grab',
                                  userSelect: 'none',
                                  zIndex: 2,
                                }}
                              >
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.title}</div>
                                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>{event.startTime}{event.endTime ? `–${event.endTime}` : ''}</div>
                                <div style={{ fontSize: 10, fontWeight: 600, color, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{studentLabel}</div>
                                <div
                                  data-delbtn="1"
                                  onClick={() => removeEvent(event.id, d.iso)}
                                  style={{ position: 'absolute', top: 3, right: 3, cursor: 'pointer', padding: 2 }}
                                >
                                  <Feather name="x" size={10} color="rgba(255,255,255,0.6)" />
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
            </View>
          )}
        </ScrollView>

        {/* ── Create Event Modal ── */}
        <Modal visible={modalVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modal}>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16 }}>
                <Text style={styles.modalTitle}>Create Event — {modalDate}</Text>
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
                <Text style={styles.modalLabel}>Type:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
                  {['lesson','study','challenge','deadline','assignment','break'].map(t => (
                    <TouchableOpacity key={t} style={[styles.timeChip, newType === t && { borderColor: typeColor(t, colors), backgroundColor: typeColor(t, colors) + '18' }]} onPress={() => setNewType(t)}>
                      <Text style={[styles.timeChipText, newType === t && { color: typeColor(t, colors) }]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
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

                {/* Assign to */}
                <Text style={styles.modalLabel}>Assign to:</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.timeChip, targetStudents === 'all' && styles.timeChipActive]}
                    onPress={() => { setTargetStudents('all'); setSelectedStudent(null); }}
                  >
                    <Text style={[styles.timeChipText, targetStudents === 'all' && { color: colors.primary }]}>All students</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.timeChip, targetStudents === 'specific' && styles.timeChipActive]}
                    onPress={() => setTargetStudents('specific')}
                  >
                    <Text style={[styles.timeChipText, targetStudents === 'specific' && { color: colors.primary }]}>Specific student</Text>
                  </TouchableOpacity>
                </View>

                {targetStudents === 'specific' && (
                  <View style={styles.studentPickerBox}>
                    {selectedStudent ? (
                      <TouchableOpacity style={styles.selectedStudentChip} onPress={() => setSelectedStudent(null)} activeOpacity={0.7}>
                        <Feather name="user" size={13} color={colors.primary} />
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
                            <Text style={styles.noStudentsText}>No students found</Text>
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
                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalCancel} onPress={() => setModalVisible(false)}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalConfirm} onPress={createEvent} disabled={saving}>
                    <Text style={styles.modalConfirmText}>{saving ? 'Saving…' : 'Create Event'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
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
    backgroundColor: c.primary, paddingHorizontal: spacing.lg,
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

  // Day header
  dayHeaderRow: {
    flexDirection: 'row', borderBottomWidth: 1,
    borderBottomColor: c.borderColor, marginBottom: 0,
  },
  dayHeader:            { alignItems: 'center', paddingVertical: spacing.sm, gap: 2 },
  dayHeaderLabel:       { fontSize: 10, fontWeight: '700', color: c.textDim, letterSpacing: 0.5 },
  dayHeaderLabelToday:  { color: c.accentGreen },
  dayHeaderCircle:      { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dayHeaderCircleToday: { backgroundColor: c.accentGreen },
  dayHeaderDate:        { fontSize: 14, fontWeight: '700', color: c.textMuted },
  dayHeaderDateToday:   { color: 'white' },

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
  timeChipActive: { borderColor: c.primary, backgroundColor: c.primaryGlow },
  timeChipText: { fontSize: 12, color: c.textMuted },
  studentPickerBox: { borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, overflow: 'hidden' },
  studentSearch: { backgroundColor: 'rgba(255,255,255,0.04)', borderBottomWidth: 1, borderBottomColor: c.borderColor, padding: spacing.md, color: c.textMain, fontSize: 13 },
  studentList:  { maxHeight: 160 },
  noStudentsText: { fontSize: 12, color: c.textDim, textAlign: 'center', padding: spacing.lg },
  studentRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: c.borderColor + '60' },
  studentAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.primary + '30', alignItems: 'center', justifyContent: 'center' },
  studentAvatarText: { fontSize: 13, fontWeight: '700', color: c.primary },
  studentRowName:    { fontSize: 13, fontWeight: '600', color: c.textMain },
  studentRowGrade:   { fontSize: 11, color: c.textDim },
  selectedStudentChip: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.md, backgroundColor: c.primary + '14' },
  selectedStudentName:  { fontSize: 13, fontWeight: '600', color: c.textMain, flex: 1 },
  selectedStudentGrade: { fontSize: 11, color: c.textDim },
  errorBox:  { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.accentRed + '14', borderWidth: 1, borderColor: c.accentRed + '40', borderRadius: radius.sm, padding: spacing.md },
  errorText: { fontSize: 12, color: c.accentRed, flex: 1 },
  modalBtns:        { flexDirection: 'row', gap: spacing.md },
  modalCancel:      { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center' },
  modalCancelText:  { fontSize: 13, fontWeight: '600', color: c.textMuted },
  modalConfirm:     { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center' },
  modalConfirmText: { fontSize: 13, fontWeight: '700', color: 'white' },
});
