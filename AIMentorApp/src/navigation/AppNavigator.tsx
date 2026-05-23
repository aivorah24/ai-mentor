import React from 'react';
import { useWindowDimensions, View } from 'react-native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { DrawerParamList } from './types';
import { useTheme } from '../context/ThemeContext';
import { useNavigation } from '@react-navigation/native';

import DrawerContent from '../components/common/DrawerContent';
import NotificationBanner from '../components/common/NotificationBanner';
import DashboardScreen from '../screens/student/DashboardScreen';
import ProfileScreen from '../screens/student/ProfileScreen';
import LearningPathsScreen from '../screens/student/LearningPathsScreen';
import AICoachScreen from '../screens/student/AICoachScreen';
import ScheduleScreen from '../screens/student/ScheduleScreen';
import AssignmentsScreen from '../screens/student/AssignmentsScreen';
import ChallengesScreen from '../screens/student/ChallengesScreen';
import LeaderboardScreen from '../screens/student/LeaderboardScreen';
import ProgressScreen from '../screens/student/ProgressScreen';
import HelpCenterScreen from '../screens/student/HelpCenterScreen';
import SettingsScreen from '../screens/student/SettingsScreen';
import VideoLessonScreen from '../screens/student/VideoLessonScreen';
import VideoPlayerScreen from '../screens/student/VideoPlayerScreen';
import NCERTChaptersScreen from '../screens/student/NCERTChaptersScreen';
import SubjectTopicsScreen from '../screens/student/SubjectTopicsScreen';
import Learn5EScreen from '../screens/student/Learn5EScreen';
import MathHelperScreen from '../screens/student/MathHelperScreen';
import AIStorytellerScreen from '../screens/student/AIStorytellerScreen';
import DrawingBuddyScreen from '../screens/student/DrawingBuddyScreen';
import WordWizardScreen from '../screens/student/WordWizardScreen';
import RewardsScreen from '../screens/student/RewardsScreen';
import IBPYPQuizScreen from '../screens/student/IBPYPQuizScreen';
import WorldAndYouScreen from '../screens/student/WorldAndYouScreen';
import TopicLessonScreen from '../screens/student/TopicLessonScreen';
import BhagavathaStoriesScreen from '../screens/student/BhagavathaStoriesScreen';
import StoryReaderScreen from '../screens/student/StoryReaderScreen';
import DailyHabitsScreen from '../screens/student/DailyHabitsScreen';
import SubscriptionScreen from '../screens/student/SubscriptionScreen';
import MessagesScreen from '../screens/shared/MessagesScreen';

const Drawer = createDrawerNavigator<DrawerParamList>();

export default function AppNavigator() {
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 768;
  const { colors } = useTheme();
  // useNavigation here is scoped to the Drawer navigator since AppNavigator
  // is rendered as a child of NavigationContainer → gives us drawer nav.
  const navigation = useNavigation<any>();

  return (
    <View style={{ flex: 1 }}>
    <Drawer.Navigator
      initialRouteName="Dashboard"
      backBehavior="history"
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        // On tablet/desktop: permanent sidebar via ScreenLayout, hide drawer
        drawerType: isLargeScreen ? 'permanent' : 'slide',
        drawerStyle: isLargeScreen
          ? { width: 0, opacity: 0, pointerEvents: 'none' as const } // Hidden — ScreenLayout renders sidebar
          : { width: 260, backgroundColor: colors.sidebarDark },
        overlayColor: 'rgba(0,0,0,0.5)',
        swipeEnabled: !isLargeScreen,
        sceneContainerStyle: { backgroundColor: colors.bgDark },
        animationEnabled: false,
      } as any}
    >
      <Drawer.Screen name="Dashboard" component={DashboardScreen} />
      <Drawer.Screen name="Profile" component={ProfileScreen} />
      <Drawer.Screen name="LearningPaths" component={LearningPathsScreen} />
      <Drawer.Screen name="AICoach" component={AICoachScreen} />
      <Drawer.Screen name="Schedule" component={ScheduleScreen} />
      <Drawer.Screen name="Assignments" component={AssignmentsScreen} />
      <Drawer.Screen name="Challenges" component={ChallengesScreen} />
      <Drawer.Screen name="Leaderboard" component={LeaderboardScreen} />
      <Drawer.Screen name="Progress" component={ProgressScreen} />
      <Drawer.Screen name="Rewards" component={RewardsScreen} />
      <Drawer.Screen name="HelpCenter" component={HelpCenterScreen} />
      <Drawer.Screen name="Settings" component={SettingsScreen} />
      <Drawer.Screen name="VideoLesson" component={VideoLessonScreen} />
      <Drawer.Screen name="VideoPlayer" component={VideoPlayerScreen} />
      <Drawer.Screen name="NCERTChapters" component={NCERTChaptersScreen} />
      <Drawer.Screen name="SubjectTopics" component={SubjectTopicsScreen} />
      <Drawer.Screen name="Learn5E" component={Learn5EScreen} />
      <Drawer.Screen name="MathHelper" component={MathHelperScreen} />
      <Drawer.Screen name="AIStoryteller" component={AIStorytellerScreen} />
      <Drawer.Screen name="DrawingBuddy" component={DrawingBuddyScreen} />
      <Drawer.Screen name="WordWizard" component={WordWizardScreen} />
      <Drawer.Screen name="IBPYPQuiz" component={IBPYPQuizScreen} />
      <Drawer.Screen name="WorldAndYou" component={WorldAndYouScreen} />
      <Drawer.Screen name="TopicLesson" component={TopicLessonScreen} />
      <Drawer.Screen name="BhagavathaStories" component={BhagavathaStoriesScreen} />
      <Drawer.Screen name="StoryReader" component={StoryReaderScreen} />
      <Drawer.Screen name="DailyHabits" component={DailyHabitsScreen} />
      <Drawer.Screen name="Subscription" component={SubscriptionScreen} />
      <Drawer.Screen name="Messages" component={MessagesScreen} />
    </Drawer.Navigator>
    <NotificationBanner
      onNavigate={(screen, params) => navigation.navigate(screen, params)}
    />
    </View>
  );
}
