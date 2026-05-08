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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textMain }}>Progress Distribution</Text>
        <Text style={{ fontSize: 11, color: colors.textDim }}>{students.length} students</Text>
      </View>
      {buckets.map((b, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 52, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: b.color }} />
            <Text style={{ fontSize: 10, color: colors.textDim, fontWeight: '600' }}>{b.label}</Text>
          </View>
          <View style={{ flex: 1, height: 20, backgroundColor: b.color + '15', borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: b.color + '25' }}>
            <View style={{
              height: '100%', borderRadius: 6,
              width: `${Math.round((b.count / maxCount) * 100)}%` as any,
              backgroundColor: b.color + 'CC',
            }} />
          </View>
          <View style={{ backgroundColor: b.color + '20', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, minWidth: 28, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, color: b.color, fontWeight: '800' }}>{b.count}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Topic coverage heatmap (self-contained filters) ──────
const SUBJECT_COLORS: Record<string, string> = {
  All: P.slate, Math: P.teal, Science: P.green, English: P.gold, Arts: P.peach, Other: P.rose,
};

function TopicCoverage({ allStudents, colors, availableGrades, availableSubjects, cleanName, subjectOf }: {
  allStudents: Student[]; colors: any;
  availableGrades: string[];
  availableSubjects: string[];
  cleanName: (t: string) => string;
  subjectOf: (t: string) => string;
}) {
  const [gradeF, setGradeF] = useState('All');
  const [subjectF, setSubjectF] = useState('All');
  // { topic, subject } pairs from curriculum API
  const [curriculumTopics, setCurriculumTopics] = useState<{topic: string; subject: string}[]>([]);
  const [availCurrSubjects, setAvailCurrSubjects] = useState<string[]>([]);

  // Fetch curriculum topics for the selected grade
  useEffect(() => {
    const fetchTopics = async () => {
      const grades = gradeF === 'All' ? availableGrades.filter(g => g !== 'All') : [gradeF];
      const topicMap = new Map<string, string>(); // topic -> subject
      for (const grade of grades) {
        try {
          const gradeStudents = allStudents.filter(s => s.grade === grade);
          const curriculum = gradeStudents[0]?.curriculum || 'IB PYP';
          const res = await fetch(`${SERVER_URL}/curriculum?grade=${encodeURIComponent(grade)}&curriculum=${encodeURIComponent(curriculum)}`);
          if (res.ok) {
            const data = await res.json();
            (data.topics || []).forEach((t: any) => {
              if (t.topic) topicMap.set(t.topic, t.subject || subjectOf(t.topic));
            });
          }
        } catch {}
      }
      const pairs = Array.from(topicMap.entries()).map(([topic, subject]) => ({ topic, subject }));
      setCurriculumTopics(pairs);
      // Unique subjects from curriculum
      const subjSet = new Set(pairs.map(p => p.subject).filter(Boolean));
      const order = ['Math', 'Mathematics', 'Science', 'English', 'Arts', 'Other'];
      const sorted = [...order.filter(s => subjSet.has(s)), ...[...subjSet].filter(s => !order.includes(s))];
      setAvailCurrSubjects(sorted);
    };
    if (allStudents.length > 0) fetchTopics();
  }, [gradeF, allStudents, availableGrades]);

  if (allStudents.length === 0) return null;

  const students = gradeF === 'All' ? allStudents : allStudents.filter(s => s.grade === gradeF);

  // Build completion map from student data
  const completionMap: Record<string, number> = {};
  students.forEach(s => (s.completedTopics || []).forEach(t => {
    completionMap[t] = (completionMap[t] || 0) + 1;
  }));

  // Filter by subject using real subject from curriculum
  const displaySubjects = availCurrSubjects.length > 0 ? availCurrSubjects : availableSubjects.filter(s => s !== 'All');
  const filteredCurrTopics = curriculumTopics.filter(p =>
    subjectF === 'All' || p.subject === subjectF || p.subject?.toLowerCase() === subjectF.toLowerCase()
  );
  const baseTopics = filteredCurrTopics.length > 0
    ? filteredCurrTopics.map(p => p.topic)
    : Object.keys(completionMap).filter(t => subjectF === 'All' || subjectOf(t) === subjectF);
  const allTopicNames = baseTopics;

  // Sort: uncompleted first, then by count ascending
  const sortedTopics = allTopicNames
    .map(t => ({ name: t, count: completionMap[t] || 0 }))
    .sort((a, b) => a.count - b.count)
    .slice(0, 12);

  return (
    <View style={{ gap: 10 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textMain }}>Topic Completion Rate</Text>
        <Text style={{ fontSize: 11, color: colors.textDim }}>lowest first</Text>
      </View>

      {/* Subject chips — on top */}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Text style={{ fontSize: 11, color: colors.textDim, marginRight: 2 }}>Subject:</Text>
        {['All', ...displaySubjects].map(subj => {
          const sc = SUBJECT_COLORS[subj] || P.teal;
          return (
            <TouchableOpacity key={subj} onPress={() => setSubjectF(subj)} activeOpacity={0.75}
              style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1,
                borderColor: subjectF === subj ? sc : colors.borderColor,
                backgroundColor: subjectF === subj ? sc + '20' : 'transparent' }}>
              <Text style={{ fontSize: 11, fontWeight: subjectF === subj ? '700' : '500', color: subjectF === subj ? sc : colors.textDim }}>{subj}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Grade chips */}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Text style={{ fontSize: 11, color: colors.textDim, marginRight: 2 }}>Grade:</Text>
        {availableGrades.map(g => (
          <TouchableOpacity key={g} onPress={() => setGradeF(g)} activeOpacity={0.75}
            style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1,
              borderColor: gradeF === g ? P.slate : colors.borderColor,
              backgroundColor: gradeF === g ? P.slate + '20' : 'transparent' }}>
            <Text style={{ fontSize: 11, fontWeight: gradeF === g ? '700' : '500', color: gradeF === g ? P.slate : colors.textDim }}>{g}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Bars */}
      {sortedTopics.length === 0 ? (
        <Text style={{ fontSize: 12, color: colors.textDim, fontStyle: 'italic', paddingVertical: 8 }}>
          No topics found for this filter.
        </Text>
      ) : sortedTopics.map(({ name, count }, i) => {
        const pct = students.length > 0 ? Math.round((count / students.length) * 100) : 0;
        const color = pct === 0 ? P.rose : pct < 30 ? P.peach : pct < 60 ? P.gold : P.green;
        return (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 10, color: colors.textDim, width: 120, fontWeight: '500' }} numberOfLines={1}>
              {cleanName(name)}
            </Text>
            <View style={{ flex: 1, height: 14, backgroundColor: color + '15', borderRadius: 3, overflow: 'hidden', borderWidth: 1, borderColor: color + '25' }}>
              <View style={{ height: '100%', borderRadius: 3, width: `${pct}%` as any, backgroundColor: color + 'CC' }} />
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
const GRADE_PALETTE = [P.teal, P.slate, P.green, P.gold, P.peach, P.rose];
function GradeBreakdown({ students, colors }: { students: Student[]; colors: any }) {
  const grades: Record<string, Student[]> = {};
  students.forEach(s => {
    const g = s.grade || 'Unknown';
    if (!grades[g]) grades[g] = [];
    grades[g].push(s);
  });
  const gradeList = Object.entries(grades).sort();

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {gradeList.map(([grade, list], idx) => {
        const avg = Math.round(list.reduce((a, s) => a + (s.progressPct || 0), 0) / list.length);
        const atRisk = list.filter(s => s.needsAttention).length;
        const color = GRADE_PALETTE[idx % GRADE_PALETTE.length];
        return (
          <View key={grade} style={{
            flex: 1, minWidth: 130,
            backgroundColor: color + '12', borderWidth: 1.5, borderColor: color + '50',
            borderRadius: radius.xl, padding: spacing.lg, gap: 6, alignItems: 'center',
          }}>
            <View style={{ backgroundColor: color + '20', borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color }}>{grade}</Text>
            </View>
            <Text style={{ fontSize: 30, fontWeight: '900', color, letterSpacing: -1 }}>{avg}%</Text>
            <Text style={{ fontSize: 10, color: colors.textDim }}>{list.length} students</Text>
            <View style={{ width: '100%', height: 4, backgroundColor: color + '20', borderRadius: 2, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${avg}%` as any, backgroundColor: color, borderRadius: 2 }} />
            </View>
            {atRisk > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: P.rose + '15', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
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

// ── Teacher AI Assistant ──────────────────────────────────
type ChatMsg = { role: 'user' | 'ai'; text: string };
const QUICK_PROMPTS = [
  'Who needs urgent help this week?',
  'Which topics should I revisit in class?',
  'Give me a report card summary for all students',
  'Which students are ready for advanced work?',
];

function AIAnalysis({ students, colors, styles }: { students: Student[]; colors: any; styles: any }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const classSummary = students.map(s =>
    `${s.name} (${s.grade}, ${s.curriculum}): ${s.progressPct}% progress, ${(s.completedTopics || []).length} topics completed [${(s.completedTopics || []).join(', ') || 'none'}], ${s.currentStreak || 0}-day streak, ${s.assignmentsDone || 0} assignments done, last active: ${s.lastActive ? new Date(s.lastActive).toDateString() : 'never'}, ${s.needsAttention ? 'NEEDS ATTENTION' : 'on track'}`
  ).join('\n');

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: ChatMsg = { role: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const systemContext = `You are an expert AI teaching assistant helping a professional teacher. You have full access to class performance data. Be direct, specific, and professional — no child-friendly guardrails. Use student names. Give actionable, data-driven recommendations. You can analyse assignments, flag struggling students, suggest interventions, and generate report summaries.\n\nClass data:\n${classSummary}`;
      const prompt = `${systemContext}\n\nTeacher's question: ${text}`;

      const res = await fetch(`${SERVER_URL}/ask/teacher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, classSummary }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'ai', text: data.answer || 'Unable to generate response.' }]);
    } catch {
      setMessages(prev => [...prev, { role: 'ai', text: 'Could not connect to AI server.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.card, { borderColor: P.slate + '50', backgroundColor: P.slate + '08', gap: spacing.md }]}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: P.slate + '25', alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="cpu" size={18} color={P.slate} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: colors.textMain }}>Teacher AI Assistant</Text>
          <Text style={{ fontSize: 11, color: colors.textDim }}>Powered by Groq · {students.length} students loaded</Text>
        </View>
      </View>

      {/* Quick prompt chips */}
      {messages.length === 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 11, color: colors.textDim, fontWeight: '600' }}>Quick actions:</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {QUICK_PROMPTS.map((q, i) => (
              <TouchableOpacity key={i} onPress={() => sendMessage(q)} activeOpacity={0.75}
                style={{ backgroundColor: P.slate + '18', borderWidth: 1, borderColor: P.slate + '40', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={{ fontSize: 11, color: P.slate, fontWeight: '600' }}>{q}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Chat messages */}
      {messages.length > 0 && (
        <View style={{ gap: 10 }}>
          {messages.map((msg, i) => (
            <View key={i} style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '92%',
              backgroundColor: msg.role === 'user' ? P.slate + '25' : colors.cardDark,
              borderWidth: 1,
              borderColor: msg.role === 'user' ? P.slate + '50' : colors.borderColor,
              borderRadius: radius.lg, padding: spacing.md, gap: 6,
            }}>
              {msg.role === 'ai' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: P.slate + '30', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="cpu" size={10} color={P.slate} />
                  </View>
                  <Text style={{ fontSize: 10, color: P.slate, fontWeight: '700', letterSpacing: 0.5 }}>AI ASSISTANT</Text>
                </View>
              )}
              {msg.role === 'ai'
                ? msg.text.split('\n').filter(l => l.trim()).map((line, li) => {
                    const isBullet = /^[-•*\d+\.]\s/.test(line.trim());
                    const isHeader = /^\*\*(.+)\*\*/.test(line.trim()) || /^#+\s/.test(line.trim());
                    const cleanLine = line.replace(/^[-•*\d+\.]\s*/, '').replace(/\*\*/g, '').replace(/^#+\s/, '');
                    if (isHeader) return (
                      <Text key={li} style={{ fontSize: 12, fontWeight: '800', color: colors.textMain, marginTop: li > 0 ? 6 : 0 }}>{cleanLine}</Text>
                    );
                    if (isBullet) return (
                      <View key={li} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: P.slate, marginTop: 7, flexShrink: 0 }} />
                        <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 20, flex: 1 }}>{cleanLine}</Text>
                      </View>
                    );
                    return <Text key={li} style={{ fontSize: 12, color: colors.textMuted, lineHeight: 20 }}>{cleanLine}</Text>;
                  })
                : <Text style={{ fontSize: 12, color: colors.textMain, lineHeight: 19 }}>{msg.text}</Text>
              }
            </View>
          ))}
          {loading && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: spacing.sm }}>
              <ActivityIndicator size="small" color={P.slate} />
              <Text style={{ fontSize: 12, color: colors.textDim }}>Analysing...</Text>
            </View>
          )}
        </View>
      )}

      {/* Input box */}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.borderColor, paddingTop: spacing.md }}>
        <TextInput
          style={{ flex: 1, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, color: colors.textMain, fontSize: 13 }}
          placeholder="Ask about your class, assignments, student performance..."
          placeholderTextColor={colors.textDim}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => sendMessage(input)}
          returnKeyType="send"
        />
        <TouchableOpacity
          onPress={() => sendMessage(input)}
          disabled={!input.trim() || loading}
          activeOpacity={0.8}
          style={{ backgroundColor: input.trim() ? P.slate : colors.borderColor, width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="send" size={16} color="#fff" />
        </TouchableOpacity>
      </View>

      {messages.length > 0 && (
        <TouchableOpacity onPress={() => setMessages([])} activeOpacity={0.7} style={{ alignSelf: 'center' }}>
          <Text style={{ fontSize: 11, color: colors.textDim }}>Clear conversation</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Subject keyword map ───────────────────────────────────
const SUBJECT_KEYWORDS: Record<string, string[]> = {
  Math:    ['math','addition','subtraction','multiplication','division','fraction','geometry','shape','number','algebra','place value','decimal','ch1_','ch2_','ch3_','ch4_','ch5_','ch6_','ch7_','ch8_','ch9_','ch10_','ch11_','ch12_','ch13_','ch14_'],
  Science: ['science','nutrition','health','plant','animal','force','energy','water','weather','matter','body'],
  English: ['english','adjective','noun','verb','sentence','grammar','reading','writing','phonics','vocabulary','comprehension','give and take','story'],
  Arts:    ['art','music','rhythm','beat','dance','drama','paint','draw','craft'],
};

function topicSubject(topic: string): string {
  const t = topic.toLowerCase();
  for (const [subj, kws] of Object.entries(SUBJECT_KEYWORDS)) {
    if (kws.some(kw => t.includes(kw))) return subj;
  }
  return 'Other';
}

function cleanTopicName(topic: string): string {
  // Convert slugs like "ch2_shapes" → "Ch 2 – Shapes"
  return topic
    .replace(/^ch(\d+)_(.+)$/, (_, n, rest) => `Ch ${n} – ${rest.replace(/_/g, ' ')}`)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
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

  // Grades the teacher actually has students in
  const allGrades = useMemo(() => {
    const gs = Array.from(new Set(students.map(s => s.grade).filter(Boolean))).sort();
    return ['All', ...gs];
  }, [students]);

  // Subjects that actually appear in completed topics across teacher's students
  const availableSubjects = useMemo(() => {
    // Always show full subject list — teacher can filter to relevant subjects
    return ['All', 'Math', 'Science', 'English', 'Arts', 'Other'];
  }, [students]);

  const filtered = students.filter(s => {
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase());
    const matchTab = activeTab === 'All' ? true : activeTab === 'At Risk' ? s.needsAttention : !s.needsAttention;
    return matchSearch && matchTab;
  }).sort((a, b) => (a.progressPct || 0) - (b.progressPct || 0));

  const atRisk = students.filter(s => s.needsAttention).length;

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
          {/* ── DISTRIBUTION CHART ── */}
          <View style={styles.card}>
            <DistributionChart students={students} colors={c} />
          </View>

          {/* ── GRADE BREAKDOWN ── */}
          <View style={styles.card}>
            <Text style={[styles.cardTitle, { marginBottom: spacing.md }]}>Grade-wise Performance</Text>
            <GradeBreakdown students={students} colors={c} />
          </View>

          {/* ── TOPIC COVERAGE (grade + subject filters live inside) ── */}
          <View style={styles.card}>
            <TopicCoverage allStudents={students} colors={c} availableGrades={allGrades} availableSubjects={availableSubjects} cleanName={cleanTopicName} subjectOf={topicSubject} />
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
