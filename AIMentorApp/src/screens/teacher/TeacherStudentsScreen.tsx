import React, { useMemo, useState, useEffect, useCallback, memo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import SERVER_URL from '../../config/serverUrl';

type Student = {
  id: string;
  name: string;
  email: string;
  grade: string;
  subject: string;
  curriculum: string;
  xpPoints: number;
  level: number;
  currentStreak: number;
  studyTime: number;
  completedTopics: string[];
  progressPct: number;
  assignmentsDone: number;
  lastActive: string;
  needsAttention: boolean;
  photoUrl?: string;
};

// ── Demo student registry ──────────────────────────────────────────────────
// In production this comes from Supabase: students matched by school+grade+curriculum.
// During demo, we derive the same relationships from onboarding data (grade+curriculum).
const DEMO_STUDENTS: Student[] = [
  {
    id: 'aanya',    name: 'Aanya Kapoor',  email: 'aanya@test.ai',
    grade: 'Grade 3', subject: 'IB PYP',  curriculum: 'IB PYP',
    xpPoints: 850,   level: 4,   currentStreak: 5, studyTime: 12,
    completedTopics: ['Number Sense', 'Addition', 'Shapes'],
    progressPct: 68, assignmentsDone: 8, lastActive: new Date(Date.now() - 86400000).toISOString(),
    needsAttention: false,
  },
  {
    id: 'ishaan',   name: 'Ishaan Mehta',  email: 'ishaan@test.ai',
    grade: 'Grade 4', subject: 'IB PYP',  curriculum: 'IB PYP',
    xpPoints: 1050,  level: 5,   currentStreak: 3, studyTime: 18,
    completedTopics: ['Fractions', 'Multiplication', 'Time'],
    progressPct: 72, assignmentsDone: 11, lastActive: new Date(Date.now() - 172800000).toISOString(),
    needsAttention: false,
  },
  {
    id: 'rohan',    name: 'Rohan Patel',   email: 'rohan@test.ai',
    grade: 'Grade 5', subject: 'IB PYP',  curriculum: 'IB PYP',
    xpPoints: 1200,  level: 6,   currentStreak: 2, studyTime: 15,
    completedTopics: ['Decimals', 'Area & Perimeter'],
    progressPct: 45, assignmentsDone: 6, lastActive: new Date(Date.now() - 259200000).toISOString(),
    needsAttention: true,
  },
  {
    id: 'diya',     name: 'Diya Sharma',   email: 'diya@test.ai',
    grade: 'Grade 3', subject: 'IB PYP',  curriculum: 'IB PYP',
    xpPoints: 780,   level: 4,   currentStreak: 7, studyTime: 10,
    completedTopics: ['Patterns', 'Counting', 'Measurement'],
    progressPct: 82, assignmentsDone: 9, lastActive: new Date().toISOString(),
    needsAttention: false,
  },
];

// Derive which students belong to this teacher based on teaches[] matching grade+curriculum
function deriveStudentsForTeacher(teaches: { grade: string; curriculum: string }[]): Student[] {
  if (!teaches || teaches.length === 0) return [];
  return DEMO_STUDENTS.filter(s =>
    teaches.some(t => t.grade === s.grade && t.curriculum === s.curriculum)
  );
}

const TABS = ['All', 'Grade 3', 'Grade 4', 'Grade 5', 'Needs Attention'];

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

function toTitleCase(str: string) {
  if (!str) return str;
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

const StudentAvatar = memo(({ photoUrl, name, grad, styles }: {
  photoUrl?: string; name: string; grad: [string, string]; styles: any;
}) => {
  const [imgErr, setImgErr] = useState(false);
  if (photoUrl && !imgErr) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={styles.avatar}
        onError={() => setImgErr(true)}
      />
    );
  }
  return (
    <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
      <Text style={styles.avatarText}>{initials(name)}</Text>
    </LinearGradient>
  );
});

// Enchanting Forest palette — matches app theme
const AVATAR_GRADIENTS: [string, string][] = [
  ['#5F8A86', '#7AADA8'],   // slate teal → mint
  ['#5A8A70', '#7AADA8'],   // forest green → mint
  ['#B8797E', '#C4836A'],   // rose → peach
  ['#8A8358', '#C5BD96'],   // gold → khaki
  ['#5F8A86', '#5A8A70'],   // teal → green
  ['#C4836A', '#B8797E'],   // peach → rose
];

function avatarGradient(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[h];
}

function lastActiveLabel(dateStr?: string) {
  if (!dateStr) return 'Never';
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

export default function TeacherStudentsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('All');

  const load = useCallback(async () => {
    try {
      const teacherId = encodeURIComponent(user?.email || 'teacher@demo.com');
      const res = await fetch(`${SERVER_URL}/student/by-teacher/${teacherId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.length > 0) {
          setStudents(data);
        } else {
          // Server has no data yet — derive from teacher's onboarding data (grade+curriculum match)
          setStudents(deriveStudentsForTeacher(user?.teaches ?? []));
        }
      } else {
        setStudents(deriveStudentsForTeacher(user?.teaches ?? []));
      }
    } catch {
      // Network error — still show derived students
      setStudents(deriveStudentsForTeacher(user?.teaches ?? []));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const filtered = students.filter(s => {
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase());
    const matchTab =
      activeTab === 'All'             ? true :
      activeTab === 'Needs Attention' ? s.needsAttention :
      s.grade === activeTab;
    return matchSearch && matchTab;
  });

  // Build grade tabs dynamically from actual student data
  const gradeTabs = ['All', ...Array.from(new Set(students.map(s => s.grade))).sort(), 'Needs Attention'];

  const stats = {
    total: students.length,
    onTrack: students.filter(s => !s.needsAttention).length,
    attention: students.filter(s => s.needsAttention).length,
    avgProgress: students.length
      ? Math.round(students.reduce((a, s) => a + s.progressPct, 0) / students.length)
      : 0,
  };

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Students"
          subtitle={`${stats.total} enrolled`}
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        >
          {/* Stats Row */}
          <View style={styles.statsRow}>
            {[
              { label: 'Total', value: stats.total, color: colors.primary },
              { label: 'On Track', value: stats.onTrack, color: colors.accentGreen },
              { label: 'Need Attention', value: stats.attention, color: colors.accentRed },
              { label: 'Avg Progress', value: `${stats.avgProgress}%`, color: colors.accentCyan },
            ].map((s) => (
              <View key={s.label} style={styles.statCard}>
                <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* Search */}
          <View style={styles.searchWrap}>
            <Feather name="search" size={15} color={colors.textDim} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search students..."
              placeholderTextColor={colors.textDim}
              value={search}
              onChangeText={setSearch}
            />
            {search ? (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Feather name="x" size={15} color={colors.textDim} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Filter Tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabs}>
            {gradeTabs.map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.75}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
                {tab === 'Needs Attention' && stats.attention > 0 && (
                  <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{stats.attention}</Text></View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Student List */}
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : filtered.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="users" size={36} color={colors.textDim} />
              <Text style={styles.emptyText}>No students found</Text>
            </View>
          ) : (
            filtered.map((s) => {
              const displayName = toTitleCase(s.name);
              const grad = avatarGradient(displayName);
              return (
                <TouchableOpacity
                  key={s.id}
                  style={styles.studentCard}
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate('TeacherProgress' as any)}
                >
                  {/* Top row */}
                  <View style={styles.cardTop}>
                    <StudentAvatar photoUrl={s.photoUrl} name={displayName} grad={grad} styles={styles} />
                    <View style={styles.cardInfo}>
                      <Text style={styles.studentName}>{displayName}</Text>
                      <Text style={styles.studentMeta}>{s.grade} · {s.curriculum}</Text>
                    </View>
                    {s.needsAttention ? (
                      <View style={styles.attentionBadge}>
                        <Feather name="alert-circle" size={11} color="#B8797E" />
                        <Text style={[styles.badgeText, { color: '#B8797E' }]}>Attention</Text>
                      </View>
                    ) : (
                      <View style={styles.onTrackBadge}>
                        <Feather name="check-circle" size={11} color="#5A8A70" />
                        <Text style={[styles.badgeText, { color: '#5A8A70' }]}>On Track</Text>
                      </View>
                    )}
                  </View>

                  {/* Progress bar */}
                  <View style={styles.progressWrap}>
                    <View style={styles.progressBarBg}>
                      <LinearGradient
                        colors={s.needsAttention ? ['#B8797E', '#C4836A'] : ['#5F8A86', '#5A8A70']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.progressBarFill, { width: `${s.progressPct}%` as any }]}
                      />
                    </View>
                    <Text style={styles.progressText}>{s.progressPct}%</Text>
                  </View>

                  {/* Stats row */}
                  <View style={styles.cardStats}>
                    <View style={styles.cardStat}>
                      <Feather name="zap" size={12} color="#C5BD96" />
                      <Text style={styles.cardStatVal}>{s.xpPoints} XP</Text>
                    </View>
                    <View style={styles.cardStat}>
                      <Feather name="activity" size={12} color="#C4836A" />
                      <Text style={styles.cardStatVal}>{s.currentStreak}d streak</Text>
                    </View>
                    <View style={styles.cardStat}>
                      <Feather name="book-open" size={12} color="#7AADA8" />
                      <Text style={styles.cardStatVal}>{s.completedTopics.length} topics</Text>
                    </View>
                    <View style={styles.cardStat}>
                      <Feather name="clock" size={12} color={colors.textDim} />
                      <Text style={styles.cardStatVal}>{lastActiveLabel(s.lastActive)}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.lg },

  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCard: {
    flex: 1, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.lg, padding: spacing.md, alignItems: 'center', gap: 2,
  },
  statValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  statLabel: { fontSize: 10, color: c.textDim, textAlign: 'center', fontWeight: '500' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: c.textMain, fontSize: 14 },

  tabsScroll: { marginHorizontal: -spacing.xl },
  tabs: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor,
    backgroundColor: c.cardDark,
  },
  tabActive: { backgroundColor: c.primaryGlow, borderColor: c.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  tabTextActive: { color: c.primary },
  tabBadge: {
    backgroundColor: c.accentRed, borderRadius: 8, width: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  tabBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },

  empty: { alignItems: 'center', gap: 12, paddingTop: 40 },
  emptyText: { fontSize: 14, color: c.textDim },

  studentCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  cardInfo: { flex: 1 },
  studentName: { fontSize: 15, fontWeight: '700', color: c.textMain },
  studentMeta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  attentionBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#B8797E18', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#B8797E40',
  },
  onTrackBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#5A8A7018', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#5A8A7040',
  },
  badgeText: { fontSize: 10, fontWeight: '700' },

  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  progressBarBg: { flex: 1, height: 6, backgroundColor: c.borderColor, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },
  progressText: { fontSize: 11, fontWeight: '700', color: c.textMuted, width: 32, textAlign: 'right' },

  cardStats: { flexDirection: 'row', gap: spacing.lg },
  cardStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardStatVal: { fontSize: 11, color: c.textMuted, fontWeight: '600' },
});
