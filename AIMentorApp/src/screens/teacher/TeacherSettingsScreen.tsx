import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Switch, Modal, ActivityIndicator, Platform, Image, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import ConnectSchoolBanner from '../../features/classes/components/ConnectSchoolBanner';
import { useAuth } from '../../context/AuthContext';
import { getAvatarGradient, getAvatarIcon } from '../../constants/avatarStyles';
import { useTheme } from '../../context/ThemeContext';
import { useNotification } from '../../context/NotificationContext';
import {
  updatePassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithPopup,
  deleteUser,
} from 'firebase/auth';
import { auth } from '../../config/firebase';
import SERVER_URL from '../../config/serverUrl';
import { GRADES_TEACHER, CURRICULA, getGradesForCurriculum } from '../onboarding/OnboardingScreen';
import TeachingEntriesEditor, { type TeachingEntry, emptyEntry } from '../school-admin/TeachingEntriesEditor';

// Grade levels — mirrors the student onboarding grade selector so the teacher's
// "Grades you teach" picker groups grades by level instead of a flat list.
const GRADE_GROUPS = [
  { label: 'Early Years',   grades: ['Nursery', 'LKG', 'UKG'] },
  { label: 'Primary',       grades: ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'] },
  { label: 'Middle School', grades: ['Grade 6', 'Grade 7', 'Grade 8'] },
  { label: 'Senior School', grades: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] },
];

type ModalType = 'name' | 'email' | 'password' | 'school' | 'curriculum' | 'ssoInfo' | null;

export default function TeacherSettingsScreen({ navigation }: any) {
  const { user, updateUser, logout, switchRole } = useAuth();
  const { colors, themeMode, setThemeMode } = useTheme();
  const { triggerPoll, clearUnreadAssignments, clearUnreadChallenges } = useNotification();
  const gold = colors.accentYellow;
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Notifications — persisted to AsyncStorage under the SAME key/keys the
  // notification bell reads (notifPrefs_<email>: assignmentAlerts / teacherMessages /
  // challengeUpdates). Previously these toggles only changed local state, so turning
  // "Parent Messages" off had no effect and the bell still notified.
  const NOTIF_KEY = `notifPrefs_${user?.email ?? 'guest'}`;
  const [submissionAlerts,  setSubmissionAlerts]  = useState(true);   // assignmentAlerts
  const [parentMessages,    setParentMessages]    = useState(true);   // teacherMessages
  const [weeklyReport,      setWeeklyReport]      = useState(true);
  const [aiInsights,        setAiInsights]        = useState(true);
  const [challengeAlerts,   setChallengeAlerts]   = useState(false);  // challengeUpdates

  useEffect(() => {
    AsyncStorage.getItem(NOTIF_KEY).then(raw => {
      if (!raw) return;
      try {
        const p = JSON.parse(raw);
        if (p.assignmentAlerts != null) setSubmissionAlerts(p.assignmentAlerts);
        if (p.teacherMessages  != null) setParentMessages(p.teacherMessages);
        if (p.challengeUpdates != null) setChallengeAlerts(p.challengeUpdates);
        if (p.weeklyReport     != null) setWeeklyReport(p.weeklyReport);
        if (p.aiInsights       != null) setAiInsights(p.aiInsights);
      } catch {}
    }).catch(() => {});
  }, [NOTIF_KEY]);

  // Persist all current notification prefs (mapping teacher labels → bell keys) and
  // poll immediately so the change takes effect without waiting for the next cycle.
  const saveNotifPrefs = useCallback((override: Record<string, boolean>) => {
    const prefs = {
      assignmentAlerts: submissionAlerts,
      teacherMessages:  parentMessages,
      challengeUpdates: challengeAlerts,
      weeklyReport,
      aiInsights,
      ...override,
    };
    AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(prefs)).catch(() => {});
    triggerPoll();
  }, [NOTIF_KEY, submissionAlerts, parentMessages, challengeAlerts, weeklyReport, aiInsights, triggerPoll]);

  // Teaching prefs that are ENFORCED server-side (AI Auto-Grading, Share Progress) —
  // load from the server profile and PATCH on every toggle so the change takes effect.
  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/user/preferences?email=${encodeURIComponent(user.email)}`)
      .then(r => r.ok ? r.json() : null)
      .then(p => {
        if (!p) return;
        if (p.autoGrading != null)  setAutoGrading(p.autoGrading);
        if (p.shareProgress != null) setShareProgress(p.shareProgress);
        if (p.teacherRole != null) setTeacherRoleVal(p.teacherRole);
        if (p.experience != null)  setExperienceVal(p.experience);
      })
      .catch(() => {});
  }, [user?.email]);
  function saveTeacherPref(key: 'autoGrading' | 'shareProgress', value: boolean) {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/user/preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, [key]: value }),
    }).catch(() => {});
  }

  // Profile photo — same upload flow as the student profile (shared for all roles).
  const [photoUrl,  setPhotoUrl]  = useState<string | null>((user as any)?.photoUrl ?? null);
  const [uploading, setUploading] = useState(false);
  async function handlePickPhoto() {
    if (!user?.email) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow access to your photo library.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.7, base64: true });
    if (result.canceled || !result.assets?.[0]) return;
    setUploading(true);
    try {
      const res = await fetch(`${SERVER_URL}/user/upload-photo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: user.email, base64: result.assets[0].base64, mimeType: result.assets[0].mimeType ?? 'image/jpeg' }),
      });
      const data = await res.json();
      const url = data.photoUrl || data.url;
      if (url) { setPhotoUrl(url); updateUser({ photoUrl: url } as any); }
      else Alert.alert('Upload failed', data.error || 'Could not upload photo.');
    } catch { Alert.alert('Upload failed', 'Could not upload photo. Please try again.'); }
    finally { setUploading(false); }
  }

  // School + curriculum logo — uploaded once here, reused on every worksheet
  // for this school/curriculum (not auto-detected per-PDF).
  const [schoolLogoUrl, setSchoolLogoUrl] = useState<string | null>(null);
  const [curriculumLogoUrl, setCurriculumLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState<'school' | 'curriculum' | null>(null);

  useEffect(() => {
    const school = user?.school, curriculum = (user as any)?.curriculum;
    if (!school && !curriculum) return;
    const params = new URLSearchParams();
    if (school) params.set('school', school);
    if (curriculum) params.set('curriculum', curriculum);
    fetch(`${SERVER_URL}/branding/logos?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        setSchoolLogoUrl(data.schoolLogoUrl || null);
        setCurriculumLogoUrl(data.curriculumLogoUrl || null);
      })
      .catch(() => {});
  }, [user?.school, (user as any)?.curriculum]);

  async function handlePickLogo(kind: 'school' | 'curriculum') {
    const name = kind === 'school' ? user?.school : (user as any)?.curriculum;
    if (!name) { Alert.alert(`Set your ${kind} first`, `Add your ${kind} in Profile & Account before uploading its logo.`); return; }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow access to your photo library.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.9, base64: true });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingLogo(kind);
    try {
      const res = await fetch(`${SERVER_URL}/branding/logo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, name, base64: result.assets[0].base64, mimeType: result.assets[0].mimeType ?? 'image/png' }),
      });
      const data = await res.json();
      if (data.logoUrl) { kind === 'school' ? setSchoolLogoUrl(data.logoUrl) : setCurriculumLogoUrl(data.logoUrl); }
      else Alert.alert('Upload failed', data.error || 'Could not upload logo.');
    } catch { Alert.alert('Upload failed', 'Could not upload logo. Please try again.'); }
    finally { setUploadingLogo(null); }
  }

  // Teaching prefs
  const [autoGrading,       setAutoGrading]       = useState(true);
  const [shareProgress,     setShareProgress]     = useState(true);
  const [teacherRoleVal,    setTeacherRoleVal]    = useState<string | null>(null);
  const [experienceVal,     setExperienceVal]     = useState<string | null>(null);

  const isDualRole = (user?.roles?.length ?? 0) > 1;

  // Parent onboarding modal state
  const [parentModal,   setParentModal]   = useState(false);
  const [parentStep,    setParentStep]    = useState<'choose' | 'create' | 'link'>('choose');
  const [parentLoading, setParentLoading] = useState(false);
  const [parentError,   setParentError]   = useState('');
  const [childName,       setChildName]       = useState('');
  const [childEmail,      setChildEmail]      = useState('');
  const [childPassword,   setChildPassword]   = useState('');
  const [childGrade,      setChildGrade]      = useState('Grade 3');
  const [childCurriculum, setChildCurriculum] = useState('IB PYP');
  const [linkEmail, setLinkEmail] = useState('');

  // Edit modals
  const [activeModal,   setActiveModal]   = useState<ModalType>(null);
  const [modalLoading,  setModalLoading]  = useState(false);
  const [modalError,    setModalError]    = useState('');
  const [newName,       setNewName]       = useState(user?.name || '');
  const [newEmail,      setNewEmail]      = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailStep,     setEmailStep]     = useState<'form' | 'otp'>('form');
  const [emailOtp,      setEmailOtp]      = useState('');
  const [currentPw,     setCurrentPw]    = useState('');
  const [newPw,         setNewPw]        = useState('');
  const [confirmPw,     setConfirmPw]    = useState('');
  const [showCurrent,   setShowCurrent]  = useState(false);
  const [showNew,       setShowNew]      = useState(false);
  const [newSchool,     setNewSchool]    = useState(user?.school || '');
  // Multi-curriculum: a teacher can teach several INDEPENDENT curriculum+grade
  // combos (e.g. IB MYP for Grade 7 AND CBSE for Grade 9) — each row is its
  // own entry, not a cartesian product of every curriculum × every grade.
  function teachesToEntries(): TeachingEntry[] {
    if (Array.isArray(user?.teaches) && user.teaches.length > 0) {
      return user.teaches.map((t: any) => ({
        curriculum: t.curriculum || '', grade: t.grade || '',
        subjectsInput: Array.isArray(t.subjects) ? t.subjects.join(', ') : '',
      }));
    }
    return user?.curriculum || user?.grade ? [{ curriculum: user?.curriculum || '', grade: user?.grade || '', subjectsInput: '' }] : [emptyEntry()];
  }
  const [editEntries, setEditEntries] = useState<TeachingEntry[]>(teachesToEntries());
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Feedback + sign-out confirm (replaces Alert.alert on web)
  const [feedback,       setFeedback]       = useState<{ title: string; message: string } | null>(null);
  // Set when the feedback dialog being shown must sign the user out once
  // dismissed (currently: after a successful email change — see below for why).
  const [logoutAfterFeedback, setLogoutAfterFeedback] = useState(false);
  function dismissFeedback() {
    setFeedback(null);
    if (logoutAfterFeedback) { setLogoutAfterFeedback(false); logout(); }
  }
  const [signOutConfirm, setSignOutConfirm] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Provider-aware account deletion: password users confirm with password, Google
  // SSO users confirm via Google popup. The server removes Supabase + Firebase Auth.
  const isGoogleUser   = user?.authProvider === 'google' || (auth.currentUser?.providerData ?? []).some(p => p.providerId === 'google.com');
  const isPasswordUser = !isGoogleUser;

  async function confirmDeleteAccount() {
    setDeleteError('');
    if (isPasswordUser && !deletePassword) { setDeleteError('Please enter your password to confirm.'); return; }
    setDeleteLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (firebaseUser && firebaseUser.email) {
        if (isPasswordUser) {
          const cred = EmailAuthProvider.credential(firebaseUser.email, deletePassword);
          await reauthenticateWithCredential(firebaseUser, cred);
        } else if (isGoogleUser) {
          await reauthenticateWithPopup(firebaseUser, new GoogleAuthProvider());
        }
        await fetch(`${SERVER_URL}/user/delete-account`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: firebaseUser.email }),
        });
        try { await deleteUser(firebaseUser); } catch (_) { /* already deleted server-side */ }
      }
      logout();
    } catch (e: any) {
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        setDeleteError('Incorrect password. Please try again.');
      } else if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
        setDeleteError('Google confirmation was cancelled. Please try again.');
      } else {
        setDeleteError('Could not delete account. Please try again.');
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  function openModal(type: ModalType) {
    setNewName(user?.name || '');
    setNewEmail(''); setEmailPassword('');
    setEmailStep('form'); setEmailOtp('');
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
    setNewSchool(user?.school || '');
    setEditEntries(teachesToEntries());
    setOpenDropdown(null);
    setModalError('');
    setActiveModal(type);
  }
  function closeModal() { setActiveModal(null); setModalLoading(false); setModalError(''); }

  // Google-SSO "change email" = migrate the account onto a DIFFERENT Google
  // account the teacher owns (same flow as the student settings). No typed email
  // or OTP: they prove ownership via a Google popup and the server moves all data
  // onto it (POST /user/change-email-google). Editing the Firebase top-level email
  // for a Google account (the old path) corrupts it — this is the correct fix.
  async function handleSendEmailOtp() {
  setModalError('');

  const email = newEmail.trim().toLowerCase();

  if (!email) {
    setModalError('Please enter your new email.');
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setModalError('Please enter a valid email address.');
    return;
  }

  if (email === (user?.email || '').toLowerCase()) {
    setModalError('That is already your current email.');
    return;
  }

  if (isPasswordUser && !emailPassword) {
    setModalError('Please enter your current password.');
    return;
  }

  setModalLoading(true);
  setModalError('');

  try {
    // Check if email already exists
    const takenRes = await fetch(
      `${SERVER_URL}/user/role?email=${encodeURIComponent(email)}`
    );

    if (takenRes.ok) {
      setModalError(
        'That email is already registered to another Aivorah account.'
      );
      setModalLoading(false);
      return;
    }

    const firebaseUser = auth.currentUser;

    if (firebaseUser && firebaseUser.email) {
      if (isPasswordUser) {
        const cred = EmailAuthProvider.credential(
          firebaseUser.email,
          emailPassword
        );

        await reauthenticateWithCredential(firebaseUser, cred);
      } else if (isGoogleUser) {
        await reauthenticateWithPopup(
          firebaseUser,
          new GoogleAuthProvider()
        );
      }
    }

    const res = await fetch(`${SERVER_URL}/user/email-otp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        name: user?.name,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Could not send the verification code.');
    }

    setEmailStep('otp');
  } catch (e: any) {
    if (
      e.code === 'auth/wrong-password' ||
      e.code === 'auth/invalid-credential'
    ) {
      setModalError('Incorrect password. Please try again.');
    } else if (
      e.code === 'auth/popup-closed-by-user' ||
      e.code === 'auth/cancelled-popup-request'
    ) {
      setModalError('Google confirmation was cancelled. Please try again.');
    } else {
      setModalError(
        e.message || 'Failed to send verification code.'
      );
    }
  } finally {
    setModalLoading(false);
  }
}

async function handleVerifyEmailOtp() {
  setModalError('');

  if (!emailOtp.trim()) {
    setModalError('Please enter the code.');
    return;
  }

  setModalLoading(true);

  try {
    const changedTo = newEmail.trim().toLowerCase();

    const res = await fetch(`${SERVER_URL}/user/change-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentEmail: user?.email,
        newEmail: changedTo,
        otp: emailOtp.trim(),
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || 'Could not update your email.');
    }

    closeModal();
    setLogoutAfterFeedback(true);
    setFeedback({
      title: 'Email Updated',
      message: `Your email has been changed to ${changedTo}. For security, please sign in again with your new email.`,
    });
  } catch (e: any) {
    setModalError(e.message || 'Failed to update email.');
  } finally {
    setModalLoading(false);
  }
}
  async function handleSwitchGoogleAccount() {
    setModalError('');
    setModalLoading(true);
    try {
      const currentEmail = (user?.email || '').toLowerCase();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      const newEmailAddr = (result.user.email || '').toLowerCase();
      if (!newEmailAddr) throw new Error('That Google account has no email address.');
      if (newEmailAddr === currentEmail) throw new Error('That is the same Google account you already use. Pick a different one.');

      const idToken = await result.user.getIdToken();
      const res = await fetch(`${SERVER_URL}/user/change-email-google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentEmail, idToken }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not switch your Google account.');

      closeModal();
      setLogoutAfterFeedback(true);
      setFeedback({
        title: 'Email Updated',
        message: `Your account is now linked to ${d.newEmail || newEmailAddr}. For security, please sign in again with your new Google account.`,
      });
    } catch (e: any) {
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
        setModalError('Google selection was cancelled. Please try again.');
      } else {
        setModalError(e.message || 'Failed to switch Google account.');
      }
    } finally { setModalLoading(false); }
  }

  async function handleSaveName() {
    if (!newName.trim()) { setModalError('Please enter a name.'); return; }
    setModalLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, name: newName.trim() }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to save'); }
      updateUser({ name: newName.trim() });
      closeModal();
      setFeedback({ title: 'Updated', message: 'Your display name has been updated.' });
    } catch (e: any) {
      setModalError(e.message || 'Failed to update name.');
    } finally { setModalLoading(false); }
  }

  async function handleSaveSchool() {
    setModalLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, school: newSchool.trim() }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to save'); }
      updateUser({ school: newSchool.trim() });
      closeModal();
      setFeedback({ title: 'Updated', message: 'School / Institution has been saved.' });
    } catch (e: any) {
      setModalError(e.message || 'Failed to update school.');
    } finally { setModalLoading(false); }
  }

  async function handleSaveCurriculum() {
    const validEntries = editEntries.filter(e => e.curriculum && e.grade);
    if (validEntries.length === 0) { setModalError('Please add at least one curriculum + grade.'); return; }
    setModalLoading(true);
    try {
      // Each row is an INDEPENDENT curriculum+grade the teacher actually
      // teaches (e.g. IB MYP/Grade 7 and CBSE/Grade 9) — no cross-product.
      // The users columns hold the first row's values for legacy consumers.
      const teaches = validEntries.map(e => ({
        grade: e.grade, curriculum: e.curriculum,
        subjects: e.subjectsInput.split(',').map(s => s.trim()).filter(Boolean),
      }));
      const primaryCurriculum = teaches[0].curriculum;
      const primaryGrade = teaches[0].grade;
      const res = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, curriculum: primaryCurriculum, grade: primaryGrade, teaches }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to save'); }
      updateUser({ curriculum: primaryCurriculum, grade: primaryGrade, teaches: teaches as any });
      closeModal();
      setFeedback({ title: 'Updated', message: 'Curriculum and grades have been saved.' });
    } catch (e: any) {
      setModalError(e.message || 'Failed to update curriculum.');
    } finally { setModalLoading(false); }
  }

  async function handleChangePassword() {
    // Strip all whitespace to match the login screen (pass.replace(/\s+/g,'')),
    // so a copy-pasted current password with a stray space still re-authenticates. (#154)
    const curPwClean = (currentPw || '').replace(/\s+/g, '');
    const newPwClean = (newPw || '').replace(/\s+/g, '');
    const confirmPwClean = (confirmPw || '').replace(/\s+/g, '');
    if (!curPwClean) { setModalError('Enter your current password.'); return; }
    if (newPwClean.length < 6) { setModalError('New password must be at least 6 characters.'); return; }
    if (newPwClean !== confirmPwClean) { setModalError('Passwords do not match.'); return; }
    setModalLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (firebaseUser && firebaseUser.email) {
        const cred = EmailAuthProvider.credential(firebaseUser.email, curPwClean);
        await reauthenticateWithCredential(firebaseUser, cred);
        await updatePassword(firebaseUser, newPwClean);
      }
      closeModal();
      setFeedback({ title: 'Password Changed', message: 'Your password has been updated successfully.' });
    } catch (e: any) {
      setModalError(e.message || 'Failed to change password.');
    } finally { setModalLoading(false); }
  }

  function openParentOnboarding() {
    setParentStep('choose');
    setParentError('');
    setChildName(''); setChildEmail(''); setChildPassword('');
    setChildGrade('Grade 3'); setChildCurriculum('IB PYP');
    setLinkEmail('');
    setParentModal(true);
  }

  async function submitParentOnboarding() {
    if (!user?.email) return;
    setParentLoading(true);
    setParentError('');
    try {
      const roleRes = await fetch(`${SERVER_URL}/user/add-role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, role: 'parent' }),
      });
      if (!roleRes.ok) throw new Error('Failed to add parent role');
      const roleData = await roleRes.json();

      if (parentStep === 'create') {
        if (!childName.trim()) {
          setParentError('Child\'s name is required.'); setParentLoading(false); return;
        }
        const r = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(user.email)}/children/create-student`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: childName.trim(), email: childEmail.trim() || undefined, password: childPassword.trim() || undefined, grade: childGrade, curriculum: childCurriculum, school: user.school || '' }),
        });
        const d = await r.json();
        if (!r.ok) { setParentError(d.error || 'Could not create student account.'); setParentLoading(false); return; }
      } else if (parentStep === 'link') {
        if (!linkEmail.trim()) { setParentError('Please enter the student email.'); setParentLoading(false); return; }
        const r = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(user.email)}/children`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ childEmail: linkEmail.trim() }),
        });
        const d = await r.json();
        if (!r.ok) { setParentError(d.error || 'Could not link student.'); setParentLoading(false); return; }
      }

      updateUser({ roles: roleData.roles as any });
      setParentModal(false);
      setFeedback({ title: 'Parent Profile Ready', message: "Switch to your Parent profile from the sidebar to view your child's progress and assign work." });
    } catch (e: any) {
      setParentError(e.message || 'Something went wrong. Please try again.');
    } finally {
      setParentLoading(false);
    }
  }

  function handleSignOut() {
    setSignOutConfirm(true);
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Settings"
          subtitle="Manage your preferences and account"
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ConnectSchoolBanner />
          <View style={styles.columns}>

            {/* ── Left column ── */}
            <View style={styles.col}>
              {/* ── Profile ── */}
              <SectionHeader icon="user" label="Profile & Account" color={gold} styles={styles} />
              <View style={styles.card}>
                <View style={styles.profileRow}>
                  <TouchableOpacity style={styles.avatarBig} onPress={handlePickPhoto} activeOpacity={0.85}>
                    {photoUrl ? (
                      <Image source={{ uri: photoUrl }} style={{ width: '100%', height: '100%', borderRadius: 32 }} />
                    ) : (user as any)?.avatarStyle ? (
                      <LinearGradient
                        colors={getAvatarGradient((user as any).avatarStyle)}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        style={{ width: '100%', height: '100%', borderRadius: 32, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Feather name={getAvatarIcon((user as any).avatarStyle) as any} size={28} color="white" />
                      </LinearGradient>
                    ) : (
                      <Text style={styles.avatarInitial}>{user?.name ? user.name[0].toUpperCase() : 'T'}</Text>
                    )}
                    <View style={styles.avatarCam}>
                      {uploading ? <ActivityIndicator size="small" color={colors.accentYellow} /> : <Feather name="camera" size={11} color={colors.accentYellow} />}
                    </View>
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.profileName}>{user?.name || 'Teacher'}</Text>
                    <Text style={styles.profileSub}>{user?.email || ''}</Text>
                    <View style={styles.profileMeta}>
                      <View style={styles.roleBadge}>
                        <Feather name="briefcase" size={10} color={gold} />
                        <Text style={styles.roleBadgeText}>Teacher</Text>
                      </View>
                      {user?.school ? (
                        <View style={[styles.roleBadge, { backgroundColor: colors.accentGreen + '15', borderColor: colors.accentGreen + '30' }]}>
                          <Feather name="home" size={10} color={colors.accentGreen} />
                          <Text style={[styles.roleBadgeText, { color: colors.accentGreen }]}>{user.school}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
                <View style={styles.divider} />
                <FieldRow label="Display Name" sub={user?.name || '—'} btnLabel="Change" onPress={() => openModal('name')} styles={styles} />
                <View style={styles.divider} />
                <FieldRow label="Email Address" sub={user?.email || '—'} btnLabel="Change" onPress={() => openModal('email')} styles={styles} />
                <View style={styles.divider} />
                <FieldRow label="School / Institution" sub={user?.school || 'Not set'} btnLabel="Update" onPress={() => openModal('school')} styles={styles} />
                <View style={styles.divider} />
                <View style={styles.fieldRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Parent Profile</Text>
                    <Text style={styles.fieldSub}>
                      {isDualRole
                        ? 'You have a parent profile — switch from the sidebar'
                        : 'Add a parent profile to monitor your child\'s learning'}
                    </Text>
                  </View>
                  {isDualRole ? (
                    <View style={[styles.comingSoonBadge, { backgroundColor: colors.accentGreen + '18', borderColor: colors.accentGreen + '40' }]}>
                      <Text style={[styles.comingSoonText, { color: colors.accentGreen }]}>Active</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.changeBtn, { backgroundColor: gold + '15', borderColor: gold + '40', borderWidth: 1 }]}
                      onPress={openParentOnboarding}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.changeBtnText, { color: gold }]}>Add</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* ── Branding (school + curriculum logo, reused on every worksheet) ── */}
              <SectionHeader icon="image" label="Worksheet Branding" color={gold} styles={styles} />
              <View style={styles.card}>
                <View style={styles.fieldRow}>
                  <TouchableOpacity onPress={() => handlePickLogo('school')} activeOpacity={0.85}
                    style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {uploadingLogo === 'school' ? <ActivityIndicator size="small" color={gold} />
                      : schoolLogoUrl ? <Image source={{ uri: schoolLogoUrl }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                      : <Feather name="upload" size={16} color={colors.textDim} />}
                  </TouchableOpacity>
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={styles.fieldLabel}>School Logo</Text>
                    <Text style={styles.fieldSub}>{user?.school || 'Set your school in Profile & Account first'}</Text>
                  </View>
                  <TouchableOpacity style={styles.changeBtn} onPress={() => handlePickLogo('school')} activeOpacity={0.7}>
                    <Text style={styles.changeBtnText}>{schoolLogoUrl ? 'Change' : 'Upload'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.divider} />
                <View style={styles.fieldRow}>
                  <TouchableOpacity onPress={() => handlePickLogo('curriculum')} activeOpacity={0.85}
                    style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {uploadingLogo === 'curriculum' ? <ActivityIndicator size="small" color={gold} />
                      : curriculumLogoUrl ? <Image source={{ uri: curriculumLogoUrl }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                      : <Feather name="upload" size={16} color={colors.textDim} />}
                  </TouchableOpacity>
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={styles.fieldLabel}>Curriculum Logo</Text>
                    <Text style={styles.fieldSub}>{(user as any)?.curriculum || 'Set your curriculum in Profile & Account first'}</Text>
                  </View>
                  <TouchableOpacity style={styles.changeBtn} onPress={() => handlePickLogo('curriculum')} activeOpacity={0.7}>
                    <Text style={styles.changeBtnText}>{curriculumLogoUrl ? 'Change' : 'Upload'}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.fieldSub, { marginTop: spacing.sm, fontStyle: 'italic' }]}>
                  These two logos appear on every worksheet header for your school/curriculum.
                </Text>
              </View>

              {/* ── Security ── */}
              <SectionHeader icon="shield" label="Security" color={colors.accentGreen} styles={styles} />
              <View style={styles.card}>
              <FieldRow
                label="Password"
                sub={isPasswordUser ? "Change your account password" : "Managed via Google Sign-In"}
                btnLabel={isPasswordUser ? "Change" : "Google SSO"}
                badgeOnly={!isPasswordUser}
                onPress={isPasswordUser ? () => openModal('password') : () => openModal('ssoInfo' as any)}
                styles={styles}
              />
                <View style={styles.divider} />
                <View style={styles.fieldRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Two-Factor Auth</Text>
                    <Text style={styles.fieldSub}>Add an extra layer of security</Text>
                  </View>
                  <View style={styles.comingSoonBadge}>
                    <Text style={styles.comingSoonText}>Soon</Text>
                  </View>
                </View>
              </View>

              {/* ── Account Actions ── */}
              <SectionHeader icon="alert-triangle" label="Account Actions" color={gold} styles={styles} />
              <View style={styles.card}>
                <View style={[styles.actionsRow, { marginTop: 0 }]}>
                  <TouchableOpacity style={styles.actionBtn} onPress={handleSignOut} activeOpacity={0.8}>
                    <Feather name="log-out" size={17} color={gold} />
                    <Text style={[styles.actionBtnText, { color: gold }]}>Sign Out</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => { setDeletePassword(''); setDeleteError(''); setDeleteModalVisible(true); }} activeOpacity={0.8}>
                    <Feather name="trash-2" size={17} color={colors.accentRed} />
                    <Text style={[styles.actionBtnText, { color: colors.accentRed }]}>Delete Account</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* ── Right column ── */}
            <View style={styles.col}>
              {/* ── Teaching Preferences ── */}
              <SectionHeader icon="settings" label="Teaching Preferences" color={colors.accentBlue} styles={styles} />
              <View style={styles.card}>
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>AI Auto-Grading</Text>
                    <Text style={styles.fieldSub}>Let AI grade assignments automatically</Text>
                  </View>
                  <Switch value={autoGrading} onValueChange={(v) => { setAutoGrading(v); saveTeacherPref('autoGrading', v); }} trackColor={{ false: colors.borderColor, true: gold }} thumbColor="white" />
                </View>
                <View style={styles.divider} />
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Share Progress with Parents</Text>
                    <Text style={styles.fieldSub}>Parents can see their child's scores and activity</Text>
                  </View>
                  <Switch value={shareProgress} onValueChange={(v) => { setShareProgress(v); saveTeacherPref('shareProgress', v); }} trackColor={{ false: colors.borderColor, true: gold }} thumbColor="white" />
                </View>
                <View style={styles.divider} />
                <View style={styles.fieldRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Curriculum</Text>
                    <Text style={styles.fieldSub}>{(() => {
                      const teaches = Array.isArray(user?.teaches) ? user.teaches : [];
                      const tCurricula = teaches.length > 0
                        ? [...new Set(teaches.map((t: any) => t.curriculum).filter(Boolean))]
                        : (user?.curriculum ? [user.curriculum] : ['IB PYP']);
                      const tGrades = teaches.length > 0
                        ? [...new Set(teaches.map((t: any) => t.grade).filter(Boolean))]
                        : (user?.grade ? [user.grade] : []);
                      const cLabel = tCurricula.join(', ');
                      if (tGrades.length === 0) return cLabel || 'Not set — tap Update to add your grades';
                      const gLabel = tGrades.map((g: string) => g.replace('Grade ', '')).join(', ');
                      return `${cLabel} · Grade${tGrades.length > 1 ? 's' : ''} ${gLabel}`;
                    })()}</Text>
                  </View>
                  <TouchableOpacity style={styles.changeBtn} onPress={() => openModal('curriculum')} activeOpacity={0.7}>
                    <Text style={styles.changeBtnText}>Update</Text>
                  </TouchableOpacity>
                </View>
                {(teacherRoleVal || experienceVal) && (
                  <>
                    <View style={styles.divider} />
                    <View style={styles.fieldRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fieldLabel}>Role &amp; Experience</Text>
                        <Text style={styles.fieldSub}>
                          {[teacherRoleVal, experienceVal].filter(Boolean).join(' · ') || 'Not set'}
                        </Text>
                      </View>
                    </View>
                  </>
                )}
              </View>

              {/* ── Notifications ── */}
              <SectionHeader icon="bell" label="Notifications" color={colors.accentYellow} styles={styles} />
              <View style={styles.card}>
                {[
                  { key: 'teacherMessages',  label: 'Parent Messages', sub: 'New messages from parents', val: parentMessages, set: setParentMessages },
                  { key: 'weeklyReport',     label: 'Weekly Class Report', sub: 'Summary of class activity each week', soon: true },
                  { key: 'aiInsights',       label: 'AI Class Insights', sub: 'Smart suggestions for your class', soon: true },
                ].map((item: any, i) => (
                  <View key={item.label}>
                    {i > 0 && <View style={styles.divider} />}
                    <View style={styles.toggleRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fieldLabel}>{item.label}</Text>
                        <Text style={styles.fieldSub}>{item.sub}</Text>
                      </View>
                      {item.soon ? (
                        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: gold + '18' }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: gold }}>Soon</Text>
                        </View>
                      ) : (
                      <Switch
                        value={item.val}
                        onValueChange={(v) => {
                          item.set(v);
                          saveNotifPrefs({ [item.key]: v });
                          // Turning ON dismisses the OFF-period backlog so it doesn't replay.
                          if (v && item.key === 'challengeUpdates') clearUnreadChallenges();
                        }}
                        trackColor={{ false: colors.borderColor, true: gold }}
                        thumbColor="white"
                      />
                      )}
                    </View>
                  </View>
                ))}
              </View>

              {/* ── Appearance ── */}
              <SectionHeader icon="moon" label="Appearance" color={colors.accentPurple} styles={styles} />
              <View style={styles.card}>
                <Text style={styles.fieldLabel}>Theme</Text>
                <View style={styles.themeRow}>
                  {([
                    { id: 'dark', icon: 'moon', label: 'Dark' },
                    { id: 'light', icon: 'sun', label: 'Light' },
                    { id: 'auto', icon: 'monitor', label: 'Auto' },
                  ] as const).map(t => (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.themeOption, themeMode === t.id && styles.themeOptionActive]}
                      onPress={() => setThemeMode(t.id)}
                      activeOpacity={0.7}
                    >
                      <Feather name={t.icon} size={16} color={themeMode === t.id ? gold : colors.textMuted} />
                      <Text style={[styles.themeLabel, themeMode === t.id && { color: gold }]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

          </View>
          <Text style={styles.versionText}>Aivorah v1.0.0 · NuShift</Text>
        </ScrollView>
      </View>

      {/* Change Name Modal */}
      <AppModal visible={activeModal === 'name'} title="Change Display Name" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalFieldLabel}>New Name</Text>
        <View style={styles.modalInput}>
          <Feather name="user" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput} value={newName} onChangeText={setNewName}
            placeholder="Your name" placeholderTextColor={colors.textDim}
            autoCapitalize="words" autoFocus
          />
        </View>
        {modalError ? <Text style={{ color: colors.accentRed, fontSize: 13, marginTop: 8 }}>{modalError}</Text> : null}
        <ModalButtons onCancel={closeModal} onSave={handleSaveName} loading={modalLoading} styles={styles} />
      </AppModal>

      {/* Change Email Modal — two steps: (1) confirm identity + enter new email,
          (2) verify the code we email to the NEW address before committing. */}
      <AppModal visible={activeModal === 'email'} title="Change Email Address" onClose={closeModal} styles={styles} colors={colors}>
        {isGoogleUser ? (
          <>
            <Text style={styles.modalNote}>
              Your account signs in with Google, so its email is your Google account. To use a different
              address, switch to another Google account you own — we'll move your account and all its data
              onto it. You'll pick the account in a Google window.
            </Text>
            <View style={[styles.modalInput, { opacity: 0.7 }]}>
              <Feather name="mail" size={15} color={colors.textDim} />
              <Text style={[styles.modalTextInput, { color: colors.textDim }]} numberOfLines={1}>{user?.email}</Text>
            </View>
            {modalError ? <Text style={{ color: colors.accentRed, fontSize: 13, marginTop: 8 }}>{modalError}</Text> : null}
            <ModalButtons
              onCancel={closeModal}
              onSave={handleSwitchGoogleAccount}
              loading={modalLoading} saveLabel="Switch Google Account" styles={styles}
            />
          </>
        ) : emailStep === 'form' ? (
          <>
            <Text style={styles.modalNote}>
              Enter your new email and current password to confirm.
            </Text>
            <Text style={styles.modalFieldLabel}>New Email</Text>
            <View style={styles.modalInput}>
              <Feather name="mail" size={15} color={colors.textDim} />
              <TextInput
                style={styles.modalTextInput} value={newEmail} onChangeText={setNewEmail}
                placeholder="new@example.com" placeholderTextColor={colors.textDim}
                keyboardType="email-address" autoCapitalize="none" autoFocus
              />
            </View>
            <Text style={styles.modalFieldLabel}>Current Password</Text>
            <View style={styles.modalInput}>
              <Feather name="lock" size={15} color={colors.textDim} />
              <TextInput
                style={styles.modalTextInput} value={emailPassword} onChangeText={setEmailPassword}
                placeholder="••••••••" placeholderTextColor={colors.textDim} secureTextEntry
              />
            </View>
            {modalError ? <Text style={{ color: colors.accentRed, fontSize: 13, marginTop: 8 }}>{modalError}</Text> : null}
           <ModalButtons
             onCancel={closeModal}
             onSave={handleSendEmailOtp}
             loading={modalLoading}
             saveLabel={isGoogleUser ? 'Confirm with Google' : 'Send Verification Code'}
             styles={styles}
            />
          </>
        ) : (
          <>
            <Text style={styles.modalNote}>
              We sent a 6-digit code to <Text style={{ fontWeight: '700' }}>{newEmail.trim()}</Text>. Enter it below to confirm the change.
            </Text>
            <Text style={styles.modalFieldLabel}>Verification Code</Text>
            <View style={styles.modalInput}>
              <Feather name="shield" size={15} color={colors.textDim} />
              <TextInput
                style={styles.modalTextInput} value={emailOtp} onChangeText={setEmailOtp}
                placeholder="123456" placeholderTextColor={colors.textDim}
                keyboardType="number-pad" maxLength={6} autoFocus
              />
            </View>
            <TouchableOpacity
              disabled={modalLoading}
              onPress={async () => {
                setModalError('');
                try {
                  const res = await fetch(`${SERVER_URL}/user/email-otp/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: newEmail.trim().toLowerCase(), name: user?.name }),
                  });
                  const d = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(d.error || 'Could not resend the code.');
                  setFeedback({ title: 'Code Resent', message: `A new code was sent to ${newEmail.trim()}.` });
                } catch (e: any) {
                  setModalError(e.message || 'Failed to resend code.');
                }
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.accentYellow, marginTop: 4 }}>Resend code</Text>
            </TouchableOpacity>
            {modalError ? <Text style={{ color: colors.accentRed, fontSize: 13, marginTop: 8 }}>{modalError}</Text> : null}
        <ModalButtons
          onCancel={() => setEmailStep('form')}
          cancelLabel="Back"
          onSave={handleVerifyEmailOtp}
          loading={modalLoading}
          saveLabel="Verify & Update Email"
          styles={styles}
        />
          </>
        )}
      </AppModal>

      {/* Google SSO Info Modal */}
      <AppModal visible={activeModal === 'ssoInfo' || (activeModal === 'password' && !isPasswordUser)} title="Google Sign-In Account" onClose={closeModal} styles={styles} colors={colors}>
        <View style={{ alignItems: 'center', paddingVertical: 12 }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accentYellow + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <Feather name="shield" size={24} color={colors.accentYellow} />
          </View>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.textMain, textAlign: 'center', marginBottom: 8 }}>
            Managed via Google Sign-In
          </Text>
          <Text style={{ fontSize: 13, color: colors.textDim, textAlign: 'center', lineHeight: 20, marginBottom: 16 }}>
            You signed into Aivorah securely using your Google Account. Your password and account security are protected by Google. To change your password or security settings, please visit your Google Account Security settings (myaccount.google.com).
          </Text>
          <TouchableOpacity
            style={[styles.modalSaveBtn, { width: '100%', marginTop: 8 }]}
            onPress={closeModal}
            activeOpacity={0.8}
          >
            <Text style={styles.modalSaveText}>Understood</Text>
          </TouchableOpacity>
        </View>
      </AppModal>

      {/* Change Password Modal */}
      <AppModal visible={activeModal === 'password' && isPasswordUser} title="Change Password" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalFieldLabel}>Current Password</Text>
        <View style={styles.modalInput}>
          <Feather name="lock" size={15} color={colors.textDim} />
          <TextInput
            style={[styles.modalTextInput, { flex: 1 }]} value={currentPw} onChangeText={setCurrentPw}
            placeholder="••••••••" placeholderTextColor={colors.textDim} secureTextEntry={!showCurrent} autoFocus
          />
          <TouchableOpacity onPress={() => setShowCurrent(!showCurrent)}>
            <Feather name={showCurrent ? 'eye-off' : 'eye'} size={15} color={colors.textDim} />
          </TouchableOpacity>
        </View>
        <Text style={styles.modalFieldLabel}>New Password</Text>
        <View style={styles.modalInput}>
          <Feather name="lock" size={15} color={colors.textDim} />
          <TextInput
            style={[styles.modalTextInput, { flex: 1 }]} value={newPw} onChangeText={setNewPw}
            placeholder="Min. 6 characters" placeholderTextColor={colors.textDim} secureTextEntry={!showNew}
          />
          <TouchableOpacity onPress={() => setShowNew(!showNew)}>
            <Feather name={showNew ? 'eye-off' : 'eye'} size={15} color={colors.textDim} />
          </TouchableOpacity>
        </View>
        <Text style={styles.modalFieldLabel}>Confirm New Password</Text>
        <View style={styles.modalInput}>
          <Feather name="check" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput} value={confirmPw} onChangeText={setConfirmPw}
            placeholder="Repeat new password" placeholderTextColor={colors.textDim} secureTextEntry
          />
        </View>
        {modalError ? <Text style={{ color: colors.accentRed, fontSize: 13, marginTop: 8 }}>{modalError}</Text> : null}
        <ModalButtons onCancel={closeModal} onSave={handleChangePassword} loading={modalLoading} saveLabel="Change Password" styles={styles} />
      </AppModal>

      {/* School Modal */}
      <AppModal visible={activeModal === 'school'} title="School / Institution" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalFieldLabel}>School Name</Text>
        <View style={styles.modalInput}>
          <Feather name="home" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput} value={newSchool} onChangeText={setNewSchool}
            placeholder="e.g. DPS Hyderabad" placeholderTextColor={colors.textDim}
            autoCapitalize="words" autoFocus
          />
        </View>
        {modalError ? <Text style={{ color: colors.accentRed, fontSize: 13, marginTop: 8 }}>{modalError}</Text> : null}
        <ModalButtons onCancel={closeModal} onSave={handleSaveSchool} loading={modalLoading} saveLabel="Save" styles={styles} />
      </AppModal>

      {/* Curriculum Modal — one row per curriculum+grade the teacher actually
          teaches (e.g. IB MYP/Grade 7 and CBSE/Grade 9 as two independent rows,
          not a grid of every curriculum × every grade). */}
      <AppModal visible={activeModal === 'curriculum'} title="Curriculum & Grade" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalFieldLabel}>What you teach — add a row for each curriculum + grade</Text>
        <TeachingEntriesEditor
          entries={editEntries}
          onChange={setEditEntries}
          schoolCurriculumBase={null}
          colors={colors}
          openDropdown={openDropdown}
          setOpenDropdown={setOpenDropdown}
        />
        {modalError ? <Text style={{ color: colors.accentRed, fontSize: 13, marginTop: 8 }}>{modalError}</Text> : null}
        <ModalButtons onCancel={closeModal} onSave={handleSaveCurriculum} loading={modalLoading} saveLabel="Save" styles={styles} />
      </AppModal>

      {/* ── Parent Profile Onboarding Modal ── */}
      <Modal visible={parentModal} transparent animationType="fade" onRequestClose={() => setParentModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxWidth: 480 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accentGreen + '20', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="home" size={16} color={colors.accentGreen} />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Add Parent Profile</Text>
                  <Text style={[styles.fieldSub, { marginTop: 0 }]}>Monitor your child's learning on Aivorah</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setParentModal(false)}><Feather name="x" size={20} color={colors.textMuted} /></TouchableOpacity>
            </View>

            {parentStep === 'choose' && (
              <View style={{ gap: 12, marginTop: 8 }}>
                <Text style={[styles.fieldLabel, { marginBottom: 4 }]}>How would you like to add your child?</Text>
                <TouchableOpacity
                  style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }]}
                  onPress={() => setParentStep('create')} activeOpacity={0.8}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: gold + '20', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="user-plus" size={18} color={gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Create new student account</Text>
                    <Text style={styles.fieldSub}>My child doesn't have an Aivorah account yet</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.textDim} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }]}
                  onPress={() => setParentStep('link')} activeOpacity={0.8}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentBlue + '20', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="link" size={18} color={colors.accentBlue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Link existing account</Text>
                    <Text style={styles.fieldSub}>My child already has an Aivorah student account</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.textDim} />
                </TouchableOpacity>
              </View>
            )}

            {parentStep === 'create' && (
              <View style={{ gap: 10, marginTop: 8 }}>
                <TouchableOpacity onPress={() => setParentStep('choose')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Feather name="arrow-left" size={14} color={colors.textMuted} />
                  <Text style={[styles.fieldSub, { color: colors.textMuted }]}>Back</Text>
                </TouchableOpacity>
                <Text style={styles.fieldLabel}>Child's Full Name *</Text>
                <TextInput style={styles.modalTextInput} value={childName} onChangeText={setChildName} placeholder="e.g. Arjun" placeholderTextColor={colors.textDim} autoCapitalize="words" />
                <Text style={styles.fieldLabel}>Child's Email <Text style={{ fontWeight: '400', color: colors.textDim }}>(optional)</Text></Text>
                <TextInput style={styles.modalTextInput} value={childEmail} onChangeText={setChildEmail} placeholder="Leave blank to auto-generate" placeholderTextColor={colors.textDim} keyboardType="email-address" autoCapitalize="none" />
                <Text style={styles.fieldLabel}>Password <Text style={{ fontWeight: '400', color: colors.textDim }}>(optional)</Text></Text>
                <TextInput style={styles.modalTextInput} value={childPassword} onChangeText={setChildPassword} placeholder="Leave blank to auto-generate" placeholderTextColor={colors.textDim} secureTextEntry />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Grade</Text>
                    {(['Grade 3','Grade 4','Grade 5','Grade 6'] as const).map(g => (
                      <TouchableOpacity key={g} onPress={() => setChildGrade(g)} activeOpacity={0.8}
                        style={[styles.modalTextInput, { marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderColor: childGrade === g ? gold : colors.borderColor }]}
                      >
                        <Text style={[styles.fieldSub, { color: childGrade === g ? gold : colors.textMuted }]}>{g}</Text>
                        {childGrade === g && <Feather name="check" size={13} color={gold} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Curriculum</Text>
                    {(['IB PYP','CBSE','ICSE','Cambridge'] as const).map(c => (
                      <TouchableOpacity key={c} onPress={() => setChildCurriculum(c)} activeOpacity={0.8}
                        style={[styles.modalTextInput, { marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderColor: childCurriculum === c ? gold : colors.borderColor }]}
                      >
                        <Text style={[styles.fieldSub, { color: childCurriculum === c ? gold : colors.textMuted }]}>{c}</Text>
                        {childCurriculum === c && <Feather name="check" size={13} color={gold} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                {parentError ? <Text style={{ color: colors.accentRed, fontSize: 13 }}>{parentError}</Text> : null}
                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setParentModal(false)}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalSaveBtn} onPress={submitParentOnboarding} disabled={parentLoading}>
                    {parentLoading ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.modalSaveText}>Create & Link</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {parentStep === 'link' && (
              <View style={{ gap: 10, marginTop: 8 }}>
                <TouchableOpacity onPress={() => setParentStep('choose')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Feather name="arrow-left" size={14} color={colors.textMuted} />
                  <Text style={[styles.fieldSub, { color: colors.textMuted }]}>Back</Text>
                </TouchableOpacity>
                <Text style={styles.fieldLabel}>Child's Aivorah Email</Text>
                <Text style={styles.fieldSub}>Enter the email address your child uses to log into Aivorah</Text>
                <TextInput style={styles.modalTextInput} value={linkEmail} onChangeText={setLinkEmail} placeholder="child@example.com" placeholderTextColor={colors.textDim} keyboardType="email-address" autoCapitalize="none" />
                {parentError ? <Text style={{ color: colors.accentRed, fontSize: 13 }}>{parentError}</Text> : null}
                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setParentModal(false)}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalSaveBtn} onPress={submitParentOnboarding} disabled={parentLoading}>
                    {parentLoading ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.modalSaveText}>Link Child</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Sign Out Confirmation */}
      <Modal visible={signOutConfirm} transparent animationType="fade" onRequestClose={() => setSignOutConfirm(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxWidth: 360 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sign Out</Text>
              <TouchableOpacity onPress={() => setSignOutConfirm(false)}><Feather name="x" size={20} color={colors.textMuted} /></TouchableOpacity>
            </View>
            <Text style={styles.modalNote}>Are you sure you want to sign out?</Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setSignOutConfirm(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalSaveBtn, { backgroundColor: colors.accentRed }]} onPress={() => { setSignOutConfirm(false); logout(); }}>
                <Text style={styles.modalSaveText}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Account — provider-aware (password vs Google), plain overlay for instant close */}
      {deleteModalVisible ? (
        <View style={{ position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl, zIndex: 9999 }}>
          <View style={[styles.modalBox, { maxWidth: 380 }]}>
            <View style={{ alignItems: 'center', marginBottom: 14 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accentRed + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <Feather name="trash-2" size={24} color={colors.accentRed} />
              </View>
              <Text style={[styles.modalTitle, { textAlign: 'center' }]}>Delete Account?</Text>
              <Text style={[styles.modalNote, { textAlign: 'center', marginBottom: 0 }]}>
                This is permanent and cannot be undone. All your data will be lost.
              </Text>
            </View>
            {isPasswordUser ? (
              <>
                <Text style={styles.modalFieldLabel}>Enter your password to confirm</Text>
                <View style={styles.modalInput}>
                  <Feather name="lock" size={15} color={colors.textDim} />
                  <TextInput
                    style={[styles.modalTextInput, { flex: 1 }]}
                    value={deletePassword}
                    onChangeText={(v) => { setDeletePassword(v); setDeleteError(''); }}
                    placeholder="Your password" placeholderTextColor={colors.textDim}
                    secureTextEntry autoFocus
                  />
                </View>
              </>
            ) : (
              <View style={[styles.modalInput, { gap: 8 }]}>
                <Feather name="shield" size={15} color={colors.textDim} />
                <Text style={[styles.modalTextInput, { flex: 1, color: colors.textMuted }]} numberOfLines={2}>
                  You'll confirm with Google to delete your account.
                </Text>
              </View>
            )}
            {!!deleteError && <Text style={{ fontSize: 12, color: colors.accentRed, marginTop: 6 }}>{deleteError}</Text>}
            <View style={[styles.modalBtns, { marginTop: 20 }]}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setDeleteModalVisible(false)} disabled={deleteLoading}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveBtn, { backgroundColor: colors.accentRed }, deleteLoading && { opacity: 0.7 }]}
                onPress={confirmDeleteAccount}
                disabled={deleteLoading}
              >
                {deleteLoading ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.modalSaveText}>Delete</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {/* Feedback dialog — a plain conditionally-rendered overlay (NOT a RN Modal).
          The RN Modal's portal/transition left the box lingering a frame on close;
          a plain View mounts/unmounts synchronously, so it vanishes instantly. */}
      {feedback ? (
        <View
          style={{ position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl, zIndex: 9999 }}
        >
          <View style={[styles.modalBox, { maxWidth: 360 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{feedback.title}</Text>
              <TouchableOpacity onPress={dismissFeedback}><Feather name="x" size={20} color={colors.textMuted} /></TouchableOpacity>
            </View>
            <Text style={styles.modalNote}>{feedback.message}</Text>
            <View style={{ alignItems: 'center', marginTop: 4 }}>
              <TouchableOpacity
                onPress={dismissFeedback}
                activeOpacity={0.85}
                style={{ backgroundColor: gold, borderRadius: radius.md, paddingHorizontal: 40, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', minWidth: 120 }}
              >
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
    </ScreenLayout>
  );
}

// ── Sub-components ──

function SectionHeader({ icon, label, color, styles }: { icon: any; label: string; color: string; styles: any }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Feather name={icon} size={15} color={color} />
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

function FieldRow({ label, sub, btnLabel, onPress, styles, badgeOnly }: { label: string; sub: string; btnLabel: string; onPress: () => void; styles: any; badgeOnly?: boolean }) {
  return (
    <View style={styles.fieldRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldSub} numberOfLines={1}>{sub}</Text>
      </View>
      {badgeOnly ? (
        <TouchableOpacity style={[styles.changeBtn, { borderColor: styles.comingSoonBadge?.borderColor || '#E5A93C40', backgroundColor: styles.comingSoonBadge?.backgroundColor || '#E5A93C18' }]} onPress={onPress} activeOpacity={0.7}>
          <Text style={styles.changeBtnText}>{btnLabel}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.changeBtn} onPress={onPress} activeOpacity={0.7}>
          <Text style={styles.changeBtnText}>{btnLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function AppModal({ visible, title, onClose, children, styles, colors }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode; styles: any; colors: AppColors }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={20} color={colors.textMuted} /></TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ModalButtons({ onCancel, onSave, loading, saveLabel = 'Save Changes', cancelLabel = 'Cancel', styles }: { onCancel: () => void; onSave: () => void; loading: boolean; saveLabel?: string; cancelLabel?: string; styles: any }) {
  return (
    <View style={styles.modalBtns}>
      <TouchableOpacity style={styles.modalCancelBtn} onPress={onCancel}>
        <Text style={styles.modalCancelText}>{cancelLabel}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.modalSaveBtn} onPress={onSave} disabled={loading}>
        {loading ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.modalSaveText}>{saveLabel}</Text>}
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 60, flexGrow: 1 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'flex-start' },
  col: { flex: 1, flexBasis: 0, minWidth: 340, gap: spacing.md },

  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

  card: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xl },

  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.lg },
  avatarBig: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: c.accentYellow,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  avatarCam: {
    position: 'absolute', bottom: 0, right: 0, width: 22, height: 22, borderRadius: 11,
    backgroundColor: c.cardDark, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: c.accentYellow,
  },
  avatarInitial: { fontSize: 24, fontWeight: '800', color: '#fff' },
  profileName: { fontSize: 16, fontWeight: '700', color: c.textMain, marginBottom: 2 },
  profileSub: { fontSize: 12, color: c.textMuted, marginBottom: 6 },
  profileMeta: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: c.accentYellow + '18', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: c.accentYellow + '30',
  },
  roleBadgeText: { fontSize: 11, fontWeight: '600', color: c.accentYellow },

  divider: { height: 1, backgroundColor: c.borderColor, marginVertical: spacing.lg },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: c.textMain, marginBottom: 2 },
  fieldSub: { fontSize: 12, color: c.textMuted, maxWidth: 220 },
  changeBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.sm,
    borderWidth: 1, borderColor: c.accentYellow + '40', backgroundColor: c.accentYellow + '18',
  },
  changeBtnText: { fontSize: 12, fontWeight: '600', color: c.accentYellow },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  comingSoonBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: c.accentYellow + '18', borderWidth: 1, borderColor: c.accentYellow + '30' },
  comingSoonText: { fontSize: 11, color: c.accentYellow, fontWeight: '600' },

  themeRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  themeOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1,
    borderColor: c.borderColor, backgroundColor: 'rgba(255,255,255,0.02)',
  },
  themeOptionActive: { borderColor: c.accentYellow, backgroundColor: c.accentYellow + '18' },
  themeLabel: { fontSize: 13, fontWeight: '600', color: c.textMuted },

  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 2 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.sm },
  actionBtn: {
    flex: 1, flexBasis: 0, minWidth: 220, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 16, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.accentRed + '40', backgroundColor: c.accentRed + '0A',
  },
  actionBtnText: { fontSize: 14, fontWeight: '700' },
  versionText: { textAlign: 'center', fontSize: 12, color: c.textDim, marginTop: spacing.xl },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalBox: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xl, width: '100%', maxWidth: 440 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xl },
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.textMain },
  modalNote: { fontSize: 13, color: c.textMuted, lineHeight: 20, marginBottom: spacing.lg },
  modalFieldLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted, marginBottom: 6, marginTop: spacing.md },
  modalInput: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, height: 46, paddingHorizontal: spacing.lg,
  },
  modalTextInput: { flex: 1, fontSize: 14, color: c.textMain, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  modalBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: c.accentYellow, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 14, fontWeight: '700', color: 'white' },
});
