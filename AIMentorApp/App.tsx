import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, View, ActivityIndicator, Platform, Text, TouchableOpacity } from 'react-native';
import { useFonts } from 'expo-font';
import { Feather } from '@expo/vector-icons';
import { applyActionCode } from 'firebase/auth';

// Set browser tab title
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.title = 'Aivorah';
}
import AppNavigator from './src/navigation/AppNavigator';
import TeacherNavigator from './src/navigation/TeacherNavigator';
import ParentNavigator from './src/navigation/ParentNavigator';
import LandingScreen from './src/screens/auth/LandingScreen';
import VerifyEmailScreen from './src/screens/auth/VerifyEmailScreen';
import ResetPasswordScreen from './src/screens/auth/ResetPasswordScreen';
import OnboardingScreen from './src/screens/onboarding/OnboardingScreen';
import AdminPanelScreen from './src/screens/admin/AdminPanelScreen';
import { AuthProvider, useAuth, getPendingReturnRole } from './src/context/AuthContext';
import { StudentDataProvider } from './src/context/StudentDataContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { NotificationProvider } from './src/context/NotificationContext';
import { colors } from './src/theme';
import { auth } from './src/config/firebase';

function VerifySuccessPage({ onComplete }: { onComplete: () => void }) {
  const { colors: c } = useTheme();
  const [status, setStatus] = useState<'checking' | 'success' | 'error'>('checking');

  useEffect(() => {
    async function handle() {
      if (Platform.OS !== 'web' || typeof window === 'undefined') {
        navigateToApp();
        return;
      }
      const params = new URLSearchParams(window.location.search);

      if (params.get('verified') === '1') {
        setStatus('success');
        setTimeout(navigateToApp, 2500);
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
          setTimeout(navigateToApp, 2500);
        } catch {
          setStatus('error');
        }
        return;
      }

      setStatus('success');
      setTimeout(navigateToApp, 2500);
    }
    handle();
  }, []);

  function navigateToApp() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.replace('/');
    } else {
      onComplete();
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
              : 'Your account is active. Taking you to the app...'}
        </Text>
        <TouchableOpacity
          style={[styles.verifySuccessButton, { backgroundColor: isError ? c.primary : c.accentGreen }]}
          onPress={navigateToApp}
          activeOpacity={0.85}
        >
          <Text style={styles.verifySuccessButtonText}>
            {isError ? 'Back to App' : 'Continue'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

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

  if (loading) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: c.bgDark }]}>
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  if (!isAuthenticated) {
    console.log('[Auth] Not authenticated, showing LandingScreen');
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

  if (needsEmailVerification) {
    console.log('[Auth] Verification required, showing VerifyEmailScreen');
    return <VerifyEmailScreen />;
  }

  // Onboarding gate — skip for demo/test accounts
  if (!isDemoOrTest && user?.onboardingComplete !== true) {
    console.log('[Auth] Onboarding incomplete, showing OnboardingScreen');
    return <OnboardingScreen />;
  }

  console.log(`[Auth] Routing to ${user?.role} navigator`);
  // Role-based navigator — if pendingReturnRole is set, honour it (teacher finishing parent onboarding)
  const activeRole = getPendingReturnRole() || user?.role;
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
            <NavigationContainer documentTitle={{ formatter: () => 'Aivorah' }}>
              <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={c.bgDark} />
              <RootNavigator />
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
