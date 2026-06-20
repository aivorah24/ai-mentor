/**
 * NotificationBanner — slides in from the top when a new notification arrives.
 * Shows for 5 seconds then auto-dismisses. Tapping it navigates to the source.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNotification } from '../../context/NotificationContext';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';

interface Props {
  onNavigate: (screen: string, params?: Record<string, any>) => void;
}

export default function NotificationBanner({ onNavigate }: Props) {
  const { toastVisible, latestNotif, unreadAssignments, unreadChallenges, notificationItems, dismissToast } = useNotification();
  const { colors } = useTheme();
  const { user } = useAuth();

  const slideY  = useRef(new Animated.Value(-20)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);

  const role = user?.role ?? 'student';
  const msgScreen       = role === 'teacher' ? 'TeacherMessages'    : role === 'parent' ? 'ParentMessages'    : 'Messages';
  const assignScreen    = role === 'teacher' ? 'TeacherAssignments' : role === 'parent' ? 'ParentAssignments' : 'Assignments';
  const challengeScreen = role === 'teacher' ? 'TeacherChallenges'  : role === 'parent' ? 'ParentChallenges'  : 'Challenges';

  useEffect(() => {
    if (toastVisible) {
      setVisible(true);
      Animated.parallel([
        Animated.spring(slideY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideY,  { toValue: -20, duration: 250, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0,    duration: 200, useNativeDriver: true }),
      ]).start(() => setVisible(false));
    }
  }, [toastVisible]);

  if (!visible) return null;

  // Determine what to show
  const hasMsg       = !!latestNotif;
  const hasAssign    = unreadAssignments > 0;
  const hasChallenge = unreadChallenges > 0;

  let icon: string = 'bell';
  let iconColor = colors.primary;
  let title = 'New notification';
  let subtitle = 'Tap to view';
  let targetScreen = msgScreen;
  let targetParams: Record<string, any> | undefined;

  if (hasAssign) {
    icon = 'check-square';
    iconColor = colors.accentBlue;
    // Show the actual assignment title if available
    const latestItem = notificationItems[0];
    title = latestItem
      ? (latestItem.type === 'quiz' ? `New quiz: ${latestItem.title}` : `New assignment: ${latestItem.title}`)
      : (unreadAssignments === 1 ? 'New assignment added' : `${unreadAssignments} new assignments`);
    subtitle = latestItem ? latestItem.subtitle : 'Tap to open your assignments';
    targetScreen = assignScreen;
    // Deep-link straight into the specific assignment (matches the bell dropdown).
    targetParams = latestItem ? { highlightId: latestItem.id } : undefined;
  } else if (hasChallenge) {
    icon = 'award';
    iconColor = colors.accentPurple;
    const latestChallenge = notificationItems.find(i => i.type === 'challenge');
    title = latestChallenge
      ? `New challenge: ${latestChallenge.title}`
      : (unreadChallenges === 1 ? 'New challenge assigned' : `${unreadChallenges} new challenges`);
    subtitle = latestChallenge ? latestChallenge.subtitle : 'Tap to view your challenges';
    targetScreen = challengeScreen;
    // Deep-link straight into the specific challenge (matches the bell dropdown).
    targetParams = latestChallenge ? { highlightId: latestChallenge.id, tab: 'assigned' } : { tab: 'assigned' };
  } else if (hasMsg) {
    icon = 'message-square';
    iconColor = colors.primary;
    title = `Message from ${latestNotif!.senderName}`;
    subtitle = latestNotif!.preview || 'Tap to read';
    targetScreen = msgScreen;
  }

  function handleTap() {
    dismissToast();
    onNavigate(targetScreen, targetParams);
  }

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: colors.cardDark,
          borderColor: colors.borderColor,
          transform: [{ translateY: slideY }],
          opacity,
        },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity style={styles.inner} onPress={handleTap} activeOpacity={0.88}>
        {/* App icon area */}
        <View style={[styles.iconWrap, { backgroundColor: iconColor }]}>
          <Feather name={icon as any} size={20} color="#fff" />
        </View>

        {/* Text */}
        <View style={styles.textWrap}>
          <View style={styles.titleRow}>
            <Text style={[styles.appName, { color: colors.textMuted }]}>AIVORAH</Text>
            <Text style={[styles.timeText, { color: colors.textDim }]}>now</Text>
          </View>
          <Text style={[styles.title, { color: colors.textMain }]} numberOfLines={1}>{title}</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={2}>{subtitle}</Text>
        </View>

        {/* Dismiss */}
        <TouchableOpacity onPress={dismissToast} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="x" size={16} color={colors.textDim} />
        </TouchableOpacity>
      </TouchableOpacity>

      {/* Progress bar */}
      <AutoProgressBar color={iconColor} duration={5000} onComplete={dismissToast} />
    </Animated.View>
  );
}

function AutoProgressBar({ color, duration, onComplete }: { color: string; duration: number; onComplete: () => void }) {
  const width = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.timing(width, {
      toValue: 0,
      duration,
      useNativeDriver: false,
    });
    anim.start(({ finished }) => { if (finished) onComplete(); });
    return () => anim.stop();
  }, []);

  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[styles.progressBar, { backgroundColor: color, flex: width }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 16 : 50,
    left: Platform.OS === 'web' ? undefined : 12,
    right: 12,
    width: Platform.OS === 'web' ? 360 : undefined,
    borderRadius: 18,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 16,
    zIndex: 9999,
    overflow: 'hidden',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textWrap: {
    flex: 1,
    gap: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  appName: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  timeText: {
    fontSize: 11,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 17,
    marginTop: 1,
  },
  closeBtn: {
    padding: 4,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    flexDirection: 'row',
  },
  progressBar: {
    height: 3,
  },
});
