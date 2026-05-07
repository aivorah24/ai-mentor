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
  const { toastVisible, latestNotif, unreadAssignments, unreadChallenges, dismissToast } = useNotification();
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

  if (hasMsg) {
    icon = 'message-square';
    iconColor = colors.primary;
    title = `Message from ${latestNotif!.senderName}`;
    subtitle = latestNotif!.preview || 'Tap to read';
    targetScreen = msgScreen;
  } else if (hasAssign) {
    icon = 'check-square';
    iconColor = colors.accentBlue;
    title = unreadAssignments === 1 ? 'New assignment' : `${unreadAssignments} new assignments`;
    subtitle = 'Tap to view your assignments';
    targetScreen = assignScreen;
  } else if (hasChallenge) {
    icon = 'award';
    iconColor = colors.accentPurple;
    title = unreadChallenges === 1 ? 'New challenge' : `${unreadChallenges} new challenges`;
    subtitle = 'Tap to view your challenges';
    targetScreen = challengeScreen;
    targetParams = { tab: 'assigned' };
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
      <TouchableOpacity style={styles.inner} onPress={handleTap} activeOpacity={0.85}>
        {/* Icon */}
        <View style={[styles.iconWrap, { backgroundColor: iconColor + '22' }]}>
          <Feather name={icon as any} size={18} color={iconColor} />
        </View>

        {/* Text */}
        <View style={styles.textWrap}>
          <View style={styles.titleRow}>
            <View style={[styles.dot, { backgroundColor: iconColor }]} />
            <Text style={[styles.appName, { color: iconColor }]}>Aivorah</Text>
          </View>
          <Text style={[styles.title, { color: colors.textMain }]} numberOfLines={1}>{title}</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={2}>{subtitle}</Text>
        </View>

        {/* Dismiss */}
        <TouchableOpacity onPress={dismissToast} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={14} color={colors.textDim} />
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
    top: Platform.OS === 'web' ? 56 : 80,   // sits just below the header/bell row
    right: 12,
    width: 320,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
    zIndex: 9999,
    overflow: 'hidden',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  appName: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  closeBtn: {
    padding: 4,
    alignSelf: 'flex-start',
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
  },
  progressBar: {
    height: 3,
    borderRadius: 2,
  },
});
