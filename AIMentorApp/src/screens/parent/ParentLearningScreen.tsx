import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

// ── Subject meta — light pastels ─────────────────────────────────────────────
type SubjectMeta = {
  icon: string;
  accentDark: string; accentLight: string;
  bgFromDark: string; bgToDark: string;
  bgFromLight: string; bgToLight: string;
};

const SUBJECT_META: Record<string, SubjectMeta> = {
  Mathematics:          { icon: 'trending-up',
    accentDark: '#4A9E9A', bgFromDark: '#B8DDD8', bgToDark: '#C8EAE6',
    accentLight: '#4A9E9A', bgFromLight: '#B8DDD8', bgToLight: '#C8EAE6' },
  Science:              { icon: 'zap',
    accentDark: '#4A9E70', bgFromDark: '#B0D8C0', bgToDark: '#C4E8D4',
    accentLight: '#4A9E70', bgFromLight: '#B0D8C0', bgToLight: '#C4E8D4' },
  'Social Studies':     { icon: 'globe',
    accentDark: '#A89840', bgFromDark: '#E0D898', bgToDark: '#EEE8B4',
    accentLight: '#A89840', bgFromLight: '#E0D898', bgToLight: '#EEE8B4' },
  English:              { icon: 'book-open',
    accentDark: '#C85870', bgFromDark: '#F0C8D0', bgToDark: '#F8D8E0',
    accentLight: '#C85870', bgFromLight: '#F0C8D0', bgToLight: '#F8D8E0' },
  Arts:                 { icon: 'feather',
    accentDark: '#C87848', bgFromDark: '#F0C8A8', bgToDark: '#F8D8BC',
    accentLight: '#C87848', bgFromLight: '#F0C8A8', bgToLight: '#F8D8BC' },
  'Physical Education': { icon: 'activity',
    accentDark: '#C84868', bgFromDark: '#F0B8C8', bgToDark: '#F8CCD8',
    accentLight: '#C84868', bgFromLight: '#F0B8C8', bgToLight: '#F8CCD8' },
  ICT:                  { icon: 'monitor',
    accentDark: '#3A9896', bgFromDark: '#A8D8D8', bgToDark: '#BCE8E8',
    accentLight: '#3A9896', bgFromLight: '#A8D8D8', bgToLight: '#BCE8E8' },
};

function subjectMeta(subject: string): SubjectMeta {
  return SUBJECT_META[subject] ?? {
    icon: 'book',
    accentDark: '#4A9E9A', bgFromDark: '#B8DDD8', bgToDark: '#C8EAE6',
    accentLight: '#4A9E9A', bgFromLight: '#B8DDD8', bgToLight: '#C8EAE6',
  };
}

// ── Analytics types ───────────────────────────────────────────────────────────
type TopicAnalytics = {
  subject: string;
  grade: string;
  aiChats: number;
  avgScore: number | null;
  quizCount: number;
  minutesSpent: number;
  lastActivity: string;
  hasActivity: boolean;
};
type ChildReport = {
  childEmail: string;
  totalMinutes: number;
  totalAIChats: number;
  avgScore: number | null;
  topicCount: number;
  topics: Record<string, TopicAnalytics>;
};

// ── Stats Banner ──────────────────────────────────────────────────────────────
function StatsBanner({ report, colors, isDark }: { report: ChildReport | null; colors: AppColors; isDark: boolean }) {
  const bg = isDark ? colors.cardDark : '#FFFFFF';
  const items = [
    { icon: 'clock', label: 'Study Time', value: report ? `${report.totalMinutes}m` : '–' },
    { icon: 'message-circle', label: 'AI Chats', value: report ? String(report.totalAIChats) : '–' },
    { icon: 'star', label: 'Avg Score', value: report?.avgScore != null ? `${report.avgScore}%` : '–' },
    { icon: 'book', label: 'Topics Active', value: report ? String(report.topicCount) : '–' },
  ];
  return (
    <View style={[bannerStyles.card, { backgroundColor: bg, borderColor: colors.borderColor }]}>
      {items.map((item, i) => (
        <View key={item.label} style={[bannerStyles.item, i > 0 && { borderLeftWidth: 1, borderLeftColor: colors.borderColor }]}>
          <View style={[bannerStyles.iconBox, { backgroundColor: colors.primary + '18' }]}>
            <Feather name={item.icon as any} size={14} color={colors.primary} />
          </View>
          <Text style={[bannerStyles.value, { color: colors.textMain }]}>{item.value}</Text>
          <Text style={[bannerStyles.label, { color: colors.textMuted }]}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  item:    { flex: 1, alignItems: 'center', paddingVertical: 14, gap: 4 },
  iconBox: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  value:   { fontSize: 15, fontWeight: '800' },
  label:   { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
});

// ── Topic Row — shown inside expanded subject card ────────────────────────────
function TopicRow({
  topic,
  analytics,
  isDone,
  accent,
  colors,
  isLast,
}: {
  topic: any;
  analytics: TopicAnalytics | undefined;
  isDone: boolean;
  accent: string;
  colors: AppColors;
  isLast: boolean;
}) {
  const score = analytics?.avgScore;
  const chats = analytics?.aiChats ?? 0;
  const mins  = analytics?.minutesSpent ?? 0;

  const statusColor = isDone ? '#4A9E70' : analytics?.hasActivity ? '#C87848' : colors.textDim;
  const statusIcon  = isDone ? 'check-circle' : analytics?.hasActivity ? 'clock' : 'circle';
  const statusLabel = isDone ? 'Done' : analytics?.hasActivity ? 'In Progress' : 'Not started';

  return (
    <View style={[topicRowStyles.row, !isLast && { borderBottomWidth: 1, borderBottomColor: accent + '30' }]}>
      <Feather name={statusIcon as any} size={14} color={statusColor} style={{ marginTop: 1 }} />
      <View style={topicRowStyles.info}>
        <Text style={[topicRowStyles.name, { color: '#1C2A28' }]} numberOfLines={2}>
          {topic.topic || topic}
        </Text>
        <View style={topicRowStyles.metaRow}>
          <Text style={[topicRowStyles.status, { color: statusColor }]}>{statusLabel}</Text>
          {chats > 0 && (
            <View style={topicRowStyles.chip}>
              <Feather name="message-circle" size={10} color={accent} />
              <Text style={[topicRowStyles.chipText, { color: accent }]}>{chats} chats</Text>
            </View>
          )}
          {mins > 0 && (
            <View style={topicRowStyles.chip}>
              <Feather name="clock" size={10} color={accent} />
              <Text style={[topicRowStyles.chipText, { color: accent }]}>{mins}m</Text>
            </View>
          )}
        </View>
      </View>
      {score != null && (
        <View style={[topicRowStyles.scoreBadge, { backgroundColor: score >= 70 ? '#4A9E7022' : '#C8487022', borderColor: score >= 70 ? '#4A9E7066' : '#C8487066' }]}>
          <Text style={[topicRowStyles.scoreText, { color: score >= 70 ? '#4A9E70' : '#C84870' }]}>{score}%</Text>
        </View>
      )}
    </View>
  );
}

const topicRowStyles = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, paddingHorizontal: 14 },
  info:      { flex: 1, gap: 4 },
  name:      { fontSize: 13, fontWeight: '600' },
  metaRow:   { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  status:    { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  chip:      { flexDirection: 'row', alignItems: 'center', gap: 3 },
  chipText:  { fontSize: 10, fontWeight: '600' },
  scoreBadge:{ borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  scoreText: { fontSize: 11, fontWeight: '800' },
});

// ── Subject Card — expandable ─────────────────────────────────────────────────
function SubjectCard({
  sub,
  completedSet,
  analyticsReport,
  isExpanded,
  onToggle,
}: {
  sub: any;
  completedSet: Set<string>;
  analyticsReport: ChildReport | null;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const meta    = subjectMeta(sub.subject);
  const accent  = meta.accentDark;
  const topics: any[] = sub.topics ?? [];
  const done    = topics.filter((t: any) =>
    completedSet.has(t.topic) || [...completedSet].some(c => c.includes(t.topic))
  ).length;
  const pct     = sub.topicCount > 0 ? Math.round((done / sub.topicCount) * 100) : 0;

  return (
    <View style={cardStyles.wrapper}>
      <LinearGradient
        colors={[meta.bgFromDark, meta.bgToDark]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={cardStyles.gradient}
      >
        {/* Header row — always visible */}
        <TouchableOpacity onPress={onToggle} activeOpacity={0.85} style={cardStyles.header}>
          <View style={[cardStyles.iconWrap, { backgroundColor: '#ffffff50' }]}>
            <Feather name={meta.icon as any} size={18} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={cardStyles.subjectName}>{sub.subject}</Text>
            <Text style={cardStyles.subjectMeta}>{sub.topicCount} topics · {done} completed</Text>
          </View>
          <View style={cardStyles.rightCol}>
            <View style={[cardStyles.pctPill, { borderColor: accent + '88', backgroundColor: '#ffffff50' }]}>
              <Text style={[cardStyles.pctText, { color: accent }]}>{pct}%</Text>
            </View>
            <Feather name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={accent} style={{ marginTop: 4 }} />
          </View>
        </TouchableOpacity>

        {/* Progress bar */}
        <View style={[cardStyles.track, { backgroundColor: accent + '40' }]}>
          <View style={[cardStyles.fill, { width: `${pct}%`, backgroundColor: accent }]} />
        </View>

        {/* Expanded topic list */}
        {isExpanded && topics.length > 0 && (
          <View style={[cardStyles.topicList, { backgroundColor: '#ffffffcc' }]}>
            {topics.map((t: any, i: number) => {
              const topicName = typeof t === 'string' ? t : t.topic;
              const isDone    = completedSet.has(topicName) || [...completedSet].some(c => c.includes(topicName));
              const ta        = analyticsReport?.topics[topicName];
              return (
                <TopicRow
                  key={topicName || i}
                  topic={t}
                  analytics={ta}
                  isDone={isDone}
                  accent={accent}
                  colors={{ textDim: '#8A9A98' } as any}
                  isLast={i === topics.length - 1}
                />
              );
            })}
          </View>
        )}

        {isExpanded && topics.length === 0 && (
          <View style={[cardStyles.topicList, { backgroundColor: '#ffffffcc', paddingVertical: 16, alignItems: 'center' }]}>
            <Text style={{ color: '#6A8A86', fontSize: 12 }}>Topic details loading…</Text>
          </View>
        )}
      </LinearGradient>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  wrapper:     { marginBottom: spacing.md, borderRadius: 16, overflow: 'hidden' },
  gradient:    { borderRadius: 16 },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  iconWrap:    { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  subjectName: { fontSize: 16, fontWeight: '800', color: '#1C2A28' },
  subjectMeta: { fontSize: 11, fontWeight: '600', color: '#3A5A56', marginTop: 2 },
  rightCol:    { alignItems: 'center', gap: 2 },
  pctPill:     { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  pctText:     { fontSize: 11, fontWeight: '800' },
  track:       { marginHorizontal: 14, marginBottom: 14, height: 5, borderRadius: 999, overflow: 'hidden' },
  fill:        { height: '100%', borderRadius: 999 },
  topicList:   { marginHorizontal: 8, marginBottom: 8, borderRadius: 12, overflow: 'hidden' },
});

// ── NCERT unit color map ──────────────────────────────────────────────────────
const UNIT_COLORS: Record<string, string> = {
  Numbers: '#6366f1', Geometry: '#8b5cf6',
  'Addition & Subtraction': '#06b6d4', Measurement: '#f59e0b',
  'Weight & Mass': '#10b981', Time: '#3b82f6',
  'Multiplication & Division': '#ef4444', Patterns: '#f59e0b',
  Capacity: '#0ea5e9', 'Division & Fractions': '#a855f7',
  'Data Handling': '#14b8a6', Money: '#eab308',
};

// ── Screen ────────────────────────────────────────────────────────────────────
export default function ParentLearningScreen({ navigation }: any) {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const parentEmail = user?.email || 'parent@demo.com';

  const [children, setChildren]               = useState<any[]>([]);
  const [selectedIdx, setSelectedIdx]         = useState(0);
  const [subjects, setSubjects]               = useState<any[]>([]);
  const [chapters, setChapters]               = useState<any[]>([]);
  const [completedTopics, setCompletedTopics] = useState<string[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [refreshing, setRefreshing]           = useState(false);
  const [analyticsReport, setAnalyticsReport] = useState<ChildReport | null>(null);
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);

  useEffect(() => {
    if (user?.children && Array.isArray(user.children) && user.children.length > 0) {
      setChildren(
        user.children.map((c: any, i: number) => ({
          id:         c.id         || `demo-child-${i}`,
          name:       c.name       || 'Student',
          email:      c.email      || '',
          grade:      c.grade      || 'Grade 3',
          curriculum: c.curriculum || 'IB PYP',
          school:     c.school     || '',
        }))
      );
    }
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data) && data.length > 0) setChildren(data); })
      .catch(() => {});
  }, [parentEmail, user?.children]);

  const child           = children[selectedIdx];
  const childCurriculum = child?.curriculum ?? '';
  const childGrade      = child?.grade ?? 'Grade 3';
  const isIBPYP         = childCurriculum === 'IB_PYP' || childCurriculum === 'IB PYP';
  const completedSet    = useMemo(() => new Set(completedTopics), [completedTopics]);

  const fetchData = useCallback(async () => {
    if (!child) { setLoading(false); return; }
    setLoading(true);
    try {
      // Student stats
      const statsRes = await fetch(`${SERVER_URL}/student/${child.id}`)
        .then(r => r.json()).catch(() => ({}));
      if (statsRes && !statsRes.error) setCompletedTopics(statsRes.completedTopics ?? []);

      // Analytics report for this child
      if (child.email) {
        fetch(`${SERVER_URL}/analytics/child-report?childEmail=${encodeURIComponent(child.email)}`)
          .then(r => r.json())
          .then(data => { if (data && !data.error) setAnalyticsReport(data); })
          .catch(() => {});
      }

      if (isIBPYP) {
        const currRes = await fetch(
          `${SERVER_URL}/curriculum/subjects?grade=${encodeURIComponent(childGrade)}&curriculum=${encodeURIComponent(childCurriculum)}`
        ).then(r => r.json()).catch(() => ({ subjects: [] }));
        setSubjects(currRes.subjects ?? []);
        setChapters([]);
      } else {
        const chapRes = await fetch(`${SERVER_URL}/ncert/chapters`)
          .then(r => r.json()).catch(() => []);
        setChapters(Array.isArray(chapRes) ? chapRes : chapRes?.chapters ?? []);
        setSubjects([]);
      }
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [child, isIBPYP, childGrade, childCurriculum]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Reset analytics + expanded card when child switches
  useEffect(() => {
    setAnalyticsReport(null);
    setExpandedSubject(null);
  }, [selectedIdx]);

  const { totalItems, doneItems, overallPct, curriculumLabel } = useMemo(() => {
    if (isIBPYP) {
      const total = subjects.reduce((s, sub) => s + (sub.topicCount ?? 0), 0);
      const done  = completedTopics.length;
      return { totalItems: total, doneItems: done,
        overallPct: total > 0 ? Math.round((done / total) * 100) : 0,
        curriculumLabel: `IB PYP · ${subjects.length} Subjects` };
    }
    const total = chapters.length || 14;
    const done  = completedTopics.length;
    return { totalItems: total, doneItems: done,
      overallPct: Math.round((done / total) * 100),
      curriculumLabel: `${childCurriculum || 'NCERT'} · Maths Mela` };
  }, [isIBPYP, subjects, chapters, completedTopics, childCurriculum]);

  function isChapterDone(ch: any) {
    const id = ch.id || ch.file || '';
    return completedSet.has(id) || [...completedSet].some(t => t.includes(id) || id.includes(t));
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Learning Paths"
          subtitle="Track subjects and progress"
          searchPlaceholder="Search curriculum..."
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.primary} />}
        >
          {/* Child Selector */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.childRow}>
            {children.map((c, i) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.childTab, selectedIdx === i && styles.childTabActive]}
                onPress={() => setSelectedIdx(i)}
                activeOpacity={0.8}
              >
                <Text style={[styles.childTabName, { color: selectedIdx === i ? colors.primary : colors.textMuted }]}>{c.name}</Text>
                <Text style={styles.childTabGrade}>{c.grade}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Analytics Stats Banner */}
          <StatsBanner report={analyticsReport} colors={colors} isDark={isDark} />

          {/* Curriculum summary card */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryHeader}>
              <View style={[styles.summaryIcon, { backgroundColor: colors.primary + '20' }]}>
                <Feather name="book-open" size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryTitle}>{curriculumLabel}</Text>
                <Text style={styles.summaryGrade}>{childGrade}</Text>
              </View>
              <View style={[styles.pctBadge, { backgroundColor: overallPct >= 50 ? colors.accentGreen + '20' : colors.primary + '20' }]}>
                <Text style={[styles.pctText, { color: overallPct >= 50 ? colors.accentGreen : colors.primary }]}>{overallPct}%</Text>
              </View>
            </View>
            <Text style={styles.progressLabel}>{doneItems} of {totalItems} {isIBPYP ? 'topics' : 'chapters'} done</Text>
            <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
              <View style={[styles.progressFill, { width: `${overallPct}%`, backgroundColor: colors.primary }]} />
            </View>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
          ) : isIBPYP ? (
            <>
              <Text style={styles.sectionTitle}>Subjects Overview</Text>
              <Text style={styles.sectionHint}>Tap a subject to see topic-by-topic progress</Text>
              {subjects.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Feather name="inbox" size={28} color={colors.textMuted} />
                  <Text style={styles.emptyText}>No IB PYP content found for {childGrade}.{'\n'}Content will appear once ingested.</Text>
                </View>
              ) : (
                subjects.map((sub) => (
                  <SubjectCard
                    key={sub.subject}
                    sub={sub}
                    completedSet={completedSet}
                    analyticsReport={analyticsReport}
                    isExpanded={expandedSubject === sub.subject}
                    onToggle={() => setExpandedSubject(prev => prev === sub.subject ? null : sub.subject)}
                  />
                ))
              )}
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Chapter Overview</Text>
              <View style={styles.chaptersCard}>
                {(chapters.length > 0
                  ? chapters
                  : Array.from({ length: 14 }, (_, i) => ({ id: `ch${i + 1}`, topic: `Chapter ${i + 1}`, unit: 'Maths' }))
                ).map((ch, i) => {
                  const done  = isChapterDone(ch);
                  const color = UNIT_COLORS[ch.unit] ?? colors.primary;
                  return (
                    <View key={ch.id ?? i} style={[styles.chapterRow, i > 0 && styles.chapterBorder]}>
                      <View style={[styles.chapterNum, { backgroundColor: done ? colors.accentGreen + '20' : color + '15' }]}>
                        {done
                          ? <Feather name="check" size={13} color={colors.accentGreen} />
                          : <Text style={[styles.chapterNumText, { color }]}>{i + 1}</Text>}
                      </View>
                      <View style={styles.chapterInfo}>
                        <Text style={[styles.chapterTitle, done && { opacity: 0.6 }]} numberOfLines={2}>
                          {ch.topic || ch.title || `Chapter ${i + 1}`}
                        </Text>
                        {ch.unit ? (
                          <View style={[styles.unitTag, { backgroundColor: color + '15' }]}>
                            <Text style={[styles.unitText, { color }]}>{ch.unit}</Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={[styles.statusDot, { backgroundColor: done ? colors.accentGreen : colors.borderColor }]} />
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:  { flex: 1, backgroundColor: c.bgDark },
  scroll:  { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.lg },

  childRow: { flexDirection: 'row' },
  childTab: {
    alignItems: 'center', marginRight: spacing.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.lg, borderWidth: 1, borderColor: 'transparent',
  },
  childTabActive: { borderColor: c.primary, backgroundColor: c.primaryGlow },
  childTabName:   { fontSize: 14, fontWeight: '700' },
  childTabGrade:  { fontSize: 10, color: c.textDim, marginTop: 2 },

  summaryCard: {
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md,
  },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  summaryIcon:   { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  summaryTitle:  { fontSize: 16, fontWeight: '700', color: c.textMain },
  summaryGrade:  { fontSize: 12, color: c.textMuted, marginTop: 2 },
  pctBadge:      { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  pctText:       { fontSize: 16, fontWeight: '800' },
  progressLabel: { fontSize: 12, color: c.textDim },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 4 },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.textMain },
  sectionHint:  { fontSize: 12, color: c.textMuted, marginTop: -spacing.sm },

  chaptersCard: {
    backgroundColor: c.cardDark, borderWidth: 1,
    borderColor: c.borderColor, borderRadius: radius.xl, overflow: 'hidden',
  },
  chapterRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  chapterBorder:  { borderTopWidth: 1, borderTopColor: c.borderColor },
  chapterNum:     { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chapterNumText: { fontSize: 13, fontWeight: '700' },
  chapterInfo:    { flex: 1, gap: 4 },
  chapterTitle:   { fontSize: 13, fontWeight: '600', color: c.textMain },
  unitTag:        { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  unitText:       { fontSize: 10, fontWeight: '600' },
  statusDot:      { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },

  emptyCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xxl, alignItems: 'center', gap: spacing.md,
  },
  emptyText: { fontSize: 13, color: c.textMuted, textAlign: 'center', lineHeight: 20 },
});
