import React, { useState, useMemo } from 'react';
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
import { spacing, radius } from '../../theme';
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
  reauthenticateWithCredential,
  deleteUser,
} from 'firebase/auth';
import { auth } from '../../config/firebase';

type ModalType = 'name' | 'email' | 'password' | 'recovery' | 'delete' | null;

export default function SettingsScreen({ navigation }: any) {
  const { user, updateUser, logout } = useAuth();
  const { stats } = useStudentData();
  const { colors, themeMode, setThemeMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Notification preferences
  const [pushNotifications, setPushNotifications] = useState(true);
  const [aiSuggestions, setAiSuggestions] = useState(true);
  const [weeklyReport, setWeeklyReport] = useState(false);
  const [assignmentAlerts, setAssignmentAlerts] = useState(true);
  const [challengeUpdates, setChallengeUpdates] = useState(true);

  // Appearance
  const [language, setLanguage] = useState('English');

  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [modalLoading, setModalLoading] = useState(false);

  // Name modal
  const [newName, setNewName] = useState(user?.name || '');

  // Email modal
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');

  // Password modal
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  // Recovery email modal
  const [recoveryEmail, setRecoveryEmail] = useState('');

  function openModal(type: ModalType) {
    setNewName(user?.name || '');
    setNewEmail('');
    setEmailPassword('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setRecoveryEmail('');
    setActiveModal(type);
  }

  function closeModal() {
    setActiveModal(null);
    setModalLoading(false);
  }

  async function handleSaveName() {
    if (!newName.trim()) { Alert.alert('Required', 'Please enter a name.'); return; }
    updateUser({ name: newName.trim() });
    closeModal();
    Alert.alert('Updated', 'Your display name has been updated.');
  }

  async function handleChangeEmail() {
    if (!newEmail.trim()) { Alert.alert('Required', 'Please enter a new email.'); return; }
    if (!emailPassword) { Alert.alert('Required', 'Please enter your current password.'); return; }
    setModalLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (firebaseUser && firebaseUser.email) {
        const cred = EmailAuthProvider.credential(firebaseUser.email, emailPassword);
        await reauthenticateWithCredential(firebaseUser, cred);
        await updateEmail(firebaseUser, newEmail.trim());
        updateUser({ email: newEmail.trim() });
        closeModal();
        Alert.alert('Email Updated', 'Your email address has been changed.');
      } else {
        // Demo mode — just update locally
        updateUser({ email: newEmail.trim() });
        closeModal();
        Alert.alert('Email Updated', 'Your email address has been changed.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update email.');
    } finally {
      setModalLoading(false);
    }
  }

  async function handleChangePassword() {
    if (!currentPassword) { Alert.alert('Required', 'Enter your current password.'); return; }
    if (newPassword.length < 6) { Alert.alert('Too Short', 'New password must be at least 6 characters.'); return; }
    if (newPassword !== confirmPassword) { Alert.alert('Mismatch', 'Passwords do not match.'); return; }
    setModalLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (firebaseUser && firebaseUser.email) {
        const cred = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
        await reauthenticateWithCredential(firebaseUser, cred);
        await updatePassword(firebaseUser, newPassword);
        closeModal();
        Alert.alert('Password Changed', 'Your password has been updated successfully.');
      } else {
        closeModal();
        Alert.alert('Password Changed', 'Your password has been updated successfully.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to change password.');
    } finally {
      setModalLoading(false);
    }
  }

  function handleSaveRecovery() {
    if (!recoveryEmail.trim()) { Alert.alert('Required', 'Please enter a recovery email.'); return; }
    closeModal();
    Alert.alert('Saved', `Recovery email set to ${recoveryEmail.trim()}`);
  }

  function handleSignOut() {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => logout() },
      ]
    );
  }

  async function handleDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This action is permanent and cannot be undone. All your data will be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const firebaseUser = auth.currentUser;
              if (firebaseUser) await deleteUser(firebaseUser);
              logout();
            } catch {
              Alert.alert('Error', 'Could not delete account. Please sign in again and retry.');
            }
          },
        },
      ]
    );
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
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
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
                  {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Student'} · {levelLabel} · {user?.email}
                </Text>
              </View>
            </View>
            <View style={styles.divider} />

            <FieldRow
              label="Display Name"
              sub={user?.name || '—'}
              btnLabel="Change"
              onPress={() => openModal('name')}
              styles={styles}
            />
            <View style={styles.divider} />
            <FieldRow
              label="Email Address"
              sub={user?.email || '—'}
              btnLabel="Change"
              onPress={() => openModal('email')}
              styles={styles}
            />
            <View style={styles.divider} />
            <FieldRow
              label="Grade / Year"
              sub={user?.grade || 'Not set'}
              btnLabel="Update"
              onPress={() => navigation.navigate('Profile')}
              styles={styles}
            />
            <View style={styles.divider} />
            <FieldRow
              label="Location"
              sub={user?.location || 'Not set'}
              btnLabel="Update"
              onPress={() => navigation.navigate('Profile')}
              styles={styles}
            />
          </View>

          {/* ── Security ── */}
          <SectionHeader icon="shield" label="Security" color={colors.accentGreen} styles={styles} />
          <View style={styles.card}>
            <FieldRow
              label="Password"
              sub="Change your account password"
              btnLabel="Change"
              onPress={() => openModal('password')}
              styles={styles}
            />
            <View style={styles.divider} />
            <FieldRow
              label="Recovery Email"
              sub="Backup email for account recovery"
              btnLabel="Set"
              onPress={() => openModal('recovery')}
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

          {/* ── Notifications ── */}
          <SectionHeader icon="bell" label="Notifications" color={colors.accentYellow} styles={styles} />
          <View style={styles.card}>
            {[
              { label: 'Push Notifications', sub: 'Reminders, updates and alerts', val: pushNotifications, set: setPushNotifications },
              { label: 'AI Suggestions', sub: 'Smart learning tips from AI', val: aiSuggestions, set: setAiSuggestions },
              { label: 'Weekly Report', sub: 'Progress summary every week', val: weeklyReport, set: setWeeklyReport },
              { label: 'Assignment Alerts', sub: 'Due date reminders', val: assignmentAlerts, set: setAssignmentAlerts },
              { label: 'Challenge Updates', sub: 'New challenges and leaderboard changes', val: challengeUpdates, set: setChallengeUpdates },
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
                    onValueChange={(v) => {
                      item.set(v);
                      // Show feedback
                    }}
                    trackColor={{ false: colors.borderColor, true: colors.primary }}
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
              ] as const).map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.themeOption, themeMode === t.id && styles.themeOptionActive]}
                  onPress={() => setThemeMode(t.id)}
                  activeOpacity={0.7}
                >
                  <Feather name={t.icon} size={16} color={themeMode === t.id ? colors.primary : colors.textMuted} />
                  <Text style={[styles.themeLabel, themeMode === t.id && { color: colors.primary }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.divider} />
            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Language</Text>
                <Text style={styles.fieldSub}>{language}</Text>
              </View>
              <View style={styles.langRow}>
                {['English', 'Spanish', 'French'].map((l) => (
                  <TouchableOpacity
                    key={l}
                    style={[styles.langChip, language === l && styles.langChipActive]}
                    onPress={() => setLanguage(l)}
                  >
                    <Text style={[styles.langText, language === l && { color: colors.primary }]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* ── Learning Preferences ── */}
          <SectionHeader icon="book-open" label="Learning Preferences" color={colors.accentBlue} styles={styles} />
          <View style={styles.card}>
            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Daily Study Goal</Text>
                <Text style={styles.fieldSub}>Target minutes per day</Text>
              </View>
              <View style={styles.goalRow}>
                {[30, 60, 90, 120].map((m) => (
                  <TouchableOpacity key={m} style={styles.goalChip}>
                    <Text style={styles.goalText}>{m}m</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Difficulty Level</Text>
                <Text style={styles.fieldSub}>Preferred challenge difficulty</Text>
              </View>
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonText}>Soon</Text>
              </View>
            </View>
          </View>

          {/* ── Danger Zone ── */}
          <SectionHeader icon="alert-triangle" label="Account Actions" color={colors.accentRed} styles={styles} />
          <View style={styles.card}>
            <TouchableOpacity style={styles.dangerRow} onPress={handleSignOut} activeOpacity={0.7}>
              <Feather name="log-out" size={16} color={colors.accentRed} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: colors.accentRed }]}>Sign Out</Text>
                <Text style={styles.fieldSub}>You will be returned to the login screen</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.accentRed} />
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.dangerRow} onPress={handleDeleteAccount} activeOpacity={0.7}>
              <Feather name="trash-2" size={16} color={colors.accentRed} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { color: colors.accentRed }]}>Delete Account</Text>
                <Text style={styles.fieldSub}>Permanently remove all your data</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.accentRed} />
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
            onChangeText={setNewName}
            placeholder="Your name"
            placeholderTextColor={colors.textDim}
            autoCapitalize="words"
            autoFocus
          />
        </View>
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
        <ModalButtons onCancel={closeModal} onSave={handleChangePassword} loading={modalLoading} saveLabel="Change Password" styles={styles} />
      </AppModal>

      {/* ── Recovery Email Modal ── */}
      <AppModal visible={activeModal === 'recovery'} title="Set Recovery Email" onClose={closeModal} styles={styles} colors={colors}>
        <Text style={styles.modalNote}>
          This email will be used to recover your account if you lose access.
        </Text>
        <Text style={styles.modalFieldLabel}>Recovery Email</Text>
        <View style={styles.modalInput}>
          <Feather name="mail" size={15} color={colors.textDim} />
          <TextInput
            style={styles.modalTextInput}
            value={recoveryEmail}
            onChangeText={setRecoveryEmail}
            placeholder="backup@example.com"
            placeholderTextColor={colors.textDim}
            keyboardType="email-address"
            autoCapitalize="none"
            autoFocus
          />
        </View>
        <ModalButtons onCancel={closeModal} onSave={handleSaveRecovery} loading={modalLoading} saveLabel="Save" styles={styles} />
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
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: c.cardDark,
  },
  profileName: { fontSize: 16, fontWeight: '700', color: c.textMain, marginBottom: 3 },
  profileRole: { fontSize: 12, color: c.textMuted },

  divider: { height: 1, backgroundColor: c.borderColor, marginVertical: spacing.lg },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: c.textMain, marginBottom: 2 },
  fieldSub: { fontSize: 12, color: c.textMuted, maxWidth: 200 },
  changeBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.35)',
    backgroundColor: c.primaryGlow,
  },
  changeBtnText: { fontSize: 12, fontWeight: '600', color: c.primary },

  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  themeRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  themeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.borderColor,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  themeOptionActive: { borderColor: c.primary, backgroundColor: c.primaryGlow },
  themeLabel: { fontSize: 13, fontWeight: '600', color: c.textMuted },

  langRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
  langChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.borderColor,
  },
  langChipActive: { borderColor: c.primary, backgroundColor: c.primaryGlow },
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
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.textMain },
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
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 14, fontWeight: '700', color: 'white' },

  editBtn: { paddingHorizontal: spacing.lg, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor },
  editBtnText: { fontSize: 13, fontWeight: '600', color: c.textMain },
});
