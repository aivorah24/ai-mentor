import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Linking, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useStudentData } from '../../context/StudentDataContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import TopicAICoach from '../../components/common/TopicAICoach';
import { spacing, radius, fonts } from '../../theme';

import SERVER_URL from '../../config/serverUrl';

// ── Video map: topic → Cloudinary URL ────────────────────────
// Add new videos here as they are produced
const VIDEO_MAP: Record<string, string> = {
  'Fundamental Motor Skills':       'https://res.cloudinary.com/di5iq2mmb/video/upload/v1775473202/aivorah/grade3/physical_ed/motor_skills_locomotor.mp4',
  'Nutrition and Healthy Living':   'https://res.cloudinary.com/di5iq2mmb/video/upload/v1775880158/aivorah/videos/nutrition_lesson_final.mp4',
  'Addition':                       'https://res.cloudinary.com/di5iq2mmb/video/upload/v1776068352/aivorah/videos/addition_final.mp4',
  'Living and Non-Living Things':   'https://res.cloudinary.com/di5iq2mmb/video/upload/v1775979374/aivorah/videos/living_nonliving_final.mp4',
  '2D Shapes':'https://res.cloudinary.com/di5iq2mmb/video/upload/Untitled_design_1_zdsx61.mp4',
  'Adjectives and Describing Words': 'https://res.cloudinary.com/di5iq2mmb/video/upload/f_mp4,q_auto/Adjectives_and_Describing_Words_wlbbbr',
  'Informational Writing': 'https://res.cloudinary.com/di5iq2mmb/video/upload/f_mp4,q_auto/Informational_Writing_njx68p',
  'Cardinal Directions':'https://res.cloudinary.com/di5iq2mmb/video/upload/f_mp4,q_auto/Cardinal_Direction_bvrs1s',
  'Communities':'https://res.cloudinary.com/di5iq2mmb/video/upload/f_mp4,q_auto/Communities_crfqww',
  'Animal Life Cycles':'https://res.cloudinary.com/di5iq2mmb/video/upload/f_mp4,q_auto/Animal_Life_cycles_iujbcp',
  'Food Chains':'https://res.cloudinary.com/di5iq2mmb/video/upload/f_mp4,q_auto/Food_Chains_bwwr4o',
  'Color Theory':'https://res.cloudinary.com/di5iq2mmb/video/upload/f_mp4,q_auto/Color_theory_rtbmwi',
  'Elements of Art':'https://res.cloudinary.com/di5iq2mmb/video/upload/f_mp4,q_auto/Element_of_arts_xqsbak',
  'Computer Basics':'https://res.cloudinary.com/di5iq2mmb/video/upload/f_mp4,q_auto/Computer_Basics_segaqx',
  'Internet Safety':'https://res.cloudinary.com/di5iq2mmb/video/upload/f_mp4,q_auto/Internet_Safety_a0hiyk',
};

// Subject accent colors — Enchanting Forest palette
const SUBJECT_ACCENT: Record<string, { color: string; icon: any }> = {
  'Mathematics':          { color: '#5F8A86', icon: 'trending-up' },
  'Science':              { color: '#5A8A70', icon: 'zap'         },
  'English':              { color: '#B8797E', icon: 'book-open'   },
  'Social Studies':       { color: '#8A8358', icon: 'globe'       },
  'Arts':                 { color: '#C4836A', icon: 'feather'     },
  'Physical Education':   { color: '#e99da2', icon: 'activity'    },
  'ICT':                  { color: '#7AADA8', icon: 'monitor'     },
};

function subjectAccent(subject: string) {
  return SUBJECT_ACCENT[subject] ?? { color: '#5F8A86', icon: 'book' };
}

const SUBJECT_TOPIC_HINTS: Array<{ subject: string; hints: string[] }> = [
  { subject: 'English', hints: ['story', 'grammar', 'reading', 'writing', 'poetry', 'paragraph', 'adjective', 'verb', 'noun'] },
  { subject: 'Science', hints: ['plant', 'animal', 'weather', 'rock', 'soil', 'gravity', 'matter', 'solar', 'food chain', 'food web'] },
  { subject: 'Social Studies', hints: ['community', 'culture', 'map', 'country', 'continent', 'history', 'civilisation', 'heritage'] },
  { subject: 'Arts', hints: ['art', 'colour', 'color', 'rhythm', 'beat', 'drawing', 'drama', 'music'] },
  { subject: 'Physical Education', hints: ['sport', 'movement', 'fitness', 'exercise', 'motor skills'] },
  { subject: 'ICT', hints: ['computer', 'internet', 'coding', 'digital', 'scratch'] },
  { subject: 'Mathematics', hints: ['fraction', 'decimal', 'number', 'algebra', 'shape', 'geometry', 'ratio', 'percent', 'graph'] },
];

function inferSubjectFromTopic(topic: string): string {
  const t = topic.toLowerCase();
  for (const rule of SUBJECT_TOPIC_HINTS) {
    if (rule.hints.some((hint) => t.includes(hint))) return rule.subject;
  }
  return 'Mathematics';
}

// ── Key concepts per subject for the lesson overview ─────────────────────────
const WHAT_YOU_LEARN: Record<string, string[]> = {
  'Mathematics':        ['Understand the concept step by step', 'Solve practice problems', 'Apply to real-life situations', 'Test yourself with a quiz'],
  'Science':            ['Explore key science ideas', 'Learn through observations', 'Connect to the natural world', 'Test your knowledge'],
  'English':            ['Build reading and writing skills', 'Practise grammar and vocabulary', 'Apply in creative writing', 'Test your understanding'],
  'Social Studies':     ['Explore people, places and cultures', 'Understand historical events', 'Connect to the world around you', 'Test your knowledge'],
  'Arts':               ['Discover creative techniques', 'Explore art and music concepts', 'Express your ideas visually', 'Test your understanding'],
  'Physical Education': ['Learn healthy habits and movement', 'Understand sports and fitness', 'Apply skills in daily life', 'Test your knowledge'],
  'ICT':                ['Understand digital tools and safety', 'Learn computing concepts', 'Apply in real digital situations', 'Test your knowledge'],
};

export default function VideoLessonScreen({ navigation, route }: any) {
  const { topic = 'Lesson', grade = 'Grade 3', subject: routeSubject, curriculum = 'IB_PYP', description: routeDesc } = route?.params ?? {};
  const subject = routeSubject || inferSubjectFromTopic(topic);
  const { recordStudyTime } = useStudentData();
  const [videoPlaying, setVideoPlaying] = useState(false);
  const studySessionStartRef = useRef<number | null>(null);
  const trackedStudyMinutesRef = useRef(0);
  const hasVideo = Boolean(VIDEO_MAP[topic]);

  function goBackToTopics() {
    navigation.navigate('SubjectTopics', { subject, curriculum, grade });
  }
  const { colors, isDark } = useTheme();
  const sa = subjectAccent(subject);
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  // Landing palette: sage primary + gold secondary (theme-aware).
  const accent   = colors.primary;
  const gold     = colors.accentYellow;
  const onAccent = isDark ? '#0B140F' : '#FFFFFF';

  // Credit whole minutes only when the student is actively learning:
  // - video topics: while the video is playing
  // - non-video topics: while the lesson screen is open and readable
  useEffect(() => {
    let activeSession = false;

    function flushWholeMinutes() {
      if (studySessionStartRef.current == null) return;
      const elapsedWholeMinutes = Math.floor((Date.now() - studySessionStartRef.current) / 60000);
      const delta = elapsedWholeMinutes - trackedStudyMinutesRef.current;
      if (delta > 0) {
        recordStudyTime(delta);
        trackedStudyMinutesRef.current += delta;
      }
    }

    function startSession() {
      if (activeSession) return;
      activeSession = true;
      studySessionStartRef.current = Date.now();
      trackedStudyMinutesRef.current = 0;
    }

    function stopSession() {
      flushWholeMinutes();
      activeSession = false;
      studySessionStartRef.current = null;
      trackedStudyMinutesRef.current = 0;
    }

    let unsubFocus: (() => void) | undefined;
    let unsubBlur: (() => void) | undefined;

    if (hasVideo) {
      if (videoPlaying) startSession();
      unsubFocus = navigation.addListener('focus', () => {
        if (videoPlaying) startSession();
      });
      unsubBlur = navigation.addListener('blur', stopSession);
    } else {
      unsubFocus = navigation.addListener('focus', startSession);
      unsubBlur = navigation.addListener('blur', stopSession);
      startSession();
    }

    const interval = setInterval(flushWholeMinutes, 15000);
    return () => {
      clearInterval(interval);
      stopSession();
      unsubFocus?.();
      unsubBlur?.();
    };
  }, [hasVideo, navigation, recordStudyTime, videoPlaying]);

  return (
    <ScreenLayout>
      <Header
        title={`${topic} · ${grade}`}
        subtitle={`${subject} · ${curriculum.replace('_', ' ')} · Video Lesson`}
        showBack={true}
        onMenuPress={() => navigation.openDrawer()}
      />

      <View style={{ flex: 1, position: 'relative', backgroundColor: colors.bgDark }}>
        <ScrollView
          contentContainerStyle={[s.content, { backgroundColor: colors.bgDark }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Back */}
          <TouchableOpacity style={s.backRow} onPress={() => goBackToTopics()}>
            <Feather name="arrow-left" size={15} color={accent} />
            <Text style={[s.backText, { color: accent }]}>Back to Topics</Text>
          </TouchableOpacity>

          {/* ── Hero ── */}
          <View style={[s.hero, isWide ? s.heroRow : s.heroCol]}>
            {/* Owl illustration (placeholder — swap for art asset) */}
            <View style={[s.owlWrap, { width: isWide ? 150 : '100%', minHeight: isWide ? 160 : 130, backgroundColor: accent + '14', borderColor: accent + '33' }]}>
              <Feather name="feather" size={isWide ? 54 : 46} color={accent} />
            </View>

            {/* Title block */}
            <View style={s.heroText}>
              <View style={[s.subjBadge, { backgroundColor: accent + '18', borderColor: accent + '40' }]}>
                <Text style={[s.subjBadgeText, { color: accent }]}>{subject.toUpperCase()}</Text>
              </View>
              <Text style={[s.heroTitle, { color: colors.textMain }]}>{topic}</Text>
              <Text style={[s.heroMeta, { color: colors.textMuted }]}>{grade} · {curriculum.replace('_', ' ')} · {subject}</Text>
              <Text style={[s.heroDesc, { color: colors.textMuted }]}>
                {hasVideo
                  ? `Watch this engaging lesson on ${topic} and learn with Aivorah!`
                  : `A video lesson on ${topic} is coming soon. In the meantime, start learning below!`}
              </Text>
            </View>

            {/* Video card */}
            <View style={[s.videoBox, { width: isWide ? 320 : '100%', minHeight: 170, backgroundColor: isDark ? colors.cardDark : '#fff', borderColor: colors.borderColor }]}>
              {hasVideo ? (
                Platform.OS === 'web' ? (
                  <View style={s.videoFrame}>
                    {/* @ts-ignore */}
                    <video
                      src={VIDEO_MAP[topic]}
                      controls
                      style={{ width: '100%', height: '100%', borderRadius: 12, backgroundColor: '#000', outline: 'none' }}
                      controlsList="nodownload"
                      onPlay={() => setVideoPlaying(true)}
                      onPause={() => setVideoPlaying(false)}
                      onEnded={() => setVideoPlaying(false)}
                    />
                  </View>
                ) : (
                  <TouchableOpacity style={s.videoComing} onPress={() => Linking.openURL(VIDEO_MAP[topic])} activeOpacity={0.85}>
                    <View style={[s.clap, { backgroundColor: accent + '20', borderColor: accent + '50' }]}>
                      <Feather name="play" size={28} color={accent} />
                    </View>
                    <Text style={[s.videoTitle, { color: colors.textMain }]}>Tap to Watch</Text>
                  </TouchableOpacity>
                )
              ) : (
                <View style={s.videoComing}>
                  <View style={[s.clap, { backgroundColor: accent + '18', borderColor: accent + '45' }]}>
                    <Feather name="film" size={26} color={accent} />
                  </View>
                  <Text style={[s.videoTitle, { color: colors.textMain }]}>Video Lesson</Text>
                  <View style={[s.comingPill, { borderColor: accent + '50' }]}>
                    <Feather name="clock" size={11} color={accent} />
                    <Text style={[s.comingText, { color: accent }]}>Coming Soon</Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* ── What you'll learn ── */}
          <View style={[s.card, { backgroundColor: isDark ? colors.cardDark : '#fff', borderColor: colors.borderColor }]}>
            <View style={s.cardHead}>
              <Feather name="book-open" size={18} color={accent} />
              <Text style={[s.cardTitle, { color: colors.textMain }]}>What you'll learn</Text>
            </View>
            <View style={s.learnGrid}>
              {(WHAT_YOU_LEARN[subject] ?? WHAT_YOU_LEARN['Mathematics']).map((item, i) => {
                const icons = ['bar-chart-2', 'edit-3', 'feather', 'check-square'];
                const c = i % 2 === 0 ? accent : gold;
                return (
                  <View key={i} style={[s.learnItem, { width: isWide ? '23%' : '47%' }]}>
                    <View style={[s.learnIcon, { borderColor: c + '50' }]}>
                      <Feather name={icons[i % icons.length] as any} size={16} color={c} />
                    </View>
                    <Text style={[s.learnLabel, { color: colors.textMuted }]}>{item}</Text>
                  </View>
                );
              })}
            </View>
            <View style={[s.ctaRow, !isWide && { flexDirection: 'column' }]}>
              <TouchableOpacity
                style={[s.cta, { backgroundColor: accent + (isDark ? '1F' : '14'), borderColor: accent + '55' }]}
                onPress={() => navigation.navigate('TopicLesson', { topic, grade, subject, curriculum })}
                activeOpacity={0.85}
              >
                <Feather name="play-circle" size={18} color={accent} />
                <View>
                  <Text style={[s.ctaTitle, { color: colors.textMain }]}>Start Learning</Text>
                  <Text style={[s.ctaSub, { color: colors.textMuted }]}>Begin your learning journey</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.cta, { backgroundColor: isDark ? colors.cardDark : '#fff', borderColor: colors.borderColor }]}
                onPress={() => navigation.navigate('IBPYPQuiz', { topic, grade, subject, curriculum })}
                activeOpacity={0.85}
              >
                <Feather name="check-square" size={18} color={gold} />
                <View>
                  <Text style={[s.ctaTitle, { color: colors.textMain }]}>Practice Quiz</Text>
                  <Text style={[s.ctaSub, { color: colors.textMuted }]}>Test your understanding</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Explore Other Topics + Aivorah tutor (2-up grid) ── */}
          <View style={[s.bottomGrid, !isWide && { flexDirection: 'column' }]}>
            {/* Explore Other Topics */}
            <TouchableOpacity
              style={[s.card, { flex: isWide ? 1 : undefined, justifyContent: 'center', backgroundColor: isDark ? colors.cardDark : '#fff', borderColor: colors.borderColor }]}
              onPress={() => goBackToTopics()}
              activeOpacity={0.8}
            >
              <View style={s.exploreRow}>
                <View style={[s.exploreIcon, { backgroundColor: accent + '18' }]}>
                  <Feather name="list" size={18} color={accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardTitle, { color: colors.textMain }]}>Explore Other Topics</Text>
                  <Text style={[s.exploreSub, { color: colors.textMuted }]}>Browse all {subject} topics in {grade}</Text>
                </View>
                <View style={s.viewAll}>
                  <Text style={[s.viewAllText, { color: accent }]}>View all topics</Text>
                  <Feather name="arrow-right" size={14} color={accent} />
                </View>
              </View>
            </TouchableOpacity>

            {/* Aivorah tutor */}
            <View style={[s.tutorFooter, { flex: isWide ? 1 : undefined, backgroundColor: isDark ? colors.cardDark : '#fff', borderColor: colors.borderColor }]}>
              <View style={[s.tutorAvatar, { backgroundColor: accent + '22', borderColor: accent + '55' }]}>
                <Feather name="feather" size={18} color={accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.tutorName, { color: colors.textMain }]}>
                  Hi! I'm <Text style={{ color: accent, fontWeight: '700' }}>Aivorah</Text>, your AI tutor.
                </Text>
                <Text style={[s.tutorMsg, { color: colors.textMuted }]}>I'll help you explore, practice, and master every concept!</Text>
              </View>
              <TouchableOpacity style={[s.helpBtn, { borderColor: colors.borderColor }]} onPress={() => navigation.navigate('HelpCenter')} activeOpacity={0.8}>
                <Feather name="message-circle" size={13} color={colors.textMain} />
                <Text style={[s.helpText, { color: colors.textMain }]}>Need help?</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>

        {/* Floating per-topic AI Coach */}
        <TopicAICoach
          topic={topic}
          subject={subject}
          grade={grade}
          curriculum={curriculum}
          onMessageSent={() => recordStudyTime(1)}
        />
      </View>
    </ScreenLayout>
  );
}

const s = StyleSheet.create({
  content:  { padding: spacing.xl, paddingBottom: 110, gap: spacing.lg },
  backRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { fontSize: 13, fontWeight: '600' },

  // Hero
  hero:      { gap: spacing.lg },
  heroRow:   { flexDirection: 'row', alignItems: 'stretch' },
  heroCol:   { flexDirection: 'column' },
  owlWrap:   { alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, borderWidth: 1 },
  heroText:  { flex: 1, justifyContent: 'center', gap: 8 },
  subjBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  subjBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  heroTitle: { fontFamily: fonts.serif, fontSize: 32, fontWeight: '700', letterSpacing: -0.6, lineHeight: 38 },
  heroMeta:  { fontSize: 13, fontWeight: '600' },
  heroDesc:  { fontSize: 14, lineHeight: 21, marginTop: 2 },

  videoBox:   { borderRadius: radius.lg, borderWidth: 1, padding: 16, alignItems: 'center', justifyContent: 'center' },
  videoFrame: { width: '100%', height: 160, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' },
  videoComing:{ alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14 },
  clap:       { width: 64, height: 64, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  videoTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '700' },
  comingPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  comingText: { fontSize: 12, fontWeight: '700' },

  // Cards
  card:      { borderRadius: radius.lg, borderWidth: 1, padding: spacing.xl, gap: spacing.md },
  cardHead:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '700' },

  learnGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 4 },
  learnItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  learnIcon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  learnLabel:{ flex: 1, fontSize: 13, lineHeight: 18 },

  ctaRow:    { flexDirection: 'row', gap: 12, marginTop: 6 },
  cta:       { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 18, borderRadius: radius.md, borderWidth: 1 },
  ctaTitle:  { fontSize: 14, fontWeight: '700' },
  ctaSub:    { fontSize: 12, marginTop: 1 },

  exploreRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  exploreIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  exploreSub:  { fontSize: 12, marginTop: 2 },
  viewAll:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  viewAllText: { fontSize: 12.5, fontWeight: '600' },

  // Bottom 2-up grid (Explore Other Topics + tutor)
  bottomGrid:  { flexDirection: 'row', gap: spacing.lg, alignItems: 'stretch' },

  // Tutor footer
  tutorFooter: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: radius.lg, padding: 16 },
  tutorAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  tutorName:   { fontSize: 14, fontWeight: '600' },
  tutorMsg:    { fontSize: 12.5, marginTop: 2 },
  helpBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  helpText:    { fontSize: 12.5, fontWeight: '600' },
});
