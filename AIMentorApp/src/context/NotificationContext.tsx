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
  type: 'assignment' | 'quiz' | 'challenge' | 'message' | 'event' | 'task';
  // For 'event' items, the source schedule type ('challenge' | 'deadline' | 'study' …).
  // A challenge's due-date event has srcType 'challenge' so it can be gated under the
  // Challenge Updates toggle rather than Assignment Alerts.
  srcType?: string | null;
  title: string;
  subtitle: string;
  senderName: string;
  createdAt: string;
}

interface NotificationState {
  unreadCount: number;
  unreadAssignments: number;
  unreadChallenges: number;
  unreadEvents: number;
  latestNotif: LatestNotif | null;
  notificationItems: NotifItem[];
  toastVisible: boolean;
  dismissToast: () => void;
  clearUnread: () => Promise<void>;
  clearUnreadAssignments: () => Promise<void>;
  clearUnreadChallenges: () => Promise<void>;
  clearUnreadEvents: () => Promise<void>;
  refresh: () => Promise<void>;
  triggerPoll: () => void;
  muteCategory: (key: 'assignmentAlerts' | 'challengeUpdates') => void;
}

const NotificationContext = createContext<NotificationState>({
  unreadCount: 0,
  unreadAssignments: 0,
  unreadChallenges: 0,
  unreadEvents: 0,
  latestNotif: null,
  notificationItems: [],
  toastVisible: false,
  dismissToast: () => {},
  clearUnread: async () => {},
  clearUnreadAssignments: async () => {},
  clearUnreadChallenges: async () => {},
  clearUnreadEvents: async () => {},
  refresh: async () => {},
  triggerPoll: () => {},
  muteCategory: () => {},
});

const POLL_INTERVAL_MS  = 8000; // 8s — was 15s; push notifications don't exist on web (see
// pushNotifications.ts), so this poll is the ONLY way the web app learns about a new
// challenge/assignment — 15s made that delay noticeable ("challenge notification is slow").
const TOAST_AUTO_HIDE_MS = 5000;
const STALE_GUARD_MS    = 5000;

// ── Notification chime (Web Audio API — two-tone pleasant bell) ──────────────
// A fresh `new AudioContext()` per chime was the cause of a perceptible sound
// delay: the browser spins up the audio hardware/thread from scratch each
// time (100-300ms+, worse on the very first chime of a session), and old
// contexts were never closed, so they piled up and made things slower over
// time. Create the context once and reuse it for every chime instead.
let sharedAudioCtx: any = null;
function getAudioCtx() {
  if (Platform.OS !== 'web') return null;
  if (sharedAudioCtx) return sharedAudioCtx;
  const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;
  sharedAudioCtx = new AudioCtx();
  return sharedAudioCtx;
}

function playNotificationSound() {
  if (Platform.OS !== 'web') return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

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
  const [unreadEvents,      setUnreadEvents]      = useState(0);
  const [latestNotif,       setLatestNotif]       = useState<LatestNotif | null>(null);
  const [notificationItems, setNotificationItems] = useState<NotifItem[]>([]);
  const [toastVisible,      setToastVisible]      = useState(false);

  const prevMsgRef       = useRef(0);
  const prevAssignRef    = useRef(0);
  const prevChallengeRef = useRef(0);
  const prevEventRef     = useRef(0);
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
    async ({ reason = 'interval', allowDuringMarkRead = false, silent = false }: { reason?: string; allowDuringMarkRead?: boolean; silent?: boolean } = {}) => {
      if (!user?.email) return;
      if (markReadInFlight.current && !allowDuringMarkRead) return;

      const id = ++pollIdRef.current;

      // Build the since param from AsyncStorage for assignments/challenges
      let since: string | null = null;
      try {
        since = await AsyncStorage.getItem(`assignmentSeenAt_v2_${user.email}`);
        if (!since) {
          // Default to 7 days ago so past-week assignments are visible on first load
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          since = sevenDaysAgo.toISOString();
          await AsyncStorage.setItem(`assignmentSeenAt_v2_${user.email}`, since);
        }
      } catch (_) {}

      // Separate "seen" baseline for challenges so turning Challenge Updates ON
      // dismisses only the challenge backlog (and assignments their own).
      let challengeSince: string | null = null;
      try { challengeSince = await AsyncStorage.getItem(`challengeSeenAt_v2_${user.email}`); } catch (_) {}

      // Separate "seen" baseline for schedule events.
      let eventSince: string | null = null;
      try { eventSince = await AsyncStorage.getItem(`eventSeenAt_v2_${user.email}`); } catch (_) {}

      const params = new URLSearchParams({ userEmail: user.email });
      if (since) params.set('since', since);
      if (challengeSince) params.set('challengeSince', challengeSince);
      if (eventSince) params.set('eventSince', eventSince);

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
      const eventCount   = typeof data.events      === 'number' && data.events      >= 0 ? Math.floor(data.events)      : 0;
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

      // Read parent notification preferences (if set)
      let notifPrefs: Record<string, boolean> = {};
      try {
        const raw = await AsyncStorage.getItem(`notifPrefs_${user.email}`);
        if (raw) notifPrefs = JSON.parse(raw);
      } catch {}
      const allowAssign    = notifPrefs.assignmentAlerts   !== false;
      const allowMsg       = notifPrefs.teacherMessages     !== false;
      const allowChallenge = notifPrefs.challengeUpdates    !== false;

      // A challenge's due-date event follows the Challenge Updates toggle, not
      // Assignment Alerts — so count it under challenges, never under events.
      // Compute these BEFORE the chime logic so the sound/toast never fires for a
      // category that's toggled off (which produced a "blank push with sound").
      const challengeEventCount = items.filter(i => i.type === 'event' && i.srcType === 'challenge').length;
      const nonChallengeEventCount = Math.max(0, eventCount - challengeEventCount);
      const effChallengeCount = challengeCount + challengeEventCount;
      const effEventCount     = nonChallengeEventCount;

      // Only chime/toast when a count goes UP *after* the baseline is set.
      // The first poll after mount/refresh just records the baseline silently.
      const baseline = hasBaselineRef.current;
      const newMsg       = baseline && allowMsg       && !markReadInFlight.current && msgCount          > prevMsgRef.current;
      const newAssign    = baseline && allowAssign    && !markReadInFlight.current && assignCount       > prevAssignRef.current;
      const newChallenge = baseline && allowChallenge && !markReadInFlight.current && effChallengeCount > prevChallengeRef.current;
      const newEvent     = baseline && allowAssign    && !markReadInFlight.current && effEventCount     > prevEventRef.current;

      if (!silent && (newMsg || newAssign || newChallenge || newEvent)) {
        playNotificationSound();
        if (newMsg && latest) setLatestNotif(latest);
        setToastVisible(true);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setToastVisible(false), TOAST_AUTO_HIDE_MS);
      }

      prevMsgRef.current       = msgCount;
      prevAssignRef.current    = assignCount;
      prevChallengeRef.current = effChallengeCount;
      prevEventRef.current     = effEventCount;
      hasBaselineRef.current   = true;

      setUnreadCount(allowMsg ? msgCount : 0);
      setUnreadAssignments(allowAssign ? assignCount : 0);
      setUnreadChallenges(allowChallenge ? effChallengeCount : 0);
      setUnreadEvents(allowAssign ? effEventCount : 0);
      setLatestNotif(msgCount > 0 ? latest : null);
      // Respect the user's notification preferences for the bell dropdown items too —
      // when Assignment Alerts / Challenge Updates are OFF, those items must NOT appear
      // in the bell at all (not just have a zeroed badge count).
      const filteredItems = items.filter(it => {
        // A challenge's due-date event follows the Challenge Updates toggle.
        const isChallengeEvent = it.type === 'event' && it.srcType === 'challenge';
        if (isChallengeEvent) return allowChallenge;
        if ((it.type === 'assignment' || it.type === 'quiz' || it.type === 'event' || it.type === 'task') && !allowAssign) return false;
        if (it.type === 'challenge' && !allowChallenge) return false;
        return true;
      });
      setNotificationItems(filteredItems);
      if (msgCount === 0 && assignCount === 0 && challengeCount === 0) setToastVisible(false);

      if (__DEV__) console.debug(`[NotifCtx] poll(${reason}) → msg:${msgCount} assign:${assignCount} challenge:${challengeCount}`);
    },
    [user?.email]
  );

  useEffect(() => {
    if (!user?.email) {
      setUnreadCount(0); setUnreadAssignments(0); setUnreadChallenges(0); setUnreadEvents(0);
      setLatestNotif(null); setToastVisible(false);
      prevMsgRef.current = 0; prevAssignRef.current = 0; prevChallengeRef.current = 0; prevEventRef.current = 0;
      staleGuardUntil.current = 0; markReadCutoff.current = null;
      hasBaselineRef.current = false;
      return;
    }

    // Seed the bell's local pref key from the server BEFORE the first poll. The
    // toggle's visual state loads from the server preference, but the bell's
    // filtering reads AsyncStorage `notifPrefs_` — which is only written when the
    // user actively flips a switch. On a fresh session (e.g. incognito) that key
    // is empty, so a preference already set to OFF wouldn't be respected and the
    // notification would still show. Merge server prefs in (local keys still win).
    const email = user.email;
    (async () => {
      try {
        const res = await fetch(`${SERVER_URL}/user/preferences?email=${encodeURIComponent(email)}`);
        const serverPrefs = res.ok ? await res.json() : null;
        if (serverPrefs) {
          const NK = `notifPrefs_${email}`;
          const raw = await AsyncStorage.getItem(NK).catch(() => null);
          const local = raw ? JSON.parse(raw) : {};
          const merged = { ...local };
          for (const k of ['assignmentAlerts', 'challengeUpdates', 'teacherMessages'] as const) {
            if (merged[k] === undefined && serverPrefs[k] !== undefined) merged[k] = serverPrefs[k];
          }
          await AsyncStorage.setItem(NK, JSON.stringify(merged)).catch(() => {});
        }
      } catch {}
      void poll({ reason: 'initial', allowDuringMarkRead: true });
    })();
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
    await poll({ reason: 'post-mark-read', allowDuringMarkRead: true, silent: true });
  }, [poll, user?.email]);

  const clearUnreadAssignments = useCallback(async () => {
    if (!user?.email) return;
    try {
      await AsyncStorage.setItem(`assignmentSeenAt_v2_${user.email}`, new Date().toISOString());
      setUnreadAssignments(0);
      prevAssignRef.current = 0;
      // Parents' assignment alerts are backed by unread system messages — the local
      // "seen" timestamp alone doesn't stop them recurring, so persist read state.
      // AWAIT this so the re-poll below sees the messages already marked read
      // (otherwise the backlog re-appears when turning the toggle back on).
      await fetch(`${SERVER_URL}/messages/mark-system-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: user.email, kind: 'assignment' }),
      }).catch(() => {});
      // Re-poll AFTER the backlog is dismissed so the authoritative count is 0.
      await poll({ reason: 'post-clear-assignments', allowDuringMarkRead: true, silent: true });
    } catch (err) {
      if (__DEV__) console.warn('[NotifCtx] clearUnreadAssignments failed:', err);
    }
  }, [user?.email, poll]);

  const clearUnreadChallenges = useCallback(async () => {
    if (!user?.email) return;
    try {
      await AsyncStorage.setItem(`challengeSeenAt_v2_${user.email}`, new Date().toISOString());
      setUnreadChallenges(0);
      prevChallengeRef.current = 0;
      // Same as assignments: persist parent challenge-alert read state server-side, then
      // re-poll so the dismissed backlog doesn't re-appear on the next cycle.
      await fetch(`${SERVER_URL}/messages/mark-system-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: user.email, kind: 'challenge' }),
      }).catch(() => {});
      await poll({ reason: 'post-clear-challenges', allowDuringMarkRead: true, silent: true });
    } catch (err) {
      if (__DEV__) console.warn('[NotifCtx] clearUnreadChallenges failed:', err);
    }
  }, [user?.email, poll]);

  const clearUnreadEvents = useCallback(async () => {
    if (!user?.email) return;
    try {
      await AsyncStorage.setItem(`eventSeenAt_v2_${user.email}`, new Date().toISOString());
      setUnreadEvents(0);
      prevEventRef.current = 0;
      await poll({ reason: 'post-clear-events', allowDuringMarkRead: true, silent: true });
    } catch (err) {
      if (__DEV__) console.warn('[NotifCtx] clearUnreadEvents failed:', err);
    }
  }, [user?.email, poll]);

  const refresh = useCallback(async () => {
    await poll({ reason: 'manual-refresh', allowDuringMarkRead: true });
  }, [poll]);

  // Immediately drop already-displayed items for a category the user just turned OFF,
  // so the bell reflects the change instantly instead of waiting for the next poll.
  // (The poll itself already respects the saved preference on subsequent fetches.)
  const muteCategory = useCallback((key: 'assignmentAlerts' | 'challengeUpdates') => {
    if (key === 'challengeUpdates') {
      setUnreadChallenges(0);
      prevChallengeRef.current = 0;
      setNotificationItems(items => items.filter(
        i => !(i.type === 'challenge' || (i.type === 'event' && i.srcType === 'challenge'))
      ));
    } else {
      setUnreadAssignments(0);
      setUnreadEvents(0);
      prevAssignRef.current = 0;
      prevEventRef.current = 0;
      setNotificationItems(items => items.filter(
        i => !(i.type === 'assignment' || i.type === 'quiz' || i.type === 'task' || (i.type === 'event' && i.srcType !== 'challenge'))
      ));
    }
  }, []);

  // Trigger an immediate poll (e.g. after pref changes in Settings)
  const triggerPoll = useCallback(() => {
    void poll({ reason: 'prefs-changed', allowDuringMarkRead: false });
  }, [poll]);

  return (
    <NotificationContext.Provider value={{
      unreadCount, unreadAssignments, unreadChallenges, unreadEvents,
      latestNotif, notificationItems, toastVisible,
      dismissToast, clearUnread, clearUnreadAssignments, clearUnreadChallenges, clearUnreadEvents, refresh, triggerPoll, muteCategory,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  return useContext(NotificationContext);
}
