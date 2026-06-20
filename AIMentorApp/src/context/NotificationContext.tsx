import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { useAuth } from './AuthContext';
import SERVER_URL from '../config/serverUrl';

declare const __DEV__: boolean;

interface LatestNotif {
  id: string;
  senderName: string;
  senderEmail: string;
  preview: string;
  createdAt: string;
}

export interface NotifItem {
  id: string;
  type: 'assignment' | 'quiz' | 'challenge' | 'message';
  title: string;
  subtitle: string;
  senderName: string;
  createdAt: string;
}

interface NotificationState {
  unreadCount: number;
  unreadAssignments: number;
  unreadChallenges: number;
  latestNotif: LatestNotif | null;
  notificationItems: NotifItem[];
  toastVisible: boolean;
  dismissToast: () => void;
  clearUnread: () => Promise<void>;
  clearUnreadAssignments: () => Promise<void>;
  clearUnreadChallenges: () => Promise<void>;
  refresh: () => Promise<void>;
}

const NotificationContext = createContext<NotificationState>({
  unreadCount: 0,
  unreadAssignments: 0,
  unreadChallenges: 0,
  latestNotif: null,
  notificationItems: [],
  toastVisible: false,
  dismissToast: () => {},
  clearUnread: async () => {},
  clearUnreadAssignments: async () => {},
  clearUnreadChallenges: async () => {},
  refresh: async () => {},
});

const POLL_INTERVAL_MS  = 15000; // 15s — one combined request, less stress
const TOAST_AUTO_HIDE_MS = 5000;
const STALE_GUARD_MS    = 5000;

// ── Notification chime (Web Audio API — two-tone pleasant bell) ──────────────
function playNotificationSound() {
  if (Platform.OS !== 'web') return;
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    function tone(freq: number, startAt: number, duration: number, vol: number) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt);
      gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + startAt + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + duration);
      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + duration);
    }

    // Pleasant two-note chime: D5 → A5
    tone(587, 0,    0.45, 0.18);
    tone(880, 0.18, 0.55, 0.14);
  } catch (_) {}
}

function normalizeLatest(raw: any): LatestNotif | null {
  if (!raw || typeof raw !== 'object') return null;
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : '';
  if (!Date.parse(createdAt)) return null;
  return {
    id:          typeof raw.id === 'string'          ? raw.id          : '',
    senderName:  typeof raw.senderName === 'string'  ? raw.senderName.trim() || 'Someone' : 'Someone',
    senderEmail: typeof raw.senderEmail === 'string' ? raw.senderEmail.trim().toLowerCase() : '',
    preview:     typeof raw.preview === 'string'     ? raw.preview.trim() : '',
    createdAt:   new Date(Date.parse(createdAt)).toISOString(),
  };
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [unreadCount,       setUnreadCount]       = useState(0);
  const [unreadAssignments, setUnreadAssignments] = useState(0);
  const [unreadChallenges,  setUnreadChallenges]  = useState(0);
  const [latestNotif,       setLatestNotif]       = useState<LatestNotif | null>(null);
  const [notificationItems, setNotificationItems] = useState<NotifItem[]>([]);
  const [toastVisible,      setToastVisible]      = useState(false);

  const prevMsgRef       = useRef(0);
  const prevAssignRef    = useRef(0);
  const prevChallengeRef = useRef(0);
  // False until the first poll after mount/login completes. The first poll only
  // records the current counts as a baseline — it must NOT chime/toast, otherwise
  // every page refresh re-alerts for notifications that already existed.
  const hasBaselineRef   = useRef(false);
  const pollRef          = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIdRef        = useRef(0);
  const markReadInFlight = useRef(false);
  const staleGuardUntil  = useRef(0);
  const markReadCutoff   = useRef<number | null>(null);

  const poll = useCallback(
    async ({ reason = 'interval', allowDuringMarkRead = false }: { reason?: string; allowDuringMarkRead?: boolean } = {}) => {
      if (!user?.email) return;
      if (markReadInFlight.current && !allowDuringMarkRead) return;

      const id = ++pollIdRef.current;

      // Build the since param from AsyncStorage for assignments/challenges
      let since: string | null = null;
      try {
        since = await AsyncStorage.getItem(`assignmentSeenAt_v2_${user.email}`);
        if (!since) {
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          since = startOfToday.toISOString();
          await AsyncStorage.setItem(`assignmentSeenAt_v2_${user.email}`, since);
        }
      } catch (_) {}

      const params = new URLSearchParams({ userEmail: user.email });
      if (since) params.set('since', since);

      let res: Response;
      try {
        res = await fetch(`${SERVER_URL}/messages/notifications-summary?${params}`);
      } catch (err) {
        if (__DEV__) console.warn('[NotifCtx] fetch failed:', err);
        return;
      }

      if (id !== pollIdRef.current) return; // stale
      if (!res.ok) { if (__DEV__) console.warn('[NotifCtx] non-ok response:', res.status); return; }

      let data: any;
      try { data = await res.json(); } catch { return; }
      if (id !== pollIdRef.current) return;

      const msgCount     = typeof data.messages    === 'number' && data.messages    >= 0 ? Math.floor(data.messages)    : 0;
      const assignCount  = typeof data.assignments === 'number' && data.assignments >= 0 ? Math.floor(data.assignments) : 0;
      const challengeCount = typeof data.challenges === 'number' && data.challenges >= 0 ? Math.floor(data.challenges) : 0;
      const latest       = normalizeLatest(data.latest);
      const items: NotifItem[] = Array.isArray(data.notificationItems) ? data.notificationItems : [];

      if (markReadInFlight.current && !allowDuringMarkRead) return;

      // Stale guard: ignore counts that arrived right after mark-read
      const now = Date.now();
      if (msgCount > 0 && staleGuardUntil.current > now && markReadCutoff.current != null) {
        const latestMs = latest ? Date.parse(latest.createdAt) : NaN;
        if (isNaN(latestMs) || latestMs <= markReadCutoff.current) return;
      }
      if (msgCount === 0) {
        staleGuardUntil.current = 0;
        markReadCutoff.current = null;
      }

      // Only chime/toast when a count goes UP *after* the baseline is set.
      // The first poll after mount/refresh just records the baseline silently.
      const baseline = hasBaselineRef.current;
      const newMsg       = baseline && !markReadInFlight.current && msgCount       > prevMsgRef.current;
      const newAssign    = baseline && !markReadInFlight.current && assignCount    > prevAssignRef.current;
      const newChallenge = baseline && !markReadInFlight.current && challengeCount > prevChallengeRef.current;

      if (newMsg || newAssign || newChallenge) {
        playNotificationSound();
        if (newMsg && latest) setLatestNotif(latest);
        setToastVisible(true);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setToastVisible(false), TOAST_AUTO_HIDE_MS);
      }

      prevMsgRef.current       = msgCount;
      prevAssignRef.current    = assignCount;
      prevChallengeRef.current = challengeCount;
      hasBaselineRef.current   = true;

      setUnreadCount(msgCount);
      setUnreadAssignments(assignCount);
      setUnreadChallenges(challengeCount);
      setLatestNotif(msgCount > 0 ? latest : null);
      setNotificationItems(items);
      if (msgCount === 0 && assignCount === 0 && challengeCount === 0) setToastVisible(false);

      if (__DEV__) console.debug(`[NotifCtx] poll(${reason}) → msg:${msgCount} assign:${assignCount} challenge:${challengeCount}`);
    },
    [user?.email]
  );

  useEffect(() => {
    if (!user?.email) {
      setUnreadCount(0); setUnreadAssignments(0); setUnreadChallenges(0);
      setLatestNotif(null); setToastVisible(false);
      prevMsgRef.current = 0; prevAssignRef.current = 0; prevChallengeRef.current = 0;
      staleGuardUntil.current = 0; markReadCutoff.current = null;
      hasBaselineRef.current = false;
      return;
    }

    void poll({ reason: 'initial', allowDuringMarkRead: true });
    pollRef.current = setInterval(() => void poll({ reason: 'interval' }), POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [user?.email, poll]);

  const dismissToast = () => setToastVisible(false);

  const clearUnread = useCallback(async () => {
    if (!user?.email) return;
    const now = Date.now();
    markReadInFlight.current = true;
    staleGuardUntil.current  = now + STALE_GUARD_MS;
    markReadCutoff.current   = now;
    setUnreadCount(0); setLatestNotif(null); setToastVisible(false);
    prevMsgRef.current = 0;

    let ok = false;
    try {
      const res = await fetch(`${SERVER_URL}/messages/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: user.email }),
      });
      if (res.ok) {
        ok = true;
        const data = await res.json().catch(() => ({}));
        if (typeof data?.unreadCount === 'number') {
          const n = Math.max(0, Math.floor(data.unreadCount));
          prevMsgRef.current = n;
          setUnreadCount(n);
          if (n === 0) setLatestNotif(null);
        }
      }
    } catch (err) {
      if (__DEV__) console.warn('[NotifCtx] mark-read failed:', err);
    } finally {
      markReadInFlight.current = false;
      if (!ok) { staleGuardUntil.current = 0; markReadCutoff.current = null; }
    }
    await poll({ reason: 'post-mark-read', allowDuringMarkRead: true });
  }, [poll, user?.email]);

  const clearUnreadAssignments = useCallback(async () => {
    if (!user?.email) return;
    try {
      await AsyncStorage.setItem(`assignmentSeenAt_v2_${user.email}`, new Date().toISOString());
      setUnreadAssignments(0);
      prevAssignRef.current = 0;
    } catch (err) {
      if (__DEV__) console.warn('[NotifCtx] clearUnreadAssignments failed:', err);
    }
  }, [user?.email]);

  const clearUnreadChallenges = useCallback(async () => {
    if (!user?.email) return;
    try {
      await AsyncStorage.setItem(`challengeSeenAt_v2_${user.email}`, new Date().toISOString());
      setUnreadChallenges(0);
      prevChallengeRef.current = 0;
    } catch (err) {
      if (__DEV__) console.warn('[NotifCtx] clearUnreadChallenges failed:', err);
    }
  }, [user?.email]);

  const refresh = useCallback(async () => {
    await poll({ reason: 'manual-refresh', allowDuringMarkRead: true });
  }, [poll]);

  return (
    <NotificationContext.Provider value={{
      unreadCount, unreadAssignments, unreadChallenges,
      latestNotif, notificationItems, toastVisible,
      dismissToast, clearUnread, clearUnreadAssignments, clearUnreadChallenges, refresh,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  return useContext(NotificationContext);
}
