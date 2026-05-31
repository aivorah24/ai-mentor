import React from 'react';
import { useWindowDimensions } from 'react-native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { ParentDrawerParamList } from './types';
import { useTheme } from '../context/ThemeContext';

import DrawerContent from '../components/common/DrawerContent';
import DashboardScreen from '../screens/student/DashboardScreen';
import ParentDashboardScreen from '../screens/parent/ParentDashboardScreen';
import ParentProfileScreen from '../screens/parent/ParentProfileScreen';
import ParentMyKidsScreen from '../screens/parent/ParentMyKidsScreen';
import ParentScheduleScreen from '../screens/parent/ParentScheduleScreen';
import ParentLearningScreen from '../screens/parent/ParentLearningScreen';
import ParentAssignmentsScreen from '../screens/parent/ParentAssignmentsScreen';
import ParentChallengesScreen from '../screens/parent/ParentChallengesScreen';
import ParentLeaderboardScreen from '../screens/parent/ParentLeaderboardScreen';
import ParentProgressScreen from '../screens/parent/ParentProgressScreen';
import ParentAIReportsScreen from '../screens/parent/ParentAIReportsScreen';
import ParentControlsScreen from '../screens/parent/ParentControlsScreen';
import ParentSettingsScreen from '../screens/parent/ParentSettingsScreen';
import ParentHelpScreen from '../screens/parent/ParentHelpScreen';
import ParentMessagesScreen from '../screens/parent/ParentMessagesScreen';
import ParentDailyTasksScreen from '../screens/parent/ParentDailyTasksScreen';

const Drawer = createDrawerNavigator<ParentDrawerParamList>();

export default function ParentNavigator() {
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 768;
  const { colors } = useTheme();

  return (
    <Drawer.Navigator
      initialRouteName="ParentDashboard"
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
      <Drawer.Screen name="ParentDashboard" component={ParentDashboardScreen} />
      <Drawer.Screen name="ParentStudentView" component={DashboardScreen} />
      <Drawer.Screen name="ParentProfile" component={ParentProfileScreen} />
      <Drawer.Screen name="ParentMyKids" component={ParentMyKidsScreen} />
      <Drawer.Screen name="ParentSchedule" component={ParentScheduleScreen} />
      <Drawer.Screen name="ParentLearning" component={ParentLearningScreen} />
      <Drawer.Screen name="ParentAssignments" component={ParentAssignmentsScreen} />
      <Drawer.Screen name="ParentChallenges" component={ParentChallengesScreen} />
      <Drawer.Screen name="ParentLeaderboard" component={ParentLeaderboardScreen} />
      <Drawer.Screen name="ParentProgress" component={ParentProgressScreen} />
      <Drawer.Screen name="ParentAIReports" component={ParentAIReportsScreen} />
      <Drawer.Screen name="ParentControls" component={ParentControlsScreen} />
      <Drawer.Screen name="ParentSettings" component={ParentSettingsScreen} />
      <Drawer.Screen name="ParentHelp" component={ParentHelpScreen} />
      <Drawer.Screen name="ParentMessages" component={ParentMessagesScreen} />
      <Drawer.Screen name="ParentDailyTasks" component={ParentDailyTasksScreen} />
    </Drawer.Navigator>
  );
}
