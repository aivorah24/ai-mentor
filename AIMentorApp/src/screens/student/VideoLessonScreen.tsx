import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import TopicAICoach from '../../components/common/TopicAICoach';
import { spacing, radius } from '../../theme';

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

  function goBackToTopics() {
    navigation.navigate('SubjectTopics', { subject, curriculum, grade });
  }
  const { colors, isDark } = useTheme();
  const sa = subjectAccent(subject);

  const cardBg     = isDark ? colors.cardDark  : sa.color + '14';
  const borderCol  = isDark ? colors.borderColor : sa.color + '40';
  const titleColor = isDark ? colors.textMain  : '#1C2A28';
  const mutedColor = isDark ? colors.textMuted : sa.color + 'cc';

  return (
    <ScreenLayout>
      <Header
        title={`${topic} · ${grade}`}
        subtitle={`${subject} · ${curriculum.replace('_', ' ')} · Video Lesson`}
        onMenuPress={() => navigation.openDrawer()}
      />

      <View style={{ flex: 1, position: 'relative', backgroundColor: colors.bgDark }}>
        <ScrollView
          contentContainerStyle={[s.content, { backgroundColor: colors.bgDark }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Back */}
          <TouchableOpacity style={s.backRow} onPress={() => goBackToTopics()}>
            <Feather name="arrow-left" size={15} color={colors.textMuted} />
            <Text style={[s.backText, { color: colors.textMuted }]}>Back to Topics</Text>
          </TouchableOpacity>

          {/* Video placeholder card */}
          <View style={[s.videoCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
            {/* Subject tag */}
            <View style={[s.subjectTag, { backgroundColor: sa.color + '18', borderColor: sa.color + '40' }]}>
              <Feather name={sa.icon} size={13} color={sa.color} />
              <Text style={[s.subjectTagText, { color: sa.color }]}>{subject}</Text>
            </View>

            {/* Video player or Coming Soon */}
            {VIDEO_MAP[topic] ? (
              Platform.OS === 'web' ? (
                <View style={s.videoFrame}>
                  {/* @ts-ignore */}
                  <video
                    src={VIDEO_MAP[topic]}
                    controls
                    style={{ width: '100%', height: '100%', borderRadius: 12, backgroundColor: '#000', outline: 'none' }}
                    controlsList="nodownload"
                  />
                </View>
              ) : (
                <TouchableOpacity
                  style={[s.videoFrame, { backgroundColor: '#111', borderColor: sa.color + '30' }]}
                  onPress={() => Linking.openURL(VIDEO_MAP[topic])}
                  activeOpacity={0.85}
                >
                  <View style={[s.playCircle, { backgroundColor: sa.color + '30', borderColor: sa.color }]}>
                    <Feather name="play" size={36} color={sa.color} />
                  </View>
                  <Text style={[s.comingSoonLabel, { color: sa.color }]}>Tap to Watch</Text>
                </TouchableOpacity>
              )
            ) : (
              <View style={[s.videoFrame, { backgroundColor: isDark ? '#111' : sa.color + '10', borderColor: sa.color + '30' }]}>
                <View style={[s.playCircle, { backgroundColor: sa.color + '20', borderColor: sa.color + '50' }]}>
                  <Feather name="film" size={36} color={sa.color} />
                </View>
                <Text style={[s.comingSoonLabel, { color: sa.color }]}>Video Lesson</Text>
                <View style={[s.badge, { backgroundColor: sa.color + '18', borderColor: sa.color + '40' }]}>
                  <Feather name="clock" size={11} color={sa.color} />
                  <Text style={[s.badgeText, { color: sa.color }]}>Coming Soon</Text>
                </View>
              </View>
            )}

            {/* Topic info */}
            <Text style={[s.topicTitle, { color: titleColor }]}>{topic}</Text>
            <Text style={[s.topicMeta, { color: mutedColor }]}>
              {grade} · {curriculum.replace('_', ' ')} · {subject}
            </Text>
            <Text style={[s.topicDesc, { color: colors.textMuted }]}>
              {VIDEO_MAP[topic]
                ? `Watch this engaging lesson on ${topic} and learn with Aivorah!`
                : `A video lesson on ${topic} is coming soon. In the meantime, start learning below!`}
            </Text>
          </View>

          {/* ── Content section (shown for all topics, especially when no video) ── */}
          {!VIDEO_MAP[topic] && (
            <View style={[s.contentCard, { backgroundColor: isDark ? colors.cardDark : sa.color + '0C', borderColor: borderCol }]}>
              {/* What you'll learn */}
              <View style={s.contentHeader}>
                <View style={[s.contentIconBox, { backgroundColor: sa.color + '20' }]}>
                  <Feather name="book-open" size={18} color={sa.color} />
                </View>
                <Text style={[s.contentTitle, { color: titleColor }]}>What you'll learn</Text>
              </View>
              <View style={{ gap: 8, marginTop: 4 }}>
                {(WHAT_YOU_LEARN[subject] ?? WHAT_YOU_LEARN['Mathematics']).map((item, i) => (
                  <View key={i} style={s.learnRow}>
                    <View style={[s.learnDot, { backgroundColor: sa.color }]} />
                    <Text style={[s.learnText, { color: colors.textMuted }]}>{item}</Text>
                  </View>
                ))}
              </View>

              {/* Action buttons */}
              <View style={s.actionRow}>
                <TouchableOpacity
                  style={[s.actionBtn, { backgroundColor: sa.color, flex: 1 }]}
                  onPress={() => navigation.navigate('TopicLesson', { topic, grade, subject, curriculum })}
                  activeOpacity={0.85}
                >
                  <Feather name="play-circle" size={16} color="#fff" />
                  <Text style={s.actionBtnText}>Start Learning</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.actionBtn, { backgroundColor: isDark ? colors.cardDark : sa.color + '15', borderWidth: 1, borderColor: sa.color + '50', flex: 1 }]}
                  onPress={() => navigation.navigate('IBPYPQuiz', { topic, grade, subject, curriculum })}
                  activeOpacity={0.85}
                >
                  <Feather name="check-square" size={16} color={sa.color} />
                  <Text style={[s.actionBtnText, { color: sa.color }]}>Practice Quiz</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Explore other topics */}
          <TouchableOpacity
            style={[s.altCard, { backgroundColor: isDark ? colors.cardDark : sa.color + '0C', borderColor: borderCol }]}
            onPress={() => goBackToTopics()}
            activeOpacity={0.75}
          >
            <View style={s.altRow}>
              <View style={[s.altIcon, { backgroundColor: sa.color + '18' }]}>
                <Feather name="list" size={18} color={sa.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.altTitle, { color: titleColor }]}>Explore Other Topics</Text>
                <Text style={[s.altSub, { color: colors.textMuted }]}>Browse all {subject} topics in {grade}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
        </ScrollView>

        {/* Floating per-topic AI Coach */}
        <TopicAICoach
          topic={topic}
          subject={subject}
          grade={grade}
          curriculum={curriculum}
        />
      </View>
    </ScreenLayout>
  );
}

const s = StyleSheet.create({
  content:      { padding: spacing.xl, paddingBottom: 100, gap: spacing.lg },
  backRow:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText:     { fontSize: 13, fontWeight: '600' },

  videoCard:    { borderRadius: radius.lg, borderWidth: 1, padding: spacing.xl, gap: spacing.md },
  subjectTag:   { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  subjectTagText: { fontSize: 12, fontWeight: '700' },

  videoFrame:   { borderRadius: radius.md, borderWidth: 1, height: 320, alignItems: 'center', justifyContent: 'center', gap: 12, overflow: 'hidden', backgroundColor: '#000' },
  playCircle:   { width: 80, height: 80, borderRadius: 40, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  comingSoonLabel: { fontSize: 15, fontWeight: '700' },
  badge:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  badgeText:    { fontSize: 12, fontWeight: '700' },

  topicTitle:   { fontSize: 20, fontWeight: '800', marginTop: 4 },
  topicMeta:    { fontSize: 12, fontWeight: '600' },
  topicDesc:    { fontSize: 13, lineHeight: 20 },

  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 4 },

  contentCard:    { borderRadius: radius.lg, borderWidth: 1, padding: spacing.xl, gap: spacing.md },
  contentHeader:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  contentIconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  contentTitle:   { fontSize: 16, fontWeight: '700' },
  learnRow:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  learnDot:       { width: 6, height: 6, borderRadius: 3 },
  learnText:      { fontSize: 13, flex: 1, lineHeight: 20 },
  actionRow:      { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.md },
  actionBtnText:  { fontSize: 13, fontWeight: '700', color: '#fff' },

  altCard:      { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  altRow:       { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  altIcon:      { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  altTitle:     { fontSize: 14, fontWeight: '700' },
  altSub:       { fontSize: 12, marginTop: 2 },

});
