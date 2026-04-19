import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, View, ActivityIndicator, Platform } from 'react-native';

// Set browser tab title
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.title = 'Aivorah';
}
import AppNavigator from './src/navigation/AppNavigator';
import TeacherNavigator from './src/navigation/TeacherNavigator';
import ParentNavigator from './src/navigation/ParentNavigator';
import LandingScreen from './src/screens/auth/LandingScreen';
import VerifyEmailScreen from './src/screens/auth/VerifyEmailScreen';
import OnboardingScreen from './src/screens/onboarding/OnboardingScreen';
import AdminPanelScreen from './src/screens/admin/AdminPanelScreen';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { StudentDataProvider } from './src/context/StudentDataContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { NotificationProvider } from './src/context/NotificationContext';
import { colors } from './src/theme';

function RootNavigator() {
  const { isAuthenticated, loading, user } = useAuth();
  const { colors: c } = useTheme();
  const isWebAdminPath =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    window.location.pathname.startsWith('/admin/panel');

  if (isWebAdminPath) {
    return <AdminPanelScreen />;
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
  // Role-based navigator
  if (user?.role === 'teacher') return <TeacherNavigator />;
  if (user?.role === 'parent') return <ParentNavigator />;

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
});
