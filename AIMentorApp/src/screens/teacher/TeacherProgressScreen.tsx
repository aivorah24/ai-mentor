import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform,
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

const P = {
  rose:   '#BAA467',
  green:  '#BAA467',
  gold:   '#BAA467',
  peach:  '#BAA467',
  teal:   '#BAA467',
  slate:  '#BAA467',
};

const SERIF_DISPLAY = Platform.OS === 'web'
  ? '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif'
  : undefined;

type Student = {
  id: string; name: string; grade: string; curriculum: string;
  studyTime: number; completedTopics: string[]; progressPct: number;
  lastActive: string; email?: string;
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

// HEATMAP LEGEND UPDATED
const HEAT = {
  mastered:    '#4CAF50', // Green
  trying:      '#FFEB3B', // Yellow
  stuck:       '#F44336', // Red
  dropped:     '#FF9800', // Orange (Tried once)
  not_started: '#9E9E9E', // Grey
  struggled:   '#9C27B0', // Purple
};

function HeatIcon({ status }: { status: string }) {
  if (status === 'mastered') return <Feather name="check-circle" size={12} color="#fff" />;
  if (status === 'trying') return <Feather name="clock" size={12} color="#fff" />;
  if (status === 'stuck') return <Feather name="alert-triangle" size={12} color="#fff" />;
  if (status === 'dropped') return <Feather name="minus-circle" size={12} color="#fff" />;
  if (status === 'struggled') return <Feather name="alert-octagon" size={12} color="#fff" />;
  return <Circle cx={6} cy={6} r={4} fill="#fff" />;
}

// ── Main Screen ───────────────────────────────────────────
export default function TeacherProgressScreen({ navigation }: any) {
  const { colors: c } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Header Controls state
  const [selectedGrade, setSelectedGrade] = useState('Grade 4 - Section A');
  const [selectedSubject, setSelectedSubject] = useState('All subjects');
  const [selectedUnit, setSelectedUnit] = useState('All units');

  // Drill-down panel state
  const [selectedStudentTopic, setSelectedStudentTopic] = useState<{student: any, topic?: string} | null>(null);

  const load = useCallback(async () => {
    // dummy load logic
    setStudents([
      { id: '1', name: 'Alice Smith', grade: 'Grade 4', curriculum: 'Standard', studyTime: 120, completedTopics: [], progressPct: 45, lastActive: new Date().toISOString() },
      { id: '2', name: 'Bob Jones', grade: 'Grade 4', curriculum: 'Standard', studyTime: 65, completedTopics: [], progressPct: 20, lastActive: new Date().toISOString() },
    ]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const closePanel = () => setSelectedStudentTopic(null);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Student Progress"
          subtitle="Track every student's learning journey"
          onMenuPress={() => navigation.openDrawer()}
        />

        {/* A. Top Bar & Header Controls */}
        <View style={styles.topBar}>
          <View style={styles.viewSwitcher}>
            <TouchableOpacity style={styles.switcherBtnActive}><Text style={styles.switcherTextActive}>Teacher</Text></TouchableOpacity>
            <TouchableOpacity style={styles.switcherBtn}><Text style={styles.switcherText}>Parent view</Text></TouchableOpacity>
          </View>
          <View style={styles.dropdowns}>
            <TouchableOpacity style={styles.dropdownBtn}><Text style={styles.dropdownText}>{selectedGrade}</Text><Feather name="chevron-down" size={14} color={c.textMain} /></TouchableOpacity>
            <TouchableOpacity style={styles.dropdownBtn}><Text style={styles.dropdownText}>{selectedSubject}</Text><Feather name="chevron-down" size={14} color={c.textMain} /></TouchableOpacity>
            <TouchableOpacity style={styles.dropdownBtn}><Text style={styles.dropdownText}>{selectedUnit}</Text><Feather name="chevron-down" size={14} color={c.textMain} /></TouchableOpacity>
            <TouchableOpacity style={styles.exportBtn}><Text style={styles.exportText}>Export report</Text><Feather name="download" size={14} color="#fff" /></TouchableOpacity>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={P.teal} />}
        >
          {/* Summary Cards */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Where the class stands, by subject</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              {['Science', 'Social Studies', 'All subjects combined'].map(subj => (
                <View key={subj} style={styles.horizontalKpiCard}>
                  <Text style={styles.kpiSubj}>{subj}</Text>
                  <Text style={styles.kpiPct}>47%</Text>
                  <View style={styles.kpiBarBg}><View style={[styles.kpiBarFill, { width: '47%', backgroundColor: P.teal }]} /></View>
                  <Text style={styles.kpiMeta}>Avg attempt: 15m</Text>
                </View>
              ))}
            </View>
          </View>

          {/* B. Topic Exploration */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={styles.cardTitle}>Topic exploration</Text>
            </View>
            <View style={styles.legend}>
              <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: HEAT.mastered }]} /><Text style={styles.legendText}>Mastered</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: HEAT.trying }]} /><Text style={styles.legendText}>Trying</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: HEAT.stuck }]} /><Text style={styles.legendText}>Stuck</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: HEAT.not_started }]} /><Text style={styles.legendText}>Not started</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: HEAT.dropped }]} /><Text style={styles.legendText}>Tried once</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: HEAT.struggled }]} /><Text style={styles.legendText}>Struggled to master</Text></View>
            </View>
            <ScrollView horizontal>
              <View>
                 <View style={{ flexDirection: 'row', paddingBottom: 10 }}>
                   <View style={{ width: 120 }} />
                   <View style={{ width: 150, alignItems: 'center' }}><Text style={styles.unitHeader}>Unit 1</Text></View>
                   <View style={{ width: 150, alignItems: 'center' }}><Text style={styles.unitHeader}>Unit 2</Text></View>
                 </View>
                 {students.map(s => (
                   <TouchableOpacity key={s.id} style={{ flexDirection: 'row', marginBottom: 8, alignItems: 'center' }} onPress={() => setSelectedStudentTopic({ student: s, topic: 'Topic 1' })}>
                     <View style={{ width: 120, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                       <View style={[styles.avatarSm, { backgroundColor: avatarColor(s.name) }]}><Text style={styles.avatarTextSm}>{initials(s.name)}</Text></View>
                       <Text style={styles.studentNameSm}>{s.name}</Text>
                     </View>
                     <View style={{ width: 30, height: 30, backgroundColor: HEAT.mastered, borderRadius: 4, alignItems: 'center', justifyContent: 'center', marginHorizontal: 2 }}>
                       <HeatIcon status="mastered" />
                     </View>
                   </TouchableOpacity>
                 ))}
              </View>
            </ScrollView>
          </View>

          {/* C. Activity & Performance Table */}
          <View style={styles.card}>
            <View style={{ marginBottom: 12 }}>
              <Text style={styles.cardTitle}>Activity & Performance</Text>
              <Text style={{ fontSize: 11, color: c.textDim }}>*Time counts every learning surface, not just the quiz</Text>
            </View>
            <ScrollView horizontal>
              <View style={{ minWidth: 800 }}>
                {/* Headers */}
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, { width: 40 }]}>#</Text>
                  <Text style={[styles.th, { width: 150 }]}>Student</Text>
                  <View style={{ width: 200 }}>
                    <Text style={[styles.th, { textAlign: 'center' }]}>Time Spent</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 4 }}>
                      <Text style={styles.subTh}>Learn</Text><Text style={styles.subTh}>Listen</Text><Text style={styles.subTh}>AI Tutor</Text><Text style={styles.subTh}>Practice</Text>
                    </View>
                  </View>
                  <View style={{ width: 100 }}>
                    <Text style={[styles.th, { textAlign: 'center' }]}>Quiz</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 4 }}>
                      <Text style={styles.subTh}>Attempts</Text><Text style={styles.subTh}>Best %</Text>
                    </View>
                  </View>
                  <Text style={[styles.th, { width: 100, textAlign: 'center' }]}>Aivorah AI</Text>
                  <Text style={[styles.th, { width: 100, textAlign: 'center' }]}>Last Active</Text>
                  <Text style={[styles.th, { width: 150, textAlign: 'center' }]}>Progress by Subject</Text>
                </View>
                {/* Rows */}
                {students.map((s, idx) => (
                  <TouchableOpacity key={s.id} style={styles.tableRow} onPress={() => setSelectedStudentTopic({ student: s, topic: 'General' })}>
                    <Text style={[styles.td, { width: 40 }]}>{idx + 1}</Text>
                    <View style={{ width: 150, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={[styles.avatarSm, { backgroundColor: avatarColor(s.name) }]}><Text style={styles.avatarTextSm}>{initials(s.name)}</Text></View>
                      <Text style={styles.td} numberOfLines={1}>{s.name}</Text>
                    </View>
                    <View style={{ width: 200, flexDirection: 'row', justifyContent: 'space-around' }}>
                      <Text style={styles.tdSub}>10m</Text><Text style={styles.tdSub}>5m</Text><Text style={styles.tdSub}>20m</Text><Text style={styles.tdSub}>15m</Text>
                    </View>
                    <View style={{ width: 100, flexDirection: 'row', justifyContent: 'space-around' }}>
                      <Text style={styles.tdSub}>2</Text><Text style={styles.tdSub}>85%</Text>
                    </View>
                    <Text style={[styles.td, { width: 100, textAlign: 'center' }]}>Yes</Text>
                    <Text style={[styles.td, { width: 100, textAlign: 'center' }]}>{lastActiveLabel(s.lastActive)}</Text>
                    <View style={{ width: 150, justifyContent: 'center', paddingHorizontal: 10 }}>
                      <View style={styles.kpiBarBg}><View style={[styles.kpiBarFill, { width: '50%', backgroundColor: P.teal }]} /></View>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </ScrollView>

        {/* D. Drill-Down Panel / Drawer */}
        {selectedStudentTopic && (
          <View style={styles.drawer}>
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>Every attempt — {selectedStudentTopic.student.name} — {selectedStudentTopic.topic}</Text>
              <TouchableOpacity onPress={closePanel}><Feather name="x" size={20} color={c.textMain} /></TouchableOpacity>
            </View>
            <View style={styles.drawerTable}>
              <View style={styles.drawerTableRow}>
                <Text style={styles.dTh}>Attempt #</Text>
                <Text style={styles.dTh}>Status</Text>
                <Text style={styles.dTh}>Time on Content</Text>
                <Text style={styles.dTh}>Practice</Text>
                <Text style={styles.dTh}>Quiz Score</Text>
                <Text style={styles.dTh}>Mistakes</Text>
                <Text style={styles.dTh}>When</Text>
              </View>
              <View style={styles.drawerTableRow}>
                <Text style={styles.dTd}>1</Text>
                <Text style={styles.dTd}>Mastered</Text>
                <Text style={styles.dTd}>15m</Text>
                <Text style={styles.dTd}>10m / 90%</Text>
                <Text style={styles.dTd}>85%</Text>
                <Text style={styles.dTd}>2</Text>
                <Text style={styles.dTd}>Today</Text>
              </View>
            </View>
          </View>
        )}
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 60, gap: spacing.lg },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.md, zIndex: 10 },
  viewSwitcher: { flexDirection: 'row', backgroundColor: c.cardDark, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, padding: 2 },
  switcherBtnActive: { backgroundColor: P.teal, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm },
  switcherBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm },
  switcherTextActive: { color: '#fff', fontSize: 12, fontWeight: '700' },
  switcherText: { color: c.textMain, fontSize: 12, fontWeight: '600' },
  dropdowns: { flexDirection: 'row', gap: spacing.sm },
  dropdownBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.cardDark, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor },
  dropdownText: { fontSize: 12, color: c.textMain, fontWeight: '600' },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: P.teal, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md },
  exportText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  card: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.xl, padding: spacing.lg },
  cardTitle: { fontSize: 16, fontWeight: '700', color: c.textMain, fontFamily: SERIF_DISPLAY },
  horizontalKpiCard: { flex: 1, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, padding: 12, backgroundColor: c.bgDark },
  kpiSubj: { fontSize: 12, fontWeight: '700', color: c.textMain, marginBottom: 8 },
  kpiPct: { fontSize: 24, fontWeight: '800', color: P.teal, marginBottom: 4 },
  kpiBarBg: { height: 6, backgroundColor: c.borderColor, borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  kpiBarFill: { height: '100%', borderRadius: 3 },
  kpiMeta: { fontSize: 10, color: c.textDim },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontSize: 11, color: c.textDim, fontWeight: '600' },
  unitHeader: { fontSize: 11, fontWeight: '700', color: c.textMuted },
  avatarSm: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarTextSm: { fontSize: 9, fontWeight: '800', color: '#fff' },
  studentNameSm: { fontSize: 11, fontWeight: '600', color: c.textMain },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.borderColor, paddingBottom: 8 },
  th: { fontSize: 11, fontWeight: '700', color: c.textMuted },
  subTh: { fontSize: 9, fontWeight: '600', color: c.textDim },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.borderColor, paddingVertical: 10 },
  td: { fontSize: 12, color: c.textMain, fontWeight: '500' },
  tdSub: { fontSize: 11, color: c.textDim },
  drawer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: c.cardDark, borderTopWidth: 1, borderColor: c.borderColor, padding: spacing.xl, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, elevation: 10 },
  drawerHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  drawerTitle: { fontSize: 14, fontWeight: '700', color: c.textMain },
  drawerTable: { borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md },
  drawerTableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.borderColor, padding: 8 },
  dTh: { flex: 1, fontSize: 10, fontWeight: '700', color: c.textMuted },
  dTd: { flex: 1, fontSize: 11, color: c.textMain },
});
