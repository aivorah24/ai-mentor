/**
 * OnboardingParentBoxes.tsx
 * Parent onboarding — all sections shown as cards on a single page
 * (Personal Info, Your Child(ren), Child's Account, Your Avatar).
 * Everything is visible and editable at once; "Complete Setup" saves
 * the profile, links/creates child accounts, and finishes onboarding.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, Platform, Modal, Share,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Rect, Circle } from 'react-native-svg';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { useAuth, getPendingReturnRole } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import SERVER_URL from '../../config/serverUrl';
import firebaseApp from '../../config/firebase';
import { AVATAR_STYLES } from '../../constants/avatarStyles';
import { CURRICULA, getGradesForCurriculum, DatePickerInput } from './OnboardingScreen';
import {
  AutocompleteField, CardHeader, BBox, fetchCitySuggestions, locateCity, locateFull,
  SelectField, COUNTRIES, INDIA_STATES, INDIA_CITIES, PhoneCodeSelect,
} from './OnboardingSharedFields';
import { PhoneOtpModal } from './phoneOtpVerification';
import { useMobileOtpVerification, MOBILE_VERIFICATION_ENABLED } from './mobileOtpVerification';

const FOREST = '#5A8A70';
// Override imported TEAL with Aivorah gold for parent onboarding
// eslint-disable-next-line @typescript-eslint/no-shadow
const TEAL = '#5F8A86';
const GRADE_GROUPS = [
  { label: 'Early Years', grades: ['Nursery', 'LKG', 'UKG'] },
  { label: 'Primary', grades: ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'] },
  { label: 'Middle School', grades: ['Grade 6', 'Grade 7', 'Grade 8'] },
  { label: 'Senior School', grades: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] },
];

interface ChildEntry {
  name: string;
  age: string;
  grade: string;
  curriculum: string;
  school: string;
  schoolCity: string;
  email: string;
  linkEmail: string;
  password: string;
  verifiedEmail: string;   // the child email that has been OTP-verified (must equal `email`)
}
function emptyChild(): ChildEntry {
  return { name: '', age: '', grade: '', curriculum: '', school: '', schoolCity: '', email: '', linkEmail: '', password: '', verifiedEmail: '' };
}

function generateStudentId(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 4) || 'STU';
  const suffix = Math.floor(100000 + Math.random() * 900000);
  return `STU-${initials}-${suffix}`;
}

function IndiaFlagIcon() {
  return (
    <Svg width={18} height={12} viewBox="0 0 18 12">
      <Rect x={0} y={0} width={18} height={4} fill="#FF9933" />
      <Rect x={0} y={4} width={18} height={4} fill="#FFFFFF" />
      <Rect x={0} y={8} width={18} height={4} fill="#138808" />
      <Circle cx={9} cy={6} r={1.6} fill="none" stroke="#000088" strokeWidth={0.3} />
      <Circle cx={9} cy={6} r={0.3} fill="#000088" />
    </Svg>
  );
}

export default function OnboardingParentBoxes() {
  const { user, updateUser, logout, cancelAddParentProfile } = useAuth();
  // Teacher adding a parent profile → Back returns to the teacher dashboard
  // (no sign-out, nothing persisted), instead of the "leave home" sign-out modal.
  const isAddingParent = getPendingReturnRole() === 'teacher';
  const { colors } = useTheme();
  const styles = useStyles(colors);

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [locating, setLocating] = useState(false);
  const [schoolLocating, setSchoolLocating] = useState(false);
  const cityBBoxCache = useRef<Map<string, BBox | null>>(new Map());

  // Form state
  const [fullName, setFullName] = useState(user?.name || '');
  const [dob, setDob] = useState('');
  const [mobile, setMobile] = useState('');
  const [mobileCode, setMobileCode] = useState('+91');
  const [city, setCity] = useState((user as any)?.location || '');
  const [stateProv, setStateProv] = useState((user as any)?.state || '');
  const [country, setCountry] = useState((user as any)?.country || 'India');
  const [avatarStyle, setAvatarStyle] = useState('default');

  // Hydrate fields not carried on the `user` object (dob, mobile, avatar) from
  // previously saved preferences — otherwise reopening onboarding after a
  // partial/complete save shows these as blank even though they're saved server-side.
  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/user/preferences?email=${encodeURIComponent(user.email)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((p) => {
        if (!p) return;
        if (p.dob) setDob(p.dob);
        if (p.phone) {
          const m = String(p.phone).match(/^(\+\d+)\s*(.*)$/);
          if (m) { setMobileCode(m[1]); setMobile(m[2]); } else setMobile(String(p.phone));
        }
        if (p.avatarStyle) setAvatarStyle(p.avatarStyle);
      })
      .catch(() => {});
  }, [user?.email]);

  const mobileOtp = useMobileOtpVerification(mobile, setMobile, mobileCode);
  // Editing the number after verifying invalidates the previous verification.
  const onMobileChange = (v: string) => {
    setMobile(v);
    if (mobileOtp.mobileVerified) mobileOtp.setMobileVerified(false);
  };

  // Web: trap the browser Back button for the whole parent onboarding flow (#171 —
  // previously only trapped while a teacher adds a parent profile, so a normal new
  // parent signup pressing browser Back would silently navigate away with no
  // confirmation). Mirrors the in-page back/close button's logic at the "Return to
  // home page?" confirm below: teacher-adding-parent cancels cleanly, anyone else
  // gets the explicit leave-confirm dialog instead of an unannounced exit.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    window.history.pushState(null, '', window.location.href);
    const onPop = () => {
      window.history.pushState(null, '', window.location.href);
      setShowLeaveConfirm(true);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Pre-fill from teacher profile when a teacher is adding a parent profile
  useEffect(() => {
    const isTeacherAddingParent = getPendingReturnRole() === 'teacher'
      || (user as any)?.roles?.includes('teacher');
    if (!isTeacherAddingParent || !user?.email) return;

    function applyMobile(raw: string) {
      const parts = raw.match(/^(\+\d+)\s(.+)$/);
      if (parts) { setMobileCode(parts[1]); setMobile(parts[2]); }
      else setMobile(raw);
    }

    // Immediate fill from user object
    const u = user as any;
    if (u?.name && !fullName)     setFullName(u.name);
    if (u?.dob)                   setDob(u.dob);
    if (u?.mobile)                applyMobile(u.mobile);
    if (u?.phone)                 applyMobile(u.phone);
    if (u?.state)                 setStateProv(u.state);
    if (u?.country)               setCountry(u.country);
    if (u?.location)              setCity(u.location);

    // Fetch preferences for fresher DB values
    fetch(`${SERVER_URL}/user/preferences?email=${encodeURIComponent(user.email)}`)
      .then(r => r.ok ? r.json() : null)
      .then(prefs => {
        if (!prefs) return;
        if (prefs.name)    setFullName(prefs.name);
        if (prefs.dob)     setDob(prefs.dob);
        const phoneRaw = prefs.mobile || prefs.phone;
        if (phoneRaw)      applyMobile(phoneRaw);
        if (prefs.state)   setStateProv(prefs.state);
        if (prefs.country) setCountry(prefs.country);
        if (prefs.location) setCity(prefs.location);
        else if (u?.location) setCity(u.location);
      })
      .catch(() => {});
  }, []);

  const [children, setChildren] = useState<ChildEntry[]>([emptyChild()]);
  const [activeChildIdx, setActiveChildIdx] = useState(0);
  const [showChildPassword, setShowChildPassword] = useState(false);
  const [showChildCreds, setShowChildCreds] = useState(false);
  const [copiedField, setCopiedField] = useState('');
  const [createdChildCreds, setCreatedChildCreds] = useState<Array<{
    name: string; loginId: string; password: string; studentId: string; verificationRequired: boolean;
  }>>([]);

  const pendingPatchRef = useRef<any | null>(null);

  const activeChild = children[activeChildIdx] || emptyChild();
  const updateChild = (field: keyof ChildEntry, value: string) => {
    setChildren(prev => prev.map((c, i) => i === activeChildIdx ? { ...c, [field]: value } : c));
  };

  // ── Child email OTP verification (inline, code-based) ───────────────────────
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpErr, setOtpErr] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);

  // Reset the OTP UI when switching between children.
  useEffect(() => {
    setOtpSent(false); setOtpCode(''); setOtpErr(''); setOtpCooldown(0);
  }, [activeChildIdx]);

  // Cooldown countdown for resending.
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = setTimeout(() => setOtpCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [otpCooldown]);

  // Editing the email invalidates any prior verification + OTP session.
  const onChildEmailChange = (v: string) => {
    setChildren(prev => prev.map((c, i) => i === activeChildIdx ? { ...c, email: v, verifiedEmail: '' } : c));
    setOtpSent(false); setOtpCode(''); setOtpErr('');
  };

  async function sendChildOtp() {
    const email = activeChild.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { setOtpErr('Enter a valid email first.'); return; }
    setOtpSending(true); setOtpErr('');
    try {
      const res = await fetch(`${SERVER_URL}/user/email-otp/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: activeChild.name.trim() || 'there' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not send the code.');
      setOtpSent(true); setOtpCooldown(30);
    } catch (e: any) {
      setOtpErr(e?.message || 'Could not send the code. Please try again.');
    } finally { setOtpSending(false); }
  }

  async function verifyChildOtp() {
    const email = activeChild.email.trim().toLowerCase();
    const code = otpCode.trim();
    if (code.length < 4) { setOtpErr('Enter the 6-digit code.'); return; }
    setOtpVerifying(true); setOtpErr('');
    try {
      const res = await fetch(`${SERVER_URL}/user/email-otp/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.verified) throw new Error(data?.error || 'Incorrect or expired code.');
      updateChild('verifiedEmail', email);
      setOtpSent(false); setOtpCode('');
    } catch (e: any) {
      setOtpErr(e?.message || 'Incorrect or expired code.');
    } finally { setOtpVerifying(false); }
  }

  const childEmailVal = activeChild.email.trim().toLowerCase();
  const childEmailValid = /^\S+@\S+\.\S+$/.test(childEmailVal);
  const childEmailVerified = childEmailValid && activeChild.verifiedEmail.trim().toLowerCase() === childEmailVal;
  const addAnotherChild = () => {
    const newIdx = children.length;
    setChildren(prev => [...prev, emptyChild()]);
    setActiveChildIdx(newIdx);
    setShowChildPassword(false);
  };
  const removeChild = (idx: number) => {
    if (children.length <= 1) return;
    setChildren(prev => prev.filter((_, i) => i !== idx));
    setActiveChildIdx(prev => Math.min(prev, children.length - 2));
  };

  // Native share sheet (WhatsApp, SMS, mail, etc.) instead of a mail-only
  // "forward" link — on web, uses the Web Share API where available and
  // falls back to a WhatsApp click-to-chat link on desktop browsers that
  // don't support navigator.share.
  async function shareCredentials(cred: { name: string; loginId: string; password: string }) {
    const text = `Hi ${cred.name},\n\nHere are your Aivorah login details:\n\nLogin ID: ${cred.loginId}\nPassword: ${cred.password}\n\nLog in at https://aivorah.ai`;
    if (Platform.OS === 'web') {
      const nav: any = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.share) {
        try { await nav.share({ title: 'Aivorah Login Details', text }); return; } catch { return; }
      }
      if (typeof window !== 'undefined') window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      return;
    }
    try { await Share.share({ message: text }); } catch {}
  }

  function copyToClipboard(text: string, field: string) {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 1500);
  }

  // ── Per-card completion ────────────────────────────
  const personalDone = fullName.trim().length >= 2 && city.trim().length >= 2
    && dob.trim().length > 0 && mobile.trim().length > 0;

  // Adding children is OPTIONAL during onboarding (client feedback, 2026-06-13):
  // a parent may skip and add kids later from the dashboard. A child only has to
  // be completed if the parent actually started adding one (entered a name).
  const startedChildren = children.filter(c => c.name.trim().length >= 2);
  const addingChildren = startedChildren.length > 0;
  const childrenDone = true; // names are validated as part of "started"
  const curriculumDone = startedChildren.every(c => c.curriculum.length > 0 && c.grade.length > 0);
  const accountDone = startedChildren.every(c => {
    const age = c.age ? parseInt(c.age, 10) : 0;
    if (age >= 14) return /^\S+@\S+\.\S+$/.test(c.linkEmail.trim());
    if (c.school.trim().length < 2) return false;
    if (c.password.length !== 0 && c.password.length < 6) return false;
    // If a real child email was entered, it must be OTP-verified before continuing.
    const email = c.email.trim().toLowerCase();
    if (email.length > 0) {
      if (!/^\S+@\S+\.\S+$/.test(email)) return false;
      if (c.verifiedEmail.trim().toLowerCase() !== email) return false;
    }
    return true;
  });
  const avatarDone = avatarStyle.length > 0;

  // Onboarding can complete with no children at all; only the parent's own info
  // is mandatory. Started children must be finished before continuing.
  const requiredDone = personalDone && curriculumDone && accountDone;

  // Completion ring reflects ACTUAL progress on the fields the parent fills, so it
  // starts near 0 and only reaches 100% when the profile is genuinely complete.
  // (Previously the default avatar + "no children" always counted as done, so a
  // blank form already showed ~67%.) Avatar always has a default, so it isn't a
  // step; children only count once the parent starts adding one.
  //
  // The child section used to be ONE bundled step (curriculumDone && accountDone),
  // so the ring sat frozen while a parent filled in curriculum, grade, school,
  // email — then jumped straight to 100% only once every field was done. Split
  // into its individual sub-fields so the ring actually climbs as detail is
  // entered, matching what a "progress" indicator should do. (client feedback)
  const childCurriculumDone = startedChildren.every(c => c.curriculum.length > 0);
  const childGradeDone = startedChildren.every(c => c.grade.length > 0);
  const childSchoolOrLinkDone = startedChildren.every(c => {
    const age = c.age ? parseInt(c.age, 10) : 0;
    if (age >= 14) return /^\S+@\S+\.\S+$/.test(c.linkEmail.trim());
    return c.school.trim().length >= 2;
  });
  const completionSteps = [
    fullName.trim().length >= 2,                       // name
    city.trim().length >= 2,                           // city
    dob.trim().length > 0,                              // date of birth
    mobile.trim().length > 0,                           // mobile number
    ...(addingChildren ? [childCurriculumDone, childGradeDone, childSchoolOrLinkDone, accountDone] : []),
  ];
  const completionPct = Math.round(
    (completionSteps.filter(Boolean).length / completionSteps.length) * 100
  );

  // finalize=false is the "Save & go back" path (dual-role: teacher pausing
  // partway through adding a parent profile) — it persists the fields entered
  // so far but must NOT grant the parent role/switch-profile access, since the
  // user hasn't confirmed via "Complete Setup". Only finalize=true (the real
  // Complete Setup button) is allowed to flip role/roles/onboarding_complete.
  async function handleFinish(finalize: boolean = true) {
    if (finalize && !requiredDone) {
      setSaveError(addingChildren
        ? 'Please finish the child details you started (curriculum, grade and account), or remove that child to skip.'
        : 'Please complete your Personal Info to continue.');
      return;
    }
    if (finalize && mobile.trim()) {
      const digits = mobile.replace(/\D/g, '');
      const minDigits = mobileCode === '+91' ? 10 : 7;
      if (digits.length < minDigits) {
        setSaveError(`Mobile number must have at least ${minDigits} digits.`);
        return;
      }
      // Verification is optional here — it can be completed later from Settings.
    }
    setSaving(true);
    setSaveError('');
    try {
      const email = user?.email || '';

      const body: any = {
        email,
        name: fullName.trim(),
        school: children[0]?.school || '',
        location: city,
        ...(finalize ? { role: 'parent', complete: true } : {}),
        children: children
          .filter(c => {
            const age = c.age ? parseInt(c.age, 10) : 0;
            return age < 14 && c.name.trim();
          })
          .map(c => ({
            name: c.name.trim(),
            grade: c.grade,
            school: c.school,
            schoolCity: c.schoolCity,
            curriculum: c.curriculum,
            email: c.email.trim().toLowerCase() || undefined,
          })),
      };

      const profileRes = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!profileRes.ok) {
        const errText = await profileRes.text().catch(() => '');
        throw new Error(`Profile save failed (${profileRes.status}): ${errText.slice(0, 200)}`);
      }

      // Only grant the parent role/switch-profile access on a real "Complete
      // Setup" (finalize) — a "Save & go back" must not add "parent" to roles.
      const mergedRoles = finalize
        ? (getPendingReturnRole() === 'teacher' ? ['teacher', 'parent'] : ['parent'])
        : undefined;

      fetch(`${SERVER_URL}/user/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: fullName.trim(),
          ...(finalize ? { role: 'parent' } : {}),
          location: city,
          state: stateProv || undefined,
          country: country || undefined,
          dob: dob || undefined,
          mobile: mobile ? `${mobileCode} ${mobile}` : undefined,
          mobileVerified: mobile ? (mobileOtp.mobileVerified && mobile === mobileOtp.verifiedMobile) : undefined,
          avatarStyle,
          ...(mergedRoles ? { roles: mergedRoles } : {}),
        }),
      }).catch(() => {});

      // ── Draft "Save & go back" (teacher pausing parent onboarding) ──────────
      // The entered fields are now persisted (above), but we must NOT create
      // child accounts or grant the parent role. Restore the teacher session so
      // the app routes back to the teacher DASHBOARD — beginAddParentProfile had
      // forced onboardingComplete=false to show parent onboarding, so without
      // this restore we'd land back on teacher ONBOARDING instead.
      if (!finalize) {
        if (isAddingParent) {
          cancelAddParentProfile();
        } else {
          logout();
        }
        return;
      }

      const localCompletionPatch: any = {
        name: fullName.trim(),
        location: city,
        avatarStyle,
        role: getPendingReturnRole() === 'teacher' ? 'teacher' : 'parent',
        activeRole: getPendingReturnRole() === 'teacher' ? 'teacher' : 'parent',
        onboardingComplete: true,
        roles: mergedRoles,
      };

      // ── Child account handling ─────────────────────────────────────
      const allCreds: Array<{ name: string; loginId: string; password: string; studentId: string; verificationRequired: boolean }> = [];

      for (const child of children) {
        if (!child.name.trim()) continue;
        const ageNum = child.age ? parseInt(child.age, 10) : 0;

        // ── Age >= 14: Link existing student account ──────────────────
        if (ageNum >= 14 && child.linkEmail.trim()) {
          const linkRes = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(email)}/children`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ childEmail: child.linkEmail.trim().toLowerCase() }),
          });
          if (!linkRes.ok) {
            const err = await linkRes.json().catch(() => ({}));
            throw new Error(err?.error || `Could not link ${child.name}'s account. Make sure they have a registered Aivorah account.`);
          }
          continue;
        }

        // ── Age < 14: Auto-create student account ──────────────────────
        const cleanName = child.name.trim();
        const candidateStudentId = generateStudentId(cleanName);
        const initRes = await fetch(`${SERVER_URL}/parent/children/init-auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: cleanName,
            studentId: candidateStudentId,
            email: child.email.trim().toLowerCase() || undefined,
            age: child.age ? parseInt(child.age, 10) : undefined,
            password: child.password.trim() || undefined,
          }),
        });
        const init = await initRes.json().catch(() => ({}));
        if (!initRes.ok) throw new Error(init?.error || `Could not prepare ${cleanName}'s account credentials.`);

        const finalEmail = String(init.email || '').toLowerCase();
        const finalPassword = String(init.password || '');
        const finalStudentId = init.studentId || candidateStudentId;
        const emailProvided = Boolean(init.emailProvided);

        const secondaryName = `onboarding-child-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const childApp = initializeApp((firebaseApp as any).options, secondaryName);
        const childAuth = getAuth(childApp);
        let firebaseUid = '';
        try {
          const childCred = await createUserWithEmailAndPassword(childAuth, finalEmail, finalPassword);
          firebaseUid = childCred.user.uid;
          await updateProfile(childCred.user, { displayName: `${cleanName}|student` }).catch(() => {});
        } catch (fbErr: any) {
          if (fbErr?.code === 'auth/email-already-in-use') {
            throw new Error(`${cleanName}'s email already exists. Use another email or leave it blank for auto-generated login.`);
          }
          throw new Error(fbErr?.message || `Could not create ${cleanName}'s account.`);
        } finally {
          await signOut(childAuth).catch(() => {});
          await deleteApp(childApp).catch(() => {});
        }

        const createRes = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(email)}/children/link-created`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firebaseUid,
            name: cleanName,
            studentId: finalStudentId,
            email: finalEmail,
            grade: child.grade,
            curriculum: child.curriculum,
            school: child.school,
            schoolCity: child.schoolCity,
            verificationRequired: emailProvided,
            age: child.age ? parseInt(child.age, 10) : undefined,
            initialPassword: finalPassword,
          }),
        });
        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({}));
          if (createRes.status === 409) {
            throw new Error(err?.error || `A child named "${cleanName}" with this grade already exists on your account.`);
          }
          throw new Error(err?.error || `Could not create ${cleanName}'s account during onboarding.`);
        }
        const created = await createRes.json().catch(() => null);
        if (!created) throw new Error(`Could not read ${cleanName}'s account response. Please try again.`);
        const createdChild = created?.child;

        allCreds.push({
          name: cleanName,
          loginId: createdChild?.email || finalEmail,
          password: finalPassword,
          studentId: createdChild?.studentId || finalStudentId,
          verificationRequired: emailProvided,
        });
      }

      if (allCreds.length > 0) {
        setCreatedChildCreds(allCreds);
        setShowChildCreds(true);
        // updateUser is applied once the parent acknowledges the credentials modal.
        pendingPatchRef.current = localCompletionPatch;
        return;
      }

      updateUser(localCompletionPatch as any);
    } catch (err: any) {
      console.error('Onboarding save error:', err);
      setSaveError(err?.message || 'Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function confirmChildCredsAndFinish() {
    setShowChildCreds(false);
    if (pendingPatchRef.current) {
      updateUser(pendingPatchRef.current);
      pendingPatchRef.current = null;
    }
  }

  return (
    <View style={styles.screen}>
      {/* ── Child credentials modal ── */}
      <Modal visible={showChildCreds} transparent animationType="fade" onRequestClose={confirmChildCredsAndFinish}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxHeight: '80%' as any }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: TEAL + '20', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="key" size={17} color={TEAL} />
              </View>
              <View>
                <Text style={styles.modalTitle}>{createdChildCreds.length > 1 ? 'Child Accounts Created' : 'Child Account Created'}</Text>
                <Text style={styles.modalText}>Share these login details with your {createdChildCreds.length > 1 ? 'children' : 'child'}</Text>
              </View>
            </View>
            <ScrollView style={{ flexGrow: 0 }}>
              {createdChildCreds.map((cred, idx) => (
                <View key={idx} style={{ backgroundColor: colors.bgDark, borderRadius: 10, padding: 14, gap: 12, borderWidth: 1, borderColor: colors.borderColor, marginBottom: idx < createdChildCreds.length - 1 ? 12 : 0 }}>
                  {createdChildCreds.length > 1 && <Text style={{ fontSize: 14, fontWeight: '700', color: TEAL }}>{cred.name}</Text>}
                  <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center' }}>Save these — {cred.name} uses them to log in as a Student on any device.</Text>
                  {[
                    { label: 'Login ID (Email)', value: cred.loginId, field: `loginId-${idx}` },
                    ...(cred.password ? [{ label: 'Password', value: cred.password, field: `password-${idx}` }] : []),
                  ].map(({ label, value, field }) => (
                    <View key={field} style={{ gap: 4 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardDark, borderWidth: 1, borderColor: copiedField === field ? TEAL : colors.borderColor, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
                        onPress={() => copyToClipboard(value, field)} activeOpacity={0.7}>
                        <Text style={{ flex: 1, color: colors.textMain, fontSize: 13, fontFamily: 'monospace' }} selectable>{value}</Text>
                        <Feather name={copiedField === field ? 'check' : 'copy'} size={14} color={copiedField === field ? TEAL : colors.textDim} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {cred.verificationRequired && (
                    <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center' }}>
                      Login details were also emailed to <Text style={{ fontWeight: '700', color: colors.textMain }}>{cred.loginId}</Text>.
                    </Text>
                  )}
                  {!!cred.password && (
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: TEAL + '15', borderWidth: 1, borderColor: TEAL + '40', borderRadius: 8, paddingVertical: 9 }}
                      onPress={() => shareCredentials(cred)} activeOpacity={0.8}>
                      <Feather name="share-2" size={13} color={TEAL} />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: TEAL }}>Share credentials</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalBtn} onPress={confirmChildCredsAndFinish} activeOpacity={0.85}>
              <Text style={styles.modalBtnText}>Got it, I've saved these</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.topbar}>
          <View style={styles.logoRow}>
            <TouchableOpacity
              onPress={() => setShowLeaveConfirm(true)}
              style={styles.backBtn}
              activeOpacity={0.7}
              accessibilityLabel={isAddingParent ? 'Back to teacher dashboard' : 'Back to home page'}
            >
              <Feather name="arrow-left" size={18} color={colors.textMuted} />
              <Text style={styles.backTxt}>Back</Text>
            </TouchableOpacity>
            <View style={styles.logoMark}><Feather name="zap" size={14} color="#0B0B0B" /></View>
            <Text style={styles.logoTxt}>Aivorah</Text>
            <View style={[styles.roleBadge, styles.roleBadgeParent]}>
              <Text style={[styles.roleBadgeText, styles.roleBadgeTextParent]}>Parent</Text>
            </View>
          </View>
          <View style={styles.completionRow}>
            <Text style={styles.completionLbl}>Profile Completion</Text>
            <View style={styles.completionRing}>
              <Text style={styles.completionPct}>{completionPct}%</Text>
            </View>
          </View>
        </View>

        <View style={styles.greetWrap}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <View style={{ backgroundColor: TEAL + '18', borderColor: TEAL + '40', borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={{ color: TEAL, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' }}>Parent Onboarding</Text>
            </View>
          </View>
          <Text style={styles.greetMain}>Welcome — let's set up your family profile</Text>
          <Text style={styles.greetSub}>Fill in each section so we can connect you with your child's learning journey.</Text>
        </View>

        {/* ── Row 1: Personal Info / Your Child(ren) / Child's Account ── */}
        <View style={[styles.rowWrap, styles.rowWrapStretch, { zIndex: 20 }]}>
          {/* Personal Info */}
          <View style={[styles.card, styles.card3, { zIndex: 10 }]}>
            <CardHeader icon="user" title="1. Personal Info" subtitle="Tell us about yourself." done={personalDone} styles={styles} />
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Full Name</Text>
              <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
                placeholder="Your name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
            </View>
            {Platform.OS === 'web' && (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2 }}>
                <TouchableOpacity style={styles.locateBtn} onPress={() => locateFull(({ city: c, state: s, country: co }) => { if (co) setCountry(co); if (s) setStateProv(s); if (c) setCity(c); }, setLocating)} disabled={locating} activeOpacity={0.8}>
                  <Feather name="crosshair" size={12} color={TEAL} />
                  <Text style={styles.locateTxt}>{locating ? 'Locating...' : 'Use my location'}</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={[styles.fieldRow, { zIndex: 10 }]}>
              <View style={[styles.fieldGroup, { flex: 1, minWidth: 140, zIndex: 20 }]}>
                <Text style={styles.lbl}>Country</Text>
                <SelectField
                  value={country}
                  onChange={(c) => { setCountry(c); if (c !== 'India') setStateProv(''); setCity(''); }}
                  options={COUNTRIES}
                  placeholder="Select your country"
                  searchPlaceholder="Search country..."
                  colors={colors}
                  styles={styles}
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 1, minWidth: 140, zIndex: 15 }]}>
                <Text style={styles.lbl}>State / Province</Text>
                <SelectField
                  value={stateProv}
                  onChange={(s) => { setStateProv(s); setCity(''); }}
                  options={country === 'India' ? INDIA_STATES : []}
                  placeholder="Select your state"
                  searchPlaceholder="Search state..."
                  colors={colors}
                  styles={styles}
                />
              </View>
            </View>
            <View style={[styles.fieldGroup, { zIndex: 9 }]}>
              <Text style={styles.lbl}>City</Text>
              {country === 'India' && INDIA_CITIES[stateProv] ? (
                <SelectField
                  value={city}
                  onChange={setCity}
                  options={[...INDIA_CITIES[stateProv]].sort()}
                  placeholder="Select your city"
                  searchPlaceholder="Search city..."
                  colors={colors}
                  styles={styles}
                />
              ) : (
                <AutocompleteField
                  value={city}
                  onChange={setCity}
                  fetchSuggestions={(q) => fetchCitySuggestions(q, { state: stateProv, country })}
                  placeholder={stateProv || country ? 'Search for your city' : 'Select country & state first'}
                  colors={colors}
                  styles={styles}
                />
              )}
            </View>
            <View style={[styles.fieldRow, { zIndex: 8 }]}>
              <View style={[styles.fieldGroup, { flex: 1, minWidth: 140 }]}>
                <Text style={styles.lbl}>Date of Birth</Text>
                {Platform.OS === 'web' ? (
                  <DatePickerInput value={dob} onChange={setDob} colors={colors} />
                ) : (
                  <TextInput style={styles.input} value={dob} onChangeText={setDob}
                    placeholder="DD/MM/YYYY" placeholderTextColor={colors.textDim} keyboardType="numeric" />
                )}
              </View>
              <View style={[styles.fieldGroup, { flex: 1, minWidth: 200 }]}>
                <Text style={styles.lbl}>Mobile Number</Text>
                <View style={styles.phoneRow}>
                  <PhoneCodeSelect value={mobileCode} onChange={setMobileCode} colors={colors} styles={styles} />
                  <TextInput style={[styles.input, styles.phoneInput]} value={mobile}
                    onChangeText={onMobileChange}
                    placeholder="98765 43210" placeholderTextColor={colors.textDim} keyboardType="phone-pad" />
                  {MOBILE_VERIFICATION_ENABLED && (
                    mobileOtp.mobileVerified && mobile === mobileOtp.verifiedMobile ? (
                    <View style={styles.verifiedBadge}>
                      <Feather name="check-circle" size={14} color={TEAL} />
                      <Text style={styles.verifiedTxt}>Verified</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.verifyBtn}
                      onPress={mobileOtp.handleSendOtp}
                      disabled={mobileOtp.otpSending || !mobile.trim()}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.verifyBtnTxt}>{mobileOtp.otpSending ? 'Sending...' : 'Verify'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {MOBILE_VERIFICATION_ENABLED && mobileOtp.otpError ? <Text style={styles.warnTxt}>{mobileOtp.otpError}</Text> : null}
              </View>
            </View>

            <View style={[styles.hintBox, styles.hintBoxRow, { backgroundColor: TEAL + '10', borderColor: TEAL + '25' }]}>
              <Feather name="shield" size={16} color={TEAL} />
              <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17, flex: 1 }}>
                The details you provide are used to create and secure your account. Your information is stored securely and treated as strictly confidential.
              </Text>
            </View>
          </View>

          {/* Your Child(ren) */}
          <View style={[styles.card, styles.card3]}>
            <CardHeader icon="users" title="2. Your Children" badge="Optional" subtitle="Add now, or skip and add them anytime from your dashboard." done={!addingChildren || childrenDone} styles={styles} subtitleColor={TEAL} />

            {children.length > 1 && (
              <View style={styles.chipRow}>
                {children.map((c, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.chip, activeChildIdx === i && styles.chipActive, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
                    onPress={() => { setActiveChildIdx(i); setShowChildPassword(false); }}
                    activeOpacity={0.8}>
                    <Text style={[styles.chipTxt, activeChildIdx === i && styles.chipTxtActive]}>
                      {c.name.trim() || `Child ${i + 1}`}
                    </Text>
                    <TouchableOpacity onPress={() => removeChild(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Feather name="x" size={12} color={activeChildIdx === i ? '#fff' : colors.textDim} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Child's Full Name</Text>
              <TextInput style={styles.input} value={activeChild.name} onChangeText={v => updateChild('name', v)}
                placeholder="Enter your child's name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Child's Age</Text>
              <TextInput style={styles.input} value={activeChild.age} onChangeText={v => updateChild('age', v)}
                placeholder="e.g. 9" placeholderTextColor={colors.textDim} keyboardType="numeric" maxLength={2} />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>{children.length > 1 ? `${activeChild.name || 'Child'}'s School` : "Child's School"}</Text>
              <TextInput style={styles.input} value={activeChild.school} onChangeText={v => updateChild('school', v)}
                placeholder="e.g. Hyderabad International School" placeholderTextColor={colors.textDim} />
            </View>
            <View style={styles.fieldGroup}>
              <View style={styles.lblRow}>
                <Text style={styles.lbl}>School Location</Text>
                {Platform.OS === 'web' && (
                  <TouchableOpacity style={styles.locateBtn} onPress={() => locateCity(v => updateChild('schoolCity', v), setSchoolLocating)} disabled={schoolLocating} activeOpacity={0.8}>
                    <Feather name="crosshair" size={12} color={TEAL} />
                    <Text style={styles.locateTxt}>{schoolLocating ? 'Locating...' : 'Use my location'}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <AutocompleteField
                value={activeChild.schoolCity}
                onChange={v => updateChild('schoolCity', v)}
                fetchSuggestions={fetchCitySuggestions}
                placeholder="Search for the school's city"
                colors={colors}
                styles={styles}
              />
            </View>

            {activeChild.age.length > 0 && (
              <View style={[styles.hintBox, { backgroundColor: (parseInt(activeChild.age, 10) >= 14 ? TEAL : FOREST) + '15', borderColor: (parseInt(activeChild.age, 10) >= 14 ? TEAL : FOREST) + '40' }]}>
                <Text style={{ fontSize: 12, color: parseInt(activeChild.age, 10) >= 14 ? TEAL : FOREST, lineHeight: 17 }}>
                  {parseInt(activeChild.age, 10) >= 14
                    ? 'Students 14 and older should have their own account. Enter their registered Aivorah email in the Account box to link it.'
                    : 'Aivorah will create a login ID and password for your child in the Account box.'}
                </Text>
              </View>
            )}

            <View style={styles.fillCenter}>
              <TouchableOpacity style={styles.addChildBtn} onPress={addAnotherChild} activeOpacity={0.7}>
                <Feather name="plus-circle" size={16} color={TEAL} />
                <Text style={styles.addChildTxt}>Add Another Child</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Sections 3 & 4 only appear once the parent starts adding a child
            (keeps onboarding clean for parents who skip the optional child step). */}
        {addingChildren && (<>
        {/* ── Row 2: Child's Learning Profile ── */}
        <View style={styles.rowWrap}>
          <View style={[styles.card, styles.cardFull]}>
            <CardHeader icon="book-open" title="3. Child's Learning Profile" subtitle="What is your child learning?" done={curriculumDone} styles={styles} />

            {children.length > 1 && (
              <View style={styles.chipRow}>
                {children.map((c, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.chip, activeChildIdx === i && styles.chipActive]}
                    onPress={() => { setActiveChildIdx(i); setShowChildPassword(false); }}
                    activeOpacity={0.8}>
                    <Text style={[styles.chipTxt, activeChildIdx === i && styles.chipTxtActive]}>
                      {c.name.trim() || `Child ${i + 1}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Child's Curriculum</Text>
              <View style={styles.fieldBox}>
                <View style={styles.chipRow}>
                  {CURRICULA.map(c => (
                    <TouchableOpacity key={c} style={[styles.chip, activeChild.curriculum === c && styles.chipActive]}
                      onPress={() => { updateChild('curriculum', c); updateChild('grade', ''); }} activeOpacity={0.8}>
                      <Text style={[styles.chipTxt, activeChild.curriculum === c && styles.chipTxtActive]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Child's Grade</Text>
              <View style={styles.gradeGroupsWrap}>
                {GRADE_GROUPS.map(group => {
                  const available = group.grades.filter(g => getGradesForCurriculum(activeChild.curriculum).includes(g));
                  if (available.length === 0) return null;
                  return (
                    <View key={group.label} style={styles.gradeGroup}>
                      <View style={styles.gradeGroupHead}>
                        <View style={styles.gradeGroupDot} />
                        <Text style={styles.gradeGroupLbl}>{group.label}</Text>
                      </View>
                      <View style={styles.chipRow}>
                        {available.map(g => (
                          <TouchableOpacity key={g} style={[styles.chip, activeChild.grade === g && styles.chipActive]}
                            onPress={() => updateChild('grade', g)} activeOpacity={0.8}>
                            <Text style={[styles.chipTxt, activeChild.grade === g && styles.chipTxtActive]}>{g}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        </View>

        {/* ── Row 3: Child's Account ── */}
        <View style={styles.rowWrap}>
          <View style={[styles.card, styles.cardFull]}>
            <CardHeader icon="key" title="4. Child's Account" subtitle="Link or create their login." done={accountDone} styles={styles} />

            {children.length > 1 && (
              <View style={styles.chipRow}>
                {children.map((c, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.chip, activeChildIdx === i && styles.chipActive]}
                    onPress={() => { setActiveChildIdx(i); setShowChildPassword(false); }}
                    activeOpacity={0.8}>
                    <Text style={[styles.chipTxt, activeChildIdx === i && styles.chipTxtActive]}>
                      {c.name.trim() || `Child ${i + 1}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {(activeChild.age ? parseInt(activeChild.age, 10) : 0) >= 14 ? (
              <>
                <View style={[styles.hintBox, { backgroundColor: TEAL + '12', borderColor: TEAL + '30' }]}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: TEAL, marginBottom: 4 }}>Link {activeChild.name || 'your child'}'s Account</Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17 }}>
                    Students 14+ have their own Aivorah account. Ask your child for their registered email, then enter it below to link it to your parent dashboard.
                  </Text>
                </View>
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldGroup, styles.fieldThird]}>
                    <Text style={styles.lbl}>Child's Registered Email</Text>
                    <TextInput style={styles.input} value={activeChild.linkEmail} onChangeText={v => updateChild('linkEmail', v)}
                      placeholder="child@email.com" placeholderTextColor={colors.textDim}
                      keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
                  </View>
                  <View style={[styles.fieldGroup, styles.fieldThird, { justifyContent: 'center' }]}>
                    <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17 }}>
                      If your child hasn't signed up yet, ask them to create a Student account first, then come back to complete this step.
                    </Text>
                  </View>
                </View>
              </>
            ) : (
              <>
                <View style={[styles.hintBox, { backgroundColor: FOREST + '12', borderColor: FOREST + '30' }]}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: FOREST, marginBottom: 4 }}>Create {activeChild.name || "your child"}'s Login</Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17 }}>
                    Aivorah will set up a Student account for {activeChild.name || 'your child'} using the details below — you'll get their login ID and password to share with them.
                  </Text>
                </View>
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldGroup, styles.fieldHalf]}>
                    <Text style={styles.lbl}>{children.length > 1 ? `${activeChild.name || 'Child'}'s Email (optional)` : "Child's Email (optional)"}</Text>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <TextInput style={[styles.input, { flex: 1 }]} value={activeChild.email} onChangeText={onChildEmailChange}
                        placeholder="child@email.com" placeholderTextColor={colors.textDim}
                        keyboardType="email-address" autoCapitalize="none" editable={!childEmailVerified} />
                      {childEmailValid && !childEmailVerified && (
                        <TouchableOpacity
                          onPress={sendChildOtp}
                          disabled={otpSending || otpCooldown > 0}
                          style={{ paddingHorizontal: 14, paddingVertical: 11, borderRadius: 8, backgroundColor: TEAL, opacity: (otpSending || otpCooldown > 0) ? 0.5 : 1 }}
                          activeOpacity={0.85}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#0b0b0b' }}>
                            {otpSending ? 'Sending…' : otpCooldown > 0 ? `Resend (${otpCooldown}s)` : (otpSent ? 'Resend' : 'Send Code')}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {childEmailVerified && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: 'rgba(143,230,174,0.15)', borderWidth: 1, borderColor: 'rgba(143,230,174,0.4)' }}>
                          <Feather name="check-circle" size={14} color="#8FE6AE" />
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#8FE6AE' }}>Verified</Text>
                        </View>
                      )}
                    </View>
                    {otpSent && !childEmailVerified && (
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
                        <TextInput style={[styles.input, { flex: 1 }]} value={otpCode} onChangeText={setOtpCode}
                          placeholder="Enter 6-digit code" placeholderTextColor={colors.textDim}
                          keyboardType="number-pad" maxLength={6} />
                        <TouchableOpacity onPress={verifyChildOtp} disabled={otpVerifying}
                          style={{ paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8, backgroundColor: TEAL, opacity: otpVerifying ? 0.5 : 1 }}
                          activeOpacity={0.85}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#0b0b0b' }}>{otpVerifying ? 'Verifying…' : 'Verify'}</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {otpErr !== '' && <Text style={[styles.subHint, { color: '#E07F7F' }]}>{otpErr}</Text>}
                    <Text style={styles.subHint}>
                      {childEmailVerified
                        ? 'Email verified. You can continue.'
                        : 'Leave blank — Aivorah auto-generates a login ID. If you enter a real email, verify it with the code we send.'}
                    </Text>
                  </View>
                  <View style={[styles.fieldGroup, styles.fieldHalf]}>
                    <Text style={styles.lbl}>Password (optional)</Text>
                    <View style={{ position: 'relative' }}>
                      <TextInput
                        style={[styles.input, { paddingRight: 48 }]}
                        value={activeChild.password}
                        onChangeText={v => updateChild('password', v)}
                        placeholder="Leave blank to auto-generate"
                        placeholderTextColor={colors.textDim}
                        secureTextEntry={!showChildPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="off"
                        importantForAutofill="no"
                      />
                      <TouchableOpacity
                        style={{ position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' }}
                        onPress={() => setShowChildPassword(v => !v)}
                        activeOpacity={0.7}>
                        <Feather name={showChildPassword ? 'eye-off' : 'eye'} size={16} color={colors.textDim} />
                      </TouchableOpacity>
                    </View>
                    {activeChild.password.length > 0 && activeChild.password.length < 6 && (
                      <Text style={{ fontSize: 12, color: '#ef4444' }}>Password must be at least 6 characters.</Text>
                    )}
                    <Text style={styles.subHint}>Set a password your child will remember, or leave blank to auto-generate one.</Text>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
        </>)}

        {/* ── Row 4: Your Avatar ── */}
        <View style={styles.rowWrap}>
          <View style={[styles.card, styles.cardFull]}>
            <CardHeader icon="smile" title="5. Your Avatar" subtitle="Choose an avatar that represents you." done={avatarDone} styles={styles} />
            <View style={styles.avatarGrid}>
              {AVATAR_STYLES.map(av => (
                <TouchableOpacity key={av.id}
                  style={[styles.avatarTile, avatarStyle === av.id && styles.avatarTileActive]}
                  onPress={() => setAvatarStyle(av.id)} activeOpacity={0.8}>
                  <LinearGradient colors={av.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatarCircle}>
                    <Feather name={av.icon as any} size={20} color="#fff" />
                  </LinearGradient>
                  <Text style={[styles.avatarLbl, avatarStyle === av.id && { color: TEAL }]}>{av.label}</Text>
                  {avatarStyle === av.id && (
                    <View style={styles.tileCheck}><Feather name="check" size={10} color="#fff" /></View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {saveError ? <Text style={styles.errorTxt}>{saveError}</Text> : null}

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <View style={styles.secureRow}>
            <View style={styles.secureIcon}><Feather name="shield" size={14} color={TEAL} /></View>
            <Text style={styles.secureTxt}>Your data is secure and never shared.</Text>
          </View>
          <View style={styles.footerBtns}>
            {!requiredDone && (
              <Text style={styles.requiredHint}>{(() => {
                const missing: string[] = [];
                if (!personalDone) missing.push('Personal Info');
                // Child sections only matter once a child has been started.
                if (!curriculumDone) {
                  const who = startedChildren.filter(c => !(c.curriculum.length > 0 && c.grade.length > 0)).map(c => c.name.trim() || 'a child');
                  missing.push(`Learning Profile (curriculum & grade${who.length ? ' for ' + who.join(', ') : ''})`);
                }
                if (!accountDone) {
                  const who = startedChildren.filter(c => {
                    const age = c.age ? parseInt(c.age, 10) : 0;
                    return age >= 14 ? !/^\S+@\S+\.\S+$/.test(c.linkEmail.trim()) : c.school.trim().length < 2;
                  }).map(c => c.name.trim() || 'a child');
                  missing.push(`Child's Account${who.length ? ' for ' + who.join(', ') : ''}`);
                }
                return missing.length ? `Still needed: ${missing.join('; ')}` : 'Complete all sections above to continue';
              })()}</Text>
            )}
            {requiredDone && !addingChildren && (
              <Text style={styles.requiredHint}>Adding children is optional — you can add them anytime from your dashboard.</Text>
            )}
            <TouchableOpacity
              style={[styles.completeBtn, !requiredDone && { opacity: 0.4 }]}
              disabled={!requiredDone || saving}
              onPress={() => handleFinish(true)} activeOpacity={0.85}>
              <Text style={styles.completeTxt}>{saving ? 'Saving...' : (addingChildren ? 'Complete Setup' : 'Skip for now & Finish')}</Text>
              {!saving && <Feather name="arrow-right" size={16} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* ── Leave confirmation (home page, or back-to-teacher-dashboard when adding a parent profile) ── */}
      <Modal transparent visible={showLeaveConfirm} animationType="fade" onRequestClose={() => setShowLeaveConfirm(false)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <View style={styles.confirmIcon}>
              <Feather name="log-out" size={22} color={TEAL} />
            </View>
            <Text style={styles.confirmTitle}>
              {isAddingParent ? 'Save this parent profile before going back?' : 'Return to the home page?'}
            </Text>
            <Text style={styles.confirmBody}>
              {isAddingParent
                ? "You'll return to your teacher dashboard. Save what you've entered so far, or discard it and go back without saving."
                : "You'll be signed out and taken back to the Aivorah home page. Any details you haven't saved on this page won't be kept."}
            </Text>
            {isAddingParent ? (
              <>
                <TouchableOpacity
                  style={styles.confirmPrimary}
                  activeOpacity={0.85}
                  disabled={saving}
                  onPress={() => { setShowLeaveConfirm(false); handleFinish(false); }}
                >
                  <Text style={styles.confirmPrimaryTxt}>{saving ? 'Saving...' : 'Save & go back'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmSecondary, { marginBottom: 10 }]}
                  activeOpacity={0.7}
                  onPress={() => { setShowLeaveConfirm(false); cancelAddParentProfile(); }}
                >
                  <Text style={styles.confirmSecondaryTxt}>Discard & go back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmSecondary}
                  activeOpacity={0.7}
                  onPress={() => setShowLeaveConfirm(false)}
                >
                  <Text style={styles.confirmSecondaryTxt}>Stay here</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.confirmPrimary}
                  activeOpacity={0.85}
                  disabled={saving}
                  onPress={() => { setShowLeaveConfirm(false); handleFinish(false); }}
                >
                  <Text style={styles.confirmPrimaryTxt}>{saving ? 'Saving...' : 'Save draft & sign out'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmSecondary, { marginBottom: 10 }]}
                  activeOpacity={0.7}
                  onPress={() => { setShowLeaveConfirm(false); logout(); }}
                >
                  <Text style={styles.confirmSecondaryTxt}>Discard draft & sign out</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmSecondary}
                  activeOpacity={0.7}
                  onPress={() => setShowLeaveConfirm(false)}
                >
                  <Text style={styles.confirmSecondaryTxt}>Stay here</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      <PhoneOtpModal
        mobile={mobile}
        mobileCode={mobileCode}
        otpModalVisible={mobileOtp.otpModalVisible}
        otpCode={mobileOtp.otpCode}
        setOtpCode={mobileOtp.setOtpCode}
        otpError={mobileOtp.otpError}
        otpVerifying={mobileOtp.otpVerifying}
        handleVerifyOtp={mobileOtp.handleVerifyOtp}
        handleCancelOtp={mobileOtp.handleCancelOtp}
        colors={colors}
        styles={styles}
      />
    </View>
  );
}

function useStyles(colors: any) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    scrollContent: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40, maxWidth: 1280, width: '100%', alignSelf: 'center' },

    topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
    logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    backBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
      borderWidth: 1, borderColor: colors.borderColor, marginRight: 4,
    },
    backTxt: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    confirmBox: {
      width: 360, maxWidth: '95%', borderRadius: 20, padding: 28, alignItems: 'center',
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
    },
    confirmIcon: {
      width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
      backgroundColor: TEAL + '22', marginBottom: 16,
    },
    confirmTitle: { fontSize: 19, fontWeight: '800', color: colors.textMain, marginBottom: 10, textAlign: 'center' },
    confirmBody: { fontSize: 14, color: colors.textMuted, lineHeight: 21, textAlign: 'center', marginBottom: 24 },
    confirmPrimary: { width: '100%', backgroundColor: TEAL, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
    confirmPrimaryTxt: { fontSize: 15, fontWeight: '700', color: '#0B0B0B' },
    confirmSecondary: { width: '100%', paddingVertical: 12, alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.borderColor },
    confirmSecondaryTxt: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
    logoMark: { width: 28, height: 28, borderRadius: 8, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
    logoTxt: { fontSize: 16, fontWeight: '800', color: colors.textMain },
    roleBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2.5,
      borderRadius: 12,
      borderWidth: 1,
      alignSelf: 'center',
      marginLeft: 4,
    },
    roleBadgeParent: {
      backgroundColor: TEAL + '18',
      borderColor: TEAL + '40',
    },
    roleBadgeText: {
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    roleBadgeTextParent: {
      color: TEAL,
    },
    completionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    completionLbl: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    completionRing: {
      width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: TEAL,
      alignItems: 'center', justifyContent: 'center',
    },
    completionPct: { fontSize: 11, fontWeight: '800', color: TEAL },

    greetWrap: { marginBottom: 24 },
    greetMain: { fontSize: 24, fontWeight: '800', color: colors.textMain },
    greetSub: { fontSize: 14, color: colors.textMuted, marginTop: 4 },

    rowWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 16 },
    rowWrapStretch: { alignItems: 'stretch' },
    card: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: 16, padding: 20, gap: 16,
    },
    card3: { flexGrow: 1, flexBasis: 320, minWidth: 280 },
    cardFull: { flexGrow: 1, flexBasis: '100%', minWidth: 280 },

    cardHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    cardIcon: {
      width: 38, height: 38, borderRadius: 10, backgroundColor: TEAL + '18',
      alignItems: 'center', justifyContent: 'center',
    },
    cardTitle: { fontSize: 16, fontWeight: '800', color: colors.textMain },
    cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    cardCheck: {
      width: 18, height: 18, borderRadius: 9, backgroundColor: TEAL,
      alignItems: 'center', justifyContent: 'center',
    },

    fieldGroup: { gap: 8 },
    lbl: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    lblRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    locateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    locateTxt: { fontSize: 11, fontWeight: '700', color: TEAL },
    input: {
      height: 44, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: 10, paddingHorizontal: 14, fontSize: 14, color: colors.textMain,
    },
    dropdown: {
      marginTop: 6,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: 10, overflow: 'hidden',
    },
    dropdownItem: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderColor },
    dropdownTxt: { fontSize: 13, color: colors.textMain },

    phoneRow: { flexDirection: 'row', flexWrap: 'nowrap', gap: 6, alignItems: 'center', width: '100%', overflow: 'hidden' },
    phoneCode: {
      height: 44, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.borderColor,
      backgroundColor: colors.bgDark, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
      flexShrink: 0,
    },
    phoneCodeTxt: { fontSize: 14, fontWeight: '700', color: colors.textMain },
    phoneInput: { flex: 1, flexBasis: 0, minWidth: 0, flexShrink: 1 },
    warnTxt: { color: '#ef4444', fontSize: 12, lineHeight: 17, marginTop: 4 },
    verifyBtn: {
      height: 44, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center',
      borderRadius: 10, borderWidth: 1, borderColor: TEAL, flexShrink: 0,
    },
    verifyBtnTxt: { fontSize: 12, fontWeight: '700', color: TEAL },
    verifiedBadge: {
      flexDirection: 'row', alignItems: 'center', gap: 6, height: 44,
      paddingHorizontal: 12, justifyContent: 'center', flexShrink: 0,
      borderRadius: 10, borderWidth: 1, borderColor: TEAL + '40', backgroundColor: TEAL + '12',
    },
    verifiedTxt: { fontSize: 12, fontWeight: '700', color: TEAL },

    subHint: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
    hintBox: { borderRadius: 10, padding: 12, borderWidth: 1 },
    hintBoxFill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    hintBoxRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    hintBoxRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    fillCenter: { flex: 1, justifyContent: 'center', gap: 12 },
    fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
    fieldThird: { flexBasis: '30%', flexGrow: 1, minWidth: 240 },
    fieldHalf: { flexBasis: '46%', flexGrow: 1, minWidth: 240 },

    fieldBox: {
      backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: 12, padding: 12,
    },
    gradeGroupsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    gradeGroup: {
      flexBasis: '23%', flexGrow: 1, minWidth: 220,
      backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: 12, padding: 12, gap: 10,
    },
    gradeGroupHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    gradeGroupDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: TEAL },
    gradeGroupLbl: { flex: 1, fontSize: 12, fontWeight: '800', color: colors.textMain, textTransform: 'uppercase', letterSpacing: 0.5 },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark },
    chipActive: { backgroundColor: TEAL + '20', borderColor: TEAL },
    chipTxt: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    chipTxtActive: { color: TEAL },

    addChildBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      paddingVertical: 14, borderWidth: 1, borderColor: TEAL + '40', borderRadius: 10,
      borderStyle: 'dashed', backgroundColor: TEAL + '08',
    },
    addChildTxt: { fontSize: 14, fontWeight: '600', color: TEAL },

    avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    avatarTile: {
      flexBasis: '11%', flexGrow: 1, minWidth: 90, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 12,
      borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark, position: 'relative',
    },
    avatarTileActive: { borderColor: TEAL, backgroundColor: TEAL + '10' },
    avatarCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    avatarLbl: { fontSize: 11, fontWeight: '600', color: colors.textMuted, textAlign: 'center' },
    tileCheck: {
      position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8,
      backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center',
    },

    errorTxt: { color: '#ef4444', fontSize: 13, textAlign: 'center', marginBottom: 12 },

    footer: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      flexWrap: 'wrap', gap: 16, marginTop: 8,
    },
    secureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    secureIcon: {
      width: 28, height: 28, borderRadius: 8, backgroundColor: TEAL + '18',
      alignItems: 'center', justifyContent: 'center',
    },
    secureTxt: { fontSize: 13, color: colors.textMuted },
    footerBtns: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    requiredHint: { fontSize: 12, color: colors.textMuted, maxWidth: 220, textAlign: 'right' },
    completeBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: TEAL, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 12,
    },
    completeTxt: { fontSize: 14, fontWeight: '800', color: '#0B0B0B' },

    modalOverlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20,
    },
    modalBox: {
      backgroundColor: colors.cardDark, borderRadius: 16, padding: 20, gap: 14,
      width: '100%', maxWidth: 440, borderWidth: 1, borderColor: colors.borderColor,
    },
    modalTitle: { fontSize: 16, fontWeight: '800', color: colors.textMain },
    modalText: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    modalBtn: {
      backgroundColor: TEAL, borderRadius: 10, paddingVertical: 14, alignItems: 'center',
    },
    modalBtnText: { fontSize: 14, fontWeight: '800', color: '#0B0B0B' },
  });
}
