import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Circle } from 'react-native-svg';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, ActivityIndicator, Alert, Modal, FlatList, Animated,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

interface Child {
  id: string;
  name: string;
  email: string;
  grade: string;
  studyTimeMinutes: number;
}

interface Controls {
  // Daily
  isEnabled: boolean;
  dailyLimitMinutes: number;
  lockWhenReached: boolean;
  todayUsageMinutes: number;
  weeklyUsageMinutes: number;
  // Weekly
  weeklyCapEnabled: boolean;
  weeklyCapMinutes: number;
  // Allowed hours
  allowedHoursEnabled: boolean;
  allowedHoursStart: number;
  allowedHoursEnd: number;
  // Break
  breakEnforcerEnabled: boolean;
  breakIntervalMinutes: number;
  breakDurationMinutes: number;
  // Homework first
  homeworkFirstEnabled: boolean;
  // Subject filter
  subjectFilterEnabled: boolean;
  blockedSubjects: string[];
}

const TIME_OPTIONS = Array.from({ length: 16 }, (_, i) => (i + 1) * 15);
const WEEKLY_OPTIONS = [120, 150, 180, 210, 240, 270, 300, 360, 420, 480, 600];
const BREAK_INTERVALS = [20, 25, 30, 40, 45, 60];
const BREAK_DURATIONS = [3, 5, 10];
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
const SUBJECTS = ['Mathematics', 'English', 'Science', 'Social Studies', 'Arts', 'Physical Education'];

const DEFAULT_LIMITS: Record<string, number> = {
  'Grade 1': 30, 'Grade 2': 30, 'Grade 3': 45, 'Grade 4': 45,
  'Grade 5': 60, 'Grade 6': 60, 'Grade 7': 90, 'Grade 8': 90,
  'Grade 9': 120, 'Grade 10': 120, 'Grade 11': 120, 'Grade 12': 120,
};

function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r > 0 ? `${h}h ${r}m` : `${h}h`;
}

function formatHour(h: number): string {
  if (h === 0) return '12:00 AM';
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${h - 12}:00 PM`;
}

type PickerMode = 'daily' | 'weekly' | 'breakInterval' | 'breakDuration' | 'startHour' | 'endHour' | null;

export default function ParentControlsScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const s = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChild, setSelectedChild] = useState<Child | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const showToast = useCallback(() => {
    toastOpacity.setValue(1);
    Animated.sequence([
      Animated.delay(1800),
      Animated.timing(toastOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [toastOpacity]);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);

  // Controls state
  const [ctrl, setCtrl] = useState<Controls>({
    isEnabled: false, dailyLimitMinutes: 60, lockWhenReached: false, todayUsageMinutes: 0, weeklyUsageMinutes: 0,
    weeklyCapEnabled: false, weeklyCapMinutes: 300,
    allowedHoursEnabled: false, allowedHoursStart: 14, allowedHoursEnd: 21,
    breakEnforcerEnabled: false, breakIntervalMinutes: 25, breakDurationMinutes: 5,
    homeworkFirstEnabled: false,
    subjectFilterEnabled: false, blockedSubjects: [],
  });

  const set = (fields: Partial<Controls>) => setCtrl(prev => ({ ...prev, ...fields }));

  const parentEmail = user?.email || '';

  useEffect(() => {
    if (!parentEmail) return;
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
      .then(r => r.json())
      .then(data => {
        const kids = Array.isArray(data) ? data : [];
        setChildren(kids);
        if (kids.length > 0) setSelectedChild(kids[0]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [parentEmail]);

  const fetchControls = useCallback((isInitial = false) => {
    if (!selectedChild || !parentEmail) return;
    if (isInitial) setLoading(true);
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children/${selectedChild.id}/screen-time`)
      .then(r => r.json())
      .then(data => {
        if (isInitial) {
          setCtrl({
            isEnabled: data.isEnabled ?? false,
            dailyLimitMinutes: data.dailyLimitMinutes ?? DEFAULT_LIMITS[selectedChild.grade] ?? 60,
            lockWhenReached: data.lockWhenReached ?? false,
            todayUsageMinutes: data.todayUsageMinutes ?? 0,
            weeklyUsageMinutes: data.weeklyUsageMinutes ?? 0,
            weeklyCapEnabled: data.weeklyCapEnabled ?? false,
            weeklyCapMinutes: data.weeklyCapMinutes ?? 300,
            allowedHoursEnabled: data.allowedHoursEnabled ?? false,
            allowedHoursStart: data.allowedHoursStart ?? 14,
            allowedHoursEnd: data.allowedHoursEnd ?? 21,
            breakEnforcerEnabled: data.breakEnforcerEnabled ?? false,
            breakIntervalMinutes: data.breakIntervalMinutes ?? 25,
            breakDurationMinutes: data.breakDurationMinutes ?? 5,
            homeworkFirstEnabled: data.homeworkFirstEnabled ?? false,
            subjectFilterEnabled: data.subjectFilterEnabled ?? false,
            blockedSubjects: data.blockedSubjects ?? [],
          });
        } else {
          // Only refresh usage — don't overwrite unsaved settings changes
          setCtrl(prev => ({ ...prev, todayUsageMinutes: data.todayUsageMinutes ?? prev.todayUsageMinutes, weeklyUsageMinutes: data.weeklyUsageMinutes ?? prev.weeklyUsageMinutes }));
        }
        if (isInitial) setLoading(false);
      })
      .catch(() => { if (isInitial) setLoading(false); });
  }, [selectedChild, parentEmail]);

  useEffect(() => {
    fetchControls(true);
    const interval = setInterval(() => fetchControls(false), 15 * 1000);
    return () => clearInterval(interval);
  }, [fetchControls]);

  // Refresh usage immediately whenever the screen regains focus.
  useFocusEffect(useCallback(() => { fetchControls(false); }, [fetchControls]));

  const saveSettings = useCallback(async () => {
    if (!selectedChild || !parentEmail) return;
    setSaving(true);
    try {
      const res = await fetch(
        `${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children/${selectedChild.id}/screen-time`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dailyLimitMinutes: ctrl.dailyLimitMinutes,
            enabled: ctrl.isEnabled,
            lockWhenReached: ctrl.lockWhenReached,
            weeklyCapEnabled: ctrl.weeklyCapEnabled,
            weeklyCapMinutes: ctrl.weeklyCapMinutes,
            allowedHoursEnabled: ctrl.allowedHoursEnabled,
            allowedHoursStart: ctrl.allowedHoursStart,
            allowedHoursEnd: ctrl.allowedHoursEnd,
            breakEnforcerEnabled: ctrl.breakEnforcerEnabled,
            breakIntervalMinutes: ctrl.breakIntervalMinutes,
            breakDurationMinutes: ctrl.breakDurationMinutes,
            homeworkFirstEnabled: ctrl.homeworkFirstEnabled,
            subjectFilterEnabled: ctrl.subjectFilterEnabled,
            blockedSubjects: ctrl.blockedSubjects,
          }),
        }
      );
      const data = await res.json();
      if (data.success) {
        showToast();
      } else {
        Alert.alert('Error', data.error || 'Failed to save');
      }
    } catch {
      Alert.alert('Error', 'Could not save settings. Please try again.');
    }
    setSaving(false);
  }, [selectedChild, parentEmail, ctrl]);

  const toggleSubject = (subject: string) => {
    const blocked = ctrl.blockedSubjects.includes(subject)
      ? ctrl.blockedSubjects.filter(s => s !== subject)
      : [...ctrl.blockedSubjects, subject];
    set({ blockedSubjects: blocked });
  };

  const usagePercent = ctrl.isEnabled && ctrl.dailyLimitMinutes
    ? Math.min(100, Math.round((ctrl.todayUsageMinutes / ctrl.dailyLimitMinutes) * 100))
    : 0;

  // Picker data
  const pickerData = useMemo(() => {
    switch (pickerMode) {
      case 'daily': return TIME_OPTIONS;
      case 'weekly': return WEEKLY_OPTIONS;
      case 'breakInterval': return BREAK_INTERVALS;
      case 'breakDuration': return BREAK_DURATIONS;
      case 'startHour': return HOUR_OPTIONS;
      case 'endHour': return HOUR_OPTIONS;
      default: return [];
    }
  }, [pickerMode]);

  const pickerValue = useMemo(() => {
    switch (pickerMode) {
      case 'daily': return ctrl.dailyLimitMinutes;
      case 'weekly': return ctrl.weeklyCapMinutes;
      case 'breakInterval': return ctrl.breakIntervalMinutes;
      case 'breakDuration': return ctrl.breakDurationMinutes;
      case 'startHour': return ctrl.allowedHoursStart;
      case 'endHour': return ctrl.allowedHoursEnd;
      default: return 0;
    }
  }, [pickerMode, ctrl]);

  const pickerTitle = pickerMode === 'daily' ? 'Daily Limit'
    : pickerMode === 'weekly' ? 'Weekly Cap'
    : pickerMode === 'breakInterval' ? 'Break Every'
    : pickerMode === 'breakDuration' ? 'Break Duration'
    : pickerMode === 'startHour' ? 'Start Time'
    : pickerMode === 'endHour' ? 'End Time' : '';

  const handlePickerSelect = (val: number) => {
    switch (pickerMode) {
      case 'daily': set({ dailyLimitMinutes: val }); break;
      case 'weekly': set({ weeklyCapMinutes: val }); break;
      case 'breakInterval': set({ breakIntervalMinutes: val }); break;
      case 'breakDuration': set({ breakDurationMinutes: val }); break;
      case 'startHour': set({ allowedHoursStart: val }); break;
      case 'endHour': set({ allowedHoursEnd: val }); break;
    }
    setPickerMode(null);
  };

  const formatPickerItem = (val: number) =>
    (pickerMode === 'startHour' || pickerMode === 'endHour') ? formatHour(val) : formatMinutes(val);

  if (loading && children.length === 0) {
    return (
      <ScreenLayout>
        <Header title="Parental Controls" subtitle="Manage your child's app usage" />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <Header title="Parental Controls" subtitle="Manage your child's app usage" />
      <ScrollView style={s.screen} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>

        {/* Child selector */}
        {children.length > 1 && (
          <View style={s.childRow}>
            {children.map(c => (
              <TouchableOpacity
                key={c.id}
                style={[s.childChip, selectedChild?.id === c.id && { backgroundColor: colors.primary + '20', borderColor: colors.primary }]}
                onPress={() => setSelectedChild(c)}
                activeOpacity={0.7}
              >
                <View style={[s.avatar, { backgroundColor: selectedChild?.id === c.id ? colors.primary : colors.textDim + '30' }]}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{(c.name || 'S')[0].toUpperCase()}</Text>
                </View>
                <Text style={{ color: selectedChild?.id === c.id ? colors.primary : colors.textMain, fontWeight: '600', fontSize: 13 }}>
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {selectedChild && (
          <>
            {/* ── Usage Overview ── */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>
                USAGE OVERVIEW — {selectedChild.name.toUpperCase()}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {/* Daily card */}
                {(() => {
                  const used = ctrl.todayUsageMinutes;
                  const limit = ctrl.isEnabled ? ctrl.dailyLimitMinutes : 0;
                  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                  const color = pct >= 90 ? '#EFD1D4' : pct >= 70 ? '#C5BD96' : colors.primary;
                  const r = 28; const circ = 2 * Math.PI * r;
                  const dash = circ * (pct / 100);
                  return (
                    <LinearGradient colors={['#93B0AC12', '#C3DCD808']} style={[s.usageHalf, { borderColor: color + '30' }]}>
                      <Text style={{ color: colors.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 }}>TODAY</Text>
                      <View style={{ alignItems: 'center', marginBottom: 10 }}>
                        <Svg width="72" height="72" viewBox="0 0 72 72">
                          <Circle cx="36" cy="36" r={r} fill="none" stroke={color + '22'} strokeWidth="6" />
                          <Circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6"
                            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                            transform="rotate(-90 36 36)" />
                        </Svg>
                        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color, fontWeight: '800', fontSize: 15 }}>{formatMinutes(used)}</Text>
                          <Text style={{ color: colors.textDim, fontSize: 9 }}>used</Text>
                        </View>
                      </View>
                      <Text style={{ color: colors.textMain, fontWeight: '700', fontSize: 13, textAlign: 'center' }}>{pct}%</Text>
                      <Text style={{ color: colors.textDim, fontSize: 11, textAlign: 'center', marginTop: 2 }}>
                        {ctrl.isEnabled ? `of ${formatMinutes(limit)}` : 'no limit'}
                      </Text>
                    </LinearGradient>
                  );
                })()}

                {/* Weekly card — donut ring */}
                {(() => {
                  const used = ctrl.weeklyUsageMinutes;
                  const limit = ctrl.weeklyCapEnabled ? ctrl.weeklyCapMinutes : 0;
                  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                  const color = pct >= 90 ? '#EFD1D4' : '#C5BD96';
                  const r = 28; const circ = 2 * Math.PI * r;
                  const dash = circ * (pct / 100);
                  return (
                    <LinearGradient colors={['#C5BD9612', '#EEE8B408']} style={[s.usageHalf, { borderColor: color + '30' }]}>
                      <Text style={{ color: colors.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 }}>THIS WEEK</Text>
                      <View style={{ alignItems: 'center', marginBottom: 10 }}>
                        <Svg width="72" height="72" viewBox="0 0 72 72">
                          <Circle cx="36" cy="36" r={r} fill="none" stroke={color + '22'} strokeWidth="6" />
                          <Circle cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="6"
                            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
                            transform="rotate(-90 36 36)" />
                        </Svg>
                        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color, fontWeight: '800', fontSize: 13 }}>{formatMinutes(used)}</Text>
                          <Text style={{ color: colors.textDim, fontSize: 9 }}>used</Text>
                        </View>
                      </View>
                      <Text style={{ color: colors.textMain, fontWeight: '700', fontSize: 13, textAlign: 'center' }}>
                        {ctrl.weeklyCapEnabled ? `${pct}%` : formatMinutes(used)}
                      </Text>
                      <Text style={{ color: colors.textDim, fontSize: 11, textAlign: 'center', marginTop: 2 }}>
                        {ctrl.weeklyCapEnabled ? `of ${formatMinutes(ctrl.weeklyCapMinutes)}` : 'this week'}
                      </Text>
                    </LinearGradient>
                  );
                })()}
              </View>
            </View>

            {/* ── Row A: Daily + Weekly ── */}
            <View style={s.cardRow}>
              <SectionCard title="Daily Limit" icon="clock" iconBg="#93B0AC20" iconColor="#93B0AC" colors={colors} s={s} style={s.halfCard} compact>
                <View style={s.row}>
                  <Text style={[s.rowLabel, { color: colors.textMain, fontSize: 13 }]}>Enable</Text>
                  <Switch value={ctrl.isEnabled} onValueChange={v => set({ isEnabled: v })}
                    trackColor={{ false: colors.textDim + '30', true: colors.primary + '50' }}
                    thumbColor={ctrl.isEnabled ? colors.primary : colors.textDim} />
                </View>
                {ctrl.isEnabled && (
                  <>
                    <Text style={[s.fieldLabel, { color: colors.textDim }]}>Limit</Text>
                    <TouchableOpacity style={[s.pickerBtn, { borderColor: colors.primary, backgroundColor: colors.primary + '10' }]}
                      onPress={() => setPickerMode('daily')} activeOpacity={0.7}>
                      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13, flex: 1 }}>{formatMinutes(ctrl.dailyLimitMinutes)}</Text>
                      <Feather name="chevron-down" size={13} color={colors.primary} />
                    </TouchableOpacity>
                    <View style={[s.row, { marginTop: 10 }]}>
                      <Text style={{ color: colors.textDim, fontSize: 12, flex: 1 }}>Lock on limit</Text>
                      <Switch value={ctrl.lockWhenReached} onValueChange={v => set({ lockWhenReached: v })}
                        trackColor={{ false: colors.textDim + '30', true: '#EFD1D450' }}
                        thumbColor={ctrl.lockWhenReached ? '#EFD1D4' : colors.textDim} />
                    </View>
                  </>
                )}
              </SectionCard>

              <SectionCard title="Weekly Cap" icon="calendar" iconBg="#C5BD9620" iconColor="#C5BD96" colors={colors} s={s} style={s.halfCard} compact>
                <View style={s.row}>
                  <Text style={[s.rowLabel, { color: colors.textMain, fontSize: 13 }]}>Enable</Text>
                  <Switch value={ctrl.weeklyCapEnabled} onValueChange={v => set({ weeklyCapEnabled: v })}
                    trackColor={{ false: colors.textDim + '30', true: colors.primary + '50' }}
                    thumbColor={ctrl.weeklyCapEnabled ? colors.primary : colors.textDim} />
                </View>
                {ctrl.weeklyCapEnabled && (
                  <>
                    <Text style={[s.fieldLabel, { color: colors.textDim }]}>Weekly limit</Text>
                    <TouchableOpacity style={[s.pickerBtn, { borderColor: colors.primary, backgroundColor: colors.primary + '10' }]}
                      onPress={() => setPickerMode('weekly')} activeOpacity={0.7}>
                      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13, flex: 1 }}>{formatMinutes(ctrl.weeklyCapMinutes)}</Text>
                      <Feather name="chevron-down" size={13} color={colors.primary} />
                    </TouchableOpacity>
                  </>
                )}
              </SectionCard>
            </View>

            {/* ── Row B: Allowed Hours + Break Enforcer ── */}
            <View style={s.cardRow}>
              <SectionCard title="Allowed Hours" icon="sun" iconBg="#F0C27020" iconColor="#F0C270" colors={colors} s={s} style={s.halfCard} compact>
                <View style={s.row}>
                  <Text style={[s.rowLabel, { color: colors.textMain, fontSize: 13 }]}>Enable</Text>
                  <Switch value={ctrl.allowedHoursEnabled} onValueChange={v => set({ allowedHoursEnabled: v })}
                    trackColor={{ false: colors.textDim + '30', true: colors.primary + '50' }}
                    thumbColor={ctrl.allowedHoursEnabled ? colors.primary : colors.textDim} />
                </View>
                {ctrl.allowedHoursEnabled && (
                  <View style={{ gap: 6, marginTop: 4 }}>
                    <View>
                      <Text style={[s.fieldLabel, { color: colors.textDim }]}>From</Text>
                      <TouchableOpacity style={[s.pickerBtn, { borderColor: colors.primary, backgroundColor: colors.primary + '10' }]}
                        onPress={() => setPickerMode('startHour')} activeOpacity={0.7}>
                        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13, flex: 1 }}>{formatHour(ctrl.allowedHoursStart)}</Text>
                        <Feather name="chevron-down" size={13} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                    <View>
                      <Text style={[s.fieldLabel, { color: colors.textDim }]}>To</Text>
                      <TouchableOpacity style={[s.pickerBtn, { borderColor: colors.primary, backgroundColor: colors.primary + '10' }]}
                        onPress={() => setPickerMode('endHour')} activeOpacity={0.7}>
                        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13, flex: 1 }}>{formatHour(ctrl.allowedHoursEnd)}</Text>
                        <Feather name="chevron-down" size={13} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </SectionCard>

              <SectionCard title="Break Enforcer" icon="coffee" iconBg="#93B0AC20" iconColor="#93B0AC" colors={colors} s={s} style={s.halfCard} compact>
                <View style={s.row}>
                  <Text style={[s.rowLabel, { color: colors.textMain, fontSize: 13 }]}>Enable</Text>
                  <Switch value={ctrl.breakEnforcerEnabled} onValueChange={v => set({ breakEnforcerEnabled: v })}
                    trackColor={{ false: colors.textDim + '30', true: colors.primary + '50' }}
                    thumbColor={ctrl.breakEnforcerEnabled ? colors.primary : colors.textDim} />
                </View>
                {ctrl.breakEnforcerEnabled && (
                  <View style={{ gap: 6, marginTop: 4 }}>
                    <View>
                      <Text style={[s.fieldLabel, { color: colors.textDim }]}>Break every</Text>
                      <TouchableOpacity style={[s.pickerBtn, { borderColor: colors.primary, backgroundColor: colors.primary + '10' }]}
                        onPress={() => setPickerMode('breakInterval')} activeOpacity={0.7}>
                        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13, flex: 1 }}>{formatMinutes(ctrl.breakIntervalMinutes)}</Text>
                        <Feather name="chevron-down" size={13} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                    <View>
                      <Text style={[s.fieldLabel, { color: colors.textDim }]}>Break lasts</Text>
                      <TouchableOpacity style={[s.pickerBtn, { borderColor: colors.primary, backgroundColor: colors.primary + '10' }]}
                        onPress={() => setPickerMode('breakDuration')} activeOpacity={0.7}>
                        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13, flex: 1 }}>{formatMinutes(ctrl.breakDurationMinutes)}</Text>
                        <Feather name="chevron-down" size={13} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </SectionCard>
            </View>

            {/* ── 5. Subject Filter ── */}
            <SectionCard title="Subject Filter" icon="filter" iconBg="#C5BD9620" iconColor="#C5BD96" colors={colors} s={s}>
              <View style={[s.row, { marginBottom: ctrl.subjectFilterEnabled ? 14 : 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowLabel, { color: colors.textMain }]}>Block specific subjects</Text>
                  <Text style={{ color: colors.textDim, fontSize: 12, marginTop: 2 }}>
                    Blocked subjects are locked on the student's app
                  </Text>
                </View>
                <Switch value={ctrl.subjectFilterEnabled} onValueChange={v => set({ subjectFilterEnabled: v })}
                  trackColor={{ false: colors.textDim + '30', true: colors.primary + '50' }}
                  thumbColor={ctrl.subjectFilterEnabled ? colors.primary : colors.textDim} />
              </View>
              {ctrl.subjectFilterEnabled && (
                <>
                  <Text style={[s.fieldLabel, { color: colors.textDim }]}>Tap to block / unblock</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {SUBJECTS.map(subject => {
                      const blocked = ctrl.blockedSubjects.includes(subject);
                      return (
                        <TouchableOpacity
                          key={subject}
                          style={[s.subjectChip, {
                            backgroundColor: blocked ? '#EFD1D420' : colors.primary + '15',
                            borderColor: blocked ? '#EFD1D480' : colors.primary + '60',
                          }]}
                          onPress={() => toggleSubject(subject)}
                          activeOpacity={0.7}
                        >
                          <Feather name={blocked ? 'lock' : 'unlock'} size={12} color={blocked ? '#EFD1D4' : colors.primary} />
                          <Text style={{ color: blocked ? '#EFD1D4' : colors.primary, fontSize: 12, fontWeight: '600' }}>
                            {subject}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {ctrl.blockedSubjects.length > 0 && (
                    <Text style={{ color: '#EFD1D4', fontSize: 11, marginTop: 10 }}>
                      {ctrl.blockedSubjects.length} subject{ctrl.blockedSubjects.length > 1 ? 's' : ''} blocked
                    </Text>
                  )}
                </>
              )}
            </SectionCard>

            {/* Toast */}
            <Animated.View style={[s.toast, { opacity: toastOpacity }]}>
              <Feather name="check-circle" size={15} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Settings saved</Text>
            </Animated.View>

            {/* Save button */}
            <TouchableOpacity
              style={[s.saveBtn, { backgroundColor: colors.primary }]}
              onPress={saveSettings}
              activeOpacity={0.7}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <><Feather name="check" size={15} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Save All Settings</Text></>
              }
            </TouchableOpacity>
          </>
        )}

        {children.length === 0 && (
          <View style={{ alignItems: 'center', gap: 12, marginTop: 60 }}>
            <Feather name="users" size={40} color={colors.textDim} />
            <Text style={{ color: colors.textDim, fontSize: 14, textAlign: 'center' }}>
              No children linked yet. Add a child from the dashboard to manage controls.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Generic picker modal */}
      <Modal visible={!!pickerMode} transparent animationType="fade" onRequestClose={() => setPickerMode(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setPickerMode(null)}>
          <View style={[s.pickerModal, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
            <View style={[s.pickerHeader, { borderBottomColor: colors.borderColor }]}>
              <Text style={[s.cardTitle, { color: colors.textMain }]}>{pickerTitle}</Text>
              <TouchableOpacity onPress={() => setPickerMode(null)}>
                <Feather name="x" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={pickerData}
              keyExtractor={v => String(v)}
              style={{ maxHeight: 300 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item: val }) => (
                <TouchableOpacity
                  style={[s.pickerOption, { borderBottomColor: colors.borderColor + '40' }, pickerValue === val && { backgroundColor: colors.primary + '18' }]}
                  onPress={() => handlePickerSelect(val)}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: pickerValue === val ? colors.primary : colors.textMain, fontWeight: pickerValue === val ? '700' : '500', fontSize: 15 }}>
                    {formatPickerItem(val)}
                  </Text>
                  {pickerValue === val && <Feather name="check" size={16} color={colors.primary} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </ScreenLayout>
  );
}

// ── Reusable section card ──────────────────────────────────────────────
function SectionCard({ title, icon, iconBg, iconColor, colors, s, children, style, compact }: any) {
  return (
    <View style={[s.card, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <View style={[s.iconCircle, { backgroundColor: iconBg, width: compact ? 32 : 40, height: compact ? 32 : 40, borderRadius: compact ? 16 : 20 }]}>
          <Feather name={icon} size={compact ? 14 : 18} color={iconColor} />
        </View>
        <Text style={[s.cardTitle, { color: colors.textMain, fontSize: compact ? 13 : 15 }]} numberOfLines={2}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const makeStyles = (c: AppColors, isDark: boolean) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  childRow: { flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
  childChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  usageCard: { padding: 20, borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: c.borderColor },
  usageHalf: { flex: 1, padding: 14, borderRadius: 16, borderWidth: 1, alignItems: 'center' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  progressBarBg: { height: 8, borderRadius: 4, backgroundColor: isDark ? '#ffffff12' : '#00000012', overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 4 },
  card: { padding: 18, borderRadius: 16, marginBottom: 14, borderWidth: 1 },
  cardRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  halfCard: { flex: 1, padding: 12, marginBottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontWeight: '600', fontSize: 14 },
  fieldLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginTop: 8 },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, marginBottom: 4 },
  divider: { borderTopWidth: 1, marginBottom: 0 },
  subjectChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 10, marginTop: 4, alignSelf: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', backgroundColor: c.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, marginBottom: 8 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: '#00000060', justifyContent: 'center', alignItems: 'center' },
  pickerModal: { width: 280, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1 },
  pickerOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
});
