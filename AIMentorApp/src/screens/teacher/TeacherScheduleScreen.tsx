import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, PanResponder,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';

import SERVER_URL from '../../config/serverUrl';
const TIMES = ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];
const TIME_PICKER_SLOTS: string[] = (() => {
  const s: string[] = [];
  for (let h = 6; h <= 22; h++) for (const m of [0,15,30,45]) { if (h===22&&m>0) break; s.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`); }
  return s;
})();
const DAYS_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DURATIONS = ['30 min', '45 min', '1 hr', '1.5 hrs', '2 hrs', '2.5 hrs', '3 hrs'];
const SLOT_ROW_HEIGHT = 50;
const DURATION_MINS: Record<string, number> = {
  '30 min': 30, '45 min': 45, '1 hr': 60,
  '1.5 hrs': 90, '2 hrs': 120, '2.5 hrs': 150, '3 hrs': 180,
};

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
  const [selectedDate, setSelectedDate] = useState(todayISO);

  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(false);

  // Student list for picker
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [studentSearch, setStudentSearch] = useState('');

  const [modalVisible, setModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newHour, setNewHour] = useState('09');
  const [newMinute, setNewMinute] = useState('00');
  const newTime = `${newHour}:${newMinute}`;
  const [newDuration, setNewDuration] = useState('1 hr');
  const [newType, setNewType] = useState('lesson');
  const [newNote, setNewNote] = useState('');
  const [targetStudents, setTargetStudents] = useState<'all' | 'specific'>('all');
  const [selectedStudent, setSelectedStudent] = useState<StudentItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [dragRange, setDragRange] = useState<{ start: number; end: number } | null>(null);
  const dragRangeRef = useRef<{ start: number; end: number } | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/schedule/teacher?date=${selectedDate}`);
      if (res.ok) setEvents(await res.json());
    } catch {}
    setLoading(false);
  }, [selectedDate]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // Fetch students linked to this teacher
  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(user.email)}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: StudentItem[]) => setStudents(data))
      .catch(() => {});
  }, [user?.email]);

  function openModal(presetTime?: string) {
    if (presetTime) { setNewHour(presetTime.split(':')[0]); setNewMinute(presetTime.split(':')[1] ?? '00'); }
    setSaveError('');
    setModalVisible(true);
  }

  const openModalForRange = useCallback((startIdx: number, endIdx: number) => {
    const start = Math.max(0, Math.min(TIMES.length - 1, Math.min(startIdx, endIdx)));
    const spanHours = Math.max(1, Math.min(3, Math.abs(endIdx - startIdx) + 1));
    const durationLabel = spanHours === 1 ? '1 hr' : spanHours === 2 ? '2 hrs' : '3 hrs';
    setNewHour(TIMES[start].split(':')[0]); setNewMinute('00');
    setNewDuration(durationLabel);
    setSaveError('');
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

  async function createEvent() {
    if (!newTitle.trim()) {
      setSaveError('Please enter an event title.');
      return;
    }
    const assignTo = targetStudents === 'all' ? 'all' : (selectedStudent?.id ?? 'all');
    setSaving(true);
    setSaveError('');
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
          studentId: assignTo,
          createdBy: 'teacher',
        }),
      });
      if (res.ok) {
        setNewTitle('');
        setNewNote('');
        setSelectedStudent(null);
        setStudentSearch('');
        setSaving(false);
        setModalVisible(false);
        fetchEvents(); // re-fetch from server to sync
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

  async function removeEvent(id: string) {
    try {
      await fetch(`${SERVER_URL}/schedule/${id}`, { method: 'DELETE' });
      setEvents(prev => prev.filter(e => e.id !== id));
    } catch {}
  }

  const filteredStudents = useMemo(() =>
    students.filter(s =>
      s.name?.toLowerCase().includes(studentSearch.toLowerCase()) ||
      s.grade?.toLowerCase().includes(studentSearch.toLowerCase())
    ),
    [students, studentSearch]
  );

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        {/* Header row with + New Event button */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Header title="Class Schedule" subtitle="Create sessions and deadlines for students." />
          </View>
          <TouchableOpacity
            style={styles.addEventBtnTop}
            onPress={() => openModal()}
            activeOpacity={0.8}
          >
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

          {/* Day Selector */}
          <View style={styles.daySelectorCard}>
            <TouchableOpacity style={styles.navArrow} onPress={() => { const d = new Date(weekBase); d.setDate(d.getDate() - 7); setWeekBase(d); }}>
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
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.navArrow} onPress={() => { const d = new Date(weekBase); d.setDate(d.getDate() + 7); setWeekBase(d); }}>
              <Feather name="chevron-right" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Timeline */}
          <Text style={styles.dragHint}>Drag on empty timeline slots to quick-book a time range.</Text>
          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.timelineDragArea} {...panResponder.panHandlers}>
            {TIMES.map((t, idx) => {
              const [slotH] = t.split(':').map(Number);
              const event = events.find(e => { const [evH] = e.startTime.split(':').map(Number); return evH === slotH; });
              const rangeStart = dragRange ? Math.min(dragRange.start, dragRange.end) : -1;
              const rangeEnd = dragRange ? Math.max(dragRange.start, dragRange.end) : -1;
              const inDragRange = idx >= rangeStart && idx <= rangeEnd;
              return (
                <View key={t} style={styles.timeRow}>
                  <Text style={styles.timeLabel}>{t}</Text>
                  <View style={styles.timeSlot}>
                    {event ? (
                      <View style={[styles.eventBlock, { borderLeftColor: typeColor(event.type, colors) }]}>
                        <View style={styles.eventTopRow}>
                          <Text style={styles.eventTitle}>{event.title}</Text>
                          <View style={styles.eventTags}>
                            <View style={[styles.tag, { backgroundColor: typeColor(event.type, colors) + '20', borderColor: typeColor(event.type, colors) + '40' }]}>
                              <Text style={[styles.tagText, { color: typeColor(event.type, colors) }]}>{event.type}</Text>
                            </View>
                            <View style={[styles.tag, { backgroundColor: colors.accentGreen + '20', borderColor: colors.accentGreen + '40' }]}>
                              <Text style={[styles.tagText, { color: colors.accentGreen }]}>
                                {event.studentId === 'all'
                                  ? 'All students'
                                  : (students.find(s => s.id === event.studentId)?.name ?? event.studentId.slice(0, 8) + '…')}
                              </Text>
                            </View>
                            <TouchableOpacity onPress={() => removeEvent(event.id)} style={styles.deleteBtn}>
                              <Feather name="x" size={12} color={colors.textDim} />
                            </TouchableOpacity>
                          </View>
                        </View>
                        <Text style={styles.eventTime}>{event.startTime}{event.endTime ? ` – ${event.endTime}` : ''}</Text>
                        {event.note ? <Text style={styles.eventNote}>{event.note}</Text> : null}
                      </View>
                    ) : (
                      // Tappable empty slot — opens modal with this time pre-filled
                      <TouchableOpacity
                        style={[styles.emptySlot, inDragRange && styles.draggingSlot]}
                        activeOpacity={0.4}
                        onPress={() => openModal(t)}
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
        </ScrollView>

        {/* Create Event Modal */}
        <Modal visible={modalVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modal}>
              <Text style={styles.modalTitle}>Create Event — {selectedDate}</Text>
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
                    <Text style={[styles.timeChipText, newType === t && { color: typeColor(t, colors) }]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={styles.modalLabel}>Start time: <Text style={{ color: colors.primary, fontWeight: '800' }}>{newTime}</Text></Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
                {Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0')).map(h => (
                  <TouchableOpacity key={h} style={[styles.timeChip, newHour === h && styles.timeChipActive]} onPress={() => setNewHour(h)}>
                    <Text style={[styles.timeChipText, newHour === h && { color: colors.primary }]}>{h}:00</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
                {['00', '15', '30', '45'].map(m => (
                  <TouchableOpacity key={m} style={[styles.timeChip, newMinute === m && styles.timeChipActive]} onPress={() => setNewMinute(m)}>
                    <Text style={[styles.timeChipText, newMinute === m && { color: colors.primary }]}>:{m}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={styles.modalLabel}>Duration:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
                {DURATIONS.map(d => (
                  <TouchableOpacity key={d} style={[styles.timeChip, newDuration === d && styles.timeChipActive]} onPress={() => setNewDuration(d)}>
                    <Text style={[styles.timeChipText, newDuration === d && { color: colors.primary }]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

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

              {/* Student picker — shown when "Specific student" selected */}
              {targetStudents === 'specific' && (
                <View style={styles.studentPickerBox}>
                  {selectedStudent ? (
                    // Chosen student chip — tap to deselect
                    <TouchableOpacity
                      style={styles.selectedStudentChip}
                      onPress={() => setSelectedStudent(null)}
                      activeOpacity={0.7}
                    >
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
            </View>
          </View>
        </Modal>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:          { flex: 1, backgroundColor: c.bgDark },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.xl,
  },
  addEventBtnTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    borderRadius: radius.lg,
  },
  addEventBtnTopText: { fontSize: 13, fontWeight: '700', color: 'white' },
  scroll:          { flex: 1 },
  content:         { padding: spacing.xl, paddingBottom: 40 },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.accentCyan + '12',
    borderWidth: 1,
    borderColor: c.accentCyan + '30',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  infoText:        { fontSize: 12, color: c.accentCyan, flex: 1 },
  daySelectorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  navArrow:        { padding: spacing.sm },
  dayItem:         { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radius.lg, marginHorizontal: 2, gap: 4 },
  dayItemActive:   { backgroundColor: c.accentGreen },
  dayLabel:        { fontSize: 10, fontWeight: '700', color: c.textMuted, letterSpacing: 0.5 },
  dayLabelActive:  { color: 'white' },
  dateNum:         { fontSize: 18, fontWeight: '700', color: c.textMuted },
  dateNumActive:   { color: 'white' },
  timelineDragArea: { width: '100%' },
  dragHint: { fontSize: 11, color: c.textDim, marginBottom: spacing.sm, marginLeft: spacing.sm },
  timeRow:         { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2 },
  timeLabel:       { width: 44, fontSize: 11, color: c.textDim, paddingTop: spacing.md, fontWeight: '600' },
  timeSlot:        { flex: 1, minHeight: 48 },
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
  eventBlock:      { backgroundColor: c.cardDark, borderLeftWidth: 3, borderTopRightRadius: radius.sm, borderBottomRightRadius: radius.sm, padding: spacing.md, marginLeft: spacing.sm, marginBottom: 2 },
  eventTopRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  eventTitle:      { fontSize: 13, fontWeight: '600', color: c.textMain, flex: 1 },
  eventTags:       { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tag:             { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  tagText:         { fontSize: 10, fontWeight: '600' },
  deleteBtn:       { padding: 2 },
  eventTime:       { fontSize: 11, color: c.textMuted },
  eventNote:       { fontSize: 11, color: c.textMuted, marginTop: 3 },
  modalOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  modal:           { width: '85%', maxHeight: '88%', backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xxl, gap: spacing.lg },
  modalTitle:      { fontSize: 17, fontWeight: '700', color: c.textMain },
  modalInput:      { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, padding: spacing.md, color: c.textMain, fontSize: 14 },
  modalLabel:      { fontSize: 12, color: c.textMuted, fontWeight: '600' },
  chipRow:         { height: 40 },
  chipRowContent:  { flexDirection: 'row', alignItems: 'center', paddingBottom: 2 },
  timeChip:        { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor, marginRight: 6 },
  timeChipActive:  { borderColor: c.primary, backgroundColor: c.primaryGlow },
  timeChipText:    { fontSize: 12, color: c.textMuted },
  // Student picker
  studentPickerBox: {
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  studentSearch: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderBottomWidth: 1,
    borderBottomColor: c.borderColor,
    padding: spacing.md,
    color: c.textMain,
    fontSize: 13,
  },
  studentList:      { maxHeight: 160 },
  noStudentsText:   { fontSize: 12, color: c.textDim, textAlign: 'center', padding: spacing.lg },
  studentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.borderColor + '60',
  },
  studentAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: c.primary + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  studentAvatarText:  { fontSize: 13, fontWeight: '700', color: c.primary },
  studentRowName:     { fontSize: 13, fontWeight: '600', color: c.textMain },
  studentRowGrade:    { fontSize: 11, color: c.textDim },
  selectedStudentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: spacing.md,
    backgroundColor: c.primary + '14',
  },
  selectedStudentName:  { fontSize: 13, fontWeight: '600', color: c.textMain, flex: 1 },
  selectedStudentGrade: { fontSize: 11, color: c.textDim },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.accentRed + '14',
    borderWidth: 1, borderColor: c.accentRed + '40',
    borderRadius: radius.sm, padding: spacing.md,
  },
  errorText: { fontSize: 12, color: c.accentRed, flex: 1 },
  modalBtns:       { flexDirection: 'row', gap: spacing.md },
  modalCancel:     { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center' },
  modalCancelText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  modalConfirm:    { flex: 1, paddingVertical: 12, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center' },
  modalConfirmText: { fontSize: 13, fontWeight: '700', color: 'white' },
});
