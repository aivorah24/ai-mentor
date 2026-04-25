import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle, G, Rect } from 'react-native-svg';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import SERVER_URL from '../../config/serverUrl';

// ── Aivorah pastel palette ────────────────────────────────
const P = {
  rose:   '#B8797E',
  green:  '#5A8A70',
  gold:   '#8A8358',
  peach:  '#C4836A',
  teal:   '#7AADA8',
  slate:  '#5F8A86',
};

type Student = {
  id: string; name: string; grade: string; curriculum: string;
  xpPoints: number; level: number; currentStreak: number;
  studyTime: number; completedTopics: string[]; progressPct: number;
  assignmentsDone: number; lastActive: string; needsAttention: boolean;
  totalTopics?: number;
};

function initials(name: string) {
  return (name || '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}
function avatarColor(name: string) {
  const C = [P.rose, P.green, P.gold, P.peach, P.teal, P.slate];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % C.length;
  return C[h];
}
function hoursLabel(mins: number) {
  if (mins < 60) return `${mins}m`;
  return `${(mins / 60).toFixed(1)}h`;
}
function lastActiveLabel(dateStr?: string) {
  if (!dateStr) return 'Never';
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

// ── Mini donut ────────────────────────────────────────────
function MiniDonut({ pct, color, size = 72 }: { pct: number; color: string; size?: number }) {
  const sw = 7, r = (size - sw) / 2, circ = 2 * Math.PI * r, cx = size / 2;
  return (
    <Svg width={size} height={size}>
      <Circle cx={cx} cy={cx} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={sw} fill="none" />
      <G transform={`rotate(-90 ${cx} ${cx})`}>
        <Circle cx={cx} cy={cx} r={r} stroke={color} strokeWidth={sw} fill="none"
          strokeLinecap="round" strokeDasharray={`${circ}`}
          strokeDashoffset={circ * (1 - Math.min(pct, 100) / 100)} />
      </G>
    </Svg>
  );
}

// ── Distribution bar chart ────────────────────────────────
function DistributionChart({ students, colors }: { students: Student[]; colors: any }) {
  const buckets = [
    { label: '0–20%',  min: 0,  max: 20,  color: P.rose },
    { label: '20–40%', min: 20, max: 40,  color: P.peach },
    { label: '40–60%', min: 40, max: 60,  color: P.gold },
    { label: '60–80%', min: 60, max: 80,  color: P.teal },
    { label: '80–100%',min: 80, max: 101, color: P.green },
  ].map(b => ({
    ...b,
    count: students.filter(s => s.progressPct >= b.min && s.progressPct < b.max).length,
  }));
  const maxCount = Math.max(...buckets.map(b => b.count), 1);

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 4 }}>
        Progress Distribution
      </Text>
      {buckets.map((b, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontSize: 10, color: colors.textDim, width: 52, fontWeight: '600' }}>{b.label}</Text>
          <View style={{ flex: 1, height: 18, backgroundColor: colors.borderColor, borderRadius: 4, overflow: 'hidden' }}>
            <View style={{
              height: '100%', borderRadius: 4,
              width: `${Math.round((b.count / maxCount) * 100)}%` as any,
              backgroundColor: b.color,
            }} />
          </View>
          <Text style={{ fontSize: 11, color: b.color, fontWeight: '800', width: 24, textAlign: 'right' }}>
            {b.count}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ── Topic coverage heatmap ────────────────────────────────
function TopicCoverage({ students, colors }: { students: Student[]; colors: any }) {
  if (students.length === 0) return null;

  const topicMap: Record<string, number> = {};
  students.forEach(s => (s.completedTopics || []).forEach(t => {
    topicMap[t] = (topicMap[t] || 0) + 1;
  }));

  const topics = Object.entries(topicMap)
    .sort((a, b) => a[1] - b[1]) // ascending — worst first
    .slice(0, 8);

  if (topics.length === 0) return (
    <Text style={{ fontSize: 12, color: colors.textDim, fontStyle: 'italic' }}>
      No topics completed yet across the class.
    </Text>
  );

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 4 }}>
        Topic Completion Rate (lowest first)
      </Text>
      {topics.map(([topic, count], i) => {
        const pct = Math.round((count / students.length) * 100);
        const color = pct < 30 ? P.rose : pct < 60 ? P.gold : P.green;
        return (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 10, color: colors.textDim, width: 100, fontWeight: '500' }} numberOfLines={1}>
              {topic}
            </Text>
            <View style={{ flex: 1, height: 14, backgroundColor: colors.borderColor, borderRadius: 3, overflow: 'hidden' }}>
              <View style={{ height: '100%', borderRadius: 3, width: `${pct}%` as any, backgroundColor: color }} />
            </View>
            <Text style={{ fontSize: 10, color, fontWeight: '700', width: 38, textAlign: 'right' }}>
              {count}/{students.length}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Grade breakdown ───────────────────────────────────────
function GradeBreakdown({ students, colors }: { students: Student[]; colors: any }) {
  const grades: Record<string, Student[]> = {};
  students.forEach(s => {
    const g = s.grade || 'Unknown';
    if (!grades[g]) grades[g] = [];
    grades[g].push(s);
  });

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {Object.entries(grades).sort().map(([grade, list]) => {
        const avg = Math.round(list.reduce((a, s) => a + (s.progressPct || 0), 0) / list.length);
        const atRisk = list.filter(s => s.needsAttention).length;
        const color = avg < 30 ? P.rose : avg < 60 ? P.gold : P.green;
        return (
          <View key={grade} style={{
            flex: 1, minWidth: 120,
            backgroundColor: color + '10', borderWidth: 1, borderColor: color + '30',
            borderRadius: radius.lg, padding: spacing.md, gap: 6, alignItems: 'center',
          }}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: colors.textMuted }}>{grade}</Text>
            <Text style={{ fontSize: 26, fontWeight: '900', color, letterSpacing: -1 }}>{avg}%</Text>
            <Text style={{ fontSize: 10, color: colors.textDim }}>{list.length} students</Text>
            {atRisk > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Feather name="alert-circle" size={10} color={P.rose} />
                <Text style={{ fontSize: 10, color: P.rose, fontWeight: '600' }}>{atRisk} at risk</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── AI Analysis component ────────────────────────────────
function AIAnalysis({ students, colors, styles }: { students: Student[]; colors: any; styles: any }) {
  const [analysis, setAnalysis] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const fetchAnalysis = async () => {
    if (students.length === 0) return;
    setLoading(true);
    try {
      const summary = students.map(s =>
        `${s.name} (${s.grade}): ${s.progressPct}% progress, ${(s.completedTopics || []).length} topics done, ${s.currentStreak || 0}-day streak, ${s.needsAttention ? 'needs attention' : 'on track'}`
      ).join('\n');

      const prompt = `You are an experienced school teacher analyzing student progress data. Here is the class data:\n\n${summary}\n\nProvide a concise analysis (4-5 bullet points) covering: which students are most at risk, which topics seem most challenging, patterns you notice, and 2 specific actionable recommendations for the teacher. Be direct and specific with student names.`;

      const res = await fetch(`${SERVER_URL}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: prompt, studentId: 'teacher-analysis', grade: 'teacher' }),
      });
      const data = await res.json();
      setAnalysis(data.answer || 'Unable to generate analysis.');
    } catch {
      setAnalysis('Could not connect to AI. Please check your server connection.');
    } finally {
      setLoading(false);
      setFetched(true);
    }
  };

  return (
    <View style={[styles.card, { borderColor: P.teal + '40', backgroundColor: P.teal + '08' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.md }}>
        <View style={{ width: 32, height: 32, borderRadius: radius.sm, backgroundColor: P.teal + '25', alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="cpu" size={16} color={P.teal} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.textMain }}>AI Class Analysis</Text>
          <Text style={{ fontSize: 11, color: colors.textDim }}>Powered by Groq</Text>
        </View>
        {!fetched && (
          <TouchableOpacity
            style={{ backgroundColor: P.teal, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.md }}
            onPress={fetchAnalysis}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>Analyse</Text>
          </TouchableOpacity>
        )}
        {fetched && (
          <TouchableOpacity onPress={fetchAnalysis} activeOpacity={0.8}>
            <Feather name="refresh-cw" size={15} color={P.teal} />
          </TouchableOpacity>
        )}
      </View>

      {loading && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 }}>
          <ActivityIndicator size="small" color={P.teal} />
          <Text style={{ fontSize: 12, color: colors.textDim }}>Analysing class data...</Text>
        </View>
      )}

      {!loading && fetched && analysis ? (
        <View style={{ gap: 6 }}>
          {analysis.split('\n').filter(l => l.trim()).map((line, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: P.teal, marginTop: 6, flexShrink: 0 }} />
              <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 19, flex: 1 }}>
                {line.replace(/^[-•*]\s*/, '')}
              </Text>
            </View>
          ))}
        </View>
      ) : !loading && !fetched ? (
        <Text style={{ fontSize: 12, color: colors.textDim, fontStyle: 'italic' }}>
          Tap "Analyse" to get AI-powered insights about your class.
        </Text>
      ) : null}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────
export default function TeacherProgressScreen({ navigation }: any) {
  const { colors: c } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'All' | 'At Risk' | 'On Track'>('All');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/student/by-teacher/${encodeURIComponent(user?.email || 'teacher@demo.com')}`);
      if (res.ok) setStudents(await res.json());
    } catch {/* */} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsub1 = navigation.addListener('focus', load);
    const interval = setInterval(load, 30000);
    return () => { unsub1(); clearInterval(interval); };
  }, [load, navigation]);

  const filtered = students.filter(s => {
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase());
    const matchTab = activeTab === 'All' ? true : activeTab === 'At Risk' ? s.needsAttention : !s.needsAttention;
    return matchSearch && matchTab;
  }).sort((a, b) => (a.progressPct || 0) - (b.progressPct || 0));

  const classAvg = students.length
    ? Math.round(students.reduce((a, s) => a + (s.progressPct || 0), 0) / students.length)
    : 0;
  const totalXP = students.reduce((a, s) => a + (s.xpPoints || 0), 0);
  const atRisk = students.filter(s => s.needsAttention).length;
  const onTrack = students.length - atRisk;
  const activeToday = students.filter(s => s.lastActive?.startsWith(new Date().toISOString().split('T')[0])).length;

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Student Progress"
          subtitle="Track every student's learning journey"
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={P.teal} />}
        >
          {/* ── CLASS OVERVIEW ROW ── */}
          <View style={styles.overviewRow}>
            <View style={[styles.card, { flex: 1, alignItems: 'center', gap: 6 }]}>
              <MiniDonut pct={classAvg} color={P.teal} size={72} />
              <Text style={[styles.bigNum, { color: P.teal }]}>{classAvg}%</Text>
              <Text style={styles.dimLabel}>Class Avg</Text>
            </View>
            <View style={[styles.card, { flex: 2, gap: spacing.md }]}>
              <Text style={styles.cardTitle}>Class Snapshot</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                {[
                  { val: students.length, label: 'Total', color: c.textMain },
                  { val: onTrack,         label: 'On Track', color: P.green },
                  { val: atRisk,          label: 'At Risk',  color: P.rose },
                  { val: activeToday,     label: 'Active Today', color: P.teal },
                  { val: totalXP.toLocaleString(), label: 'Total XP', color: P.gold },
                ].map(item => (
                  <View key={item.label} style={{ minWidth: 60 }}>
                    <Text style={[styles.snapVal, { color: item.color }]}>{item.val}</Text>
                    <Text style={styles.snapLabel}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* ── DISTRIBUTION CHART ── */}
          <View style={styles.card}>
            <DistributionChart students={students} colors={c} />
          </View>

          {/* ── GRADE BREAKDOWN ── */}
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { marginBottom: spacing.md }]}>Grade-wise Performance</Text>
            <GradeBreakdown students={students} colors={c} />
          </View>

          {/* ── TOPIC COVERAGE ── */}
          <View style={styles.card}>
            <TopicCoverage students={students} colors={c} />
          </View>

          {/* ── AI ANALYSIS ── */}
          <AIAnalysis students={students} colors={c} styles={styles} />

          {/* ── STUDENT LIST ── */}
          <View style={{ gap: spacing.sm }}>
            {/* Search + filter tabs */}
            <View style={styles.searchWrap}>
              <Feather name="search" size={15} color={c.textDim} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search students..."
                placeholderTextColor={c.textDim}
                value={search}
                onChangeText={setSearch}
              />
              {search ? <TouchableOpacity onPress={() => setSearch('')}><Feather name="x" size={15} color={c.textDim} /></TouchableOpacity> : null}
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {(['All', 'At Risk', 'On Track'] as const).map(tab => (
                <TouchableOpacity key={tab}
                  style={[styles.filterTab, activeTab === tab && styles.filterTabActive]}
                  onPress={() => setActiveTab(tab)} activeOpacity={0.75}>
                  <Text style={[styles.filterTabText, activeTab === tab && { color: P.teal }]}>{tab}</Text>
                  {tab === 'At Risk' && atRisk > 0 && (
                    <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{atRisk}</Text></View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionTitle}>{filtered.length} Students · sorted by progress</Text>

            {loading ? (
              <ActivityIndicator color={P.teal} style={{ marginTop: 40 }} />
            ) : filtered.map(s => {
              const color = avatarColor(s.name);
              const isExpanded = expanded === s.id;
              const done = s.completedTopics || [];
              const total = s.totalTopics || 14;

              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.studentCard, s.needsAttention && { borderColor: P.rose + '50' }]}
                  activeOpacity={0.9}
                  onPress={() => setExpanded(isExpanded ? null : s.id)}
                >
                  {/* Top row */}
                  <View style={styles.studentTop}>
                    <View style={[styles.avatar, { backgroundColor: color + '22' }]}>
                      <Text style={[styles.avatarText, { color }]}>{initials(s.name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.studentName}>{s.name}</Text>
                        {s.needsAttention && (
                          <View style={styles.riskBadge}>
                            <Text style={styles.riskBadgeText}>At Risk</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.studentMeta}>{s.grade} · {s.curriculum} · Lv.{s.level}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={[styles.progressPct, { color: s.needsAttention ? P.rose : P.green }]}>
                        {s.progressPct}%
                      </Text>
                      <View style={styles.progressBarBg}>
                        <View style={[styles.progressBarFill, {
                          width: `${s.progressPct}%` as any,
                          backgroundColor: s.needsAttention ? P.rose : P.teal,
                        }]} />
                      </View>
                    </View>
                    <Feather name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={c.textDim} />
                  </View>

                  {/* Quick stats */}
                  <View style={styles.quickStats}>
                    {[
                      { icon: 'zap' as const,       val: `${s.xpPoints} XP`,         color: P.gold },
                      { icon: 'book-open' as const,  val: `${done.length}/${total} topics`, color: P.teal },
                      { icon: 'activity' as const,   val: `${s.currentStreak || 0}d streak`, color: P.green },
                      { icon: 'clock' as const,      val: hoursLabel(s.studyTime),     color: c.textDim },
                      { icon: 'calendar' as const,   val: lastActiveLabel(s.lastActive), color: c.textDim },
                    ].map(item => (
                      <View key={item.icon} style={styles.quickStat}>
                        <Feather name={item.icon} size={11} color={item.color} />
                        <Text style={[styles.quickStatText, { color: item.color }]}>{item.val}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <View style={styles.expandedSection}>
                      <View style={styles.expandDivider} />

                      {/* Metric cards */}
                      <View style={styles.metricsGrid}>
                        {[
                          { label: 'Streak',      val: `${s.currentStreak || 0}d`, color: P.peach },
                          { label: 'Level',       val: `Lv.${s.level}`,            color: P.gold },
                          { label: 'Assignments', val: String(s.assignmentsDone),  color: P.green },
                          { label: 'Study Time',  val: hoursLabel(s.studyTime),    color: P.teal },
                        ].map(m => (
                          <View key={m.label} style={[styles.metricCard, { borderColor: m.color + '30', backgroundColor: m.color + '0C' }]}>
                            <Text style={[styles.metricValue, { color: m.color }]}>{m.val}</Text>
                            <Text style={styles.metricLabel}>{m.label}</Text>
                          </View>
                        ))}
                      </View>

                      {/* Topic completion visual */}
                      <Text style={styles.topicsTitle}>
                        Topics Completed — {done.length}/{total}
                      </Text>
                      {done.length === 0 ? (
                        <View style={[styles.attentionWarn, { borderColor: P.rose + '30', backgroundColor: P.rose + '10' }]}>
                          <Feather name="alert-circle" size={14} color={P.rose} />
                          <Text style={[styles.attentionText, { color: P.rose }]}>
                            No topics completed yet — student hasn't started the curriculum.
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.topicsWrap}>
                          {done.map(t => (
                            <View key={t} style={styles.topicChip}>
                              <Feather name="check" size={10} color={P.green} />
                              <Text style={styles.topicText}>{t}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Progress bar with milestones */}
                      <View style={{ gap: 6 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 11, color: c.textDim }}>Curriculum Progress</Text>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: s.needsAttention ? P.rose : P.teal }}>
                            {s.progressPct}%
                          </Text>
                        </View>
                        <View style={{ height: 10, backgroundColor: c.borderColor, borderRadius: 5, overflow: 'hidden' }}>
                          <View style={{
                            height: '100%', borderRadius: 5,
                            width: `${s.progressPct}%` as any,
                            backgroundColor: s.needsAttention ? P.rose : P.teal,
                          }} />
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          {[25, 50, 75, 100].map(milestone => (
                            <Text key={milestone} style={{ fontSize: 9, color: s.progressPct >= milestone ? P.teal : c.textDim, fontWeight: '600' }}>
                              {milestone}%{s.progressPct >= milestone ? ' ✓' : ''}
                            </Text>
                          ))}
                        </View>
                      </View>

                      {/* Attention flag */}
                      {s.needsAttention && (
                        <View style={[styles.attentionWarn, { borderColor: P.rose + '30', backgroundColor: P.rose + '10' }]}>
                          <Feather name="alert-triangle" size={14} color={P.rose} />
                          <Text style={[styles.attentionText, { color: P.rose }]}>
                            {s.progressPct < 10
                              ? `Hasn't started — ${s.progressPct}% completion. Immediate intervention needed.`
                              : s.progressPct < 30
                              ? `Very low progress at ${s.progressPct}%. Consider a one-on-one session.`
                              : (s.currentStreak || 0) < 2
                              ? `Streak dropped to ${s.currentStreak || 0} days. Student may be disengaging.`
                              : `Progress at ${s.progressPct}% — below expected level for this stage.`}
                          </Text>
                        </View>
                      )}

                      <TouchableOpacity
                        style={styles.assignBtn}
                        onPress={() => navigation.navigate('TeacherAssignments' as any, { preSelectStudent: s } as any)}
                        activeOpacity={0.8}
                      >
                        <Feather name="plus-circle" size={14} color={P.teal} />
                        <Text style={styles.assignBtnText}>Assign Task</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

// ── Styles ────────────────────────────────────────────────
const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 60, gap: spacing.lg },

  card: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.lg,
  },
  cardTitle: { fontSize: 13, fontWeight: '700', color: c.textMain },
  overviewRow: { flexDirection: 'row', gap: spacing.md },
  bigNum: { fontSize: 26, fontWeight: '900', letterSpacing: -1 },
  dimLabel: { fontSize: 11, color: c.textDim, fontWeight: '500' },
  snapVal: { fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  snapLabel: { fontSize: 10, color: c.textDim, fontWeight: '500', marginTop: 1 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: c.textMain, fontSize: 14 },

  filterTab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor,
    backgroundColor: c.cardDark,
  },
  filterTabActive: { borderColor: P.teal, backgroundColor: P.teal + '15' },
  filterTabText: { fontSize: 12, fontWeight: '600', color: c.textMuted },
  tabBadge: {
    backgroundColor: P.rose, borderRadius: 8, width: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  tabBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },

  sectionTitle: { fontSize: 12, fontWeight: '600', color: c.textDim },

  studentCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm,
  },
  studentTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '800' },
  studentName: { fontSize: 14, fontWeight: '700', color: c.textMain },
  studentMeta: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  progressPct: { fontSize: 14, fontWeight: '800' },
  progressBarBg: { width: 64, height: 5, backgroundColor: c.borderColor, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },
  riskBadge: {
    backgroundColor: P.rose + '20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: P.rose + '40',
  },
  riskBadgeText: { fontSize: 9, fontWeight: '700', color: P.rose },

  quickStats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  quickStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  quickStatText: { fontSize: 11, fontWeight: '600' },

  expandedSection: { gap: spacing.md },
  expandDivider: { height: 1, backgroundColor: c.borderColor },
  metricsGrid: { flexDirection: 'row', gap: spacing.sm },
  metricCard: {
    flex: 1, borderRadius: radius.md, borderWidth: 1,
    padding: spacing.md, alignItems: 'center', gap: 4,
  },
  metricValue: { fontSize: 16, fontWeight: '900' },
  metricLabel: { fontSize: 10, color: c.textDim, textAlign: 'center' },

  topicsTitle: { fontSize: 12, fontWeight: '700', color: c.textMuted },
  topicsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  topicChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: P.green + '15', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: P.green + '30',
  },
  topicText: { fontSize: 11, color: P.green, fontWeight: '600' },

  attentionWarn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: radius.md, padding: spacing.md, borderWidth: 1,
  },
  attentionText: { fontSize: 12, flex: 1, lineHeight: 18 },

  assignBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: P.teal + '18', borderRadius: radius.md,
    padding: 10, borderWidth: 1, borderColor: P.teal + '40',
  },
  assignBtnText: { fontSize: 13, fontWeight: '700', color: P.teal },
});
