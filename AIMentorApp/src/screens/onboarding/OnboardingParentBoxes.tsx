/**
 * OnboardingParentBoxes.tsx
 * Parent onboarding — all sections shown as cards on a single page
 * (Personal Info, Your Child(ren), Child's Account, Your Avatar).
 * Everything is visible and editable at once; "Complete Setup" saves
 * the profile, links/creates child accounts, and finishes onboarding.
 */
import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, Platform, Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Rect, Circle } from 'react-native-svg';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import SERVER_URL from '../../config/serverUrl';
import firebaseApp from '../../config/firebase';
import { AVATAR_STYLES } from '../../constants/avatarStyles';
import { CURRICULA, getGradesForCurriculum, TEAL, DatePickerInput } from './OnboardingScreen';
import {
  AutocompleteField, CardHeader, BBox, fetchCitySuggestions, locateCity,
} from './OnboardingSharedFields';

const FOREST = '#5A8A70';
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
}
function emptyChild(): ChildEntry {
  return { name: '', age: '', grade: '', curriculum: '', school: '', schoolCity: '', email: '', linkEmail: '', password: '' };
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
  const { user, updateUser } = useAuth();
  const { colors } = useTheme();
  const styles = useStyles(colors);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [locating, setLocating] = useState(false);
  const [schoolLocating, setSchoolLocating] = useState(false);
  const cityBBoxCache = useRef<Map<string, BBox | null>>(new Map());

  // Form state
  const [fullName, setFullName] = useState(user?.name || '');
  const [dob, setDob] = useState('');
  const [mobile, setMobile] = useState('');
  const [city, setCity] = useState((user as any)?.location || '');
  const [avatarStyle, setAvatarStyle] = useState('default');

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

  function copyToClipboard(text: string, field: string) {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 1500);
  }

  // ── Per-card completion ────────────────────────────
  const personalDone = fullName.trim().length >= 2 && city.trim().length >= 2;
  const childrenDone = children.every(c => c.name.trim().length >= 2);
  const curriculumDone = children.every(c => c.curriculum.length > 0 && c.grade.length > 0);
  const accountDone = children.every(c => {
    const age = c.age ? parseInt(c.age, 10) : 0;
    if (age >= 14) return /^\S+@\S+\.\S+$/.test(c.linkEmail.trim());
    return c.school.trim().length >= 2 && (c.password.length === 0 || c.password.length >= 6);
  });
  const avatarDone = avatarStyle.length > 0;

  const requiredDone = personalDone && childrenDone && curriculumDone && accountDone;
  const doneCount = [personalDone, childrenDone, curriculumDone, accountDone, avatarDone].filter(Boolean).length;
  const completionPct = Math.round((doneCount / 5) * 100);

  async function handleFinish() {
    if (!requiredDone) {
      setSaveError('Please complete Personal Info, Your Child(ren), and Child\'s Account before continuing.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const email = user?.email || '';

      const body: any = {
        email,
        role: 'parent',
        name: fullName.trim(),
        school: children[0]?.school || '',
        location: city,
        complete: true,
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

      fetch(`${SERVER_URL}/user/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: fullName.trim(),
          role: 'parent',
          location: city,
          dob: dob || undefined,
          mobile: mobile ? `+91 ${mobile}` : undefined,
          avatarStyle,
        }),
      }).catch(() => {});

      const localCompletionPatch: any = {
        name: fullName.trim(),
        location: city,
        onboardingComplete: true,
        avatarStyle,
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
                    { label: 'Student ID', value: cred.studentId, field: `studentId-${idx}` },
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
                    <View style={{ backgroundColor: TEAL + '12', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: TEAL + '30', gap: 4 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: TEAL }}>Your child can log in right away.</Text>
                      <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>
                        A verification link was sent to <Text style={{ fontWeight: '700', color: colors.textMain }}>{cred.loginId}</Text>. You (the parent) can open that inbox and click the link — this enables "Forgot Password" if your child ever needs it.
                      </Text>
                    </View>
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
            <View style={styles.logoMark}><Feather name="zap" size={14} color="#fff" /></View>
            <Text style={styles.logoTxt}>Aivorah</Text>
          </View>
          <View style={styles.completionRow}>
            <Text style={styles.completionLbl}>Profile Completion</Text>
            <View style={styles.completionRing}>
              <Text style={styles.completionPct}>{completionPct}%</Text>
            </View>
          </View>
        </View>

        <View style={styles.greetWrap}>
          <Text style={styles.greetMain}>Welcome — let's set up your family profile</Text>
          <Text style={styles.greetSub}>Fill in each section so we can connect you with your child's learning journey.</Text>
        </View>

        {/* ── Row 1: Personal Info / Your Child(ren) / Child's Account ── */}
        <View style={[styles.rowWrap, styles.rowWrapStretch]}>
          {/* Personal Info */}
          <View style={[styles.card, styles.card3]}>
            <CardHeader icon="user" title="1. Personal Info" subtitle="Tell us about yourself." done={personalDone} styles={styles} />
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Full Name</Text>
              <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
                placeholder="Your name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
            </View>
            <View style={styles.fieldGroup}>
              <View style={styles.lblRow}>
                <Text style={styles.lbl}>City</Text>
                {Platform.OS === 'web' && (
                  <TouchableOpacity style={styles.locateBtn} onPress={() => locateCity(setCity, setLocating)} disabled={locating} activeOpacity={0.8}>
                    <Feather name="crosshair" size={12} color={TEAL} />
                    <Text style={styles.locateTxt}>{locating ? 'Locating...' : 'Use my location'}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <AutocompleteField
                value={city}
                onChange={setCity}
                fetchSuggestions={fetchCitySuggestions}
                placeholder="Search for your city"
                colors={colors}
                styles={styles}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Date of Birth</Text>
              {Platform.OS === 'web' ? (
                <DatePickerInput value={dob} onChange={setDob} colors={colors} />
              ) : (
                <TextInput style={styles.input} value={dob} onChangeText={setDob}
                  placeholder="DD/MM/YYYY" placeholderTextColor={colors.textDim} keyboardType="numeric" />
              )}
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.lbl}>Mobile Number</Text>
              <View style={styles.phoneRow}>
                <View style={styles.phoneCode}>
                  <IndiaFlagIcon />
                  <Text style={styles.phoneCodeTxt}>+91</Text>
                </View>
                <TextInput style={[styles.input, styles.phoneInput]} value={mobile} onChangeText={setMobile}
                  placeholder="98765 43210" placeholderTextColor={colors.textDim} keyboardType="phone-pad" />
              </View>
            </View>

            <View style={[styles.hintBox, styles.hintBoxFill, { backgroundColor: TEAL + '10', borderColor: TEAL + '25' }]}>
              <Feather name="shield" size={16} color={TEAL} />
              <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17, flex: 1 }}>
                Your details help us personalise learning recommendations for your child and are kept private.
              </Text>
            </View>
          </View>

          {/* Your Child(ren) */}
          <View style={[styles.card, styles.card3]}>
            <CardHeader icon="users" title="2. Your Child(ren)" subtitle="Tell us about your child." done={childrenDone} styles={styles} />

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
              <View style={[styles.hintBox, styles.hintBoxRow, { backgroundColor: FOREST + '10', borderColor: FOREST + '25' }]}>
                <Feather name="users" size={16} color={FOREST} />
                <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17, flex: 1 }}>
                  Got more than one child? Each one gets their own curriculum, grade and learning path.
                </Text>
              </View>

              <TouchableOpacity style={styles.addChildBtn} onPress={addAnotherChild} activeOpacity={0.7}>
                <Feather name="plus-circle" size={16} color={TEAL} />
                <Text style={styles.addChildTxt}>Add Another Child</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

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
                    <TextInput style={styles.input} value={activeChild.email} onChangeText={v => updateChild('email', v)}
                      placeholder="child@email.com" placeholderTextColor={colors.textDim}
                      keyboardType="email-address" autoCapitalize="none" />
                    <Text style={styles.subHint}>Leave blank — Aivorah auto-generates a login ID. Real email requires verification before login.</Text>
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
              <Text style={styles.requiredHint}>Complete all sections above to continue</Text>
            )}
            <TouchableOpacity
              style={[styles.completeBtn, !requiredDone && { opacity: 0.4 }]}
              disabled={!requiredDone || saving}
              onPress={handleFinish} activeOpacity={0.85}>
              <Text style={styles.completeTxt}>{saving ? 'Saving...' : 'Complete Setup'}</Text>
              {!saving && <Feather name="arrow-right" size={16} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function useStyles(colors: any) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    scrollContent: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40, maxWidth: 1280, width: '100%', alignSelf: 'center' },

    topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
    logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    logoMark: { width: 28, height: 28, borderRadius: 8, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
    logoTxt: { fontSize: 16, fontWeight: '800', color: colors.textMain },
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

    phoneRow: { flexDirection: 'row', gap: 8 },
    phoneCode: {
      height: 44, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.borderColor,
      backgroundColor: colors.bgDark, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    },
    phoneCodeTxt: { fontSize: 14, fontWeight: '700', color: colors.textMain },
    phoneInput: { flex: 1 },

    subHint: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
    hintBox: { borderRadius: 10, padding: 12, borderWidth: 1 },
    hintBoxFill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
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
    completeTxt: { fontSize: 14, fontWeight: '800', color: '#fff' },

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
    modalBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  });
}
