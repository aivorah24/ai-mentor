import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { useResponsive } from '../../hooks/useResponsive';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';
import { getAvatarGradient, getAvatarIcon } from '../../constants/avatarStyles';

const ADMIN_EMAILS = new Set(['kannansaimohan2003@gmail.com', 'preddy6678@gmail.com']);

function formatNotifTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  } catch { return ''; }
}

interface HeaderProps {
  title: string;
  subtitle?: string;
  searchPlaceholder?: string;
  showSearch?: boolean;
  showBack?: boolean;
  onBack?: () => void;
  onMenuPress?: () => void;
  onSearchChange?: (text: string) => void;
  onNotificationPress?: () => void;
  onProfilePress?: () => void;
  notificationCount?: number;
}

export default function Header({
  title,
  subtitle,
  searchPlaceholder = 'Search...',
  showSearch = false,
  showBack = false,
  onBack,
  onMenuPress,
  onSearchChange,
  onNotificationPress,
  notificationCount = 0,
}: HeaderProps) {
  const { isMobile } = useResponsive();
  const { colors } = useTheme();
  const { user, updateUser, logout } = useAuth();
  const navigation = useNavigation<any>();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  function handleBack() {
    if (onBack) {
      onBack();
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      // Fallback: if no history, go to the default dashboard based on role
      const role = user?.role || 'student';
      const home = role === 'teacher' ? 'TeacherDashboard' : role === 'parent' ? 'ParentDashboard' : 'Dashboard';
      navigation.navigate(home);
    }
  }

  const {
    unreadCount,
    unreadAssignments,
    unreadChallenges,
    latestNotif,
    notificationItems,
    clearUnread,
    clearUnreadAssignments,
    clearUnreadChallenges,
  } = useNotification();

  // Resolve screen names based on user role
  const role = user?.role ?? 'student';
  const screenNames = useMemo(() => ({
    assignments: role === 'teacher' ? 'TeacherAssignments' : role === 'parent' ? 'ParentAssignments' : 'Assignments',
    messages:    role === 'teacher' ? 'TeacherMessages'    : role === 'parent' ? 'ParentMessages'    : 'Messages',
    challenges:  role === 'teacher' ? 'TeacherChallenges'  : role === 'parent' ? 'ParentChallenges'  : 'Challenges',
  }), [role]);

  const [bellVisible, setBellVisible] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);

const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Bell count: real-time messages + real-time assignments + challenges.
  const count = unreadCount + unreadAssignments + unreadChallenges;
  const avatarStyle = (user as any)?.avatarStyle;
  const photoUrl = (user as any)?.photoUrl;

  useEffect(() => {
    if (!user?.email || !title) return;
    fetch(`${SERVER_URL}/analytics/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'page_view',
        userEmail: user.email,
        role: user.role,
        source: 'header',
        page: title,
        meta: { subtitle: subtitle || '', platform: Platform.OS },
      }),
    }).catch(() => {});
  }, [title, subtitle, user?.email, user?.role]);

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const asset = result.assets[0];
    setUploadingPhoto(true);
    try {
      const res = await fetch(`${SERVER_URL}/user/upload-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: user?.email, base64: asset.base64, mimeType: asset.mimeType ?? 'image/jpeg' }),
      });
      const data = await res.json();
      if (res.ok && data.photoUrl) {
        updateUser({ photoUrl: data.photoUrl } as any);
      } else {
        Alert.alert('Upload failed', data.error ?? 'Try again.');
      }
    } catch {
      Alert.alert('Error', 'Could not upload photo.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSaveName() {
    const newName = nameInput.trim();
    if (!newName || !user?.email) return;
    // Update local state immediately
    updateUser({ name: newName });
    setEditingName(false);
    // Persist to DB
    try {
      await fetch(`${SERVER_URL}/user/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, name: newName }),
      });
    } catch {}
  }

  function renderAvatarCircle(size: number) {
    const iconSize = Math.round(size * 0.42);
    const borderRadius = size / 2;
    if (photoUrl) {
      return <Image source={{ uri: photoUrl }} style={{ width: size, height: size, borderRadius }} />;
    }
    if (avatarStyle) {
      return (
        <LinearGradient
          colors={getAvatarGradient(avatarStyle)}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ width: size, height: size, borderRadius, alignItems: 'center', justifyContent: 'center' }}
        >
          <Feather name={getAvatarIcon(avatarStyle) as any} size={iconSize} color="white" />
        </LinearGradient>
      );
    }
    return <Feather name="user" size={iconSize} color={colors.textMuted} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {showBack ? (
          <TouchableOpacity style={styles.menuBtn} onPress={handleBack}>
            <Feather name="arrow-left" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        ) : isMobile && (
          <TouchableOpacity style={styles.menuBtn} onPress={onMenuPress}>
            <Feather name="menu" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
        <View>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      </View>

      <View style={styles.right}>
        {showSearch && (
          <View style={styles.searchWrapper}>
            <Feather name="search" size={14} color={colors.textMuted} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.textDim}
              onChangeText={onSearchChange}
              returnKeyType="search"
            />
          </View>
        )}

        {/* Bell */}
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => {
            setBellVisible(prev => !prev);
            onNotificationPress?.();
          }}
          activeOpacity={0.7}
        >
          <Feather name="bell" size={18} color={count > 0 ? colors.primary : colors.textMuted} />
          {count > 0 && (
            <View style={styles.notifBadge}>
              <Text style={styles.notifCount}>{count > 9 ? '9+' : count}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Bell dropdown — Google Classroom style notification center */}
        <Modal visible={bellVisible} transparent animationType="none" onRequestClose={() => setBellVisible(false)}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setBellVisible(false)}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <View style={[styles.dropdown, styles.notifPanel]}>
                {/* Header */}
                <View style={styles.dropdownHeader}>
                  <Text style={styles.dropdownTitle}>Notifications</Text>
                  {count > 0 && (
                    <TouchableOpacity
                      onPress={() => {
                        setBellVisible(false);
                        void clearUnread();
                        void clearUnreadAssignments();
                        void clearUnreadChallenges();
                      }}
                      activeOpacity={0.7}
                      style={styles.markAllBtn}
                    >
                      <Text style={[styles.markAllText, { color: colors.primary }]}>Mark all read</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => setBellVisible(false)} activeOpacity={0.7}>
                    <Feather name="x" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                {(count > 0 || notificationItems.length > 0) ? (
                  <View style={{ overflowY: 'auto', maxHeight: 400 } as any}>

                    {/* Individual assignment notification items (Google Classroom style) */}
                    {notificationItems.map(item => {
                      const isChallenge = item.type === 'challenge';
                      const accent = isChallenge ? colors.accentPurple : colors.accentBlue;
                      const iconName = isChallenge ? 'award' : (item.type === 'quiz' ? 'help-circle' : 'check-square');
                      return (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.notifItem}
                        activeOpacity={0.75}
                        onPress={() => {
                          setBellVisible(false);
                          // Deep-link straight into the tapped item — the target screen
                          // auto-opens the entry matching highlightId.
                          if (isChallenge) {
                            void clearUnreadChallenges();
                            navigation.navigate(screenNames.challenges, { highlightId: item.id, tab: 'assigned' });
                          } else {
                            void clearUnreadAssignments();
                            navigation.navigate(screenNames.assignments, { highlightId: item.id });
                          }
                        }}
                      >
                        <View style={[styles.notifIconWrap, { backgroundColor: accent + '22' }]}>
                          <Feather
                            name={iconName as any}
                            size={16}
                            color={accent}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.notifItemTitle} numberOfLines={1}>{item.title}</Text>
                          <Text style={styles.notifPreview} numberOfLines={1}>{item.subtitle}</Text>
                          <Text style={styles.notifTime}>{formatNotifTime(item.createdAt)}</Text>
                        </View>
                        <View style={styles.notifUnreadDot} />
                      </TouchableOpacity>
                      );
                    })}

                    {/* Real unread messages */}
                    {unreadCount > 0 && (
                      <TouchableOpacity
                        style={styles.notifItem}
                        activeOpacity={0.75}
                        onPress={() => {
                          setBellVisible(false);
                          void clearUnread();
                          navigation.navigate(screenNames.messages);
                        }}
                      >
                        <View style={[styles.notifIconWrap, { backgroundColor: colors.primary + '22' }]}>
                          <Feather name="message-square" size={16} color={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          {latestNotif ? (
                            <>
                              <Text style={styles.notifItemTitle} numberOfLines={1}>
                                Message from {latestNotif.senderName}
                              </Text>
                              <Text style={styles.notifPreview} numberOfLines={1}>{latestNotif.preview}</Text>
                              <Text style={styles.notifTime}>{formatNotifTime(latestNotif.createdAt)}</Text>
                            </>
                          ) : (
                            <>
                              <Text style={styles.notifItemTitle}>
                                {unreadCount === 1 ? '1 unread message' : `${unreadCount} unread messages`}
                              </Text>
                              <Text style={styles.notifPreview}>Tap to open messages</Text>
                            </>
                          )}
                        </View>
                        <View style={styles.notifUnreadDot} />
                      </TouchableOpacity>
                    )}

                    {/* Challenges summary — only when no per-challenge items are shown above */}
                    {unreadChallenges > 0 && !notificationItems.some(i => i.type === 'challenge') && (
                      <TouchableOpacity
                        style={styles.notifItem}
                        activeOpacity={0.75}
                        onPress={() => {
                          setBellVisible(false);
                          void clearUnreadChallenges();
                          navigation.navigate(screenNames.challenges, { tab: 'assigned' });
                        }}
                      >
                        <View style={[styles.notifIconWrap, { backgroundColor: colors.accentPurple + '22' }]}>
                          <Feather name="award" size={16} color={colors.accentPurple} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.notifItemTitle}>
                            {unreadChallenges === 1 ? 'New challenge assigned' : `${unreadChallenges} new challenges`}
                          </Text>
                          <Text style={styles.notifPreview}>Tap to view your challenges</Text>
                        </View>
                        <View style={styles.notifUnreadDot} />
                      </TouchableOpacity>
                    )}

                    {/* Assignments count summary (if no individual items) */}
                    {unreadAssignments > 0 && notificationItems.length === 0 && (
                      <TouchableOpacity
                        style={styles.notifItem}
                        activeOpacity={0.75}
                        onPress={() => {
                          setBellVisible(false);
                          void clearUnreadAssignments();
                          navigation.navigate(screenNames.assignments);
                        }}
                      >
                        <View style={[styles.notifIconWrap, { backgroundColor: colors.accentBlue + '22' }]}>
                          <Feather name="check-square" size={16} color={colors.accentBlue} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.notifItemTitle}>
                            {unreadAssignments === 1 ? 'New assignment' : `${unreadAssignments} new assignments`}
                          </Text>
                          <Text style={styles.notifPreview}>Tap to view your assignments</Text>
                        </View>
                        <View style={styles.notifUnreadDot} />
                      </TouchableOpacity>
                    )}
                  </View>
                ) : (
                  <View style={styles.noNotifState}>
                    <Feather name="bell-off" size={28} color={colors.textDim} />
                    <Text style={styles.noNotifText}>You're all caught up!</Text>
                    <Text style={[styles.notifPreview, { textAlign: 'center', paddingHorizontal: 16 }]}>
                      New assignments and messages will appear here
                    </Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* Admin Panel — only for whitelisted emails */}
        {user?.email && ADMIN_EMAILS.has(user.email.toLowerCase().trim()) && (
          <TouchableOpacity
            style={[styles.iconBtn, { borderColor: colors.primary, backgroundColor: colors.primaryGlow }]}
            onPress={() => {
              const email = encodeURIComponent(user.email || '');
              if (Platform.OS === 'web') {
                (window as any).open(`${SERVER_URL}/admin/panel?email=${email}`, '_blank');
              }
            }}
            activeOpacity={0.7}
          >
            <Feather name="shield" size={16} color={colors.primary} />
          </TouchableOpacity>
        )}

        {/* Profile avatar button */}
        <TouchableOpacity
          style={[styles.avatar, (photoUrl || avatarStyle) && { backgroundColor: 'transparent', borderColor: 'transparent' }]}
          onPress={() => setProfileVisible(true)}
          activeOpacity={0.7}
        >
          {renderAvatarCircle(36)}
        </TouchableOpacity>

        {/* Profile dropdown */}
        <Modal visible={profileVisible} transparent animationType="none" onRequestClose={() => { setProfileVisible(false); setEditingName(false); }}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => { setProfileVisible(false); setEditingName(false); }}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <View style={[styles.dropdown, { width: 280 }]}>
                {/* Header */}
                <View style={styles.dropdownHeader}>
                  <Text style={styles.dropdownTitle}>My Profile</Text>
                  <TouchableOpacity onPress={() => { setProfileVisible(false); setEditingName(false); }} activeOpacity={0.7}>
                    <Feather name="x" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                {/* Photo */}
                <View style={styles.profilePhotoRow}>
                  <TouchableOpacity style={styles.profilePhotoWrap} onPress={handlePickPhoto} activeOpacity={0.85} disabled={uploadingPhoto}>
                    {renderAvatarCircle(64)}
                    <View style={styles.profileCameraBtn}>
                      {uploadingPhoto
                        ? <ActivityIndicator size={10} color="#fff" />
                        : <Feather name="camera" size={10} color="#fff" />
                      }
                    </View>
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.profileName} numberOfLines={1}>{user?.name}</Text>
                    <Text style={styles.profileRole}>{user?.role}</Text>
                    {user?.curriculum && (
                      <View style={styles.curriculumBadge}>
                        <Text style={styles.curriculumBadgeText}>{user.curriculum}</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Email */}
                <View style={styles.profileInfoRow}>
                  <Feather name="mail" size={13} color={colors.textDim} />
                  <Text style={styles.profileInfoText} numberOfLines={1}>{user?.email}</Text>
                </View>
                {user?.school && (
                  <View style={styles.profileInfoRow}>
                    <Feather name="home" size={13} color={colors.textDim} />
                    <Text style={styles.profileInfoText} numberOfLines={1}>{user.school}</Text>
                  </View>
                )}
                {user?.location && (
                  <View style={styles.profileInfoRow}>
                    <Feather name="map-pin" size={13} color={colors.textDim} />
                    <Text style={styles.profileInfoText}>{user.location}</Text>
                  </View>
                )}

                {/* Edit name */}
                <View style={styles.profileEditSection}>
                  {editingName ? (
                    <View style={styles.nameEditRow}>
                      <TextInput
                        style={styles.nameInput}
                        value={nameInput}
                        onChangeText={setNameInput}
                        placeholder="Enter name..."
                        placeholderTextColor={colors.textDim}
                        autoFocus
                        autoCapitalize="words"
                      />
                      <TouchableOpacity onPress={handleSaveName} activeOpacity={0.8} style={styles.nameSaveBtn}>
                        <Feather name="check" size={14} color="#fff" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditingName(false)} activeOpacity={0.8}>
                        <Feather name="x" size={14} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.editNameBtn}
                      onPress={() => { setNameInput(user?.name || ''); setEditingName(true); }}
                      activeOpacity={0.8}
                    >
                      <Feather name="edit-2" size={13} color={colors.primary} />
                      <Text style={styles.editNameText}>Edit display name</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Logout */}
                <TouchableOpacity
                  style={styles.logoutBtn}
                  onPress={() => { setProfileVisible(false); logout(); }}
                  activeOpacity={0.85}
                >
                  <Feather name="log-out" size={16} color={colors.accentRed} />
                  <Text style={[styles.logoutBtnText, { color: colors.accentRed }]}>Log Out</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </View>
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  container: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    backgroundColor: c.bgDark,
    borderBottomWidth: 1,
    borderBottomColor: c.borderColor,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  menuBtn: {
    width: 36, height: 36, borderRadius: radius.sm,
    backgroundColor: c.cardDark, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.borderColor,
  },
  title: { fontSize: 18, fontWeight: '700', color: c.textMain, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: c.textMuted, marginTop: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  searchWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: 20, paddingHorizontal: spacing.md, height: 36, width: 180,
  },
  searchIcon: { marginRight: 6 },
  searchInput: { flex: 1, color: c.textMain, fontSize: 13 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    alignItems: 'center', justifyContent: 'center',
  },
  notifBadge: {
    position: 'absolute', top: 4, right: 4,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: c.accentRed, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3, borderWidth: 1.5, borderColor: c.cardDark,
  },
  notifCount: { fontSize: 9, fontWeight: '800', color: '#fff' },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: c.cardDark, borderWidth: 2, borderColor: c.borderColor,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },

  // Shared dropdown shell
  modalBackdrop: {
    flex: 1, alignItems: 'flex-end', justifyContent: 'flex-start',
    paddingTop: 68, paddingRight: 16,
  },
  dropdown: {
    width: 290, backgroundColor: c.cardDark,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 20, overflow: 'hidden',
  },
  dropdownHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  dropdownTitle: {
    fontSize: 12, fontWeight: '700', color: c.textDim,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  // Bell notif panel
  notifPanel: { width: 340 },
  markAllBtn: { flex: 1, marginLeft: 8 },
  markAllText: { fontSize: 11, fontWeight: '600' },

  // Notification items (Google Classroom style)
  notifItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  notifIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  notifItemTitle: { fontSize: 13, fontWeight: '600', color: c.textMain, lineHeight: 18 },
  notifSender: { fontSize: 12, fontWeight: '600', color: c.textMain },
  notifPreview: { fontSize: 12, color: c.textMuted, marginTop: 2, lineHeight: 17 },
  notifTime: { fontSize: 10, color: c.textDim, marginTop: 3 },
  notifUnreadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: c.primary, alignSelf: 'center', flexShrink: 0, marginLeft: 4,
  },
  noNotifState: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  noNotifText: { fontSize: 14, fontWeight: '600', color: c.textMain, marginTop: 4 },

  // Profile dropdown
  profilePhotoRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  profilePhotoWrap: { position: 'relative', width: 64, height: 64 },
  profileCameraBtn: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: c.primary, borderWidth: 2, borderColor: c.cardDark,
    alignItems: 'center', justifyContent: 'center',
  },
  profileName: { fontSize: 15, fontWeight: '700', color: c.textMain, marginBottom: 2 },
  profileRole: { fontSize: 12, color: c.textMuted, textTransform: 'capitalize', marginBottom: 4 },
  curriculumBadge: {
    alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 10, backgroundColor: c.primaryGlow, borderWidth: 1, borderColor: c.primary,
  },
  curriculumBadgeText: { fontSize: 10, fontWeight: '700', color: c.primary },
  profileInfoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: spacing.lg, paddingVertical: 6,
  },
  profileInfoText: { fontSize: 12, color: c.textMuted, flex: 1 },
  profileEditSection: {
    padding: spacing.md, borderTopWidth: 1, borderTopColor: c.borderColor, marginTop: 4,
  },
  editNameBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editNameText: { fontSize: 13, color: c.primary, fontWeight: '600' },
  nameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: {
    flex: 1, height: 36, backgroundColor: c.bgDark,
    borderWidth: 1, borderColor: c.primary, borderRadius: radius.sm,
    paddingHorizontal: 10, fontSize: 13, color: c.textMain,
  },
  nameSaveBtn: {
    width: 32, height: 32, borderRadius: radius.sm,
    backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center',
  },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: c.accentRed + '14',
    borderWidth: 1,
    borderColor: c.accentRed + '30',
  },
  logoutBtnText: { fontSize: 14, fontWeight: '700' },
});
