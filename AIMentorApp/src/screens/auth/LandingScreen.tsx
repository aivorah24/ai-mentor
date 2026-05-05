import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Linking,
  ActivityIndicator,
  Alert,
  Modal,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Path, Circle, Defs, LinearGradient as SvgGrad, Stop, Rect } from 'react-native-svg';
import { useAuth, UserRole } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import SERVER_URL from '../../config/serverUrl';

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────
// ── Enchanting Forest palette ─────────────────────────────
const BG        = '#0F0F0F';          // true black
const CARD      = '#1C1C1C';          // dark card
const BORDER    = 'rgba(195,220,216,0.16)'; // subtle teal border
const MUTED     = '#A8B5B3';          // muted sage
const DIM       = '#5A6B69';          // dark sage
const FORE      = '#F0EEEC';          // warm off-white
const CYAN      = '#93B0AC';          // sage teal (primary)
const BLUE      = '#5F8A86';          // slate teal (darker)
const GREEN     = '#5A8A70';          // forest green
const AMBER     = '#C5BD96';          // khaki gold
const RED       = '#B8797E';          // muted rose
const PURPLE    = '#D4A898';          // warm peach

const { width: WIN_W } = Dimensions.get('window');
const IS_WEB = Platform.OS === 'web';
const IS_LARGE = WIN_W >= 900;

function BackgroundOrbs() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <View style={s.bgOrbTop} />
      <View style={s.bgOrbMid} />
      <View style={s.bgOrbBottom} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Google SVG Icon
// ─────────────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18">
      <Path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
      <Path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <Path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" />
      <Path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 6.293C4.672 4.166 6.656 3.58 9 3.58z" />
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────
// Gradient button (SVG-backed gradient)
// ─────────────────────────────────────────────────────────
function GradientButton({ label, onPress, style, textStyle, icon, loading }: {
  label: string; onPress: () => void; style?: any; textStyle?: any;
  icon?: string; loading?: boolean;
}) {
  const [h, setH] = useState(52);
  const [w, setW] = useState(200);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      disabled={loading}
      onLayout={e => { setH(e.nativeEvent.layout.height); setW(e.nativeEvent.layout.width); }}
      style={[{ overflow: 'hidden', borderRadius: 8 }, style]}
    >
      <Svg style={StyleSheet.absoluteFill as any} width={w} height={h} pointerEvents="none">
        <Defs>
          <SvgGrad id="grad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#5F8A86" stopOpacity="1" />
            <Stop offset="1" stopColor="#93B0AC" stopOpacity="1" />
          </SvgGrad>
        </Defs>
        <Rect x="0" y="0" width={w} height={h} fill="url(#grad)" />
      </Svg>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 14 }}>
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            {icon && <Feather name={icon as any} size={15} color="#fff" />}
            <Text style={[{ fontSize: 15, fontWeight: '600', color: '#fff' }, textStyle]}>{label}</Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────
// Ghost / outline button
// ─────────────────────────────────────────────────────────
function GhostButton({ label, onPress, style }: { label: string; onPress: () => void; style?: any }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[s.ghostBtn, style]}
    >
      <Text style={s.ghostBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────
// Firebase error helper
// ─────────────────────────────────────────────────────────
function getFbError(code: string): string {
  switch (code) {
    case 'auth/user-not-found':        return 'No account found with this email.';
    case 'auth/wrong-password':        return 'Incorrect password.';
    case 'auth/invalid-credential':    return 'Invalid email or password.';
    case 'auth/email-already-in-use':  return 'An account with this email already exists.';
    case 'auth/weak-password':         return 'Password must be at least 6 characters.';
    case 'auth/invalid-email':         return 'Please enter a valid email address.';
    case 'auth/too-many-requests':     return 'Too many attempts. Please try again later.';
    case 'auth/network-request-failed': return 'Network error. Check your connection.';
    case 'auth/popup-closed-by-user':  return 'Google sign-in was cancelled.';
    default:                           return 'Something went wrong. Please try again.';
  }
}

// ─────────────────────────────────────────────────────────
// Role chip rows
// Login: all three roles | Signup: only teacher + parent
// (Students are created by parent or teacher)
// ─────────────────────────────────────────────────────────
const ROLE_LABELS: UserRole[]        = ['student', 'teacher', 'parent'];
const SIGNUP_ROLE_LABELS: UserRole[] = ['teacher', 'parent'];
function RoleChips({ selected, onSelect }: { selected: UserRole; onSelect: (r: UserRole) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
      {ROLE_LABELS.map(r => (
        <TouchableOpacity
          key={r}
          onPress={() => onSelect(r)}
          activeOpacity={0.75}
          style={[s.roleChip, selected === r && s.roleChipActive]}
        >
          <Text style={[s.roleChipText, selected === r && s.roleChipTextActive]}>
            {r.charAt(0).toUpperCase() + r.slice(1)}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Auth Modal shell
// ─────────────────────────────────────────────────────────
function AuthModal({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!visible) return null;
  return (
    <View style={s.overlay}>
      <TouchableOpacity activeOpacity={1} style={s.overlayBg} onPress={onClose} />
      <View style={s.modal}>
        <TouchableOpacity style={s.modalClose} onPress={onClose}>
          <Feather name="x" size={18} color={MUTED} />
        </TouchableOpacity>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: WIN_W < 400 ? 560 : undefined }}>
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Form input
// ─────────────────────────────────────────────────────────
function FormInput({ label, value, onChange, placeholder, secureTextEntry, keyboardType, autoCapitalize, rightEl }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
  secureTextEntry?: boolean; keyboardType?: any; autoCapitalize?: any; rightEl?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={s.formLabel}>{label}</Text>
      <View style={[s.inputWrap, focused && { borderColor: CYAN }]}>
        <TextInput
          style={s.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={DIM}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize || 'none'}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {rightEl}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// LOGIN MODAL
// ─────────────────────────────────────────────────────────
function LoginModal({ visible, onClose, onSwitchSignup, onSwitchForgot, signInEmail, signInGoogle, addParentRoleSSO, externalError, onClearExternalError }: {
  visible: boolean; onClose: () => void; onSwitchSignup: () => void; onSwitchForgot: () => void;
  signInEmail: (email: string, pass: string, role: UserRole) => Promise<void>;
  signInGoogle: (role: UserRole) => Promise<void>;
  addParentRoleSSO: (email: string) => Promise<void>;
  externalError?: string | null;
  onClearExternalError?: () => void;
}) {
  const [role, setRole] = useState<UserRole>('student');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Show external error (e.g. role mismatch from Google SSO) and re-open modal
  useEffect(() => {
    // Don't show internal signals as error text — LandingScreen handles these via Alert
    if (externalError && !externalError.startsWith('TEACHER_ADD_PARENT:')) setError(externalError);
  }, [externalError]);

  async function submit() {
    setError('');
    const emailTrim = email.trim();
    const passTrim = pass.trim();
    if (!emailTrim || !passTrim) { setError('Please fill in all fields.'); return; }
    setLoading(true);
    try { await signInEmail(emailTrim, passTrim, role); onClose(); }
    catch (e: any) { 
      setError(e.message || 'Something went wrong. Please try again.'); 
    }
    finally { setLoading(false); }
  }

  async function googleSignIn() {
    setError('');
    setGoogleLoading(true);
    try { await signInGoogle(role); onClose(); }
    catch (e: any) {
      if (e.message?.startsWith('TEACHER_ADD_PARENT:')) {
        const teacherEmail = e.message.replace('TEACHER_ADD_PARENT:', '');
        setGoogleLoading(false);
        Alert.alert(
          'Teacher Account Found',
          'This email is already registered as a Teacher. Would you like to add a Parent profile so you can switch between both?',
          [
            { text: 'No', style: 'cancel' },
            {
              text: 'Yes, Add Parent Profile',
              onPress: async () => {
                setGoogleLoading(true);
                try { await addParentRoleSSO(teacherEmail); onClose(); }
                catch { setError('Could not add Parent profile. Please try again.'); }
                finally { setGoogleLoading(false); }
              },
            },
          ]
        );
        return;
      }
      setError(e.message || 'An error occurred during Google signin.');
    }
    finally { setGoogleLoading(false); }
  }

  return (
    <AuthModal visible={visible} onClose={onClose}>
      <Text style={s.modalTitle}>Welcome back</Text>
      <Text style={s.modalSubtitle}>Sign in to your Aivorah account</Text>

      <RoleChips selected={role} onSelect={setRole} />

      <TouchableOpacity style={s.googleBtn} onPress={googleSignIn} activeOpacity={0.85}>
        {googleLoading ? <ActivityIndicator size="small" color="#3c4043" /> : <GoogleIcon />}
        <Text style={s.googleBtnText}>Sign in with Google</Text>
      </TouchableOpacity>

      <View style={s.divider}><View style={s.divLine} /><Text style={s.divText}>or continue with email</Text><View style={s.divLine} /></View>

      <FormInput label="Email address" value={email} onChange={setEmail} placeholder="you@example.com" keyboardType="email-address" />
      <View style={{ marginBottom: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={s.formLabel}>Password</Text>
          <TouchableOpacity onPress={onSwitchForgot}><Text style={s.linkText}>Forgot password?</Text></TouchableOpacity>
        </View>
        <View style={s.inputWrap}>
          <TextInput style={[s.input, { flex: 1 }]} value={pass} onChangeText={setPass} placeholder="••••••••" placeholderTextColor={DIM} secureTextEntry={!showPass} />
          <TouchableOpacity onPress={() => setShowPass(!showPass)} style={{ padding: 4 }}>
            <Feather name={showPass ? 'eye-off' : 'eye'} size={14} color={DIM} />
          </TouchableOpacity>
        </View>
      </View>

      {!!error && <View style={s.errorBox}><Feather name="alert-circle" size={13} color={RED} /><Text style={s.errorText}>{error}</Text></View>}

      <GradientButton label="Sign In" onPress={submit} loading={loading} style={{ marginTop: 8 }} />
      <View style={s.formFooter}>
        <Text style={s.footerText}>Don't have an account? </Text>
        <TouchableOpacity onPress={onSwitchSignup}><Text style={s.linkText}>Sign up free</Text></TouchableOpacity>
      </View>
    </AuthModal>
  );
}

// ─────────────────────────────────────────────────────────
// SIGN UP MODAL
// ─────────────────────────────────────────────────────────
const CURRICULA = ['NCERT', 'IB PYP', 'CBSE', 'Cambridge'];

function SignupModal({ visible, onClose, onSwitchLogin, signUpEmail, signInGoogle, addParentRole, addParentRoleSSO }: {
  visible: boolean; onClose: () => void; onSwitchLogin: () => void;
  signUpEmail: (name: string, email: string, pass: string, role: UserRole, curriculum?: string) => Promise<void>;
  signInGoogle: (role: UserRole) => Promise<void>;
  addParentRole: (email: string, password: string) => Promise<void>;
  addParentRoleSSO: (email: string) => Promise<void>;
}) {
  const [role, setRole]             = useState<UserRole>('student');
  const [curriculum, setCurriculum] = useState('NCERT');
  const [name, setName]             = useState('');
  const [email, setEmail]           = useState('');
  const [pass, setPass]             = useState('');
  const [dob, setDob]               = useState('');   // DD/MM/YYYY — only for students
  const [showPass, setShowPass]     = useState(false);
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [emailSent, setEmailSent]   = useState(false); // post-signup verification screen

  const showCurriculum = role === 'student' || role === 'teacher';

  // Calculate age from DD/MM/YYYY
  function getAge(dobStr: string): number | null {
    const parts = dobStr.split('/');
    if (parts.length !== 3) return null;
    const [dd, mm, yyyy] = parts.map(Number);
    if (!dd || !mm || !yyyy || yyyy < 1900) return null;
    const birth = new Date(yyyy, mm - 1, dd);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }

  async function submit() {
    setError('');
    const emailTrim = email.trim();
    const nameTrim  = name.trim();

    if (!nameTrim)  { setError('Please enter your full name.'); return; }
    if (!emailTrim) { setError('Please enter a valid email address.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(emailTrim)) { setError('Please enter a valid email format.'); return; }
    if (pass.length < 6) { setError('Password must be at least 6 characters.'); return; }

    // Age check for students
    if (role === 'student') {
      if (!dob.trim()) { setError('Please enter your date of birth.'); return; }
      const age = getAge(dob.trim());
      if (age === null) { setError('Please enter a valid date of birth (DD/MM/YYYY).'); return; }
      if (age < 14) {
        setError('Students under 14 cannot self-register. Please ask your parent or teacher to create your account.');
        return;
      }
    }

    setLoading(true);
    try {
      await signUpEmail(nameTrim, emailTrim, pass, role, showCurriculum ? curriculum : undefined);
      onClose();
    } catch (e: any) {
      // Teacher trying to sign up as Parent → offer to add Parent profile
      if (e.message?.startsWith('TEACHER_ADD_PARENT:')) {
        setLoading(false);
        Alert.alert(
          'Teacher Account Found',
          'This email is already registered as a Teacher. Would you like to add a Parent profile so you can switch between both?',
          [
            { text: 'No', style: 'cancel' },
            {
              text: 'Yes, Add Parent Profile',
              onPress: async () => {
                setLoading(true);
                try {
                  await addParentRole(emailTrim, pass);
                  onClose();
                } catch {
                  setError('Could not add Parent profile. Please check your password and try again.');
                } finally {
                  setLoading(false);
                }
              },
            },
          ]
        );
        return;
      }
      setError(e.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function googleSignIn() {
    setError('');
    setGoogleLoading(true);
    try { await signInGoogle(role); onClose(); }
    catch (e: any) {
      // Teacher signing in as Parent via Google SSO → offer to club profiles
      if (e.message?.startsWith('TEACHER_ADD_PARENT:')) {
        const teacherEmail = e.message.replace('TEACHER_ADD_PARENT:', '');
        setGoogleLoading(false);
        Alert.alert(
          'Teacher Account Found',
          'This email is already registered as a Teacher. Would you like to add a Parent profile so you can switch between both?',
          [
            { text: 'No', style: 'cancel' },
            {
              text: 'Yes, Add Parent Profile',
              onPress: async () => {
                setGoogleLoading(true);
                try {
                  await addParentRoleSSO(teacherEmail);
                  onClose();
                } catch {
                  setError('Could not add Parent profile. Please try again.');
                } finally {
                  setGoogleLoading(false);
                }
              },
            },
          ]
        );
        return;
      }
      setError(e.message || 'An error occurred during Google signin.');
    } finally { setGoogleLoading(false); }
  }

  // ── Email verification sent screen ──────────────────────────────────────────
  if (emailSent) {
    return (
      <AuthModal visible={visible} onClose={() => { setEmailSent(false); onClose(); }}>
        <View style={{ alignItems: 'center', gap: 16, paddingVertical: 12 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#10b98120', alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="mail" size={30} color="#10b981" />
          </View>
          <Text style={[s.modalTitle, { textAlign: 'center' }]}>Check your email</Text>
          <Text style={[s.modalSubtitle, { textAlign: 'center', lineHeight: 22 }]}>
            We've sent a verification link to{'\n'}
            <Text style={{ color: CYAN, fontWeight: '700' }}>{email.trim()}</Text>
            {'\n\n'}Click the link in the email to activate your account before signing in.
          </Text>
          <View style={{ backgroundColor: '#f59e0b18', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#f59e0b40' }}>
            <Text style={{ color: '#f59e0b', fontSize: 12, lineHeight: 18, textAlign: 'center' }}>
              Didn't receive it? Check your spam folder or try signing up again.
            </Text>
          </View>
          <GradientButton label="Go to Sign In" onPress={() => { setEmailSent(false); onClose(); onSwitchLogin(); }} style={{ width: '100%', marginTop: 4 }} />
        </View>
      </AuthModal>
    );
  }

  // ── Main signup form ─────────────────────────────────────────────────────────
  return (
    <AuthModal visible={visible} onClose={onClose}>
      <Text style={s.modalTitle}>Create your account</Text>
      <Text style={s.modalSubtitle}>Start learning with Aivorah — it's free forever</Text>

      <TouchableOpacity style={s.googleBtn} onPress={googleSignIn} activeOpacity={0.85}>
        {googleLoading ? <ActivityIndicator size="small" color="#3c4043" /> : <GoogleIcon />}
        <Text style={s.googleBtnText}>Sign up with Google</Text>
      </TouchableOpacity>

      <View style={s.divider}><View style={s.divLine} /><Text style={s.divText}>or continue with email</Text><View style={s.divLine} /></View>

      <RoleChips selected={role} onSelect={r => { setRole(r); setError(''); setDob(''); }} />

      {/* Under-14 notice — shown when student role selected */}
      {role === 'student' && (
        <View style={{ backgroundColor: '#38bdf818', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#38bdf840', marginBottom: 14 }}>
          <Text style={{ color: '#38bdf8', fontSize: 12, lineHeight: 18 }}>
            Students aged 14 and above can register here.{'\n'}
            If you are under 14, ask your parent or teacher to create your account.
          </Text>
        </View>
      )}

      {showCurriculum && (
        <View style={{ marginBottom: 18 }}>
          <Text style={s.formLabel}>Curriculum</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            {CURRICULA.map(c => (
              <TouchableOpacity key={c} onPress={() => setCurriculum(c)} activeOpacity={0.75}
                style={[s.roleChip, curriculum === c && s.roleChipActive]}>
                <Text style={[s.roleChipText, curriculum === c && s.roleChipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <FormInput label="Full name" value={name} onChange={setName} placeholder="Jane Smith" autoCapitalize="words" />
      <FormInput label="Email address" value={email} onChange={setEmail} placeholder="you@example.com" keyboardType="email-address" />

      {/* DOB — only for students */}
      {role === 'student' && (
        <FormInput label="Date of birth" value={dob} onChange={setDob} placeholder="DD/MM/YYYY" keyboardType="numeric" />
      )}

      <View style={{ marginBottom: 6 }}>
        <Text style={[s.formLabel, { marginBottom: 6 }]}>Password</Text>
        <View style={s.inputWrap}>
          <TextInput style={[s.input, { flex: 1 }]} value={pass} onChangeText={setPass}
            placeholder="At least 6 characters" placeholderTextColor={DIM} secureTextEntry={!showPass} />
          <TouchableOpacity onPress={() => setShowPass(!showPass)} style={{ padding: 4 }}>
            <Feather name={showPass ? 'eye-off' : 'eye'} size={14} color={DIM} />
          </TouchableOpacity>
        </View>
      </View>

      {!!error && <View style={s.errorBox}><Feather name="alert-circle" size={13} color={RED} /><Text style={s.errorText}>{error}</Text></View>}

      <GradientButton label="Create Free Account" onPress={submit} loading={loading} style={{ marginTop: 8 }} />
      <View style={s.formFooter}>
        <Text style={s.footerText}>Already have an account? </Text>
        <TouchableOpacity onPress={onSwitchLogin}><Text style={s.linkText}>Sign in</Text></TouchableOpacity>
      </View>
    </AuthModal>
  );
}

// ─────────────────────────────────────────────────────────
// FORGOT PASSWORD MODAL
// ─────────────────────────────────────────────────────────
function ForgotModal({ visible, onClose, onSwitchLogin }: {
  visible: boolean; onClose: () => void; onSwitchLogin: () => void;
}) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email.trim()) return;
    setLoading(true);
    try {
      const frontendOrigin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : 'https://aivorah.ai';
      const res = await fetch(`${SERVER_URL}/user/send-password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), frontendOrigin }),
      });
      if (!res.ok) throw new Error('Failed');
      setSent(true);
    } catch (e) {
      Alert.alert('Error', 'Could not send reset email. Check the address and try again.');
    } finally { setLoading(false); }
  }

  return (
    <AuthModal visible={visible} onClose={onClose}>
      <Text style={s.modalTitle}>Reset your password</Text>
      <Text style={s.modalSubtitle}>Enter your email and we'll send you a reset link</Text>
      {sent ? (
        <View style={s.successBox}>
          <Feather name="check-circle" size={16} color={GREEN} />
          <Text style={s.successText}>Reset link sent to {email}. Check your inbox.</Text>
        </View>
      ) : (
        <>
          <FormInput label="Email address" value={email} onChange={setEmail} placeholder="you@example.com" keyboardType="email-address" />
          <GradientButton label="Send Reset Link" onPress={submit} loading={loading} style={{ marginTop: 4 }} />
        </>
      )}
      <View style={s.formFooter}>
        <Text style={s.footerText}>Remembered it? </Text>
        <TouchableOpacity onPress={onSwitchLogin}><Text style={s.linkText}>Back to Sign in</Text></TouchableOpacity>
      </View>
    </AuthModal>
  );
}

// (mockup removed)


// ─────────────────────────────────────────────────────────
// Section data
// ─────────────────────────────────────────────────────────
const STATS = [
  { value: '50,000+', label: 'Active Students', icon: 'users', color: CYAN },
  { value: '4.9 / 5', label: 'Average Rating', icon: 'star', color: AMBER },
  { value: '200+', label: 'Courses Available', icon: 'book-open', color: GREEN },
  { value: '95%', label: 'Satisfaction Rate', icon: 'heart', color: PURPLE },
];

const ROLES_DATA = [
  {
    icon: 'book-open', title: 'For Students', role: 'student' as UserRole,
    color: CYAN, tagline: 'Learn at your own pace, guided by AI',
    benefits: [
      'Personalized AI tutor available 24/7',
      'Adaptive study plans that fit your schedule',
      'Gamified XP system to keep you motivated',
      'Instant feedback on every assignment',
      'Track your progress with visual analytics',
    ],
  },
  {
    icon: 'monitor', title: 'For Teachers', role: 'teacher' as UserRole,
    color: PURPLE, tagline: 'Save time, teach smarter',
    benefits: [
      'AI-assisted lesson planning & grading',
      'Spot struggling students before they fall behind',
      'Real-time class performance dashboards',
      'Automate repetitive administrative tasks',
      'Schedule sessions with one click',
    ],
  },
  {
    icon: 'users', title: 'For Parents', role: 'parent' as UserRole,
    color: GREEN, tagline: 'Stay connected to your child\'s journey',
    benefits: [
      'Live progress reports and milestone alerts',
      'Understand strengths and areas to improve',
      'Direct communication with teachers',
      'Weekly AI-generated learning summaries',
      'No complexity. Just clear, honest insights.',
    ],
  },
];

const FEATURES_DATA = [
  { icon: 'cpu', title: 'Aivorah 24/7', desc: 'An always-on intelligent assistant that explains concepts, solves problems step-by-step, and adapts to your learning style in real time.' },
  { icon: 'zap', title: 'Adaptive Learning Paths', desc: 'The platform continuously adjusts difficulty and content based on your performance, so you\'re always learning at the right level.' },
  { icon: 'trending-up', title: 'Real-time Analytics', desc: 'Beautiful dashboards for students, teachers, and parents that turn raw data into clear, actionable learning insights.' },
  { icon: 'target', title: 'Gamified Challenges', desc: 'Earn XP, unlock achievements, and compete in challenges that make studying engaging and genuinely fun.' },
];

const HOW_IT_WORKS = [
  { step: '01', icon: 'user-plus', title: 'Create your account', desc: 'Sign up in seconds. Choose your role as a student, teacher, or parent and get instant access.' },
  { step: '02', icon: 'sliders', title: 'Set up your profile', desc: 'Tell us your subjects, grade level, and goals. Our AI builds a personalized plan tailored just for you.' },
  { step: '03', icon: 'cpu', title: 'Start learning with AI', desc: 'Chat with your AI mentor, complete adaptive assignments, and track every milestone as you grow.' },
];

// ─────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────
export default function LandingScreen() {
  const { colors: c } = useTheme();
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, demoLogin, testLogin, addParentRoleToTeacher, addParentRoleToTeacherSSO, authError, clearAuthError, logout } = useAuth();
  const [showTestAccounts, setShowTestAccounts] = useState(false);
  const [testCurriculum, setTestCurriculum] = useState<'IB PYP' | 'NCERT' | 'CBSE'>('IB PYP');
  const [showLogin,    setShowLogin]    = useState(false);
  const [showSignup,   setShowSignup]   = useState(false);
  const [showForgot,   setShowForgot]   = useState(false);
  const [teacherAddParentEmail, setTeacherAddParentEmail] = useState<string | null>(null);
  const [addingParentRole, setAddingParentRole] = useState(false);

  // Re-open login modal when authError is set (e.g. Google SSO role mismatch)
  useEffect(() => {
    if (!authError) return;
    // Teacher trying to add Parent via Google SSO → show custom confirmation modal
    if (authError.startsWith('TEACHER_ADD_PARENT:')) {
      const teacherEmail = authError.replace('TEACHER_ADD_PARENT:', '');
      clearAuthError();
      setShowLogin(false);
      setShowSignup(false);
      setTeacherAddParentEmail(teacherEmail);
      return;
    }
    setShowLogin(true);
  }, [authError]);
  const heroEnter = useRef(new Animated.Value(0)).current;
  const sectionsEnter = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<any>(null);
  const sectionOffsets = useRef<Record<string, number>>({});

  function scrollToSection(name: string) {
    const offset = sectionOffsets.current[name];
    if (offset !== undefined && scrollRef.current) {
      scrollRef.current.scrollTo({ y: offset, animated: true });
    }
  }

  const [legalModal, setLegalModal] = useState<{ title: string; body: string } | null>(null);

  const LEGAL_CONTENT: Record<string, string> = {
    'Privacy Policy': 'Aivorah collects only the information necessary to personalise your learning experience: name, email, grade, and curriculum. We never sell your data. All data is encrypted in transit and at rest. Parents can request deletion of their child\'s data at any time by emailing aivorah24@gmail.com.',
    'Terms of Service': 'By using Aivorah, you agree to use the platform for educational purposes only. Aivorah is provided "as is" for the 2026 pilot. We reserve the right to update these terms. Continued use of the platform constitutes acceptance of any changes.',
    'Cookie Policy': 'Aivorah uses essential cookies only to keep you logged in and remember your preferences. We do not use advertising or tracking cookies. You can clear cookies at any time through your browser settings.',
  };

  function handleFooterLink(item: string) {
    const scrollTargets: Record<string, string> = {
      'Features': 'Features',
      'About Us': 'About',
      'Contact':  'Contact',
    };
    if (scrollTargets[item]) {
      scrollToSection(scrollTargets[item]);
      return;
    }
    if (LEGAL_CONTENT[item]) {
      setLegalModal({ title: item, body: LEGAL_CONTENT[item] });
      return;
    }
    // Coming soon items
    setLegalModal({ title: item, body: `${item} is coming soon. Stay tuned for updates from Aivorah!` });
  }

  function switchToSignup() { setShowLogin(false); setTimeout(() => setShowSignup(true), 200); }
  function switchToLogin()  { setShowSignup(false); setShowForgot(false); setTimeout(() => setShowLogin(true), 200); }
  function switchToForgot() { setShowLogin(false); setTimeout(() => setShowForgot(true), 200); }
  const ADMIN_EMAILS = new Set([
    'admin@aivorah.ai',
    'preddy6678@gmail.com',
  ]);

  function openAdminPanel() {
    let adminEmail = '';
    if (Platform.OS === 'web') {
      const webWindow = (globalThis as any).window;
      const entered = webWindow?.prompt?.('Enter admin email for access') || '';
      adminEmail = String(entered).trim().toLowerCase();
    } else {
      Alert.alert('Admin Access', 'Open admin from web and enter your admin email.');
      return;
    }

    if (!adminEmail) return;

    if (!ADMIN_EMAILS.has(adminEmail)) {
      Alert.alert('Access Denied', 'This email is not authorized for admin access.');
      return;
    }

    if (Platform.OS === 'web') {
      const win = (globalThis as any).window;
      const adminUrl = `/admin/panel?email=${encodeURIComponent(adminEmail)}`;
      win?.location?.assign?.(adminUrl);
      return;
    }

    const adminUrl = `http://localhost:3001/admin/panel?email=${encodeURIComponent(adminEmail)}`;
    Linking.openURL(adminUrl).catch(() => {
      Alert.alert('Unable to open admin panel', `Open this URL manually:\n${adminUrl}`);
    });
  }
  useEffect(() => {
    Animated.parallel([
      Animated.timing(heroEnter, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(sectionsEnter, {
        toValue: 1,
        duration: 700,
        delay: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [heroEnter, sectionsEnter]);

  function openSignupWithRole(_role: UserRole) { setShowSignup(true); }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <BackgroundOrbs />

      {/* ── STICKY NAVBAR ─────────────────────────────── */}
      <View style={s.navbar}>
        <View style={s.navInner}>
          {/* Brand */}
          <View style={s.navBrand}>
            <View style={s.navLogoBox}>
              <Feather name="zap" size={18} color={CYAN} />
            </View>
            <Text style={s.navBrandText}>Aivorah</Text>
          </View>

          {/* Nav links (desktop only) */}
          {IS_LARGE && (
            <View style={s.navLinks}>
              {['Features', 'About', 'Contact'].map(l => (
                <TouchableOpacity key={l} onPress={() => scrollToSection(l)} activeOpacity={0.7}>
                  <Text style={s.navLink}>{l}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Actions */}
          <View style={s.navActions}>
            <GhostButton label="Login" onPress={() => setShowLogin(true)} />
            <GradientButton label="Get Started" onPress={() => setShowSignup(true)} style={{ paddingHorizontal: 4 }} />
          </View>
        </View>
      </View>

      {/* ── SCROLLABLE PAGE ───────────────────────────── */}
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={s.pageContent}>

        {/* ── HERO ──────────────────────────────────── */}
        <Animated.View
          style={[
            s.heroSection,
            {
              opacity: heroEnter,
              transform: [
                {
                  translateY: heroEnter.interpolate({
                    inputRange: [0, 1],
                    outputRange: [24, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={s.eyebrow}>
            <Feather name="star" size={12} color={CYAN} />
            <Text style={s.eyebrowText}>Built for modern classrooms</Text>
          </View>
          <Text style={s.heroTitle}>
            <Text style={s.gradientText}>AI-Powered</Text>
            {'\n'}Learning Platform
          </Text>
          <Text style={s.heroSub}>
            Empower your educational journey with intelligent insights, personalized tutoring, and seamless progress tracking for everyone involved.
          </Text>
          <View style={s.heroActions}>
            <GradientButton
              label="Start Learning Free"
              onPress={() => setShowSignup(true)}
              style={{ paddingHorizontal: 8 }}
              textStyle={{ fontSize: 16 }}
            />
            <GhostButton label="Book a Demo" onPress={() => {}} style={{ paddingHorizontal: 24, paddingVertical: 14 }} />
          </View>

          {/* ── DEMO QUICK ACCESS ─── */}
          <View style={s.demoStrip}>
            <Text style={s.demoStripLabel}>Quick Demo Access</Text>
            <View style={s.demoRow}>
              {([
                { role: 'student', label: 'Student', icon: 'book-open', color: CYAN },
                { role: 'teacher', label: 'Teacher', icon: 'users', color: PURPLE },
                { role: 'parent', label: 'Parent', icon: 'heart', color: GREEN },
              ] as const).map(d => (
                <TouchableOpacity
                  key={d.role}
                  style={[s.demoBtn, { borderColor: d.color + '60' }]}
                  onPress={() => demoLogin(d.role)}
                  activeOpacity={0.8}
                >
                  <Feather name={d.icon} size={14} color={d.color} />
                  <Text style={[s.demoBtnText, { color: d.color }]}>{d.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Test Accounts Expander */}
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, alignSelf: 'center' }}
              onPress={() => setShowTestAccounts(v => !v)}
              activeOpacity={0.7}
            >
              <Feather name="database" size={12} color={MUTED} />
              <Text style={{ fontSize: 11, color: MUTED, fontWeight: '600' }}>Test Accounts with Real Data</Text>
              <Feather name={showTestAccounts ? 'chevron-up' : 'chevron-down'} size={12} color={MUTED} />
            </TouchableOpacity>

            {showTestAccounts && (
              <View style={{ marginTop: 10, gap: 8 }}>
                {/* Curriculum toggle */}
                <View style={{ flexDirection: 'row', alignSelf: 'center', borderRadius: 20, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' }}>
                  {(['IB PYP', 'NCERT', 'CBSE'] as const).map(c => (
                    <TouchableOpacity
                      key={c}
                      style={{ paddingHorizontal: 14, paddingVertical: 5, backgroundColor: testCurriculum === c ? CYAN + '22' : 'transparent' }}
                      onPress={() => setTestCurriculum(c)}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '700', color: testCurriculum === c ? CYAN : DIM }}>
                        {c}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {({
                  'IB PYP': [
                    { label: 'Students', color: CYAN, accounts: [
                      { name: 'Aanya Kapoor', email: 'aanya@test.ai',  sub: 'Grade 3 · IB PYP' },
                      { name: 'Ishaan Mehta', email: 'ishaan@test.ai', sub: 'Grade 4 · IB PYP' },
                      { name: 'Rohan Patel',  email: 'rohan@test.ai',  sub: 'Grade 5 · IB PYP' },
                      { name: 'Diya Sharma',  email: 'diya@test.ai',   sub: 'Grade 3 · IB PYP' },
                    ]},
                    { label: 'Teachers', color: PURPLE, accounts: [
                      { name: 'Ms. Anjali Kumar', email: 'anjali@test.ai',  sub: 'Grade 4 & 5 · IB PYP' },
                      { name: 'Priya Kapoor',     email: 'priya.k@test.ai', sub: 'Grade 3 · Teacher + Parent' },
                      { name: 'Vikram Sharma',    email: 'vikram@test.ai',  sub: 'Grade 3 & 4 · Teacher + Parent' },
                    ]},
                    { label: 'Parents', color: GREEN, accounts: [
                      { name: 'Suresh Mehta', email: 'suresh@test.ai', sub: 'Parent of Ishaan' },
                      { name: 'Deepa Patel',  email: 'deepa@test.ai',  sub: 'Parent of Rohan' },
                    ]},
                  ],
                  'NCERT': [
                    { label: 'Students', color: AMBER, accounts: [
                      { name: 'Arjun Sharma', email: 'arjun@test.ai', sub: 'Grade 3 · NCERT' },
                      { name: 'Priya Nair',   email: 'priya@test.ai', sub: 'Grade 3 · NCERT' },
                      { name: 'Kavya Reddy',  email: 'kavya@test.ai', sub: 'Grade 5 · NCERT' },
                    ]},
                  ],
                  'CBSE': [
                    { label: 'Students', color: CYAN, accounts: [
                      { name: 'Tanvi Gupta',  email: 'tanvi@test.ai',  sub: 'Grade 3 · CBSE' },
                      { name: 'Meera Joshi',  email: 'meera@test.ai',  sub: 'Grade 4 · CBSE' },
                      { name: 'Vivaan Kumar', email: 'vivaan@test.ai', sub: 'Grade 5 · CBSE' },
                      { name: 'Aarav Singh',  email: 'aarav@test.ai',  sub: 'Grade 6 · CBSE' },
                    ]},
                  ],
                }[testCurriculum] as { label: string; color: string; accounts: { name: string; email: string; sub: string }[] }[]).map(group => (
                  <View key={group.label}>
                    <Text style={{ fontSize: 10, color: group.color, fontWeight: '700', marginBottom: 4, letterSpacing: 0.5 }}>
                      {group.label.toUpperCase()}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {group.accounts.map(acc => (
                        <TouchableOpacity
                          key={acc.email}
                          style={{ backgroundColor: group.color + '12', borderWidth: 1, borderColor: group.color + '40', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, minWidth: 140 }}
                          onPress={() => testLogin(acc.email)}
                          activeOpacity={0.8}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '700', color: FORE }}>{acc.name}</Text>
                          <Text style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{acc.sub}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </Animated.View>

        {/* ── STATS BAR ─────────────────────────────── */}
        <Animated.View
          style={[
            s.statsBar,
            {
              opacity: sectionsEnter,
              transform: [
                {
                  translateY: sectionsEnter.interpolate({
                    inputRange: [0, 1],
                    outputRange: [28, 0],
                  }),
                },
              ],
            },
          ]}
        >
          {STATS.map((st, i) => (
            <View key={st.label} style={[s.statItem, i < STATS.length - 1 && s.statDivider]}>
              <View style={[s.statIconBox, { backgroundColor: st.color + '18' }]}>
                <Feather name={st.icon as any} size={16} color={st.color} />
              </View>
              <View>
                <Text style={s.statValue}>{st.value}</Text>
                <Text style={s.statLabel}>{st.label}</Text>
              </View>
            </View>
          ))}
        </Animated.View>

        {/* ── ROLES ─────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Built for Everyone in the Classroom</Text>
          <Text style={s.sectionSub}>One platform, three powerful experiences — each designed around what you actually need.</Text>
          <View style={[s.grid3, IS_LARGE && { flexDirection: 'row' }]}>
            {ROLES_DATA.map(r => (
              <TouchableOpacity
                key={r.title}
                style={[s.roleCard, IS_LARGE && { flex: 1 }, { borderTopColor: r.color, borderTopWidth: 2 }]}
                onPress={() => openSignupWithRole(r.role)}
                activeOpacity={0.85}
              >
                <View style={[s.cardIconWrap, { backgroundColor: r.color + '15' }]}>
                  <Feather name={r.icon as any} size={22} color={r.color} />
                </View>
                <Text style={s.cardTitle}>{r.title}</Text>
                <Text style={[s.roleTagline, { color: r.color }]}>{r.tagline}</Text>
                <View style={s.benefitsList}>
                  {r.benefits.map(b => (
                    <View key={b} style={s.benefitRow}>
                      <Feather name="check" size={12} color={r.color} style={{ marginTop: 1 }} />
                      <Text style={s.benefitText}>{b}</Text>
                    </View>
                  ))}
                </View>
                <View style={[s.cardCta, { marginTop: 20 }]}>
                  <Text style={[s.cardCtaText, { color: r.color }]}>Get started free</Text>
                  <Feather name="arrow-right" size={13} color={r.color} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── HOW IT WORKS ──────────────────────────── */}
        <View style={[s.section, { backgroundColor: 'rgba(20,24,22,0.88)' }]}>
          <Text style={s.sectionTitle}>How It Works</Text>
          <Text style={s.sectionSub}>Get from sign-up to personalized learning in under 3 minutes.</Text>
          <View style={[s.howRow, IS_LARGE && { flexDirection: 'row' }]}>
            {HOW_IT_WORKS.map((step, i) => (
              <View key={step.step} style={[s.howCard, IS_LARGE && { flex: 1 }]}>
                {/* Connector line */}
                {IS_LARGE && i < HOW_IT_WORKS.length - 1 && (
                  <View style={s.connector} />
                )}
                <View style={s.howStepBadge}>
                  <Text style={s.howStepNum}>{step.step}</Text>
                </View>
                <View style={s.howIconCircle}>
                  <Feather name={step.icon as any} size={24} color={CYAN} />
                </View>
                <Text style={s.howTitle}>{step.title}</Text>
                <Text style={s.howDesc}>{step.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── FEATURES ──────────────────────────────── */}
        <View style={s.section} onLayout={e => { sectionOffsets.current['Features'] = e.nativeEvent.layout.y; }}>
          <Text style={s.sectionTitle}>Powerful Features</Text>
          <Text style={s.sectionSub}>Everything you need to accelerate learning and improve outcomes — all in one place.</Text>
          <View style={[s.grid2, IS_LARGE && { flexDirection: 'row', flexWrap: 'wrap', gap: 20 }]}>
            {FEATURES_DATA.map(f => (
              <View key={f.title} style={[s.card, IS_LARGE && { width: '48%' }]}>
                <View style={s.cardIconWrap}>
                  <Feather name={f.icon as any} size={22} color={CYAN} />
                </View>
                <Text style={s.cardTitle}>{f.title}</Text>
                <Text style={s.cardDesc}>{f.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── CTA ───────────────────────────────────── */}
        <View style={s.section}>
          <View style={s.ctaCard}>
            <Text style={s.ctaTitle}>Ready to transform learning?</Text>
            <Text style={s.ctaSub}>Join thousands of students, teachers, and parents using Aivorah today.</Text>
            <GradientButton label="Create Free Account" onPress={() => setShowSignup(true)} style={{ alignSelf: 'center', paddingHorizontal: 8 }} textStyle={{ fontSize: 16 }} />
          </View>
        </View>

        {/* ── ABOUT ─────────────────────────────────── */}
        <View style={s.section} onLayout={e => { sectionOffsets.current['About'] = e.nativeEvent.layout.y; }}>
          <Text style={s.sectionTitle}>About Aivorah</Text>
          <Text style={s.sectionSub}>We believe every child deserves a patient, personalised tutor. Not just the privileged few.</Text>
          <View style={[s.grid2, IS_LARGE && { flexDirection: 'row', gap: 24 }]}>
            <View style={[s.howCard, { flex: 1 }]}>
              <Feather name="target" size={22} color={CYAN} style={{ marginBottom: 12 }} />
              <Text style={s.howTitle}>Our Mission</Text>
              <Text style={s.howDesc}>Aivorah is an AI-powered adaptive learning platform designed to personalise education for every student. We believe every child deserves a patient, intelligent tutor. Our mission is to make quality education accessible to all.</Text>
            </View>
            <View style={[s.howCard, { flex: 1 }]}>
              <Feather name="users" size={22} color={CYAN} style={{ marginBottom: 12 }} />
              <Text style={s.howTitle}>Who We Serve</Text>
              <Text style={s.howDesc}>We bridge students, teachers, and parents in one platform. Teachers get AI-powered insights. Parents track their child's progress. Students get a tireless, encouraging AI tutor available 24/7.</Text>
            </View>
            <View style={[s.howCard, { flex: 1 }]}>
              <Feather name="heart" size={22} color={CYAN} style={{ marginBottom: 12 }} />
              <Text style={s.howTitle}>Our Philosophy</Text>
              <Text style={s.howDesc}>"Equality of IQ is a myth. But every kid can perform at their own 80%." We meet students where they are, build confidence, and guide them upward — never letting them quit feeling defeated.</Text>
            </View>
          </View>
        </View>

        {/* ── CONTACT ───────────────────────────────── */}
        <View style={s.section} onLayout={e => { sectionOffsets.current['Contact'] = e.nativeEvent.layout.y; }}>
          <Text style={s.sectionTitle}>Get in Touch</Text>
          <Text style={s.sectionSub}>Have questions? We'd love to hear from you.</Text>
          <View style={[s.grid2, IS_LARGE && { flexDirection: 'row', gap: 24, justifyContent: 'center' }]}>
            <View style={[s.howCard, { flex: 1, alignItems: 'center' }]}>
              <Feather name="mail" size={24} color={CYAN} style={{ marginBottom: 12 }} />
              <Text style={s.howTitle}>Email Us</Text>
              <Text style={[s.howDesc, { textAlign: 'center' }]}>aivorah24@gmail.com</Text>
            </View>
            <View style={[s.howCard, { flex: 1, alignItems: 'center' }]}>
              <Feather name="map-pin" size={24} color={CYAN} style={{ marginBottom: 12 }} />
              <Text style={s.howTitle}>Location</Text>
              <Text style={[s.howDesc, { textAlign: 'center' }]}>Hyderabad, India</Text>
              <Text style={[s.howDesc, { textAlign: 'center', marginTop: 4 }]}>Pilot: IB PYP Grades 3–5</Text>
            </View>
            <View style={[s.howCard, { flex: 1, alignItems: 'center' }]}>
              <Feather name="globe" size={24} color={CYAN} style={{ marginBottom: 12 }} />
              <Text style={s.howTitle}>Website</Text>
              <Text style={[s.howDesc, { textAlign: 'center' }]}>aivorah.ai</Text>
              <Text style={[s.howDesc, { textAlign: 'center', marginTop: 4 }]}>Coming April 2026</Text>
            </View>
          </View>
        </View>

        {/* ── FOOTER ────────────────────────────────── */}
        <View style={s.footer}>
          <View style={s.footerTop}>
            <View style={{ maxWidth: 280, marginBottom: IS_LARGE ? 0 : 32 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Feather name="zap" size={18} color={CYAN} />
                <Text style={s.footerBrandText}>Aivorah</Text>
              </View>
              <Text style={s.footerBrandDesc}>Empowering the next generation of learners with artificial intelligence.</Text>
            </View>

            {IS_LARGE && (
              <View style={{ flexDirection: 'row', gap: 48 }}>
                {[
                  { heading: 'Product', items: ['Features', 'Pricing', 'Use Cases', 'Integrations'] },
                  { heading: 'Company', items: ['About Us', 'Careers', 'Blog', 'Contact'] },
                  { heading: 'Legal',   items: ['Privacy Policy', 'Terms of Service', 'Cookie Policy'] },
                ].map(col => (
                  <View key={col.heading} style={{ minWidth: 120 }}>
                    <Text style={s.footerColHead}>{col.heading}</Text>
                    {col.items.map(item => (
                      <TouchableOpacity key={item} onPress={() => handleFooterLink(item)} activeOpacity={0.7}>
                        <Text style={s.footerColItem}>{item}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={s.footerBottom}>
            <Text style={s.footerCopy}>© 2026 Aivorah. All rights reserved.</Text>
            <Text style={s.footerCopy}>Made with ❤️ for learners everywhere</Text>
          </View>
        </View>

      </ScrollView>

      {/* ── LEGAL MODAL ──────────────────────────── */}
      <Modal visible={!!legalModal} transparent animationType="fade" onRequestClose={() => setLegalModal(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#1a1a1a', borderRadius: 16, borderWidth: 1, borderColor: '#333', padding: 28, width: '100%', maxWidth: 480, gap: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#fff' }}>{legalModal?.title}</Text>
              <TouchableOpacity onPress={() => setLegalModal(null)}><Feather name="x" size={20} color="#888" /></TouchableOpacity>
            </View>
            <Text style={{ fontSize: 14, color: '#aaa', lineHeight: 22 }}>{legalModal?.body}</Text>
            <TouchableOpacity onPress={() => setLegalModal(null)} style={{ backgroundColor: CYAN + '22', borderWidth: 1, borderColor: CYAN, borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}>
              <Text style={{ color: CYAN, fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── AUTH MODALS ───────────────────────────── */}
      <LoginModal
        visible={showLogin}
        onClose={() => { setShowLogin(false); clearAuthError(); }}
        onSwitchSignup={switchToSignup}
        onSwitchForgot={switchToForgot}
        signInEmail={signInWithEmail}
        signInGoogle={signInWithGoogle}
        addParentRoleSSO={addParentRoleToTeacherSSO}
        externalError={authError}
        onClearExternalError={clearAuthError}
      />
      <SignupModal
        visible={showSignup}
        onClose={() => setShowSignup(false)}
        onSwitchLogin={switchToLogin}
        signUpEmail={signUpWithEmail}
        signInGoogle={signInWithGoogle}
        addParentRole={addParentRoleToTeacher}
        addParentRoleSSO={addParentRoleToTeacherSSO}
      />
      <ForgotModal
        visible={showForgot}
        onClose={() => setShowForgot(false)}
        onSwitchLogin={switchToLogin}
      />

      {/* ── TEACHER → PARENT CLUB MODAL ──────────────────── */}
      <Modal visible={!!teacherAddParentEmail} transparent animationType="fade" onRequestClose={() => { setTeacherAddParentEmail(null); logout(); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: c.cardDark, borderRadius: 20, borderWidth: 1, borderColor: c.borderColor, padding: 32, width: '100%', maxWidth: 420, alignItems: 'center', gap: 16 }}>
            {/* Icon */}
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.primary + '20', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.primary + '40' }}>
              <Feather name="users" size={26} color={c.primary} />
            </View>
            {/* Title */}
            <Text style={{ fontSize: 22, fontWeight: '800', color: c.textMain, textAlign: 'center', letterSpacing: -0.3 }}>
              Teacher Account Found
            </Text>
            {/* Body */}
            <Text style={{ fontSize: 14, color: c.textMuted, textAlign: 'center', lineHeight: 22 }}>
              This email is already registered as a{' '}
              <Text style={{ color: c.primary, fontWeight: '700' }}>Teacher</Text>.
              {'\n\n'}
              Would you like to add a{' '}
              <Text style={{ color: c.accentGreen, fontWeight: '700' }}>Parent</Text>
              {' '}profile? Both profiles will be linked and you can switch between them anytime.
            </Text>
            {/* Yes button */}
            <TouchableOpacity
              style={{ backgroundColor: c.primary, borderRadius: 12, paddingVertical: 15, width: '100%', alignItems: 'center', opacity: addingParentRole ? 0.6 : 1, marginTop: 4 }}
              disabled={addingParentRole}
              activeOpacity={0.85}
              onPress={async () => {
                if (!teacherAddParentEmail) return;
                setAddingParentRole(true);
                try {
                  await addParentRoleToTeacherSSO(teacherAddParentEmail);
                  setTeacherAddParentEmail(null);
                } catch {
                  setTeacherAddParentEmail(null);
                } finally {
                  setAddingParentRole(false);
                }
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                {addingParentRole ? 'Setting up...' : 'Yes, Add Parent Profile'}
              </Text>
            </TouchableOpacity>
            {/* No button */}
            <TouchableOpacity style={{ paddingVertical: 8 }} onPress={() => { setTeacherAddParentEmail(null); logout(); }}>
              <Text style={{ color: c.textDim, fontSize: 13 }}>No, sign out</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────
const s = StyleSheet.create({
  pageContent: { paddingBottom: 12 },
  bgOrbTop: {
    position: 'absolute',
    width: 480,
    height: 480,
    borderRadius: 240,
    backgroundColor: 'rgba(195,220,216,0.10)',  // sage mint glow
    top: -220,
    left: -160,
  },
  bgOrbMid: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: 'rgba(239,209,212,0.08)',  // dusty rose glow
    top: 260,
    right: -180,
  },
  bgOrbBottom: {
    position: 'absolute',
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: 'rgba(197,189,150,0.07)',  // khaki gold glow
    bottom: 10,
    left: -120,
  },
  // ── Navbar
  navbar: {
    height: 72,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: 'rgba(15,15,15,0.92)',
    ...(IS_WEB ? { position: 'sticky', top: 0, zIndex: 100 } as any : {}),
  },
  navInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: IS_LARGE ? 48 : 20,
  },
  navBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  navLogoBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(195,220,216,0.18)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(195,220,216,0.4)' },
  navBrandText: { fontSize: 20, fontWeight: '700', color: FORE, letterSpacing: -0.3 },
  navLinks: { flexDirection: 'row', gap: 32 },
  navLink: { fontSize: 14, fontWeight: '500', color: MUTED },
  navActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },

  ghostBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: 'rgba(195,220,216,0.06)' },
  ghostBtnText: { fontSize: 14, fontWeight: '500', color: FORE },

  // ── Sections
  section: { paddingVertical: 72, paddingHorizontal: IS_LARGE ? 80 : 20 },

  sectionTitle: { fontSize: IS_LARGE ? 36 : 28, fontWeight: '700', color: FORE, textAlign: 'center', marginBottom: 14, letterSpacing: -0.4 },
  sectionSub: { fontSize: 17, color: MUTED, textAlign: 'center', maxWidth: 600, alignSelf: 'center', lineHeight: 26, marginBottom: 44 },

  // ── Hero
  heroSection: { paddingTop: 92, paddingBottom: 88, paddingHorizontal: IS_LARGE ? 80 : 20, alignItems: 'center' },
  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(195,220,216,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(195,220,216,0.35)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginBottom: 16,
  },
  eyebrowText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: '#C3DCD8' },
  heroTitle: { fontSize: IS_LARGE ? 62 : 42, fontWeight: '800', letterSpacing: -1.5, lineHeight: IS_LARGE ? 74 : 52, textAlign: 'center', color: FORE, marginBottom: 22 },
  gradientText: { color: CYAN },
  heroSub: { fontSize: IS_LARGE ? 20 : 16, color: MUTED, textAlign: 'center', maxWidth: 680, lineHeight: 28, marginBottom: 36 },
  heroActions: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', justifyContent: 'center' },
  demoStrip: {
    marginTop: 32, alignItems: 'center', gap: 10, width: '100%', maxWidth: 820,
    backgroundColor: 'rgba(28,28,28,0.90)', borderRadius: 20,
    borderWidth: 1, borderColor: BORDER, padding: 20,
    shadowColor: '#93B0AC', shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
  },
  demoStripLabel: { fontSize: 11, fontWeight: '700', color: MUTED, letterSpacing: 0.8, textTransform: 'uppercase' },
  demoRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  demoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1.2,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  demoBtnText: { fontSize: 13, fontWeight: '700' },

  // ── Stats bar
  statsBar: {
    flexDirection: IS_LARGE ? 'row' : 'column',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: IS_LARGE ? 24 : 20,
    paddingHorizontal: IS_LARGE ? 80 : 20,
    gap: IS_LARGE ? 0 : 20,
    marginHorizontal: IS_LARGE ? 32 : 16,
    borderRadius: 20,
  },
  statItem: { flex: IS_LARGE ? 1 : undefined, flexDirection: 'row', alignItems: 'center', gap: 14, justifyContent: IS_LARGE ? 'center' : 'flex-start', paddingVertical: 4 },
  statDivider: IS_LARGE ? { borderRightWidth: 1, borderRightColor: BORDER } : {},
  statIconBox: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: IS_LARGE ? 22 : 20, fontWeight: '800', color: FORE, letterSpacing: -0.5 },
  statLabel: { fontSize: 12, color: MUTED, marginTop: 1 },

  // ── Cards grid
  grid3: { gap: 20 },
  grid2: { gap: 20 },
  card: {
    backgroundColor: 'rgba(28,28,28,0.92)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 28,
  },
  roleCard: {
    backgroundColor: 'rgba(28,28,28,0.92)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 28,
    overflow: 'hidden',
  },
  cardIconWrap: { width: 52, height: 52, borderRadius: 12, backgroundColor: 'rgba(195,220,216,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  cardTitle: { fontSize: 20, fontWeight: '700', color: FORE, marginBottom: 6 },
  roleTagline: { fontSize: 14, fontWeight: '500', marginBottom: 20, lineHeight: 20 },
  cardDesc: { fontSize: 15, color: MUTED, lineHeight: 24 },
  cardCta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardCtaText: { fontSize: 13, fontWeight: '600' },
  benefitsList: { gap: 10 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  benefitText: { fontSize: 14, color: MUTED, flex: 1, lineHeight: 20 },

  // ── How it works
  howRow: { gap: 24 },
  howCard: {
    backgroundColor: 'rgba(28,28,28,0.92)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 28,
    alignItems: 'flex-start',
    position: 'relative',
  },
  connector: {
    position: 'absolute',
    top: 40,
    right: -12,
    width: 24,
    height: 2,
    backgroundColor: BORDER,
    zIndex: 1,
  },
  howStepBadge: {
    backgroundColor: 'rgba(195,220,216,0.15)',
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 16,
  },
  howStepNum: { fontSize: 11, fontWeight: '800', color: CYAN, letterSpacing: 0.5 },
  howIconCircle: { width: 56, height: 56, borderRadius: 14, backgroundColor: 'rgba(195,220,216,0.12)', borderWidth: 1, borderColor: 'rgba(195,220,216,0.28)', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  howTitle: { fontSize: 18, fontWeight: '700', color: FORE, marginBottom: 10 },
  howDesc: { fontSize: 14, color: MUTED, lineHeight: 22 },

  // ── CTA
  badge: { backgroundColor: 'rgba(195,220,216,0.14)', borderRadius: 99, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(195,220,216,0.25)' },
  badgeText: { fontSize: 12, fontWeight: '600', color: '#C3DCD8' },
  ctaCard: {
    borderWidth: 1,
    borderColor: 'rgba(195,220,216,0.25)',
    borderRadius: 20,
    padding: IS_LARGE ? 64 : 36,
    alignItems: 'center',
    backgroundColor: 'rgba(28,36,32,0.55)',
  },
  ctaTitle: { fontSize: IS_LARGE ? 40 : 28, fontWeight: '700', color: FORE, marginBottom: 14, textAlign: 'center' },
  ctaSub: { fontSize: 18, color: MUTED, marginBottom: 30, textAlign: 'center', lineHeight: 28 },

  // ── Footer
  footer: { borderTopWidth: 1, borderTopColor: BORDER, paddingVertical: 56, paddingHorizontal: IS_LARGE ? 80 : 20, backgroundColor: 'rgba(15,15,15,0.85)' },
  footerTop: { flexDirection: IS_LARGE ? 'row' : 'column', justifyContent: 'space-between', marginBottom: 44 },
  footerBrandText: { fontSize: 18, fontWeight: '700', color: FORE },
  footerBrandDesc: { fontSize: 14, color: MUTED, lineHeight: 22 },
  footerColHead: { fontSize: 14, fontWeight: '600', color: FORE, marginBottom: 14 },
  footerColItem: { fontSize: 14, color: MUTED, marginBottom: 10 },
  footerBottom: { borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 22, flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  footerCopy: { fontSize: 13, color: DIM },

  // ── Modal
  overlay: { position: 'absolute' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: WIN_W < 400 ? 12 : 20, paddingVertical: 20 },
  overlayBg: { position: 'absolute' as any, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)' },
  modal: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16, padding: WIN_W < 400 ? 18 : 36, width: '100%', maxWidth: 460, alignSelf: 'center', position: 'relative' },
  modalClose: { position: 'absolute', top: 14, right: 14, padding: 6, borderRadius: 6 },
  modalTitle: { fontSize: 24, fontWeight: '700', color: FORE, marginBottom: 6 },
  modalSubtitle: { fontSize: 14, color: MUTED, marginBottom: 24 },

  // Role chips
  roleChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: BORDER },
  roleChipActive: { borderColor: CYAN, backgroundColor: 'rgba(147,176,172,0.18)' },
  roleChipText: { fontSize: 13, fontWeight: '500', color: MUTED },
  roleChipTextActive: { color: CYAN },

  // Google button
  googleBtn: { width: '100%', paddingVertical: 11, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#dadce0', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 4 },
  googleBtnText: { fontSize: 14, fontWeight: '500', color: '#3c4043' },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  divLine: { flex: 1, height: 1, backgroundColor: BORDER },
  divText: { fontSize: 12, color: MUTED },

  // Form
  formLabel: { fontSize: 13, fontWeight: '500', color: '#d4d4d8' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: BG, borderWidth: 1, borderColor: BORDER, borderRadius: 7, paddingHorizontal: 14, height: 44, marginTop: 6 },
  input: { flex: 1, fontSize: 14, color: FORE },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(255,92,124,0.08)', borderWidth: 1, borderColor: 'rgba(255,92,124,0.25)', borderRadius: 7, padding: 12, marginBottom: 12 },
  errorText: { fontSize: 12, color: RED, flex: 1 },

  successBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(90,138,112,0.12)', borderWidth: 1, borderColor: 'rgba(90,138,112,0.3)', borderRadius: 7, padding: 14, marginBottom: 16 },
  successText: { fontSize: 13, color: GREEN, flex: 1 },

  formFooter: { flexDirection: 'row', justifyContent: 'center', marginTop: 18 },
  footerText: { fontSize: 13, color: MUTED },
  linkText: { fontSize: 13, color: CYAN, fontWeight: '500' },
});
