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
  { label: 'Dashboard',        icon: 'grid',         screen: 'Dashboard',          group: 'MENU',    premium: false },
  { label: 'Profile',          icon: 'user',         screen: 'Profile',            group: 'MENU',    premium: false },
  { label: 'My Learning Paths',icon: 'book-open',    screen: 'LearningPaths',      group: 'MENU',    premium: false },
  { label: 'AI Coach',         icon: 'message-circle',screen: 'AICoach',           group: 'MENU',    premium: false },
  { label: 'Schedule',         icon: 'calendar',     screen: 'Schedule',           group: 'MENU',    premium: false },
  { label: 'The World & You',  icon: 'globe',        screen: 'WorldAndYou',        group: 'MENU',    premium: false },
  { label: 'Bedtime Stories',  icon: 'book',         screen: 'BhagavathaStories',  group: 'MENU',    premium: true  },
  { label: 'Daily Habits',     icon: 'sun',          screen: 'DailyHabits',        group: 'MENU',    premium: true  },
  { label: 'Assignments',      icon: 'check-square', screen: 'Assignments',        group: 'FOCUS',   premium: false },
  { label: 'Challenges',       icon: 'target',       screen: 'Challenges',         group: 'FOCUS',   premium: true  },
  { label: 'Leaderboard',      icon: 'award',        screen: 'Leaderboard',        group: 'FOCUS',   premium: false },
  { label: 'Progress',         icon: 'bar-chart-2',  screen: 'Progress',           group: 'FOCUS',   premium: false },
  { label: 'Rewards',          icon: 'gift',         screen: 'Rewards',            group: 'FOCUS',   premium: false },
  { label: 'Plans & Billing',  icon: 'credit-card',  screen: 'Subscription',       group: 'SYSTEM',  premium: false },
  { label: 'Help Center',      icon: 'help-circle',  screen: 'HelpCenter',         group: 'SYSTEM',  premium: false },
  { label: 'Settings',         icon: 'settings',     screen: 'Settings',           group: 'SYSTEM',  premium: false },
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
  { label: 'Dashboard',         icon: 'grid',           screen: 'ParentDashboard',    group: 'MENU',     premium: false },
  { label: 'Profile',           icon: 'user',           screen: 'ParentProfile',      group: 'MENU',     premium: false },
  { label: 'My Kids',           icon: 'users',          screen: 'ParentMyKids',       group: 'MENU',     premium: false },
  { label: 'Daily Tasks',       icon: 'check-square',   screen: 'ParentDailyTasks',   group: 'MENU',     premium: false },
  { label: 'Schedule',          icon: 'calendar',       screen: 'ParentSchedule',     group: 'MENU',     premium: false },
  { label: 'Learning',          icon: 'book-open',      screen: 'ParentLearning',     group: 'CHILDREN', premium: false },
  { label: 'Assignments',       icon: 'check-square',   screen: 'ParentAssignments',  group: 'CHILDREN', premium: false },
  { label: 'Progress',          icon: 'bar-chart-2',    screen: 'ParentProgress',     group: 'CHILDREN', premium: false },
  { label: 'AI Progress Reports', icon: 'file-text',    screen: 'ParentAIReports',    group: 'CHILDREN', premium: true  },
  { label: 'Challenges',        icon: 'target',         screen: 'ParentChallenges',   group: 'CHILDREN', premium: false },
  { label: 'Messages',          icon: 'message-square', screen: 'ParentMessages',     group: 'CHILDREN', premium: false },
  { label: 'Parental Controls', icon: 'shield',         screen: 'ParentControls',     group: 'CHILDREN', premium: true  },
  { label: 'Plans & Billing',   icon: 'credit-card',    screen: 'ParentSubscription', group: 'SYSTEM',   premium: false },
  { label: 'Help',              icon: 'help-circle',    screen: 'ParentHelp',         group: 'SYSTEM',   premium: false },
  { label: 'Settings',          icon: 'settings',       screen: 'ParentSettings',     group: 'SYSTEM',   premium: false },
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
  const { logout, user, switchRole, updateUser } = useAuth();
  const [showHomeConfirm, setShowHomeConfirm] = useState(false);
  const isDualRole = (user?.roles?.length ?? 0) > 1;
  const role = user?.role;
  const NAV_ITEMS = role === 'teacher' ? TEACHER_NAV_ITEMS : role === 'parent' ? PARENT_NAV_ITEMS : STUDENT_NAV_ITEMS;
  const groups = role === 'teacher' ? ['MENU', 'MANAGE', 'SYSTEM'] : role === 'parent' ? ['MENU', 'CHILDREN', 'SYSTEM'] : ['MENU', 'FOCUS', 'SYSTEM'];
  const { colors, themeMode, setThemeMode } = useTheme();
  const { unreadCount, unreadAssignments, unreadChallenges } = useNotification();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const MESSAGE_SCREENS     = ['TeacherMessages', 'ParentMessages', 'Messages'];
  const ASSIGNMENT_SCREENS  = ['Assignments', 'ParentAssignments'];
  const CHALLENGE_SCREENS   = ['Challenges', 'ParentChallenges'];

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
                    {CHALLENGE_SCREENS.includes(item.screen) && unreadChallenges > 0 && (
                      <View style={styles.navBadge}>
                        <Text style={styles.navBadgeText}>{unreadChallenges > 9 ? '9+' : unreadChallenges}</Text>
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

        {/* Add Parent Profile hint — shown to teachers who haven't set up parent profile yet */}
        {user?.role === 'teacher' && !isDualRole && (
          <TouchableOpacity
            style={styles.addParentHint}
            onPress={() => {
              // Store return role in module-level variable (immune to onAuthStateChanged resets)
              setPendingReturnRole('teacher');
              // Temporarily set role to parent so OnboardingScreen shows parent flow
              updateUser({ role: 'parent', onboardingComplete: false } as any);
              onNavigate('Onboarding');
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
                  <Feather name={getAvatarIcon((user as any).avatarStyle) as any} size={13} color="white" />
                </LinearGradient>
              ) : (
                <Feather name="user" size={13} color={colors.textMuted} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName} numberOfLines={1}>{user.name}</Text>
              <View style={styles.userMetaRow}>
                <Text style={styles.userRole}>{user.role}</Text>
                <View style={[
                  styles.planBadge,
                  (user as any).isPro
                    ? styles.planBadgePro
                    : styles.planBadgeFree,
                ]}>
                  <Text style={[
                    styles.planBadgeText,
                    (user as any).isPro
                      ? styles.planBadgeTextPro
                      : styles.planBadgeTextFree,
                  ]}>
                    {(user as any).isPro ? 'PRO' : 'FREE'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}
        <TouchableOpacity style={styles.navItem} onPress={logout} activeOpacity={0.7}>
          <Feather name="log-out" size={17} color={colors.accentRed} />
          <Text style={[styles.navItemText, { color: colors.accentRed }]}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Branded Home Confirmation Modal */}
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
  premiumBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    backgroundColor: '#C5A56A22', borderWidth: 1, borderColor: '#C5A56A55',
  },
  premiumBadgeText: { fontSize: 9, fontWeight: '800', color: '#C5A56A', letterSpacing: 0.4 },
  lockBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#C5A56A15',
    alignItems: 'center', justifyContent: 'center',
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
  freeBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    backgroundColor: '#93B0AC18', borderWidth: 1, borderColor: '#93B0AC40',
  },
  freeBadgeText: { fontSize: 9, fontWeight: '800', color: '#93B0AC', letterSpacing: 0.4 },
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
  userMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  planBadge: {
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 1,
  },
  planBadgeFree: {
    backgroundColor: '#93B0AC18', borderColor: '#93B0AC40',
  },
  planBadgePro: {
    backgroundColor: '#C5A56A22', borderColor: '#C5A56A55',
  },
  planBadgeText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  planBadgeTextFree: { color: '#93B0AC' },
  planBadgeTextPro: { color: '#C5A56A' },

  // Home confirm modal
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
});
