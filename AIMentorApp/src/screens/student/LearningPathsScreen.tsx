import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';

import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useStudentData } from '../../context/StudentDataContext';
import { useAuth } from '../../context/AuthContext';
import { useResponsive } from '../../hooks/useResponsive';
import SERVER_URL from '../../config/serverUrl';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

type SubjectMeta = {
  icon: FeatherName;
  accentDark:  string;  // icon/text on dark bg
  accentLight: string;  // icon/text on light bg
  bgFromDark: string; bgToDark: string;
  bgFromLight: string; bgToLight: string;
};

const SUBJECT_META: Record<string, SubjectMeta> = {
  // Light pastels — same soft palette for both dark & light modes
  Mathematics:          { icon: 'trending-up',
    accentDark: '#BAA467', bgFromDark: '#D8CFA8', bgToDark: '#E6DEBC',
    accentLight: '#BAA467', bgFromLight: '#D8CFA8', bgToLight: '#E6DEBC' },
  Science:              { icon: 'zap',
    accentDark: '#9FB2A4', bgFromDark: '#C8DCCC', bgToDark: '#D8E8DC',
    accentLight: '#9FB2A4', bgFromLight: '#C8DCCC', bgToLight: '#D8E8DC' },
  EVS:                  { icon: 'sun',
    accentDark: '#9FB2A4', bgFromDark: '#C8DCCC', bgToDark: '#D8E8DC',
    accentLight: '#9FB2A4', bgFromLight: '#C8DCCC', bgToLight: '#D8E8DC' },
  'Social Studies':     { icon: 'globe',
    accentDark: '#BAA467', bgFromDark: '#E0D898', bgToDark: '#EEE8B4',
    accentLight: '#BAA467', bgFromLight: '#E0D898', bgToLight: '#EEE8B4' },
  English:              { icon: 'book-open',
    accentDark: '#C9A24E', bgFromDark: '#E4D4A8', bgToDark: '#F0E2BC',
    accentLight: '#C9A24E', bgFromLight: '#E4D4A8', bgToLight: '#F0E2BC' },
  Arts:                 { icon: 'feather',
    accentDark: '#C9A24E', bgFromDark: '#E4D4A8', bgToDark: '#F0E2BC',
    accentLight: '#C9A24E', bgFromLight: '#E4D4A8', bgToLight: '#F0E2BC' },
  'Physical Education': { icon: 'activity',
    accentDark: '#9FB2A4', bgFromDark: '#C8DCCC', bgToDark: '#D8E8DC',
    accentLight: '#9FB2A4', bgFromLight: '#C8DCCC', bgToLight: '#D8E8DC' },
  ICT:                  { icon: 'monitor',
    accentDark: '#BAA467', bgFromDark: '#D8CFA8', bgToDark: '#E6DEBC',
    accentLight: '#BAA467', bgFromLight: '#D8CFA8', bgToLight: '#E6DEBC' },
  'Economics & Trade':  { icon: 'dollar-sign',
    accentDark: '#C9A24E', bgFromDark: '#D8CC88', bgToDark: '#E8DCA0',
    accentLight: '#C9A24E', bgFromLight: '#D8CC88', bgToLight: '#E8DCA0' },
};

function subjectMeta(subject: string): SubjectMeta {
  return SUBJECT_META[subject] ?? {
    icon: 'book',
    accentDark: '#BAA467',  bgFromDark: '#3A3520',  bgToDark: '#4A4228',
    accentLight: '#9A7B2E', bgFromLight: '#E6DEBC', bgToLight: '#D8CFA8',
  };
}

interface TopicItem {
  topic: string;
  unit: string;
  description: string;
  grade?: string;
}

interface SubjectData {
  subject: string;
  topicCount: number;
  topics: TopicItem[];
}

interface SearchResult {
  topic: string;
  subject: string;
  grade: string;
  unit: string;
  description: string;
  score: number;
  snippet: string;
}

const NCERT_SUBJECTS = [
  { subject: 'Mathematics', icon: 'trending-up' as const, color: '#BAA467', available: true },
  { subject: 'Science', icon: 'zap' as const, color: '#9FB2A4', available: true },
  { subject: 'English', icon: 'book-open' as const, color: '#C9A24E', available: false },
  { subject: 'Social Studies', icon: 'globe' as const, color: '#C9A24E', available: false },
];

type CurriculumTopic = {
  grade: string;
  subject: string;
  unit: string;
  topic: string;
};

const IB_PYP_TOPIC_BANK: CurriculumTopic[] = [
  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Number Sense', topic: 'Place Value to 1000' },
  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Number Sense', topic: 'Addition & Subtraction' },
  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Number Sense', topic: 'Multiplication Basics' },
  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Geometry', topic: '2D and 3D Shapes' },
  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Measurement', topic: 'Time and Calendar' },
  { grade: 'Grade 3', subject: 'Science', unit: 'Living Things', topic: 'Plant Life Cycles' },
  { grade: 'Grade 3', subject: 'Science', unit: 'Living Things', topic: 'Animal Habitats' },
  { grade: 'Grade 3', subject: 'Science', unit: 'Earth & Space', topic: 'Weather Patterns' },
  { grade: 'Grade 3', subject: 'Science', unit: 'Earth & Space', topic: 'Soil and Rocks' },
  { grade: 'Grade 3', subject: 'Science', unit: 'Living Things', topic: 'Food Chains' },
  { grade: 'Grade 3', subject: 'Social Studies', unit: 'Communities', topic: 'My Community & Neighbourhood' },
  { grade: 'Grade 3', subject: 'Social Studies', unit: 'Communities', topic: 'Maps and Directions' },
  { grade: 'Grade 3', subject: 'Social Studies', unit: 'Heritage', topic: 'Cultural Traditions' },
  { grade: 'Grade 3', subject: 'English', unit: 'Reading', topic: 'Story Elements' },
  { grade: 'Grade 3', subject: 'English', unit: 'Reading', topic: 'Retelling and Sequencing' },
  { grade: 'Grade 3', subject: 'English', unit: 'Reading', topic: 'Reading with Expression' },
  { grade: 'Grade 3', subject: 'English', unit: 'Writing', topic: 'Paragraphs & Punctuation' },
  { grade: 'Grade 3', subject: 'English', unit: 'Writing', topic: 'Describing Characters' },
  { grade: 'Grade 3', subject: 'English', unit: 'Writing', topic: 'Writing Instructions' },
  { grade: 'Grade 3', subject: 'English', unit: 'Grammar', topic: 'Nouns, Verbs & Adjectives' },
  { grade: 'Grade 3', subject: 'English', unit: 'Grammar', topic: 'Compound Words' },
  { grade: 'Grade 3', subject: 'English', unit: 'Grammar', topic: 'Prefixes and Suffixes' },
  { grade: 'Grade 3', subject: 'Arts', unit: 'Visual Arts', topic: 'Colour Theory & Mixing' },
  { grade: 'Grade 3', subject: 'Arts', unit: 'Music', topic: 'Rhythm and Beat' },
  { grade: 'Grade 3', subject: 'Physical Education', unit: 'Movement', topic: 'Team Sports Basics' },
  { grade: 'Grade 3', subject: 'ICT', unit: 'Digital Literacy', topic: 'Introduction to Computers' },
  { grade: 'Grade 4', subject: 'Mathematics', unit: 'Number Sense', topic: 'Fractions and Decimals' },
  { grade: 'Grade 4', subject: 'Mathematics', unit: 'Number Sense', topic: 'Multiplication & Division' },
  { grade: 'Grade 4', subject: 'Mathematics', unit: 'Data Handling', topic: 'Graphs and Statistics' },
  { grade: 'Grade 4', subject: 'Science', unit: 'Forces & Motion', topic: 'Push, Pull and Gravity' },
  { grade: 'Grade 4', subject: 'Science', unit: 'Matter', topic: 'States of Matter' },
  { grade: 'Grade 4', subject: 'Science', unit: 'Living Things', topic: 'Food Chains and Ecosystems' },
  { grade: 'Grade 4', subject: 'Social Studies', unit: 'Global Connections', topic: 'Countries and Continents' },
  { grade: 'Grade 4', subject: 'English', unit: 'Reading', topic: 'Comprehension Strategies' },
  { grade: 'Grade 4', subject: 'English', unit: 'Reading', topic: 'Reading Fluency & Inference' },
  { grade: 'Grade 4', subject: 'English', unit: 'Writing', topic: 'Narrative Writing' },
  { grade: 'Grade 4', subject: 'English', unit: 'Writing', topic: 'Descriptive Writing' },
  { grade: 'Grade 4', subject: 'English', unit: 'Writing', topic: 'Paragraphing & Organisation' },
  { grade: 'Grade 4', subject: 'English', unit: 'Grammar', topic: 'Direct and Indirect Speech' },
  { grade: 'Grade 4', subject: 'English', unit: 'Grammar', topic: 'Tenses — Past, Present & Future' },
  { grade: 'Grade 4', subject: 'English', unit: 'Grammar', topic: 'Conjunctions and Connectives' },
  { grade: 'Grade 4', subject: 'English', unit: 'Grammar', topic: 'Punctuation — Commas, Apostrophes & Speech Marks' },
  { grade: 'Grade 4', subject: 'English', unit: 'Vocabulary', topic: 'Synonyms & Antonyms' },
  { grade: 'Grade 4', subject: 'Arts', unit: 'Visual Arts', topic: 'Perspective Drawing' },
  { grade: 'Grade 4', subject: 'ICT', unit: 'Digital Literacy', topic: 'Internet Safety' },
  { grade: 'Grade 5', subject: 'Mathematics', unit: 'Algebra', topic: 'Patterns and Variables' },
  { grade: 'Grade 5', subject: 'Mathematics', unit: 'Number Sense', topic: 'Percentages and Ratios' },
  { grade: 'Grade 5', subject: 'Science', unit: 'Earth & Space', topic: 'Solar System & Planets' },
  { grade: 'Grade 5', subject: 'Science', unit: 'Life Science', topic: 'Human Body Systems' },
  { grade: 'Grade 5', subject: 'Science', unit: 'Life Science', topic: 'Food Webs and Ecosystems' },
  { grade: 'Grade 5', subject: 'Social Studies', unit: 'History', topic: 'Ancient Civilisations' },
  { grade: 'Grade 5', subject: 'English', unit: 'Writing', topic: 'Persuasive Writing' },
  { grade: 'Grade 5', subject: 'English', unit: 'Writing', topic: 'Formal vs Informal Writing' },
  { grade: 'Grade 5', subject: 'English', unit: 'Writing', topic: 'Research and Note-taking' },
  { grade: 'Grade 5', subject: 'English', unit: 'Literature', topic: 'Poetry and Figurative Language' },
  { grade: 'Grade 5', subject: 'English', unit: 'Literature', topic: 'Literary Devices' },
  { grade: 'Grade 5', subject: 'English', unit: 'Grammar', topic: 'Direct and Indirect Speech' },
  { grade: 'Grade 5', subject: 'English', unit: 'Grammar', topic: 'Active and Passive Voice' },
  { grade: 'Grade 5', subject: 'English', unit: 'Vocabulary', topic: 'Idioms and Expressions' },
  { grade: 'Grade 5', subject: 'Arts', unit: 'Performing Arts', topic: 'Drama and Expression' },
  { grade: 'Grade 5', subject: 'ICT', unit: 'Coding', topic: 'Introduction to Scratch' },
];

// Static IB PYP subject lists per grade — shown instantly; overridden if Qdrant has live data
const IB_PYP_SUBJECTS_BY_GRADE: Record<string, SubjectData[]> = {
  'Grade 3': [
    { subject: 'Mathematics',      topicCount: 16, topics: [] },
    { subject: 'Science',          topicCount: 11, topics: [] },
    { subject: 'English',          topicCount: 9,  topics: [] },
    { subject: 'Social Studies',   topicCount: 8,  topics: [] },
    { subject: 'Arts',             topicCount: 4,  topics: [] },
    { subject: 'Physical Education', topicCount: 3, topics: [] },
    { subject: 'ICT',              topicCount: 2,  topics: [] },
  ],
  'Grade 4': [
    { subject: 'Mathematics',      topicCount: 12, topics: [] },
    { subject: 'Science',          topicCount: 8,  topics: [] },
    { subject: 'English',          topicCount: 10, topics: [] },
    { subject: 'Social Studies',   topicCount: 5,  topics: [] },
    { subject: 'Arts',             topicCount: 2,  topics: [] },
    { subject: 'Physical Education', topicCount: 2, topics: [] },
    { subject: 'ICT',              topicCount: 2,  topics: [] },
  ],
  'Grade 5': [
    { subject: 'Mathematics',      topicCount: 11, topics: [] },
    { subject: 'Science',          topicCount: 7,  topics: [] },
    { subject: 'English',          topicCount: 8,  topics: [] },
    { subject: 'Social Studies',   topicCount: 5,  topics: [] },
    { subject: 'Arts',             topicCount: 2,  topics: [] },
    { subject: 'Physical Education', topicCount: 2, topics: [] },
    { subject: 'ICT',              topicCount: 2,  topics: [] },
  ],
};

// Grades with no curriculum content ingested yet — show a "coming soon" state
// instead of falling back to other grades' topics (mock data). (client feedback)
const NO_CONTENT_GRADES = ['Nursery', 'LKG', 'UKG'];

function buildSubjectsFromTopicBank(topics: CurriculumTopic[]): SubjectData[] {
  const subjectMap: Record<string, TopicItem[]> = {};
  for (const entry of topics) {
    if (!subjectMap[entry.subject]) subjectMap[entry.subject] = [];
    subjectMap[entry.subject].push({
      topic: entry.topic,
      unit: entry.unit,
      grade: entry.grade,
      description: `Learn about ${entry.topic} in ${entry.unit}`,
    });
  }

  return Object.entries(subjectMap).map(([subject, subjectTopics]) => ({
    subject,
    topicCount: subjectTopics.length,
    topics: subjectTopics,
  }));
}

function getIBPYPStaticSubjects(grade: string): SubjectData[] {
  const seed = IB_PYP_SUBJECTS_BY_GRADE[grade] ?? IB_PYP_SUBJECTS_BY_GRADE['Grade 3'];
  const bankSubjects = buildSubjectsFromTopicBank(IB_PYP_TOPIC_BANK.filter((item) => item.grade === grade));
  const bankTopicsBySubject = new Map(bankSubjects.map((item) => [item.subject, item.topics]));

  const seeded = seed.map((item) => ({
    ...item,
    topics: bankTopicsBySubject.get(item.subject) ?? item.topics,
  }));

  const seedSubjects = new Set(seed.map((item) => item.subject));
  const extras = bankSubjects
    .filter((item) => !seedSubjects.has(item.subject))
    .map((item) => ({ ...item }));

  return [...seeded, ...extras];
}

const QUICK_HINTS = ['fractions', 'plants', 'grammar', 'magnets'];

function SearchResultRow({
  item,
  colors,
  isDark,
  onPress,
}: {
  item: SearchResult;
  colors: AppColors;
  isDark: boolean;
  onPress: () => void;
}) {
  const meta = subjectMeta(item.subject);
  const accent = isDark ? meta.accentDark : meta.accentLight;
  return (
    <TouchableOpacity
      style={[searchStyles.row, { backgroundColor: colors.cardDark, borderColor: accent + '40' }]}
      onPress={onPress}
      activeOpacity={0.82}
    >
      <View style={[searchStyles.iconBox, { backgroundColor: accent + '1f' }]}>
        <Feather name={meta.icon} size={17} color={accent} />
      </View>
      <View style={searchStyles.main}>
        <View style={searchStyles.headlineRow}>
          <Text style={[searchStyles.topic, { color: colors.textMain }]} numberOfLines={1}>
            {item.topic}
          </Text>
          <Text style={[searchStyles.score, { color: accent }]}>{Math.round(item.score * 100)}%</Text>
        </View>
        <Text style={[searchStyles.meta, { color: accent }]} numberOfLines={1}>
          {item.subject} {item.grade ? `- ${item.grade}` : ''} {item.unit ? `- ${item.unit}` : ''}
        </Text>
        <Text style={[searchStyles.snippet, { color: colors.textMuted }]} numberOfLines={2}>
          {item.snippet || item.description}
        </Text>
      </View>
      <Feather name="arrow-up-right" size={16} color={accent} />
    </TouchableOpacity>
  );
}

const searchStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 12,
    marginBottom: 8,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: { flex: 1, gap: 2 },
  headlineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  topic: { fontSize: 13, fontWeight: '700', flex: 1 },
  score: { fontSize: 11, fontWeight: '800' },
  meta: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  snippet: { fontSize: 12, lineHeight: 17 },
});

function SubjectCard({
  data,
  completedSet,
  onPress,
  width,
  isBlocked,
}: {
  data: SubjectData;
  completedSet: Set<string>;
  onPress: () => void;
  width: `${number}%` | number;
  isBlocked?: boolean;
}) {
  const { isDark } = useTheme();
  const meta   = subjectMeta(data.subject);
  const done   = data.topics.reduce((acc, topic) => acc + (completedSet.has(topic.topic) ? 1 : 0), 0);
  const pct    = data.topicCount > 0 ? Math.round((done / data.topicCount) * 100) : 0;
  const accent = isDark ? meta.accentDark : meta.accentLight;

  return (
    <TouchableOpacity style={[cardStyles.touch, { width }]} activeOpacity={isBlocked ? 1 : 0.86} onPress={isBlocked ? undefined : onPress}>
      <LinearGradient
        colors={[meta.bgFromDark, meta.bgToDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[cardStyles.gradient, { borderColor: accent + '40' }]}
      >
        <View style={cardStyles.topRow}>
          <View style={[cardStyles.iconWrap, { backgroundColor: '#ffffff50' }]}>
            <Feather name={meta.icon} size={18} color={accent} />
          </View>
          <View style={[cardStyles.pctPill, { borderColor: accent + '88', backgroundColor: '#ffffff50' }]}>
            <Text style={[cardStyles.pctText, { color: accent }]}>{pct}%</Text>
          </View>
        </View>
        <Text style={[cardStyles.subjectName, { color: '#1C2A28' }]} numberOfLines={2}>{data.subject}</Text>
        <View style={cardStyles.statRow}>
          <Text style={[cardStyles.statMini, { color: '#3A5A56' }]}>{data.topicCount} topics</Text>
          <Text style={[cardStyles.statMini, { color: '#3A5A56' }]}>{done} completed</Text>
        </View>
        <View style={[cardStyles.track, { backgroundColor: accent + '40' }]}>
          <View style={[cardStyles.fill, { width: `${pct}%`, backgroundColor: accent }]} />
        </View>

        {isBlocked && (
          <View style={cardStyles.blockedOverlay}>
            <View style={cardStyles.blockedBadge}>
              <Feather name="lock" size={14} color="#fff" />
              <Text style={cardStyles.blockedText}>Blocked by parent</Text>
            </View>
          </View>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

function NcertCard({
  item,
  grade,
  curriculum,
  width,
  colors,
  onPress,
}: {
  item: (typeof NCERT_SUBJECTS)[number];
  grade: string;
  curriculum: string;
  width: `${number}%` | number;
  colors: AppColors;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        cardStyles.touch,
        {
          width,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: item.available ? item.color + '55' : colors.borderColor,
          backgroundColor: colors.cardDark,
          padding: 14,
          minHeight: 132,
          opacity: item.available ? 1 : 0.75,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.84}
    >
      <View style={[cardStyles.iconWrap, { backgroundColor: item.color + '1f' }]}>
        <Feather name={item.icon} size={18} color={item.available ? item.color : colors.textDim} />
      </View>
      <Text style={[cardStyles.ncertName, { color: item.available ? colors.textMain : colors.textDim }]}>{item.subject}</Text>
      <Text style={[cardStyles.ncertMeta, { color: item.available ? colors.textMuted : colors.textDim }]}>
        {item.available ? `${grade} - ${curriculum}` : 'Coming soon'}
      </Text>
      <View
        style={[
          cardStyles.ncertBadge,
          {
            borderColor: item.available ? item.color + '55' : colors.borderColor,
            backgroundColor: item.available ? item.color + '18' : colors.cardHover,
          },
        ]}
      >
        <Text style={[cardStyles.ncertBadgeText, { color: item.available ? item.color : colors.textDim }]}>
          {item.available ? 'Active' : 'Soon'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const cardStyles = StyleSheet.create({
  touch: {
    marginBottom: spacing.md,
  },
  gradient: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    minHeight: 142,
  },
  lightCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(239,209,212,0.60)',
    borderLeftWidth: 4,
    padding: 14,
    minHeight: 142,
    shadowColor: '#2C3830',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pctPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pctText: { fontSize: 11, fontWeight: '800' },
  subjectName: { fontSize: 16, fontWeight: '800', marginTop: 12, marginBottom: 10 },
  statRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statMini: { fontSize: 11, fontWeight: '600' },
  track: {
    marginTop: 12,
    height: 5,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#ffffff2b',
  },
  fill: { height: '100%', borderRadius: 999 },
  ncertName: { fontSize: 15, fontWeight: '800', marginTop: 12 },
  ncertMeta: { fontSize: 11, fontWeight: '500', marginTop: 4 },
  ncertBadge: {
    marginTop: 12,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  ncertBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
  blockedOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  blockedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.7)', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20,
  },
  blockedText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

const SEARCH_STOPWORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
const SUBJECT_SEARCH_KEYWORDS: Record<string, string[]> = {
  Mathematics: ['math', 'mathematics', 'number', 'numbers', 'fractions', 'geometry', 'algebra', 'shapes', 'calculation'],
  Science: ['science', 'plant', 'plants', 'animal', 'animals', 'weather', 'space', 'matter', 'gravity'],
  English: ['english', 'grammar', 'reading', 'writing', 'story', 'stories', 'language', 'punctuation', 'adjective', 'speech', 'direct', 'indirect', 'tense', 'tenses', 'noun', 'verb', 'comprehension', 'narrative', 'descriptive', 'persuasive', 'poetry', 'vocabulary', 'synonym', 'antonym', 'conjunction', 'apostrophe', 'inference', 'figurative', 'idiom', 'active', 'passive', 'voice', 'literature'],
  'Social Studies': ['social', 'society', 'studies', 'history', 'geography', 'community', 'culture', 'map', 'maps'],
  Arts: ['art', 'arts', 'drawing', 'painting', 'music', 'rhythm', 'drama', 'creative', 'colour', 'color'],
  'Physical Education': ['pe', 'physical', 'sports', 'movement', 'fitness', 'exercise', 'game', 'games'],
  ICT: ['ict', 'computer', 'computers', 'digital', 'internet', 'coding', 'technology', 'scratch'],
};

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map(stemToken)
    .filter((token) => token.length > 1 && !SEARCH_STOPWORDS.has(token));
}

function localTopicSearch(query: string, grade: string, subjects: SubjectData[], limit = 12): SearchResult[] {
  const qNorm = normalizeText(query);
  if (!qNorm) return [];
  const qTokens = tokenize(query);

  const scored = subjects.flatMap((subject) =>
    subject.topics
      .map((topicItem) => {
        const topic = topicItem.topic ?? '';
        const unit = topicItem.unit ?? '';
        const description = topicItem.description ?? '';

        const topicNorm = normalizeText(topic);
        const unitNorm = normalizeText(unit);
        const subjectNorm = normalizeText(subject.subject);
        const descriptionNorm = normalizeText(description);
        const subjectKeywords = SUBJECT_SEARCH_KEYWORDS[subject.subject] ?? [];

        let score = 0;
        if (topicNorm === qNorm) score += 1;
        if (topicNorm.startsWith(qNorm)) score += 0.35;
        if (topicNorm.includes(qNorm)) score += 0.28;
        if (unitNorm.includes(qNorm)) score += 0.24;
        if (subjectNorm.includes(qNorm)) score += 0.3;
        if (descriptionNorm.includes(qNorm)) score += 0.18;

        for (const token of qTokens) {
          if (topicNorm.includes(token)) score += 0.18;
          if (unitNorm.includes(token)) score += 0.12;
          if (subjectNorm.includes(token)) score += 0.2;
          if (descriptionNorm.includes(token)) score += 0.08;
          if (subjectKeywords.some((keyword) => normalizeText(keyword).includes(token) || token.includes(normalizeText(keyword)))) {
            score += 0.2;
          }
        }

        if (score <= 0) return null;

        return {
          topic,
          subject: subject.subject,
          grade: topicItem.grade ?? grade,
          unit,
          description: description || `Learn about ${topic} in ${unit || subject.subject}`,
          score: Math.min(score, 1),
          snippet: unit ? `${unit} - ${topic}` : topic,
        } as SearchResult;
      })
      .filter((item): item is SearchResult => item !== null),
  );

  return scored
    .sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic))
    .slice(0, limit);
}

function inferSubjectFromQuery(query: string, subjects: SubjectData[]): string {
  const tokens = tokenize(query);
  if (tokens.length === 0) return subjects[0]?.subject ?? 'Science';

  const available = subjects.length > 0 ? subjects.map((s) => s.subject) : Object.keys(SUBJECT_SEARCH_KEYWORDS);
  let bestSubject = available[0] ?? 'Science';
  let bestScore = 0;

  for (const subject of available) {
    const subjectTokens = tokenize(subject);
    const keywords = [...subjectTokens, ...(SUBJECT_SEARCH_KEYWORDS[subject] ?? [])].map((k) => normalizeText(k));
    const score = tokens.reduce((acc, token) => {
      return acc + (keywords.some((keyword) => keyword.includes(token) || token.includes(keyword)) ? 1 : 0);
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestSubject = subject;
    }
  }

  return bestSubject;
}

function dedupeSearchResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const item of results) {
    const key = `${normalizeText(item.topic)}|${normalizeText(item.subject)}|${normalizeText(item.grade)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function createExactTopicSuggestion(query: string, grade: string, subjects: SubjectData[]): SearchResult {
  const cleanQuery = query.trim().replace(/\s+/g, ' ');
  const topic = cleanQuery.charAt(0).toUpperCase() + cleanQuery.slice(1);
  const subject = inferSubjectFromQuery(cleanQuery, subjects);
  return {
    topic,
    subject,
    grade,
    unit: 'Student Search',
    description: `Start learning "${topic}" for ${grade} ${subject}.`,
    score: 1,
    snippet: `Exact match - ${topic}`,
  };
}

function finalizeSearchResults(
  query: string,
  grade: string,
  subjects: SubjectData[],
  results: SearchResult[],
  limit = 12,
): SearchResult[] {
  const qNorm = normalizeText(query);
  if (!qNorm) return [];

  const deduped = dedupeSearchResults(results).map((item) => ({
    ...item,
    grade: item.grade || grade,
  }));
  const hasExact = deduped.some((item) => normalizeText(item.topic) === qNorm);
  const ranked = deduped.sort((a, b) => {
    const aExact = normalizeText(a.topic) === qNorm ? 1 : 0;
    const bExact = normalizeText(b.topic) === qNorm ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return b.score - a.score || a.topic.localeCompare(b.topic);
  });

  if (!hasExact) {
    return [createExactTopicSuggestion(query, grade, subjects), ...ranked].slice(0, limit);
  }
  return ranked.slice(0, limit);
}

function getIBPYPFallbackSearchResults(query: string, grade: string, subjects: SubjectData[], limit = 12): SearchResult[] {
  const localResults = localTopicSearch(query, grade, subjects, limit);
  if (localResults.length > 0) return localResults;

  const gradeTopics = IB_PYP_TOPIC_BANK.filter((entry) => entry.grade === grade);
  const gradeResults = localTopicSearch(query, grade, buildSubjectsFromTopicBank(gradeTopics), limit);
  if (gradeResults.length > 0) return gradeResults;

  return localTopicSearch(query, grade, buildSubjectsFromTopicBank(IB_PYP_TOPIC_BANK), limit);
}

export default function LearningPathsScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { isMobile } = useResponsive();
  const { stats } = useStudentData();
  const { user, refreshProfile } = useAuth();

  const curriculum = user?.curriculum ?? '';
  const grade = user?.grade ?? '';

  // Re-sync grade/curriculum on focus — e.g. a parent editing this child's grade
  // elsewhere would otherwise leave this screen showing the OLD grade's content
  // until the student happened to visit Dashboard/Settings first (same fix
  // already applied there and in Challenges).
  useFocusEffect(useCallback(() => { refreshProfile().catch(() => {}); }, [refreshProfile]));
  // Normalise IB PYP — stored value may have space or underscore
  const isPYP  = /^ib.?pyp$/i.test(curriculum.trim());
  const isCBSE = !isPYP && (curriculum === 'NCERT' || curriculum === 'CBSE');

  // Server (Qdrant) is the source of truth for subjects. We no longer pre-seed a
  // stale static IB PYP list — that painted first then got swapped for the real
  // set (different topic counts + extra subjects), which looked like a flicker.
  const [subjects, setSubjects] = useState<SubjectData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const completedSet = useMemo(() => new Set(stats.completedTopics ?? []), [stats.completedTopics]);

  // Parental subject filter
  const [blockedSubjects, setBlockedSubjects] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!user?.email) return;
    fetch(`${SERVER_URL}/parent/screen-time-status/${encodeURIComponent(user.email)}`)
      .then(r => r.json())
      .then(data => {
        if (data.subjectFilter?.enabled && Array.isArray(data.subjectFilter.blockedSubjects)) {
          setBlockedSubjects(new Set(data.subjectFilter.blockedSubjects));
        }
      })
      .catch(() => {});
  }, [user?.email]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    // For CBSE, query Qdrant with curriculum=CBSE
    const queryCurriculum = isCBSE ? 'CBSE' : curriculum;

    fetch(`${SERVER_URL}/curriculum/subjects?grade=${encodeURIComponent(grade)}&curriculum=${encodeURIComponent(queryCurriculum)}`)
      .then((r) => r.json())
      .then((data: { subjects: SubjectData[] }) => {
        if (cancelled) return;
        if (data.subjects && data.subjects.length > 0) {
          setSubjects(data.subjects);
        } else if (isPYP) {
          // Offline / empty fallback only (server is the source of truth).
          setSubjects(getIBPYPStaticSubjects(grade));
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (isPYP) setSubjects(getIBPYPStaticSubjects(grade));
        else setError('Could not load curriculum right now. Check if the server is running and try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [curriculum, grade, isCBSE]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const handleSearch = useCallback(
    (text: string) => {
      setSearchText(text);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (!text.trim()) {
        setSearching(false);
        setSearchResults([]);
        return;
      }

      setSearching(true);
      searchTimer.current = setTimeout(async () => {
        try {
          let currentSubjects = subjects;
          const res = await fetch(
            `${SERVER_URL}/curriculum/search?q=${encodeURIComponent(text.trim())}&grade=${encodeURIComponent(grade)}&curriculum=${encodeURIComponent(curriculum)}&limit=12`,
          );
          const data = await res.json();
          const remoteResults = Array.isArray(data.topics) ? data.topics : [];

          const localResults = isPYP
            ? getIBPYPFallbackSearchResults(text, grade, subjects, 12)
            : localTopicSearch(text, grade, subjects, 12);
          const combinedInitial = finalizeSearchResults(text, grade, currentSubjects, [...remoteResults, ...localResults], 12);
          if (combinedInitial.length > 0) {
            setSearchResults(combinedInitial);
          }

          const hasLocalTopics = subjects.some((s) => s.topics.length > 0);
          if (!hasLocalTopics && !isCBSE && remoteResults.length === 0) {
            const subjectsRes = await fetch(
              `${SERVER_URL}/curriculum/subjects?grade=${encodeURIComponent(grade)}&curriculum=${encodeURIComponent(curriculum)}`,
            );
            const subjectsData = await subjectsRes.json();
            const fetchedSubjects = Array.isArray(subjectsData.subjects) ? subjectsData.subjects : [];
            if (fetchedSubjects.length > 0) {
              setSubjects(fetchedSubjects);
              currentSubjects = fetchedSubjects;
              const fallbackResults = isPYP
                ? getIBPYPFallbackSearchResults(text, grade, fetchedSubjects, 12)
                : localTopicSearch(text, grade, fetchedSubjects, 12);
              setSearchResults(finalizeSearchResults(text, grade, fetchedSubjects, [...remoteResults, ...fallbackResults], 12));
              return;
            }
          }

          if (remoteResults.length === 0) {
            setSearchResults(
              finalizeSearchResults(
                text,
                grade,
                currentSubjects,
                isPYP
                  ? getIBPYPFallbackSearchResults(text, grade, currentSubjects, 12)
                  : localTopicSearch(text, grade, currentSubjects, 12),
                12,
              ),
            );
          }
        } catch {
          setSearchResults(
            finalizeSearchResults(
              text,
              grade,
              subjects,
              isPYP
                ? getIBPYPFallbackSearchResults(text, grade, subjects, 12)
                : localTopicSearch(text, grade, subjects, 12),
              12,
            ),
          );
        } finally {
          setSearching(false);
        }
      }, 360);
    },
    [curriculum, grade, isCBSE, isPYP, subjects],
  );

  const isSearching = searchText.trim().length > 0;
  const cardWidth = (isMobile ? '100%' : '48.7%') as `${number}%`;
  const metricWidth = (isMobile ? '48.7%' : '24%') as `${number}%`;

  const totals = useMemo(() => {
    const totalTopics = subjects.reduce((acc, s) => acc + s.topicCount, 0);
    const doneTopics = subjects.reduce(
      (acc, s) => acc + s.topics.reduce((sum, t) => sum + (completedSet.has(t.topic) ? 1 : 0), 0),
      0,
    );
    const cappedDone = Math.min(doneTopics, totalTopics);
    const overallPct = totalTopics > 0 ? Math.round((cappedDone / totalTopics) * 100) : 0;
    return { totalTopics, doneTopics: cappedDone, overallPct };
  }, [subjects, completedSet]);

  const heroName = user?.name?.split(' ')[0] ?? 'Student';
  const heroSubtitle = `${subjects.length} subjects - ${totals.doneTopics}/${totals.totalTopics} topics completed`;

  const statCards = [
    { label: 'Topics Done', value: String(Math.min(completedSet.size, totals.totalTopics)), icon: 'check-circle' as FeatherName, color: colors.accentGreen },
    { label: 'Streak', value: `${stats.currentStreak}d`, icon: 'zap' as FeatherName, color: colors.accentYellow },
    { label: 'Today XP', value: `+${stats.todayXP}`, icon: 'star' as FeatherName, color: colors.accentYellow },
    { label: 'Level', value: `Lv ${stats.level}`, icon: 'award' as FeatherName, color: colors.accentYellow },
  ];

  // Guard: if grade or curriculum is missing, the user's profile is incomplete.
  // Never silently show wrong curriculum content — prompt them to complete setup.
  if (!grade || !curriculum) {
    return (
      <ScreenLayout>
        <View style={[styles.screen, styles.center]}>
          <Feather name="alert-circle" size={38} color={colors.textDim} />
          <Text style={[styles.dimText, { marginTop: 12, textAlign: 'center', maxWidth: 340 }]}>
            Your profile is incomplete. Please update your grade and curriculum in Settings to see your learning paths.
          </Text>
          <TouchableOpacity
            style={{ marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.accentYellow }}
            onPress={() => navigation.navigate('Settings')}
            activeOpacity={0.85}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Go to Settings</Text>
          </TouchableOpacity>
        </View>
      </ScreenLayout>
    );
  }

  // No content ingested for this grade yet (e.g. Early Years) — show a polished
  // "coming soon" message instead of another grade's topics.
  if (NO_CONTENT_GRADES.includes(grade)) {
    return (
      <ScreenLayout>
        <View style={styles.screen}>
          <Header title="My Learning Journey" subtitle={`${isCBSE ? 'CBSE' : curriculum} - ${grade}`} onMenuPress={() => navigation.openDrawer()} />
          <View style={[styles.center, { flex: 1, paddingHorizontal: 28 }]}>
            <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: colors.accentYellow + '1A', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
              <Feather name="book-open" size={32} color={colors.accentYellow} />
            </View>
            <Text style={{ fontSize: 20, fontWeight: '800', color: colors.textMain, textAlign: 'center', marginBottom: 10 }}>
              Content for {grade} is on the way
            </Text>
            <Text style={[styles.dimText, { textAlign: 'center', maxWidth: 440, lineHeight: 21 }]}>
              We're carefully crafting age-appropriate learning content for {grade}. It will appear here as soon as it's ready. Thank you for your patience!
            </Text>
          </View>
        </View>
      </ScreenLayout>
    );
  }

  if (loading) {
    return (
      <ScreenLayout>
        <View style={[styles.screen, styles.center]}>
          <ActivityIndicator size="large" color={colors.accentYellow} />
          <Text style={[styles.dimText, { marginTop: 16 }]}>Loading {curriculum} curriculum...</Text>
        </View>
      </ScreenLayout>
    );
  }

  if (error) {
    return (
      <ScreenLayout>
        <View style={[styles.screen, styles.center]}>
          <Feather name="wifi-off" size={38} color={colors.textDim} />
          <Text style={[styles.dimText, { marginTop: 12, textAlign: 'center', maxWidth: 420 }]}>{error}</Text>
        </View>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="My Learning Journey"
          subtitle={`${isCBSE ? 'CBSE' : curriculum} - ${grade}`}
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <LinearGradient
            colors={[colors.accentYellow + '35', colors.accentYellow + '20', colors.cardDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.heroCard, { borderColor: colors.accentYellow + '45' }]}
          >
            <View style={styles.heroTop}>
              <View style={styles.heroTitleWrap}>
                <Text style={styles.heroEyebrow}>Dashboard</Text>
                <Text style={styles.heroTitle}>{heroName}, keep the streak alive</Text>
                <Text style={styles.heroSubtitle}>{heroSubtitle}</Text>
              </View>
              <View style={[styles.heroProgress, { borderColor: colors.accentYellow + '65' }]}>
                <Text style={[styles.heroProgressValue, { color: colors.accentYellow }]}>{totals.overallPct}%</Text>
                <Text style={styles.heroProgressLabel}>overall</Text>
              </View>
            </View>
            <View style={styles.heroMetaRow}>
              <View style={[styles.heroMetaChip, { borderColor: colors.borderColor }]}>
                <Feather name="book" size={12} color={colors.textMuted} />
                <Text style={styles.heroMetaText}>{curriculum}</Text>
              </View>
              <View style={[styles.heroMetaChip, { borderColor: colors.borderColor }]}>
                <Feather name="layers" size={12} color={colors.textMuted} />
                <Text style={styles.heroMetaText}>{grade}</Text>
              </View>
            </View>
          </LinearGradient>

          <View style={[styles.searchPanel, { borderColor: colors.borderColor }]}>
            <View style={[styles.searchBox, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
              <Feather name="search" size={15} color={colors.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.searchInput, { color: colors.textMain }]}
                placeholder="Search topics... e.g. fractions, photosynthesis"
                placeholderTextColor={colors.textDim}
                value={searchText}
                onChangeText={handleSearch}
                returnKeyType="search"
              />
              {searchText.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setSearchText('');
                    setSearchResults([]);
                    setSearching(false);
                  }}
                  hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                >
                  <Feather name="x" size={14} color={colors.textMuted} />
                </TouchableOpacity>
              )}
              {searching ? <ActivityIndicator size="small" color={colors.accentYellow} style={{ marginLeft: 8 }} /> : null}
            </View>
            {!isSearching ? (
              <View style={styles.hintsRow}>
                <Text style={styles.hintsLabel}>Try:</Text>
                {QUICK_HINTS.map((hint) => (
                  <TouchableOpacity
                    key={hint}
                    style={[styles.hintChip, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}
                    onPress={() => handleSearch(hint)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.hintChipText}>{hint}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>

          {isSearching ? (
            <View style={{ marginTop: 2 }}>
              {searchResults.length === 0 && !searching ? (
                <View style={styles.emptySearch}>
                  <Feather name="search" size={16} color={colors.textDim} />
                  <Text style={styles.dimText}>No topics found for "{searchText}"</Text>
                </View>
              ) : (
                searchResults.map((item) => (
                  <SearchResultRow
                    key={`${item.subject}|${item.topic}`}
                    item={item}
                    colors={colors}
                    isDark={isDark}
                    onPress={() =>
                      navigation.navigate('VideoLesson', {
                        topic: item.topic,
                        grade: item.grade || grade,
                        subject: item.subject,
                        curriculum,
                      })
                    }
                  />
                ))
              )}
            </View>
          ) : (
            <>
              <View style={styles.metricGrid}>
                {statCards.map((s) => (
                  <View
                    key={s.label}
                    style={[
                      styles.metricCard,
                      {
                        width: metricWidth,
                        borderColor: s.color + '3a',
                        backgroundColor: colors.cardDark,
                      },
                    ]}
                  >
                    <View style={[styles.metricIcon, { backgroundColor: s.color + '18' }]}>
                      <Feather name={s.icon} size={14} color={s.color} />
                    </View>
                    <Text style={[styles.metricValue, { color: s.color }]}>{s.value}</Text>
                    <Text style={styles.metricLabel}>{s.label}</Text>
                  </View>
                ))}
              </View>

              {(() => {
                if (totals.overallPct === 100) {
                  return (
                    <View style={[styles.continueBanner, { borderColor: '#10b98145' }]}>
                      <View style={[styles.continueDot, { backgroundColor: '#10b981' }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.continueLabel, { color: '#10b981' }]}>All topics completed!</Text>
                        <Text style={[styles.continueTopic, { color: colors.textMuted }]} numberOfLines={1}>
                          Amazing work — you've explored everything.
                        </Text>
                      </View>
                      <Feather name="check-circle" size={17} color="#10b981" />
                    </View>
                  );
                }

                // All topics with their subject for lookup
                const allTopics = subjects.flatMap(s => s.topics.map(t => ({ ...t, subject: s.subject })));

                // Case 1: User was mid-topic (lastLesson exists and not yet completed)
                // → Route them directly to the quiz to finish what they started
                const midTopic = stats.lastLesson
                  ? allTopics.find(t => t.topic === stats.lastLesson && !completedSet.has(t.topic))
                  : null;
                const midSubject = midTopic
                  ? subjects.find(s => s.topics.some(t => t.topic === midTopic.topic))
                  : null;

                if (midTopic && midSubject) {
                  return (
                    <TouchableOpacity
                      style={[styles.continueBanner, { borderColor: colors.accentYellow + '60' }]}
                      onPress={() =>
                        navigation.navigate('IBPYPQuiz', {
                          topic: midTopic.topic,
                          subject: midSubject.subject,
                          grade,
                          curriculum: isCBSE ? 'CBSE' : curriculum,
                        })
                      }
                      activeOpacity={0.87}
                    >
                      <View style={[styles.continueDot, { backgroundColor: colors.accentYellow }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.continueLabel, { color: colors.accentYellow }]}>Complete your quiz</Text>
                        <Text style={[styles.continueTopic, { color: colors.textMain }]} numberOfLines={1}>
                          {midTopic.topic}
                        </Text>
                      </View>
                      <Feather name="arrow-right" size={17} color={colors.accentYellow} />
                    </TouchableOpacity>
                  );
                }

                // Case 2: Last topic is done — find the next incomplete topic
                const nextTopic = allTopics.find(t => !completedSet.has(t.topic));
                const nextSubject = nextTopic
                  ? subjects.find(s => s.topics.some(t => t.topic === nextTopic.topic))
                  : null;

                if (!nextTopic || !nextSubject) return null;

                return (
                  <TouchableOpacity
                    style={[styles.continueBanner, { borderColor: colors.accentYellow + '45' }]}
                    onPress={() =>
                      navigation.navigate('SubjectTopics', {
                        subject: nextSubject.subject,
                        curriculum: isCBSE ? 'CBSE' : curriculum,
                        grade,
                      })
                    }
                    activeOpacity={0.87}
                  >
                    <View style={[styles.continueDot, { backgroundColor: colors.accentYellow }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.continueLabel}>Up next</Text>
                      <Text style={[styles.continueTopic, { color: colors.textMain }]} numberOfLines={1}>
                        {nextTopic.topic}
                      </Text>
                    </View>
                    <Feather name="arrow-right" size={17} color={colors.accentYellow} />
                  </TouchableOpacity>
                );
              })()}

              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Subjects</Text>
                <Text style={styles.sectionSub}>Choose what to study next</Text>
              </View>

              <View style={styles.subjectGrid}>
                {subjects.map((subject) => (
                  <SubjectCard
                    key={subject.subject}
                    data={subject}
                    completedSet={completedSet}
                    width={cardWidth}
                    isBlocked={blockedSubjects.has(subject.subject)}
                    onPress={() =>
                      navigation.navigate('SubjectTopics', {
                        subject: subject.subject,
                        curriculum: isCBSE ? 'CBSE' : curriculum,
                        grade,
                      })
                    }
                  />
                ))}
              </View>

              {subjects.length === 0 ? (
                <View style={styles.emptyState}>
                  <Feather name="inbox" size={18} color={colors.textDim} />
                  <Text style={styles.dimText}>No subjects available for this profile yet.</Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bgDark },
    scroll: { flex: 1 },
    content: { padding: spacing.xl, paddingBottom: 42 },
    center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },

    heroCard: {
      borderWidth: 1,
      borderRadius: 20,
      padding: 16,
      marginBottom: spacing.lg,
    },
    heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
    heroTitleWrap: { flex: 1 },
    heroEyebrow: {
      fontSize: 10,
      color: c.textDim,
      textTransform: 'uppercase',
      letterSpacing: 0.9,
      fontWeight: '700',
      marginBottom: 6,
    },
    heroTitle: { fontSize: 19, fontWeight: '800', color: c.textMain, lineHeight: 24, fontFamily: fonts.serif },
    heroSubtitle: { marginTop: 4, fontSize: 12, color: c.textMuted, lineHeight: 17 },
    heroProgress: {
      width: 72,
      height: 72,
      borderRadius: 36,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.cardDark,
    },
    heroProgressValue: { fontSize: 18, fontWeight: '800' },
    heroProgressLabel: { fontSize: 10, color: c.textDim, fontWeight: '600' },
    heroMetaRow: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    heroMetaChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
      backgroundColor: c.cardDark,
    },
    heroMetaText: { fontSize: 11, color: c.textMuted, fontWeight: '600' },

    searchPanel: {
      borderWidth: 1,
      borderRadius: 16,
      backgroundColor: c.cardHover,
      padding: 10,
      marginBottom: spacing.lg,
    },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    searchInput: { flex: 1, fontSize: 14, fontWeight: '500', outlineStyle: 'none' } as any,
    hintsRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 9 },
    hintsLabel: { fontSize: 11, color: c.textDim, fontWeight: '700', textTransform: 'uppercase' },
    hintChip: {
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    hintChipText: { fontSize: 11, color: c.textMuted, fontWeight: '600' },
    emptySearch: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 4 },

    metricGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
      rowGap: spacing.sm,
    },
    metricCard: {
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 11,
    },
    metricIcon: {
      width: 28,
      height: 28,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 7,
    },
    metricValue: { fontSize: 18, fontWeight: '800', lineHeight: 22, fontFamily: fonts.serif },
    metricLabel: { marginTop: 3, fontSize: 11, color: c.textMuted, fontWeight: '600' },

    continueBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderWidth: 1,
      borderRadius: 14,
      backgroundColor: c.cardDark,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: spacing.xl,
    },
    continueDot: { width: 10, height: 10, borderRadius: 999 },
    continueLabel: {
      fontSize: 10,
      color: c.textDim,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 2,
    },
    continueTopic: { fontSize: 14, fontWeight: '700' },

    sectionHead: { marginBottom: spacing.md },
    sectionTitle: { fontSize: 17, color: c.textMain, fontWeight: '800', fontFamily: fonts.serif },
    sectionSub: { marginTop: 2, fontSize: 12, color: c.textMuted },
    subjectGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: spacing.sm },

    emptyState: {
      borderWidth: 1,
      borderColor: c.borderColor,
      borderRadius: 12,
      backgroundColor: c.cardDark,
      paddingVertical: 14,
      alignItems: 'center',
      gap: 7,
      marginBottom: spacing.lg,
    },
    dimText: { fontSize: 13, color: c.textMuted },
  });
