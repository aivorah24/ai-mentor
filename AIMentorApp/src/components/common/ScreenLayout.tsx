import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useResponsive } from '../../hooks/useResponsive';
import Sidebar from './Sidebar';
import { useTheme } from '../../context/ThemeContext';
import type { AppColors } from '../../theme';

interface ScreenLayoutProps {
  children: React.ReactNode;
}

/**
 * Wraps screen content with a permanent sidebar on tablet/desktop,
 * and just the content on mobile (drawer handles navigation there).
 */
export default function ScreenLayout({ children }: ScreenLayoutProps) {
  const { showPermanentSidebar } = useResponsive();
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!showPermanentSidebar) {
    // Mobile: no sidebar, drawer handles it
    return <View style={styles.mobileContainer}>{children}</View>;
  }

  return (
    <View style={styles.desktopContainer}>
      <Sidebar
        currentScreen={route.name}
        onNavigate={(screen) => navigation.navigate(screen)}
      />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  mobileContainer: {
    flex: 1,
    backgroundColor: c.bgDark,
  },
  desktopContainer: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: c.bgDark,
  },
  content: {
    flex: 1,
    backgroundColor: c.bgDark,
    overflow: 'hidden',
  },
});
