import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import { useTheme } from '../../context/ThemeContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import SERVER_URL from '../../config/serverUrl';

const TABS = ['Sessions', 'Readiness', 'Pending', 'Client Feedback'];

const PRIORITY_COLOR: Record<string, string> = {
  '🔴 HIGH': '#ef4444',
  '🟡 MED':  '#f59e0b',
  '🟢 LOW':  '#10b981',
};

export default function ProjectDetailsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const gold = colors.accentYellow;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Sessions');

  useEffect(() => {
    fetch(`${SERVER_URL}/devlog`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Project Details"
          subtitle="Aivorah · Dev Work Log"
          showBack={true}
          onMenuPress={() => navigation.openDrawer()}
        />

        {/* Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabContent}>
          {TABS.map(t => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, activeTab === t && { backgroundColor: gold, borderColor: gold }]}
              onPress={() => setActiveTab(t)}
              activeOpacity={0.75}
            >
              <Text style={[styles.tabText, activeTab === t && { color: '#fff' }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? (
          <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 60 }} />
        ) : !data ? (
          <View style={styles.empty}>
            <Feather name="alert-circle" size={32} color={colors.accentRed} />
            <Text style={styles.emptyText}>Could not load project data</Text>
          </View>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

            {/* ── SESSIONS TAB ─────────────────────────── */}
            {activeTab === 'Sessions' && (
              <>
                <View style={styles.sectionHeader}>
                  <Feather name="clock" size={16} color={gold} />
                  <Text style={styles.sectionTitle}>Work Sessions</Text>
                </View>

                {/* Total hours card */}
                <View style={styles.totalCard}>
                  {[
                    { label: 'Total Sessions', value: String(data.sessionRows?.length ?? 0), icon: 'calendar' as const, color: colors.accentBlue },
                    { label: 'Hours Today', value: '6.5h', icon: 'clock' as const, color: colors.accentGreen },
                    { label: 'Days to Demo', value: String(Math.max(0, Math.ceil((new Date('2026-04-10').getTime() - Date.now()) / 86400000))), icon: 'target' as const, color: colors.accentRed },
                  ].map(s => (
                    <View key={s.label} style={styles.totalStat}>
                      <Feather name={s.icon} size={18} color={s.color} />
                      <Text style={[styles.totalVal, { color: s.color }]}>{s.value}</Text>
                      <Text style={styles.totalLabel}>{s.label}</Text>
                    </View>
                  ))}
                </View>

                {/* Session table */}
                <View style={styles.table}>
                  <View style={[styles.tableRow, styles.tableHeader]}>
                    <Text style={[styles.tableCell, styles.headerCell, { flex: 2 }]}>Date</Text>
                    <Text style={[styles.tableCell, styles.headerCell, { flex: 1 }]}>Hours</Text>
                    <Text style={[styles.tableCell, styles.headerCell, { flex: 3 }]}>Milestone</Text>
                  </View>
                  {(data.sessionRows ?? []).map((row: any, i: number) => (
                    <View key={i} style={[styles.tableRow, i % 2 === 0 && { backgroundColor: colors.cardHover }]}>
                      <Text style={[styles.tableCell, { flex: 2, color: gold, fontWeight: '600' }]}>{row.date}</Text>
                      <Text style={[styles.tableCell, { flex: 1, color: colors.accentYellow, fontWeight: '700' }]}>{row.hours}</Text>
                      <Text style={[styles.tableCell, { flex: 3 }]} numberOfLines={2}>{row.milestone}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* ── READINESS TAB ────────────────────────── */}
            {activeTab === 'Readiness' && (
              <>
                <View style={styles.sectionHeader}>
                  <Feather name="bar-chart-2" size={16} color={gold} />
                  <Text style={styles.sectionTitle}>Demo Readiness — April 10</Text>
                </View>

                {(data.readiness ?? []).map((r: any) => {
                  const color = r.pct >= 75 ? colors.accentGreen : r.pct >= 40 ? colors.accentYellow : colors.accentRed;
                  return (
                    <View key={r.label} style={styles.barRow}>
                      <View style={styles.barLabelRow}>
                        <Text style={styles.barLabel}>{r.label}</Text>
                        <Text style={[styles.barPct, { color }]}>{r.pct}%</Text>
                      </View>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { width: `${r.pct}%` as any, backgroundColor: color }]} />
                      </View>
                    </View>
                  );
                })}

                {/* Overall */}
                <View style={[styles.overallCard, { borderColor: gold + '40' }]}>
                  <Text style={styles.overallLabel}>Overall Demo Readiness</Text>
                  <Text style={[styles.overallPct, { color: gold }]}>~40%</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: '40%', backgroundColor: gold }]} />
                  </View>
                  <Text style={styles.overallSub}>~20 hours of work remaining before April 10</Text>
                </View>
              </>
            )}

            {/* ── PENDING TAB ──────────────────────────── */}
            {activeTab === 'Pending' && (
              <>
                <View style={styles.sectionHeader}>
                  <Feather name="list" size={16} color={gold} />
                  <Text style={styles.sectionTitle}>Pending for Demo</Text>
                </View>

                {(data.pending ?? []).map((p: any, i: number) => {
                  const color = p.priority.includes('HIGH') ? colors.accentRed : p.priority.includes('MED') ? colors.accentYellow : colors.accentGreen;
                  return (
                    <View key={i} style={styles.pendingRow}>
                      <View style={[styles.priorityDot, { backgroundColor: color }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pendingFeature}>{p.feature}</Text>
                        <Text style={[styles.pendingPriority, { color }]}>{p.priority}</Text>
                      </View>
                      <View style={[styles.hoursChip, { backgroundColor: color + '18', borderColor: color + '40' }]}>
                        <Feather name="clock" size={10} color={color} />
                        <Text style={[styles.hoursText, { color }]}>{p.hours}</Text>
                      </View>
                    </View>
                  );
                })}
              </>
            )}

            {/* ── CLIENT FEEDBACK TAB ──────────────────── */}
            {activeTab === 'Client Feedback' && (
              <>
                <View style={styles.sectionHeader}>
                  <Feather name="message-circle" size={16} color={gold} />
                  <Text style={styles.sectionTitle}>Client Feedback (All Calls)</Text>
                </View>

                {/* 2026-03-27 call */}
                <Text style={styles.meetingDate}>Call — 2026-03-27</Text>
                {['Aivorah brand name + mascot (age-tier characters)', 'Family voices (daughters + Pratisha)', 'Demo deadline: April 10', 'Image generation: Hugging Face + Mistral', 'Schedule: start time + duration (not end time)', 'Challenges: grid tiles (side by side)', 'Dashboard activity: more compact', 'Dark mode: replace purple accent', 'Assignments: PDF auto-split to questions', 'Leaderboard: show top 3% not exact rank', 'In-app messaging (teacher ↔ parent)'].map((item, i) => (
                  <View key={i} style={styles.feedbackRow}>
                    <Feather name="check-circle" size={14} color={colors.accentGreen} />
                    <Text style={styles.feedbackText}>{item}</Text>
                  </View>
                ))}

                <Text style={[styles.meetingDate, { marginTop: spacing.xl }]}>Call — 2026-03-29</Text>
                {['Pending assignments must show at top (not bottom)', 'Add images to challenge cards'].map((item, i) => (
                  <View key={i} style={styles.feedbackRow}>
                    <Feather name="check-circle" size={14} color={colors.accentGreen} />
                    <Text style={styles.feedbackText}>{item}</Text>
                  </View>
                ))}
              </>
            )}

          </ScrollView>
        )}
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:     { flex: 1, backgroundColor: c.bgDark },
  scroll:     { flex: 1 },
  content:    { padding: spacing.xl, paddingBottom: 48, gap: spacing.xl },
  empty:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  emptyText:  { fontSize: 14, color: c.textMuted },

  tabScroll:  { flexShrink: 0, borderBottomWidth: 1, borderBottomColor: c.borderColor },
  tabContent: { paddingHorizontal: spacing.xl, gap: spacing.sm, paddingVertical: spacing.md },
  tab:        { paddingHorizontal: spacing.lg, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark },
  tabText:    { fontSize: 13, fontWeight: '600', color: c.textMuted },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionTitle:  { fontSize: 16, fontWeight: '700', color: c.textMain },

  // Total stats
  totalCard:  { flexDirection: 'row', backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, paddingVertical: spacing.lg },
  totalStat:  { flex: 1, alignItems: 'center', gap: 6 },
  totalVal:   { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  totalLabel: { fontSize: 10, color: c.textDim, fontWeight: '600', textAlign: 'center' },

  // Table
  table:       { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, overflow: 'hidden' },
  tableRow:    { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: c.borderColor },
  tableHeader: { backgroundColor: c.cardHover },
  tableCell:   { fontSize: 12, color: c.textMuted },
  headerCell:  { fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Progress bars
  barRow:      { gap: 6 },
  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barLabel:    { fontSize: 13, fontWeight: '600', color: c.textMain },
  barPct:      { fontSize: 13, fontWeight: '800' },
  barTrack:    { height: 8, backgroundColor: c.borderColor, borderRadius: 4, overflow: 'hidden' },
  barFill:     { height: '100%', borderRadius: 4 },
  overallCard: { backgroundColor: c.cardDark, borderWidth: 1, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, marginTop: spacing.md },
  overallLabel:{ fontSize: 14, fontWeight: '700', color: c.textMain },
  overallPct:  { fontSize: 36, fontWeight: '900', letterSpacing: -1 },
  overallSub:  { fontSize: 12, color: c.textDim, marginTop: 4 },

  // Pending
  pendingRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, padding: spacing.lg },
  priorityDot:    { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  pendingFeature: { fontSize: 13, fontWeight: '600', color: c.textMain },
  pendingPriority:{ fontSize: 11, fontWeight: '700', marginTop: 2 },
  hoursChip:      { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4, flexShrink: 0 },
  hoursText:      { fontSize: 11, fontWeight: '700' },

  // Feedback
  meetingDate:    { fontSize: 13, fontWeight: '800', color: c.accentYellow, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.borderColor },
  feedbackRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 6 },
  feedbackText:   { fontSize: 13, color: c.textMuted, flex: 1, lineHeight: 20 },
});
