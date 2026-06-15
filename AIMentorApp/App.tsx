import React, { useEffect, useState, useRef, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, View, ActivityIndicator, Platform, Text, TouchableOpacity, Modal } from 'react-native';
import { useFonts } from 'expo-font';
import { Feather } from '@expo/vector-icons';
import { applyActionCode } from 'firebase/auth';

// Set browser tab title
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.title = 'Aivorah';
}
import AppNavigator from './src/navigation/AppNavigator';
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

  function goToApp() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.replace('/');
    } else {
      updateUser({ emailVerified: true });
      onComplete();
    }
  }

  function handleContinue() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // The original signup tab is already polling and will advance to onboarding
      // on its own within ~2s. A user-gesture-triggered window.close() has a much
      // better chance of working than one fired from a timer; if the browser still
      // blocks it, fall back to navigating this tab into the app instead.
      window.close();
      setTimeout(goToApp, 400);
    } else {
      goToApp();
    }
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

const IDLE_WARN_MS   = 15 * 60 * 1000; // 15 min idle → show warning
const IDLE_LOGOUT_MS = 2 * 60 * 1000;  // 2 min after warning → auto-logout
const IDLE_WARN_MIN  = Math.round(IDLE_WARN_MS / 60000); // for display copy

function IdleTimeoutGuard({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { colors: c } = useTheme();
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(60);

  // Use refs so event handlers never go stale
  const lastActivityRef = useRef(Date.now());
  const showWarningRef  = useRef(false);
  const userRef         = useRef(user);
  const logoutRef       = useRef(logout);
  const tickerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { logoutRef.current = logout; }, [logout]);

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
        // Show warning + start countdown
        showWarningRef.current = true;
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
      {showWarning && (
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

function RootNavigator() {
  const { isAuthenticated, loading, user } = useAuth();
  const { colors: c } = useTheme();
  const [verifyDone, setVerifyDone] = useState(false);

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
  if (activeRole === 'super_admin') return <SuperAdminNavigator />;
  if (activeRole === 'teacher') return <TeacherNavigator />;
  if (activeRole === 'parent')  return <ParentNavigator />;

  return <AppNavigator />;
}

// Inner component so useTheme() can be called inside ThemeProvider
function ThemedRoot() {
  const { colors: c, isDark } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: c.bgDark }]}>
      <AuthProvider>
        <StudentDataProvider>
          <NotificationProvider>
            <NavigationContainer
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
                <RootNavigator />
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
