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

interface HeaderProps {
  title: string;
  subtitle?: string;
  searchPlaceholder?: string;
  showSearch?: boolean;
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
  onMenuPress,
  onSearchChange,
  onNotificationPress,
  notificationCount = 0,
}: HeaderProps) {
  const { isMobile } = useResponsive();
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    unreadCount,
    unreadAssignments,
    unreadChallenges,
    latestNotif,
                clearUnread,
                clearUnreadAssignments,
                clearUnreadChallenges,
  } = useNotification();
  const { user, updateUser } = useAuth();

  // Resolve screen names based on user role
  const role = user?.role ?? 'student';
  const screenNames = useMemo(() => ({
    assignments: role === 'teacher' ? 'TeacherAssignments' : role === 'parent' ? 'ParentAssignments' : 'Assignments',
    messages:    role === 'teacher' ? 'TeacherMessages'    : role === 'parent' ? 'ParentMessages'    : 'Dashboard',
    challenges:  role === 'teacher' ? 'TeacherChallenges'  : role === 'parent' ? 'ParentChallenges'  : 'Challenges',
  }), [role]);

  const [bellVisible, setBellVisible] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);

  // Snapshot of notifications at the moment the bell was opened
  const [snapUnreadCount, setSnapUnreadCount] = useState(0);
  const [snapUnreadAssignments, setSnapUnreadAssignments] = useState(0);
  const [snapUnreadChallenges, setSnapUnreadChallenges] = useState(0);
  const [snapLatestNotif, setSnapLatestNotif] = useState<any>(null);
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
        {isMobile && (
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
            setBellVisible(prev => {
              const next = !prev;
              if (next) {
                // Snapshot current state BEFORE clearing so panel can display it
                setSnapUnreadCount(unreadCount);
                setSnapUnreadAssignments(unreadAssignments);
                setSnapUnreadChallenges(unreadChallenges);
                setSnapLatestNotif(latestNotif);
                // Clear badges immediately
                void clearUnread();
                void clearUnreadAssignments();
                void clearUnreadChallenges();
              }
              return next;
            });
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

        {/* Bell dropdown */}
        <Modal visible={bellVisible} transparent animationType="none" onRequestClose={() => setBellVisible(false)}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setBellVisible(false)}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <View style={styles.dropdown}>
                <View style={styles.dropdownHeader}>
                  <Text style={styles.dropdownTitle}>Notifications</Text>
                  <TouchableOpacity onPress={() => setBellVisible(false)} activeOpacity={0.7}>
                    <Feather name="x" size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                {/* Scrollable notification list using snapshot */}
                {(snapUnreadAssignments > 0 || snapUnreadChallenges > 0 || snapUnreadCount > 0) ? (
                  <View style={{ maxHeight: 320 }}>
                    <View
                      // @ts-ignore — web-only style
                      style={{ overflowY: 'auto', maxHeight: 320 } as any}
                    >
                      {snapUnreadAssignments > 0 && (
                        <TouchableOpacity style={styles.notifItem} activeOpacity={0.7} onPress={() => { setBellVisible(false); navigation.navigate(screenNames.assignments); }}>
                          <View style={styles.notifIconWrap}>
                            <Feather name="check-square" size={14} color={colors.primary} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.notifSender}>
                              {snapUnreadAssignments === 1
                                ? 'You have a new assignment'
                                : `You have ${snapUnreadAssignments} new assignments`}
                            </Text>
                            <Text style={styles.notifPreview} numberOfLines={1}>Tap to view</Text>
                          </View>
                          <Feather name="chevron-right" size={14} color={colors.textDim} />
                        </TouchableOpacity>
                      )}
                      {snapUnreadChallenges > 0 && (
                        <TouchableOpacity style={styles.notifItem} activeOpacity={0.7} onPress={() => { setBellVisible(false); navigation.navigate(screenNames.challenges, { tab: 'assigned' }); }}>
                          <View style={styles.notifIconWrap}>
                            <Feather name="award" size={14} color={colors.accentPurple} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.notifSender}>
                              {snapUnreadChallenges === 1
                                ? 'You have a new challenge'
                                : `You have ${snapUnreadChallenges} new challenges`}
                            </Text>
                            <Text style={styles.notifPreview} numberOfLines={1}>Tap to view</Text>
                          </View>
                          <Feather name="chevron-right" size={14} color={colors.textDim} />
                        </TouchableOpacity>
                      )}
                      {snapLatestNotif && snapUnreadCount > 0 ? (
                        <TouchableOpacity style={styles.notifItem} activeOpacity={0.7} onPress={() => { setBellVisible(false); navigation.navigate(screenNames.messages); }}>
                          <View style={styles.notifIconWrap}>
                            <Feather name="message-square" size={14} color={colors.primary} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.notifSender}>
                              New message from <Text style={{ color: colors.primary }}>{snapLatestNotif.senderName}</Text>
                            </Text>
                            <Text style={styles.notifPreview} numberOfLines={2}>{snapLatestNotif.preview}</Text>
                            <Text style={styles.notifTime}>{new Date(snapLatestNotif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                          </View>
                          <Feather name="chevron-right" size={14} color={colors.textDim} />
                        </TouchableOpacity>
                      ) : snapUnreadCount > 0 ? (
                        <TouchableOpacity style={styles.notifItem} activeOpacity={0.7} onPress={() => { setBellVisible(false); navigation.navigate(screenNames.messages); }}>
                          <View style={styles.notifIconWrap}>
                            <Feather name="message-square" size={14} color={colors.primary} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.notifSender}>
                              {snapUnreadCount === 1 ? 'You have 1 unread message' : `You have ${snapUnreadCount} unread messages`}
                            </Text>
                            <Text style={styles.notifPreview} numberOfLines={1}>Tap to view</Text>
                          </View>
                          <Feather name="chevron-right" size={14} color={colors.textDim} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <View style={[styles.notifFooter, { borderTopWidth: 1, borderTopColor: colors.borderColor }]}>
                      <Feather name="check-circle" size={12} color={colors.textDim} />
                      <Text style={styles.notifFooterText}>All caught up — marked as read</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.noNotifState}>
                    <Feather name="bell-off" size={22} color={colors.textDim} />
                    <Text style={styles.noNotifText}>No new notifications</Text>
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

  // Bell notif items
  notifItem: { flexDirection: 'row', gap: spacing.md, padding: spacing.md },
  notifIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: c.primaryGlow, alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  notifSender: { fontSize: 12, fontWeight: '600', color: c.textMain },
  notifPreview: { fontSize: 12, color: c.textMuted, marginTop: 2, lineHeight: 17 },
  notifTime: { fontSize: 10, color: c.textDim, marginTop: 3 },
  noNotifState: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  noNotifText: { fontSize: 13, color: c.textDim },
  notifReadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: c.primary, alignSelf: 'flex-start', marginTop: 6,
  },
  notifFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  notifFooterText: { fontSize: 11, color: c.textDim },

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
});
