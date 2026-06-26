import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useResponsive } from '../../hooks/useResponsive';
import Sidebar from './Sidebar';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import TeacherAIPanel from './TeacherAIPanel';
import ParentAIPanel from './ParentAIPanel';
import type { AppColors } from '../../theme';
import { Feather } from '@expo/vector-icons';
import SERVER_URL from '../../config/serverUrl';

interface ScreenLayoutProps {
  children: React.ReactNode;
}

interface StudentControls {
  hasLimit: boolean;
  isLocked?: boolean;
  usedMinutes?: number;
  dailyLimitMinutes?: number;
  weeklyCap?: { enabled: boolean; weeklyLimitMinutes?: number; weeklyUsedMinutes?: number; isOverWeeklyCap?: boolean };
  allowedHours?: { enabled: boolean; startHour?: number; endHour?: number };
  breakEnforcer?: { enabled: boolean; intervalMinutes?: number; breakDurationMinutes?: number };
  homeworkFirst?: { enabled: boolean };
  subjectFilter?: { enabled: boolean; blockedSubjects?: string[] };
}

function formatHour(h: number) {
  if (h === 0) return '12:00 AM';
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${h - 12}:00 PM`;
}

// Module-level singleton so the study-time heartbeat runs ONCE for the whole app.
// The drawer navigator keeps every visited screen mounted, and each screen wraps
// its own <ScreenLayout>. Without this guard, every mounted instance would run its
// own 1-min heartbeat and multiply the logged study time (e.g. 2.5h shown as ~7h).
let _heartbeatInterval: any = null;
let _heartbeatRefCount = 0;

export default function ScreenLayout({ children }: ScreenLayoutProps) {
  const { showPermanentSidebar } = useResponsive();
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isTeacher = user?.role === 'teacher' || user?.role === 'super_admin';
  const isParent = user?.role === 'parent';
  const isStudent = user?.role === 'student';

  const [controls, setControls] = useState<StudentControls | null>(null);

  // ── Break enforcer helpers (localStorage so refresh-safe) ──────────────
  const todayKey = () => new Date().toISOString().split('T')[0];
  const LS_THRESHOLD = 'aivorah_lastBreakThreshold';
  const LS_BREAK     = 'aivorah_breakEndsAt'; // epoch ms when current break ends

  const getLastBreakThreshold = () => {
    try {
      const raw = localStorage.getItem(LS_THRESHOLD);
      if (!raw) return -1;
      const { date, value } = JSON.parse(raw);
      return date === todayKey() ? (value as number) : -1;
    } catch { return -1; }
  };
  const saveLastBreakThreshold = (v: number) => {
    try { localStorage.setItem(LS_THRESHOLD, JSON.stringify({ date: todayKey(), value: v })); } catch {}
  };
  const getBreakEndsAt = (): number => {
    try { return parseInt(localStorage.getItem(LS_BREAK) ?? '0', 10); } catch { return 0; }
  };
  const saveBreakEndsAt = (endsAt: number) => {
    try { localStorage.setItem(LS_BREAK, String(endsAt)); } catch {}
  };
  const clearBreakEndsAt = () => {
    try { localStorage.removeItem(LS_BREAK); } catch {}
  };

  // On mount, restore a break that was active before a refresh
  const restoredSecsLeft = (() => {
    const endsAt = getBreakEndsAt();
    if (!endsAt) return 0;
    const secsLeft = Math.round((endsAt - Date.now()) / 1000);
    return secsLeft > 0 ? secsLeft : 0;
  })();

  const [breakActive, setBreakActive] = useState(restoredSecsLeft > 0);
  const [breakSecondsLeft, setBreakSecondsLeft] = useState(restoredSecsLeft);
  const lastBreakThresholdRef = useRef<number>(getLastBreakThreshold());
  const breakTimerRef = useRef<any>(null);
  const controlsIntervalRef = useRef<any>(null);

  // 1-min heartbeat: track screen time. Singleton across ALL ScreenLayout
  // instances (see module-level guard above) so study time is counted once
  // per minute, not once per mounted screen.
  useEffect(() => {
    if (!isStudent || !user?.email) return;
    const email = user.email;
    const tick = async () => {
      try {
        const syncRes = await fetch(`${SERVER_URL}/user/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, role: 'student' }),
        });
        if (!syncRes.ok) return;
        const { id } = await syncRes.json();
        if (!id) return;
        fetch(`${SERVER_URL}/student/${id}/study-time`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minutes: 1 }),
        }).catch(() => {});
      } catch {}
    };
    _heartbeatRefCount++;
    if (!_heartbeatInterval) {
      _heartbeatInterval = setInterval(tick, 60 * 1000);
    }
    return () => {
      _heartbeatRefCount--;
      if (_heartbeatRefCount <= 0 && _heartbeatInterval) {
        clearInterval(_heartbeatInterval);
        _heartbeatInterval = null;
        _heartbeatRefCount = 0;
      }
    };
  }, [isStudent, user?.email]);

  // Fetch controls every 15s
  useEffect(() => {
    if (!isStudent || !user?.email) return;
    const fetch_ = () => {
      fetch(`${SERVER_URL}/parent/screen-time-status/${encodeURIComponent(user.email)}`)
        .then(r => r.json())
        .then(data => setControls(data))
        .catch(() => {});
    };
    fetch_();
    controlsIntervalRef.current = setInterval(fetch_, 15 * 1000);
    return () => clearInterval(controlsIntervalRef.current);
  }, [isStudent, user?.email]);

  // Break enforcer: triggers when cumulative daily usage crosses a NEW multiple of intervalMinutes
  useEffect(() => {
    if (!controls?.breakEnforcer?.enabled || breakActive) return;
    const cfg = controls.breakEnforcer;
    const interval = cfg.intervalMinutes ?? 25;
    const usedMin = controls.usedMinutes ?? 0;
    const threshold = Math.floor(usedMin / interval) * interval;
    if (threshold > 0 && usedMin >= threshold && threshold !== lastBreakThresholdRef.current) {
      lastBreakThresholdRef.current = threshold;
      saveLastBreakThreshold(threshold);
      const durationSecs = (cfg.breakDurationMinutes ?? 5) * 60;
      saveBreakEndsAt(Date.now() + durationSecs * 1000);
      setBreakActive(true);
      setBreakSecondsLeft(durationSecs);
    }
  }, [controls?.usedMinutes, controls?.breakEnforcer?.enabled, breakActive]);

  // Break countdown
  useEffect(() => {
    if (!breakActive) return;
    const tick = setInterval(() => {
      setBreakSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(tick);
          clearBreakEndsAt();
          setBreakActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [breakActive]);

  // Compute overlay type: priority order: locked > outside hours > weekly cap > break
  const isLocked = controls?.isLocked === true;

  const isOutsideAllowedHours = (() => {
    if (!controls?.allowedHours?.enabled) return false;
    const now = new Date();
    const h = now.getHours();
    const start = controls.allowedHours.startHour ?? 14;
    const end = controls.allowedHours.endHour ?? 21;
    // Overnight range (e.g. 9 AM – 2 AM crosses midnight): block only when h < start AND h >= end
    if (end < start) return h < start && h >= end;
    // Same-day range (e.g. 9 AM – 9 PM): block when outside start–end
    return h < start || h >= end;
  })();

  const isOverWeeklyCap = controls?.weeklyCap?.enabled && controls.weeklyCap.isOverWeeklyCap;


  const content = (
    <View style={{ flex: 1 }}>
      {children}

    </View>
  );

  const showFullscreen = isStudent && (breakActive || isLocked || isOutsideAllowedHours || (isOverWeeklyCap ?? false));
  const fullscreenLock = showFullscreen ? (
    <View style={styles.fullscreenOverlay}>
      {breakActive ? (
        <View style={[styles.overlayCard, { backgroundColor: '#1A1A1A', borderColor: '#93B0AC40' }]}>
          <View style={[styles.overlayIcon, { backgroundColor: '#93B0AC20' }]}>
            <Feather name="coffee" size={32} color="#93B0AC" />
          </View>
          <Text style={[styles.overlayTitle, { color: '#FFFFFF' }]}>Break Time!</Text>
          <Text style={[styles.overlayDesc, { color: '#AAAAAA' }]}>
            You've been studying hard.{'\n'}Stretch, drink some water.
          </Text>
          <View style={[styles.timerBadge, { backgroundColor: '#93B0AC20' }]}>
            <Text style={{ color: '#93B0AC', fontWeight: '800', fontSize: 28 }}>
              {Math.floor(breakSecondsLeft / 60)}:{String(breakSecondsLeft % 60).padStart(2, '0')}
            </Text>
          </View>
          <Text style={{ color: '#666', fontSize: 12, textAlign: 'center' }}>App unlocks automatically when break ends</Text>
        </View>
      ) : isLocked ? (
        <View style={[styles.overlayCard, { backgroundColor: '#1A1A1A', borderColor: '#EFD1D430' }]}>
          <View style={[styles.overlayIcon, { backgroundColor: '#EFD1D415' }]}>
            <Feather name="lock" size={32} color="#EFD1D4" />
          </View>
          <Text style={[styles.overlayTitle, { color: '#FFFFFF' }]}>See you tomorrow!</Text>
          <Text style={[styles.overlayDesc, { color: '#AAAAAA' }]}>
            You've used your full {controls?.dailyLimitMinutes ?? 0} min today.{'\n'}Great work — rest up and come back tomorrow!
          </Text>
          <Text style={{ color: '#666', fontSize: 11, textAlign: 'center', marginTop: 4 }}>Ask a parent to adjust your limit</Text>
        </View>
      ) : isOverWeeklyCap ? (
        <View style={[styles.overlayCard, { backgroundColor: '#1A1A1A', borderColor: '#C5BD9640' }]}>
          <View style={[styles.overlayIcon, { backgroundColor: '#C5BD9620' }]}>
            <Feather name="bar-chart-2" size={32} color="#C5BD96" />
          </View>
          <Text style={[styles.overlayTitle, { color: '#FFFFFF' }]}>Weekly Limit Reached</Text>
          <Text style={[styles.overlayDesc, { color: '#AAAAAA' }]}>
            You've reached your weekly screen time limit.{'\n'}Resets next Monday!
          </Text>
        </View>
      ) : (
        <View style={[styles.overlayCard, { backgroundColor: '#1A1A1A', borderColor: '#F0C27040' }]}>
          <View style={[styles.overlayIcon, { backgroundColor: '#F0C27020' }]}>
            <Feather name="moon" size={32} color="#F0C270" />
          </View>
          <Text style={[styles.overlayTitle, { color: '#FFFFFF' }]}>Outside Study Hours</Text>
          <Text style={[styles.overlayDesc, { color: '#AAAAAA' }]}>
            App is available between{' '}
            <Text style={{ fontWeight: '700', color: '#FFFFFF' }}>
              {formatHour(controls?.allowedHours?.startHour ?? 14)} – {formatHour(controls?.allowedHours?.endHour ?? 21)}
            </Text>
            {'\n'}Come back during study time!
          </Text>
        </View>
      )}
    </View>
  ) : null;

  if (!showPermanentSidebar) {
    return <View style={styles.mobileContainer}>{content}{fullscreenLock}</View>;
  }

  return (
    <View style={styles.desktopContainer}>
      <Sidebar currentScreen={route.name} onNavigate={(screen) => navigation.navigate(screen as any)} />
      <View style={styles.contentWrapper}>{content}</View>
      {isTeacher && <TeacherAIPanel />}
      {isParent && <ParentAIPanel />}
      {fullscreenLock}
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  mobileContainer: { flex: 1, backgroundColor: c.bgDark },
  desktopContainer: { flex: 1, flexDirection: 'row', backgroundColor: c.bgDark },
  contentWrapper: { flex: 1, backgroundColor: c.bgDark, overflow: 'hidden' },
  homeworkBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1,
  },
  fullscreenOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center',
    zIndex: 9999, padding: 24,
  },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: c.bgDark + 'F2', justifyContent: 'center', alignItems: 'center',
    zIndex: 9999, padding: 24,
  },
  overlayCard: {
    borderRadius: 20, padding: 32, alignItems: 'center',
    maxWidth: 340, width: '100%', gap: 12, borderWidth: 1,
  },
  overlayIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  overlayTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  overlayDesc: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  timerBadge: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginVertical: 4 },
  statRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  statBox: { padding: 14, alignItems: 'center', gap: 4, minWidth: 90 },
});
