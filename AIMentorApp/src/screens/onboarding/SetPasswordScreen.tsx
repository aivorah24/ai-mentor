/**
 * SetPasswordScreen.tsx
 * Shown to auto-generated student accounts on first login.
 * Forces them to set their own password before entering the app.
 */
import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

const TEAL = '#5F8A86';

export default function SetPasswordScreen() {
  const { user, updateUser } = useAuth();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent]         = useState(false);
  const [showNew, setShowNew]                 = useState(false);
  const [showConfirm, setShowConfirm]         = useState(false);
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState('');
  const [success, setSuccess]                 = useState(false);

  const strength = (() => {
    if (newPassword.length === 0) return 0;
    let s = 0;
    if (newPassword.length >= 6)  s++;
    if (newPassword.length >= 10) s++;
    if (/[A-Z]/.test(newPassword)) s++;
    if (/[0-9]/.test(newPassword)) s++;
    if (/[^A-Za-z0-9]/.test(newPassword)) s++;
    return s;
  })();

  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'][strength];
  const strengthColor = ['', '#ef4444', '#f59e0b', '#3b82f6', '#22c55e', '#16a34a'][strength];

  async function handleSetPassword() {
    setError('');
    if (!currentPassword) { setError('Enter your temporary password.'); return; }
    if (newPassword.length < 6) { setError('New password must be at least 6 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (newPassword === currentPassword) { setError('New password must be different from the temporary one.'); return; }

    setLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (firebaseUser && firebaseUser.email) {
        const cred = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
        await reauthenticateWithCredential(firebaseUser, cred);
        await updatePassword(firebaseUser, newPassword);
      }

      // Clear the mustChangePassword flag on server
      await fetch(`${SERVER_URL}/user/clear-must-change-password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email }),
      }).catch(() => {});

      // Update local state — clears the gate in App.tsx
      updateUser({ mustChangePassword: false });
      setSuccess(true);
    } catch (e: any) {
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        setError('Temporary password is incorrect. Check the credentials sent to your parent\'s email.');
      } else {
        setError(e.message || 'Failed to update password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={isDark ? ['#0F1A19', '#162421', '#1A2E2C'] : ['#EAF3F2', '#F4F9F8', '#FFFFFF']}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Feather name="lock" size={28} color={TEAL} />
            </View>
            <Text style={styles.title}>Set Your Password</Text>
            <Text style={styles.subtitle}>
              Welcome, {user?.name?.split(' ')[0] || 'there'}! Your account was created with a temporary password.{'\n'}
              Please set your own password to continue.
            </Text>
          </View>

          {/* Form card */}
          <View style={styles.card}>
            {/* Temporary password */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Temporary Password</Text>
              <Text style={styles.hint}>Sent to your parent's email when account was created</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Enter temporary password"
                  placeholderTextColor={colors.textDim}
                  secureTextEntry={!showCurrent}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity onPress={() => setShowCurrent(v => !v)} style={styles.eyeBtn}>
                  <Feather name={showCurrent ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            {/* New password */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>New Password</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Choose a new password"
                  placeholderTextColor={colors.textDim}
                  secureTextEntry={!showNew}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity onPress={() => setShowNew(v => !v)} style={styles.eyeBtn}>
                  <Feather name={showNew ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              {/* Strength bar */}
              {newPassword.length > 0 && (
                <View style={{ marginTop: 8, gap: 4 }}>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {[1, 2, 3, 4, 5].map(i => (
                      <View
                        key={i}
                        style={{
                          flex: 1, height: 4, borderRadius: 2,
                          backgroundColor: i <= strength ? strengthColor : colors.borderColor,
                        }}
                      />
                    ))}
                  </View>
                  <Text style={{ fontSize: 11, color: strengthColor, fontWeight: '600' }}>{strengthLabel}</Text>
                </View>
              )}
            </View>

            {/* Confirm password */}
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Confirm New Password</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Re-enter new password"
                  placeholderTextColor={colors.textDim}
                  secureTextEntry={!showConfirm}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity onPress={() => setShowConfirm(v => !v)} style={styles.eyeBtn}>
                  <Feather name={showConfirm ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <Text style={{ fontSize: 11, color: colors.accentRed, marginTop: 4 }}>Passwords do not match</Text>
              )}
              {confirmPassword.length > 0 && newPassword === confirmPassword && (
                <Text style={{ fontSize: 11, color: colors.accentGreen, marginTop: 4 }}>Passwords match</Text>
              )}
            </View>

            {/* Error */}
            {!!error && (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={14} color={colors.accentRed} />
                <Text style={[styles.errorText, { color: colors.accentRed }]}>{error}</Text>
              </View>
            )}

            {/* Success */}
            {success && (
              <View style={[styles.errorBox, { backgroundColor: colors.accentGreen + '18', borderColor: colors.accentGreen + '40' }]}>
                <Feather name="check-circle" size={14} color={colors.accentGreen} />
                <Text style={[styles.errorText, { color: colors.accentGreen }]}>Password updated! Taking you to your dashboard...</Text>
              </View>
            )}

            {/* Submit */}
            <TouchableOpacity
              style={[styles.btn, loading && { opacity: 0.7 }]}
              onPress={handleSetPassword}
              disabled={loading || success}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="check" size={18} color="#fff" /><Text style={styles.btnText}>Set Password & Continue</Text></>}
            </TouchableOpacity>
          </View>

          <Text style={styles.footer}>
            Your password is encrypted and never shared with anyone, including your parents.
          </Text>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: AppColors, isDark: boolean) => StyleSheet.create({
  scroll: { flexGrow: 1, padding: spacing.xl, paddingTop: 60, alignItems: 'center' },
  header: { alignItems: 'center', marginBottom: 32, maxWidth: 420, width: '100%' },
  iconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: TEAL + '18', borderWidth: 2, borderColor: TEAL + '40',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  title: { fontSize: 26, fontWeight: '800', color: c.textMain, marginBottom: 10, textAlign: 'center' },
  subtitle: { fontSize: 14, color: c.textMuted, lineHeight: 22, textAlign: 'center' },
  card: {
    width: '100%', maxWidth: 420,
    backgroundColor: isDark ? c.cardDark : '#fff',
    borderRadius: radius.xl, padding: 24,
    borderWidth: 1, borderColor: c.borderColor,
    gap: 20,
  },
  fieldWrap: { gap: 6 },
  label: { fontSize: 13, fontWeight: '700', color: c.textMain },
  hint: { fontSize: 11, color: c.textDim },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md,
    backgroundColor: isDark ? c.bgDark : '#F8FAFA',
    paddingHorizontal: 14,
  },
  input: { flex: 1, fontSize: 14, color: c.textMain, paddingVertical: 13 },
  eyeBtn: { padding: 4 },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.accentRed + '12', borderWidth: 1, borderColor: c.accentRed + '30',
    borderRadius: radius.md, padding: 12,
  },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: TEAL, borderRadius: radius.md, paddingVertical: 15,
  },
  btnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  footer: { fontSize: 11, color: c.textDim, textAlign: 'center', marginTop: 20, maxWidth: 340 },
});
