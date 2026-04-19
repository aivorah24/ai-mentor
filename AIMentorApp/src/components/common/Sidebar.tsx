import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, radius, typography } from '../../theme';
import type { AppColors } from '../../theme';
import { useAuth } from '../../context/AuthContext';
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
  { label: 'Bedtime Stories', icon: 'book', screen: 'BhagavathaStories', group: 'MENU' },
  { label: 'Daily Habits', icon: 'sun', screen: 'DailyHabits', group: 'MENU' },
  { label: 'Assignments', icon: 'check-square', screen: 'Assignments', group: 'FOCUS' },
  { label: 'Challenges', icon: 'target', screen: 'Challenges', group: 'FOCUS' },
  { label: 'Leaderboard', icon: 'award', screen: 'Leaderboard', group: 'FOCUS' },
  { label: 'Progress', icon: 'bar-chart-2', screen: 'Progress', group: 'FOCUS' },
  { label: 'Rewards', icon: 'gift', screen: 'Rewards', group: 'FOCUS' },
  { label: 'Help Center', icon: 'help-circle', screen: 'HelpCenter', group: 'SYSTEM' },
  { label: 'Settings', icon: 'settings', screen: 'Settings', group: 'SYSTEM' },
];

const TEACHER_NAV_ITEMS = [
  { label: 'Dashboard', icon: 'grid', screen: 'TeacherDashboard', group: 'MENU' },
  { label: 'Students', icon: 'users', screen: 'TeacherStudents', group: 'MENU' },
  { label: 'Schedule', icon: 'calendar', screen: 'TeacherSchedule', group: 'MENU' },
  { label: 'Assignments', icon: 'check-square', screen: 'TeacherAssignments', group: 'MANAGE' },
  { label: 'Challenges', icon: 'target', screen: 'TeacherChallenges', group: 'MANAGE' },
  { label: 'Student Progress', icon: 'bar-chart-2', screen: 'TeacherProgress', group: 'MANAGE' },
  { label: 'Learning Paths', icon: 'map', screen: 'TeacherLearningPaths', group: 'MANAGE' },
  { label: 'Messages', icon: 'message-square', screen: 'TeacherMessages', group: 'MANAGE' },
  { label: 'Settings', icon: 'settings', screen: 'TeacherSettings', group: 'SYSTEM' },
];

const PARENT_NAV_ITEMS = [
  { label: 'Dashboard', icon: 'grid', screen: 'ParentDashboard', group: 'MENU' },
  { label: 'Profile', icon: 'user', screen: 'ParentProfile', group: 'MENU' },
  { label: 'My Kids', icon: 'users', screen: 'ParentMyKids', group: 'MENU' },
  { label: 'Schedule', icon: 'calendar', screen: 'ParentSchedule', group: 'MENU' },
  { label: 'Learning', icon: 'book-open', screen: 'ParentLearning', group: 'CHILDREN' },
  { label: 'Assignments', icon: 'check-square', screen: 'ParentAssignments', group: 'CHILDREN' },
  { label: 'Progress', icon: 'bar-chart-2', screen: 'ParentProgress', group: 'CHILDREN' },
  { label: 'Challenges', icon: 'target', screen: 'ParentChallenges', group: 'CHILDREN' },
  { label: 'Messages', icon: 'message-square', screen: 'ParentMessages', group: 'CHILDREN' },
  { label: 'Help', icon: 'help-circle', screen: 'ParentHelp', group: 'SYSTEM' },
  { label: 'Settings', icon: 'settings', screen: 'ParentSettings', group: 'SYSTEM' },
];

const THEME_OPTIONS: { id: ThemeMode; icon: string; label: string }[] = [
  { id: 'dark', icon: 'moon', label: 'Dark' },
  { id: 'light', icon: 'sun', label: 'Light' },
  { id: 'auto', icon: 'monitor', label: 'Auto' },
];

interface SidebarProps {
  currentScreen: string;
  onNavigate: (screen: string) => void;
}

const ROLE_DASH: Record<string, string> = { teacher: 'TeacherDashboard', parent: 'ParentDashboard', student: 'Dashboard' };

export default function Sidebar({ currentScreen, onNavigate }: SidebarProps) {
  const { logout, user, switchRole } = useAuth();
  const isDualRole = (user?.roles?.length ?? 0) > 1;
  const role = user?.role;
  const NAV_ITEMS = role === 'teacher' ? TEACHER_NAV_ITEMS : role === 'parent' ? PARENT_NAV_ITEMS : STUDENT_NAV_ITEMS;
  const groups = role === 'teacher' ? ['MENU', 'MANAGE', 'SYSTEM'] : role === 'parent' ? ['MENU', 'CHILDREN', 'SYSTEM'] : ['MENU', 'FOCUS', 'SYSTEM'];
  const { colors, themeMode, setThemeMode } = useTheme();
  const { unreadCount, unreadAssignments } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const MESSAGE_SCREENS     = ['TeacherMessages', 'ParentMessages'];
  const ASSIGNMENT_SCREENS  = ['Assignments', 'ParentAssignments'];

  return (
    <View style={styles.container}>
      {/* Logo */}
      <View style={styles.logo}>
        <View style={styles.logoMark}>
          <Feather name="zap" size={18} color="white" />
        </View>
        <Text style={styles.logoText}>Aivorah</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {groups.map((group) => {
          const items = NAV_ITEMS.filter((i) => i.group === group);
          return (
            <View key={group} style={styles.navGroup}>
              <Text style={styles.navLabel}>{group}</Text>
              {items.map((item) => {
                const isActive = currentScreen === item.screen;
                return (
                  <TouchableOpacity
                    key={item.screen}
                    style={[styles.navItem, isActive && styles.navItemActive]}
                    onPress={() => onNavigate(item.screen)}
                    activeOpacity={0.7}
                  >
                    {isActive && <View style={styles.activeBar} />}
                    <Feather
                      name={item.icon as any}
                      size={17}
                      color={isActive ? colors.primary : colors.textMuted}
                    />
                    <Text style={[styles.navItemText, isActive && styles.navItemTextActive]}>
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
                    onPress={() => { switchRole(r); onNavigate(ROLE_DASH[r] ?? 'Dashboard'); }}
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
                  <Feather name={getAvatarIcon((user as any).avatarStyle) as any} size={13} color="white" />
                </LinearGradient>
              ) : (
                <Feather name="user" size={13} color={colors.textMuted} />
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
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  container: {
    width: 260,
    backgroundColor: c.sidebarDark,
    borderRightWidth: 1,
    borderRightColor: c.borderColor,
    paddingHorizontal: spacing.lg,
    paddingTop: 32,
    paddingBottom: spacing.xl,
    flexShrink: 0,
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
    color: c.textMain,
    letterSpacing: -0.3,
  },
  navGroup: { marginBottom: 28 },
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
  navItemActive: { backgroundColor: c.primaryGlow },
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
  navItemText: { fontSize: 14, fontWeight: '500', color: c.textMuted, flex: 1 },
  navItemTextActive: { color: c.primary },
  navBadge: {
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: c.accentRed,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  navBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
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
  themeOptionTextActive: {
    color: c.primary,
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
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  userAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: c.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  userAvatarImg: { width: 30, height: 30, borderRadius: 15 },
  userName: { fontSize: 13, fontWeight: '600', color: c.textMain },
  userRole: { fontSize: 11, color: c.textDim, textTransform: 'capitalize' },
});
