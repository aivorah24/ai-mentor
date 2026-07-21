/**
 * ConnectSchoolBanner — a reliable, always-reachable entry to the B2C → B2B
 * bridge. Since B2C users have My Classes / Attendance hidden from their menu,
 * they may never hit the IndependentAccountEmpty state — so Settings carries
 * this banner as the guaranteed path to "Connect to My School".
 *
 * Self-gating: renders nothing for B2B (school-linked) or admin accounts, so
 * screens can drop it in unconditionally.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import ConnectSchoolModal from './ConnectSchoolModal';

export default function ConnectSchoolBanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const [showConnect, setShowConnect] = useState(false);

  // Only independent (B2C) student/teacher/parent accounts see this.
  const role = user?.role;
  const isB2C = !user?.schoolId && (role === 'student' || role === 'teacher' || role === 'parent');
  if (!isB2C) return null;

  return (
    <View style={styles.banner}>
      <View style={styles.iconWrap}><Feather name="home" size={16} color={colors.accentYellow} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title}>Join a School Classroom</Text>
        <Text style={styles.subtitle}>Connect to your official school to unlock classes, attendance, and school updates.</Text>
      </View>
      <TouchableOpacity style={styles.btn} onPress={() => setShowConnect(true)} accessibilityRole="button">
        <Text style={styles.btnText}>Connect</Text>
      </TouchableOpacity>

      <ConnectSchoolModal visible={showConnect} onClose={() => setShowConnect(false)} />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.accentYellow + '55',
      borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg,
    },
    iconWrap: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: `${c.accentYellow}22`, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    title: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '800', color: c.textHeading },
    subtitle: { fontFamily: fonts.serif, fontSize: 12, color: c.textMuted, marginTop: 2, lineHeight: 17 },
    btn: { backgroundColor: c.accentYellow, borderRadius: radius.sm, paddingHorizontal: 16, paddingVertical: 9, flexShrink: 0 },
    btnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '800', color: '#fff' },
  });
}
