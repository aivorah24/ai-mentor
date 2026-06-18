import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useStudentData } from '../../context/StudentDataContext';
import { useAuth } from '../../context/AuthContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';
import { useResponsive } from '../../hooks/useResponsive';

interface Chapter {
  id: number;
  topic: string;
  unit: string;
  hookQuestion: string;
  textChunks?: number;
  imageChunks?: number;
  chunkCount?: number;
  hasContent: boolean;
  icon?: string;
}

type GradeKey = 'Grade 3' | 'Grade 4' | 'Grade 5';
type CurriculumKey = 'NCERT' | 'IB' | 'CBSE' | 'IGCSE';

const UNIT_ICONS: Record<string, string> = {
  // Mathematics
  Numbers: 'hash',
  'Addition & Subtraction': 'plus',
  Measurement: 'sliders',
  Geometry: 'triangle',
  'Weight & Mass': 'activity',
  Time: 'clock',
  'Multiplication & Division': 'grid',
  Patterns: 'layers',
  Capacity: 'droplet',
  'Division & Fractions': 'pie-chart',
  'Data Handling': 'bar-chart-2',
  Money: 'dollar-sign',
  // Science (EVS)
  'Unit 1 — Our Families and Communities': 'users',
  'Unit 2 — Living Together': 'heart',
  'Unit 3 — Gifts of Nature': 'sun',
  'Unit 4 — Things Around Us': 'box',
};

const UNIT_COLORS: Record<string, string> = {
  // Mathematics
  Numbers: '#6366f1',
  'Addition & Subtraction': '#10b981',
  Measurement: '#f59e0b',
  Geometry: '#3b82f6',
  'Weight & Mass': '#8b5cf6',
  Time: '#06b6d4',
  'Multiplication & Division': '#ec4899',
  Patterns: '#f97316',
  Capacity: '#14b8a6',
  'Division & Fractions': '#a855f7',
  'Data Handling': '#22c55e',
  Money: '#eab308',
  // Science (EVS)
  'Unit 1 — Our Families and Communities': '#f59e0b',
  'Unit 2 — Living Together': '#10b981',
  'Unit 3 — Gifts of Nature': '#06b6d4',
  'Unit 4 — Things Around Us': '#8b5cf6',
};

// math: true  = calculation-heavy chapters (step-by-step solving needed)
// math: false = visual/shape/pattern chapters (Drawing Buddy handles these better)
const CHAPTER_MODULES: Record<number, { math: boolean; drawing: boolean; words: boolean }> = {
  1:  { math: true,  drawing: false, words: false }, // Numbers — reading/recognising
  2:  { math: false, drawing: true,  words: false }, // Shapes and Designs — Drawing Buddy
  3:  { math: true,  drawing: false, words: false }, // Addition & Subtraction
  4:  { math: true,  drawing: true,  words: false }, // Measurement
  5:  { math: false, drawing: true,  words: false }, // Geometry — Drawing Buddy only
  6:  { math: true,  drawing: false, words: false }, // Weight & Mass
  7:  { math: true,  drawing: false, words: true  }, // Time
  8:  { math: true,  drawing: false, words: false }, // Weight & Mass
  9:  { math: true,  drawing: false, words: false }, // Multiplication & Division
  10: { math: false, drawing: true,  words: false }, // Patterns — visual only
  11: { math: true,  drawing: false, words: true  }, // Capacity
  12: { math: true,  drawing: false, words: true  }, // Division & Fractions
  13: { math: false, drawing: true,  words: false }, // Data Handling — charts/visual
  14: { math: true,  drawing: false, words: true  }, // Money
};

const MODULE_DEFS = {
  learn: { label: 'Start Learning', icon: 'zap', color: '#6366f1', route: 'Learn5E' },
  math: { label: 'Math Helper', icon: 'hash', color: '#10b981', route: 'MathHelper' },
  words: { label: 'Word Wizard', icon: 'book', color: '#f59e0b', route: 'WordWizard' },
  draw: { label: 'Drawing Buddy', icon: 'edit-3', color: '#ec4899', route: 'DrawingBuddy' },
};

// CBSE follows the NCERT syllabus, so it's the single NCERT-syllabus option (#157).
const CURRICULUM_OPTIONS: CurriculumKey[] = ['CBSE', 'IB', 'IGCSE'];
const GRADE_OPTIONS: GradeKey[] = ['Grade 3', 'Grade 4', 'Grade 5'];

const CURRICULUM_META: Record<
  CurriculumKey,
  { accent: string; icon: string; sub: string; status: string }
> = {
  NCERT: { accent: '#6366f1', icon: 'book-open', sub: 'National Curriculum', status: 'Active' },
  IB: { accent: '#10b981', icon: 'globe', sub: 'International Baccalaureate', status: 'Coming Soon' },
  CBSE: { accent: '#6366f1', icon: 'book-open', sub: 'NCERT syllabus', status: 'Active' },
  IGCSE: { accent: '#06b6d4', icon: 'award', sub: 'Cambridge Track', status: 'Coming Soon' },
};

const GRADE_META: Record<GradeKey, { accent: string; icon: string }> = {
  'Grade 3': { accent: '#6366f1', icon: 'book' },
  'Grade 4': { accent: '#10b981', icon: 'compass' },
  'Grade 5': { accent: '#f59e0b', icon: 'trending-up' },
};

function ChapterCard({
  ch,
  onModule,
  colors,
  isMobile,
  isDone,
  isScience,
}: {
  ch: Chapter;
  onModule: (route: string) => void;
  colors: AppColors;
  isMobile: boolean;
  isDone: boolean;
  isScience?: boolean;
}) {
  const unitColor = isDone ? '#10b981' : (UNIT_COLORS[ch.unit] ?? colors.primary);
  // Science: Drawing Buddy + Word Wizard (no Math Helper). Math: full module set.
  const mods = isScience
    ? { math: false, drawing: true, words: true }
    : (CHAPTER_MODULES[ch.id] ?? { math: false, drawing: false, words: false });
  const modules = [
    MODULE_DEFS.learn,
    ...(mods.math    ? [MODULE_DEFS.math]  : []),
    ...(mods.words   ? [MODULE_DEFS.words] : []),
    ...(mods.drawing ? [MODULE_DEFS.draw]  : []),
  ];

  return (
    <View
      style={[
        s.card,
        {
          width: isMobile ? '100%' : '48.5%',
          backgroundColor: colors.cardDark,
          borderColor: isDone ? '#10b981' + '60' : ch.hasContent ? unitColor + '35' : colors.borderColor,
          opacity: ch.hasContent ? 1 : 0.45,
        },
      ]}
    >
      <View style={s.cardTop}>
        <View style={[s.chBadge, { backgroundColor: unitColor + '18' }]}>
          <Text style={[s.chBadgeText, { color: unitColor }]}>Ch {ch.id}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {isDone && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#10b981' + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
              <Feather name="check-circle" size={11} color="#10b981" />
              <Text style={{ color: '#10b981', fontSize: 10, fontWeight: '700' }}>Done</Text>
            </View>
          )}
          <View style={[s.unitIcon, { backgroundColor: unitColor + '15' }]}>
            <Feather name={(isDone ? 'check' : UNIT_ICONS[ch.unit] ?? 'book') as any} size={16} color={unitColor} />
          </View>
        </View>
      </View>

      <Text style={[s.chTitle, { color: colors.textMain }]} numberOfLines={2}>
        {ch.topic}
      </Text>
      <Text style={[s.chUnit, { color: unitColor }]} numberOfLines={1}>
        {ch.unit}
      </Text>

      {!ch.hasContent ? (
        <Text style={[s.comingSoon, { color: colors.textMuted }]}>Coming soon</Text>
      ) : (
        <View style={s.modules}>
          {modules.map((m) => (
            <TouchableOpacity
              key={m.route}
              style={[
                s.modBtn,
                {
                  backgroundColor: m.color + '15',
                  borderColor: m.color + '35',
                  ...(m.route === 'Learn5E' ? { width: '100%' } : { flex: 1 }),
                },
              ]}
              onPress={() => onModule(m.route)}
              activeOpacity={0.7}
            >
              <Feather name={m.icon as any} size={12} color={m.color} />
              <Text style={[s.modBtnText, { color: m.color }]}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

export default function NCERTChaptersScreen({ navigation, route }: any) {
  const subject = (route?.params?.subject ?? 'Mathematics') as string;
  const isScience = subject === 'Science';

  const { colors } = useTheme();
  const { isMobile } = useResponsive();
  const { stats } = useStudentData();
  const { user } = useAuth();
  const completedTopics = new Set(stats.completedTopics ?? []);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Use profile curriculum/grade — fall back to NCERT Grade 3
  // Legacy 'NCERT' accounts map to the unified CBSE option (#157).
  const rawCurriculum = user?.curriculum ?? 'CBSE';
  const profileCurriculum = (rawCurriculum === 'NCERT' ? 'CBSE' : rawCurriculum) as CurriculumKey;
  const profileGrade      = (user?.grade      ?? 'Grade 3') as GradeKey;

  // Only show the picker if the user hasn't set their profile yet
  const profileSet = !!(user?.curriculum && user?.grade);
  const [selectedCurriculum, setSelectedCurriculum] = useState<CurriculumKey>(profileCurriculum);
  const [selectedGrade, setSelectedGrade]           = useState<GradeKey>(profileGrade);

  useEffect(() => {
    const url = isScience
      ? `${SERVER_URL}/ncert/science-chapters`
      : `${SERVER_URL}/ncert/chapters`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        setChapters(d.chapters ?? []);
        setLoading(false);
      })
      .catch(() => {
        setError('Could not load chapters.');
        setLoading(false);
      });
  }, [isScience]);

  const ready = chapters.filter((c) => c.hasContent).length;
  const curriculumMeta = CURRICULUM_META[selectedCurriculum];
  const gradeMeta = GRADE_META[selectedGrade];
  // CBSE follows the NCERT syllabus → treat them the same for content (#157).
  const isNcertCurriculum = selectedCurriculum === 'NCERT' || selectedCurriculum === 'CBSE';
  const isNcertGrade3 = isNcertCurriculum && selectedGrade === 'Grade 3';

  const getGradeStatus = (grade: GradeKey) =>
    isNcertCurriculum && grade === 'Grade 3' ? 'Active' : 'Coming Soon';

  const getGradeSummary = (grade: GradeKey) => {
    if (selectedCurriculum !== 'NCERT') return 'Coming soon';
    if (grade === 'Grade 3') return `${ready}/${chapters.length} chapters ready`;
    return 'Coming soon';
  };

  if (loading) {
    return (
      <ScreenLayout>
        <View style={[s.screen, { backgroundColor: colors.bgDark }]}>
          <Header title={subject} subtitle="Loading chapters..." showBack={true} onMenuPress={() => navigation.openDrawer()} />
          <View style={s.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[s.dimText, { color: colors.textMuted, marginTop: 12 }]}>Loading chapters...</Text>
          </View>
        </View>
      </ScreenLayout>
    );
  }

  if (error) {
    return (
      <ScreenLayout>
        <View style={[s.screen, { backgroundColor: colors.bgDark }]}>
          <Header title={subject} subtitle="Could not load chapters" showBack={true} onMenuPress={() => navigation.openDrawer()} />
          <View style={s.center}>
            <Feather name="wifi-off" size={36} color={colors.textMuted} />
            <Text style={[s.dimText, { color: colors.textMuted, marginTop: 12 }]}>{error}</Text>
          </View>
        </View>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <View style={[s.screen, { backgroundColor: colors.bgDark }]}>
        <Header
          title={subject}
          subtitle={isScience
            ? `${selectedCurriculum} · ${selectedGrade} · Our Wondrous World`
            : `${selectedCurriculum} · ${selectedGrade} · Maths Mela`}
          showBack={true}
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* Profile pill — shows curriculum+grade, no picker needed */}
          {profileSet ? (
            <View style={[s.profilePill, { backgroundColor: colors.primaryGlow, borderColor: colors.primary + '30' }]}>
              <Feather name="book-open" size={14} color={colors.primary} />
              <Text style={[s.profilePillText, { color: colors.primary }]}>
                {selectedCurriculum} · {selectedGrade}
              </Text>
              <View style={{ flex: 1 }} />
              <View style={[s.statusPill, { backgroundColor: '#10b98120' }]}>
                <Text style={[s.statusPillText, { color: '#10b981' }]}>Active</Text>
              </View>
            </View>
          ) : (
            /* Show curriculum + grade pickers only if profile not set */
            <>
              <View style={s.curriculumRow}>
                {CURRICULUM_OPTIONS.map((curriculum) => {
                  const meta = CURRICULUM_META[curriculum];
                  const isActive = selectedCurriculum === curriculum;
                  return (
                    <TouchableOpacity
                      key={curriculum}
                      activeOpacity={0.85}
                      onPress={() => { setSelectedCurriculum(curriculum); setSelectedGrade('Grade 3'); }}
                      style={[s.curriculumCard, { borderColor: isActive ? meta.accent : colors.borderColor, backgroundColor: isActive ? meta.accent + '12' : colors.cardDark }]}
                    >
                      <View style={s.curriculumTop}>
                        <View style={[s.curriculumIcon, { backgroundColor: meta.accent + '20' }]}>
                          <Feather name={meta.icon as any} size={15} color={meta.accent} />
                        </View>
                        <View style={[s.statusPill, { backgroundColor: meta.accent + '18' }]}>
                          <Text style={[s.statusPillText, { color: meta.accent }]}>{meta.status}</Text>
                        </View>
                      </View>
                      <Text style={[s.curriculumTitle, { color: colors.textMain }]}>{curriculum}</Text>
                      <Text style={[s.curriculumSub, { color: colors.textMuted }]}>{meta.sub}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={s.gradeRow}>
                {GRADE_OPTIONS.map((grade) => {
                  const meta = GRADE_META[grade];
                  const isActive = selectedGrade === grade;
                  const status = getGradeStatus(grade);
                  return (
                    <TouchableOpacity
                      key={grade}
                      activeOpacity={0.85}
                      onPress={() => setSelectedGrade(grade)}
                      style={[s.gradeCard, { borderColor: isActive ? meta.accent : colors.borderColor, backgroundColor: isActive ? meta.accent + '12' : colors.cardDark }]}
                    >
                      <View style={s.gradeTop}>
                        <View style={[s.gradeIcon, { backgroundColor: meta.accent + '20' }]}>
                          <Feather name={meta.icon as any} size={15} color={meta.accent} />
                        </View>
                        <View style={[s.statusPill, { backgroundColor: meta.accent + '18' }]}>
                          <Text style={[s.statusPillText, { color: meta.accent }]}>{status}</Text>
                        </View>
                      </View>
                      <Text style={[s.gradeTitle, { color: colors.textMain }]}>{grade}</Text>
                      <Text style={[s.gradeSub, { color: colors.textMuted }]}>{selectedCurriculum} Curriculum</Text>
                      <Text style={[s.gradeMetaText, { color: colors.textMuted }]}>{getGradeSummary(grade)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          <View style={[s.sectionCard, { backgroundColor: colors.cardDark, borderColor: gradeMeta.accent + '30' }]}>
            <View style={s.sectionTop}>
              <View>
                <Text style={[s.sectionTitle, { color: colors.textMain }]}>{selectedGrade}</Text>
                <Text style={[s.sectionSub, { color: colors.textMuted }]}>{selectedCurriculum} Curriculum</Text>
              </View>
              <View style={[s.sectionBadge, { backgroundColor: gradeMeta.accent + '18' }]}>
                <Text style={[s.sectionBadgeText, { color: gradeMeta.accent }]}>
                  {isNcertGrade3 ? (isScience ? 'Our Wondrous World Active' : 'Maths Mela Active') : 'Coming Soon'}
                </Text>
              </View>
            </View>

            {isNcertGrade3 ? (
              <>
                {/* Progress summary */}
                {(() => {
                  const doneCount = chapters.filter(ch => completedTopics.has(ch.topic)).length;
                  const pct = chapters.length > 0 ? Math.round((doneCount / chapters.length) * 100) : 0;
                  return doneCount > 0 ? (
                    <View style={{ backgroundColor: '#10b981' + '12', borderRadius: 12, padding: 14, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#10b981' + '30' }}>
                      <Feather name="trending-up" size={20} color="#10b981" />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#10b981', fontSize: 14, fontWeight: '700' }}>{doneCount}/{chapters.length} chapters completed · {pct}%</Text>
                        <View style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                          <View style={{ width: `${pct}%` as any, height: '100%', backgroundColor: '#10b981', borderRadius: 2 }} />
                        </View>
                      </View>
                    </View>
                  ) : null;
                })()}
                <Text style={[s.sectionHelper, { color: colors.textMuted }]}>
                  {isScience
                    ? 'Our Wondrous World (NCERT Grade 3) — 12 chapters with Drawing Buddy & Word Wizard.'
                    : 'Maths Mela (NCERT Grade 3) chapters and tools are available below.'}
                </Text>
                <View style={s.grid}>
                  {chapters.map((ch) => (
                    <ChapterCard
                      key={ch.id}
                      ch={ch}
                      isMobile={isMobile}
                      colors={colors}
                      isDone={completedTopics.has(ch.topic)}
                      isScience={isScience}
                      onModule={(route) =>
                        navigation.navigate(route as any, {
                          topic: ch.topic,
                          chapterId: ch.id,
                          unit: ch.unit,
                          subject: isScience ? 'Science' : 'Mathematics',
                        })
                      }
                    />
                  ))}
                </View>
              </>
            ) : (
              <View style={[s.comingCard, { borderColor: curriculumMeta.accent + '35' }]}>
                <View style={[s.comingIcon, { backgroundColor: curriculumMeta.accent + '20' }]}>
                  <Feather name="clock" size={18} color={curriculumMeta.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.comingTitle, { color: colors.textMain }]}>
                    {selectedCurriculum} {selectedGrade} is coming soon
                  </Text>
                  <Text style={[s.comingText, { color: colors.textMuted }]}>
                    Currently available: NCERT Grade 3 Maths Mela.
                  </Text>
                </View>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dimText: { fontSize: 14 },
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.lg },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
  },
  bannerIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { fontSize: 15, fontWeight: '700' },
  bannerSub: { fontSize: 12, lineHeight: 18, marginTop: 3 },

  curriculumRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  curriculumCard: {
    flex: 1,
    minWidth: 170,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  curriculumTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  curriculumIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  curriculumTitle: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  curriculumSub: { fontSize: 11, fontWeight: '600' },

  gradeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  gradeCard: {
    flex: 1,
    minWidth: 160,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  gradeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gradeIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  statusPill: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  statusPillText: { fontSize: 10, fontWeight: '700' },
  profilePill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 16,
  },
  profilePillText: { fontSize: 13, fontWeight: '700' },
  gradeTitle: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  gradeSub: { fontSize: 11, fontWeight: '600' },
  gradeMetaText: { fontSize: 11, marginTop: 2 },

  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  sectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 16, fontWeight: '800' },
  sectionSub: { fontSize: 12, marginTop: 1 },
  sectionBadge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  sectionBadgeText: { fontSize: 10, fontWeight: '700' },
  sectionHelper: { fontSize: 12, lineHeight: 18 },

  comingCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  comingIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  comingTitle: { fontSize: 13, fontWeight: '700' },
  comingText: { fontSize: 12, marginTop: 2 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },

  card: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  chBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  chBadgeText: { fontSize: 11, fontWeight: '800' },
  unitIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  chTitle: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  chUnit: { fontSize: 11, fontWeight: '600', marginBottom: 8 },
  comingSoon: { fontSize: 11, fontStyle: 'italic', marginTop: 4 },

  modules: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 2 },
  modBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 0,
  },
  modBtnText: { fontSize: 10, fontWeight: '700' },
});
