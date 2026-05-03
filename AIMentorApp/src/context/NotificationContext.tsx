import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

interface NotificationState {
  unreadCount: number;
  unreadAssignments: number;
  unreadChallenges: number;
  latestNotif: LatestNotif | null;
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
  toastVisible: false,
  dismissToast: () => {},
  clearUnread: async () => {},
  clearUnreadAssignments: async () => {},
  clearUnreadChallenges: async () => {},
  refresh: async () => {},
});

const POLL_INTERVAL_MS = 10000;
const TOAST_AUTO_HIDE_MS = 5000;
const STALE_COUNT_GUARD_MS = 5000;

function debugLog(message: string, meta?: Record<string, unknown>) {
  if (!__DEV__) return;
  if (meta) {
    console.debug(`[NotificationContext] ${message}`, meta);
    return;
  }
  console.debug(`[NotificationContext] ${message}`);
}

function normalizeUnreadPayload(raw: any): { count: number; latest: LatestNotif | null } | null {
  const rawCount = raw?.count;
  if (typeof rawCount !== 'number' || !Number.isFinite(rawCount) || rawCount < 0) {
    return null;
  }

  const count = Math.floor(rawCount);
  const latestRaw = raw?.latest;

  let latest: LatestNotif | null = null;
  if (latestRaw && typeof latestRaw === 'object') {
    const createdAtRaw = typeof latestRaw.createdAt === 'string' ? latestRaw.createdAt : '';
    const parsedCreatedAt = Date.parse(createdAtRaw);
    if (!Number.isNaN(parsedCreatedAt)) {
      latest = {
        id: typeof latestRaw.id === 'string' ? latestRaw.id : '',
        senderName:
          typeof latestRaw.senderName === 'string' && latestRaw.senderName.trim()
            ? latestRaw.senderName.trim()
            : 'Someone',
        senderEmail:
          typeof latestRaw.senderEmail === 'string' ? latestRaw.senderEmail.trim().toLowerCase() : '',
        preview: typeof latestRaw.preview === 'string' ? latestRaw.preview.trim() : '',
        createdAt: new Date(parsedCreatedAt).toISOString(),
      };
    }
  }

  if (count === 0) {
    latest = null;
  }

  return { count, latest };
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadAssignments, setUnreadAssignments] = useState(0);
  const [unreadChallenges, setUnreadChallenges] = useState(0);
  const [latestNotif, setLatestNotif] = useState<LatestNotif | null>(null);
  const [toastVisible, setToastVisible] = useState(false);

  const prevCountRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollRequestIdRef = useRef(0);
  const markReadInFlightRef = useRef(false);
  const staleGuardUntilRef = useRef(0);
  const markReadCutoffRef = useRef<number | null>(null);

  const poll = useCallback(
    async ({ reason = 'interval', allowDuringMarkRead = false }: { reason?: string; allowDuringMarkRead?: boolean } = {}) => {
      if (!user?.email) return;

      if (markReadInFlightRef.current && !allowDuringMarkRead) {
        debugLog('Skipping unread poll while mark-read is in flight.', { reason });
        return;
      }

      const requestId = ++pollRequestIdRef.current;
      const endpoint = `${SERVER_URL}/messages/unread-count?userEmail=${encodeURIComponent(user.email)}`;

      let res: Response;
      try {
        res = await fetch(endpoint);
      } catch (err) {
        console.error(`[NotificationContext] unread-count polling failed (${reason}):`, err);
        return;
      }

      if (requestId !== pollRequestIdRef.current) {
        debugLog('Discarding stale unread-count response (newer poll already started).', { reason });
        return;
      }

      if (!res.ok) {
        let bodyText = '';
        try {
          bodyText = await res.text();
        } catch {
          bodyText = '';
        }
        console.error(`[NotificationContext] unread-count polling failed (${reason}) with ${res.status}:`, bodyText);
        return;
      }

      let data: any;
      try {
        data = await res.json();
      } catch (err) {
        console.error(`[NotificationContext] unread-count polling returned invalid JSON (${reason}):`, err);
        return;
      }

      if (requestId !== pollRequestIdRef.current) {
        debugLog('Discarding unread-count payload because a newer poll response won the race.', { reason });
        return;
      }

      const payload = normalizeUnreadPayload(data);
      if (!payload) {
        console.warn('[NotificationContext] Inconsistent unread-count payload:', data);
        return;
      }

      if (payload.count > 0 && !payload.latest) {
        console.warn('[NotificationContext] count > 0 but latest notification payload is missing/invalid:', data);
      }

      if (markReadInFlightRef.current && !allowDuringMarkRead) {
        debugLog('Ignoring unread-count update while mark-read is still in flight.', { reason });
        return;
      }

      const now = Date.now();
      if (payload.count > 0 && staleGuardUntilRef.current > now && markReadCutoffRef.current != null) {
        const latestCreatedAtMs = payload.latest ? Date.parse(payload.latest.createdAt) : Number.NaN;
        if (!Number.isNaN(latestCreatedAtMs) && latestCreatedAtMs <= markReadCutoffRef.current) {
          debugLog('Ignoring stale unread-count immediately after mark-read.', {
            reason,
            count: payload.count,
            latestCreatedAt: payload.latest?.createdAt,
          });
          return;
        }
        if (!payload.latest) {
          debugLog('Ignoring unread count without latest payload during stale guard window.', {
            reason,
            count: payload.count,
          });
          return;
        }
      }

      if (payload.count === 0) {
        staleGuardUntilRef.current = 0;
        markReadCutoffRef.current = null;
      }

      if (!markReadInFlightRef.current && payload.count > prevCountRef.current && payload.latest) {
        setLatestNotif(payload.latest);
        setToastVisible(true);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setToastVisible(false), TOAST_AUTO_HIDE_MS);
      }

      prevCountRef.current = payload.count;
      setUnreadCount(payload.count);
      setLatestNotif(payload.count > 0 ? payload.latest : null);

      if (payload.count === 0) {
        setToastVisible(false);
      }

      debugLog('Unread-count poll applied.', {
        reason,
        count: payload.count,
        latestId: payload.latest?.id || null,
      });
    },
    [user?.email]
  );

  const pollAssignments = useCallback(async () => {
    if (!user?.email) return;

    const role = (user as any).role;
    if (role === 'teacher') return;

    const studentId = user.email;
    const storageKey = `assignmentSeenAt_v2_${user.email}`;

    try {
      let since = await AsyncStorage.getItem(storageKey);

      if (!since) {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        since = startOfToday.toISOString();
        await AsyncStorage.setItem(storageKey, since);
      }

      const params = new URLSearchParams({ studentId, since });
      const res = await fetch(`${SERVER_URL}/assignments/new-count?${params}`);

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        console.error('[NotificationContext] assignments new-count polling failed:', bodyText || res.status);
        return;
      }

      const data = await res.json();
      if (typeof data.count === 'number' && Number.isFinite(data.count) && data.count >= 0) {
        setUnreadAssignments(Math.floor(data.count));
      }
    } catch (err) {
      console.error('[NotificationContext] assignments new-count polling failed:', err);
    }
  }, [user?.email, (user as any)?.role]);

  const pollChallenges = useCallback(async () => {
    if (!user?.email) return;
    const role = (user as any).role;
    if (role === 'teacher') return;

    const studentId = user.email;
    const storageKey = `challengeSeenAt_v2_${user.email}`;

    try {
      const since = await AsyncStorage.getItem(storageKey);

      const params: Record<string, string> = { studentId };
      if (since) params.since = since;
      const res = await fetch(`${SERVER_URL}/challenges/new-count?${new URLSearchParams(params)}`);
      if (!res.ok) return;

      const data = await res.json();
      if (typeof data.count === 'number' && Number.isFinite(data.count) && data.count >= 0) {
        setUnreadChallenges(Math.floor(data.count));
      }
    } catch (err) {
      console.error('[NotificationContext] challenges new-count polling failed:', err);
    }
  }, [user?.email, (user as any)?.role]);

  useEffect(() => {
    if (!user?.email) {
      setUnreadCount(0);
      setUnreadAssignments(0);
      setUnreadChallenges(0);
      setLatestNotif(null);
      setToastVisible(false);
      prevCountRef.current = 0;
      staleGuardUntilRef.current = 0;
      markReadCutoffRef.current = null;
      return;
    }

    void poll({ reason: 'initial', allowDuringMarkRead: true });
    void pollAssignments();
    void pollChallenges();

    pollRef.current = setInterval(() => {
      void poll({ reason: 'interval' });
      void pollAssignments();
      void pollChallenges();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [user?.email, poll, pollAssignments, pollChallenges]);

  const dismissToast = () => setToastVisible(false);

  const clearUnread = useCallback(async () => {
    if (!user?.email) return;

    const markReadStartedAt = Date.now();
    markReadInFlightRef.current = true;
    staleGuardUntilRef.current = markReadStartedAt + STALE_COUNT_GUARD_MS;
    markReadCutoffRef.current = markReadStartedAt;

    setUnreadCount(0);
    setLatestNotif(null);
    setToastVisible(false);
    prevCountRef.current = 0;

    let markReadSucceeded = false;

    try {
      const res = await fetch(`${SERVER_URL}/messages/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: user.email }),
      });

      const bodyText = await res.text();
      let data: any = null;
      if (bodyText) {
        try {
          data = JSON.parse(bodyText);
        } catch {
          data = bodyText;
        }
      }

      if (!res.ok) {
        console.error(`[NotificationContext] mark-read request failed with ${res.status}:`, data);
      } else {
        markReadSucceeded = true;
        debugLog('mark-read completed.', {
          markedCount: typeof data?.markedCount === 'number' ? data.markedCount : undefined,
          unreadCount: typeof data?.unreadCount === 'number' ? data.unreadCount : undefined,
        });

        if (typeof data?.unreadCount === 'number' && Number.isFinite(data.unreadCount) && data.unreadCount >= 0) {
          const serverUnread = Math.floor(data.unreadCount);
          prevCountRef.current = serverUnread;
          setUnreadCount(serverUnread);
          if (serverUnread === 0) setLatestNotif(null);
        }
      }
    } catch (err) {
      console.error('[NotificationContext] Failed to call mark-read API:', err);
    } finally {
      markReadInFlightRef.current = false;
      if (!markReadSucceeded) {
        staleGuardUntilRef.current = 0;
        markReadCutoffRef.current = null;
      }
    }

    await poll({ reason: 'post-mark-read', allowDuringMarkRead: true });
  }, [poll, user?.email]);

  const clearUnreadAssignments = useCallback(async () => {
    if (!user?.email) return;
    const storageKey = `assignmentSeenAt_v2_${user.email}`;
    try {
      await AsyncStorage.setItem(storageKey, new Date().toISOString());
      setUnreadAssignments(0);
    } catch (err) {
      console.error('[NotificationContext] Failed to clear unread assignment count:', err);
    }
  }, [user?.email]);

  const clearUnreadChallenges = useCallback(async () => {
    if (!user?.email) return;
    const storageKey = `challengeSeenAt_v2_${user.email}`;
    try {
      await AsyncStorage.setItem(storageKey, new Date().toISOString());
      setUnreadChallenges(0);
    } catch (err) {
      console.error('[NotificationContext] Failed to clear unread challenge count:', err);
    }
  }, [user?.email]);

  const refresh = useCallback(async () => {
    if (!user?.email) return;
    await poll({ reason: 'manual-refresh', allowDuringMarkRead: true });
  }, [poll, user?.email]);

  return (
    <NotificationContext.Provider
      value={{
        unreadCount,
        unreadAssignments,
        unreadChallenges,
        latestNotif,
        toastVisible,
        dismissToast,
        clearUnread,
        clearUnreadAssignments,
        clearUnreadChallenges,
        refresh,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  return useContext(NotificationContext);
}
