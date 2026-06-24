import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useAuth } from '../../context/AuthContext';
import { useStudentData, formatLevel } from '../../context/StudentDataContext';
import { useTheme } from '../../context/ThemeContext';
import {
  updateEmail,
  updatePassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  deleteUser,
} from 'firebase/auth';
import { auth } from '../../config/firebase';
import SERVER_URL from '../../config/serverUrl';

type ModalType = 'name' | 'email' | 'password' | 'recovery' | 'delete' | 'grade' | 'location' | null;

export default function SettingsScreen({ navigation, route }: any) {
  const { user, updateUser, logout, refreshProfile } = useAuth();
  // Re-pull profile on focus so a parent's grade/curriculum edit reflects here.
  useFocusEffect(useCallback(() => { refreshProfile(); }, []));
  const { stats } = useStudentData();
  const { colors, themeMode, setThemeMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Notification preferences
  const [pushNotifications, setPushNotifications] = useState(true);
  const [aiSuggestions, setAiSuggestions] = useState(true);
  const [weeklyReport, setWeeklyReport] = useState(false);
  const [assignmentAlerts, setAssignmentAlerts] = useState(true);
  const [challengeUpdates, setChallengeUpdates] = useState(true);
  const notifLoaded = useRef(false);
  const scrollRef = useRef<any>(null);
  const notifRef = useRef<any>(null);
  const notifY = useRef<number>(0);
  const securityY = useRef<number>(0);

  // Scroll to a specific section if navigated with a section param
  useEffect(() => {
    const section = route?.params?.section;
    if (!section) return;
    const yMap: Record<string, React.MutableRefObject<number>> = {
      notifications: notifY,
      security: securityY,
    };
    const target = yMap[section];
    if (target) {
      setTimeout(() => {
        scrollRef.current?.scrollTo?.({ y: target.current, animated: true });
      }, 350);
    }
  }, [route?.params?.section]);

  // Load saved preferences from server on mount
  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/user/preferences?email=${encodeURIComponent(user.email)}`)
      .then(r => r.ok ? r.json() : null)
      .then(prefs => {
        if (!prefs) return;
        if (prefs.pushNotifications !== undefined) setPushNotifications(prefs.pushNotifications);
        if (prefs.aiSuggestions !== undefined) setAiSuggestions(prefs.aiSuggestions);
        if (prefs.weeklyReport !== undefined) setWeeklyReport(prefs.weeklyReport);
        if (prefs.assignmentAlerts !== undefined) setAssignmentAlerts(prefs.assignmentAlerts);
        if (prefs.challengeUpdates !== undefined) setChallengeUpdates(prefs.challengeUpdates);
        if (prefs.recoveryEmail) setRecoverySaved(prefs.recoveryEmail);
        notifLoaded.current = true;
      }).catch(() => { notifLoaded.current = true; });
  }, [user?.email]);

  // Save notification preference to server whenever it changes (after initial load)
  function saveNotifPref(key: string, value: boolean) {
    if (!user?.email || !notifLoaded.current) return;
    fetch(`${SERVER_URL}/user/preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, [key]: value }),
    }).catch(() => {});
  }

  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [modalLoading, setModalLoading] = useState(false);

  // Name modal
  const [newName, setNewName] = useState(user?.name || '');
  const [nameError, setNameError] = useState('');

  // Email modal
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailError, setEmailError] = useState('');

  // Password modal
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Recovery email modal
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoverySaved, setRecoverySaved] = useState('');
  const [recoveryStep, setRecoveryStep] = useState<'email' | 'otp'>('email');
  const [recoveryOtp, setRecoveryOtp] = useState('');
  const [recoverySending, setRecoverySending] = useState(false);

  function openModal(type: ModalType) {
    setNewName(user?.name || '');
    setNewEmail('');
    setEmailPassword('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setRecoveryEmail('');
    setRecoveryError('');
    setRecoveryStep('email');
    setRecoveryOtp('');
    setNameError('');
    setEmailError('');
    setPasswordError('');
    setSelectedGrade(user?.grade || '');
    setNewLocation(user?.location || '');
    setActiveModal(type);
  }

  function closeModal() {
    setActiveModal(null);
    setModalLoading(false);
  }

  async function handleSaveName() {
    if (!newName.trim()) { setNameError('Please enter a name.'); return; }
    updateUser({ name: newName.trim() });
    closeModal();
  }

  async function handleChangeEmail() {
    setEmailError('');
    if (!newEmail.trim()) { setEmailError('Please enter a new email.'); return; }
    if (!emailPassword) { setEmailError('Please enter your current password.'); return; }
    setModalLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (firebaseUser && firebaseUser.email) {
        const cred = EmailAuthProvider.credential(firebaseUser.email, emailPassword);
        await reauthenticateWithCredential(firebaseUser, cred);
        await updateEmail(firebaseUser, newEmail.trim());
        updateUser({ email: newEmail.trim() });
      } else {
        updateUser({ email: newEmail.trim() });
      }
      closeModal();
    } catch (e: any) {
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        setEmailError('Incorrect password. Please try again.');
      } else {
        setEmailError(e.message || 'Failed to update email.');
      }
    } finally {
      setModalLoading(false);
    }
  }

  async function handleChangePassword() {
    setPasswordError('');
    // Strip all whitespace to match the login screen (pass.replace(/\s+/g,'')),
    // so a copy-pasted current password with a stray space still re-authenticates. (#154)
    const curPw = currentPassword.replace(/\s+/g, '');
    const newPw = newPassword.replace(/\s+/g, '');
    const confirmPw = confirmPassword.replace(/\s+/g, '');
    if (!curPw) { setPasswordError('Enter your current password.'); return; }
    if (newPw.length < 6) { setPasswordError('New password must be at least 6 characters.'); return; }
    if (newPw !== confirmPw) { setPasswordError('Passwords do not match.'); return; }
    setModalLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (firebaseUser && firebaseUser.email) {
        const cred = EmailAuthProvider.credential(firebaseUser.email, curPw);
        await reauthenticateWithCredential(firebaseUser, cred);
        await updatePassword(firebaseUser, newPw);
        if (user?.mustChangePassword) {
          fetch(`${SERVER_URL}/user/clear-must-change-password`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: firebaseUser.email }),
          }).catch(() => {});
          updateUser({ mustChangePassword: false });
        }
      }
      closeModal();
    } catch (e: any) {
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        setPasswordError('Current password is incorrect.');
      } else {
        setPasswordError(e.message || 'Failed to change password.');
      }
    } finally {
      setModalLoading(false);
    }
  }

  async function handleSendRecoveryCode() {
    setRecoveryError('');
    if (!recoveryEmail.trim()) { setRecoveryError('Please enter a recovery email.'); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recoveryEmail.trim())) { setRecoveryError('Please enter a valid email address.'); return; }
    setRecoverySending(true);
    try {
      const res = await fetch(`${SERVER_URL}/user/recovery-email/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, recoveryEmail: recoveryEmail.trim() }),
      });
      if (!res.ok) { const d = await res.json(); setRecoveryError(d.error || 'Failed to send code.'); return; }
      setRecoveryStep('otp');
    } catch {
      setRecoveryError('Network error. Please try again.');
    } finally {
      setRecoverySending(false);
    }
  }

  async function handleVerifyRecoveryOtp() {
    setRecoveryError('');
    if (!recoveryOtp.trim()) { setRecoveryError('Please enter the verification code.'); return; }
    setModalLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/user/recovery-email`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, otp: recoveryOtp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setRecoveryError(data.error || 'Verification failed.'); return; }
      closeModal();
      setRecoverySaved(data.recoveryEmail || recoveryEmail.trim());
    } catch {
      setRecoveryError('Network error. Please try again.');
    } finally {
      setModalLoading(false);
    }
  }

  function handleSignOut() {
    setSignOutModalVisible(true);
  }

  // Grade modal
  const ALL_GRADES = ['Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];
  // A student can only move UP a grade — show their current grade and higher
  // (through Grade 12), never lower grades.
  const currentGradeIdx = ALL_GRADES.indexOf(user?.grade || '');
  const GRADES = currentGradeIdx >= 0 ? ALL_GRADES.slice(currentGradeIdx) : ALL_GRADES;
  const [selectedGrade, setSelectedGrade] = useState(user?.grade || '');
  const [gradeLoading, setGradeLoading] = useState(false);

  async function handleSaveGrade() {
    if (!selectedGrade) return;
    setGradeLoading(true);
    try {
      await fetch(`${SERVER_URL}/user/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, grade: selectedGrade }),
      });
      updateUser({ grade: selectedGrade });
      closeModal();
    } catch {
      // silently fail — updateUser already updated locally
      updateUser({ grade: selectedGrade });
      closeModal();
    } finally {
      setGradeLoading(false);
    }
  }

  // Location modal
  const [newLocation, setNewLocation] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);

  async function handleSaveLocation() {
    const loc = newLocation.trim();
    setLocationLoading(true);
    try {
      await fetch(`${SERVER_URL}/user/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, location: loc }),
      });
      updateUser({ location: loc });
      closeModal();
    } catch {
      updateUser({ location: loc });
      closeModal();
    } finally {
      setLocationLoading(false);
    }
  }

  const [signOutModalVisible, setSignOutModalVisible] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Does this account sign in with email+password, or only via Google SSO?
  const isPasswordUser = (auth.currentUser?.providerData ?? []).some(p => p.providerId === 'password');
  const isGoogleUser   = (auth.currentUser?.providerData ?? []).some(p => p.providerId === 'google.com');

  async function confirmDeleteAccount() {
    setDeleteError('');
    // Password accounts confirm with their password; Google SSO accounts re-confirm
    // with the Google popup (they have no password to enter).
    if (isPasswordUser && !deletePassword) { setDeleteError('Please enter your password to confirm.'); return; }
    setDeleteLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (firebaseUser && firebaseUser.email) {
        // Re-authenticate (required by Firebase for account deletion)
        if (isPasswordUser) {
          const cred = EmailAuthProvider.credential(firebaseUser.email, deletePassword);
          await reauthenticateWithCredential(firebaseUser, cred);
        } else if (isGoogleUser) {
          await reauthenticateWithPopup(firebaseUser, new GoogleAuthProvider());
        }
        // Delete from Supabase + Firebase Auth (server uses the Admin SDK, so this
        // works for any provider). Client deleteUser below is just a best-effort
        // fallback and must not block the flow if the server already removed it.
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

  const levelLabel = formatLevel(stats.level);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Settings"
          subtitle="Manage your preferences and account details."
          searchPlaceholder="Search settings..."
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.columns}>
          <View style={styles.col}>
          {/* ── Profile & Account ── */}
          <SectionHeader icon="user" label="Profile & Account" color={colors.primary} styles={styles} />
          <View style={styles.card}>
            <View style={styles.profileRow}>
              <View style={styles.avatarBig}>
                <Feather name="user" size={30} color={colors.textMuted} />
                <View style={styles.avatarCam}>
                  <Feather name="camera" size={11} color="white" />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{user?.name || 'User'}</Text>
                <Text style={styles.profileRole}>
                  {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Student'} · {levelLabel}
                </Text>
                <Text style={styles.profileEmail}>{user?.email}</Text>
              </View>
            </View>
            <View style={styles.divider} />

            {[
              { label: 'Display Name', value: user?.name || '—', modal: 'name' },
              { label: 'Email Address', value: user?.email || '—', modal: 'email' },
              { label: 'Grade / Year', value: user?.grade || 'Not set', modal: 'grade' },
              { label: 'Location', value: user?.location || 'Not set', modal: 'location' },
            ].map((f, i) => (
              <View key={f.label}>
                {i > 0 && <View style={styles.rowDivider} />}
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{f.label}</Text>
                  <Text style={styles.infoValue} numberOfLines={1}>{f.value}</Text>
                  <TouchableOpacity style={styles.editBtn} onPress={() => openModal(f.modal as any)} activeOpacity={0.7}>
                    <Text style={styles.editBtnText}>Edit</Text>
                  </TouchableOpacity>
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
              ] as const).map((t) => {
                const active = themeMode === t.id;
                return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.themeOption, active && styles.themeOptionActive]}
                  onPress={() => setThemeMode(t.id)}
                  activeOpacity={0.7}
                >
                  {active && (
                    <View style={styles.themeCheck}>
                      <Feather name="check" size={11} color="#fff" />
                    </View>
                  )}
                  <Feather name={t.icon} size={24} color={active ? colors.primary : colors.textMuted} />
                  <Text style={[styles.themeLabel, active && { color: colors.primary }]}>{t.label}</Text>
                </TouchableOpacity>
                );
              })}
            </View>
          </View>
          </View>{/* end left col */}

          <View style={styles.col}>
          {/* ── Security ── */}
          <View onLayout={e => { securityY.current = e.nativeEvent.layout.y; }}>
          <SectionHeader icon="shield" label="Security" color={colors.accentGreen} styles={styles} />
          <View style={styles.card}>
            {[
              { icon: 'lock', label: 'Password', sub: 'Change your account password', btn: 'Change', onPress: () => openModal('password') },
              { icon: 'mail', label: 'Recovery Email', sub: recoverySaved || 'Backup email for account recovery', btn: recoverySaved ? 'Update' : 'Set', onPress: () => openModal('recovery') },
              { icon: 'shield', label: 'Two-Factor Auth', sub: 'Add an extra layer of security', btn: 'Soon', onPress: null },
            ].map((r, i) => (
              <View key={r.label}>
                {i > 0 && <View style={styles.rowDivider} />}
                <View style={styles.iconRow}>
                  <View style={styles.iconBox}><Feather name={r.icon as any} size={18} color={colors.textMuted} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{r.label}</Text>
                    <Text style={styles.fieldSub}>{r.sub}</Text>
                  </View>
                  {r.onPress ? (
                    <TouchableOpacity style={styles.editBtn} onPress={r.onPress} activeOpacity={0.7}>
                      <Text style={styles.editBtnText}>{r.btn}</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.comingSoonBadge}><Text style={styles.comingSoonText}>Soon</Text></View>
                  )}
                </View>
              </View>
            ))}
          </View>
          </View>

          {/* ── Notifications ── */}
          <View ref={notifRef} onLayout={e => { notifY.current = e.nativeEvent.layout.y; }}>
          <SectionHeader icon="bell" label="Notifications" color={colors.accentYellow} styles={styles} />
          <View style={styles.card}>
            {[
              { icon: 'bell', label: 'Assignment Alerts', sub: 'Due date reminders' },
              { icon: 'bar-chart-2', label: 'Challenge Updates', sub: 'New challenges and leaderboard changes' },
              { icon: 'file-text', label: 'Weekly Report', sub: 'Progress summary every week' },
              { icon: 'zap', label: 'AI Suggestions', sub: 'Personalised learning tips from AI' },
              { icon: 'send', label: 'Push Notifications', sub: 'Real-time alerts on your device' },
            ].map((item, i) => (
              <View key={item.label}>
                {i > 0 && <View style={styles.rowDivider} />}
                <View style={styles.iconRow}>
                  <View style={styles.iconBox}><Feather name={item.icon as any} size={18} color={colors.textMuted} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{item.label}</Text>
                    <Text style={styles.fieldSub}>{item.sub}</Text>
                  </View>
                  <View style={styles.comingSoonBadge}><Text style={styles.comingSoonText}>Soon</Text></View>
                </View>
              </View>
            ))}
          </View>

          </View>
          </View>{/* end right col */}
          </View>{/* end columns */}

          {/* ── Account Actions ── */}
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

          <Text style={styles.versionText}>Aivorah v1.0.0 · Build 2024</Text>
        </ScrollView>
      </View>

      {/* ── Change Name Modal ── */}
      <AppModal visible={activeModal === 'name'} title="Change Display Name" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalFieldLabel}>New Name</Text>
        <View style={styles.modalInput}>
          <Feather name="user" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput}
            value={newName}
            onChangeText={(v) => { setNewName(v); setNameError(''); }}
            placeholder="Your name"
            placeholderTextColor={colors.textDim}
            autoCapitalize="words"
            autoFocus
          />
        </View>
        {!!nameError && <Text style={{ fontSize: 12, color: colors.accentRed, marginTop: 6 }}>{nameError}</Text>}
        <ModalButtons onCancel={closeModal} onSave={handleSaveName} loading={modalLoading} styles={styles} />
      </AppModal>

      {/* ── Change Email Modal ── */}
      <AppModal visible={activeModal === 'email'} title="Change Email Address" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalFieldLabel}>New Email</Text>
        <View style={styles.modalInput}>
          <Feather name="mail" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput}
            value={newEmail}
            onChangeText={setNewEmail}
            placeholder="new@example.com"
            placeholderTextColor={colors.textDim}
            keyboardType="email-address"
            autoCapitalize="none"
            autoFocus
          />
        </View>
        <Text style={styles.modalFieldLabel}>Current Password</Text>
        <View style={styles.modalInput}>
          <Feather name="lock" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput}
            value={emailPassword}
            onChangeText={setEmailPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.textDim}
            secureTextEntry
          />
        </View>
        {!!emailError && <Text style={{ fontSize: 12, color: colors.accentRed, marginTop: 6 }}>{emailError}</Text>}
        <ModalButtons onCancel={closeModal} onSave={handleChangeEmail} loading={modalLoading} saveLabel="Update Email" styles={styles} />
      </AppModal>

      {/* ── Change Password Modal ── */}
      <AppModal visible={activeModal === 'password'} title="Change Password" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalFieldLabel}>Current Password</Text>
        <View style={styles.modalInput}>
          <Feather name="lock" size={15} color={colors.textDim} />
          <TextInput
            style={[styles.modalTextInput, { flex: 1 }]}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.textDim}
            secureTextEntry={!showCurrent}
            autoFocus
          />
          <TouchableOpacity onPress={() => setShowCurrent(!showCurrent)}>
            <Feather name={showCurrent ? 'eye-off' : 'eye'} size={15} color={colors.textDim} />
          </TouchableOpacity>
        </View>
        <Text style={styles.modalFieldLabel}>New Password</Text>
        <View style={styles.modalInput}>
          <Feather name="lock" size={15} color={colors.textDim} />
          <TextInput
            style={[styles.modalTextInput, { flex: 1 }]}
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="Min. 6 characters"
            placeholderTextColor={colors.textDim}
            secureTextEntry={!showNew}
          />
          <TouchableOpacity onPress={() => setShowNew(!showNew)}>
            <Feather name={showNew ? 'eye-off' : 'eye'} size={15} color={colors.textDim} />
          </TouchableOpacity>
        </View>
        <Text style={styles.modalFieldLabel}>Confirm New Password</Text>
        <View style={styles.modalInput}>
          <Feather name="check" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Repeat new password"
            placeholderTextColor={colors.textDim}
            secureTextEntry
          />
        </View>
        {!!passwordError && <Text style={{ fontSize: 12, color: colors.accentRed, marginTop: 6 }}>{passwordError}</Text>}
        <ModalButtons onCancel={closeModal} onSave={handleChangePassword} loading={modalLoading} saveLabel="Change Password" styles={styles} />
      </AppModal>

      {/* ── Recovery Email Modal ── */}
      <AppModal visible={activeModal === 'recovery'} title="Set Recovery Email" onClose={closeModal} styles={styles} colors={colors}>
        {recoveryStep === 'email' ? (
          <>
            <Text style={styles.modalNote}>
              We'll send a 6-digit code to verify this email before saving it.
            </Text>
            <Text style={styles.modalFieldLabel}>Recovery Email</Text>
            <View style={styles.modalInput}>
              <Feather name="mail" size={15} color={colors.textDim} />
              <TextInput
                style={styles.modalTextInput}
                value={recoveryEmail}
                onChangeText={(v) => { setRecoveryEmail(v); setRecoveryError(''); }}
                placeholder="backup@example.com"
                placeholderTextColor={colors.textDim}
                keyboardType="email-address"
                autoCapitalize="none"
                autoFocus
              />
            </View>
            {!!recoveryError && <Text style={{ fontSize: 12, color: colors.accentRed, marginTop: 6 }}>{recoveryError}</Text>}
            <ModalButtons onCancel={closeModal} onSave={handleSendRecoveryCode} loading={recoverySending} saveLabel="Send Code" styles={styles} />
          </>
        ) : (
          <>
            <Text style={styles.modalNote}>
              Enter the 6-digit code sent to <Text style={{ color: colors.textMain, fontWeight: '700' }}>{recoveryEmail}</Text>. It expires in 10 minutes.
            </Text>
            <Text style={styles.modalFieldLabel}>Verification Code</Text>
            <View style={styles.modalInput}>
              <Feather name="shield" size={15} color={colors.textDim} />
              <TextInput
                style={[styles.modalTextInput, { letterSpacing: 6, fontSize: 20, fontWeight: '700' }]}
                value={recoveryOtp}
                onChangeText={(v) => { setRecoveryOtp(v.replace(/\D/g, '').slice(0, 6)); setRecoveryError(''); }}
                placeholder="000000"
                placeholderTextColor={colors.textDim}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
            </View>
            {!!recoveryError && <Text style={{ fontSize: 12, color: colors.accentRed, marginTop: 6 }}>{recoveryError}</Text>}
            <TouchableOpacity onPress={() => { setRecoveryStep('email'); setRecoveryOtp(''); setRecoveryError(''); }} style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 12, color: colors.primary }}>← Change email or resend code</Text>
            </TouchableOpacity>
            <ModalButtons onCancel={closeModal} onSave={handleVerifyRecoveryOtp} loading={modalLoading} saveLabel="Verify & Save" styles={styles} />
          </>
        )}
      </AppModal>

      {/* ── Sign Out Modal ── */}
      <Modal visible={signOutModalVisible} transparent animationType="fade" onRequestClose={() => setSignOutModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accentRed + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <Feather name="log-out" size={24} color={colors.accentRed} />
              </View>
              <Text style={[styles.modalTitle, { textAlign: 'center' }]}>Sign Out?</Text>
              <Text style={[styles.modalNote, { textAlign: 'center', marginBottom: 0 }]}>
                You will be returned to the login screen. Your progress is saved.
              </Text>
            </View>
            <View style={[styles.modalBtns, { marginTop: 20 }]}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setSignOutModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalSaveBtn, { backgroundColor: colors.accentRed }]} onPress={() => { setSignOutModalVisible(false); logout(); }}>
                <Text style={styles.modalSaveText}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Delete Account Modal ── */}
      <Modal visible={deleteModalVisible} transparent animationType="fade" onRequestClose={() => setDeleteModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accentRed + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <Feather name="trash-2" size={24} color={colors.accentRed} />
              </View>
              <Text style={[styles.modalTitle, { textAlign: 'center' }]}>Delete Account?</Text>
              <Text style={[styles.modalNote, { textAlign: 'center', marginBottom: 0 }]}>
                This is permanent and cannot be undone. All your progress, XP, and data will be lost.
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
                    placeholder="Your password"
                    placeholderTextColor={colors.textDim}
                    secureTextEntry
                    autoFocus
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
            {!!deleteError && (
              <Text style={{ fontSize: 12, color: colors.accentRed, marginTop: 6 }}>{deleteError}</Text>
            )}
            <View style={[styles.modalBtns, { marginTop: 20 }]}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setDeleteModalVisible(false)} disabled={deleteLoading}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSaveBtn, { backgroundColor: colors.accentRed }, deleteLoading && { opacity: 0.7 }]}
                onPress={confirmDeleteAccount}
                disabled={deleteLoading}
              >
                {deleteLoading
                  ? <ActivityIndicator color="white" size="small" />
                  : <Text style={styles.modalSaveText}>Delete</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* ── Grade Modal ── */}
      <AppModal visible={activeModal === 'grade'} title="Update Grade / Year" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={[styles.modalNote, { marginBottom: 12 }]}>Select your current grade. The dashboard will update automatically.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {GRADES.map(g => {
            const active = selectedGrade === g;
            return (
              <TouchableOpacity
                key={g}
                onPress={() => setSelectedGrade(g)}
                style={{
                  width: '22%',
                  paddingVertical: 9,
                  borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: active ? colors.primary : colors.borderColor,
                  backgroundColor: active ? colors.primary + '20' : 'transparent',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: active ? colors.primary : colors.textMuted, fontWeight: active ? '700' : '400', fontSize: 12.5 }} numberOfLines={1}>{g}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.modalBtns}>
          <TouchableOpacity style={styles.modalCancelBtn} onPress={closeModal}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modalSaveBtn, (!selectedGrade || gradeLoading) && { opacity: 0.6 }]}
            onPress={handleSaveGrade}
            disabled={!selectedGrade || gradeLoading}
          >
            {gradeLoading ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.modalSaveText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </AppModal>

      {/* ── Location Modal ── */}
      <AppModal visible={activeModal === 'location'} title="Update Location" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalFieldLabel}>City or region</Text>
        <View style={styles.modalInput}>
          <Feather name="map-pin" size={15} color={colors.textDim} />
          <TextInput
            style={[styles.modalTextInput, { flex: 1 }]}
            value={newLocation}
            onChangeText={setNewLocation}
            placeholder="e.g. Hyderabad"
            placeholderTextColor={colors.textDim}
            autoFocus
          />
        </View>
        <View style={[styles.modalBtns, { marginTop: 20 }]}>
          <TouchableOpacity style={styles.modalCancelBtn} onPress={closeModal}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modalSaveBtn, locationLoading && { opacity: 0.6 }]}
            onPress={handleSaveLocation}
            disabled={locationLoading}
          >
            {locationLoading ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.modalSaveText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </AppModal>

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

function FieldRow({ label, sub, btnLabel, onPress, styles }: { label: string; sub: string; btnLabel: string; onPress: () => void; styles: any }) {
  return (
    <View style={styles.fieldRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldSub} numberOfLines={1}>{sub}</Text>
      </View>
      <TouchableOpacity style={styles.changeBtn} onPress={onPress} activeOpacity={0.7}>
        <Text style={styles.changeBtnText}>{btnLabel}</Text>
      </TouchableOpacity>
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
            <TouchableOpacity onPress={onClose}>
              <Feather name="x" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function ModalButtons({ onCancel, onSave, loading, saveLabel = 'Save Changes', styles }: { onCancel: () => void; onSave: () => void; loading: boolean; saveLabel?: string; styles: any }) {
  return (
    <View style={styles.modalBtns}>
      <TouchableOpacity style={styles.modalCancelBtn} onPress={onCancel}>
        <Text style={styles.modalCancelText}>Cancel</Text>
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
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.md },

  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

  card: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },

  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.lg },
  avatarBig: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 2,
    borderColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  avatarCam: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: isDark ? '#1E1E1E' : '#252525',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: c.cardDark,
  },
  profileName: { fontSize: 18, fontWeight: '700', color: c.textMain, marginBottom: 4, fontFamily: fonts.serif },
  profileRole: { fontSize: 13, color: c.textMuted, marginBottom: 2 },
  profileEmail: { fontSize: 13, color: c.textMuted },

  divider: { height: 1, backgroundColor: c.borderColor, marginVertical: spacing.lg },
  rowDivider: { height: 1, backgroundColor: c.borderColor },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },

  // Profile info rows (label · value · Edit)
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: spacing.md },
  infoLabel: { fontSize: 13, fontWeight: '600', color: c.textMain, width: 120 },
  infoValue: { flex: 1, fontSize: 13, color: c.textMuted },
  editBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor, backgroundColor: 'rgba(255,255,255,0.02)' },
  editBtnText: { fontSize: 13, fontWeight: '600', color: c.textMain },

  // Icon-led rows (Security / Notifications)
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 14 },
  iconBox: { width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: c.borderColor, backgroundColor: 'rgba(255,255,255,0.02)', alignItems: 'center', justifyContent: 'center' },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'flex-start' },
  col: { flex: 1, flexBasis: 0, minWidth: 340 },
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  gridCell: { width: '48%', flexGrow: 1, minWidth: 200, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, padding: spacing.md, backgroundColor: c.cardDark },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: c.textMain, marginBottom: 2 },
  fieldSub: { fontSize: 12, color: c.textMuted, maxWidth: 200 },
  changeBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.35)',
    backgroundColor: c.accentYellow + '15',
  },
  changeBtnText: { fontSize: 12, fontWeight: '600', color: c.primary },

  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  themeRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  themeOption: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 28,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.borderColor,
    backgroundColor: 'rgba(255,255,255,0.02)',
    position: 'relative',
  },
  themeOptionActive: { borderColor: c.accentYellow + '50', backgroundColor: c.accentYellow + '15' },
  themeLabel: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  themeCheck: { position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: 10, backgroundColor: c.accentYellow, alignItems: 'center', justifyContent: 'center' },

  langRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
  langChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.borderColor,
  },
  langChipActive: { borderColor: c.accentYellow + '50', backgroundColor: c.accentYellow + '15' },
  langText: { fontSize: 11, color: c.textMuted, fontWeight: '600' },

  goalRow: { flexDirection: 'row', gap: 6 },
  goalChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.borderColor,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  goalText: { fontSize: 11, color: c.textMuted, fontWeight: '600' },

  comingSoonBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(99,102,241,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.2)',
  },
  comingSoonText: { fontSize: 11, color: c.primary, fontWeight: '600' },

  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 2 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.lg },
  actionBtn: {
    flex: 1, flexBasis: 0, minWidth: 280, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 18, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.accentRed + '40',
    backgroundColor: c.accentRed + '0A',
  },
  actionBtnText: { fontSize: 14, fontWeight: '700' },

  versionText: { textAlign: 'center', fontSize: 12, color: c.textDim, marginTop: spacing.xl },

  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalBox: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 440,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xl },
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.textMain, fontFamily: fonts.serif },
  modalNote: { fontSize: 13, color: c.textMuted, lineHeight: 20, marginBottom: spacing.lg },
  modalFieldLabel: { fontSize: 12, fontWeight: '600', color: c.textMuted, marginBottom: 6, marginTop: spacing.md },
  modalInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: c.bgDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.md,
    height: 46,
    paddingHorizontal: spacing.lg,
  },
  modalTextInput: { flex: 1, fontSize: 14, color: c.textMain },
  modalBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  modalCancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: c.accentYellow, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 14, fontWeight: '700', color: 'white' },

  editBtn: { paddingHorizontal: spacing.lg, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor },
  editBtnText: { fontSize: 13, fontWeight: '600', color: c.textMain },
});
