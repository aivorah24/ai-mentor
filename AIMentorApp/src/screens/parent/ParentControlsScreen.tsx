import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';

export default function ParentControlsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="Parental Controls" subtitle="Manage screen time and access" searchPlaceholder="Search..." onMenuPress={() => navigation.openDrawer()} />
        <View style={styles.center}>
          <Feather name="shield" size={48} color={colors.textDim} />
          <Text style={styles.title}>Parental Controls</Text>
          <Text style={styles.sub}>Set screen time limits, restrict content, and manage device access for your children.</Text>
        </View>
      </View>
    </ScreenLayout>
  );
}
const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  title: { fontSize: 18, fontWeight: '700', color: c.textMain },
  sub: { fontSize: 13, color: c.textMuted, textAlign: 'center' },
});
