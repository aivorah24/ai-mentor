import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../../config/firebase';

const PRIMARY = '#93B0AC';   // Aivorah slate teal
const BG = '#0F0F0F';
const CARD = '#1C1C1C';
const BORDER = 'rgba(195, 220, 216, 0.15)';
const TEXT = '#F0EEEC';
const MUTED = '#A8B5B3';
const GREEN = '#93B0AC';
const RED = '#E07A7A';

export default function ResetPasswordScreen() {
  const [oobCode, setOobCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') { setStatus('error'); setError('This page must be opened in a browser.'); return; }
    const params = new URLSearchParams(window.location.search);
    const code = params.get('oobCode');
    if (!code) { setStatus('error'); setError('Invalid or expired reset link.'); return; }
    setOobCode(code);
    verifyPasswordResetCode(auth, code)
      .then(em => { setEmail(em); setStatus('ready'); })
      .catch(() => { setStatus('error'); setError('This link has expired or already been used. Please request a new one.'); });
  }, []);

  async function handleReset() {
    if (!password || password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSaving(true); setError('');
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setStatus('success');
    } catch (e: any) {
      setError(e.message || 'Failed to reset password. Please try again.');
    } finally { setSaving(false); }
  }

  return (
    <View style={s.screen}>
      <View style={s.card}>
        {/* Logo */}
        <View style={s.logoRow}>
          <View style={s.logoBox}>
            <Feather name="zap" size={22} color="#fff" />
          </View>
          <Text style={s.logoText}>Aivorah</Text>
        </View>

        {status === 'loading' && (
          <View style={s.center}>
            <ActivityIndicator color={PRIMARY} size="large" />
            <Text style={s.mutedText}>Verifying link...</Text>
          </View>
        )}

        {status === 'error' && (
          <View style={s.center}>
            <View style={[s.iconCircle, { backgroundColor: RED + '20' }]}>
              <Feather name="alert-circle" size={28} color={RED} />
            </View>
            <Text style={s.titleText}>Link Expired</Text>
            <Text style={s.mutedText}>{error}</Text>
            <TouchableOpacity style={s.btn} onPress={() => { if (typeof window !== 'undefined') window.location.replace('/'); }}>
              <Text style={s.btnText}>Back to App</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === 'ready' && (
          <>
            <View style={[s.iconCircle, { backgroundColor: PRIMARY + '20', alignSelf: 'center' }]}>
              <Feather name="lock" size={24} color={PRIMARY} />
            </View>
            <Text style={s.titleText}>Reset Password</Text>
            <Text style={s.mutedText}>Setting new password for{'\n'}<Text style={{ color: TEXT, fontWeight: '700' }}>{email}</Text></Text>

            <View style={s.field}>
              <Text style={s.label}>New Password</Text>
              <View style={s.inputRow}>
                <TextInput
                  style={s.input}
                  placeholder="Min. 6 characters"
                  placeholderTextColor={MUTED}
                  secureTextEntry={!showPw}
                  value={password}
                  onChangeText={t => { setPassword(t); setError(''); }}
                  autoFocus
                />
                <TouchableOpacity onPress={() => setShowPw(v => !v)} style={s.eyeBtn}>
                  <Feather name={showPw ? 'eye-off' : 'eye'} size={16} color={MUTED} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={s.field}>
              <Text style={s.label}>Confirm Password</Text>
              <View style={s.inputRow}>
                <TextInput
                  style={s.input}
                  placeholder="Re-enter your password"
                  placeholderTextColor={MUTED}
                  secureTextEntry={!showPw}
                  value={confirm}
                  onChangeText={t => { setConfirm(t); setError(''); }}
                />
              </View>
            </View>

            {error ? (
              <View style={s.errorRow}>
                <Feather name="alert-circle" size={13} color={RED} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity style={[s.btn, saving && { opacity: 0.6 }]} onPress={handleReset} disabled={saving} activeOpacity={0.85}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnText}>Save New Password</Text>}
            </TouchableOpacity>
          </>
        )}

        {status === 'success' && (
          <View style={s.center}>
            <View style={[s.iconCircle, { backgroundColor: GREEN + '20' }]}>
              <Feather name="check-circle" size={28} color={GREEN} />
            </View>
            <Text style={s.titleText}>Password Updated!</Text>
            <Text style={s.mutedText}>Your password has been reset successfully.</Text>
            <TouchableOpacity style={s.btn} onPress={() => { if (typeof window !== 'undefined') window.location.replace('/'); }}>
              <Text style={s.btnText}>Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(195, 220, 216, 0.22)', padding: 32, gap: 20 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  logoBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: PRIMARY + 'CC', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: PRIMARY },
  logoText: { fontSize: 20, fontWeight: '800', color: TEXT },
  center: { alignItems: 'center', gap: 12 },
  iconCircle: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  titleText: { fontSize: 20, fontWeight: '800', color: TEXT, textAlign: 'center' },
  mutedText: { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20 },
  field: { gap: 6 },
  label: { fontSize: 11, fontWeight: '700', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 10, overflow: 'hidden' },
  input: { flex: 1, backgroundColor: BG, paddingHorizontal: 14, paddingVertical: 13, color: TEXT, fontSize: 14 },
  eyeBtn: { paddingHorizontal: 14 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: RED + '12', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: RED + '30' },
  errorText: { fontSize: 13, color: RED, flex: 1 },
  btn: { backgroundColor: PRIMARY, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
