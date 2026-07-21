import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
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
import { getSubjectSyllabus } from '../../data/syllabusRegistry';

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
  // CBSE/NCERT names this subject "Social Science" (IB PYP calls it "Social
  // Studies") — same pastel treatment, just under the name CBSE actually sends.
  'Social Science':     { icon: 'globe',
    accentDark: '#BAA467', bgFromDark: '#E0D898', bgToDark: '#EEE8B4',
    accentLight: '#BAA467', bgFromLight: '#E0D898', bgToLight: '#EEE8B4' },
  Hindi:                { icon: 'book-open',
    accentDark: '#C98A8A', bgFromDark: '#EAD0D0', bgToDark: '#F2DEDE',
    accentLight: '#C98A8A', bgFromLight: '#EAD0D0', bgToLight: '#F2DEDE' },
  'Computer Science':   { icon: 'monitor',
    accentDark: '#7E9A86', bgFromDark: '#CFE0D3', bgToDark: '#DEEBE1',
    accentLight: '#7E9A86', bgFromLight: '#CFE0D3', bgToLight: '#DEEBE1' },
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
  // Same soft pastel treatment as every mapped subject — an unmapped name
  // (e.g. a new CBSE subject) should never fall back to a jarring dark card.
  return SUBJECT_META[subject] ?? {
    icon: 'book',
    accentDark: '#BAA467',  bgFromDark: '#D8CFA8',  bgToDark: '#E6DEBC',
    accentLight: '#BAA467', bgFromLight: '#D8CFA8', bgToLight: '#E6DEBC',
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

  const cardWidth = (isMobile ? '100%' : '48.7%') as `${number}%`;

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
  // Raw topic counts (e.g. "0/2350 topics completed") read as discouraging for a
  // brand-new student and don't map to how the syllabus is actually organised
  // for them (units/chapters, not a flat topic tally) — client asked to swap
  // this for a subject-progress framing instead. True unit-level completion
  // isn't tracked on the student side yet (syllabus_chapters/unit_no exists
  // server-side for teacher import only) — that would need a new endpoint.
  const subjectsInProgress = subjects.filter((s) => s.topics.some((t) => completedSet.has(t.topic))).length;
  const heroSubtitle = subjects.length > 0
    ? `${subjectsInProgress}/${subjects.length} subjects in progress`
    : '';

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

          <>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Subjects</Text>
                <Text style={styles.sectionSub}>Choose what to study next</Text>
              </View>

              {loading && subjects.length === 0 ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator size="small" color={colors.accentYellow} />
                  <Text style={styles.dimText}>Loading {isCBSE ? 'CBSE' : curriculum} subjects…</Text>
                </View>
              ) : (
              <View style={styles.subjectGrid}>
                {subjects.map((subject) => (
                  <SubjectCard
                    key={subject.subject}
                    data={subject}
                    completedSet={completedSet}
                    width={cardWidth}
                    isBlocked={blockedSubjects.has(subject.subject)}
                    onPress={() => {
                      const resolvedCurriculum = isCBSE ? 'CBSE' : curriculum;
                      // Some subjects have a curated, chapter-accurate syllabus —
                      // route through the textbook-first Syllabus screen instead of
                      // the old flat topic list. Others fall back to the flat list
                      // until they get the same curated treatment (see syllabusRegistry.ts).
                      const hasCuratedSyllabus = getSubjectSyllabus(resolvedCurriculum, grade, subject.subject).length > 0;
                      navigation.navigate(hasCuratedSyllabus ? 'SubjectSyllabus' : 'SubjectTopics', {
                        subject: subject.subject,
                        curriculum: resolvedCurriculum,
                        grade,
                      });
                    }}
                  />
                ))}
              </View>
              )}

              {!loading && subjects.length === 0 ? (
                <View style={styles.emptyState}>
                  <Feather name="inbox" size={18} color={colors.textDim} />
                  <Text style={styles.dimText}>No subjects available for this profile yet.</Text>
                </View>
              ) : null}
            </>
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
