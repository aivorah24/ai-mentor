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
  useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Path, Defs, LinearGradient as SvgGrad, Stop, Rect } from 'react-native-svg';
import { useAuth, UserRole } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import SERVER_URL from '../../config/serverUrl';

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────
// ── Enchanting Forest palette ─────────────────────────────
const BG        = '#050705';
const CARD      = '#101510';
const SURFACE   = '#151D17';
const BORDER    = 'rgba(197,255,218,0.18)';
const MUTED     = '#B6C7B9';
const DIM       = '#728173';
const FORE      = '#F5F7F0';
const CYAN      = '#B7F2C7';
const BLUE      = '#6FAF91';
const GREEN     = '#8FE6AE';
const AMBER     = '#F4B84A';
const RED       = '#E07F7F';
const PURPLE    = '#E8C77A';

// ── Lovable landing design palette (sage + gold on near-black) ────────────
// Kept separate from the shared tokens above so the auth modals stay untouched.
const LBG     = '#0B0B0B';
const LSURF   = '#141414';
const LSURF2  = '#101010';
const LLINE   = 'rgba(245,243,238,0.08)';
const LLINE2  = 'rgba(245,243,238,0.14)';
const LTEXT   = '#F5F3EE';
const LMUTED  = '#A9B0AC';
const SAGE    = '#9FB2A4';
const GOLD    = '#BAA467';
const SERIF   = Platform.OS === 'web' ? '"Fraunces", Georgia, serif' : 'Georgia';

const { width: WIN_W } = Dimensions.get('window');
const IS_WEB = Platform.OS === 'web';
const IS_LARGE = WIN_W >= 900;

function BackgroundOrbs() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <View style={s.bgWashTop} />
      <View style={s.bgWashMid} />
      <View style={s.bgGrid} />
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
            <Stop offset="0" stopColor="#8FE6AE" stopOpacity="1" />
            <Stop offset="0.58" stopColor="#B7F2C7" stopOpacity="1" />
            <Stop offset="1" stopColor="#F4B84A" stopOpacity="1" />
          </SvgGrad>
        </Defs>
        <Rect x="0" y="0" width={w} height={h} fill="url(#grad)" />
      </Svg>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 14 }}>
        {loading ? (
          <ActivityIndicator color="#061008" size="small" />
        ) : (
          <>
            {icon && <Feather name={icon as any} size={15} color="#061008" />}
            <Text style={[{ fontSize: 15, fontWeight: '700', color: '#061008' }, textStyle]}>{label}</Text>
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
  // Live viewport height — cap the modal body so it never spills past the screen
  // (e.g. short Mac windows). The body scrolls within this cap; the close button
  // stays pinned outside the scroll area so it's always reachable.
  const { height: winH } = useWindowDimensions();
  // Subtract overlay + modal chrome (~padding) so the whole card fits on screen,
  // with a sensible floor for very short windows.
  const bodyMaxHeight = Math.max(320, winH - 112);
  if (!visible) return null;
  return (
    <View style={s.overlay}>
      <TouchableOpacity activeOpacity={1} style={s.overlayBg} onPress={onClose} />
      <View style={[s.modal, { maxHeight: winH - 40 }]}>
        <TouchableOpacity style={s.modalClose} onPress={onClose}>
          <Feather name="x" size={18} color={MUTED} />
        </TouchableOpacity>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={{ maxHeight: bodyMaxHeight }}
          contentContainerStyle={{ paddingBottom: 4 }}
        >
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// Date of birth picker (themed calendar; outputs DD/MM/YYYY)
// ─────────────────────────────────────────────────────────
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function DobPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'days' | 'years'>('days');
  const today = new Date();
  // Parse existing value (DD/MM/YYYY) or default the view to ~10 years ago.
  const parsed = (() => {
    const p = value.split('/').map(Number);
    if (p.length === 3 && p[0] && p[1] && p[2]) return { d: p[0], m: p[1] - 1, y: p[2] };
    return null;
  })();
  const [view, setView] = useState({ y: parsed ? parsed.y : today.getFullYear() - 10, m: parsed ? parsed.m : 0 });

  const pad = (n: number) => String(n).padStart(2, '0');
  const selDay = parsed ? parsed.d : null;
  const selMonth = parsed ? parsed.m : null;
  const selYear = parsed ? parsed.y : null;

  function pick(d: number) {
    onChange(`${pad(d)}/${pad(view.m + 1)}/${view.y}`);
    setOpen(false);
  }
  function shiftMonth(delta: number) {
    let m = view.m + delta, y = view.y;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setView({ y, m });
  }
  function shiftYear(delta: number) {
    setView(v => ({ ...v, y: Math.min(today.getFullYear(), Math.max(1950, v.y + delta)) }));
  }

  const firstDay = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const years: number[] = [];
  for (let y = today.getFullYear(); y >= 1950; y--) years.push(y);

  const displayText = parsed ? `${pad(parsed.d)} ${MONTH_NAMES[parsed.m].slice(0,3)} ${parsed.y}` : 'Select your date of birth';

  return (
    <View style={{ marginBottom: 18, zIndex: open ? 50 : 1 }}>
      <Text style={s.formLabel}>{label}</Text>
      <TouchableOpacity
        activeOpacity={0.8}
        style={[s.inputWrap, open && { borderColor: CYAN }]}
        onPress={() => { setOpen(o => !o); setMode('days'); }}
      >
        <Text style={[s.input, { color: parsed ? FORE : DIM }]}>{displayText}</Text>
        <Feather name="calendar" size={15} color={DIM} />
      </TouchableOpacity>

      {open && (
        <View style={s.dobCal}>
          {/* Header */}
          <View style={s.dobHead}>
            <View style={s.dobNavGroup}>
              <TouchableOpacity onPress={() => shiftYear(-1)} style={s.dobNav}><Feather name="chevrons-left" size={16} color={FORE} /></TouchableOpacity>
              <TouchableOpacity onPress={() => shiftMonth(-1)} style={s.dobNav}><Feather name="chevron-left" size={16} color={FORE} /></TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => setMode(mode === 'years' ? 'days' : 'years')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={s.dobHeadLabel}>{MONTH_NAMES[view.m]} {view.y}</Text>
              <Feather name="chevron-down" size={14} color={MUTED} />
            </TouchableOpacity>
            <View style={s.dobNavGroup}>
              <TouchableOpacity onPress={() => shiftMonth(1)} style={s.dobNav}><Feather name="chevron-right" size={16} color={FORE} /></TouchableOpacity>
              <TouchableOpacity onPress={() => shiftYear(1)} style={s.dobNav}><Feather name="chevrons-right" size={16} color={FORE} /></TouchableOpacity>
            </View>
          </View>

          {mode === 'years' ? (
            <ScrollView style={{ maxHeight: 200 }}>
              <View style={s.dobYearGrid}>
                {years.map(y => (
                  <TouchableOpacity key={y} style={[s.dobYear, y === view.y && s.dobSel]} onPress={() => { setView(v => ({ ...v, y })); setMode('days'); }}>
                    <Text style={[s.dobYearTxt, y === view.y && { color: '#0b0b0b', fontWeight: '700' }]}>{y}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          ) : (
            <>
              <View style={s.dobDow}>
                {WEEKDAYS.map(w => <Text key={w} style={s.dobDowTxt}>{w}</Text>)}
              </View>
              <View style={s.dobGrid}>
                {cells.map((d, i) => {
                  if (d === null) return <View key={`e${i}`} style={s.dobCell} />;
                  const isFuture = new Date(view.y, view.m, d) > today;
                  const isSel = d === selDay && view.m === selMonth && view.y === selYear;
                  return (
                    <TouchableOpacity key={d} disabled={isFuture} style={[s.dobCell, isSel && s.dobSel]} onPress={() => pick(d)}>
                      <Text style={[s.dobCellTxt, isFuture && { color: DIM, opacity: 0.4 }, isSel && { color: '#0b0b0b', fontWeight: '700' }]}>{d}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </View>
      )}
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
  signInEmail: (email: string, pass: string) => Promise<void>;
  signInGoogle: (role?: UserRole) => Promise<void>;
  addParentRoleSSO: (email: string) => Promise<void>;
  externalError?: string | null;
  onClearExternalError?: () => void;
}) {
  // Sign-in needs NO role — returning users' role comes from their account.
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
    const emailTrim = email.replace(/\s+/g, '');
    const passTrim = pass.replace(/\s+/g, '');
    if (!emailTrim || !passTrim) { setError('Please fill in all fields.'); return; }
    setLoading(true);
    try { await signInEmail(emailTrim, passTrim); onClose(); }
    catch (e: any) { 
      setError(e.message || 'Something went wrong. Please try again.'); 
    }
    finally { setLoading(false); }
  }

  async function googleSignIn() {
    setError('');
    setGoogleLoading(true);
    try { await signInGoogle(); onClose(); }   // no role — returning user uses their stored role
    catch (e: any) {
      // Brand-new Google user used the "Welcome back" modal → send them to Sign-Up
      // to pick a role. Returning users never hit this (they have a stored role).
      if (e.message?.startsWith('NEW_GOOGLE_USER:')) {
        setGoogleLoading(false);
        onSwitchSignup();
        return;
      }
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
// CBSE follows the NCERT syllabus, so NCERT is not a separate board option (#157).
const CURRICULA = ['IB PYP', 'CBSE', 'ICSE', 'Cambridge'];

function SignupModal({ visible, onClose, onSwitchLogin, signUpEmail, signInGoogle, addParentRole, addParentRoleSSO }: {
  visible: boolean; onClose: () => void; onSwitchLogin: () => void;
  signUpEmail: (name: string, email: string, pass: string, role: UserRole, curriculum?: string) => Promise<void>;
  signInGoogle: (role: UserRole) => Promise<void>;
  addParentRole: (email: string, password: string) => Promise<void>;
  addParentRoleSSO: (email: string) => Promise<void>;
}) {
  const [role, setRole]             = useState<UserRole>('student');
  const [curriculum, setCurriculum] = useState('CBSE');
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
      // Persist the student's date of birth (collected here, not in onboarding).
      if (role === 'student' && dob.trim()) {
        fetch(`${SERVER_URL}/user/preferences`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailTrim.toLowerCase(), role: 'student', dob: dob.trim() }),
        }).catch(() => {});
      }
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

      {/* Role FIRST — chosen before Google SSO (and used for email signup too) */}
      <Text style={[s.formLabel, { marginBottom: 8 }]}>I'm creating an account as</Text>
      <RoleChips selected={role} onSelect={r => { setRole(r); setError(''); setDob(''); }} />

      {/* Under-14 notice — shown when student role selected */}
      {role === 'student' && (
        <View style={{ backgroundColor: '#0B0B0B', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(186,164,103,0.45)', marginTop: 12, marginBottom: 4 }}>
          <Text style={{ color: GOLD, fontSize: 12, lineHeight: 18 }}>
            Students aged 14 and above can register here.{'\n'}
            If you are under 14, ask your parent or teacher to create your account.
          </Text>
        </View>
      )}

      <TouchableOpacity style={[s.googleBtn, { marginTop: 16 }]} onPress={googleSignIn} activeOpacity={0.85}>
        {googleLoading ? <ActivityIndicator size="small" color="#3c4043" /> : <GoogleIcon />}
        <Text style={s.googleBtnText}>Sign up with Google</Text>
      </TouchableOpacity>

      <View style={s.divider}><View style={s.divLine} /><Text style={s.divText}>or continue with email</Text><View style={s.divLine} /></View>

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
        <DobPicker label="Date of birth" value={dob} onChange={setDob} />
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
      'AI Coach that explains concepts with patience',
      'Assignments with instant AI feedback',
      'Bedtime stories for a fun learning routine',
      'Earn XP, badges and climb the leaderboard',
      'Visual progress tracking across all subjects',
    ],
  },
  {
    icon: 'monitor', title: 'For Teachers', role: 'teacher' as UserRole,
    color: PURPLE, tagline: 'Save time, teach smarter',
    benefits: [
      'Assign and auto-grade student work with AI',
      'Spot struggling students before they fall behind',
      'Real-time class performance dashboards',
      'Schedule sessions and deadlines in one click',
      'Topic completion rate across your class',
    ],
  },
  {
    icon: 'users', title: 'For Parents', role: 'parent' as UserRole,
    color: GREEN, tagline: 'Stay connected to your child\'s journey',
    benefits: [
      'Live progress reports and milestone alerts',
      'Understand strengths and areas to improve',
      'Assign extra practice from home',
      'See upcoming deadlines and schedule',
      'Ask AI anytime for insights on your child\'s progress',
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
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, demoLogin, addParentRoleToTeacher, addParentRoleToTeacherSSO, authError, clearAuthError, logout } = useAuth();
  const [showLogin,    setShowLogin]    = useState(false);
  const [showSignup,   setShowSignup]   = useState(false);
  const [showForgot,   setShowForgot]   = useState(false);
  const [teacherAddParentEmail, setTeacherAddParentEmail] = useState<string | null>(null);
  const [addingParentRole, setAddingParentRole] = useState(false);

  // Open the login modal automatically when arriving with ?signin=1 — used after
  // email verification when the verify tab wasn't logged in (e.g. link opened in a
  // different browser/device), so the user can sign in and continue to onboarding.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('signin') === '1') {
      setShowLogin(true);
      // Clean the URL so a refresh doesn't keep re-opening it.
      window.history.replaceState(null, '', '/');
    }
  }, []);

  // Hidden demo access for sales/testing (the public buttons were removed).
  // e.g. localhost:3006/?demo=student | teacher | parent | super_admin
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const d = new URLSearchParams(window.location.search).get('demo');
    if (d && ['student', 'teacher', 'parent', 'super_admin'].includes(d)) {
      demoLogin(d as UserRole);
    }
  }, []);

  // Load the landing design fonts (Fraunces serif + Inter) once, on web.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (document.getElementById('aivorah-landing-fonts')) return;
    const link = document.createElement('link');
    link.id = 'aivorah-landing-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,300;1,9..144,400&family=Inter:wght@300;400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);

  // Remove the browser's default body margin so the embedded landing iframe
  // sits flush to the viewport edges (no thin gaps on the left/right).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (document.getElementById('aivorah-reset')) return;
    const style = document.createElement('style');
    style.id = 'aivorah-reset';
    style.textContent = 'html,body,#root{margin:0!important;padding:0!important;width:100%;overflow-x:hidden;background:#0B0B0B}';
    document.head.appendChild(style);
  }, []);

  // Embedded HTML landing (iframe) → open the REAL Login / Sign-up modal when its
  // buttons are tapped. The iframe postMessages {type:'aivorah-auth', mode}.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onMsg = (e: MessageEvent) => {
      if (e?.data?.type === 'aivorah-auth') {
        if (e.data.mode === 'login') setShowLogin(true);
        else setShowSignup(true);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

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
    'kannansaimohan2003@gmail.com',
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
    <View style={{ flex: 1, backgroundColor: LBG }}>
      {/* Landing rendered for both web and native */}
      {/* Marketing landing is the standalone HTML (server/public/landing.html),
          embedded full-screen. Its Login / Join buttons postMessage 'aivorah-auth'
          which the listener above turns into the real Login / Sign-up modals. */}
      {Platform.OS === 'web'
        ? React.createElement('iframe', {
            src: '/landing.html',
            title: 'Aivorah',
            style: { border: 'none', width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 },
          })
        : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <GradientButton label="Login" onPress={() => setShowLogin(true)} />
            <GhostButton label="Join Early Access" onPress={() => setShowSignup(true)} />
          </View>
        )
      }

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
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.accentYellow + '20', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.accentYellow + '40' }}>
              <Feather name="users" size={26} color={c.accentYellow} />
            </View>
            {/* Title */}
            <Text style={{ fontSize: 22, fontWeight: '800', color: c.textMain, textAlign: 'center', letterSpacing: 0 }}>
              Teacher Account Found
            </Text>
            {/* Body */}
            <Text style={{ fontSize: 14, color: c.textMuted, textAlign: 'center', lineHeight: 22 }}>
              This email is already registered as a{' '}
              <Text style={{ color: c.accentYellow, fontWeight: '700' }}>Teacher</Text>.
              {'\n\n'}
              Would you like to add a{' '}
              <Text style={{ color: c.accentGreen, fontWeight: '700' }}>Parent</Text>
              {' '}profile? Both profiles will be linked and you can switch between them anytime.
            </Text>
            {/* Yes button */}
            <TouchableOpacity
              style={{ backgroundColor: c.accentYellow, borderRadius: 12, paddingVertical: 15, width: '100%', alignItems: 'center', opacity: addingParentRole ? 0.6 : 1, marginTop: 4 }}
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
  bgWashTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 420,
    backgroundColor: 'rgba(143,230,174,0.08)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(244,184,74,0.10)',
  },
  bgWashMid: {
    position: 'absolute',
    top: 360,
    left: 0,
    right: 0,
    height: 520,
    backgroundColor: 'rgba(244,184,74,0.045)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(197,255,218,0.08)',
  },
  bgGrid: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    height: 620,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(197,255,218,0.06)',
    opacity: 0.75,
  },
  // ── Navbar
  navbar: {
    height: 72,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(197,255,218,0.14)',
    backgroundColor: 'rgba(5,7,5,0.94)',
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
  navLogoBox: { width: 30, height: 30, borderRadius: 8, backgroundColor: SAGE, alignItems: 'center', justifyContent: 'center' },
  navLogoMark: { fontFamily: SERIF, fontSize: 16, fontWeight: '600', color: LBG },
  navBrandText: { fontFamily: SERIF, fontSize: 22, fontWeight: '500', color: LTEXT, letterSpacing: -0.4 },
  navLinks: { flexDirection: 'row', gap: 32 },
  navLink: { fontSize: 14, fontWeight: '500', color: MUTED },
  navActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },

  ghostBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(183,242,199,0.24)', backgroundColor: 'rgba(16,21,16,0.72)' },
  ghostBtnText: { fontSize: 14, fontWeight: '600', color: CYAN },

  // ── Sections
  section: { paddingVertical: 72, paddingHorizontal: IS_LARGE ? 80 : 20 },

  sectionTitle: { fontSize: IS_LARGE ? 36 : 28, fontWeight: '700', color: FORE, textAlign: 'center', marginBottom: 14, letterSpacing: 0 },
  sectionSub: { fontSize: 17, color: MUTED, textAlign: 'center', maxWidth: 600, alignSelf: 'center', lineHeight: 26, marginBottom: 44 },

  // ── Hero
  heroSection: { paddingTop: 92, paddingBottom: 88, paddingHorizontal: IS_LARGE ? 80 : 20, alignItems: 'center' },
  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(245,243,238,0.02)',
    borderWidth: 1,
    borderColor: LLINE,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 18,
  },
  eyebrowDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: SAGE },
  eyebrowText: { fontSize: 11, fontWeight: '500', letterSpacing: 1.6, textTransform: 'uppercase', color: LMUTED },
  heroTitle: { fontFamily: SERIF, fontSize: IS_LARGE ? 86 : 46, fontWeight: '400', letterSpacing: IS_LARGE ? -3 : -1.5, lineHeight: IS_LARGE ? 88 : 48, textAlign: 'center', color: LTEXT, marginBottom: 24 },
  gradientText: { color: SAGE, fontStyle: 'italic', fontWeight: '300' },
  heroSub: { fontSize: IS_LARGE ? 19 : 16, color: LMUTED, textAlign: 'center', maxWidth: 580, lineHeight: 30, marginBottom: 34 },
  heroActions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'center' },
  heroTrust: { marginTop: 32, flexDirection: 'row', alignItems: 'flex-start', gap: 12, maxWidth: 560 },
  heroTrustText: { flex: 1, fontSize: 13.5, color: LMUTED, lineHeight: 20 },
  demoStrip: {
    marginTop: 32, alignItems: 'center', gap: 10, width: '100%', maxWidth: 820,
    backgroundColor: SURFACE, borderRadius: 8,
    borderWidth: 1, borderColor: BORDER, padding: 20,
    shadowColor: '#8FE6AE', shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
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
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: IS_LARGE ? 24 : 20,
    paddingHorizontal: IS_LARGE ? 80 : 20,
    gap: IS_LARGE ? 0 : 20,
    marginHorizontal: IS_LARGE ? 32 : 16,
    borderRadius: 8,
  },
  statItem: { flex: IS_LARGE ? 1 : undefined, flexDirection: 'row', alignItems: 'center', gap: 14, justifyContent: IS_LARGE ? 'center' : 'flex-start', paddingVertical: 4 },
  statDivider: IS_LARGE ? { borderRightWidth: 1, borderRightColor: BORDER } : {},
  statIconBox: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(197,255,218,0.16)' },
  statValue: { fontSize: IS_LARGE ? 22 : 20, fontWeight: '800', color: FORE, letterSpacing: 0 },
  statLabel: { fontSize: 12, color: MUTED, marginTop: 1 },

  // ── Cards grid
  grid3: { gap: 20 },
  grid2: { gap: 20 },
  card: {
    backgroundColor: 'rgba(16,21,16,0.94)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    padding: 28,
  },
  roleCard: {
    backgroundColor: 'rgba(16,21,16,0.94)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    padding: 28,
    overflow: 'hidden',
  },
  cardIconWrap: { width: 52, height: 52, borderRadius: 8, backgroundColor: 'rgba(183,242,199,0.13)', borderWidth: 1, borderColor: 'rgba(244,184,74,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
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
    backgroundColor: 'rgba(16,21,16,0.94)',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
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
    backgroundColor: 'rgba(244,184,74,0.14)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 16,
  },
  howStepNum: { fontSize: 11, fontWeight: '800', color: AMBER, letterSpacing: 0.5 },
  howIconCircle: { width: 56, height: 56, borderRadius: 8, backgroundColor: 'rgba(183,242,199,0.12)', borderWidth: 1, borderColor: 'rgba(244,184,74,0.28)', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  howTitle: { fontSize: 18, fontWeight: '700', color: FORE, marginBottom: 10 },
  howDesc: { fontSize: 14, color: MUTED, lineHeight: 22 },

  // ── CTA
  badge: { backgroundColor: 'rgba(183,242,199,0.14)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(244,184,74,0.25)' },
  badgeText: { fontSize: 12, fontWeight: '600', color: CYAN },
  ctaCard: {
    borderWidth: 1,
    borderColor: 'rgba(244,184,74,0.28)',
    borderRadius: 8,
    padding: IS_LARGE ? 64 : 36,
    alignItems: 'center',
    backgroundColor: 'rgba(16,21,16,0.72)',
  },
  ctaTitle: { fontSize: IS_LARGE ? 40 : 28, fontWeight: '700', color: FORE, marginBottom: 14, textAlign: 'center' },
  ctaSub: { fontSize: 18, color: MUTED, marginBottom: 30, textAlign: 'center', lineHeight: 28 },

  // ── Footer
  footer: { borderTopWidth: 1, borderTopColor: BORDER, paddingVertical: 56, paddingHorizontal: IS_LARGE ? 80 : 20, backgroundColor: 'rgba(5,7,5,0.92)' },
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
  modal: { backgroundColor: '#0B0B0B', borderWidth: 1, borderColor: 'rgba(245,243,238,0.12)', borderRadius: 16, padding: WIN_W < 400 ? 18 : 36, width: '100%', maxWidth: 460, alignSelf: 'center', position: 'relative' },
  modalClose: { position: 'absolute', top: 14, right: 14, padding: 6, borderRadius: 6 },
  modalTitle: { fontSize: 24, fontWeight: '700', color: FORE, marginBottom: 6 },
  modalSubtitle: { fontSize: 14, color: MUTED, marginBottom: 24 },

  // Role chips
  roleChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: BORDER },
  roleChipActive: { borderColor: CYAN, backgroundColor: 'rgba(183,242,199,0.18)' },
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
  input: { flex: 1, fontSize: 14, color: FORE, outlineStyle: 'none', outlineWidth: 0 } as any,

  // Date of birth picker
  dobCal: { position: 'absolute', top: 74, left: 0, right: 0, backgroundColor: '#000000', borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 12, zIndex: 50, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 16 }, elevation: 12 } as any,
  dobHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  dobHeadLabel: { fontSize: 14, fontWeight: '600', color: FORE },
  dobNavGroup: { flexDirection: 'row', gap: 6 },
  dobNav: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: BORDER },
  dobDow: { flexDirection: 'row' },
  dobDowTxt: { flex: 1, textAlign: 'center', fontSize: 10.5, color: DIM, paddingVertical: 2 },
  dobGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dobCell: { width: `${100 / 7}%`, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 7 } as any,
  dobCellTxt: { fontSize: 12.5, color: FORE },
  dobSel: { backgroundColor: CYAN },
  dobYearGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dobYear: { width: '25%', paddingVertical: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  dobYearTxt: { fontSize: 13, color: FORE },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(255,92,124,0.08)', borderWidth: 1, borderColor: 'rgba(255,92,124,0.25)', borderRadius: 7, padding: 12, marginBottom: 12 },
  errorText: { fontSize: 12, color: RED, flex: 1 },

  successBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(143,230,174,0.12)', borderWidth: 1, borderColor: 'rgba(143,230,174,0.3)', borderRadius: 7, padding: 14, marginBottom: 16 },
  successText: { fontSize: 13, color: GREEN, flex: 1 },

  formFooter: { flexDirection: 'row', justifyContent: 'center', marginTop: 18 },
  footerText: { fontSize: 13, color: MUTED },
  linkText: { fontSize: 13, color: CYAN, fontWeight: '500' },
});
