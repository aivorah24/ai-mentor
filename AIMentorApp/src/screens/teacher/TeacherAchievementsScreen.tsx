import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';

const ACHIEVEMENTS = [
  { icon: 'star', title: 'First Assignment', desc: 'Created your first assignment', color: '#f59e0b', earned: true, date: 'Mar 10' },
  { icon: 'users', title: 'Class Builder', desc: 'Enrolled 10+ students', color: '#6366f1', earned: true, date: 'Mar 15' },
  { icon: 'award', title: 'Top Educator', desc: 'Class average above 80%', color: '#10b981', earned: true, date: 'Mar 20' },
  { icon: 'zap', title: 'Streak Master', desc: 'Active for 30 consecutive days', color: '#8b5cf6', earned: false, date: '' },
  { icon: 'target', title: 'Challenge Champion', desc: 'Run 5 challenges with 90%+ completion', color: '#ef4444', earned: false, date: '' },
  { icon: 'trending-up', title: 'Growth Coach', desc: 'Help 5 at-risk students get back on track', color: '#06b6d4', earned: false, date: '' },
];

const STATS = [
  { label: 'Earned', value: 3, color: '#f59e0b' },
  { label: 'Remaining', value: 3, color: '#94a3b8' },
  { label: 'Points', value: 850, color: '#6366f1' },
];

export default function TeacherAchievementsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="Achievements" subtitle="Your teaching milestones" onMenuPress={() => navigation.openDrawer()} />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* Stats */}
          <View style={styles.statsRow}>
            {STATS.map(s => (
              <View key={s.label} style={styles.statCard}>
                <Text style={[styles.statVal, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Progress */}
          <View style={styles.progressCard}>
            <Text style={styles.progressLabel}>Achievement Progress</Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: '50%' }]} />
            </View>
            <Text style={styles.progressSub}>3 of 6 achievements unlocked · Keep going!</Text>
          </View>

          <Text style={styles.sectionTitle}>All Achievements</Text>

          {ACHIEVEMENTS.map(a => (
            <View key={a.title} style={[styles.card, !a.earned && styles.cardLocked]}>
              <View style={[styles.iconWrap, { backgroundColor: a.earned ? a.color + '22' : colors.borderColor }]}>
                <Feather name={a.icon as any} size={22} color={a.earned ? a.color : colors.textDim} />
              </View>
              <View style={styles.cardInfo}>
                <Text style={[styles.cardTitle, !a.earned && { color: colors.textDim }]}>{a.title}</Text>
                <Text style={styles.cardDesc}>{a.desc}</Text>
                {a.earned && <Text style={styles.earnedDate}>Earned {a.date}</Text>}
              </View>
              {a.earned ? (
                <Feather name="check-circle" size={18} color={colors.accentGreen} />
              ) : (
                <Feather name="lock" size={16} color={colors.textDim} />
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.lg },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: {
    flex: 1, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.lg, padding: spacing.md, alignItems: 'center', gap: 2,
  },
  statVal: { fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  statLabel: { fontSize: 11, color: c.textDim, fontWeight: '500' },
  progressCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm,
  },
  progressLabel: { fontSize: 13, fontWeight: '700', color: c.textMain },
  progressBar: { height: 8, backgroundColor: c.borderColor, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: c.primary, borderRadius: 4 },
  progressSub: { fontSize: 12, color: c.textMuted },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.textMain },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.lg,
  },
  cardLocked: { opacity: 0.55 },
  iconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: c.textMain },
  cardDesc: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  earnedDate: { fontSize: 11, color: c.accentGreen, marginTop: 4, fontWeight: '600' },
});
