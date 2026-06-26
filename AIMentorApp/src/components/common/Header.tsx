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
          style={[styles.iconBtn, { borderColor: colors.accentYellow + '50', backgroundColor: colors.accentYellow + '12' }]}
          onPress={() => {
            setBellVisible(prev => !prev);
            onNotificationPress?.();
          }}
          activeOpacity={0.7}
        >
          <Feather name="bell" size={18} color={count > 0 ? colors.accentYellow : colors.accentYellow + 'AA'} />
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
                <View style={[styles.dropdownHeader, { borderBottomColor: colors.accentYellow + '30' }]}>
                  <Text style={[styles.dropdownTitle, { color: colors.accentYellow }]}>Notifications</Text>
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
                      <Text style={[styles.markAllText, { color: colors.accentYellow }]}>Mark all read</Text>
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
                      const accent = isChallenge ? colors.accentYellow : colors.accentYellow;
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
                        <View style={[styles.notifIconWrap, { backgroundColor: colors.accentYellow + '22' }]}>
                          <Feather name="message-square" size={16} color={colors.accentYellow} />
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
                        <View style={[styles.notifIconWrap, { backgroundColor: colors.accentYellow + '22' }]}>
                          <Feather name="award" size={16} color={colors.accentYellow} />
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
                        <View style={[styles.notifIconWrap, { backgroundColor: colors.accentYellow + '22' }]}>
                          <Feather name="check-square" size={16} color={colors.accentYellow} />
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
                    <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accentYellow + '15', borderWidth: 1, borderColor: colors.accentYellow + '30', alignItems: 'center', justifyContent: 'center' }}>
                      <Feather name="bell-off" size={24} color={colors.accentYellow} />
                    </View>
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
            style={[styles.iconBtn, { borderColor: colors.accentYellow, backgroundColor: colors.accentYellow + '18' }]}
            onPress={() => {
              const email = encodeURIComponent(user.email || '');
              if (Platform.OS === 'web') {
                (window as any).open(`${SERVER_URL}/admin/panel?email=${email}`, '_blank');
              }
            }}
            activeOpacity={0.7}
          >
            <Feather name="shield" size={16} color={colors.accentYellow} />
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

        {/* Profile modal — redesigned */}
        <Modal visible={profileVisible} transparent animationType="fade" onRequestClose={() => { setProfileVisible(false); setEditingName(false); }}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => { setProfileVisible(false); setEditingName(false); }}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <View style={styles.profileModal}>

                {/* Title row */}
                <View style={styles.profileModalHeader}>
                  <View>
                    <Text style={styles.profileModalTitle}>
                      <Text style={{ color: colors.textMain }}>My </Text>
                      <Text style={{ color: colors.accentYellow }}>Profile</Text>
                    </Text>
                    <Text style={styles.profileModalSub}>Manage your account and preferences</Text>
                  </View>
                  <TouchableOpacity style={styles.profileCloseBtn} onPress={() => { setProfileVisible(false); setEditingName(false); }} activeOpacity={0.7}>
                    <Feather name="x" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                {/* Avatar + name row */}
                <View style={styles.profileAvatarRow}>
                  <TouchableOpacity style={styles.profileAvatarWrap} onPress={handlePickPhoto} activeOpacity={0.85} disabled={uploadingPhoto}>
                    <View style={styles.profileAvatarRing}>
                      {renderAvatarCircle(80)}
                    </View>
                    <View style={styles.profileCameraBtn}>
                      {uploadingPhoto
                        ? <ActivityIndicator size={12} color={colors.accentYellow} />
                        : <Feather name="camera" size={12} color={colors.accentYellow} />
                      }
                    </View>
                  </TouchableOpacity>
                  <View style={{ gap: 4 }}>
                    <Text style={styles.profileName} numberOfLines={1}>{user?.name}</Text>
                    <Text style={styles.profileRole}>{user?.role}</Text>
                    {user?.curriculum && (
                      <View style={styles.premiumBadge}>
                        <Text style={styles.premiumBadgeText}>{user.curriculum}</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Info rows */}
                <View style={styles.profileInfoCards}>
                  <View style={styles.profileInfoCard}>
                    <Feather name="mail" size={15} color={colors.accentYellow} />
                    <Text style={styles.profileInfoCardText} numberOfLines={1}>{user?.email}</Text>
                  </View>
                  {(user?.location || user?.school) && (
                    <View style={styles.profileInfoCard}>
                      <Feather name="map-pin" size={15} color={colors.accentYellow} />
                      <Text style={styles.profileInfoCardText} numberOfLines={1}>{user?.location || user?.school}</Text>
                    </View>
                  )}
                </View>

                {/* Edit display name */}
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
                      <Feather name="check" size={14} color="#0B0B0B" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setEditingName(false)} activeOpacity={0.8}>
                      <Feather name="x" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.editNameCard}
                    onPress={() => { setNameInput(user?.name || ''); setEditingName(true); }}
                    activeOpacity={0.8}
                  >
                    <Feather name="edit-2" size={15} color={colors.accentYellow} />
                    <Text style={styles.editNameText}>Edit display name</Text>
                    <Feather name="chevron-right" size={15} color={colors.accentYellow} style={{ marginLeft: 'auto' as any }} />
                  </TouchableOpacity>
                )}

                {/* Logout */}
                <TouchableOpacity
                  style={styles.logoutBtn}
                  onPress={() => { setProfileVisible(false); logout(); }}
                  activeOpacity={0.85}
                >
                  <Feather name="log-out" size={16} color="#0B0B0B" />
                  <Text style={[styles.logoutBtnText, { color: '#0B0B0B' }]}>Log Out</Text>
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
    backgroundColor: c.accentYellow + '12', borderWidth: 2, borderColor: c.accentYellow + '50',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },

  // Shared dropdown shell
  modalBackdrop: {
    flex: 1, alignItems: 'flex-end', justifyContent: 'flex-start',
    paddingTop: 68, paddingRight: 16,
  },
  dropdown: {
    width: 290, backgroundColor: c.cardDark,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.accentYellow + '35',
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
    backgroundColor: c.accentYellow, alignSelf: 'center', flexShrink: 0, marginLeft: 4,
  },
  noNotifState: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  noNotifText: { fontSize: 14, fontWeight: '600', color: c.textMain, marginTop: 4 },

  // Profile modal redesign
  profileModal: {
    width: 340, backgroundColor: c.cardDark,
    borderRadius: 18, borderWidth: 1, borderColor: c.borderColor,
    padding: spacing.lg, gap: spacing.md,
    shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 24, elevation: 20,
  },
  profileModalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
  },
  profileModalTitle: { fontSize: 18, fontWeight: '800' },
  profileModalSub: { fontSize: 11, color: c.textDim, marginTop: 2 },
  profileCloseBtn: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1, borderColor: c.borderColor,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.bgDark,
  },
  profileAvatarRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
  },
  profileAvatarWrap: { position: 'relative', width: 72, height: 72 },
  profileAvatarRing: {
    width: 68, height: 68, borderRadius: 34,
    borderWidth: 2, borderColor: c.accentYellow,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  profileCameraBtn: {
    position: 'absolute', bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: c.cardDark, borderWidth: 1.5, borderColor: c.accentYellow + '60',
    alignItems: 'center', justifyContent: 'center',
  },
  profileName: { fontSize: 16, fontWeight: '800', color: c.textMain },
  profileRole: { fontSize: 12, color: c.accentYellow, textTransform: 'capitalize' },
  premiumBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 20, backgroundColor: c.bgDark,
    borderWidth: 1, borderColor: c.accentYellow + '40',
  },
  premiumBadgeText: { fontSize: 10, fontWeight: '600', color: c.accentYellow },
  profileInfoCards: { gap: 6 },
  profileInfoCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: c.bgDark, borderRadius: 12,
    borderWidth: 1, borderColor: c.borderColor,
    paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  profileInfoCardText: { fontSize: 12, color: c.textMain, flex: 1 },
  editNameCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: c.bgDark, borderRadius: 12,
    borderWidth: 1, borderColor: c.accentYellow + '40',
    paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  editNameText: { fontSize: 12, color: c.accentYellow, fontWeight: '600', flex: 1 },
  nameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: {
    flex: 1, height: 40, backgroundColor: c.bgDark,
    borderWidth: 1, borderColor: c.accentYellow + '50', borderRadius: 12,
    paddingHorizontal: spacing.md, fontSize: 13, color: c.textMain,
  },
  nameSaveBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: c.accentYellow, alignItems: 'center', justifyContent: 'center',
  },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 12,
    backgroundColor: c.accentYellow,
  },
  logoutBtnText: { fontSize: 13, fontWeight: '700' },
});
