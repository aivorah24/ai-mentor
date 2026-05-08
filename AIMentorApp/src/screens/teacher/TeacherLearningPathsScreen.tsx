import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';

const COMING_SOON_PATHS = [
  { icon: 'cpu', label: 'AI in Education', desc: 'How to use AI tools effectively in the classroom' },
  { icon: 'bar-chart-2', label: 'Adaptive Assessment', desc: 'Data-driven strategies to personalise student assessment' },
  { icon: 'layers', label: 'Curriculum Design', desc: 'Building personalised learning paths for every student' },
  { icon: 'users', label: 'Parent Collaboration', desc: 'Communicating student progress with AI-backed insights' },
  { icon: 'shield', label: 'Ethical AI & Safety', desc: 'Responsible AI use, privacy, and digital wellbeing in K-12' },
];

export default function TeacherLearningPathsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Learning Paths"
          subtitle="Professional development for educators"
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* Coming Soon Hero */}
          <View style={styles.heroBanner}>
            <View style={styles.heroIconWrap}>
              <Feather name="book-open" size={32} color={colors.primary} />
            </View>
            <Text style={styles.heroTitle}>Coming Soon</Text>
            <Text style={styles.heroSub}>
              We're building a dedicated professional development programme for Aivorah educators.
              These courses will help you get the most out of AI-powered teaching.
            </Text>
            <View style={styles.comingSoonBadge}>
              <Feather name="clock" size={12} color={colors.accentYellow} />
              <Text style={styles.comingSoonBadgeText}>Launching soon</Text>
            </View>
          </View>

          {/* Planned Courses */}
          <Text style={styles.sectionTitle}>Planned Courses</Text>
          <View style={styles.pathList}>
            {COMING_SOON_PATHS.map((p, i) => (
              <View key={i} style={styles.pathCard}>
                <View style={styles.pathIconWrap}>
                  <Feather name={p.icon as any} size={18} color={colors.primary} />
                </View>
                <View style={styles.pathInfo}>
                  <Text style={styles.pathLabel}>{p.label}</Text>
                  <Text style={styles.pathDesc}>{p.desc}</Text>
                </View>
                <View style={styles.lockedBadge}>
                  <Feather name="lock" size={11} color={colors.textDim} />
                </View>
              </View>
            ))}
          </View>

          {/* Info note */}
          <View style={styles.infoBox}>
            <Feather name="info" size={14} color={colors.accentCyan} />
            <Text style={styles.infoText}>
              You'll be notified when courses go live. Content is being curated specifically for IB PYP and CBSE educators.
            </Text>
          </View>

        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:   { flex: 1, backgroundColor: c.bgDark },
  scroll:   { flex: 1 },
  content:  { padding: spacing.xl, paddingBottom: 48, gap: spacing.xl },

  heroBanner: {
    backgroundColor: c.cardDark,
    borderWidth: 1,
    borderColor: c.borderColor,
    borderRadius: radius.xl,
    padding: spacing.xxxl,
    alignItems: 'center',
    gap: spacing.md,
  },
  heroIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: c.primaryGlow,
    borderWidth: 1,
    borderColor: c.primary + '40',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  heroTitle: {
    fontSize: 24, fontWeight: '700', color: c.textMain, letterSpacing: -0.4,
  },
  heroSub: {
    fontSize: 14, color: c.textMuted, textAlign: 'center', lineHeight: 22,
    maxWidth: 420,
  },
  comingSoonBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.accentYellow + '18',
    borderWidth: 1, borderColor: c.accentYellow + '40',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    marginTop: spacing.sm,
  },
  comingSoonBadgeText: { fontSize: 12, fontWeight: '600', color: c.accentYellow },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.6 },

  pathList: { gap: spacing.sm },
  pathCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: c.cardDark,
    borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  pathIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: c.primaryGlow,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  pathInfo: { flex: 1, gap: 3 },
  pathLabel: { fontSize: 14, fontWeight: '600', color: c.textMain },
  pathDesc:  { fontSize: 12, color: c.textMuted, lineHeight: 17 },
  lockedBadge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: c.cardHover,
    borderWidth: 1, borderColor: c.borderColor,
    alignItems: 'center', justifyContent: 'center',
  },

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: c.accentCyan + '10',
    borderWidth: 1, borderColor: c.accentCyan + '30',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  infoText: { fontSize: 13, color: c.accentCyan, flex: 1, lineHeight: 19 },
});
