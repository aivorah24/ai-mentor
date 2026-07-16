/**
 * Generic placeholder for School Admin nav items that exist in the approved
 * Claude Design IA (Bulk Import, Grades & Sections, Classes, Promotions) but
 * have no backend yet. Shown honestly as "not built yet" rather than faked
 * with sample data — keeps the full navigation shape from the design while
 * respecting the no-fake-functionality rule.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';

export default function SchoolAdminComingSoonScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { title, description, icon } = route?.params || {};

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title={title || 'Coming Soon'} onMenuPress={() => navigation?.openDrawer?.()} />
        <View style={styles.body}>
          <View style={styles.iconWrap}>
            <Feather name={(icon || 'clock') as any} size={26} color={colors.accentYellow} />
          </View>
          <Text style={styles.title}>{title || 'Coming soon'}</Text>
          <Text style={styles.desc}>
            {description || 'This part of the console is on our roadmap and not available yet.'}
          </Text>
          <View style={styles.badge}>
            <Feather name="tool" size={12} color={colors.textDim} />
            <Text style={styles.badgeText}>Not built yet</Text>
          </View>
        </View>
      </View>
    </ScreenLayout>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: 10 },
    iconWrap: {
      width: 56, height: 56, borderRadius: 28, backgroundColor: `${colors.accentYellow}18`,
      alignItems: 'center', justifyContent: 'center', marginBottom: 6,
    },
    title: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '700', color: colors.textHeading },
    desc: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center', maxWidth: 380, lineHeight: 19 },
    badge: {
      flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
      borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.cardDark,
    },
    badgeText: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '600', color: colors.textDim },
  });
}
