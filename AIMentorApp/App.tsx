import React, { useEffect, useState, useRef, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';

// Shared ref so the web Back-guard can read the current route name.
const navigationRef = createNavigationContainerRef<any>();

// Role "home" screens. Back here = exit attempt → confirm. Back elsewhere =
// normal in-app navigation to the previous screen (no popup).
const HOME_ROUTES = new Set(['Dashboard', 'TeacherDashboard', 'ParentDashboard']);
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, View, ActivityIndicator, Platform, Text, TextInput, TouchableOpacity, Modal } from 'react-native';
import { useFonts } from 'expo-font';
import { Feather } from '@expo/vector-icons';
import { applyActionCode, onAuthStateChanged } from 'firebase/auth';

// Set browser tab title
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.title = 'Aivorah';
}

// ── Aivorah global font: Plus Jakarta Sans ──
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  // App font — same as landing page for brand consistency
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap';
  document.head.appendChild(fontLink);

  // Feather icon font — loaded via CSS so icons always render on web
  const iconStyle = document.createElement('style');
  iconStyle.textContent = `@font-face{font-family:'Feather';src:url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@14/build/vendor/react-native-vector-icons/Fonts/Feather.ttf') format('truetype');font-display:block;}`;
  document.head.appendChild(iconStyle);

  // Disable the browser's automatic scroll-anchoring. Screens refresh data on a
  // timer (15s) and a study-time heartbeat re-renders content above the fold;
  // scroll-anchoring reacts by nudging the page up while the user scrolls down.
  const scrollAnchorFix = document.createElement('style');
  scrollAnchorFix.textContent = `* { overflow-anchor: none !important; }`;
  document.head.appendChild(scrollAnchorFix);
}

// @ts-ignore
Text.defaultProps = { ...(Text.defaultProps ?? {}), style: [{ fontFamily: "Inter, system-ui, sans-serif" }, (Text.defaultProps as any)?.style] };
// @ts-ignore
TextInput.defaultProps = { ...(TextInput.defaultProps ?? {}), style: [{ fontFamily: "Inter, system-ui, sans-serif" }, (TextInput.defaultProps as any)?.style] };
import AppNavigator from './src/navigation/AppNavigator';
import { registerPushToken, configureForegroundHandler } from './src/services/pushNotifications';

// Configure how push notifications appear while the app is open (native only).
configureForegroundHandler();
import TeacherNavigator from './src/navigation/TeacherNavigator';
import SuperAdminNavigator from './src/navigation/SuperAdminNavigator';
import ParentNavigator from './src/navigation/ParentNavigator';
import LandingScreen from './src/screens/auth/LandingScreen';
import VerifyEmailScreen from './src/screens/auth/VerifyEmailScreen';
import ResetPasswordScreen from './src/screens/auth/ResetPasswordScreen';
import OnboardingScreen from './src/screens/onboarding/OnboardingScreen';
import OnboardingDemo from './src/screens/onboarding/OnboardingDemo';
import OnboardingStudentBoxes from './src/screens/onboarding/OnboardingStudentBoxes';
import OnboardingTeacherBoxes from './src/screens/onboarding/OnboardingTeacherBoxes';
import OnboardingParentBoxes from './src/screens/onboarding/OnboardingParentBoxes';
import SetPasswordScreen from './src/screens/onboarding/SetPasswordScreen';
import AdminPanelScreen from './src/screens/admin/AdminPanelScreen';
import { AuthProvider, useAuth, getPendingReturnRole } from './src/context/AuthContext';
import { StudentDataProvider } from './src/context/StudentDataContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { NotificationProvider } from './src/context/NotificationContext';
import NotificationBanner from './src/components/common/NotificationBanner';
import { colors } from './src/theme';
import { auth } from './src/config/firebase';
import { isStudentLocked, subscribeStudentLocked } from './src/services/lockStatus';
import { useNavigation } from '@react-navigation/native';

function VerifySuccessPage({ onComplete }: { onComplete: () => void }) {
  const { colors: c } = useTheme();
  const { updateUser } = useAuth();
  const [status, setStatus] = useState<'checking' | 'success' | 'error'>('checking');

  useEffect(() => {
    async function handle() {
      if (Platform.OS !== 'web' || typeof window === 'undefined') {
        updateUser({ emailVerified: true });
        onComplete();
        return;
      }
      const params = new URLSearchParams(window.location.search);

      if (params.get('verified') === '1') {
        setStatus('success');
        return;
      }

      if (params.get('error') === '1') {
        setStatus('error');
        return;
      }

      // Legacy Firebase email verification (oobCode)
      const mode = params.get('mode');
      const oobCode = params.get('oobCode');
      if (mode === 'verifyEmail' && oobCode) {
        try {
          await applyActionCode(auth, oobCode);
          setStatus('success');
        } catch {
          setStatus('error');
        }
        return;
      }

      setStatus('success');
    }
    handle();
  }, []);

  async function goToApp() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // The email link almost always opens in a BRAND-NEW tab (Gmail, Outlook etc.
      // open links in a new tab/window). On a cold page load, Firebase's auth SDK
      // restores the session from IndexedDB asynchronously — reading
      // auth.currentUser synchronously right here can catch it *before* that
      // restore finishes and see null even though the user IS logged in, sending
      // them to '/?signin=1' instead of onboarding (the reported "verify → bounces
      // to Sign In" bug). Wait for Firebase's own first onAuthStateChanged callback
      // (with a short timeout fallback) so we check the real, settled state.
      const settledUser = auth.currentUser ?? await new Promise<typeof auth.currentUser>((resolve) => {
        const timer = setTimeout(() => resolve(auth.currentUser), 2500);
        const unsub = onAuthStateChanged(auth, (u) => { clearTimeout(timer); unsub(); resolve(u); });
      });
      // If logged in here → go straight to the app (onboarding). If not → send them
      // to Landing with the login modal open so they can sign in and continue,
      // instead of dumping them on a dead-end Landing page.
      if (settledUser) {
        // This tab has a real, just-confirmed Firebase session (often a brand-new
        // tab opened from the emailed link, e.g. Gmail opens links in a new tab —
        // so it has no 'aivorah_auth_this_session' flag of its own). Without
        // setting it here, the very next render of RootNavigator at '/' sees a
        // logged-in user with onboardingComplete=false and no session flag, and
        // the stale-session guard (App.tsx) signs them straight back out — which
        // is exactly the reported "tap Continue → bounces to landing page" bug.
        try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('aivorah_auth_this_session', '1'); } catch {}
        window.location.replace('/');
      } else {
        window.location.replace('/?signin=1');
      }
    } else {
      updateUser({ emailVerified: true });
      onComplete();
    }
  }

  function handleContinue() {
    // Navigate THIS tab into the app. The account is now verified (active), so
    // loading the app root lands the user on onboarding. We deliberately do NOT
    // call window.close() here — closing the tab leaves the user with nothing
    // and never reaches onboarding, which was the reported bug.
    goToApp();
  }

  const isError = status === 'error';

  return (
    <View style={[styles.verifySuccessScreen, { backgroundColor: c.bgDark }]}>
      <View style={[styles.verifySuccessCard, { backgroundColor: c.cardDark, borderColor: c.borderColor }]}>
        <View style={[styles.verifySuccessIcon, { backgroundColor: (isError ? c.accentRed : c.accentGreen) + '20' }]}>
          <Feather name={isError ? 'alert-circle' : status === 'checking' ? 'loader' : 'check'} size={28} color={isError ? c.accentRed : c.accentGreen} />
        </View>
        <Text style={[styles.verifySuccessTitle, { color: c.textMain }]}>
          {status === 'checking' ? 'Verifying...' : isError ? 'Link expired or already used' : 'Email Verified!'}
        </Text>
        <Text style={[styles.verifySuccessText, { color: c.textMuted }]}>
          {status === 'checking'
            ? 'Please wait...'
            : isError
              ? 'This link may have already been used or expired. Go back to the app and click "Resend Email" to get a new one.'
              : 'Your email has been verified. Tap Continue to proceed.'}
        </Text>
        {status === 'success' && (
          <TouchableOpacity
            style={[styles.verifySuccessButton, { backgroundColor: c.primary }]}
            onPress={handleContinue}
            activeOpacity={0.85}
          >
            <Text style={styles.verifySuccessButtonText}>Continue</Text>
          </TouchableOpacity>
        )}
        {isError && (
          <TouchableOpacity
            style={[styles.verifySuccessButton, { backgroundColor: c.primary }]}
            onPress={goToApp}
            activeOpacity={0.85}
          >
            <Text style={styles.verifySuccessButtonText}>Back to App</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function NotificationBannerWrapper() {
  const { isAuthenticated, user } = useAuth();
  const navigation = useNavigation<any>();

  // Only show notifications when user is fully logged in and past onboarding
  const isDemoOrTest = user?.email?.endsWith('@demo.com') || user?.email?.endsWith('@test.ai');
  const isReady = isAuthenticated &&
    (isDemoOrTest || (user?.onboardingComplete === true && user?.emailVerified !== false)) &&
    !user?.mustChangePassword;

  if (!isReady) return null;

  function handleNavigate(screen: string, params?: Record<string, any>) {
    try {
      navigation.navigate(screen, params);
    } catch {
      // Screen might be in a nested navigator — try navigate with nesting
      try { navigation.navigate('Assignments'); } catch {}
    }
  }

  return <NotificationBanner onNavigate={handleNavigate} />;
}

const IDLE_WARN_MS   = 25 * 60 * 1000; // 25 min idle → show warning
const IDLE_LOGOUT_MS = 2 * 60 * 1000;  // 2 min after warning → auto-logout
const IDLE_WARN_MIN  = Math.round(IDLE_WARN_MS / 60000); // for display copy

const IDLE_LS_KEY = 'aivorah_idleWarnEndsAt'; // epoch ms when the 2-min countdown ends

function IdleTimeoutGuard({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { colors: c } = useTheme();

  // Restore inactivity warning across page refresh
  const restoredIdleSecs = (() => {
    try {
      const endsAt = parseInt(localStorage.getItem(IDLE_LS_KEY) ?? '0', 10);
      if (!endsAt) return 0;
      const secs = Math.round((endsAt - Date.now()) / 1000);
      return secs > 0 ? secs : 0;
    } catch { return 0; }
  })();

  const [showWarning, setShowWarning] = useState(restoredIdleSecs > 0);
  const [countdown, setCountdown] = useState(restoredIdleSecs > 0 ? restoredIdleSecs : Math.round(IDLE_LOGOUT_MS / 1000));
  // A parental-control lock screen (ScreenLayout) takes over the screen — the
  // idle-logout "Are you still there?" popup makes no sense stacked on top of it.
  const [studentLocked, setStudentLockedState] = useState(isStudentLocked());

  // Use refs so event handlers never go stale
  const lastActivityRef = useRef(Date.now());
  const showWarningRef  = useRef(restoredIdleSecs > 0);
  const userRef         = useRef(user);
  const logoutRef       = useRef(logout);
  const tickerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { logoutRef.current = logout; }, [logout]);
  useEffect(() => subscribeStudentLocked(setStudentLockedState), []);

  // If warning was persisted before refresh, resume the countdown from remaining secs
  useEffect(() => {
    if (!restoredIdleSecs) return;
    let secs = restoredIdleSecs;
    countdownRef.current = setInterval(() => {
      secs -= 1;
      setCountdown(secs);
      if (secs <= 0) {
        clearInterval(countdownRef.current!);
        doLogout();
      }
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only arm the idle-logout once the student is actually inside the app.
  // During onboarding / email-verification / set-password the user is reading,
  // typing and pausing to think — an idle timer there is pure disturbance and
  // pointless (they haven't finished setup yet). Mirror RootNavigator's gate:
  // in-app == verified + onboarding complete + no pending password change.
  const isStudent = user?.role === 'student';
  const inApp =
    isStudent &&
    user?.emailVerified !== false &&
    user?.onboardingComplete === true &&
    user?.mustChangePassword !== true;

  const doLogout = useCallback(() => {
    if (tickerRef.current)    clearInterval(tickerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    try { localStorage.removeItem(IDLE_LS_KEY); } catch {}
    showWarningRef.current = false;
    setShowWarning(false);
    // Notify parent (fire and forget)
    const u = userRef.current;
    if (u?.email) {
      fetch(`${require('./src/config/serverUrl').default}/student/idle-logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentEmail: u.email, studentName: u.name }),
      }).catch(() => {});
    }
    logoutRef.current();
  }, []);

  const onStillHere = () => {
    try { localStorage.removeItem(IDLE_LS_KEY); } catch {}
    showWarningRef.current = false;
    setShowWarning(false);
    if (countdownRef.current) clearInterval(countdownRef.current);
    lastActivityRef.current = Date.now(); // reset idle clock
  };

  useEffect(() => {
    if (!inApp) return;

    // Single interval polls every second — no timer-reset-on-activity races
    lastActivityRef.current = Date.now(); // start fresh when entering the app
    tickerRef.current = setInterval(() => {
      const idle = Date.now() - lastActivityRef.current;

      if (!showWarningRef.current && idle >= IDLE_WARN_MS) {
        // Show warning + start countdown; persist so refresh restores it
        showWarningRef.current = true;
        try { localStorage.setItem(IDLE_LS_KEY, String(Date.now() + IDLE_LOGOUT_MS)); } catch {}
        setShowWarning(true);
        setCountdown(Math.round(IDLE_LOGOUT_MS / 1000));

        let secs = Math.round(IDLE_LOGOUT_MS / 1000);
        countdownRef.current = setInterval(() => {
          secs -= 1;
          setCountdown(secs);
          if (secs <= 0) {
            clearInterval(countdownRef.current!);
            doLogout();
          }
        }, 1000);
      }
    }, 1000);

    // Reset activity timestamp on any user interaction
    const resetActivity = () => {
      if (!showWarningRef.current) lastActivityRef.current = Date.now();
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      events.forEach(e => window.addEventListener(e, resetActivity, { passive: true }));
    }

    return () => {
      if (tickerRef.current)    clearInterval(tickerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      // Clear any visible warning when leaving the app (e.g. logout/onboarding)
      showWarningRef.current = false;
      setShowWarning(false);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        events.forEach(e => window.removeEventListener(e, resetActivity));
      }
    };
  }, [inApp, doLogout]);

  return (
    <>
      {children}
      {showWarning && !studentLocked && (
        <Modal transparent animationType="fade" visible>
          <View style={idleStyles.overlay}>
            <View style={[idleStyles.box, { backgroundColor: c.cardDark, borderColor: c.borderColor }]}>
              <View style={[idleStyles.iconWrap, { backgroundColor: c.accentYellow + '22' }]}>
                <Feather name="clock" size={26} color={c.accentYellow} />
              </View>
              <Text style={[idleStyles.title, { color: c.textMain }]}>Are you still there?</Text>
              <Text style={[idleStyles.body, { color: c.textMuted }]}>
                You've been inactive for {IDLE_WARN_MIN} minutes.{'\n'}
                Logging out in <Text style={{ color: c.accentRed, fontWeight: '700' }}>{countdown}s</Text>...
              </Text>
              <TouchableOpacity style={[idleStyles.btn, { backgroundColor: c.primary }]} onPress={onStillHere} activeOpacity={0.85}>
                <Text style={idleStyles.btnText}>Yes, I'm here!</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[idleStyles.logoutBtn, { borderColor: c.borderColor }]} onPress={doLogout} activeOpacity={0.7}>
                <Text style={[idleStyles.logoutBtnText, { color: c.textMuted }]}>Logout now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const idleStyles = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  box:       { width: 340, maxWidth: '95%', borderRadius: 20, padding: 28, alignItems: 'center', borderWidth: 1 },
  iconWrap:  { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title:     { fontSize: 20, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  body:      { fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  btn:       { width: '100%', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 10 },
  btnText:   { color: '#fff', fontWeight: '700', fontSize: 15 },
  logoutBtn: { width: '100%', paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
  logoutBtnText: { fontSize: 14 },
});

// ─────────────────────────────────────────────────────────
// Web back-button guard
// The app navigates via the sidebar, so the browser Back button is an
// "exit" gesture. Left unhandled it dumps a logged-in user out to a broken
// state. Instead: while authenticated (dashboard, onboarding, etc.), trap
// Back and ask for confirmation — Yes → sign out to the Landing page.
// ─────────────────────────────────────────────────────────
function WebBackGuard({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { colors: c, isDark } = useTheme();
  // Aivorah brand palette for the exit dialog, themed: dark mode = landing's
  // near-black + gold; light mode = warm cream + the same gold accents.
  const dlg = isDark ? {
    box: '#141414', line: 'rgba(245,243,238,0.14)',
    title: '#F5F3EE', body: '#A9B0AC',
    stayLine: 'rgba(245,243,238,0.2)', stayText: '#A9B0AC',
    iconBg: 'rgba(186,164,103,0.16)', iconLine: 'rgba(186,164,103,0.35)',
  } : {
    box: '#FAF7F0', line: 'rgba(28,26,18,0.12)',
    title: '#1C1A12', body: '#6B7069',
    stayLine: 'rgba(28,26,18,0.18)', stayText: '#6B7069',
    iconBg: 'rgba(186,164,103,0.14)', iconLine: 'rgba(186,164,103,0.4)',
  };
  const [showConfirm, setShowConfirm] = useState(false);
  const isHomeRef = useRef(false);      // is the CURRENT route a role-home screen?
  const lastNavTsRef = useRef(0);       // when did the route last CHANGE (not just re-emit)?
  const lastRouteNameRef = useRef<string | undefined>(undefined);
  const active =
    Platform.OS === 'web' &&
    !!user &&
    user.emailVerified !== false &&
    user.mustChangePassword !== true &&
    // The onboarding screens (OnboardingTeacherBoxes/ParentBoxes/StudentBoxes) have
    // their own richer "Return to home page?" confirm (with Save & Exit) and already
    // trap the browser Back button themselves. Without this exclusion, BOTH guards
    // fired on the same Back press and stacked two modals on top of each other.
    user.onboardingComplete !== false;

  // Track current-route home-ness + the timestamp of the last navigation.
  // The nav container is often NOT ready yet when this mounts (restored session
  // lands straight on Dashboard) — if we only attached the listener when ready,
  // it would never attach and Back on Dashboard would silently do nothing.
  // Retry until the container is ready.
  useEffect(() => {
    if (!active) return;
    const update = () => {
      const name = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
      isHomeRef.current = !!name && HOME_ROUTES.has(name);
      // Only count it as a "navigation" when the ROUTE actually changed — RN also
      // emits state events for same-route pops (e.g. Back pressed while idle on
      // Dashboard), and those must NOT look like navigation or the exit confirm
      // would never fire.
      if (name && name !== lastRouteNameRef.current) {
        lastRouteNameRef.current = name;
        lastNavTsRef.current = Date.now();
      }
    };
    let unsub: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attach = () => {
      if (navigationRef.isReady()) {
        update();
        unsub = navigationRef.addListener('state', update);
      } else {
        timer = setTimeout(attach, 250);
      }
    };
    attach();
    return () => { if (unsub) unsub(); if (timer) clearTimeout(timer); };
  }, [active]);

  // ── Back-button handling (mobile-style "exit from home" confirm) ────────────
  // Only show the exit confirm when Back is pressed WHILE SITTING ON the home
  // screen. Two race-proof checks decide this:
  //   1. If a navigation happened in the last ~250ms, this Back just landed us
  //      on a screen (e.g. AI Coach → Back → Dashboard) → it's normal back, no
  //      popup. (This catches the "arrived at dashboard" case regardless of
  //      whether RN's popstate handler runs before or after ours.)
  //   2. If we're not on a home route → deep screen → let RN go back, no popup.
  // Otherwise (on home, no recent navigation) → real exit attempt → confirm.
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    window.history.pushState({ __aivorahGuard: true }, '');
    const onPop = () => {
      // Decide AFTER React Navigation has processed this pop — listener order
      // between RN's popstate handler and ours is not guaranteed, which made
      // the old timing check unreliable (Back on Dashboard silently no-op'd).
      const popAt = Date.now();
      setTimeout(() => {
        // If RN navigated as part of THIS pop, it was a real back between
        // screens (e.g. Profile → Dashboard) → no popup. RN's state event can
        // fire just BEFORE or just AFTER our handler depending on listener
        // order, so treat any nav within ±400ms of the pop as "this pop
        // navigated" — the popup then only appears on the NEXT idle Back.
        if (Math.abs(popAt - lastNavTsRef.current) < 400) return;
        const name = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
        // No route name = a STANDALONE screen outside the navigator (e.g. the
        // Onboarding setup page). Back there is always an exit attempt → confirm,
        // same as on the Dashboard.
        const onHome = name ? HOME_ROUTES.has(name) : true;
        if (!onHome) return;                                   // deep screen → let RN handle back
        window.history.pushState({ __aivorahGuard: true }, ''); // on home, idle → confirm exit
        setShowConfirm(true);
      }, 120);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [active]);

  return (
    <>
      {children}
      {showConfirm && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setShowConfirm(false)}>
          <View style={idleStyles.overlay}>
            {/* Aivorah brand look, theme-aware: near-black+gold in dark, warm cream+gold in light */}
            <View style={[idleStyles.box, { backgroundColor: dlg.box, borderColor: dlg.line, borderWidth: 1 }]}>
              <View style={[idleStyles.iconWrap, { backgroundColor: dlg.iconBg, borderWidth: 1, borderColor: dlg.iconLine }]}>
                <Feather name="log-out" size={24} color="#BAA467" />
              </View>
              <Text style={[idleStyles.title, {
                color: dlg.title,
                fontFamily: Platform.OS === 'web' ? '"Fraunces", Georgia, serif' : 'Georgia',
                fontWeight: '600',
              }]}>Return to the home page?</Text>
              <Text style={[idleStyles.body, { color: dlg.body }]}>
                You'll be signed out and taken back to the Aivorah home page.
              </Text>
              <TouchableOpacity
                style={[idleStyles.btn, { backgroundColor: '#BAA467' }]}
                activeOpacity={0.85}
                onPress={() => { setShowConfirm(false); logout(); }}
              >
                <Text style={[idleStyles.btnText, { color: '#141414' }]}>Yes, go to home page</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[idleStyles.logoutBtn, { borderColor: dlg.stayLine }]}
                activeOpacity={0.7}
                onPress={() => setShowConfirm(false)}
              >
                <Text style={[idleStyles.logoutBtnText, { color: dlg.stayText }]}>Stay here</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

function RootNavigator() {
  const { isAuthenticated, loading, user, logout } = useAuth();
  const { colors: c } = useTheme();
  const [verifyDone, setVerifyDone] = useState(false);

  // ── Stale half-registered session guard (founder-reported routing bug) ──
  // Someone who started a signup, closed the browser, and comes back days later
  // must land on the LANDING PAGE — not be trapped in the setup/verify screens.
  // sessionStorage 'aivorah_auth_this_session' is set only by an explicit
  // login/signup in this tab (survives F5, dies with the tab), so a genuine
  // signup flow still moves into onboarding normally.
  //
  // CRITICAL EXCLUSION: /verify-success is opened by clicking the emailed
  // verification LINK — almost always in a brand-new tab, which shares the
  // same Firebase auth session (via IndexedDB) but has no sessionStorage flag
  // of its own. Without excluding this path, that fresh tab looks "stale" and
  // calls logout() below — and because Firebase auth state syncs across tabs,
  // that sign-out also kills the session in the ORIGINAL tab the user is
  // still using, bouncing a genuine new signup back to the landing page and
  // making a real second sign-in attempt look like it "auto signs out."
  // Same reasoning applies to /reset-password (opened from an emailed link).
  const isSpecialAuthLinkPath =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    (window.location.pathname.startsWith('/verify-success') || window.location.pathname.startsWith('/reset-password'));
  // The sessionStorage flag alone is too fragile as the sole signal: mobile Safari
  // (and some other browsers under memory pressure) can silently evict and reload
  // a backgrounded tab — the URL/UI look unchanged but sessionStorage is wiped,
  // even after switching apps for a few seconds. That was making a genuinely
  // active onboarding session (someone mid-fill, briefly backgrounded) look
  // "stale" and bounce to Landing within a minute, instead of only after real,
  // sustained inactivity. Layer in a persisted (localStorage, survives tab
  // reload) last-active timestamp with a real time threshold — refreshed by the
  // heartbeat below — so "stale" means genuinely abandoned for a while, not just
  // "this particular tab instance got recycled."
  const ONBOARDING_STALE_MS = 20 * 60 * 1000; // 20 min of real inactivity
  const lastActiveTs = (Platform.OS === 'web' && typeof localStorage !== 'undefined')
    ? Number(localStorage.getItem('aivorah_last_active_ts') || 0)
    : 0;
  const genuinelyStale = lastActiveTs === 0 || (Date.now() - lastActiveTs) > ONBOARDING_STALE_MS;
  const staleIncompleteSession =
    Platform.OS === 'web' &&
    !loading && isAuthenticated &&
    user?.onboardingComplete === false &&
    !(user?.email?.endsWith('@demo.com') || user?.email?.endsWith('@test.ai')) &&
    !isSpecialAuthLinkPath &&
    (typeof sessionStorage === 'undefined' || sessionStorage.getItem('aivorah_auth_this_session') !== '1') &&
    genuinelyStale;

  // Heartbeat: while a real onboarding session is active in this tab, keep
  // refreshing the last-active timestamp so time-based staleness only counts
  // real, sustained absence — not a brief backgrounding or a page reload.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return;
    if (!(!loading && isAuthenticated && user?.onboardingComplete === false)) return;
    const touch = () => { try { localStorage.setItem('aivorah_last_active_ts', String(Date.now())); } catch {} };
    touch();
    const interval = setInterval(touch, 30 * 1000);
    return () => clearInterval(interval);
  }, [loading, isAuthenticated, user?.onboardingComplete]);

  useEffect(() => {
    if (staleIncompleteSession) {
      console.log('[Auth] Stale half-registered session — signing out, showing LandingScreen');
      logout();
    }
  }, [staleIncompleteSession]);

  // Mobile push notifications — register this device for the logged-in user.
  // No-op on web. (Teacher/parent get alerts for new assignments, messages, etc.)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (isAuthenticated && user?.email) {
      registerPushToken(user.email);
    }
  }, [isAuthenticated, user?.email]);

  const isWebAdminPath =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    window.location.pathname.startsWith('/admin/panel');
  const isVerifySuccessPath =
    !verifyDone &&
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    window.location.pathname.startsWith('/verify-success');

  const isResetPasswordPath =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    window.location.pathname.startsWith('/reset-password');

  if (isWebAdminPath) return <AdminPanelScreen />;
  if (isVerifySuccessPath) return <VerifySuccessPage onComplete={() => setVerifyDone(true)} />;
  if (isResetPasswordPath) return <ResetPasswordScreen />;

  // Demo mode — access via ?demo=onboarding-student, ?demo=onboarding-teacher,
  // or ?demo=onboarding-parent to preview the new "boxes" onboarding screens
  // without a real account.
  if (Platform.OS === 'web' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === 'onboarding-student') {
    return <OnboardingStudentBoxes />;
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === 'onboarding-teacher') {
    return <OnboardingTeacherBoxes />;
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === 'onboarding-parent') {
    return <OnboardingParentBoxes />;
  }

  if (loading) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: c.bgDark }]}>
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  if (!isAuthenticated) {
    console.log('[Auth] Not authenticated, showing LandingScreen');
    // Reset URL to root so browser doesn't show /leaderboard, /dashboard etc.
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
    return <LandingScreen />;
  }

  // Stale half-registered session: show the landing page immediately while the
  // useEffect above signs the account out in the background.
  if (staleIncompleteSession) {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
    return <LandingScreen />;
  }

  // Show email verification screen for real (non-demo) accounts
  // that haven't verified yet. Google SSO users will have emailVerified: true from Firebase.
  const isDemoOrTest = user?.email?.endsWith('@demo.com') || user?.email?.endsWith('@test.ai');
  const needsEmailVerification =
    !isDemoOrTest &&
    user?.emailVerified === false;

  console.log('[Auth] User State:', { 
    email: user?.email, 
    role: user?.role, 
    emailVerified: user?.emailVerified, 
    onboardingComplete: user?.onboardingComplete,
    isDemoOrTest 
  });

  // Demo mode — access via ?demo=onboarding in URL
  if (Platform.OS === 'web' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === 'onboarding') {
    return <OnboardingDemo />;
  }

  if (needsEmailVerification) {
    console.log('[Auth] Verification required, showing VerifyEmailScreen');
    return <VerifyEmailScreen />;
  }

  // Onboarding gate — skip for demo/test accounts
  if (!isDemoOrTest && user?.onboardingComplete !== true) {
    console.log('[Auth] Onboarding incomplete, showing OnboardingScreen');
    return <OnboardingScreen />;
  }

  // First-time password setup — auto-generated student accounts must set their own password
  if (user?.mustChangePassword) {
    return <SetPasswordScreen />;
  }

  console.log(`[Auth] Routing to ${user?.role} navigator`);
  // Role-based navigator — if pendingReturnRole is set, honour it (teacher finishing parent onboarding)
  const activeRole = getPendingReturnRole() || user?.role;
  if (activeRole === 'super_admin') return <SuperAdminNavigator key="super_admin" />;
  if (activeRole === 'teacher') return <TeacherNavigator key="teacher" />;
  if (activeRole === 'parent')  return <ParentNavigator key="parent" />;

  return <AppNavigator key="student" />;
}

// Inner component so useTheme() can be called inside ThemeProvider
function ThemedRoot() {
  const { colors: c, isDark } = useTheme();

  // Load the landing design fonts app-wide (web) so headings can use the serif.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (document.getElementById('aivorah-app-fonts')) return;
    const link = document.createElement('link');
    link.id = 'aivorah-app-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Inter:wght@300;400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: c.bgDark }]}>
      <AuthProvider>
        <StudentDataProvider>
          <NotificationProvider>
            <NavigationContainer
              ref={navigationRef}
              documentTitle={{ formatter: () => 'Aivorah' }}
              linking={{
                prefixes: [],
                config: {
                  screens: {
                    // Student screens
                    Dashboard: 'dashboard',
                    Profile: 'profile',
                    LearningPaths: 'learning-paths',
                    AICoach: 'ai-coach',
                    Schedule: 'schedule',
                    Assignments: 'assignments',
                    Challenges: 'challenges',
                    Leaderboard: 'leaderboard',
                    Progress: 'progress',
                    Rewards: 'rewards',
                    HelpCenter: 'help',
                    Settings: 'settings',
                    VideoLesson: 'video-lesson',
                    VideoPlayer: 'video-player',
                    NCERTChapters: 'ncert-chapters',
                    SubjectTopics: 'subject-topics',
                    Learn5E: 'learn',
                    MathHelper: 'math-helper',
                    AIStoryteller: 'ai-storyteller',
                    DrawingBuddy: 'drawing-buddy',
                    WordWizard: 'word-wizard',
                    IBPYPQuiz: 'quiz',
                    WorldAndYou: 'world-and-you',
                    TopicLesson: 'topic-lesson',
                    BhagavathaStories: 'stories',
                    StoryReader: 'story-reader',
                    DailyHabits: 'daily-habits',
                    Subscription: 'subscription',
                    // Teacher screens
                    TeacherDashboard: 'teacher/dashboard',
                    TeacherStudents: 'teacher/students',
                    TeacherAssignments: 'teacher/assignments',
                    TeacherChallenges: 'teacher/challenges',
                    TeacherSchedule: 'teacher/schedule',
                    TeacherProgress: 'teacher/progress',
                    TeacherLearningPaths: 'teacher/learning-paths',
                    TeacherAchievements: 'teacher/achievements',
                    TeacherVideoLibrary: 'teacher/videos',
                    TeacherHelp: 'teacher/help',
                    TeacherSettings: 'teacher/settings',
                    TeacherMessages: 'teacher/messages',
                    ChallengeManager: 'super-admin/challenges',
                    SuperAdminStudents: 'super-admin/students',
                    ProjectDetails: 'teacher/project-details',
                    // Parent screens
                    ParentStudentView: 'parent/student-view',
                    ParentDashboard: 'parent/dashboard',
                    ParentProfile: 'parent/profile',
                    ParentMyKids: 'parent/my-kids',
                    ParentSchedule: 'parent/schedule',
                    ParentLearning: 'parent/learning',
                    ParentAssignments: 'parent/assignments',
                    ParentChallenges: 'parent/challenges',
                    ParentLeaderboard: 'parent/leaderboard',
                    ParentProgress: 'parent/progress',
                    ParentControls: 'parent/controls',
                    ParentSettings: 'parent/settings',
                    ParentHelp: 'parent/help',
                    ParentMessages: 'parent/messages',
                    ParentDailyTasks: 'parent/daily-tasks',
                  },
                },
              }}
            >
              <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={c.bgDark} />
              <IdleTimeoutGuard>
                <WebBackGuard>
                  <RootNavigator />
                </WebBackGuard>
                <NotificationBannerWrapper />
              </IdleTimeoutGuard>
            </NavigationContainer>
          </NotificationProvider>
        </StudentDataProvider>
      </AuthProvider>
    </View>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    ...Feather.font,
  });

  // Proceed even if fonts fail — don't block the whole app on a font decode error
  if (!fontsLoaded && !fontError) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: colors.bgDark }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider>
        <ThemedRoot />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingScreen: {
    flex: 1,
    backgroundColor: colors.bgDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifySuccessScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  verifySuccessCard: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: 18,
    padding: 28,
    alignItems: 'center',
  },
  verifySuccessIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  verifySuccessTitle: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  verifySuccessText: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
  },
  verifySuccessButton: {
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 18,
    minWidth: 180,
    alignItems: 'center',
  },
  verifySuccessButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});
