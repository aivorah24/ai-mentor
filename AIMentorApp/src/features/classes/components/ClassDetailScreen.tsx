/**
 * Class detail — the Class Portfolio feed for one grade+section. Announcements
 * and Assignments already have their own dedicated nav entries/screens
 * elsewhere in the app, so this screen doesn't duplicate them — Portfolio is
 * the one thing that's genuinely new and specific to a class.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Header from '../../../components/common/Header';
import ScreenLayout from '../../../components/common/ScreenLayout';
import { useTheme } from '../../../context/ThemeContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import PortfolioFeed from '../../class-portfolio/components/PortfolioFeed';

export default function ClassDetailScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { grade, section, label, code, classTeacherEmail, postId } = route?.params || {};

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title={label || 'Class'} subtitle={code || ''} onMenuPress={() => navigation?.openDrawer?.()} />
        {/* Quick link to this class's weekly timetable (opened scoped to grade+section) */}
        <TouchableOpacity
          style={styles.ttLink}
          activeOpacity={0.8}
          accessibilityRole="button"
          onPress={() => navigation?.navigate?.('Timetable', { grade, section, label })}
        >
          <Feather name="clock" size={15} color={colors.accentYellow} />
          <Text style={styles.ttLinkText}>View weekly timetable</Text>
          <Feather name="chevron-right" size={16} color={colors.textDim} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>
        <PortfolioFeed grade={grade} section={section} classTeacherEmail={classTeacherEmail} initialOpenPostId={postId} />
      </View>
    </ScreenLayout>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    ttLink: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md,
      borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.cardDark,
    },
    ttLinkText: { fontFamily: fonts.serif, fontSize: 13.5, fontWeight: '700', color: colors.textHeading },
  });
}
