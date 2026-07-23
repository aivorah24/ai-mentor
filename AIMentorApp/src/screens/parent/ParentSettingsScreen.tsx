import React, { useState, useMemo, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Switch, Modal, Alert, ActivityIndicator, Platform, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, radius, fonts } from '../../theme';
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

type ModalType = 'name' | 'email' | 'password' | 'location' | 'ssoInfo' | null;

export default function ParentSettingsScreen({ navigation }: any) {
  const { user, updateUser, logout } = useAuth();
  const { colors, themeMode, setThemeMode } = useTheme();
  const { triggerPoll, clearUnreadAssignments, clearUnreadChallenges } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Notifications — persisted to AsyncStorage
  const NOTIF_KEY = `notifPrefs_${user?.email ?? 'guest'}`;
  const [assignmentAlerts, setAssignmentAlerts]   = useState(true);
  const [teacherMessages,  setTeacherMessages]    = useState(true);
  const [weeklyReport,     setWeeklyReport]       = useState(true);
  const [progressNudges,   setProgressNudges]     = useState(true);
  const [challengeUpdates, setChallengeUpdates]   = useState(true);

  // Load saved prefs on mount
  useEffect(() => {
    AsyncStorage.getItem(NOTIF_KEY).then(raw => {
      if (!raw) return;
      try {
        const p = JSON.parse(raw);
        if (p.assignmentAlerts   != null) setAssignmentAlerts(p.assignmentAlerts);
        if (p.teacherMessages    != null) setTeacherMessages(p.teacherMessages);
        if (p.weeklyReport       != null) setWeeklyReport(p.weeklyReport);
        if (p.progressNudges     != null) setProgressNudges(p.progressNudges);
        if (p.challengeUpdates   != null) setChallengeUpdates(p.challengeUpdates);
      } catch {}
    }).catch(() => {});
  }, [NOTIF_KEY]);

  // Save prefs whenever any toggle changes
  const saveNotifPrefs = useCallback((prefs: object) => {
    AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(prefs)).catch(() => {});
  }, [NOTIF_KEY]);

  // Profile photo — same upload flow as the student/teacher profile (shared for all roles).
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

  // Delete account (provider-aware: password vs Google SSO)
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
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

  // Modal
  const [activeModal,   setActiveModal]   = useState<ModalType>(null);
  const [modalLoading,  setModalLoading]  = useState(false);
  const [newName,       setNewName]       = useState(user?.name || '');
  const [newEmail,      setNewEmail]      = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailError,    setEmailError]    = useState('');
  const [emailStep,     setEmailStep]     = useState<'form' | 'otp'>('form');
  const [emailOtp,      setEmailOtp]      = useState('');
  const [currentPw,     setCurrentPw]    = useState('');
  const [newPw,         setNewPw]        = useState('');
  const [confirmPw,     setConfirmPw]    = useState('');
  const [showCurrent,   setShowCurrent]  = useState(false);
  const [showNew,       setShowNew]      = useState(false);
  const [newLocation,   setNewLocation]  = useState(user?.location || '');
  const [modalError,    setModalError]   = useState('');

  function openModal(type: ModalType) {
    setNewName(user?.name || '');
    setNewEmail(''); setEmailPassword(''); setEmailError('');
    setEmailStep('form'); setEmailOtp('');
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
    setNewLocation(user?.location || '');
    setModalError('');
    setActiveModal(type);
  }
  function closeModal() { setActiveModal(null); setModalLoading(false); }

  // Google-SSO "change email" = migrate the account onto a DIFFERENT Google
  // account the parent owns (same flow as student/teacher settings). The parent
  // proves ownership via a Google popup; the server verifies the ID token and
  // moves all data onto it (POST /user/change-email-google). Editing a Google
  // account's Firebase email directly (the old path) corrupts it.
  async function handleSwitchGoogleAccount() {
    setEmailError('');
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
      Alert.alert('Email Updated', `Your account is now linked to ${d.newEmail || newEmailAddr}. For security, please sign in again with your new Google account.`);
      setTimeout(() => { logout(); }, 150);
    } catch (e: any) {
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
        setEmailError('Google selection was cancelled. Please try again.');
      } else {
        setEmailError(e.message || 'Failed to switch Google account.');
      }
    } finally { setModalLoading(false); }
  }

  async function handleSaveLocation() {
    const trimmed = newLocation.trim();
    if (!trimmed) { setModalError('Please enter a location.'); return; }
    setModalLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, location: trimmed }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to save'); }
      updateUser({ location: trimmed } as any);
      closeModal();
      Alert.alert('Updated', 'Your location has been saved.');
    } catch (e: any) {
      setModalError(e.message || 'Failed to update location.');
    } finally { setModalLoading(false); }
  }

  async function handleSaveName() {
    const trimmed = newName.trim();
    if (!trimmed) { Alert.alert('Required', 'Please enter a name.'); return; }
    updateUser({ name: trimmed });
    closeModal();
    // Persist to the users table so it survives refresh and shows everywhere.
    try {
      await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, name: trimmed }),
      });
    } catch {}
    Alert.alert('Updated', 'Your display name has been updated.');
  }

  async function handleChangePassword() {
    // Strip all whitespace to match the login screen (pass.replace(/\s+/g,'')),
    // so a copy-pasted current password with a stray space still re-authenticates. (#154)
    const curPwClean = (currentPw || '').replace(/\s+/g, '');
    const newPwClean = (newPw || '').replace(/\s+/g, '');
    const confirmPwClean = (confirmPw || '').replace(/\s+/g, '');
    if (!curPwClean) { Alert.alert('Required', 'Enter your current password.'); return; }
    if (newPwClean.length < 6) { Alert.alert('Too Short', 'New password must be at least 6 characters.'); return; }
    if (newPwClean !== confirmPwClean) { Alert.alert('Mismatch', 'Passwords do not match.'); return; }
    setModalLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (firebaseUser && firebaseUser.email) {
        const cred = EmailAuthProvider.credential(firebaseUser.email, curPwClean);
        await reauthenticateWithCredential(firebaseUser, cred);
        await updatePassword(firebaseUser, newPwClean);
      }
      closeModal();
      Alert.alert('Password Changed', 'Your password has been updated successfully.');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to change password.');
    } finally { setModalLoading(false); }
  }

  function handleSignOut() {
    // Alert.alert is a no-op on React Native Web — use window.confirm there.
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || window.confirm('Are you sure you want to sign out?')) {
        logout();
      }
      return;
    }
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => logout() },
    ]);
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
              <SectionHeader icon="user" label="Profile & Account" color={colors.accentYellow} styles={styles} />
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
                      <Text style={styles.avatarInitial}>{user?.name ? user.name[0].toUpperCase() : 'P'}</Text>
                    )}
                    <View style={styles.avatarCam}>
                      {uploading ? <ActivityIndicator size="small" color={colors.accentYellow} /> : <Feather name="camera" size={11} color={colors.accentYellow} />}
                    </View>
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.profileName}>{user?.name || 'Parent'}</Text>
                    <Text style={styles.profileSub}>{user?.email || ''}</Text>
                    <View style={styles.roleBadge}>
                      <Text style={styles.roleBadgeText}>Parent</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.divider} />
                <FieldRow label="Display Name" sub={user?.name || '—'} btnLabel="Change" onPress={() => openModal('name')} styles={styles} />
                <View style={styles.divider} />
                <FieldRow label="Email Address" sub={user?.email || '—'} btnLabel="Change" onPress={() => openModal('email')} styles={styles} />
                <View style={styles.divider} />
                <FieldRow label="Location" sub={user?.location || 'Not set'} btnLabel="Update" onPress={() => openModal('location')} styles={styles} />
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
            </View>

            {/* ── Right column ── */}
            <View style={styles.col}>
              {/* ── Notifications ── */}
              <SectionHeader icon="bell" label="Notifications" color={colors.accentYellow} styles={styles} />
              <View style={styles.card}>
                {[
                  { key: 'assignmentAlerts', label: 'Assignment Alerts', sub: "New assignments for your child", val: assignmentAlerts, set: setAssignmentAlerts },
                  { key: 'teacherMessages',  label: 'Teacher Messages', sub: 'New messages from teachers', val: teacherMessages, set: setTeacherMessages },
                  { key: 'weeklyReport',     label: 'Weekly Progress Report', sub: "Summary of your child's week", soon: true },
                  { key: 'progressNudges',   label: 'AI Progress Nudges', sub: 'Tips when your child needs attention', soon: true },
                  { key: 'challengeUpdates', label: 'Challenge Updates', sub: 'New challenges and rankings', val: challengeUpdates, set: setChallengeUpdates },
                ].map((item: any, i) => (
                  <View key={item.label}>
                    {i > 0 && <View style={styles.divider} />}
                    <View style={styles.toggleRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fieldLabel}>{item.label}</Text>
                        <Text style={styles.fieldSub}>{item.sub}</Text>
                      </View>
                      {item.soon ? (
                        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: colors.accentYellow + '18' }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.accentYellow }}>Soon</Text>
                        </View>
                      ) : (
                      <Switch
                        value={item.val}
                        onValueChange={v => {
                          item.set(v);
                          const next = { assignmentAlerts, teacherMessages, weeklyReport, progressNudges, challengeUpdates, [item.key]: v };
                          saveNotifPrefs(next);
                          // Turning ON dismisses the OFF-period backlog so it doesn't replay.
                          // clearUnread* marks the system messages read AND re-polls afterward,
                          // so we must NOT also triggerPoll() concurrently (that race counted the
                          // still-unread messages and re-surfaced them). For every other case,
                          // poll immediately so the pref takes effect instantly.
                          if (v && item.key === 'assignmentAlerts') clearUnreadAssignments();
                          else if (v && item.key === 'challengeUpdates') clearUnreadChallenges();
                          else triggerPoll();
                        }}
                        trackColor={{ false: colors.borderColor, true: colors.accentYellow }}
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
                      <Feather name={t.icon} size={16} color={themeMode === t.id ? colors.accentYellow : colors.textMuted} />
                      <Text style={[styles.themeLabel, themeMode === t.id && { color: colors.accentYellow }]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

          </View>

          {/* ── Account Actions — full width below the columns ── */}
          <SectionHeader icon="alert-triangle" label="Account Actions" color={colors.accentRed} styles={styles} />
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleSignOut} activeOpacity={0.8}>
              <Feather name="log-out" size={17} color={colors.accentRed} />
              <Text style={[styles.actionBtnText, { color: colors.accentRed }]}>Sign Out</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => { setDeletePassword(''); setDeleteError(''); setDeleteModalVisible(true); }} activeOpacity={0.8}>
              <Feather name="trash-2" size={17} color={colors.accentRed} />
              <Text style={[styles.actionBtnText, { color: colors.accentRed }]}>Delete Account</Text>
            </TouchableOpacity>
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
        <ModalButtons onCancel={closeModal} onSave={handleSaveName} loading={modalLoading} styles={styles} />
      </AppModal>

      {/* Change Email Modal — two steps: confirm identity + new email, then
          verify the code we email to the NEW address before committing */}
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
            {!!emailError && <Text style={{ fontSize: 12, color: colors.accentRed, marginTop: 6 }}>{emailError}</Text>}
            <ModalButtons
              onCancel={closeModal}
              onSave={handleSwitchGoogleAccount}
              loading={modalLoading}
              saveLabel="Switch Google Account"
              styles={styles}
            />
          </>
        ) : emailStep === 'form' ? (
          <>
            <Text style={styles.modalNote}>
              Enter your new email and current password to confirm the change.
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
            {!!emailError && <Text style={{ fontSize: 12, color: colors.accentRed, marginTop: 6 }}>{emailError}</Text>}
            <ModalButtons
              onCancel={closeModal}
              onSave={async () => {
                setEmailError('');
                const email = newEmail.trim().toLowerCase();
                if (!email) { setEmailError('Please enter your new email.'); return; }
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEmailError('Please enter a valid email address.'); return; }
                if (email === (user?.email || '').toLowerCase()) { setEmailError('That is already your current email.'); return; }
                if (isPasswordUser && !emailPassword) { setEmailError('Please enter your current password.'); return; }
                setModalLoading(true);
                try {
                  // Fail fast if that email already belongs to another Aivorah account —
                  // check BEFORE asking for a password/Google popup, so the user isn't
                  // walked through a whole reauth + OTP flow just to be blocked at the end.
                  const takenRes = await fetch(`${SERVER_URL}/user/role?email=${encodeURIComponent(email)}`);
                  if (takenRes.ok) {
                    setEmailError('That email is already registered to another Aivorah account.');
                    setModalLoading(false);
                    return;
                  }
                  const fu = auth.currentUser;
                  if (fu && fu.email) {
                    if (isPasswordUser) {
                      const cred = EmailAuthProvider.credential(fu.email, emailPassword);
                      await reauthenticateWithCredential(fu, cred);
                    } else if (isGoogleUser) {
                      await reauthenticateWithPopup(fu, new GoogleAuthProvider());
                    }
                  }
                  const res = await fetch(`${SERVER_URL}/user/email-otp/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, name: user?.name }),
                  });
                  const d = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(d.error || 'Could not send the verification code.');
                  setEmailStep('otp');
                } catch (e: any) {
                  if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
                    setEmailError('Incorrect password. Please try again.');
                  } else if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
                    setEmailError('Google confirmation was cancelled. Please try again.');
                  } else {
                    setEmailError(e.message || 'Failed to send verification code.');
                  }
                } finally { setModalLoading(false); }
              }}
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
                setEmailError('');
                try {
                  const res = await fetch(`${SERVER_URL}/user/email-otp/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: newEmail.trim().toLowerCase(), name: user?.name }),
                  });
                  const d = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(d.error || 'Could not resend the code.');
                  Alert.alert('Code Resent', `A new code was sent to ${newEmail.trim()}.`);
                } catch (e: any) {
                  setEmailError(e.message || 'Failed to resend code.');
                }
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.accentYellow, marginTop: 4 }}>Resend code</Text>
            </TouchableOpacity>
            {!!emailError && <Text style={{ fontSize: 12, color: colors.accentRed, marginTop: 8 }}>{emailError}</Text>}
            <ModalButtons
              onCancel={() => setEmailStep('form')}
              cancelLabel="Back"
              onSave={async () => {
                setEmailError('');
                if (!emailOtp.trim()) { setEmailError('Please enter the code.'); return; }
                setModalLoading(true);
                try {
                  const changedTo = newEmail.trim().toLowerCase();
                  const res = await fetch(`${SERVER_URL}/user/change-email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ currentEmail: user?.email, newEmail: changedTo, otp: emailOtp.trim() }),
                  });
                  const d = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(d.error || 'Could not update your email.');
                  // The server just renamed this account's email in Firebase Auth via
                  // Admin SDK — the browser's session still carries the OLD email, so
                  // the next background auth check would find no matching account and
                  // wrongly treat it as a deletion. Sign out deliberately and clearly
                  // instead of letting that guard do it silently.
                  closeModal();
                  Alert.alert('Email Updated', `Your email has been changed to ${changedTo}. For security, please sign in again with your new email.`);
                  setTimeout(() => { logout(); }, 150);
                } catch (e: any) {
                  setEmailError(e.message || 'Failed to update email.');
                } finally { setModalLoading(false); }
              }}
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
            placeholder="••••••••" placeholderTextColor={colors.textDim}
            secureTextEntry={!showCurrent} autoFocus
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
        <ModalButtons onCancel={closeModal} onSave={handleChangePassword} loading={modalLoading} saveLabel="Change Password" styles={styles} />
      </AppModal>

      {/* Location Modal — same inline-modal pattern as TeacherSettingsScreen's
          "School / Institution" field, instead of navigating away to ParentProfile. */}
      <AppModal visible={activeModal === 'location'} title="Location" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalFieldLabel}>City</Text>
        <View style={styles.modalInput}>
          <Feather name="map-pin" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput} value={newLocation} onChangeText={setNewLocation}
            placeholder="e.g. Salem" placeholderTextColor={colors.textDim}
            autoCapitalize="words" autoFocus
          />
        </View>
        {modalError ? <Text style={{ color: colors.accentRed, fontSize: 13, marginTop: 8 }}>{modalError}</Text> : null}
        <ModalButtons onCancel={closeModal} onSave={handleSaveLocation} loading={modalLoading} saveLabel="Save" styles={styles} />
      </AppModal>

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
            {!!deleteError && <Text style={{ fontFamily: fonts.serif, fontSize: 12, color: colors.accentRed, marginTop: 6 }}>{deleteError}</Text>}
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
        <TouchableOpacity style={[styles.changeBtn, { borderColor: '#E5A93C40', backgroundColor: '#E5A93C18' }]} onPress={onPress} activeOpacity={0.7}>
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
          {children}
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
  content: { padding: spacing.xl, paddingBottom: 48 },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'flex-start' },
  col: { flex: 1, flexBasis: 0, minWidth: 340, gap: spacing.md },

  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  sectionLabel: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

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
  avatarInitial: { fontFamily: fonts.serif, fontSize: 24, fontWeight: '800', color: '#fff' },
  profileName: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '700', color: c.textMain, marginBottom: 2 },
  profileSub: { fontFamily: fonts.serif, fontSize: 12, color: c.textMuted },
  roleBadge: { marginTop: 6, alignSelf: 'flex-start', backgroundColor: c.accentYellow + '18', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  roleBadgeText: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '600', color: c.accentYellow },

  divider: { height: 1, backgroundColor: c.borderColor, marginVertical: spacing.lg },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  fieldLabel: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '600', color: c.textMain, marginBottom: 2 },
  fieldSub: { fontFamily: fonts.serif, fontSize: 12, color: c.textMuted, maxWidth: 200 },
  changeBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.sm,
    borderWidth: 1, borderColor: c.accentYellow + '40', backgroundColor: c.accentYellow + '18',
  },
  changeBtnText: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '600', color: c.accentYellow },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  comingSoonBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: c.accentYellow + '18', borderWidth: 1, borderColor: c.accentYellow + '30' },
  comingSoonText: { fontFamily: fonts.serif, fontSize: 11, color: c.accentYellow, fontWeight: '600' },

  themeRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  themeOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1,
    borderColor: c.borderColor, backgroundColor: 'rgba(255,255,255,0.02)',
  },
  themeOptionActive: { borderColor: c.accentYellow, backgroundColor: c.accentYellow + '18' },
  themeLabel: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: c.textMuted },

  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 2 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.sm },
  actionBtn: {
    flex: 1, flexBasis: 0, minWidth: 220, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 16, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.accentRed + '40', backgroundColor: c.accentRed + '0A',
  },
  actionBtnText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700' },
  versionText: { textAlign: 'center', fontFamily: fonts.serif, fontSize: 12, color: c.textDim, marginTop: spacing.xl },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalBox: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xl, width: '100%', maxWidth: 440 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xl },
  modalTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '700', color: c.textMain },
  modalNote: { fontFamily: fonts.serif, fontSize: 13, color: c.textMuted, lineHeight: 20, marginBottom: spacing.lg },
  modalFieldLabel: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '600', color: c.textMuted, marginBottom: 6, marginTop: spacing.md },
  modalInput: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, height: 46, paddingHorizontal: spacing.lg,
  },
  modalTextInput: { flex: 1, fontFamily: fonts.serif, fontSize: 14, color: c.textMain, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  modalBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '600', color: c.textMuted },
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: c.accentYellow, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700', color: '#0B0B0B' },
});



