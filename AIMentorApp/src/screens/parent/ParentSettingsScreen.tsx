import React, { useState, useMemo, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Switch, Modal, Alert, ActivityIndicator, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useNotification } from '../../context/NotificationContext';
import {
  updatePassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  deleteUser,
} from 'firebase/auth';
import { auth } from '../../config/firebase';
import SERVER_URL from '../../config/serverUrl';

type ModalType = 'name' | 'email' | 'password' | null;

export default function ParentSettingsScreen({ navigation }: any) {
  const { user, updateUser, logout } = useAuth();
  const { colors, themeMode, setThemeMode } = useTheme();
  const { triggerPoll } = useNotification();
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

  // Delete account (provider-aware: password vs Google SSO)
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const isPasswordUser = (auth.currentUser?.providerData ?? []).some(p => p.providerId === 'password');
  const isGoogleUser   = (auth.currentUser?.providerData ?? []).some(p => p.providerId === 'google.com');

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
  const [currentPw,     setCurrentPw]    = useState('');
  const [newPw,         setNewPw]        = useState('');
  const [confirmPw,     setConfirmPw]    = useState('');
  const [showCurrent,   setShowCurrent]  = useState(false);
  const [showNew,       setShowNew]      = useState(false);

  function openModal(type: ModalType) {
    setNewName(user?.name || '');
    setNewEmail(''); setEmailPassword('');
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
    setActiveModal(type);
  }
  function closeModal() { setActiveModal(null); setModalLoading(false); }

  async function handleSaveName() {
    if (!newName.trim()) { Alert.alert('Required', 'Please enter a name.'); return; }
    updateUser({ name: newName.trim() });
    closeModal();
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
          <View style={styles.columns}>

            {/* ── Left column ── */}
            <View style={styles.col}>
              {/* ── Profile ── */}
              <SectionHeader icon="user" label="Profile & Account" color={colors.accentYellow} styles={styles} />
              <View style={styles.card}>
                <View style={styles.profileRow}>
                  <View style={styles.avatarBig}>
                    <Text style={styles.avatarInitial}>{user?.name ? user.name[0].toUpperCase() : 'P'}</Text>
                    <View style={styles.avatarCam}>
                      <Feather name="camera" size={11} color="white" />
                    </View>
                  </View>
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
                <FieldRow label="Location" sub={user?.location || 'Not set'} btnLabel="Update" onPress={() => navigation.navigate('ParentProfile')} styles={styles} />
              </View>

              {/* ── Security ── */}
              <SectionHeader icon="shield" label="Security" color={colors.accentGreen} styles={styles} />
              <View style={styles.card}>
                <FieldRow label="Password" sub="Change your account password" btnLabel="Change" onPress={() => openModal('password')} styles={styles} />
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
                  { key: 'weeklyReport',     label: 'Weekly Progress Report', sub: "Summary of your child's week", val: weeklyReport, set: setWeeklyReport },
                  { key: 'progressNudges',   label: 'AI Progress Nudges', sub: 'Tips when your child needs attention', val: progressNudges, set: setProgressNudges },
                  { key: 'challengeUpdates', label: 'Challenge Updates', sub: 'New challenges and rankings', val: challengeUpdates, set: setChallengeUpdates },
                ].map((item, i) => (
                  <View key={item.label}>
                    {i > 0 && <View style={styles.divider} />}
                    <View style={styles.toggleRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fieldLabel}>{item.label}</Text>
                        <Text style={styles.fieldSub}>{item.sub}</Text>
                      </View>
                      <Switch
                        value={item.val}
                        onValueChange={v => {
                          item.set(v);
                          const next = { assignmentAlerts, teacherMessages, weeklyReport, progressNudges, challengeUpdates, [item.key]: v };
                          saveNotifPrefs(next);
                          // Trigger an immediate poll so the new pref takes effect instantly
                          triggerPoll();
                        }}
                        trackColor={{ false: colors.borderColor, true: colors.accentYellow }}
                        thumbColor="white"
                      />
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

      {/* Change Email Modal */}
      <AppModal visible={activeModal === 'email'} title="Change Email Address" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalNote}>Enter your new email and current password to confirm the change.</Text>
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
        <ModalButtons
          onCancel={closeModal}
          onSave={async () => {
            if (!newEmail.trim() || !emailPassword) { Alert.alert('Required', 'Fill in all fields.'); return; }
            setModalLoading(true);
            try {
              const fu = auth.currentUser;
              if (fu && fu.email) {
                const cred = EmailAuthProvider.credential(fu.email, emailPassword);
                await reauthenticateWithCredential(fu, cred);
              }
              updateUser({ email: newEmail.trim() });
              closeModal();
              Alert.alert('Email Updated', 'Your email address has been changed.');
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to update email.');
            } finally { setModalLoading(false); }
          }}
          loading={modalLoading}
          saveLabel="Update Email"
          styles={styles}
        />
      </AppModal>

      {/* Change Password Modal */}
      <AppModal visible={activeModal === 'password'} title="Change Password" onClose={closeModal} styles={styles} colors={colors}>
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
            <TouchableOpacity onPress={onClose}><Feather name="x" size={20} color={colors.textMuted} /></TouchableOpacity>
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
    borderWidth: 2, borderColor: c.borderColor,
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
  modalTextInput: { flex: 1, fontFamily: fonts.serif, fontSize: 14, color: c.textMain },
  modalBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '600', color: c.textMuted },
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: c.accentYellow, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '700', color: '#0B0B0B' },
});



