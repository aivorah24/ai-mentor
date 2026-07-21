/**
 * IndependentAccountEmpty — the friendly B2C empty state shown on school-only
 * screens (My Classes, Attendance) when an independent/self-registered user
 * reaches them directly. Instead of a dead-end error, it explains the account
 * type and offers the "Connect to My School" bridge (ConnectSchoolModal).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import ConnectSchoolModal from './ConnectSchoolModal';

export default function IndependentAccountEmpty({ feature = 'this' }: { feature?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [showConnect, setShowConnect] = useState(false);

  return (
    <View style={styles.emptyBox}>
      <View style={styles.iconWrap}><Feather name="layers" size={26} color={colors.textDim} /></View>
      <Text style={styles.title}>You're on an Independent Account</Text>
      <Text style={styles.subtitle}>
        You signed up on your own, so school {feature === 'this' ? 'features like classes and attendance are' : feature + ' is'} hidden.
        You can connect to an official school anytime to unlock them.
      </Text>
      <TouchableOpacity style={styles.actionBtn} onPress={() => setShowConnect(true)} accessibilityRole="button">
        <Feather name="home" size={15} color="#fff" />
        <Text style={styles.actionBtnText}>Connect to My School</Text>
      </TouchableOpacity>

      <ConnectSchoolModal visible={showConnect} onClose={() => setShowConnect(false)} />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    emptyBox: { alignItems: 'center', paddingTop: 56, paddingHorizontal: spacing.xl, gap: 12, maxWidth: 420, alignSelf: 'center' },
    iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: `${c.accentYellow}18`, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    title: { fontFamily: fonts.serif, fontSize: 16, fontWeight: '800', color: c.textHeading, textAlign: 'center' },
    subtitle: { fontFamily: fonts.serif, fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 20 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.accentYellow, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 12, marginTop: 6 },
    actionBtnText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '800', color: '#fff' },
  });
}
