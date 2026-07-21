import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Modal,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, radius, typography } from '../../theme';
import type { AppColors } from '../../theme';
import { useAuth, setPendingReturnRole, getPendingReturnRole } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeMode } from '../../context/ThemeContext';
import { useNotification } from '../../context/NotificationContext';
import { useAnnouncements } from '../../features/announcements/context/AnnouncementProvider';
import { getAvatarGradient, getAvatarIcon } from '../../constants/avatarStyles';
import { roleLabel } from '../../constants/roleLabels';
import { useFocusEffect } from '@react-navigation/native';
import SERVER_URL from '../../config/serverUrl';

const STUDENT_NAV_ITEMS = [
  { label: 'Dashboard',        icon: 'grid',         screen: 'Dashboard',          group: 'MENU',    premium: false },
  { label: 'Profile',          icon: 'user',         screen: 'Profile',            group: 'MENU',    premium: false },
  { label: 'My Learning Paths',icon: 'book-open',    screen: 'LearningPaths',      group: 'MENU',    premium: false,
    // Screens reached FROM "My Learning Paths" (choose a subject → choose a
    // topic/chapter → open a lesson/quiz/tool) so the sidebar item stays
    // highlighted through that whole flow, not just on the landing screen
    // itself. This is a flat Drawer.Navigator (siblings, not a nested Stack),
    // so there's no parent/child relationship in the navigation state to
    // read back — this list is the only source of truth for "belongs to
    // Learning Paths." Keep in sync with AppNavigator.tsx's Drawer.Screen
    // list if a new topic-flow screen is added.
    childScreens: [
      'SubjectTopics', 'SubjectSyllabus', 'LessonScreen', 'TopicLesson',
      'VideoLesson', 'VideoPlayer', 'IBPYPQuiz', 'Learn5E', 'MathHelper',
      'WordWizard', 'DrawingBuddy', 'AIStoryteller', 'NCERTChapters',
    ] },
  { label: 'AI Coach',         icon: 'message-circle',screen: 'AICoach',           group: 'MENU',    premium: false },
  { label: 'Schedule',         icon: 'calendar',     screen: 'Schedule',           group: 'MENU',    premium: false },
  { label: 'The World & You',  icon: 'globe',        screen: 'WorldAndYou',        group: 'MENU',    premium: false },
  { label: 'Read Aloud',       icon: 'mic',          screen: 'ReadAloud',          group: 'MENU',    premium: false },
  { label: 'Announcements',    icon: 'volume-2',     screen: 'Announcements',      group: 'MENU',    premium: false },
  { label: 'My Classes',       icon: 'layers',       screen: 'MyClasses',          group: 'MENU',    premium: false },
  { label: 'Timetable',        icon: 'clock',        screen: 'Timetable',          group: 'MENU',    premium: false },
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
  { label: 'My Classes', icon: 'layers', screen: 'MyClasses', group: 'MENU' },
  { label: 'Timetable', icon: 'clock', screen: 'Timetable', group: 'MENU' },
  { label: 'Resources', icon: 'folder', screen: 'Resources', group: 'MENU' },
  { label: 'Attendance', icon: 'clipboard', screen: 'TeacherAttendance', group: 'MENU' },
  { label: 'Schedule', icon: 'calendar', screen: 'TeacherSchedule', group: 'MENU' },
  { label: 'Assignments', icon: 'check-square', screen: 'TeacherAssignments', group: 'MANAGE' },
  { label: 'Challenges', icon: 'target', screen: 'TeacherChallenges', group: 'MANAGE' },
  { label: 'Student Progress', icon: 'bar-chart-2', screen: 'TeacherProgress', group: 'MANAGE' },
  { label: 'Learning Paths', icon: 'map', screen: 'TeacherLearningPaths', group: 'MANAGE' },
  { label: 'Manage Syllabus', icon: 'upload', screen: 'TeacherSyllabusImport', group: 'MANAGE' },
  { label: 'Messages', icon: 'message-square', screen: 'TeacherMessages', group: 'MANAGE' },
  { label: 'Announcements', icon: 'volume-2', screen: 'TeacherAnnouncements', group: 'MANAGE' },
  { label: 'Send Announcement', icon: 'edit-3', screen: 'AnnouncementManager', group: 'MANAGE' },
  { label: 'Settings', icon: 'settings', screen: 'TeacherSettings', group: 'SYSTEM' },
];

const PARENT_NAV_ITEMS = [
  { label: 'Dashboard',         icon: 'grid',           screen: 'ParentDashboard',    group: 'MENU',     premium: false },
  { label: 'Profile',           icon: 'user',           screen: 'ParentProfile',      group: 'MENU',     premium: false },
  { label: 'My Kids',           icon: 'users',          screen: 'ParentMyKids',       group: 'MENU',     premium: false },
  { label: 'My Classes',        icon: 'layers',         screen: 'MyClasses',          group: 'MENU',     premium: false },
  { label: 'Timetable',         icon: 'clock',          screen: 'Timetable',          group: 'MENU',     premium: false },
  { label: 'Resources',         icon: 'folder',         screen: 'Resources',          group: 'MENU',     premium: false },
  { label: 'Daily Tasks',       icon: 'check-square',   screen: 'ParentDailyTasks',   group: 'MENU',     premium: false },
  { label: 'Schedule',          icon: 'calendar',       screen: 'ParentSchedule',     group: 'MENU',     premium: false },
  { label: 'Learning',          icon: 'book-open',      screen: 'ParentLearning',     group: 'CHILDREN', premium: false },
  { label: 'Assignments',       icon: 'check-square',   screen: 'ParentAssignments',  group: 'CHILDREN', premium: false },
  { label: 'Progress',          icon: 'bar-chart-2',    screen: 'ParentProgress',     group: 'CHILDREN', premium: false },
  { label: 'Attendance',        icon: 'clipboard',      screen: 'ParentAttendance',    group: 'CHILDREN', premium: false },
  { label: 'AI Progress Report',  icon: 'file-text',    screen: 'ParentAIReports',    group: 'CHILDREN', premium: false },
  { label: 'Challenges',        icon: 'target',         screen: 'ParentChallenges',   group: 'CHILDREN', premium: false },
  { label: 'Messages',          icon: 'message-square', screen: 'ParentMessages',     group: 'CHILDREN', premium: false },
  { label: 'Announcements',     icon: 'volume-2',       screen: 'ParentAnnouncements', group: 'CHILDREN', premium: false },
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
  onNavigate: (screen: string, params?: Record<string, any>) => void;
}

const SUPER_ADMIN_NAV_ITEMS = [
  { label: 'Dashboard',          icon: 'grid',         screen: 'TeacherDashboard',   group: 'MENU'    },
  { label: 'Students',           icon: 'users',        screen: 'TeacherStudents',    group: 'MENU'    },
  { label: 'Attendance',          icon: 'clipboard',     screen: 'TeacherAttendance',    group: 'MENU'    },
  { label: 'Schedule',           icon: 'calendar',     screen: 'TeacherSchedule',    group: 'MENU'    },
  { label: 'Assignments',        icon: 'check-square', screen: 'TeacherAssignments', group: 'MANAGE'  },
  { label: 'Challenges',         icon: 'target',       screen: 'TeacherChallenges',  group: 'MANAGE'  },
  { label: 'Challenge Manager',  icon: 'shield',       screen: 'ChallengeManager',     group: 'MANAGE'  },
  { label: 'Staff Subjects',     icon: 'book-open',    screen: 'StaffSubjectMapping',  group: 'MANAGE'  },
  { label: 'Student Progress',   icon: 'bar-chart-2',  screen: 'TeacherProgress',      group: 'MANAGE'  },
  { label: 'Learning Paths',     icon: 'map',          screen: 'TeacherLearningPaths', group: 'MANAGE' },
  { label: 'Messages',           icon: 'message-square', screen: 'TeacherMessages',  group: 'MANAGE'  },
  { label: 'Announcements',      icon: 'volume-2',     screen: 'TeacherAnnouncements', group: 'MANAGE' },
  { label: 'Announcement Manager', icon: 'edit-3',     screen: 'AnnouncementManager',  group: 'MANAGE' },
  { label: 'Settings',           icon: 'settings',     screen: 'TeacherSettings',    group: 'SYSTEM'  },
];

const SCHOOL_ADMIN_NAV_ITEMS: { label: string; icon: string; screen: string; group: string; params?: Record<string, any> }[] = [
  { label: 'Overview',           icon: 'grid',          screen: 'SchoolAdminDashboard',    group: 'WORKSPACE' },
  { label: 'Students',           icon: 'users',         screen: 'SchoolAdminStudents',      group: 'STUDENT MANAGEMENT' },
  { label: 'Grades & Sections',  icon: 'list',          screen: 'SchoolAdminGradesSections', group: 'ACADEMIC STRUCTURE' },
  { label: 'Classes',            icon: 'layers',        screen: 'SchoolAdminClasses',       group: 'ACADEMIC STRUCTURE' },
  { label: 'Timetable',          icon: 'clock',         screen: 'Timetable',                group: 'ACADEMIC STRUCTURE' },
  { label: 'Resources',          icon: 'folder',        screen: 'Resources',                group: 'ACADEMIC STRUCTURE' },
  { label: 'Promotions',         icon: 'trending-up',   screen: 'SchoolAdminPromotions',    group: 'STUDENT LIFECYCLE' },
  { label: 'Archived Students',  icon: 'archive',       screen: 'SchoolAdminArchivedStudents', group: 'STUDENT LIFECYCLE' },
  { label: 'Teachers',           icon: 'user',          screen: 'SchoolAdminTeachers',      group: 'PEOPLE' },
  { label: 'Add Teacher',        icon: 'user-plus',     screen: 'SchoolAdminAddTeacher',    group: 'PEOPLE' },
  { label: 'Import Teachers',    icon: 'upload',        screen: 'SchoolAdminTeacherBulkImport', group: 'PEOPLE' },
  { label: 'Parents',            icon: 'heart',         screen: 'SchoolAdminParents',       group: 'PEOPLE' },
  { label: 'Messages',           icon: 'message-square', screen: 'Messages',                group: 'COMMUNICATION' },
  { label: 'Announcements',      icon: 'edit-3',        screen: 'AnnouncementManager',      group: 'COMMUNICATION' },
  { label: 'Import History',     icon: 'clock',         screen: 'SchoolAdminImportHistory', group: 'ADMINISTRATION' },
  { label: 'Workspace Settings', icon: 'settings',      screen: 'SchoolAdminSettings',      group: 'ADMINISTRATION' },
  { label: 'Help & Support',     icon: 'help-circle',   screen: 'TeacherHelp',              group: 'SUPPORT' },
];

const ROLE_DASH: Record<string, string> = { super_admin: 'TeacherDashboard', school_admin: 'SchoolAdminDashboard', teacher: 'TeacherDashboard', parent: 'ParentDashboard', student: 'Dashboard' };

const COLLAPSE_KEY = 'aivorah_sidebar_collapsed';

export default function Sidebar({ currentScreen, onNavigate }: SidebarProps) {
  const { logout, user, switchRole, updateUser, beginAddParentProfile } = useAuth();
  const [showHomeConfirm, setShowHomeConfirm] = useState(false);
  const activeItemRef = useRef<any>(null);

  // Keep the active nav item visible when it changes (e.g. after navigating
  // via a deep link or programmatic navigation), only scrolling the sidebar's
  // own scroll container — never `Element.scrollIntoView()`, which walks up
  // *every* scrollable ancestor (including the outer page) and can drag the
  // whole app viewport down, exposing blank background beneath it. Setting
  // `scrollTop` directly on the sidebar scroller keeps the scroll contained,
  // and centering the item (instead of snapping to whichever edge is nearer)
  // gives it comfortable margin, matching VS Code/Slack-style sidebars.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = activeItemRef.current as HTMLElement | null | undefined;
    const scroller = node?.closest('[data-sidebar-scroll]') as HTMLElement | null | undefined;
    if (!node || !scroller || typeof node.getBoundingClientRect !== 'function') return;
    const itemRect = node.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const isVisible = itemRect.top >= scrollerRect.top && itemRect.bottom <= scrollerRect.bottom;
    if (isVisible) return;
    const itemOffsetWithinScroller = itemRect.top - scrollerRect.top + scroller.scrollTop;
    const targetScrollTop = itemOffsetWithinScroller - (scroller.clientHeight - node.clientHeight) / 2;
    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
  }, [currentScreen]);
  // Collapsible, icon-only rail — like Google Admin's hamburger-collapsed nav.
  // Scoped to school_admin: that role now has the Overview tile launcher as
  // its primary navigation, so a permanently-open labeled sidebar is
  // redundant by default. Every other role keeps today's always-open sidebar
  // unchanged. The user's manual expand/collapse choice persists.
  const [collapsed, setCollapsed] = useState(() => {
    if (user?.role !== 'school_admin') return false;
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY);
      return saved === null ? true : saved === '1';
    } catch { return true; }
  });
  const canCollapse = user?.role === 'school_admin';
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  }
  const pendingReturn = getPendingReturnRole();
  const isDualRole = (user?.roles?.length ?? 0) > 1 || Boolean(pendingReturn);
  // Roles to display in Switch Profile pills — use actual roles or infer from pending return
  const effectiveRoles: string[] = (user?.roles?.length ?? 0) > 1
    ? user!.roles!
    : pendingReturn === 'teacher' ? ['teacher', 'parent'] : [];
  const role = user?.role;

  // School branding card (school_admin only): fetch the school's real name so
  // the sidebar header matches the mobile drawer and the design.
  const isSchoolAdmin = role === 'school_admin';
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [schoolLogoUrl, setSchoolLogoUrl] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    if (!isSchoolAdmin || !user?.email) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${SERVER_URL}/school-admin/overview?adminEmail=${encodeURIComponent(user.email)}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setSchoolName(data?.school?.name || null);
          setSchoolLogoUrl(data?.school?.logoUrl || null);
        }
      } catch { /* silent — sidebar still renders without the school card */ }
    })();
    return () => { cancelled = true; };
  }, [isSchoolAdmin, user?.email]));

  const NAV_ITEMS_ROLE = role === 'super_admin' ? SUPER_ADMIN_NAV_ITEMS : role === 'school_admin' ? SCHOOL_ADMIN_NAV_ITEMS : role === 'teacher' ? TEACHER_NAV_ITEMS : role === 'parent' ? PARENT_NAV_ITEMS : STUDENT_NAV_ITEMS;
  // B2C vs B2B: independent (no schoolId) student/teacher/parent accounts don't
  // belong to a school org, so hide school-only features (class rosters,
  // attendance) rather than routing them to a dead-end. Mirrors DrawerContent.tsx.
  const isB2B = !!user?.schoolId;
  const SCHOOL_ONLY_SCREENS = ['MyClasses', 'TeacherAttendance', 'ParentAttendance', 'Timetable', 'Resources'];
  const NAV_ITEMS = (!isB2B && (role === 'teacher' || role === 'parent' || role === 'student'))
    ? NAV_ITEMS_ROLE.filter((i) => !SCHOOL_ONLY_SCREENS.includes(i.screen))
    : NAV_ITEMS_ROLE;
  const groups = (role === 'super_admin' || role === 'teacher') ? ['MENU', 'MANAGE', 'SYSTEM'] : role === 'school_admin' ? ['WORKSPACE', 'STUDENT MANAGEMENT', 'ACADEMIC STRUCTURE', 'STUDENT LIFECYCLE', 'PEOPLE', 'COMMUNICATION', 'ADMINISTRATION', 'SUPPORT'] : role === 'parent' ? ['MENU', 'CHILDREN', 'SYSTEM'] : ['MENU', 'FOCUS', 'SYSTEM'];
  const { colors, themeMode, setThemeMode } = useTheme();
  const { unreadCount, unreadAssignments, unreadChallenges } = useNotification();
  const { bannerAnnouncements } = useAnnouncements();
  const unreadAnnouncements = bannerAnnouncements.length;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const MESSAGE_SCREENS      = ['TeacherMessages', 'ParentMessages', 'Messages'];
  const ASSIGNMENT_SCREENS   = ['Assignments', 'ParentAssignments'];
  const CHALLENGE_SCREENS    = ['Challenges', 'ParentChallenges'];
  const ANNOUNCEMENT_SCREENS = ['Announcements', 'ParentAnnouncements', 'TeacherAnnouncements'];

  return (
    <View style={[styles.container, collapsed && styles.containerCollapsed]}>
      {/* Logo */}
      <View style={[styles.logoRow, collapsed && styles.logoRowCollapsed]}>
        <TouchableOpacity style={[styles.logo, collapsed && { paddingLeft: 0 }]} activeOpacity={0.7} onPress={() => setShowHomeConfirm(true)}>
          <View style={styles.logoMark}>
            <Feather name="zap" size={18} color="white" />
          </View>
          {!collapsed && <Text style={styles.logoText}>Aivorah</Text>}
        </TouchableOpacity>
        {canCollapse && (
          <TouchableOpacity
            onPress={toggleCollapsed}
            style={styles.collapseBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Feather name="menu" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* School branding card — school_admin only (mirrors the mobile drawer
          and the approved design's sidebar header). Shows the school's uploaded
          logo when one exists (from Workspace Settings); no monogram fallback
          here per request — just the school name + role when there's no logo. */}
      {isSchoolAdmin && schoolName && !collapsed && (
        <View style={styles.schoolCard}>
          {schoolLogoUrl && (
            <View style={styles.schoolBadge}>
              <Image source={{ uri: schoolLogoUrl }} style={styles.schoolBadgeImg} resizeMode="contain" />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.schoolName} numberOfLines={2}>{schoolName}</Text>
            <Text style={styles.schoolRole}>School Administrator</Text>
          </View>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} {...({ dataSet: { sidebarScroll: 'true' } } as any)}>
        {groups.map((group) => {
          const items = NAV_ITEMS.filter((i) => i.group === group);
          return (
            <View key={group} style={styles.navGroup}>
              {!collapsed && <Text style={styles.navLabel}>{group}</Text>}
              {items.map((item) => {
                // A nav item is only ever "active" when its screen is a
                // distinct route (own route name in the navigator/URL — see
                // SchoolAdminArchivedStudents vs SchoolAdminStudents). Any
                // future item that instead reaches a shared screen via
                // runtime `params` must not get the persistent active
                // highlight, or every item pointing at that screen would
                // light up together.
                const childScreens: string[] | undefined = (item as any).childScreens;
                const isActive = !(item as any).params &&
                  (currentScreen === item.screen || (childScreens?.includes(currentScreen) ?? false));
                return (
                  <TouchableOpacity
                    key={`${item.screen}-${item.label}`}
                    ref={isActive ? activeItemRef : undefined}
                    style={[styles.navItem, isActive && styles.navItemActive, collapsed && styles.navItemCollapsed]}
                    onPress={() => onNavigate(item.screen, (item as any).params)}
                    activeOpacity={0.7}
                    accessibilityLabel={collapsed ? item.label : undefined}
                  >
                    {isActive && <View style={styles.activeBar} />}
                    <Feather
                      name={item.icon as any}
                      size={17}
                      color={isActive ? colors.accentYellow : colors.textMuted}
                    />
                    {!collapsed && (
                      <Text style={[styles.navItemText, isActive && styles.navItemTextActive]}>
                        {item.label}
                      </Text>
                    )}
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
                    {ANNOUNCEMENT_SCREENS.includes(item.screen) && unreadAnnouncements > 0 && (
                      <View style={styles.navBadge}>
                        <Text style={styles.navBadgeText}>{unreadAnnouncements > 9 ? '9+' : unreadAnnouncements}</Text>
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

      {/* User + Logout — inside the same scroll region as the nav list, so a
          short nav list packs the footer right below it instead of leaving a
          gap (flex:1 on a separate ScrollView always stretched to fill the
          remaining sidebar height regardless of content), while a long nav
          list still scrolls the whole sidebar together as one unit. */}
      <View style={styles.footer}>
        {!collapsed && (
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
                  <Feather name={opt.icon as any} size={12} color={isActive ? colors.accentYellow : colors.textMuted} />
                  <Text style={[styles.themeOptionText, isActive && styles.themeOptionTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        )}

        {/* Role switcher — only for dual-role users (teacher+parent) */}
        {!collapsed && isDualRole && effectiveRoles.length > 0 && (
          <View style={styles.roleSwitcher}>
            <Text style={styles.roleSwitcherLabel}>Switch Profile</Text>
            <View style={styles.roleSwitcherRow}>
              {effectiveRoles.map((r) => {
                const isActive = user?.role === r;
                return (
                  <TouchableOpacity
                    key={r}
                    style={[styles.rolePill, isActive && styles.rolePillActive]}
                    onPress={() => { switchRole(r as any); setTimeout(() => { try { onNavigate(ROLE_DASH[r] ?? 'Dashboard'); } catch (_) {} }, 50); }}
                    activeOpacity={0.75}
                  >
                    <Feather name={r === 'teacher' ? 'briefcase' : 'home'} size={12} color={isActive ? colors.accentYellow : colors.textMuted} />
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
              // Start add-parent flow IN MEMORY only — no premature persistence.
              // Backing out leaves no half-created parent profile. The top-level
              // onboarding gate renders the parent steps from in-memory state.
              beginAddParentProfile();
            }}
            activeOpacity={0.8}
          >
            <View style={styles.addParentHintIcon}>
              <Feather name="home" size={11} color={colors.accentYellow} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.addParentHintTitle}>Also a parent?</Text>
              <Text style={styles.addParentHintSub}>Add your parent profile</Text>
            </View>
            <Feather name="chevron-right" size={12} color={colors.textDim} />
          </TouchableOpacity>
        )}

        {user && (
          <TouchableOpacity style={[styles.userRow, collapsed && styles.userRowCollapsed]} activeOpacity={0.75} onPress={() => {
            if (role === 'school_admin') return onNavigate('SchoolAdminSettings');
            if (role === 'super_admin') return; // no dedicated profile screen for this role
            const profileScreen = role === 'parent' ? 'ParentProfile' : 'Profile';
            onNavigate(profileScreen);
          }}>
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
            {!collapsed && (
            <View style={{ flex: 1 }}>
              <Text style={styles.userName} numberOfLines={1}>{user.name}</Text>
              <View style={styles.userMetaRow}>
                <Text style={styles.userRole}>{roleLabel(user.role)}</Text>
                {/* PRO/FREE is a consumer subscription-plan badge — meaningless
                    for admin identities, so it's hidden for those roles. */}
                {role !== 'school_admin' && role !== 'super_admin' && (
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
                )}
              </View>
            </View>
            )}
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.navItem, collapsed && styles.navItemCollapsed]}
          onPress={logout}
          activeOpacity={0.7}
          accessibilityLabel={collapsed ? 'Logout' : undefined}
        >
          <Feather name="log-out" size={17} color={colors.accentRed} />
          {!collapsed && <Text style={[styles.navItemText, { color: colors.accentRed }]}>Logout</Text>}
        </TouchableOpacity>
      </View>
      </ScrollView>

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
  containerCollapsed: {
    width: 72,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 36 },
  logoRowCollapsed: { flexDirection: 'column', gap: 10, marginBottom: 28 },
  collapseBtn: {
    width: 30, height: 30, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 'auto',
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: spacing.md,
  },
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: c.accentYellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 18,
    fontWeight: '700',
    color: c.textMain,
    letterSpacing: -0.3,
  },
  schoolCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.borderColor,
    backgroundColor: c.cardDark,
  },
  schoolBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: `${c.accentYellow}22`,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  schoolBadgeImg: {
    width: '100%',
    height: '100%',
    borderRadius: radius.sm,
  },
  schoolName: {
    fontSize: 13,
    fontWeight: '700',
    color: c.textMain,
    lineHeight: 16,
  },
  schoolRole: {
    fontSize: 11,
    color: c.textDim,
    marginTop: 2,
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
  navItemCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
    width: 44,
  },
  navItemActive: { backgroundColor: c.accentYellow + '18' },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: 6,
    bottom: 6,
    width: 3,
    backgroundColor: c.accentYellow,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  navItemText: { fontSize: 14, fontWeight: '500', color: c.textMuted, flex: 1 },
  navItemTextActive: { color: c.accentYellow },
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
    borderColor: c.accentYellow,
    backgroundColor: c.accentYellow + '18',
  },
  themeOptionText: {
    fontSize: 11,
    fontWeight: '600',
    color: c.textMuted,
  },
  themeOptionTextActive: {
    color: c.accentYellow,
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
    borderColor: c.accentYellow,
    backgroundColor: c.accentYellow + '18',
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: c.textMuted,
  },
  rolePillTextActive: {
    color: c.accentYellow,
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
    borderColor: c.accentYellow + '50',
    backgroundColor: c.accentYellow + '10',
  },
  addParentHintIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: c.accentYellow + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addParentHintTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: c.accentYellow,
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
  userRowCollapsed: { paddingHorizontal: 0, justifyContent: 'center' },
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
    backgroundColor: c.accentYellow + '18', borderColor: c.accentYellow + '40',
  },
  planBadgePro: {
    backgroundColor: '#C5A56A22', borderColor: '#C5A56A55',
  },
  planBadgeText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  planBadgeTextFree: { color: c.accentYellow },
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
  confirmGo: { flex: 1, backgroundColor: c.accentYellow, borderRadius: 10, paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  confirmGoText: { fontSize: 14, fontWeight: '700', color: '#0B0B0B' },
});
