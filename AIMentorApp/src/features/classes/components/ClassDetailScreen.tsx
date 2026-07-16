/**
 * Class detail — the Class Portfolio feed for one grade+section. Announcements
 * and Assignments already have their own dedicated nav entries/screens
 * elsewhere in the app, so this screen doesn't duplicate them — Portfolio is
 * the one thing that's genuinely new and specific to a class.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Header from '../../../components/common/Header';
import ScreenLayout from '../../../components/common/ScreenLayout';
import { useTheme } from '../../../context/ThemeContext';
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
        <PortfolioFeed grade={grade} section={section} classTeacherEmail={classTeacherEmail} initialOpenPostId={postId} />
      </View>
    </ScreenLayout>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
  });
}
