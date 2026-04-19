import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Switch, Modal, Alert, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import {
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';
import { auth } from '../../config/firebase';

type ModalType = 'name' | 'email' | 'password' | null;

export default function TeacherSettingsScreen({ navigation }: any) {
  const { user, updateUser, logout } = useAuth();
  const { colors, themeMode, setThemeMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Notifications
  const [submissionAlerts,  setSubmissionAlerts]  = useState(true);
  const [parentMessages,    setParentMessages]    = useState(true);
  const [weeklyReport,      setWeeklyReport]      = useState(true);
  const [aiInsights,        setAiInsights]        = useState(true);
  const [challengeAlerts,   setChallengeAlerts]   = useState(false);

  // Teaching prefs
  const [autoGrading,       setAutoGrading]       = useState(true);
  const [shareProgress,     setShareProgress]     = useState(true);

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
    if (!currentPw) { Alert.alert('Required', 'Enter your current password.'); return; }
    if (newPw.length < 6) { Alert.alert('Too Short', 'New password must be at least 6 characters.'); return; }
    if (newPw !== confirmPw) { Alert.alert('Mismatch', 'Passwords do not match.'); return; }
    setModalLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (firebaseUser && firebaseUser.email) {
        const cred = EmailAuthProvider.credential(firebaseUser.email, currentPw);
        await reauthenticateWithCredential(firebaseUser, cred);
        await updatePassword(firebaseUser, newPw);
      }
      closeModal();
      Alert.alert('Password Changed', 'Your password has been updated successfully.');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to change password.');
    } finally { setModalLoading(false); }
  }

  function handleSignOut() {
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

          {/* ── Profile ── */}
          <SectionHeader icon="user" label="Profile & Account" color={colors.primary} styles={styles} />
          <View style={styles.card}>
            <View style={styles.profileRow}>
              <View style={styles.avatarBig}>
                <Text style={styles.avatarInitial}>{user?.name ? user.name[0].toUpperCase() : 'T'}</Text>
                <View style={styles.avatarCam}>
                  <Feather name="camera" size={11} color="white" />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{user?.name || 'Teacher'}</Text>
                <Text style={styles.profileSub}>{user?.email || ''}</Text>
                <View style={styles.profileMeta}>
                  <View style={styles.roleBadge}>
                    <Feather name="briefcase" size={10} color={colors.primary} />
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
            <FieldRow label="School / Institution" sub={user?.school || 'Not set'} btnLabel="Update" onPress={() => navigation.navigate('TeacherProfile')} styles={styles} />
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

          {/* ── Teaching Preferences ── */}
          <SectionHeader icon="settings" label="Teaching Preferences" color={colors.accentBlue} styles={styles} />
          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>AI Auto-Grading</Text>
                <Text style={styles.fieldSub}>Let AI grade assignments automatically</Text>
              </View>
              <Switch value={autoGrading} onValueChange={setAutoGrading} trackColor={{ false: colors.borderColor, true: colors.primary }} thumbColor="white" />
            </View>
            <View style={styles.divider} />
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Share Progress with Parents</Text>
                <Text style={styles.fieldSub}>Parents can see their child's scores and activity</Text>
              </View>
              <Switch value={shareProgress} onValueChange={setShareProgress} trackColor={{ false: colors.borderColor, true: colors.primary }} thumbColor="white" />
            </View>
            <View style={styles.divider} />
            <View style={styles.fieldRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Curriculum</Text>
                <Text style={styles.fieldSub}>{user?.curriculum || 'IB PYP'} · Grade {user?.grade?.replace('Grade ', '') || '3'}</Text>
              </View>
              <TouchableOpacity style={styles.changeBtn} onPress={() => navigation.navigate('TeacherProfile')} activeOpacity={0.7}>
                <Text style={styles.changeBtnText}>Update</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Notifications ── */}
          <SectionHeader icon="bell" label="Notifications" color={colors.accentYellow} styles={styles} />
          <View style={styles.card}>
            {[
              { label: 'Assignment Submissions', sub: 'When a student submits work', val: submissionAlerts, set: setSubmissionAlerts },
              { label: 'Parent Messages', sub: 'New messages from parents', val: parentMessages, set: setParentMessages },
              { label: 'Weekly Class Report', sub: 'Summary of class activity each week', val: weeklyReport, set: setWeeklyReport },
              { label: 'AI Class Insights', sub: 'Smart suggestions for your class', val: aiInsights, set: setAiInsights },
              { label: 'Challenge Activity', sub: 'Student challenge completions and rankings', val: challengeAlerts, set: setChallengeAlerts },
            ].map((item, i) => (
              <View key={item.label}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{item.label}</Text>
                    <Text style={styles.fieldSub}>{item.sub}</Text>
                  </View>
                  <Switch value={item.val} onValueChange={item.set} trackColor={{ false: colors.borderColor, true: colors.primary }} thumbColor="white" />
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
                  <Feather name={t.icon} size={16} color={themeMode === t.id ? colors.primary : colors.textMuted} />
                  <Text style={[styles.themeLabel, themeMode === t.id && { color: colors.primary }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Account Actions ── */}
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
        <Text style={styles.modalNote}>Enter your new email and current password to confirm.</Text>
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
          loading={modalLoading} saveLabel="Update Email" styles={styles}
        />
      </AppModal>

      {/* Change Password Modal */}
      <AppModal visible={activeModal === 'password'} title="Change Password" onClose={closeModal} styles={styles} colors={colors}>
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
        <ModalButtons onCancel={closeModal} onSave={handleChangePassword} loading={modalLoading} saveLabel="Change Password" styles={styles} />
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
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.md },

  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

  card: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xl },

  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.lg },
  avatarBig: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: c.primary,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  avatarCam: {
    position: 'absolute', bottom: 0, right: 0, width: 22, height: 22, borderRadius: 11,
    backgroundColor: c.cardDark, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: c.borderColor,
  },
  avatarInitial: { fontSize: 24, fontWeight: '800', color: '#fff' },
  profileName: { fontSize: 16, fontWeight: '700', color: c.textMain, marginBottom: 2 },
  profileSub: { fontSize: 12, color: c.textMuted, marginBottom: 6 },
  profileMeta: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: c.primaryGlow, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: c.primary + '30',
  },
  roleBadgeText: { fontSize: 11, fontWeight: '600', color: c.primary },

  divider: { height: 1, backgroundColor: c.borderColor, marginVertical: spacing.lg },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: c.textMain, marginBottom: 2 },
  fieldSub: { fontSize: 12, color: c.textMuted, maxWidth: 220 },
  changeBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.sm,
    borderWidth: 1, borderColor: c.primary + '40', backgroundColor: c.primaryGlow,
  },
  changeBtnText: { fontSize: 12, fontWeight: '600', color: c.primary },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  comingSoonBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: c.primaryGlow, borderWidth: 1, borderColor: c.primary + '30' },
  comingSoonText: { fontSize: 11, color: c.primary, fontWeight: '600' },

  themeRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  themeOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1,
    borderColor: c.borderColor, backgroundColor: 'rgba(255,255,255,0.02)',
  },
  themeOptionActive: { borderColor: c.primary, backgroundColor: c.primaryGlow },
  themeLabel: { fontSize: 13, fontWeight: '600', color: c.textMuted },

  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 2 },
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
  modalTextInput: { flex: 1, fontSize: 14, color: c.textMain },
  modalBtns: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { fontSize: 14, fontWeight: '700', color: 'white' },
});
