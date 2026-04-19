import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';

const MODULES = [
  {
    id: '1', title: 'AI in Education — Module 1', subtitle: 'Introduction to AI-Powered Learning',
    lessons: 6, completed: 6, duration: '2h 40m', color: '#6366f1',
    tags: ['Foundations', 'AI Basics'],
    description: 'Understand how AI personalises learning and what it means for the modern classroom.',
  },
  {
    id: '2', title: 'AI in Education — Module 2', subtitle: 'Adaptive Assessment Strategies',
    lessons: 8, completed: 8, duration: '3h 20m', color: '#10b981',
    tags: ['Assessment', 'Data'],
    description: 'Learn to interpret AI-generated student performance data and adapt your teaching.',
  },
  {
    id: '3', title: 'AI in Education — Module 3', subtitle: 'Personalised Learning Design',
    lessons: 10, completed: 4, duration: '4h 10m', color: '#f59e0b',
    tags: ['Curriculum', 'Design'],
    description: 'Design learning paths that meet every student at their current level.',
    current: true,
  },
  {
    id: '4', title: 'AI in Education — Module 4', subtitle: 'Parent-Teacher Collaboration with AI',
    lessons: 7, completed: 0, duration: '2h 55m', color: '#8b5cf6',
    tags: ['Communication', 'Parents'],
    description: 'Use AI insights to communicate student progress effectively with families.',
    locked: true,
  },
  {
    id: '5', title: 'AI in Education — Module 5', subtitle: 'Ethical AI & Digital Wellbeing',
    lessons: 5, completed: 0, duration: '2h 00m', color: '#06b6d4',
    tags: ['Ethics', 'Safety'],
    description: 'Navigate bias, privacy, and responsible AI use in K-12 environments.',
    locked: true,
  },
];

const UPCOMING = [
  { title: 'Differentiated Instruction Workshop', date: 'Apr 5', duration: '90 min', type: 'Live' },
  { title: 'Maths Teaching Strategies Webinar', date: 'Apr 12', duration: '60 min', type: 'Webinar' },
];

const BADGES = [
  { icon: 'star', label: 'AI Pioneer', color: '#f59e0b', earned: true },
  { icon: 'award', label: 'Master Educator', color: '#6366f1', earned: true },
  { icon: 'shield', label: 'Mentor Pro', color: '#10b981', earned: false },
  { icon: 'zap', label: 'Tech Leader', color: '#8b5cf6', earned: false },
];

export default function TeacherLearningPathsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [expandedId, setExpandedId] = useState<string | null>('3');

  const completedModules = MODULES.filter(m => m.completed === m.lessons).length;
  const totalLessons = MODULES.reduce((a, m) => a + m.lessons, 0);
  const doneLessons = MODULES.reduce((a, m) => a + m.completed, 0);
  const overallPct = Math.round((doneLessons / totalLessons) * 100);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Learning Paths"
          subtitle="Your professional development journey"
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* Progress Summary */}
          <View style={styles.heroCard}>
            <View style={styles.heroLeft}>
              <Text style={styles.heroLabel}>AI IN EDUCATION PROGRAMME</Text>
              <Text style={styles.heroTitle}>Professional Development</Text>
              <Text style={styles.heroSub}>{completedModules}/{MODULES.length} modules complete · {overallPct}% overall</Text>
              <View style={styles.heroBar}>
                <View style={[styles.heroFill, { width: `${overallPct}%` as any }]} />
              </View>
              <Text style={styles.heroXp}>{doneLessons} / {totalLessons} lessons completed</Text>
            </View>
            <View style={styles.heroRight}>
              <Text style={[styles.heroPct, { color: colors.primary }]}>{overallPct}%</Text>
              <Text style={styles.heroSuffix}>done</Text>
            </View>
          </View>

          {/* Badges */}
          <View style={styles.badgesCard}>
            <Text style={styles.sectionTitle}>Your Badges</Text>
            <View style={styles.badgesRow}>
              {BADGES.map(b => (
                <View key={b.label} style={[styles.badge, !b.earned && styles.badgeLocked]}>
                  <View style={[styles.badgeIcon, { backgroundColor: b.earned ? b.color + '25' : colors.borderColor }]}>
                    <Feather name={b.icon as any} size={18} color={b.earned ? b.color : colors.textDim} />
                  </View>
                  <Text style={[styles.badgeLabel, !b.earned && styles.badgeLabelLocked]}>{b.label}</Text>
                  {!b.earned && <Feather name="lock" size={10} color={colors.textDim} />}
                </View>
              ))}
            </View>
          </View>

          {/* Module List */}
          <Text style={styles.sectionTitle}>Course Modules</Text>
          {MODULES.map(m => {
            const pct = Math.round((m.completed / m.lessons) * 100);
            const isExpanded = expandedId === m.id;
            const isDone = m.completed === m.lessons;

            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.moduleCard, m.current && styles.moduleCardCurrent]}
                activeOpacity={0.85}
                onPress={() => !m.locked && setExpandedId(isExpanded ? null : m.id)}
              >
                {m.current && <View style={[styles.moduleAccent, { backgroundColor: m.color }]} />}
                <View style={styles.moduleBody}>
                  {/* Header */}
                  <View style={styles.moduleTop}>
                    <View style={[styles.moduleIconWrap, { backgroundColor: m.color + '20' }]}>
                      {isDone ? (
                        <Feather name="check-circle" size={20} color={m.color} />
                      ) : m.locked ? (
                        <Feather name="lock" size={18} color={colors.textDim} />
                      ) : (
                        <Feather name="book-open" size={20} color={m.color} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.moduleMeta}>
                        {m.current && (
                          <View style={[styles.currentPill, { backgroundColor: m.color + '20', borderColor: m.color + '50' }]}>
                            <Text style={[styles.currentText, { color: m.color }]}>In Progress</Text>
                          </View>
                        )}
                        {isDone && (
                          <View style={styles.donePill}>
                            <Text style={styles.doneText}>Completed</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.moduleTitle, m.locked && { color: colors.textDim }]}>{m.title}</Text>
                      <Text style={styles.moduleSub}>{m.subtitle}</Text>
                    </View>
                    {!m.locked && (
                      <Feather name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textDim} />
                    )}
                  </View>

                  {/* Tags */}
                  <View style={styles.tagsRow}>
                    {m.tags.map(t => (
                      <View key={t} style={styles.tag}>
                        <Text style={styles.tagText}>{t}</Text>
                      </View>
                    ))}
                    <Text style={styles.moduleInfo}>{m.lessons} lessons · {m.duration}</Text>
                  </View>

                  {/* Progress bar (not for locked) */}
                  {!m.locked && (
                    <View style={styles.progressWrap}>
                      <View style={styles.progressBg}>
                        <View style={[styles.progressFill, { width: `${pct}%` as any, backgroundColor: m.color }]} />
                      </View>
                      <Text style={[styles.progressPct, { color: m.color }]}>{pct}%</Text>
                    </View>
                  )}

                  {/* Expanded */}
                  {isExpanded && !m.locked && (
                    <View style={styles.expandedSection}>
                      <View style={styles.divider} />
                      <Text style={styles.expandedDesc}>{m.description}</Text>
                      <Text style={styles.lessonCount}>{m.completed} of {m.lessons} lessons completed</Text>
                      <TouchableOpacity style={[styles.continueBtn, { backgroundColor: m.color }]} activeOpacity={0.85}>
                        <Feather name={isDone ? 'rotate-ccw' : 'play'} size={14} color="#fff" />
                        <Text style={styles.continueBtnText}>{isDone ? 'Review Module' : 'Continue Learning'}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Upcoming Events */}
          <Text style={styles.sectionTitle}>Upcoming Events</Text>
          {UPCOMING.map(ev => (
            <View key={ev.title} style={styles.eventCard}>
              <View style={styles.eventDateBox}>
                <Text style={styles.eventMonth}>{ev.date.split(' ')[0]}</Text>
                <Text style={styles.eventDay}>{ev.date.split(' ')[1]}</Text>
              </View>
              <View style={styles.eventInfo}>
                <Text style={styles.eventTitle}>{ev.title}</Text>
                <Text style={styles.eventMeta}>{ev.duration} · {ev.type}</Text>
              </View>
              <TouchableOpacity style={styles.joinBtn} activeOpacity={0.8}>
                <Text style={styles.joinText}>Register</Text>
              </TouchableOpacity>
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

  heroCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
  },
  heroLeft: { flex: 1 },
  heroLabel: { fontSize: 10, fontWeight: '800', color: c.primary, letterSpacing: 0.8, marginBottom: 4 },
  heroTitle: { fontSize: 18, fontWeight: '800', color: c.textMain, marginBottom: 4 },
  heroSub: { fontSize: 12, color: c.textMuted, marginBottom: spacing.md },
  heroBar: { height: 6, backgroundColor: c.borderColor, borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  heroFill: { height: '100%', backgroundColor: c.primary, borderRadius: 3 },
  heroXp: { fontSize: 11, color: c.textDim },
  heroRight: { alignItems: 'center' },
  heroPct: { fontSize: 38, fontWeight: '900', letterSpacing: -2 },
  heroSuffix: { fontSize: 12, color: c.textDim, marginTop: -4 },

  badgesCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.textMain },
  badgesRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  badge: { alignItems: 'center', gap: 5, width: 70 },
  badgeLocked: { opacity: 0.45 },
  badgeIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  badgeLabel: { fontSize: 10, fontWeight: '600', color: c.textMain, textAlign: 'center' },
  badgeLabelLocked: { color: c.textDim },

  moduleCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, overflow: 'hidden', flexDirection: 'row',
  },
  moduleCardCurrent: { borderColor: c.primary + '50' },
  moduleAccent: { width: 4 },
  moduleBody: { flex: 1, padding: spacing.lg, gap: spacing.md },
  moduleTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  moduleIconWrap: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  moduleMeta: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  currentPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  currentText: { fontSize: 10, fontWeight: '700' },
  donePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: c.accentGreen + '20' },
  doneText: { fontSize: 10, fontWeight: '700', color: c.accentGreen },
  moduleTitle: { fontSize: 14, fontWeight: '700', color: c.textMain },
  moduleSub: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  tagsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tag: { backgroundColor: c.bgDark, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: c.borderColor },
  tagText: { fontSize: 10, color: c.textDim, fontWeight: '600' },
  moduleInfo: { fontSize: 11, color: c.textDim, marginLeft: 'auto' },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressBg: { flex: 1, height: 5, backgroundColor: c.borderColor, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressPct: { fontSize: 11, fontWeight: '700', width: 30, textAlign: 'right' },
  expandedSection: { gap: spacing.md },
  divider: { height: 1, backgroundColor: c.borderColor },
  expandedDesc: { fontSize: 13, color: c.textMuted, lineHeight: 20 },
  lessonCount: { fontSize: 12, color: c.textDim },
  continueBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    padding: 12, borderRadius: radius.md,
  },
  continueBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  eventCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.lg,
  },
  eventDateBox: {
    width: 44, alignItems: 'center', backgroundColor: c.primaryGlow,
    borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: c.primary + '30',
  },
  eventMonth: { fontSize: 10, fontWeight: '700', color: c.primary },
  eventDay: { fontSize: 18, fontWeight: '900', color: c.primary },
  eventInfo: { flex: 1 },
  eventTitle: { fontSize: 14, fontWeight: '700', color: c.textMain },
  eventMeta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  joinBtn: {
    backgroundColor: c.primaryGlow, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderWidth: 1, borderColor: c.primary + '40',
  },
  joinText: { fontSize: 12, fontWeight: '700', color: c.primary },
});
