import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface Child {
  id: string;
  name: string;
  grade: string;
  section?: string;
}

export default function ParentAttendanceScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChild, setSelectedChild] = useState<Child | null>(null);
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [attendanceData, setAttendanceData] = useState<any>(null);
  const [loadingAttendance, setLoadingAttendance] = useState(false);

  // States for the active navigated calendar month and year
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState(new Date().getMonth());
  const [currentCalendarYear, setCurrentCalendarYear] = useState(new Date().getFullYear());

  const parentEmail = user?.email || 'parent@demo.com';

  // 1. Fetch children
  useEffect(() => {
    let active = true;
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (Array.isArray(data) && data.length > 0) {
          setChildren(data);
          const targetId = route.params?.childId;
          const found = targetId ? data.find((c) => c.id === targetId) : null;
          setSelectedChild(found || data[0]);
        }
      })
      .catch((err) => console.error('Error fetching children:', err))
      .finally(() => {
        if (active) setLoadingChildren(false);
      });
    return () => {
      active = false;
    };
  }, [parentEmail, route.params?.childId]);

  // 2. Fetch attendance summary & history for selected child
  useEffect(() => {
    if (!selectedChild?.id) return;
    setLoadingAttendance(true);
    let active = true;
    fetch(`${SERVER_URL}/attendance/student/${selectedChild.id}/summary`)
      .then((r) => r.json())
      .then((data) => {
        if (active && data && data.summary) {
          setAttendanceData(data);
        }
      })
      .catch((err) => console.error('Error fetching student summary:', err))
      .finally(() => {
        if (active) setLoadingAttendance(false);
      });
    return () => {
      active = false;
    };
  }, [selectedChild?.id]);

  // Calculate percentages and validity for categories
  const statsSummary = useMemo(() => {
    if (!attendanceData?.summary) {
      return { presentPct: 0, latePct: 0, absentPct: 0, hasRecords: false, ratePct: 0 };
    }
    const { present, absent, late, total, ratePct } = attendanceData.summary;
    if (total === 0) {
      return { presentPct: 0, latePct: 0, absentPct: 0, hasRecords: false, ratePct: 0 };
    }
    return {
      presentPct: Math.round((present / total) * 100),
      latePct: Math.round((late / total) * 100),
      absentPct: Math.round((absent / total) * 100),
      hasRecords: true,
      ratePct: ratePct
    };
  }, [attendanceData]);

  // Map history to quick lookup date string map
  const historyMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (attendanceData?.history) {
      attendanceData.history.forEach((h: any) => {
        map[h.date] = h.status;
      });
    }
    return map;
  }, [attendanceData]);

  // Filter logs for the active calendar month
  const monthlyLogs = useMemo(() => {
    if (!attendanceData?.history) return [];
    return attendanceData.history
      .filter((h: any) => {
        const parts = h.date.split('-');
        if (parts.length !== 3) return false;
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1; // 0-indexed
        return y === currentCalendarYear && m === currentCalendarMonth;
      })
      .sort((a: any, b: any) => b.date.localeCompare(a.date)); // newest first
  }, [attendanceData, currentCalendarMonth, currentCalendarYear]);

  // Month navigation handlers
  const handlePrevMonth = () => {
    if (currentCalendarMonth === 0) {
      setCurrentCalendarMonth(11);
      setCurrentCalendarYear((prev) => prev - 1);
    } else {
      setCurrentCalendarMonth((prev) => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentCalendarMonth === 11) {
      setCurrentCalendarMonth(0);
      setCurrentCalendarYear((prev) => prev + 1);
    } else {
      setCurrentCalendarMonth((prev) => prev + 1);
    }
  };

  // Helper to format date label
  const formatDateLabel = (dateStr: string) => {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    const mIdx = parseInt(parts[1], 10) - 1;
    return `${parts[2]} ${months[mIdx]} ${parts[0]}`;
  };

  // Render calendar grid for a specific month/year
  const renderCalendar = () => {
    const monthsList = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const daysInMonth = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
    const startDayOfWeek = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay();

    const days = [];
    // empty cells before month start
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ dayNum: null, dateString: null });
    }
    // actual days of the month
    for (let d = 1; d <= daysInMonth; d++) {
      const mStr = String(currentCalendarMonth + 1).padStart(2, '0');
      const dStr = String(d).padStart(2, '0');
      days.push({ dayNum: d, dateString: `${currentCalendarYear}-${mStr}-${dStr}` });
    }

    return (
      <View style={styles.calendarCard}>
        <View style={styles.calendarHeaderRow}>
          <TouchableOpacity onPress={handlePrevMonth} style={styles.navArrowBtn} activeOpacity={0.7}>
            <Feather name="chevron-left" size={18} color={colors.textMain} />
          </TouchableOpacity>
          <Text style={styles.calendarMonthTitle}>
            {monthsList[currentCalendarMonth]} {currentCalendarYear}
          </Text>
          <TouchableOpacity onPress={handleNextMonth} style={styles.navArrowBtn} activeOpacity={0.7}>
            <Feather name="chevron-right" size={18} color={colors.textMain} />
          </TouchableOpacity>
        </View>

        <View style={styles.calendarWeekdaysRow}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => (
            <Text key={w} style={styles.calendarWeekdayText}>
              {w}
            </Text>
          ))}
        </View>
        <View style={styles.calendarGrid}>
          {days.map((item, idx) => {
            const status = item.dateString ? historyMap[item.dateString] : null;
            let underlineColor = 'transparent';
            if (status === 'present') underlineColor = '#0ca678';
            else if (status === 'absent') underlineColor = '#f03e3e';
            else if (status === 'late') underlineColor = '#ba905a';

            return (
              <View key={idx} style={styles.calendarDayCell}>
                {item.dayNum !== null ? (
                  <>
                    <Text style={[styles.calendarDayText, status && { fontWeight: '700' }]}>
                      {item.dayNum}
                    </Text>
                    <View style={[styles.calendarDayUnderline, { backgroundColor: underlineColor }]} />
                  </>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <ScreenLayout>
      <View style={styles.container}>
        <Header
          title="Attendance Portal"
          subtitle="Track your children's attendance history"
          onMenuPress={() => navigation.openDrawer()}
          onNotificationPress={() => navigation.navigate('ParentMessages')}
        />

        {/* Child Selector Tabs */}
        {!loadingChildren && children.length > 0 && (
          <View style={styles.childTabsContainer}>
            {children.map((ch) => {
              const isSelected = selectedChild?.id === ch.id;
              return (
                <TouchableOpacity
                  key={ch.id}
                  style={[styles.childTab, isSelected && styles.childTabSelected]}
                  onPress={() => setSelectedChild(ch)}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.childAvatar,
                      isSelected ? { backgroundColor: colors.accentYellow } : { backgroundColor: colors.borderColor }
                    ]}
                  >
                    <Text style={[styles.childAvatarText, isSelected && { color: '#0B0B0B' }]}>
                      {ch.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View>
                    <Text style={[styles.childName, isSelected && styles.childTextSelected]}>
                      {ch.name}
                    </Text>
                    <Text style={[styles.childSubText, isSelected && { color: colors.textMuted }]}>
                      {ch.grade} {ch.section ? `· ${ch.section}` : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {loadingChildren || loadingAttendance ? (
          <View style={styles.loadingWrapper}>
            <ActivityIndicator size="large" color={colors.accentYellow} />
          </View>
        ) : selectedChild ? (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.layoutRow, isWide && styles.layoutRowWide]}>
              {/* Left Column: Stats Cards (Light Pastel Theme) */}
              <View style={[styles.leftColumn, isWide && styles.leftColumnWide]}>
                {/* Overall Attendance Card */}
                <View style={styles.overallRateCard}>
                  <View style={[styles.statIconBadge, { backgroundColor: '#ba905a15', width: 40, height: 40, borderRadius: 20 }]}>
                    <Feather name="award" size={18} color="#ba905a" />
                  </View>
                  <View>
                    <Text style={styles.overallRateText}>
                      {statsSummary.hasRecords ? `${statsSummary.ratePct}%` : 'N/A'}
                    </Text>
                    <Text style={styles.overallRateLabel}>
                      {statsSummary.hasRecords ? 'Overall Attendance' : 'No Marked Attendance'}
                    </Text>
                  </View>
                </View>

                {/* Stats Cards grid */}
                <View style={styles.statsCardsGrid}>
                  {/* Present Card */}
                  <View style={[styles.statCard, { borderLeftColor: '#0ca678', backgroundColor: '#e6fcf5', borderColor: '#c3fae8' }]}>
                    <View style={styles.statCardHeaderRow}>
                      <Text style={[styles.statValue, { color: '#0ca678' }]}>
                        {statsSummary.hasRecords ? attendanceData.summary.present : 0}
                      </Text>
                      <View style={[styles.statIconBadge, { backgroundColor: '#c3fae8', width: 22, height: 22, borderRadius: 11 }]}>
                        <Feather name="check" size={12} color="#0ca678" />
                      </View>
                    </View>
                    <Text style={[styles.statLabel, { color: '#0ca678' }]}>Present</Text>
                  </View>

                  {/* Absent Card */}
                  <View style={[styles.statCard, { borderLeftColor: '#f03e3e', backgroundColor: '#fff5f5', borderColor: '#ffe3e3' }]}>
                    <View style={styles.statCardHeaderRow}>
                      <Text style={[styles.statValue, { color: '#f03e3e' }]}>
                        {statsSummary.hasRecords ? attendanceData.summary.absent : 0}
                      </Text>
                      <View style={[styles.statIconBadge, { backgroundColor: '#ffe3e3', width: 22, height: 22, borderRadius: 11 }]}>
                        <Feather name="x" size={12} color="#f03e3e" />
                      </View>
                    </View>
                    <Text style={[styles.statLabel, { color: '#f03e3e' }]}>Absent</Text>
                  </View>

                  {/* Late Card */}
                  <View style={[styles.statCard, { borderLeftColor: '#ba905a', backgroundColor: '#ba905a12', borderColor: '#ba905a25' }]}>
                    <View style={styles.statCardHeaderRow}>
                      <Text style={[styles.statValue, { color: '#ba905a' }]}>
                        {statsSummary.hasRecords ? attendanceData.summary.late : 0}
                      </Text>
                      <View style={[styles.statIconBadge, { backgroundColor: '#ba905a25', width: 22, height: 22, borderRadius: 11 }]}>
                        <Feather name="clock" size={12} color="#ba905a" />
                      </View>
                    </View>
                    <Text style={[styles.statLabel, { color: '#ba905a' }]}>Late</Text>
                  </View>
                </View>

                {!statsSummary.hasRecords && (
                  <View style={styles.noRecordsBanner}>
                    <Feather name="alert-circle" size={14} color={colors.accentYellow} style={{ marginRight: 6 }} />
                    <Text style={styles.noRecordsText}>Attendance is not yet updated by the school.</Text>
                  </View>
                )}
              </View>

              {/* Right Column: Calendar & Activity Logs list */}
              <View style={[styles.rightColumn, isWide && styles.rightColumnWide]}>
                <View style={styles.recordsSection}>
                  <Text style={styles.recordsTitle}>All records</Text>
                  
                  {/* Calendar view for current navigated month */}
                  {renderCalendar()}

                  {/* Activity log details list for active month */}
                  <View style={styles.activityLogsContainer}>
                    <Text style={styles.activityLogsTitle}>Detailed Logs</Text>
                    {monthlyLogs.length > 0 ? (
                      <View style={styles.logList}>
                        {monthlyLogs.map((log: any, idx: number) => {
                          let badgeBg = '#e6fcf5';
                          let badgeText = '#0ca678';
                          let iconName: any = 'check-circle';
                          let commentText = 'Arrived on time for homeroom check-in';
                          let showActionButtons = false;

                          if (log.status === 'absent') {
                            badgeBg = '#fff5f5';
                            badgeText = '#f03e3e';
                            iconName = 'x-circle';
                            commentText = 'No check-in recorded for the school day.';
                            showActionButtons = true;
                          } else if (log.status === 'late') {
                            badgeBg = '#ba905a12';
                            badgeText = '#ba905a';
                            iconName = 'clock';
                            commentText = 'Late arrival recorded. Student checked-in post homeroom.';
                            showActionButtons = true;
                          }

                          return (
                            <View key={idx} style={styles.logItem}>
                              <View style={styles.logItemMain}>
                                <View style={styles.logItemTopRow}>
                                  <View style={styles.logItemLeft}>
                                    <Feather name={iconName} size={15} color={badgeText} />
                                    <Text style={styles.logItemDate}>{formatDateLabel(log.date)}</Text>
                                  </View>
                                  <View style={[styles.statusBadge, { backgroundColor: badgeBg }]}>
                                    <Text style={[styles.statusBadgeText, { color: badgeText }]}>
                                      {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
                                    </Text>
                                  </View>
                                </View>
                                <Text style={styles.logItemTeacher}>Session: Main Homeroom Session · Marked by Class Teacher</Text>
                                <Text style={styles.logItemComment}>{commentText}</Text>
                                
                                {showActionButtons && (
                                  <View style={styles.logActionButtons}>
                                    <TouchableOpacity
                                      style={styles.logActionBtn}
                                      onPress={() => navigation.navigate('ParentMessages')}
                                      activeOpacity={0.8}
                                    >
                                      <Feather name="message-square" size={11} color={colors.accentYellow} style={{ marginRight: 4 }} />
                                      <Text style={styles.logActionBtnText}>Message Teacher</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      style={styles.logActionBtn}
                                      onPress={() => alert('Leave request submission is coming soon!')}
                                      activeOpacity={0.8}
                                    >
                                      <Feather name="file-text" size={11} color={colors.accentYellow} style={{ marginRight: 4 }} />
                                      <Text style={styles.logActionBtnText}>Submit Leave Note</Text>
                                    </TouchableOpacity>
                                  </View>
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ) : (
                      <View style={styles.emptyLogsCard}>
                        <Feather name="info" size={16} color={colors.textMuted} style={{ marginBottom: 4 }} />
                        <Text style={styles.emptyLogsText}>No attendance logs recorded for this month.</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </View>
          </ScrollView>
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No child profile associated with this account.</Text>
          </View>
        )}
      </View>
    </ScreenLayout>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { padding: spacing.xl, paddingBottom: 60 },
    loadingWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 300 },
    childTabsContainer: {
      flexDirection: 'row',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderColor,
      gap: 12,
      flexWrap: 'wrap',
    },
    childTab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.cardDark,
      borderWidth: 1,
      borderColor: colors.borderColor,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.md,
    },
    childTabSelected: {
      borderColor: colors.accentYellow,
      backgroundColor: colors.accentYellow + '08',
    },
    childAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    childAvatarText: {
      fontFamily: fonts.serif,
      fontSize: 12.5,
      fontWeight: '800',
      color: colors.textMain,
    },
    childName: {
      fontFamily: fonts.serif,
      fontSize: 13,
      fontWeight: '700',
      color: colors.textHeading,
    },
    childTextSelected: {
      color: colors.accentYellow,
    },
    childSubText: {
      fontSize: 10.5,
      color: colors.textDim,
    },
    layoutRow: {
      flexDirection: 'column',
      gap: 20,
    },
    layoutRowWide: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    leftColumn: {
      width: '100%',
    },
    leftColumnWide: {
      width: '30%',
    },
    rightColumn: {
      width: '100%',
    },
    rightColumnWide: {
      width: '70%',
    },
    overallRateCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.cardDark,
      borderWidth: 1,
      borderColor: colors.borderColor,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
    },
    overallRateText: {
      fontFamily: fonts.serif,
      fontSize: 22,
      fontWeight: '800',
      color: colors.accentYellow,
    },
    overallRateLabel: {
      fontSize: 11,
      color: colors.textMuted,
      fontWeight: '600',
    },
    statsCardsGrid: {
      gap: 10,
      marginBottom: 12,
    },
    statCard: {
      backgroundColor: colors.cardDark,
      borderWidth: 1,
      borderColor: colors.borderColor,
      borderLeftWidth: 4,
      borderRadius: 10,
      padding: 12,
      gap: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.04,
      shadowRadius: 4,
      elevation: 1,
    },
    statCardHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
    },
    statValue: {
      fontSize: 22,
      fontWeight: '800',
      fontFamily: Platform.OS === 'web' ? 'Fraunces, Georgia, serif' : 'system',
    },
    statLabel: {
      fontSize: 11,
      fontFamily: Platform.OS === 'web' ? 'Fraunces, Georgia, serif' : 'system',
      fontWeight: '600',
      marginTop: 2,
    },
    noRecordsBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.accentYellow + '10',
      borderWidth: 1,
      borderColor: colors.accentYellow + '30',
      borderRadius: 8,
      padding: 10,
      marginTop: 4,
    },
    noRecordsText: {
      fontSize: 11.5,
      color: colors.textMain,
      fontWeight: '500',
      flex: 1,
    },
    recordsSection: {
      backgroundColor: colors.cardDark,
      borderWidth: 1,
      borderColor: colors.borderColor,
      borderRadius: 16,
      padding: 20,
      gap: 20,
    },
    recordsTitle: {
      fontFamily: fonts.serif,
      fontSize: 16,
      fontWeight: '800',
      color: colors.textHeading,
      marginBottom: 4,
    },
    calendarCard: {
      width: '100%',
      backgroundColor: colors.bgDark,
      borderWidth: 1,
      borderColor: colors.borderColor,
      borderRadius: 12,
      padding: 16,
    },
    calendarHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    navArrowBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.cardDark,
      borderWidth: 1,
      borderColor: colors.borderColor,
      alignItems: 'center',
      justifyContent: 'center',
    },
    calendarMonthTitle: {
      fontFamily: fonts.serif,
      fontSize: 15,
      fontWeight: '700',
      color: colors.textHeading,
    },
    calendarWeekdaysRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderColor,
      paddingBottom: 6,
    },
    calendarWeekdayText: {
      width: '14.28%',
      textAlign: 'center',
      fontSize: 11,
      fontWeight: '700',
      color: colors.textDim,
    },
    calendarGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
    },
    calendarDayCell: {
      width: '14.28%',
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: 1,
    },
    calendarDayText: {
      fontSize: 12.5,
      color: colors.textMain,
    },
    calendarDayUnderline: {
      width: 14,
      height: 2.5,
      borderRadius: 1.25,
      marginTop: 4,
    },
    activityLogsContainer: {
      marginTop: 8,
      gap: 12,
    },
    activityLogsTitle: {
      fontFamily: fonts.serif,
      fontSize: 14,
      fontWeight: '700',
      color: colors.textHeading,
    },
    logList: {
      gap: 8,
    },
    logItem: {
      backgroundColor: colors.bgDark,
      borderWidth: 1,
      borderColor: colors.borderColor,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 14,
    },
    logItemMain: {
      gap: 4,
    },
    logItemTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    logItemLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    logItemDate: {
      fontSize: 13,
      color: colors.textMain,
      fontWeight: '700',
    },
    statusBadge: {
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: 6,
    },
    statusBadgeText: {
      fontSize: 10.5,
      fontWeight: '700',
    },
    logItemTeacher: {
      fontSize: 11,
      color: colors.textDim,
      marginTop: 2,
    },
    logItemComment: {
      fontSize: 12,
      color: colors.textMuted,
      lineHeight: 16,
      marginTop: 4,
    },
    logActionButtons: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.borderColor,
      paddingTop: 8,
    },
    logActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.cardDark,
      borderWidth: 1,
      borderColor: colors.borderColor,
      borderRadius: 6,
      paddingVertical: 5,
      paddingHorizontal: 8,
    },
    logActionBtnText: {
      fontSize: 10.5,
      color: colors.textHeading,
      fontWeight: '600',
    },
    emptyLogsCard: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 20,
      backgroundColor: colors.bgDark,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.borderColor,
      borderStyle: 'dashed',
    },
    emptyLogsText: {
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
    },
    statIconBadge: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 40,
    },
    emptyText: {
      fontFamily: fonts.serif,
      fontSize: 14,
      color: colors.textMuted,
      textAlign: 'center',
    },
  });
}
