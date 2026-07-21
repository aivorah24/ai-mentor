/**
 * ContentReviewDashboardScreen.tsx
 * Step 6 of the content-review pipeline — a read-only report of how the
 * AI-generated learning content scores against the real textbook chapters
 * it's supposed to teach. Scoped to CBSE Grade 6 English for now; the
 * screen and its backing route (/content-review/:curriculum/:grade/:subject)
 * are both written so a future curriculum just needs its own review run +
 * metadata file, not a new screen.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface ChapterScore {
  chapter: string;
  unit: string;
  coverage: number;
  storyFlow: number;
  learningObjectives: number;
  vocabulary: number;
  activities: number;
  illustrations: number;
  readability: number;
  hallucination: number;
  engagement: number;
  overall: number;
  missing: string[];
  published: boolean;
  version: string;
  reviewedAt: string;
}

interface Summary {
  totalChapters: number;
  averageScore: number;
  lowestScore: number;
  highestScore: number;
  needsReviewCount: number;
  publishedCount: number;
  coveragePercent: number;
}

const CURRICULUM = 'CBSE';
const GRADE = 'Grade 6';
const SUBJECT = 'English';

function scoreColor(score: number, colors: AppColors) {
  if (score >= 95) return colors.accentGreen;
  if (score >= 80) return colors.accentYellow;
  return colors.accentRed;
}

export default function ContentReviewDashboardScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [chapters, setChapters] = useState<ChapterScore[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`${SERVER_URL}/content-review/${encodeURIComponent(CURRICULUM)}/${encodeURIComponent(GRADE)}/${encodeURIComponent(SUBJECT)}`)
      .then((r) => r.json())
      .then((data) => {
        setChapters(data.chapters || []);
        setSummary(data.summary || null);
      })
      .catch(() => setError('Could not load content review data. Is the server running?'))
      .finally(() => setLoading(false));
  }, []);

  function toggle(chapter: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(chapter) ? next.delete(chapter) : next.add(chapter);
      return next;
    });
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Content Review"
          subtitle={`${CURRICULUM} · ${GRADE} · ${SUBJECT} — AI content QA report`}
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={colors.accentYellow} />
            </View>
          ) : error ? (
            <View style={styles.centerBox}>
              <Feather name="wifi-off" size={32} color={colors.textMuted} />
              <Text style={[styles.dimText, { marginTop: 12 }]}>{error}</Text>
            </View>
          ) : chapters.length === 0 ? (
            <View style={styles.centerBox}>
              <Feather name="inbox" size={32} color={colors.textMuted} />
              <Text style={[styles.dimText, { marginTop: 12 }]}>
                No review data yet. Run `node scripts/review-content.js` on the server to generate it.
              </Text>
            </View>
          ) : (
            <>
              {/* ── Summary cards ── */}
              {summary && (
                <View style={styles.summaryGrid}>
                  <SummaryCard label="Chapters" value={String(summary.totalChapters)} icon="book" colors={colors} />
                  <SummaryCard label="Average Score" value={`${summary.averageScore}%`} icon="bar-chart-2" colors={colors} accent={scoreColor(summary.averageScore, colors)} />
                  <SummaryCard label="Lowest Score" value={`${summary.lowestScore}%`} icon="arrow-down" colors={colors} accent={scoreColor(summary.lowestScore, colors)} />
                  <SummaryCard label="Highest Score" value={`${summary.highestScore}%`} icon="arrow-up" colors={colors} accent={scoreColor(summary.highestScore, colors)} />
                  <SummaryCard label="Needs Review" value={String(summary.needsReviewCount)} icon="alert-triangle" colors={colors} accent={summary.needsReviewCount > 0 ? colors.accentRed : colors.accentGreen} />
                  <SummaryCard label="Published" value={String(summary.publishedCount)} icon="check-circle" colors={colors} accent={colors.accentGreen} />
                  <SummaryCard label="Avg Coverage" value={`${summary.coveragePercent}%`} icon="target" colors={colors} />
                </View>
              )}

              {/* ── Chapter table ── */}
              <Text style={styles.sectionTitle}>Chapters</Text>
              {chapters.map((ch) => {
                const isOpen = expanded.has(ch.chapter);
                return (
                  <View key={ch.chapter} style={[styles.chapterRow, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
                    <TouchableOpacity style={styles.chapterHead} activeOpacity={0.7} onPress={() => toggle(ch.chapter)}>
                      <Feather name={isOpen ? 'chevron-down' : 'chevron-right'} size={16} color={colors.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.chapterName, { color: colors.textMain }]}>{ch.chapter}</Text>
                        <Text style={[styles.chapterUnit, { color: colors.textMuted }]}>{ch.unit} · v{ch.version}</Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: (ch.published ? colors.accentGreen : colors.accentRed) + '18', borderColor: (ch.published ? colors.accentGreen : colors.accentRed) + '50' }]}>
                        <Text style={[styles.statusBadgeText, { color: ch.published ? colors.accentGreen : colors.accentRed }]}>
                          {ch.published ? 'Published' : 'Needs Review'}
                        </Text>
                      </View>
                      <View style={[styles.overallPill, { backgroundColor: scoreColor(ch.overall, colors) + '18', borderColor: scoreColor(ch.overall, colors) + '50' }]}>
                        <Text style={[styles.overallPillText, { color: scoreColor(ch.overall, colors) }]}>{ch.overall}%</Text>
                      </View>
                    </TouchableOpacity>

                    {isOpen && (
                      <View style={styles.detailPane}>
                        <View style={styles.metricsGrid}>
                          {([
                            ['Coverage', ch.coverage], ['Story Flow', ch.storyFlow], ['Learning Obj.', ch.learningObjectives],
                            ['Vocabulary', ch.vocabulary], ['Activities', ch.activities], ['Illustrations', ch.illustrations],
                            ['Readability', ch.readability], ['Engagement', ch.engagement], ['Hallucination', ch.hallucination],
                          ] as [string, number][]).map(([label, value]) => (
                            <View key={label} style={styles.metricChip}>
                              <Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text>
                              <Text style={[styles.metricValue, { color: scoreColor(label === 'Hallucination' ? 100 - value : value, colors) }]}>{value}%</Text>
                            </View>
                          ))}
                        </View>
                        {ch.missing.length > 0 && (
                          <View style={styles.missingBox}>
                            <Text style={[styles.missingTitle, { color: colors.textMain }]}>Flagged gaps</Text>
                            {ch.missing.map((m, i) => (
                              <Text key={i} style={[styles.missingItem, { color: colors.textMuted }]}>• {m}</Text>
                            ))}
                          </View>
                        )}
                        <Text style={[styles.reviewedAt, { color: colors.textDim }]}>
                          Last reviewed: {new Date(ch.reviewedAt).toLocaleString()}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

function SummaryCard({ label, value, icon, colors, accent }: { label: string; value: string; icon: any; colors: AppColors; accent?: string }) {
  const c = accent || colors.textMain;
  return (
    <View style={[cardStyles.card, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
      <View style={[cardStyles.iconBox, { backgroundColor: c + '18' }]}>
        <Feather name={icon} size={16} color={c} />
      </View>
      <Text style={[cardStyles.value, { color: c }]}>{value}</Text>
      <Text style={[cardStyles.label, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: { width: 150, borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 6 },
  iconBox: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  value: { fontSize: 20, fontWeight: '800', fontFamily: fonts.serif },
  label: { fontSize: 11.5, fontWeight: '600' },
});

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.lg },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  dimText: { fontSize: 13, textAlign: 'center', maxWidth: 360 },

  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },

  sectionTitle: { fontFamily: fonts.serif, fontSize: 18, fontWeight: '700', color: c.textMain, marginTop: spacing.sm },

  chapterRow: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  chapterHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  chapterName: { fontSize: 14, fontWeight: '700' },
  chapterUnit: { fontSize: 11.5, marginTop: 1 },
  statusBadge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  statusBadgeText: { fontSize: 10.5, fontWeight: '700' },
  overallPill: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, minWidth: 56, alignItems: 'center' },
  overallPillText: { fontSize: 13, fontWeight: '800' },

  detailPane: { paddingHorizontal: 14, paddingBottom: 14, gap: 12 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricChip: { minWidth: 100, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, padding: 8, gap: 2 },
  metricLabel: { fontSize: 10.5, fontWeight: '600' },
  metricValue: { fontSize: 14, fontWeight: '800' },

  missingBox: { borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, padding: 12, gap: 4 },
  missingTitle: { fontSize: 12.5, fontWeight: '700', marginBottom: 4 },
  missingItem: { fontSize: 12, lineHeight: 18 },

  reviewedAt: { fontSize: 10.5 },
});
