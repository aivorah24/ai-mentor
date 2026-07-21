import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, Alert, Platform, Modal
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import SERVER_URL from '../../config/serverUrl';
import { fetchMyClasses, MyClass } from '../../features/classes/api/classesApi';
import IndependentAccountEmpty from '../../features/classes/components/IndependentAccountEmpty';

interface StudentAttendance {
  id: string;
  name: string;
  email: string;
  photoUrl?: string;
  status: 'present' | 'absent' | 'late' | null;
}

export default function TeacherAttendanceScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const email = user?.email || '';
  // B2C / independent teacher: no school link — attendance is a dead-end, so
  // show the "Connect to My School" bridge instead (see early return below).
  const isB2C = !user?.schoolId;

  const [classes, setClasses] = useState<MyClass[]>([]);
  const [selectedClass, setSelectedClass] = useState<MyClass | null>(null);
  const [showClassDropdown, setShowClassDropdown] = useState(false);

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]); // YYYY-MM-DD
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());

  const [students, setStudents] = useState<StudentAttendance[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [previousStatuses, setPreviousStatuses] = useState<Record<string, 'present' | 'absent' | 'late' | null> | null>(null);

  // 1. Fetch Teacher's Classes
  useEffect(() => {
    if (!email || isB2C) return;
    fetchMyClasses(email)
      .then(res => {
        setClasses(res);
        if (res.length > 0) {
          setSelectedClass(res[0]);
        }
      })
      .catch(err => {
        console.error('Failed to load classes', err);
      });
  }, [email]);

  // 2. Fetch Students and Attendance Status for the selected class & date
  const loadAttendance = useCallback(async () => {
    if (!selectedClass || !date) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${SERVER_URL}/attendance/class?grade=${encodeURIComponent(
          selectedClass.grade
        )}&section=${encodeURIComponent(selectedClass.section)}&date=${date}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to fetch attendance');
      setStudents(data.students || []);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not load attendance');
    } finally {
      setLoading(false);
    }
  }, [selectedClass, date]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  // 3. Mark Single Student Attendance Status locally
  const markStatus = (studentId: string, status: 'present' | 'absent' | 'late') => {
    setStudents(prev =>
      prev.map(s => (s.id === studentId ? { ...s, status: s.status === status ? null : status } : s))
    );
  };

  // 4. Mark All Students as Present (with toggle revert support)
  const markAllPresent = () => {
    const allAlreadyPresent = students.length > 0 && students.every(s => s.status === 'present');
    if (allAlreadyPresent) {
      // Revert to previous custom status state
      setStudents(prev =>
        prev.map(s => ({
          ...s,
          status: previousStatuses && previousStatuses[s.id] !== undefined ? previousStatuses[s.id] : null
        }))
      );
      setPreviousStatuses(null);
    } else {
      // Save current status mapping
      const currentMap: Record<string, 'present' | 'absent' | 'late' | null> = {};
      students.forEach(s => {
        currentMap[s.id] = s.status;
      });
      setPreviousStatuses(currentMap);
      // Mark all as present
      setStudents(prev => prev.map(s => ({ ...s, status: 'present' })));
    }
  };

  // 5. Save Attendance to Backend
  const saveAttendance = async () => {
    if (!selectedClass || !date) return;
    setSaving(true);
    try {
      const recordsMap: Record<string, 'present' | 'absent' | 'late' | null> = {};
      students.forEach(s => {
        if (s.status) recordsMap[s.id] = s.status;
      });

      const res = await fetch(`${SERVER_URL}/attendance/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          records: recordsMap,
          teacherEmail: email
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save');

      Alert.alert('Success', 'Attendance saved successfully!');
      loadAttendance();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not save attendance');
    } finally {
      setSaving(false);
    }
  };

  // 6. Custom Calendar Days Memo
  const calendarDays = useMemo(() => {
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const startDayOfWeek = new Date(calendarYear, calendarMonth, 1).getDay();
    const days: { dayNum: number | null; dateString: string | null }[] = [];
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ dayNum: null, dateString: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const monthStr = String(calendarMonth + 1).padStart(2, '0');
      const dayStr = String(d).padStart(2, '0');
      const dateString = `${calendarYear}-${monthStr}-${dayStr}`;
      days.push({ dayNum: d, dateString });
    }
    return days;
  }, [calendarYear, calendarMonth]);

  const monthsList = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const weekDaysList = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const changeMonth = (offset: number) => {
    let newMonth = calendarMonth + offset;
    let newYear = calendarYear;
    if (newMonth < 0) {
      newMonth = 11;
      newYear -= 1;
    } else if (newMonth > 11) {
      newMonth = 0;
      newYear += 1;
    }
    setCalendarMonth(newMonth);
    setCalendarYear(newYear);
  };

  // Helper date text format
  const formattedDateText = useMemo(() => {
    if (!date) return '';
    const parts = date.split('-');
    if (parts.length !== 3) return date;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = months[parseInt(parts[1], 10) - 1];
    return `${parts[2]} ${monthName} ${parts[0]}`;
  }, [date]);

  // Statistics Summary
  const stats = useMemo(() => {
    let present = 0;
    let absent = 0;
    let late = 0;
    let unmarked = 0;
    students.forEach(s => {
      if (s.status === 'present') present++;
      else if (s.status === 'absent') absent++;
      else if (s.status === 'late') late++;
      else unmarked++;
    });
    return { present, absent, late, unmarked, total: students.length };
  }, [students]);

  // Filtered Students
  const filteredStudents = useMemo(() => {
    return students.filter(s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [students, searchQuery]);

  if (isB2C) {
    return (
      <ScreenLayout>
        <Header
          title="Attendance"
          subtitle="Mark daily student attendance records"
          onMenuPress={() => navigation?.openDrawer()}
        />
        <IndependentAccountEmpty feature="attendance" />
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <Header
        title="Attendance"
        subtitle="Mark daily student attendance records"
        onMenuPress={() => navigation?.openDrawer()}
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Selector Row */}
        <View style={styles.selectorRow}>
          {/* Class Selector */}
          <View style={{ flex: 1, position: 'relative', zIndex: 99 }}>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() => setShowClassDropdown(!showClassDropdown)}
              activeOpacity={0.8}
            >
              <Feather name="book-open" size={16} color={colors.accentYellow} style={{ marginRight: 8 }} />
              <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                {selectedClass ? `${selectedClass.label} (${selectedClass.grade}-${selectedClass.section})` : 'Select Class'}
              </Text>
              <Feather name="chevron-down" size={16} color={colors.textDim} />
            </TouchableOpacity>

            {showClassDropdown && (
              <View style={styles.dropdownMenu}>
                {classes.map((cls, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.dropdownOption}
                    onPress={() => {
                      setSelectedClass(cls);
                      setShowClassDropdown(false);
                    }}
                  >
                    <Text style={styles.dropdownOptionText}>
                      {cls.label} ({cls.grade}-{cls.section})
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Date Selector */}
          <TouchableOpacity
            style={styles.dateSelector}
            onPress={() => {
              setShowCalendarModal(true);
              const d = new Date(date);
              if (!isNaN(d.getTime())) {
                setCalendarYear(d.getFullYear());
                setCalendarMonth(d.getMonth());
              }
            }}
            activeOpacity={0.8}
          >
            <Feather name="calendar" size={16} color={colors.accentYellow} style={{ marginRight: 8 }} />
            <Text style={styles.dateSelectorText}>{formattedDateText}</Text>
            <Feather name="edit-2" size={12} color={colors.textDim} />
          </TouchableOpacity>
        </View>

        {/* Attendance Stats Cards */}
        <View style={styles.statsContainer}>
          {/* Present */}
          <View style={[styles.statCard, { borderLeftColor: '#0ca678', backgroundColor: '#e6fcf5', borderColor: '#c3fae8' }]}>
            <View style={styles.statCardHeaderRow}>
              <Text style={[styles.statValue, { color: '#0ca678' }]}>{stats.present}</Text>
              <View style={[styles.statIconBadge, { backgroundColor: '#c3fae8' }]}>
                <Feather name="check" size={12} color="#0ca678" />
              </View>
            </View>
            <Text style={[styles.statLabel, { color: '#0ca678' }]}>Present</Text>
          </View>

          {/* Absent */}
          <View style={[styles.statCard, { borderLeftColor: '#f03e3e', backgroundColor: '#fff5f5', borderColor: '#ffe3e3' }]}>
            <View style={styles.statCardHeaderRow}>
              <Text style={[styles.statValue, { color: '#f03e3e' }]}>{stats.absent}</Text>
              <View style={[styles.statIconBadge, { backgroundColor: '#ffe3e3' }]}>
                <Feather name="x" size={12} color="#f03e3e" />
              </View>
            </View>
            <Text style={[styles.statLabel, { color: '#f03e3e' }]}>Absent</Text>
          </View>

          {/* Late */}
          <View style={[styles.statCard, { borderLeftColor: '#ba905a', backgroundColor: '#ba905a12', borderColor: '#ba905a25' }]}>
            <View style={styles.statCardHeaderRow}>
              <Text style={[styles.statValue, { color: '#ba905a' }]}>{stats.late}</Text>
              <View style={[styles.statIconBadge, { backgroundColor: '#ba905a25' }]}>
                <Feather name="clock" size={12} color="#ba905a" />
              </View>
            </View>
            <Text style={[styles.statLabel, { color: '#ba905a' }]}>Late</Text>
          </View>

          {/* Unmarked */}
          <View style={[styles.statCard, { borderLeftColor: '#495057', backgroundColor: '#f8f9fa', borderColor: '#e9ecef' }]}>
            <View style={styles.statCardHeaderRow}>
              <Text style={[styles.statValue, { color: '#495057' }]}>{stats.unmarked}</Text>
              <View style={[styles.statIconBadge, { backgroundColor: '#e9ecef' }]}>
                <Feather name="help-circle" size={12} color="#495057" />
              </View>
            </View>
            <Text style={[styles.statLabel, { color: '#495057' }]}>Unmarked</Text>
          </View>
        </View>

        {/* Quick actions & Search */}
        <View style={styles.actionsBar}>
          <View style={styles.searchContainer}>
            <Feather name="search" size={16} color={colors.textDim} style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search student..."
              placeholderTextColor={colors.textDim}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          <TouchableOpacity style={styles.markAllBtn} onPress={markAllPresent} activeOpacity={0.8}>
            <Feather name="check-square" size={14} color="#241f16" style={{ marginRight: 4 }} />
            <Text style={styles.markAllBtnText}>Mark All Present</Text>
          </TouchableOpacity>
        </View>

        {/* Student Roster List */}
        {loading ? (
          <ActivityIndicator size="large" color={colors.accentYellow} style={{ marginTop: 40 }} />
        ) : filteredStudents.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Feather name="users" size={32} color={colors.textDim} style={{ marginBottom: 10 }} />
            <Text style={styles.emptyText}>No students found in this class.</Text>
          </View>
        ) : (
          <View style={styles.studentsListCard}>
            {filteredStudents.map((student, index) => {
              const studentInitials = student.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
              return (
                <View
                  key={student.id}
                  style={[
                    styles.studentRow,
                    index < filteredStudents.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.borderColor }
                  ]}
                >
                  {/* Left: Avatar & Name */}
                  <View style={styles.studentInfoCol}>
                    <View style={styles.studentAvatar}>
                      <Text style={styles.studentAvatarText}>{studentInitials}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.studentNameText}>{student.name}</Text>
                      <Text style={styles.studentEmailText}>{student.email}</Text>
                    </View>
                  </View>

                  {/* Right: Action Buttons */}
                  <View style={styles.attendanceButtonsCol}>
                    {/* Present */}
                    <TouchableOpacity
                      style={[
                        styles.attendanceButton,
                        student.status === 'present' && { backgroundColor: '#10b98122', borderColor: '#10b981' }
                      ]}
                      onPress={() => markStatus(student.id, 'present')}
                      activeOpacity={0.7}
                    >
                      <Feather name="check" size={13} color={student.status === 'present' ? '#10b981' : colors.textDim} style={{ marginRight: 2 }} />
                      <Text style={[styles.attendanceBtnLabel, student.status === 'present' && { color: '#10b981', fontWeight: '700' }]}>
                        Present
                      </Text>
                    </TouchableOpacity>

                    {/* Absent */}
                    <TouchableOpacity
                      style={[
                        styles.attendanceButton,
                        student.status === 'absent' && { backgroundColor: `${colors.accentRed}22`, borderColor: colors.accentRed }
                      ]}
                      onPress={() => markStatus(student.id, 'absent')}
                      activeOpacity={0.7}
                    >
                      <Feather name="x" size={13} color={student.status === 'absent' ? colors.accentRed : colors.textDim} style={{ marginRight: 2 }} />
                      <Text style={[styles.attendanceBtnLabel, student.status === 'absent' && { color: colors.accentRed, fontWeight: '700' }]}>
                        Absent
                      </Text>
                    </TouchableOpacity>

                    {/* Late */}
                    <TouchableOpacity
                      style={[
                        styles.attendanceButton,
                        student.status === 'late' && { backgroundColor: '#ba905a18', borderColor: '#ba905a' }
                      ]}
                      onPress={() => markStatus(student.id, 'late')}
                      activeOpacity={0.7}
                    >
                      <Feather name="clock" size={13} color={student.status === 'late' ? '#ba905a' : colors.textDim} style={{ marginRight: 2 }} />
                      <Text style={[styles.attendanceBtnLabel, student.status === 'late' && { color: '#ba905a', fontWeight: '700' }]}>
                        Late
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Bottom Save bar */}
        {!loading && students.length > 0 && (
          <TouchableOpacity
            style={styles.saveFAB}
            onPress={saveAttendance}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#241f16" />
            ) : (
              <>
                <Feather name="save" size={16} color="#241f16" style={{ marginRight: 6 }} />
                <Text style={styles.saveFABText}>Save Daily Attendance</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Aivorah themed Custom Calendar Modal */}
      {showCalendarModal && (
        <Modal transparent animationType="fade" visible={showCalendarModal} onRequestClose={() => setShowCalendarModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.calendarModalCard}>
              <View style={styles.calendarModalHeader}>
                <Text style={styles.calendarModalTitle}>Select Date</Text>
                <TouchableOpacity onPress={() => setShowCalendarModal(false)} accessibilityRole="button">
                  <Feather name="x" size={18} color={colors.textHeading} />
                </TouchableOpacity>
              </View>

              <View style={styles.calendarModalBody}>
                <View style={styles.calendarContainer}>
                  {/* Month Nav */}
                  <View style={styles.calendarHeader}>
                    <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.calendarHeaderNavBtn}>
                      <Feather name="chevron-left" size={16} color={colors.textMain} />
                    </TouchableOpacity>
                    <Text style={styles.calendarHeaderTitle}>
                      {monthsList[calendarMonth]} {calendarYear}
                    </Text>
                    <TouchableOpacity onPress={() => changeMonth(1)} style={styles.calendarHeaderNavBtn}>
                      <Feather name="chevron-right" size={16} color={colors.textMain} />
                    </TouchableOpacity>
                  </View>

                  {/* Weekdays */}
                  <View style={styles.calendarWeekdaysRow}>
                    {weekDaysList.map((wd) => (
                      <Text key={wd} style={styles.calendarWeekdayText}>
                        {wd}
                      </Text>
                    ))}
                  </View>

                  {/* Days grid */}
                  <View style={styles.calendarGrid}>
                    {calendarDays.map((item, idx) => {
                      const isSelected = item.dateString !== null && item.dateString === date;
                      const isToday = item.dateString !== null && item.dateString === new Date().toISOString().split('T')[0];

                      return (
                        <TouchableOpacity
                          key={idx}
                          disabled={item.dayNum === null}
                          style={[
                            styles.calendarDayCell,
                            isSelected && styles.calendarDayCellSelected,
                          ]}
                          onPress={() => {
                            if (item.dateString) {
                              setDate(item.dateString);
                              setShowCalendarModal(false);
                            }
                          }}
                        >
                          {item.dayNum !== null ? (
                            <Text
                              style={[
                                styles.calendarDayText,
                                isSelected && styles.calendarDayTextSelected,
                                isToday && !isSelected && { color: colors.accentYellow, fontWeight: '700' },
                              ]}
                            >
                              {item.dayNum}
                            </Text>
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </ScreenLayout>
  );
}

function formatDateDisplay(dateStr: string) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}-${parts[1]}-${parts[0]}`; // DD-MM-YYYY
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    scroll: { flex: 1 },
    content: { padding: spacing.xl, paddingBottom: 80, maxWidth: 1200, width: '100%', alignSelf: 'center', gap: 16 },
    selectorRow: { flexDirection: 'row', gap: 12, alignItems: 'center', zIndex: 99 },
    dropdownTrigger: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardDark,
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm,
      paddingHorizontal: 12, height: 40, justifyContent: 'space-between'
    },
    dropdownTriggerText: { flex: 1, fontSize: 13.5, fontFamily: fonts.serif, color: colors.textMain },
    dropdownMenu: {
      position: 'absolute', top: 44, left: 0, right: 0, backgroundColor: colors.cardDark,
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm,
      padding: 4, zIndex: 100, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8
    },
    dropdownOption: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.xs },
    dropdownOptionText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textHeading },
    dateSelector: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardDark,
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm,
      paddingHorizontal: 12, height: 40, alignSelf: 'flex-start'
    },
    dateSelectorText: { fontSize: 13.5, fontFamily: fonts.serif, color: colors.textMain, marginRight: 8 },
    statsContainer: { flexDirection: 'row', gap: 10 },
    statCard: {
      flex: 1, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderLeftWidth: 4, borderRadius: 10, padding: 12, gap: 4,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1
    },
    statCardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
    statIconBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    statValue: { fontSize: 22, fontWeight: '800', fontFamily: Platform.OS === 'web' ? 'Fraunces, Georgia, serif' : 'system' },
    statLabel: { fontSize: 11, color: colors.textMuted, fontFamily: Platform.OS === 'web' ? 'Fraunces, Georgia, serif' : 'system', fontWeight: '600', marginTop: 2 },
    actionsBar: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    searchContainer: {
      flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardDark,
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, height: 38, paddingHorizontal: 10
    },
    searchInput: { flex: 1, fontSize: 13, fontFamily: fonts.serif, color: colors.textMain, padding: 0, backgroundColor: 'transparent' } as any,
    markAllBtn: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: colors.accentYellow,
      paddingHorizontal: 12, height: 38, borderRadius: radius.sm
    },
    markAllBtnText: { fontSize: 11.5, fontFamily: fonts.serif, fontWeight: '700', color: '#241f16' },
    emptyContainer: { alignItems: 'center', paddingVertical: 48 },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted },
    studentsListCard: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, overflow: 'hidden' },
    studentRow: { flexDirection: 'row', padding: 14, alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    studentInfoCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    studentAvatar: { width: 36, height: 36, borderRadius: 8, backgroundColor: `${colors.accentYellow}22`, alignItems: 'center', justifyContent: 'center' },
    studentAvatarText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '800', color: colors.accentYellow },
    studentNameText: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: colors.textHeading },
    studentEmailText: { fontFamily: fonts.serif, fontSize: 11, color: colors.textDim },
    attendanceButtonsCol: { flexDirection: 'row', gap: 6 },
    attendanceButton: {
      flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.borderColor,
      paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.sm, minWidth: 46, justifyContent: 'center'
    },
    attendanceBtnLabel: { fontSize: 11, fontFamily: fonts.serif, color: colors.textMuted },
    saveFAB: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentYellow,
      paddingVertical: 12, borderRadius: radius.md, width: '100%', marginTop: 8
    },
    saveFABText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700', color: '#241f16' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 16 },
    calendarModalCard: { width: '100%', maxWidth: 360, backgroundColor: colors.bgDark, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderColor, overflow: 'hidden' },
    calendarModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.borderColor },
    calendarModalTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: colors.textHeading },
    calendarModalBody: { padding: 16 },
    calendarContainer: { padding: 12, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, width: '100%' },
    calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    calendarHeaderNavBtn: { padding: 6, borderRadius: 4 },
    calendarHeaderTitle: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: colors.textHeading },
    calendarWeekdaysRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    calendarWeekdayText: { width: 32, textAlign: 'center', fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.textDim },
    calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    calendarDayCell: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginVertical: 2, borderRadius: 16 },
    calendarDayCellSelected: { backgroundColor: colors.accentYellow },
    calendarDayText: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMain },
    calendarDayTextSelected: { color: '#241f16', fontWeight: '700' },
  });
}
