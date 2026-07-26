import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Platform, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import { TEACHER_COURSES, TeacherCourse } from '../../data/teacherCourses';

// Aivorah-hosted teacher course videos (Cloudinary)
type CourseVideo = {
  id: string;
  eyebrow: string;
  title: string;
  desc: string;
  url: string;
  outcomes: { icon: string; title: string; desc: string }[];
};

const COURSE_VIDEOS: CourseVideo[] = [
  {
    id: 'course-1',
    eyebrow: 'Course 1 · 8 min overview',
    title: 'From Average Prompts to Outstanding Teaching',
    desc:
      'The complete Course 1 walkthrough. Learn the 4-Part Prompt Formula (Context, Role, Task, Output Format), turn one prompt into a full lesson pack, follow the Research → Plan → Create → Review → Teach → Reflect workflow, and verify every AI output before you teach.',
    url: 'https://res.cloudinary.com/di5iq2mmb/video/upload/v1782886474/aivorah/videos/aivorah_teacher_intro.mp4',
    outcomes: [
      { icon: 'edit-3', title: 'Write better prompts', desc: 'Use the 4-part formula: context, role, task, output format.' },
      { icon: 'clock', title: 'Save time on planning', desc: 'Turn one clear prompt into a full classroom-ready lesson pack.' },
      { icon: 'file-text', title: 'Create resources faster', desc: 'Draft lesson plans, worksheets, assessments, and parent updates.' },
      { icon: 'shield', title: 'Verify with confidence', desc: 'Check accuracy, bias, level, and curriculum alignment before teaching.' },
    ],
  },
  {
    id: 'course-2',
    eyebrow: 'Course 2 · 3 min overview',
    title: 'Create Engaging Learning Experiences with AI',
    desc:
      'Turn everyday lessons into active, memorable experiences. Move from passive to active learning, spin one topic into many activities — Think-Pair-Share, Gallery Walk, Role Play, Quiz Challenge, Story Building, Escape Room — and design inquiry, competency, and critical-thinking tasks you can build once and reuse forever.',
    url: 'https://res.cloudinary.com/di5iq2mmb/video/upload/v1782915506/aivorah/videos/aivorah_teacher_course2.mp4',
    outcomes: [
      { icon: 'zap', title: 'Engage every learner', desc: 'Shift from passive listening to active participation.' },
      { icon: 'grid', title: 'One topic, many activities', desc: 'Think-Pair-Share, Gallery Walk, Role Play, Quiz, Escape Room.' },
      { icon: 'compass', title: 'Deeper understanding', desc: 'Design inquiry, competency, and critical-thinking tasks.' },
      { icon: 'refresh-cw', title: 'Build once, reuse forever', desc: 'Create engaging resources you can reuse across classes.' },
    ],
  },
];

const PATH_BENEFITS = [
  'Practical strategies you can use immediately',
  'Save hours of planning time each week',
  'Improve engagement with clearer resources',
  'Build confidence using AI responsibly',
];

export default function TeacherLearningPathsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const gold = colors.accentYellow;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [active, setActive] = useState<TeacherCourse | null>(null);

  const totalLessons = TEACHER_COURSES.reduce((n, c) => n + c.lessons.length, 0);
  const totalMinutes = TEACHER_COURSES.reduce(
    (n, c) => n + c.lessons.reduce((sum, lesson) => sum + lesson.minutes, 0),
    0
  );
  const isWide = width >= 980;

  return (
    <ScreenLayout hideAIPanel>
      <View style={styles.screen}>
        <Header
          title="Learning Paths"
          subtitle="Professional development for educators"
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {COURSE_VIDEOS.map((video, vIndex) => (
            <View key={video.id} style={styles.videoSection}>
              <View style={styles.videoIntro}>
                <Text style={styles.videoEyebrow}>{video.eyebrow}</Text>
                <Text style={styles.videoTitle}>{video.title}</Text>
                <Text style={styles.videoDesc}>{video.desc}</Text>
              </View>

              <View style={[styles.videoGrid, !isWide && styles.videoGridStack, vIndex % 2 === 1 && isWide && styles.videoGridReverse]}>
                <View style={styles.videoPlayerPanel}>
                  {Platform.OS === 'web'
                    ? React.createElement('video', {
                        src: video.url,
                        controls: true,
                        preload: 'metadata',
                        style: {
                          width: '100%',
                          aspectRatio: '16 / 9',
                          borderRadius: 16,
                          background: '#050505',
                          display: 'block',
                        },
                      })
                    : (
                      <View style={styles.nativeVideoFallback}>
                        <Feather name="play-circle" size={44} color={gold} />
                        <Text style={styles.nativeVideoText}>Course video available on web</Text>
                      </View>
                    )}
                </View>

                <View style={styles.videoSidePanel}>
                  <Text style={styles.panelTitle}>In this video</Text>
                  {video.outcomes.map((item) => (
                    <View key={item.title} style={styles.outcomeRow}>
                      <View style={styles.outcomeIcon}>
                        <Feather name={item.icon as any} size={16} color={gold} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.outcomeTitle}>{item.title}</Text>
                        <Text style={styles.outcomeDesc}>{item.desc}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          ))}

          <View style={[styles.overviewGrid, !isWide && styles.overviewGridStack]}>
            <View style={styles.coursePanel}>
              <View style={styles.sectionHead}>
                <View>
                  <Text style={styles.sectionTitle}>Learning Path Overview</Text>
                  <Text style={styles.sectionSub}>
                    {TEACHER_COURSES.length} courses • {totalLessons} lessons • about {totalMinutes} minutes
                  </Text>
                </View>
              </View>

              <View style={styles.pathList}>
                {TEACHER_COURSES.map((course, index) => (
                  <TouchableOpacity
                    key={course.id}
                    style={[styles.pathCard, index === 0 && styles.pathCardActive]}
                    activeOpacity={0.76}
                    onPress={() => setActive(course)}
                  >
                    <View style={[styles.pathStep, index === 0 && styles.pathStepActive]}>
                      <Text style={[styles.pathStepText, index === 0 && styles.pathStepTextActive]}>{index + 1}</Text>
                    </View>
                    <View style={styles.pathInfo}>
                      <Text style={styles.pathLabel}>{course.title}</Text>
                      <Text style={styles.pathDesc}>{course.desc}</Text>
                      <Text style={styles.pathMeta}>{course.lessons.length} lessons</Text>
                    </View>
                    <View style={styles.pathAction}>
                      <Feather name={course.icon as any} size={16} color={index === 0 ? gold : colors.textDim} />
                      <Feather name="chevron-right" size={18} color={colors.textDim} />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

        </ScrollView>
      </View>

      {/* ── Course detail modal ── */}
      <Modal visible={!!active} animationType="fade" transparent onRequestClose={() => setActive(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{active?.title}</Text>
                <Text style={styles.modalSub}>{active?.desc}</Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setActive(null)}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.xl }} showsVerticalScrollIndicator={false}>
              {active?.lessons.map((lesson, i) => (
                <View key={i} style={styles.lessonCard}>
                  <View style={styles.lessonHead}>
                    <View style={styles.lessonNum}><Text style={styles.lessonNumText}>{i + 1}</Text></View>
                    <Text style={styles.lessonTitle}>{lesson.title}</Text>
                    <View style={styles.minPill}>
                      <Feather name="clock" size={10} color={colors.textDim} />
                      <Text style={styles.minText}>{lesson.minutes} min</Text>
                    </View>
                  </View>
                  {/* Aivorah-hosted video slot (placeholder until recorded) */}
                  {lesson.videoUrl
                    ? (Platform.OS === 'web'
                        ? React.createElement('video', {
                            src: lesson.videoUrl, controls: true,
                            style: { width: '100%', borderRadius: 10, marginBottom: 8, background: '#000' },
                          })
                        : null)
                    : (
                      <View style={styles.videoPlaceholder}>
                        <Feather name="play-circle" size={22} color={gold} />
                        <Text style={styles.videoPlaceholderText}>Video lesson coming soon</Text>
                      </View>
                    )}

                  {lesson.body.map((p, j) => (
                    <Text key={j} style={styles.lessonBody}>{p}</Text>
                  ))}
                  {!!lesson.bullets?.length && (
                    <View style={{ gap: 6, marginTop: 4 }}>
                      {lesson.bullets.map((b, k) => (
                        <View key={k} style={styles.bulletRow}>
                          <Feather name="check" size={13} color={gold} style={{ marginTop: 3 }} />
                          <Text style={styles.bulletText}>{b}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {!!lesson.prompts?.length && (
                    <View style={{ gap: 6, marginTop: 4 }}>
                      <Text style={styles.promptsLabel}>Example prompts</Text>
                      {lesson.prompts.map((p, k) => (
                        <View key={k} style={styles.promptBox}>
                          <Feather name="terminal" size={12} color={colors.accentCyan} style={{ marginTop: 3 }} />
                          <Text style={styles.promptText}>{p}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {!!lesson.tip && (
                    <View style={styles.tipBox}>
                      <Feather name="zap" size={13} color={gold} />
                      <Text style={styles.tipText}>{lesson.tip}</Text>
                    </View>
                  )}
                </View>
              ))}
              <View style={{ height: 8 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:   { flex: 1, backgroundColor: c.bgDark },
  scroll:   { flex: 1 },
  content:  { padding: spacing.xl, paddingBottom: 48, gap: spacing.xl, maxWidth: 1280, width: '100%', alignSelf: 'center' },

  heroBanner: {
    flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden',
    backgroundColor: c.cardDark,
    borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xxxl,
    alignItems: 'stretch', gap: spacing.xxxl,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 22, shadowOffset: { width: 0, height: 12 },
  },
  heroCopy: { flex: 1, minWidth: 300, gap: spacing.lg, justifyContent: 'center', maxWidth: 860 },
  heroPill: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.accentYellow + '12', borderWidth: 1, borderColor: c.accentYellow + '30',
    borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  heroPillText: {
    fontSize: 12, fontWeight: '800', color: c.accentYellow,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  heroTitle: {
    fontSize: 40, fontWeight: '700', color: c.textHeading,
    lineHeight: 46, letterSpacing: -0.2, maxWidth: 650,
  },
  titleRule: { width: 112, height: 3, backgroundColor: c.accentYellow, borderRadius: 99 },
  heroSub: { fontSize: 15, color: c.textMuted, lineHeight: 24, maxWidth: 720 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  statCard: {
    minWidth: 150, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, padding: spacing.lg,
  },
  statIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: c.accentYellow + '16',
    alignItems: 'center', justifyContent: 'center',
  },
  statNumber: { fontSize: 26, fontWeight: '800', color: c.textHeading, lineHeight: 30 },
  statLabel: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  videoSectionHead: { alignItems: 'center', gap: 8, alignSelf: 'center', maxWidth: 760, marginTop: spacing.sm },
  sectionKicker: {
    fontSize: 12, fontWeight: '800', color: c.accentYellow,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  sectionHeadline: { fontSize: 30, fontWeight: '800', color: c.textHeading, textAlign: 'center', lineHeight: 36 },
  sectionHeadSub: { fontSize: 14, color: c.textMuted, textAlign: 'center', lineHeight: 22 },
  videoSection: {
    backgroundColor: c.cardDark,
    borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xxxl, gap: spacing.xl,
  },
  videoGridReverse: { flexDirection: 'row-reverse' },
  videoIntro: { alignItems: 'center', gap: 8, alignSelf: 'center', maxWidth: 760 },
  videoEyebrow: {
    fontSize: 12, fontWeight: '800', color: c.accentYellow,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  videoTitle: { fontSize: 28, fontWeight: '800', color: c.textHeading, textAlign: 'center', lineHeight: 34 },
  videoDesc: { fontSize: 14, color: c.textMuted, textAlign: 'center', lineHeight: 22 },
  videoGrid: { flexDirection: 'row', gap: spacing.xl, alignItems: 'stretch' },
  videoGridStack: { flexDirection: 'column' },
  videoPlayerPanel: {
    flex: 1.25, minWidth: 280,
    borderRadius: radius.lg, overflow: 'hidden',
    backgroundColor: '#050505',
    borderWidth: 1, borderColor: c.borderColor,
  },
  nativeVideoFallback: {
    aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, backgroundColor: '#050505',
  },
  nativeVideoText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  videoSidePanel: {
    flex: 0.85, minWidth: 270,
    backgroundColor: c.bgDark,
    borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.lg, padding: spacing.xl, gap: spacing.lg,
  },
  panelTitle: { fontSize: 16, fontWeight: '800', color: c.textHeading },
  outcomeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  outcomeIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: c.accentYellow + '12',
    borderWidth: 1, borderColor: c.accentYellow + '28',
    alignItems: 'center', justifyContent: 'center',
  },
  outcomeTitle: { fontSize: 13, fontWeight: '800', color: c.textHeading, textTransform: 'capitalize' },
  outcomeDesc: { fontSize: 12, color: c.textMuted, lineHeight: 18, marginTop: 2 },

  overviewGrid: { flexDirection: 'row', gap: spacing.xl, alignItems: 'flex-start' },
  overviewGridStack: { flexDirection: 'column' },
  coursePanel: {
    flex: 1.6, width: '100%',
    backgroundColor: c.cardDark,
    borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xl,
  },
  sectionHead: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: c.textHeading },
  sectionSub: { fontSize: 12, color: c.textMuted, marginTop: 6 },
  pathList: { gap: spacing.sm },
  pathCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: c.bgDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, padding: spacing.lg,
  },
  pathCardActive: {
    borderColor: c.accentYellow + '45',
    backgroundColor: c.accentYellow + '08',
  },
  pathStep: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: c.cardHover,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  pathStepActive: { backgroundColor: c.accentYellow },
  pathStepText: { fontSize: 13, fontWeight: '800', color: c.textMuted },
  pathStepTextActive: { color: c.cardDark },
  pathInfo: { flex: 1, gap: 4 },
  pathLabel: { fontSize: 14, fontWeight: '800', color: c.textHeading },
  pathDesc: { fontSize: 12.5, color: c.textMuted, lineHeight: 18 },
  pathMeta: { fontSize: 11, color: c.accentYellow, fontWeight: '800', marginTop: 2 },
  pathAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sideColumn: { flex: 0.75, width: '100%', gap: spacing.md, minWidth: 280 },
  progressPanel: {
    backgroundColor: c.cardDark,
    borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xl, gap: spacing.lg,
  },
  progressCircle: {
    alignSelf: 'center', width: 118, height: 118, borderRadius: 59,
    borderWidth: 8, borderColor: c.accentYellow + '24',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.bgDark,
  },
  progressValue: { fontSize: 24, fontWeight: '800', color: c.textHeading },
  progressLabel: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  progressMetaRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: c.borderColor, paddingTop: spacing.sm,
  },
  progressMetaLabel: { fontSize: 12, color: c.textMuted },
  progressMetaValue: { fontSize: 12, color: c.textHeading, fontWeight: '800' },
  primaryButton: {
    minHeight: 44, borderRadius: radius.md,
    backgroundColor: c.textMain,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: spacing.sm,
  },
  primaryButtonText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  benefitsPanel: {
    backgroundColor: c.cardDark,
    borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md,
  },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  benefitIcon: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: c.accentYellow + '12',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  benefitText: { flex: 1, fontSize: 12.5, color: c.textMuted, lineHeight: 18 },

  // Modal — a compact centered card, not an edge-to-edge bottom sheet, so it
  // doesn't dominate the whole viewport on wide (web/tablet) screens.
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  modalSheet: {
    backgroundColor: c.bgDark, borderRadius: radius.xl,
    width: '100%', maxWidth: 640, maxHeight: '85%', borderWidth: 1, borderColor: c.borderColor,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: c.borderColor,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: c.textHeading },
  modalSub:   { fontSize: 13, color: c.textMuted, marginTop: 3 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: c.cardHover,
    alignItems: 'center', justifyContent: 'center',
  },

  lessonCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm,
  },
  lessonHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lessonNum: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: c.accentYellow + '20',
    alignItems: 'center', justifyContent: 'center',
  },
  lessonNumText: { fontSize: 12, fontWeight: '700', color: c.accentYellow },
  lessonTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: c.textHeading },
  minPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  minText: { fontSize: 11, color: c.textDim },
  videoPlaceholder: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: c.cardHover, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, padding: spacing.md,
  },
  videoPlaceholderText: { fontSize: 13, color: c.textMuted, fontWeight: '500' },
  lessonBody: { fontSize: 13.5, color: c.textMuted, lineHeight: 21 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletText: { flex: 1, fontSize: 13, color: c.textMuted, lineHeight: 19 },
  promptsLabel: {
    fontSize: 12, fontWeight: '700', color: c.textDim,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  promptBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.cardHover, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, padding: spacing.md,
  },
  promptText: { flex: 1, fontSize: 12.5, color: c.textMuted, lineHeight: 18 },
  tipBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4,
    backgroundColor: c.accentYellow + '12', borderWidth: 1, borderColor: c.accentYellow + '30',
    borderRadius: radius.md, padding: spacing.md,
  },
  tipText: { flex: 1, fontSize: 13, color: c.accentYellow, lineHeight: 19, fontWeight: '500' },
});
