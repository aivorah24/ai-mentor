/**
 * OnboardingScreen.tsx
 * Multi-step onboarding for Student, Teacher, Parent
 * Collects role-specific data, saves to backend, marks onboardingComplete
 */
import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Modal, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { AVATAR_STYLES } from '../../constants/avatarStyles';
import SERVER_URL from '../../config/serverUrl';
import firebaseApp from '../../config/firebase';

// ── Constants ──────────────────────────────────────────────
const CURRICULA = ['IB PYP', 'NCERT', 'CBSE', 'ICSE', 'Cambridge', 'State Board'];
const GRADES = ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10'];
const SUBJECTS = ['Mathematics','Science','English','Social Studies','Hindi','ICT','Art','Music','Physical Education'];
const GENDERS = ['Male', 'Female', 'Prefer not to say'];
const LEARNING_STYLES: { id: string; label: string; icon: string; desc: string }[] = [
  { id: 'visual', label: 'Visual', icon: 'eye', desc: 'I learn best with pictures and diagrams' },
  { id: 'reading', label: 'Reading', icon: 'book', desc: 'I learn best by reading and writing' },
  { id: 'hands-on', label: 'Hands-on', icon: 'tool', desc: 'I learn best by doing and experimenting' },
  { id: 'auditory', label: 'Auditory', icon: 'headphones', desc: 'I learn best by listening' },
];

const TEAL = '#5F8A86';
const FOREST = '#5A8A70';

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

// ── Step definitions per role ──────────────────────────────
function getSteps(role: string) {
  if (role === 'teacher') return [
    { title: 'Personal Info', icon: 'user', subtitle: 'Tell us about yourself' },
    { title: 'School Details', icon: 'home', subtitle: 'Where do you teach?' },
    { title: 'Teaching Info', icon: 'book-open', subtitle: 'What do you teach?' },
    { title: 'Your Avatar', icon: 'smile', subtitle: 'Pick your look' },
  ];
  if (role === 'parent') return [
    { title: 'Personal Info', icon: 'user', subtitle: 'Tell us about yourself' },
    { title: 'Your Child', icon: 'users', subtitle: "Your child's details" },
    { title: 'School Info', icon: 'home', subtitle: "Your child's school" },
    { title: 'Your Avatar', icon: 'smile', subtitle: 'Pick your look' },
  ];
  // Student
  return [
    { title: 'Personal Info', icon: 'user', subtitle: 'Tell us about yourself' },
    { title: 'School & Grade', icon: 'home', subtitle: 'Your school details' },
    { title: 'Curriculum', icon: 'book-open', subtitle: 'What do you study?' },
    { title: 'Your Avatar', icon: 'smile', subtitle: 'Pick your look' },
    { title: 'Learning Style', icon: 'zap', subtitle: 'How do you learn best?' },
  ];
}

export default function OnboardingScreen() {
  const { user, updateUser, saveProfile } = useAuth();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const role = user?.role || 'student';
  const steps = getSteps(role);

  // Capture _returnRole in a ref on first render — immune to onAuthStateChanged
  // resetting user state mid-flow (race condition on live / slower networks).
  const returnRoleRef = useRef<string | undefined>((user as any)?._returnRole);

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // ── Shared fields ─────────────────────────────────
  const [fullName, setFullName] = useState(user?.name || '');
  const [dob, setDob] = useState(''); // DD/MM/YYYY — only for students
  const [gender, setGender] = useState('');
  const [school, setSchool] = useState((user as any)?.school || '');
  const [city, setCity] = useState((user as any)?.location || '');
  const [avatarStyle, setAvatarStyle] = useState('default');

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

  // ── Student fields ────────────────────────────────
  const [grade, setGrade] = useState((user as any)?.grade || '');
  const [curriculum, setCurriculum] = useState((user as any)?.curriculum || '');
  const [learningStyle, setLearningStyle] = useState('');

  // ── Teacher fields ────────────────────────────────
  const [teachGrades, setTeachGrades] = useState<string[]>([]);
  const [teachSubjects, setTeachSubjects] = useState<string[]>([]);
  const [teachCurriculum, setTeachCurriculum] = useState('');

  // ── Parent fields ─────────────────────────────────
  const [childName, setChildName] = useState('');
  const [childGrade, setChildGrade] = useState('');
  const [childSchool, setChildSchool] = useState('');
  const [childCurriculum, setChildCurriculum] = useState('');
  const [childEmail, setChildEmail] = useState('');
  const [childAge, setChildAge] = useState('');
  const [childLinkEmail, setChildLinkEmail] = useState(''); // for age >= 14 link flow
  const [childPassword, setChildPassword] = useState('');  // optional custom password for under-14
  const [showChildPassword, setShowChildPassword] = useState(false);
  const [showChildCreds, setShowChildCreds] = useState(false);
  const [createdLoginId, setCreatedLoginId] = useState('');
  const [createdPassword, setCreatedPassword] = useState('');
  const [createdStudentId, setCreatedStudentId] = useState('');
  const [createdVerificationRequired, setCreatedVerificationRequired] = useState(false);
  const [pendingUserPatch, setPendingUserPatch] = useState<any | null>(null);
  const [copiedField, setCopiedField] = useState('');

  function copyToClipboard(text: string, field: string) {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 1500);
  }

  const progress = (step + 1) / steps.length;

  function toggleArrayItem(arr: string[], item: string, setter: (v: string[]) => void) {
    setter(arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]);
  }

  const canProceed = useCallback(() => {
    if (role === 'student') {
      if (step === 0) {
        if (fullName.trim().length < 2) return false;
        const age = getAge(dob);
        return age !== null && age >= 14;
      }
      if (step === 1) return school.trim().length >= 2 && grade.length > 0;
      if (step === 2) return curriculum.length > 0;
      if (step === 3) return true; // avatar optional
      if (step === 4) return true; // learning style optional
    }
    if (role === 'teacher') {
      if (step === 0) return fullName.trim().length >= 2;
      if (step === 1) return school.trim().length >= 2;
      if (step === 2) return teachGrades.length > 0 && teachCurriculum.length > 0;
      if (step === 3) return true;
    }
    if (role === 'parent') {
      if (step === 0) return fullName.trim().length >= 2;
      if (step === 1) return childName.trim().length >= 2 && childGrade.length > 0 && childCurriculum.length > 0;
      if (step === 2) {
        const ageNum = childAge ? parseInt(childAge, 10) : 0;
        if (ageNum >= 14) return /^\S+@\S+\.\S+$/.test(childLinkEmail.trim());
        if (childPassword.length > 0 && childPassword.length < 6) return false;
        return true; // school/email optional for under-14
      }
      if (step === 3) return true;
    }
    return true;
  }, [step, role, fullName, dob, school, grade, curriculum, teachGrades, teachCurriculum, childName, childGrade, childCurriculum, childAge, childLinkEmail]);

  async function handleFinish() {
    setSaving(true);
    setSaveError('');
    // Use returnRoleRef captured at mount — immune to onAuthStateChanged mid-flow resets.
    const capturedReturnRole = returnRoleRef.current;
    try {
      const email = user?.email || '';

      // ── Pre-flight validation ──────────────────────────────────────────
      // Catch empty values before hitting the server — empty string is falsy
      // on the server and would be silently skipped, leaving nulls in Supabase.
      if (role === 'student') {
        if (!grade.trim())      throw new Error('Please select your grade before continuing.');
        if (!curriculum.trim()) throw new Error('Please select your curriculum before continuing.');
      }

      // If teacher is adding a parent profile (_returnRole='teacher'), keep 'teacher'
      // as the persisted role — 'parent' is only a temporary UI state for onboarding.
      const persistRole = capturedReturnRole === 'teacher' ? 'teacher' : role;

      // ── Dual-role: add parent role to server IMMEDIATELY ──────────────────
      // Call add-role BEFORE any Firebase operations. Firebase child-account
      // creation (createUserWithEmailAndPassword on secondary app) can trigger
      // onAuthStateChanged on the primary app, which unmounts OnboardingScreen
      // before the later add-role calls run. By calling it here, even if the
      // screen unmounts mid-flow, the server already has roles:['teacher','parent']
      // so onAuthStateChanged will restore the correct state including Switch Profile.
      if (capturedReturnRole === 'teacher') {
        await fetch(`${SERVER_URL}/user/add-role`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, role: 'parent' }),
        }).catch(() => {});
      }

      const body: any = {
        email,
        role: persistRole,           // send role so server can validate without an extra DB lookup
        name: fullName.trim(),
        school,
        location: city,
        complete: true,
      };

      if (role === 'student') {
        body.grade = grade.trim();
        body.curriculum = curriculum.trim();
      } else if (role === 'teacher') {
        body.curriculum = teachCurriculum;
        body.teaches = teachGrades.map(g => ({
          grade: g,
          curriculum: teachCurriculum,
          subjects: teachSubjects,
        }));
      } else if (role === 'parent') {
        const ageNum = childAge ? parseInt(childAge, 10) : 0;
        if (ageNum < 14) {
          // Under 14: we create the child account — pass info so server can store it
          body.children = [{
            name: childName.trim(),
            grade: childGrade,
            school: childSchool || school,
            curriculum: childCurriculum,
            email: childEmail.trim().toLowerCase() || undefined,
          }];
        }
        // Age >= 14: child links their own account in the next step — no children in profile body
      }

      // Save profile to Supabase
      const profileRes = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!profileRes.ok) {
        const errText = await profileRes.text().catch(() => '');
        throw new Error(`Profile save failed (${profileRes.status}): ${errText.slice(0, 200)}`);
      }

      // ── Verify server actually persisted the data ──────────────────────
      // Parse the response and confirm grade + curriculum are present for students.
      // If the server returned nulls, we reject and show an error instead of
      // marking onboarding complete with corrupt data.
      const saved = await profileRes.json().catch(() => ({}));
      if (role === 'student') {
        if (!saved.grade || !saved.curriculum) {
          throw new Error('Your profile could not be saved correctly. Please try again.');
        }
      }

      // Save preferences (avatar, learning style) — fire-and-forget, don't block
      fetch(`${SERVER_URL}/user/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: fullName.trim(),
          role: persistRole,
          grade: role === 'student' ? grade.trim() : undefined,
          curriculum: role === 'student' ? curriculum.trim() : teachCurriculum || undefined,
          school,
          location: city,
          avatarStyle,
          learningStyle: learningStyle || undefined,
          gender: gender || undefined,
        }),
      }).catch(() => {});

      // Build local completion patch; parent flow may defer applying this until
      // credentials are acknowledged in the modal.
      const localCompletionPatch: any = {
        name: fullName.trim(),
        school,
        location: city,
        onboardingComplete: true,
        avatarStyle,
        ...(role === 'student' ? { grade: saved.grade, curriculum: saved.curriculum } : {}),
        ...(role === 'teacher' ? {
          curriculum: teachCurriculum,
          teaches: teachGrades.map(g => ({ grade: g, curriculum: teachCurriculum })),
        } : {}),
      };

      // ── Parent child account handling (age-based) ─────────────────────────
      if (role === 'parent' && childName.trim()) {
        const ageNum = childAge ? parseInt(childAge, 10) : 0;

        // ── Age >= 14: Link existing student account ──────────────────────
        if (ageNum >= 14 && childLinkEmail.trim()) {
          try {
            const linkRes = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(email)}/children`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ childEmail: childLinkEmail.trim().toLowerCase() }),
            });
            if (!linkRes.ok) {
              const err = await linkRes.json().catch(() => ({}));
              throw new Error(err?.error || 'Could not link child account. Make sure they have a registered Aivorah account.');
            }
            // Link successful — mark parent onboarding complete
            if (capturedReturnRole === 'teacher') {
              // add-role already called at top of handleFinish
              const linkPatch = { ...localCompletionPatch, role: 'teacher', roles: ['teacher', 'parent'], _returnRole: undefined };
              updateUser(linkPatch as any);
              setTimeout(() => {
                Alert.alert(
                  'Parent Profile Added',
                  'Your parent details have been successfully saved. You can now switch between Teacher and Parent profiles from the sidebar.',
                  [{ text: 'OK' }]
                );
              }, 400);
            } else {
              updateUser(localCompletionPatch as any);
            }
            return;
          } catch (err: any) {
            throw new Error(err?.message || 'Could not link child account.');
          }
        }

        // ── Age < 14: Auto-create student account ─────────────────────────
        // Email and password are optional; backend will auto-generate when absent.
        try {
          const cleanChildName = childName.trim();
          const candidateStudentId = generateStudentId(childName.trim());
          const initRes = await fetch(`${SERVER_URL}/parent/children/init-auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: cleanChildName,
              studentId: candidateStudentId,
              email: childEmail.trim().toLowerCase() || undefined,
              age: childAge ? parseInt(childAge, 10) : undefined,
              password: childPassword.trim() || undefined,
            }),
          });
          const init = await initRes.json().catch(() => ({}));
          if (!initRes.ok) throw new Error(init?.error || 'Could not prepare child account credentials.');
          const finalEmail = String(init.email || '').toLowerCase();
          const finalPassword = String(init.password || '');
          const finalStudentId = init.studentId || candidateStudentId;
          // verificationRequired is always false for parent-created accounts —
          // account is immediately active. emailProvided tells us whether a real
          // Gmail was supplied (we send verification for "Forgot Password" support).
          const emailProvided = Boolean(init.emailProvided);

          // Create child in Firebase Auth (same auth provider as login screen)
          const secondaryName = `onboarding-child-${Date.now()}`;
          const childApp = initializeApp((firebaseApp as any).options, secondaryName);
          const childAuth = getAuth(childApp);
          let firebaseUid = '';
          try {
            const childCred = await createUserWithEmailAndPassword(childAuth, finalEmail, finalPassword);
            firebaseUid = childCred.user.uid;
            await updateProfile(childCred.user, { displayName: `${cleanChildName}|student` }).catch(() => {});

          } finally {
            await signOut(childAuth).catch(() => {});
            await deleteApp(childApp).catch(() => {});
          }

          const createRes = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(email)}/children/link-created`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              firebaseUid,
              name: cleanChildName,
              studentId: finalStudentId,
              email: finalEmail,
              grade: childGrade,
              curriculum: childCurriculum,
              school: childSchool || school,
              verificationRequired: emailProvided,
              age: childAge ? parseInt(childAge, 10) : undefined,
              initialPassword: finalPassword,
            }),
          });
          if (!createRes.ok) {
            const err = await createRes.json().catch(() => ({}));
            throw new Error(err?.error || 'Could not create child account during onboarding.');
          }
          const created = await createRes.json().catch(() => null);
          if (!created) throw new Error('Could not read child account response. Please try again.');
          const child = created?.child;
          // Always show credentials — fall back to computed values if server omits a field
          setCreatedLoginId(child?.email || finalEmail);
          setCreatedPassword(finalPassword);
          setCreatedStudentId(child?.studentId || finalStudentId);
          setCreatedVerificationRequired(emailProvided); // true = show Gmail verification note

          // ── Dual-role: teacher adding parent profile (new child path) ──
          if (capturedReturnRole === 'teacher') {
            // add-role already called at top of handleFinish
            setPendingUserPatch({
              ...localCompletionPatch,
              role: 'teacher',
              roles: ['teacher', 'parent'],
              onboardingComplete: true,
              _returnRole: undefined,
            });
          } else {
            setPendingUserPatch(localCompletionPatch);
          }
          setShowChildCreds(true);
          return;
        } catch (err: any) {
          if (err?.code === 'auth/email-already-in-use') {
            throw new Error('Child email already exists. Use another email or leave it blank for auto-generated login.');
          }
          throw new Error(err?.message || 'Could not create child account during onboarding.');
        }
      }

      // ── Dual-role: teacher adding parent profile ──────────────────────────
      // If _returnRole is set, this was a teacher going through parent onboarding.
      // add-role already called at top of handleFinish.
      if (capturedReturnRole === 'teacher') {
        const teacherPatch = {
          ...localCompletionPatch,
          role: 'teacher',
          roles: ['teacher', 'parent'],
          onboardingComplete: true,
          _returnRole: undefined,
        };
        updateUser(teacherPatch as any);
        setTimeout(() => {
          Alert.alert(
            'Parent Profile Added',
            'Your parent details have been successfully saved. You can now switch between Teacher and Parent profiles from the sidebar.',
            [{ text: 'OK' }]
          );
        }, 400);
      } else {
        // Only mark onboarding complete locally after server confirmed the save
        updateUser(localCompletionPatch as any);
      }
    } catch (err: any) {
      console.error('Onboarding save error:', err);
      setSaveError(err?.message || 'Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleNext() {
    if (step < steps.length - 1) {
      setStep(s => s + 1);
    } else {
      handleFinish();
    }
  }

  function confirmChildCredsAndFinish() {
    setShowChildCreds(false);
    if (pendingUserPatch) {
      const patch = pendingUserPatch;
      setPendingUserPatch(null);
      if (patch.role === 'teacher') {
        // Navigate to teacher dashboard IMMEDIATELY — prevents double-click on "Get Started"
        // from re-triggering handleFinish while the alert is still showing.
        updateUser(patch as any);
        setTimeout(() => {
          Alert.alert(
            'Parent Profile Added',
            'Your parent details have been successfully saved. You can now switch between Teacher and Parent profiles from the sidebar.',
            [{ text: 'OK' }]
          );
        }, 400);
      } else {
        updateUser(patch);
      }
    }
  }

  function handleBack() {
    if (step > 0) setStep(s => s - 1);
  }

  // ── Render step content ───────────────────────────
  function renderStepContent() {
    // ── STUDENT STEPS ─────────────────────────────
    if (role === 'student') {
      if (step === 0) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>Full Name</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
            placeholder="Enter your full name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
          
          <Text style={styles.fieldLabel}>Date of Birth (DD/MM/YYYY)</Text>
          <TextInput style={styles.input} value={dob} onChangeText={setDob}
            placeholder="e.g. 15/04/2010" placeholderTextColor={colors.textDim} keyboardType="numeric" />
          
          {dob.length >= 10 && getAge(dob) !== null && getAge(dob)! < 14 && (
            <View style={{ backgroundColor: '#ef444415', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#ef444430' }}>
              <Text style={{ color: '#ef4444', fontSize: 13, lineHeight: 18 }}>
                Students under 14 must have a parent or teacher create the account.
              </Text>
            </View>
          )}

          <Text style={styles.fieldLabel}>Gender</Text>
          <View style={styles.chipRow}>
            {GENDERS.map(g => (
              <TouchableOpacity key={g} style={[styles.chip, gender === g && styles.chipActive]}
                onPress={() => setGender(g)} activeOpacity={0.8}>
                <Text style={[styles.chipText, gender === g && styles.chipTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
      if (step === 1) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>School Name</Text>
          <TextInput style={styles.input} value={school} onChangeText={setSchool}
            placeholder="e.g. Hyderabad International School" placeholderTextColor={colors.textDim} />
          <Text style={styles.fieldLabel}>City</Text>
          <TextInput style={styles.input} value={city} onChangeText={setCity}
            placeholder="e.g. Hyderabad" placeholderTextColor={colors.textDim} />
          <Text style={styles.fieldLabel}>Grade</Text>
          <View style={styles.chipRow}>
            {GRADES.map(g => (
              <TouchableOpacity key={g} style={[styles.chip, grade === g && styles.chipActive]}
                onPress={() => setGrade(g)} activeOpacity={0.8}>
                <Text style={[styles.chipText, grade === g && styles.chipTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
      if (step === 2) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>Curriculum</Text>
          <View style={styles.chipRow}>
            {CURRICULA.map(c => (
              <TouchableOpacity key={c} style={[styles.chip, curriculum === c && styles.chipActive]}
                onPress={() => setCurriculum(c)} activeOpacity={0.8}>
                <Text style={[styles.chipText, curriculum === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
      if (step === 3) return renderAvatarStep();
      if (step === 4) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>How do you learn best?</Text>
          {LEARNING_STYLES.map(ls => (
            <TouchableOpacity key={ls.id}
              style={[styles.lsCard, learningStyle === ls.id && styles.lsCardActive]}
              onPress={() => setLearningStyle(ls.id)} activeOpacity={0.8}>
              <View style={[styles.lsIcon, learningStyle === ls.id && { backgroundColor: TEAL + '30' }]}>
                <Feather name={ls.icon as any} size={20} color={learningStyle === ls.id ? TEAL : colors.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.lsLabel, learningStyle === ls.id && { color: TEAL }]}>{ls.label}</Text>
                <Text style={[styles.lsDesc, learningStyle === ls.id && { color: colors.textMain }]}>{ls.desc}</Text>
              </View>
              {learningStyle === ls.id && <Feather name="check-circle" size={18} color={TEAL} />}
            </TouchableOpacity>
          ))}
        </View>
      );
    }

    // ── TEACHER STEPS ─────────────────────────────
    if (role === 'teacher') {
      if (step === 0) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>Full Name</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
            placeholder="Enter your full name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
        </View>
      );
      if (step === 1) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>School Name</Text>
          <TextInput style={styles.input} value={school} onChangeText={setSchool}
            placeholder="e.g. Hyderabad International School" placeholderTextColor={colors.textDim} />
          <Text style={styles.fieldLabel}>City</Text>
          <TextInput style={styles.input} value={city} onChangeText={setCity}
            placeholder="e.g. Hyderabad" placeholderTextColor={colors.textDim} />
        </View>
      );
      if (step === 2) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>Curriculum</Text>
          <View style={styles.chipRow}>
            {CURRICULA.map(c => (
              <TouchableOpacity key={c} style={[styles.chip, teachCurriculum === c && styles.chipActive]}
                onPress={() => setTeachCurriculum(c)} activeOpacity={0.8}>
                <Text style={[styles.chipText, teachCurriculum === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.fieldLabel}>Grades You Teach (select multiple)</Text>
          <View style={styles.chipRow}>
            {GRADES.map(g => (
              <TouchableOpacity key={g} style={[styles.chip, teachGrades.includes(g) && styles.chipActive]}
                onPress={() => toggleArrayItem(teachGrades, g, setTeachGrades)} activeOpacity={0.8}>
                <Text style={[styles.chipText, teachGrades.includes(g) && styles.chipTextActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.fieldLabel}>Subjects (select multiple)</Text>
          <View style={styles.chipRow}>
            {SUBJECTS.map(s => (
              <TouchableOpacity key={s} style={[styles.chip, teachSubjects.includes(s) && styles.chipActive]}
                onPress={() => toggleArrayItem(teachSubjects, s, setTeachSubjects)} activeOpacity={0.8}>
                <Text style={[styles.chipText, teachSubjects.includes(s) && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
      if (step === 3) return renderAvatarStep();
    }

    // ── PARENT STEPS ──────────────────────────────
    if (role === 'parent') {
      if (step === 0) return (
        <View style={styles.stepContent}>
          <Text style={styles.fieldLabel}>Full Name</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName}
            placeholder="Enter your full name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
          <Text style={styles.fieldLabel}>City</Text>
          <TextInput style={styles.input} value={city} onChangeText={setCity}
            placeholder="e.g. Hyderabad" placeholderTextColor={colors.textDim} />
        </View>
      );
      if (step === 1) {
        const ageNum = childAge ? parseInt(childAge, 10) : 0;
        return (
          <View style={styles.stepContent}>
            <Text style={styles.fieldLabel}>Child's Full Name</Text>
            <TextInput style={styles.input} value={childName} onChangeText={setChildName}
              placeholder="Enter your child's name" placeholderTextColor={colors.textDim} autoCapitalize="words" />
            <Text style={styles.fieldLabel}>Child's Age</Text>
            <TextInput style={styles.input} value={childAge} onChangeText={setChildAge}
              placeholder="e.g. 9" placeholderTextColor={colors.textDim} keyboardType="numeric" maxLength={2} />

            {/* Age-based flow hint */}
            {childAge.length > 0 && (
              <View style={{
                backgroundColor: ageNum >= 14 ? TEAL + '18' : FOREST + '15',
                borderRadius: 8, padding: 12, borderWidth: 1,
                borderColor: ageNum >= 14 ? TEAL + '40' : FOREST + '40',
              }}>
                <Text style={{ fontSize: 13, color: ageNum >= 14 ? TEAL : FOREST, lineHeight: 18 }}>
                  {ageNum >= 14
                    ? 'Students 14 and older should have their own account. In the next step, enter their registered Aivorah email to link it.'
                    : 'Aivorah will create a login ID and password for your child. You can optionally provide their email in the next step.'}
                </Text>
              </View>
            )}

            <Text style={styles.fieldLabel}>Child's Grade</Text>
            <View style={styles.chipRow}>
              {GRADES.map(g => (
                <TouchableOpacity key={g} style={[styles.chip, childGrade === g && styles.chipActive]}
                  onPress={() => setChildGrade(g)} activeOpacity={0.8}>
                  <Text style={[styles.chipText, childGrade === g && styles.chipTextActive]}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Child's Curriculum</Text>
            <View style={styles.chipRow}>
              {CURRICULA.map(c => (
                <TouchableOpacity key={c} style={[styles.chip, childCurriculum === c && styles.chipActive]}
                  onPress={() => setChildCurriculum(c)} activeOpacity={0.8}>
                  <Text style={[styles.chipText, childCurriculum === c && styles.chipTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );
      }
      if (step === 2) {
        const ageNum = childAge ? parseInt(childAge, 10) : 0;

        // ── Age >= 14: Link existing student account ──
        if (ageNum >= 14) return (
          <View style={styles.stepContent}>
            <View style={{ backgroundColor: TEAL + '12', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: TEAL + '30', gap: 6 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: TEAL }}>Link {childName || 'your child'}'s Account</Text>
              <Text style={{ fontSize: 13, color: colors.textMuted, lineHeight: 18 }}>
                Students 14+ have their own Aivorah account. Ask your child for their registered email, then enter it below to link it to your parent dashboard.
              </Text>
            </View>
            <Text style={styles.fieldLabel}>Child's Registered Email</Text>
            <TextInput
              style={styles.input}
              value={childLinkEmail}
              onChangeText={setChildLinkEmail}
              placeholder="child@email.com"
              placeholderTextColor={colors.textDim}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>
              If your child hasn't signed up yet, ask them to create a Student account first, then come back to complete this step.
            </Text>
          </View>
        );

        // ── Age < 14: Create account for child ──
        return (
          <View style={styles.stepContent}>
            <Text style={styles.fieldLabel}>Child's School</Text>
            <TextInput style={styles.input} value={childSchool} onChangeText={setChildSchool}
              placeholder="e.g. Hyderabad International School" placeholderTextColor={colors.textDim} />

            <Text style={styles.fieldLabel}>Child's Email (optional)</Text>
            <TextInput style={styles.input} value={childEmail} onChangeText={setChildEmail}
              placeholder="child@email.com" placeholderTextColor={colors.textDim}
              keyboardType="email-address" autoCapitalize="none" />
            <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18, marginTop: -8 }}>
              Leave blank — Aivorah auto-generates a login ID. Real email requires verification before login.
            </Text>

            <Text style={styles.fieldLabel}>Password (optional)</Text>
            <View style={{ position: 'relative' }}>
              <TextInput
                style={[styles.input, { paddingRight: 48 }]}
                value={childPassword}
                onChangeText={setChildPassword}
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
                activeOpacity={0.7}
              >
                <Feather name={showChildPassword ? 'eye-off' : 'eye'} size={16} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            {childPassword.length > 0 && childPassword.length < 6 && (
              <Text style={{ fontSize: 12, color: '#ef4444', marginTop: -8 }}>
                Password must be at least 6 characters.
              </Text>
            )}
            <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18, marginTop: -8 }}>
              Set a password your child will remember, or leave blank to auto-generate one.
            </Text>
          </View>
        );
      }
      if (step === 3) return renderAvatarStep();
    }

    return null;
  }

  function renderAvatarStep() {
    return (
      <View style={styles.stepContent}>
        <Text style={styles.fieldLabel}>Choose your avatar style</Text>
        <View style={styles.avatarGrid}>
          {AVATAR_STYLES.map(av => (
            <TouchableOpacity key={av.id}
              style={[styles.avatarCard, avatarStyle === av.id && styles.avatarCardActive]}
              onPress={() => setAvatarStyle(av.id)} activeOpacity={0.8}>
              <LinearGradient colors={av.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.avatarCircle}>
                <Feather name={av.icon as any} size={22} color="#fff" />
              </LinearGradient>
              <Text style={[styles.avatarLabel, avatarStyle === av.id && { color: TEAL }]}>{av.label}</Text>
              {avatarStyle === av.id && (
                <View style={styles.avatarCheck}>
                  <Feather name="check" size={10} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  const isLastStep = step === steps.length - 1;

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.logoMark}>
              <Feather name="zap" size={16} color="#fff" />
            </View>
            <Text style={styles.logoText}>Aivorah</Text>
          </View>
          <Text style={styles.stepCounter}>Step {step + 1} of {steps.length}</Text>
        </View>

        {/* Progress bar */}
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
        </View>

        {/* Step title */}
        <View style={styles.stepHeaderWrap}>
          <View style={styles.stepHeader}>
            <View style={styles.stepIconCircle}>
              <Feather name={steps[step].icon as any} size={20} color={TEAL} />
            </View>
            <View>
              <Text style={styles.stepTitle}>{steps[step].title}</Text>
              <Text style={styles.stepSubtitle}>{steps[step].subtitle}</Text>
            </View>
          </View>
        </View>

        {/* Content */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.centeredCard}>
            {renderStepContent()}
          </View>
        </ScrollView>

        {/* Save error */}
        {saveError ? (
          <View style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.sm }}>
            <Text style={{ color: '#ef4444', fontSize: 13, textAlign: 'center' }}>{saveError}</Text>
          </View>
        ) : null}

        {/* Child account credentials modal */}
        <Modal visible={showChildCreds} transparent animationType="fade" onRequestClose={confirmChildCredsAndFinish}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: TEAL + '20', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="key" size={17} color={TEAL} />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Child Account Created</Text>
                  <Text style={styles.modalText}>Share these login details with your child</Text>
                </View>
              </View>

              <View style={{ backgroundColor: colors.bgDark, borderRadius: 10, padding: 14, gap: 12, borderWidth: 1, borderColor: colors.borderColor }}>
                <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center' }}>
                  Save these — your child uses them to log in as a Student on any device.
                </Text>

                {[
                  { label: 'Student ID', value: createdStudentId, field: 'studentId' },
                  { label: 'Login ID (Email)', value: createdLoginId, field: 'loginId' },
                  ...(createdPassword ? [{ label: 'Password', value: createdPassword, field: 'password' }] : []),
                ].map(({ label, value, field }) => (
                  <View key={field} style={{ gap: 4 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardDark, borderWidth: 1, borderColor: copiedField === field ? TEAL : colors.borderColor, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
                      onPress={() => copyToClipboard(value, field)}
                      activeOpacity={0.7}
                    >
                      <Text style={{ flex: 1, color: colors.textMain, fontSize: 13, fontFamily: 'monospace' }} selectable>{value}</Text>
                      <Feather name={copiedField === field ? 'check' : 'copy'} size={14} color={copiedField === field ? TEAL : colors.textDim} />
                    </TouchableOpacity>
                  </View>
                ))}

                {createdVerificationRequired && (
                  <View style={{ backgroundColor: '#5F8A8612', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#5F8A8630', gap: 4 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#5F8A86' }}>Your child can log in right away.</Text>
                    <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>
                      A verification link was sent to <Text style={{ fontWeight: '700', color: colors.textMain }}>{createdLoginId}</Text>. You (the parent) can open that inbox and click the link — this enables "Forgot Password" if your child ever needs it.
                    </Text>
                  </View>
                )}
              </View>

              <TouchableOpacity style={styles.modalBtn} onPress={confirmChildCredsAndFinish} activeOpacity={0.85}>
                <Text style={styles.modalBtnText}>Got it, I've saved these</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Navigation buttons */}
        <View style={styles.navRow}>
          {step > 0 ? (
            <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.8}>
              <Feather name="arrow-left" size={16} color={colors.textMuted} />
              <Text style={[styles.backBtnText, { color: colors.textMuted }]}>Back</Text>
            </TouchableOpacity>
          ) : <View />}

          <TouchableOpacity
            style={[styles.nextBtn, !canProceed() && styles.nextBtnDisabled]}
            onPress={handleNext}
            disabled={!canProceed() || saving}
            activeOpacity={0.85}
          >
            <Text style={styles.nextBtnText}>
              {saving ? 'Saving...' : isLastStep ? 'Get Started' : 'Continue'}
            </Text>
            {!isLastStep && <Feather name="arrow-right" size={16} color="#fff" />}
            {isLastStep && <Feather name="check" size={16} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (c: AppColors, isDark: boolean) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingTop: 40, paddingBottom: spacing.md,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoMark: {
    width: 32, height: 32, borderRadius: radius.sm,
    backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center',
  },
  logoText: { fontSize: 18, fontWeight: '700', color: c.textMain, letterSpacing: -0.3 },
  stepCounter: { fontSize: 13, color: c.textMuted, fontWeight: '600' },

  progressTrack: {
    height: 4, backgroundColor: c.borderColor,
    marginHorizontal: spacing.xl, borderRadius: 2, overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: TEAL, borderRadius: 2 },

  stepHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    width: '100%', maxWidth: 520,
    paddingTop: 28, paddingBottom: spacing.md,
  },
  stepIconCircle: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: TEAL + '18', alignItems: 'center', justifyContent: 'center',
  },
  stepTitle: { fontSize: 20, fontWeight: '800', color: c.textMain },
  stepSubtitle: { fontSize: 13, color: c.textMuted, marginTop: 2 },

  scrollContent: { flexGrow: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: spacing.md, paddingBottom: 32 },
  centeredCard: { width: '100%', maxWidth: 520, gap: spacing.lg },
  stepContent: { gap: spacing.lg },

  stepHeaderWrap: { alignItems: 'center', paddingHorizontal: spacing.xl },
  fieldLabel: {
    fontSize: 13, fontWeight: '700', color: c.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    height: 48, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, paddingHorizontal: spacing.md,
    fontSize: 15, color: c.textMain,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1, borderColor: c.borderColor,
    backgroundColor: c.cardDark,
  },
  chipActive: { backgroundColor: TEAL + '20', borderColor: TEAL },
  chipText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  chipTextActive: { color: TEAL },

  // Learning style cards
  lsCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark,
  },
  lsCardActive: { borderColor: TEAL, backgroundColor: TEAL + '10' },
  lsIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: c.borderColor + '60', alignItems: 'center', justifyContent: 'center',
  },
  lsLabel: { fontSize: 15, fontWeight: '700', color: c.textMain },
  lsDesc: { fontSize: 12, color: c.textMuted, marginTop: 2 },

  // Avatar grid
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  avatarCard: {
    width: 100, alignItems: 'center', gap: 8,
    padding: spacing.md, borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark,
  },
  avatarCardActive: { borderColor: TEAL, backgroundColor: TEAL + '10' },
  avatarCircle: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  avatarCheck: {
    position: 'absolute', top: 6, right: 6,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center',
  },

  // Navigation
  navRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
    borderTopWidth: 1, borderTopColor: c.borderColor,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: spacing.sm },
  backBtnText: { fontSize: 14, fontWeight: '600' },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: TEAL, paddingHorizontal: 24, paddingVertical: 14,
    borderRadius: radius.md,
  },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalBox: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: c.textMain },
  modalText: { fontSize: 14, color: c.textMuted, lineHeight: 20 },
  modalBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-end',
    backgroundColor: TEAL,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
