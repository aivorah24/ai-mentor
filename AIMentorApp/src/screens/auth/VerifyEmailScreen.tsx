import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { sendEmailVerification } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';

// ─── Envelope SVG illustration ───────────────────────────────────────────────
function EnvelopeIllustration({ color, accent }: { color: string; accent: string }) {
  return (
    <Svg width={96} height={80} viewBox="0 0 96 80">
      {/* Envelope body */}
      <Rect x="4" y="20" width="88" height="56" rx="6" fill={color} />
      {/* Envelope flap (open) */}
      <Path d="M4 20 L48 52 L92 20" stroke={accent} strokeWidth="2.5" fill="none" strokeLinejoin="round" />
      {/* Left fold line */}
      <Path d="M4 76 L36 46" stroke={accent} strokeWidth="1.5" strokeOpacity={0.45} />
      {/* Right fold line */}
      <Path d="M92 76 L60 46" stroke={accent} strokeWidth="1.5" strokeOpacity={0.45} />
      {/* Notification dot */}
      <Circle cx="76" cy="20" r="12" fill="#ef4444" />
      <Path d="M76 13 L76 21 M76 24 L76 25" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
    </Svg>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function VerifyEmailScreen() {
  const { user, updateUser, logout } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [cooldown, setCooldown] = useState(0);
  const [verifyError, setVerifyError] = useState('');
  const [resendSuccess, setResendSuccess] = useState(false);
  const [checking, setChecking] = useState(false);

  // Pulsing animation
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleResend() {
    if (cooldown > 0 || !auth.currentUser) return;
    try {
      await sendEmailVerification(auth.currentUser);
      setCooldown(30);
      setResendSuccess(true);
      setTimeout(() => setResendSuccess(false), 4000);
    } catch (err: any) {
      setVerifyError(err.message || 'Failed to resend. Try again.');
    }
  }

  async function handleVerified() {
    if (!auth.currentUser) return;
    setChecking(true);
    setVerifyError('');
    try {
      await auth.currentUser.reload();
      if (auth.currentUser.emailVerified) {
        updateUser({ emailVerified: true });
        // Navigation handled by RootNavigator watching emailVerified
      } else {
        setVerifyError('Email not yet verified. Please check your inbox and click the link.');
      }
    } catch (err: any) {
      setVerifyError(err.message || 'Something went wrong.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        {/* Illustration */}
        <Animated.View style={[styles.illustrationWrap, { transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.illustrationBg}>
            <EnvelopeIllustration color={colors.cardHover} accent={colors.primary} />
          </View>
        </Animated.View>

        {/* Title */}
        <Text style={styles.title}>Check your inbox</Text>
        <Text style={styles.sub}>
          We sent a verification link to
        </Text>
        <View style={styles.emailPill}>
          <Feather name="mail" size={13} color={colors.primary} style={{ marginRight: 6 }} />
          <Text style={styles.emailText}>{user?.email || 'your email'}</Text>
        </View>
        <Text style={styles.hint}>
          Open the email and click the link to verify your account, then come back here.
        </Text>

        {/* Error or success */}
        {verifyError !== '' && (
          <View style={styles.errorBox}>
            <Feather name="alert-circle" size={14} color={colors.accentRed} style={{ marginRight: 6 }} />
            <Text style={styles.errorText}>{verifyError}</Text>
          </View>
        )}
        {resendSuccess && (
          <View style={styles.successBox}>
            <Feather name="check-circle" size={14} color={colors.accentGreen} style={{ marginRight: 6 }} />
            <Text style={styles.successText}>Verification email sent!</Text>
          </View>
        )}

        {/* I've Verified */}
        <TouchableOpacity
          style={[styles.primaryBtn, checking && styles.btnDisabled]}
          onPress={handleVerified}
          activeOpacity={0.85}
          disabled={checking}
        >
          <Feather name="check" size={16} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.primaryBtnText}>
            {checking ? 'Checking...' : "I've Verified My Email"}
          </Text>
        </TouchableOpacity>

        {/* Resend */}
        <TouchableOpacity
          style={[styles.secondaryBtn, cooldown > 0 && styles.btnDisabled]}
          onPress={handleResend}
          activeOpacity={0.75}
          disabled={cooldown > 0}
        >
          <Feather name="refresh-cw" size={15} color={cooldown > 0 ? colors.textDim : colors.primary} style={{ marginRight: 7 }} />
          <Text style={[styles.secondaryBtnText, cooldown > 0 && styles.dimText]}>
            {cooldown > 0 ? `Resend Email (${cooldown}s)` : 'Resend Email'}
          </Text>
        </TouchableOpacity>

        {/* Sign out */}
        <TouchableOpacity onPress={logout} style={styles.signOutLink} activeOpacity={0.7}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const makeStyles = (c: AppColors) =>
  StyleSheet.create({
    scrollContent: {
      flexGrow: 1,
      backgroundColor: c.bgDark,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
    },
    card: {
      width: '100%',
      maxWidth: 440,
      backgroundColor: c.cardDark,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: c.borderColor,
      alignItems: 'center',
      padding: spacing.xxxl,
    },
    illustrationWrap: {
      marginBottom: spacing.xxl,
    },
    illustrationBg: {
      width: 140,
      height: 140,
      borderRadius: 70,
      backgroundColor: c.primaryGlow,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: c.borderColor,
    },
    title: {
      fontSize: 24,
      fontWeight: '700',
      color: c.textMain,
      letterSpacing: -0.4,
      marginBottom: spacing.sm,
    },
    sub: {
      fontSize: 14,
      color: c.textMuted,
      textAlign: 'center',
      marginBottom: spacing.sm,
    },
    emailPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.primaryGlow,
      borderRadius: 20,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: c.primary + '33',
    },
    emailText: {
      fontSize: 13,
      fontWeight: '600',
      color: c.primary,
    },
    hint: {
      fontSize: 13,
      color: c.textMuted,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: spacing.xl,
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.accentRed + '18',
      borderRadius: radius.sm,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: c.accentRed + '40',
      width: '100%',
    },
    errorText: {
      flex: 1,
      fontSize: 13,
      color: c.accentRed,
    },
    successBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.accentGreen + '18',
      borderRadius: radius.sm,
      padding: spacing.md,
      marginBottom: spacing.md,
      borderWidth: 1,
      borderColor: c.accentGreen + '40',
      width: '100%',
    },
    successText: {
      flex: 1,
      fontSize: 13,
      color: c.accentGreen,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.primary,
      borderRadius: radius.md,
      paddingVertical: 14,
      width: '100%',
      marginBottom: spacing.md,
    },
    primaryBtnText: {
      fontSize: 15,
      fontWeight: '700',
      color: '#fff',
    },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.cardHover,
      borderRadius: radius.md,
      paddingVertical: 13,
      width: '100%',
      borderWidth: 1,
      borderColor: c.borderColor,
      marginBottom: spacing.xl,
    },
    secondaryBtnText: {
      fontSize: 14,
      fontWeight: '600',
      color: c.primary,
    },
    btnDisabled: {
      opacity: 0.5,
    },
    dimText: {
      color: c.textDim,
    },
    signOutLink: {
      paddingVertical: spacing.sm,
    },
    signOutText: {
      fontSize: 13,
      color: c.textMuted,
      textDecorationLine: 'underline',
    },
  });
