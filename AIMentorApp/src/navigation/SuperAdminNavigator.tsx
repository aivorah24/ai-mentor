import React from 'react';
import { useWindowDimensions } from 'react-native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { useTheme } from '../context/ThemeContext';

import DrawerContent from '../components/common/DrawerContent';
import TeacherDashboardScreen from '../screens/teacher/TeacherDashboardScreen';
import TeacherStudentsScreen from '../screens/teacher/TeacherStudentsScreen';
import TeacherScheduleScreen from '../screens/teacher/TeacherScheduleScreen';
import TeacherAssignmentsScreen from '../screens/teacher/TeacherAssignmentsScreen';
import TeacherChallengesScreen from '../screens/teacher/TeacherChallengesScreen';
import TeacherProgressScreen from '../screens/teacher/TeacherProgressScreen';
import TeacherLearningPathsScreen from '../screens/teacher/TeacherLearningPathsScreen';
import TeacherAchievementsScreen from '../screens/teacher/TeacherAchievementsScreen';
import TeacherHelpScreen from '../screens/teacher/TeacherHelpScreen';
import TeacherSettingsScreen from '../screens/teacher/TeacherSettingsScreen';
import TeacherVideoLibraryScreen from '../screens/teacher/TeacherVideoLibraryScreen';
import TeacherMessagesScreen from '../screens/teacher/TeacherMessagesScreen';
import ProjectDetailsScreen from '../screens/teacher/ProjectDetailsScreen';
import ChallengeManagerScreen from '../screens/teacher/ChallengeManagerScreen';
import SuperAdminStudentsScreen from '../screens/teacher/SuperAdminStudentsScreen';
import StaffSubjectMappingScreen from '../screens/teacher/StaffSubjectMappingScreen';
import AnnouncementManagerScreen from '../features/announcements/components/AnnouncementManagerScreen';
import TeacherAnnouncementsScreen from '../screens/teacher/TeacherAnnouncementsScreen';
import TeacherAttendanceScreen from '../screens/teacher/TeacherAttendanceScreen';
import TimetableScreen from '../features/timetable/components/TimetableScreen';
import ResourcesScreen from '../features/resources/components/ResourcesScreen';
import ChannelsScreen from '../features/channels/components/ChannelsScreen';
import ContentReviewDashboardScreen from '../screens/admin/ContentReviewDashboardScreen';

export type SuperAdminDrawerParamList = {
  TeacherDashboard: undefined;
  TeacherStudents: undefined;
  TeacherAttendance: undefined;
  TeacherAssignments: undefined;
  TeacherChallenges: undefined;
  TeacherSchedule: undefined;
  TeacherProgress: undefined;
  TeacherLearningPaths: undefined;
  TeacherAchievements: undefined;
  TeacherVideoLibrary: undefined;
  TeacherHelp: undefined;
  TeacherSettings: undefined;
  TeacherMessages: undefined;
  ProjectDetails: undefined;
  ChallengeManager: undefined;
  SuperAdminStudents: undefined;
  StaffSubjectMapping: undefined;
  AnnouncementManager: undefined;
  TeacherAnnouncements: { openId?: string } | undefined;
  ContentReviewDashboard: undefined;
};

const Drawer = createDrawerNavigator<SuperAdminDrawerParamList>();

export default function SuperAdminNavigator() {
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 768;
  const { colors } = useTheme();

  return (
    <Drawer.Navigator
      initialRouteName="ChallengeManager"
      backBehavior="history"
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: isLargeScreen ? 'permanent' : 'slide',
        drawerStyle: isLargeScreen
          ? { width: 0, opacity: 0, pointerEvents: 'none' as const }
          : { width: 260, backgroundColor: colors.sidebarDark },
        overlayColor: 'rgba(0,0,0,0.5)',
        swipeEnabled: !isLargeScreen,
        sceneContainerStyle: { backgroundColor: colors.bgDark },
        animationEnabled: false,
      } as any}
    >
      <Drawer.Screen name="TeacherDashboard" component={TeacherDashboardScreen} />
      <Drawer.Screen name="TeacherStudents" component={TeacherStudentsScreen} />
      <Drawer.Screen name="TeacherAttendance" component={TeacherAttendanceScreen} />
      <Drawer.Screen name="TeacherAssignments" component={TeacherAssignmentsScreen} />
      <Drawer.Screen name="TeacherChallenges" component={TeacherChallengesScreen} />
      <Drawer.Screen name="TeacherSchedule" component={TeacherScheduleScreen} />
      <Drawer.Screen name="TeacherProgress" component={TeacherProgressScreen} />
      <Drawer.Screen name="TeacherLearningPaths" component={TeacherLearningPathsScreen} />
      <Drawer.Screen name="TeacherAchievements" component={TeacherAchievementsScreen} />
      <Drawer.Screen name="TeacherHelp" component={TeacherHelpScreen} />
      <Drawer.Screen name="TeacherSettings" component={TeacherSettingsScreen} />
      <Drawer.Screen name="TeacherVideoLibrary" component={TeacherVideoLibraryScreen} />
      <Drawer.Screen name="TeacherMessages" component={TeacherMessagesScreen} />
      <Drawer.Screen name="ProjectDetails" component={ProjectDetailsScreen} />
      <Drawer.Screen name="ChallengeManager" component={ChallengeManagerScreen} />
      <Drawer.Screen name="SuperAdminStudents" component={SuperAdminStudentsScreen} />
      <Drawer.Screen name="StaffSubjectMapping" component={StaffSubjectMappingScreen} />
      <Drawer.Screen name="AnnouncementManager" component={AnnouncementManagerScreen} />
      <Drawer.Screen name="TeacherAnnouncements" component={TeacherAnnouncementsScreen} />
      <Drawer.Screen name="Timetable" component={TimetableScreen} />
      <Drawer.Screen name="Resources" component={ResourcesScreen} />
      <Drawer.Screen name="Channels" component={ChannelsScreen} />
      <Drawer.Screen name="ContentReviewDashboard" component={ContentReviewDashboardScreen} />
    </Drawer.Navigator>
  );
}
