import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, radius, typography } from '../../theme';
import type { AppColors } from '../../theme';
import { useAuth, setPendingReturnRole } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeMode } from '../../context/ThemeContext';
import { useNotification } from '../../context/NotificationContext';
import { getAvatarGradient, getAvatarIcon } from '../../constants/avatarStyles';

const STUDENT_NAV_ITEMS = [
  { label: 'Dashboard', icon: 'grid', screen: 'Dashboard', group: 'MENU' },
  { label: 'Profile', icon: 'user', screen: 'Profile', group: 'MENU' },
  { label: 'My Learning Paths', icon: 'book-open', screen: 'LearningPaths', group: 'MENU' },
  { label: 'AI Coach', icon: 'message-circle', screen: 'AICoach', group: 'MENU' },
  { label: 'Schedule', icon: 'calendar', screen: 'Schedule', group: 'MENU' },
  { label: 'The World & You', icon: 'globe', screen: 'WorldAndYou', group: 'MENU' },
  { label: 'Read Aloud', icon: 'mic', screen: 'ReadAloud', group: 'MENU' },
  { label: 'Bedtime Stories', icon: 'book', screen: 'BhagavathaStories', group: 'MENU', premium: true },
  { label: 'Daily Habits', icon: 'sun', screen: 'DailyHabits', group: 'MENU', premium: true },
  { label: 'Assignments', icon: 'check-square', screen: 'Assignments', group: 'FOCUS', premium: false },
  { label: 'Challenges', icon: 'target', screen: 'Challenges', group: 'FOCUS', premium: true },
  { label: 'Leaderboard', icon: 'award', screen: 'Leaderboard', group: 'FOCUS' },
  { label: 'Progress', icon: 'bar-chart-2', screen: 'Progress', group: 'FOCUS' },
  { label: 'Rewards', icon: 'gift', screen: 'Rewards', group: 'FOCUS' },
  { label: 'Help Center', icon: 'help-circle', screen: 'HelpCenter', group: 'SYSTEM' },
  { label: 'Settings', icon: 'settings', screen: 'Settings', group: 'SYSTEM' },
];

const PARENT_NAV_ITEMS = [
  { label: 'Dashboard', icon: 'grid', screen: 'ParentDashboard', group: 'PARENT MENU' },
  { label: 'Profile', icon: 'user', screen: 'ParentProfile', group: 'PARENT MENU' },
  { label: 'My Kids', icon: 'users', screen: 'ParentMyKids', group: 'PARENT MENU' },
  { label: 'Daily Tasks', icon: 'check-square', screen: 'ParentDailyTasks', group: 'PARENT MENU' },
  { label: 'Schedule', icon: 'calendar', screen: 'ParentSchedule', group: 'PARENT MENU' },
  { label: 'Learning', icon: 'book-open', screen: 'ParentLearning', group: 'PARENT MENU' },
  { label: 'Assignments', icon: 'check-square', screen: 'ParentAssignments', group: 'PARENT MENU' },
  { label: 'Challenges', icon: 'target', screen: 'ParentChallenges', group: 'PARENT MENU' },
  { label: 'Progress & Reports', icon: 'bar-chart-2', screen: 'ParentProgress', group: 'PARENT MENU' },
  { label: 'Messages', icon: 'message-square', screen: 'ParentMessages', group: 'PARENT MENU' },
  { label: 'Parental Controls', icon: 'shield', screen: 'ParentControls', group: 'CONTROLS' },
  { label: 'Settings', icon: 'settings', screen: 'ParentSettings', group: 'SYSTEM' },
  { label: 'Help Centre', icon: 'help-circle', screen: 'ParentHelp', group: 'SYSTEM' },
];

const TEACHER_NAV_ITEMS = [
  { label: 'Dashboard', icon: 'grid', screen: 'TeacherDashboard', group: 'MENU' },
  { label: 'Students', icon: 'users', screen: 'TeacherStudents', group: 'MENU' },
  { label: 'Assignments', icon: 'check-square', screen: 'TeacherAssignments', group: 'MENU' },
  { label: 'Challenges', icon: 'target', screen: 'TeacherChallenges', group: 'MENU' },
  { label: 'Schedule', icon: 'calendar', screen: 'TeacherSchedule', group: 'MENU' },
  { label: 'Student Progress', icon: 'bar-chart-2', screen: 'TeacherProgress', group: 'MENU' },
  { label: 'Messages', icon: 'message-square', screen: 'TeacherMessages', group: 'MENU' },
  { label: 'Learning Paths', icon: 'map', screen: 'TeacherLearningPaths', group: 'TEACHING DEVELOPMENT' },
  { label: 'Achievements', icon: 'award', screen: 'TeacherAchievements', group: 'TEACHING DEVELOPMENT' },
  { label: 'Project Details', icon: 'activity', screen: 'ProjectDetails', group: 'SYSTEM' },
  { label: 'Help Center', icon: 'help-circle', screen: 'TeacherHelp', group: 'SYSTEM' },
  { label: 'Settings', icon: 'settings', screen: 'TeacherSettings', group: 'SYSTEM' },
];

const THEME_OPTIONS: { id: ThemeMode; icon: string; label: string }[] = [
  { id: 'dark', icon: 'moon', label: 'Dark' },
  { id: 'light', icon: 'sun', label: 'Light' },
  { id: 'auto', icon: 'monitor', label: 'Auto' },
];

const SUPER_ADMIN_NAV_ITEMS = [
  { label: 'Dashboard',         icon: 'grid',           screen: 'TeacherDashboard',    group: 'MENU' },
  { label: 'Student Manager',   icon: 'users',          screen: 'SuperAdminStudents',  group: 'MENU' },
  { label: 'Assignments',       icon: 'check-square',   screen: 'TeacherAssignments',  group: 'MENU' },
  { label: 'Challenges',        icon: 'target',         screen: 'TeacherChallenges',   group: 'MENU' },
  { label: 'Challenge Manager', icon: 'shield',         screen: 'ChallengeManager',    group: 'MENU' },
  { label: 'Staff Subjects',    icon: 'book-open',      screen: 'StaffSubjectMapping', group: 'MENU' },
  { label: 'Schedule',          icon: 'calendar',       screen: 'TeacherSchedule',     group: 'MENU' },
  { label: 'Student Progress',  icon: 'bar-chart-2',    screen: 'TeacherProgress',     group: 'MENU' },
  { label: 'Messages',          icon: 'message-square', screen: 'TeacherMessages',     group: 'MENU' },
  { label: 'Learning Paths',    icon: 'map',            screen: 'TeacherLearningPaths',group: 'SYSTEM' },
  { label: 'Settings',          icon: 'settings',       screen: 'TeacherSettings',     group: 'SYSTEM' },
];

const ROLE_DASH: Record<string, string> = { super_admin: 'ChallengeManager', teacher: 'TeacherDashboard', parent: 'ParentDashboard', student: 'Dashboard' };
export default function DrawerContent(props: any) {
  const { state, navigation } = props;
  const currentRoute = state.routes[state.index]?.name;
  const { logout, user, switchRole, updateUser } = useAuth();
  const [showHomeConfirm, setShowHomeConfirm] = useState(false);
  const isDualRole = (user?.roles?.length ?? 0) > 1;
  const { colors, themeMode, setThemeMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const isSuperAdmin = user?.role === 'super_admin';
  const isTeacher = user?.role === 'teacher';
  const isParent = user?.role === 'parent';
  const NAV_ITEMS = isSuperAdmin ? SUPER_ADMIN_NAV_ITEMS : isTeacher ? TEACHER_NAV_ITEMS : isParent ? PARENT_NAV_ITEMS : STUDENT_NAV_ITEMS;
  const groups = (isSuperAdmin || isTeacher) ? ['MENU', 'TEACHING DEVELOPMENT', 'SYSTEM'] : isParent ? ['PARENT MENU', 'CONTROLS', 'SYSTEM'] : ['MENU', 'FOCUS', 'SYSTEM'];
  const { unreadCount, unreadAssignments, unreadChallenges } = useNotification();
  const MESSAGE_SCREENS    = ['TeacherMessages', 'ParentMessages', 'Messages'];
  const ASSIGNMENT_SCREENS = ['Assignments', 'ParentAssignments'];
  const CHALLENGE_SCREENS  = ['Challenges', 'ParentChallenges'];

  return (
    <View style={styles.container}>
      {/* Logo */}
      <TouchableOpacity style={styles.logo} activeOpacity={0.7} onPress={() => setShowHomeConfirm(true)}>
        <View style={styles.logoMark}>
          <Feather name="zap" size={18} color="white" />
        </View>
        <Text style={styles.logoText}>Aivorah</Text>
      </TouchableOpacity>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {groups.map((group) => {
          const items = NAV_ITEMS.filter((i) => i.group === group);
          return (
            <View key={group} style={styles.navGroup}>
              <Text style={styles.navLabel}>{group}</Text>
              {items.map((item) => {
                const isActive = currentRoute === item.screen;
                return (
                  <TouchableOpacity
                    key={item.screen}
                    style={[styles.navItem, isActive && styles.navItemActive]}
                    onPress={() => navigation.navigate(item.screen)}
                    activeOpacity={0.7}
                  >
                    {isActive && <View style={styles.activeBar} />}
                    <Feather
                      name={item.icon as any}
                      size={17}
                      color={isActive ? colors.primary : colors.textMuted}
                    />
                    <Text
                      style={[
                        styles.navItemText,
                        isActive && styles.navItemTextActive,
                      ]}
                    >
                      {item.label}
                    </Text>
                    {MESSAGE_SCREENS.includes(item.screen) && unreadCount > 0 && (
                      <View style={styles.navBadge}>
                        <Text style={styles.navBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                      </View>
                    )}
                    {ASSIGNMENT_SCREENS.includes(item.screen) && unreadAssignments > 0 && (
                      <View style={styles.navBadge}>
                        <Text style={styles.navBadgeText}>{unreadAssignments > 9 ? '9+' : unreadAssignments}</Text>
                      </View>
                    )}
                    {CHALLENGE_SCREENS.includes(item.screen) && unreadChallenges > 0 && (
                      <View style={styles.navBadge}>
                        <Text style={styles.navBadgeText}>{unreadChallenges > 9 ? '9+' : unreadChallenges}</Text>
                      </View>
                    )}
                    {(item as any).premium && (
                      <View style={styles.premiumIndicator}>
                        {!(user as any)?.isPro && (
                          <Feather name="lock" size={9} color="#C5A56A" style={{ marginRight: 3 }} />
                        )}
                        {(user as any)?.isPro && (
                          <Feather name="star" size={9} color="#C5A56A" style={{ marginRight: 3 }} />
                        )}
                        <Text style={styles.premiumIndicatorText}>PRO</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      {/* User + Logout */}
      <View style={styles.footer}>
        <View style={styles.themeBlock}>
          <Text style={styles.themeLabel}>Theme</Text>
          <View style={styles.themeRow}>
            {THEME_OPTIONS.map((opt) => {
              const isActive = themeMode === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.themeOption, isActive && styles.themeOptionActive]}
                  onPress={() => setThemeMode(opt.id)}
                  activeOpacity={0.7}
                >
                  <Feather name={opt.icon as any} size={12} color={isActive ? colors.primary : colors.textMuted} />
                  <Text style={[styles.themeOptionText, isActive && styles.themeOptionTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Role switcher — only for dual-role users (teacher+parent) */}
        {isDualRole && user?.roles && (
          <View style={styles.roleSwitcher}>
            <Text style={styles.roleSwitcherLabel}>Switch Profile</Text>
            <View style={styles.roleSwitcherRow}>
              {user.roles.map((r) => {
                const isActive = user.role === r;
                return (
                  <TouchableOpacity
                    key={r}
                    style={[styles.rolePill, isActive && styles.rolePillActive]}
                    onPress={() => { switchRole(r); setTimeout(() => { try { navigation.navigate(ROLE_DASH[r] ?? 'Dashboard'); } catch (_) {} }, 50); }}
                    activeOpacity={0.75}
                  >
                    <Feather name={r === 'teacher' ? 'briefcase' : 'home'} size={12} color={isActive ? colors.primary : colors.textMuted} />
                    <Text style={[styles.rolePillText, isActive && styles.rolePillTextActive]}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Add Parent Profile hint — shown to teachers without parent profile */}
        {user?.role === 'teacher' && !isDualRole && (
          <TouchableOpacity
            style={styles.addParentHint}
            onPress={() => {
              setPendingReturnRole('teacher');
              updateUser({ role: 'parent', onboardingComplete: false } as any);
              navigation.navigate('Onboarding');
            }}
            activeOpacity={0.8}
          >
            <View style={styles.addParentHintIcon}>
              <Feather name="home" size={11} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.addParentHintTitle}>Also a parent?</Text>
              <Text style={styles.addParentHintSub}>Add your parent profile</Text>
            </View>
            <Feather name="chevron-right" size={12} color={colors.textDim} />
          </TouchableOpacity>
        )}

        {user && (
          <View style={styles.userRow}>
            <View style={styles.userAvatar}>
              {(user as any).photoUrl ? (
                <Image source={{ uri: (user as any).photoUrl }} style={styles.userAvatarImg} />
              ) : (user as any).avatarStyle ? (
                <LinearGradient
                  colors={getAvatarGradient((user as any).avatarStyle)}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={[styles.userAvatarImg, { alignItems: 'center', justifyContent: 'center' }]}
                >
                  <Feather name={getAvatarIcon((user as any).avatarStyle) as any} size={14} color="white" />
                </LinearGradient>
              ) : (
                <Feather name="user" size={14} color={colors.textMuted} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName} numberOfLines={1}>{user.name}</Text>
              <Text style={styles.userRole}>{user.role}</Text>
            </View>
          </View>
        )}
        <TouchableOpacity style={styles.navItem} onPress={logout} activeOpacity={0.7}>
          <Feather name="log-out" size={17} color={colors.accentRed} />
          <Text style={[styles.navItemText, { color: colors.accentRed }]}>Logout</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showHomeConfirm} transparent animationType="fade" onRequestClose={() => setShowHomeConfirm(false)}>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmLogoRow}>
              <View style={styles.logoMark}>
                <Feather name="zap" size={18} color="white" />
              </View>
              <Text style={styles.confirmBrand}>Aivorah</Text>
            </View>
            <Text style={styles.confirmTitle}>Leave to Home?</Text>
            <Text style={styles.confirmSub}>You'll be taken back to the Aivorah landing page and signed out.</Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setShowHomeConfirm(false)} activeOpacity={0.8}>
                <Text style={styles.confirmCancelText}>Stay</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmGo} onPress={() => { setShowHomeConfirm(false); logout(); }} activeOpacity={0.8}>
                <Feather name="home" size={14} color="#fff" />
                <Text style={styles.confirmGoText}>Go to Home</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.sidebarDark,
    paddingHorizontal: spacing.lg,
    paddingTop: 56,
    paddingBottom: spacing.xl,
    borderRightWidth: 1,
    borderRightColor: c.borderColor,
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 36,
    paddingLeft: spacing.md,
  },
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: c.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 18,
    fontWeight: '700',
    color: 'white',
    letterSpacing: -0.3,
  },
  navGroup: {
    marginBottom: 28,
  },
  navLabel: {
    ...typography.label,
    color: c.textDim,
    marginBottom: spacing.md,
    paddingLeft: spacing.md,
    textTransform: 'uppercase',
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    marginBottom: 2,
    position: 'relative',
  },
  navItemActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: 6,
    bottom: 6,
    width: 3,
    backgroundColor: c.primary,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  navItemText: {
    fontSize: 14,
    fontWeight: '500',
    color: c.textMuted,
  },
  navItemTextActive: {
    color: c.primary,
  },
  navBadge: {
    marginLeft: 'auto',
    backgroundColor: c.primary,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  navBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  premiumIndicator: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8,
    backgroundColor: '#C5A56A18', borderWidth: 1, borderColor: '#C5A56A40',
    marginLeft: 'auto',
  },
  premiumIndicatorText: {
    fontSize: 8, fontWeight: '800', color: '#C5A56A',
    letterSpacing: 0.6,
  },
  addParentHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: c.primary + '50',
    backgroundColor: c.primaryGlow,
  },
  addParentHintIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: c.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addParentHintTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: c.primary,
  },
  addParentHintSub: {
    fontSize: 10,
    color: c.textDim,
    marginTop: 1,
  },
  roleSwitcher: {
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  roleSwitcherLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: c.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  roleSwitcherRow: {
    flexDirection: 'row',
    gap: 6,
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.borderColor,
    backgroundColor: c.cardDark,
  },
  rolePillActive: {
    borderColor: c.primary,
    backgroundColor: c.primaryGlow,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: c.textMuted,
  },
  rolePillTextActive: {
    color: c.primary,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: c.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  userAvatarImg: { width: 32, height: 32, borderRadius: 16 },
  userName: { fontSize: 13, fontWeight: '600', color: c.textMain },
  userRole: { fontSize: 11, color: c.textDim, textTransform: 'capitalize' },
  footer: {
    borderTopWidth: 1,
    borderTopColor: c.borderColor,
    paddingTop: spacing.lg,
    marginTop: spacing.lg,
  },
  themeBlock: {
    marginBottom: spacing.md,
  },
  themeLabel: {
    ...typography.smallBold,
    color: c.textMuted,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  themeRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  themeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.borderColor,
    backgroundColor: c.cardDark,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  themeOptionActive: {
    borderColor: c.primary,
    backgroundColor: c.primaryGlow,
  },
  themeOptionText: {
    fontSize: 11,
    fontWeight: '600',
    color: c.textMuted,
  },
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  confirmCard: { backgroundColor: c.cardDark, borderRadius: 20, borderWidth: 1, borderColor: c.borderColor, padding: 28, width: '100%', maxWidth: 360, gap: 12 },
  confirmLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  confirmBrand: { fontSize: 18, fontWeight: '800', color: c.textMain, letterSpacing: -0.3 },
  confirmTitle: { fontSize: 20, fontWeight: '700', color: c.textMain },
  confirmSub: { fontSize: 13, color: c.textMuted, lineHeight: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  confirmCancel: { flex: 1, borderWidth: 1, borderColor: c.borderColor, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  confirmCancelText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
  confirmGo: { flex: 1, backgroundColor: c.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  confirmGoText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  themeOptionTextActive: {
    color: c.primary,
  },
});
