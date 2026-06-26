import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Modal, Platform, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import SERVER_URL from '../../config/serverUrl';

// ── Types ────────────────────────────────────────────────────

interface ChildData {
  id: string;
  name: string;
  grade: string;
  curriculum?: string;
  school?: string;
  totalTopics?: number;
  status: 'on_track' | 'needs_attention' | 'getting_started';
  xpPoints: number;
  completedTopics: string[];
  currentStreak: number;
  studyTimeMinutes: number;
  assignmentsDone: number;
  lastLesson?: string;
}

interface Assignment {
  id: string;
  title: string;
  subject: string;
  dueDate: string;
  status: 'pending' | 'completed';
}

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_DAYS_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EMPTY_CHILD: ChildData = {
  id: '', name: '', grade: '', status: 'needs_attention',
  xpPoints: 0, completedTopics: [], currentStreak: 0,
  studyTimeMinutes: 0, assignmentsDone: 0,
};

// ── Helpers ──────────────────────────────────────────────────

function formatStudyTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDueDateShort(iso: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(iso); due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return 'Pending';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatEventDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ── Sub-components ───────────────────────────────────────────

function ChildCard({
  child, isSelected, onPress, onViewCreds, colors, s,
}: {
  child: ChildData; isSelected: boolean;
  onPress: () => void; onViewCreds: (c: ChildData) => void;
  colors: AppColors; s: any;
}) {
  const isOnTrack = child.status === 'on_track';
  const badgeColor = isOnTrack ? colors.accentYellow : colors.primary;
  const badgeLabel = isOnTrack ? 'On Track' : child.status === 'getting_started' ? 'Getting Started' : 'Keep Going';

  return (
    <TouchableOpacity
      style={[s.childCard, isSelected && { borderColor: colors.accentYellow, backgroundColor: colors.accentYellow + '0C' }]}
      onPress={onPress} activeOpacity={0.85}
    >
      <TouchableOpacity
        style={s.childKeyBtn}
        onPress={() => onViewCreds(child)}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        activeOpacity={0.7}
      >
        <Feather name="key" size={10} color={colors.textDim} />
      </TouchableOpacity>

      <View style={[s.childAvatar, { backgroundColor: isSelected ? colors.accentYellow + '20' : colors.borderColor + '80' }]}>
        <Text style={[s.childAvatarText, { color: isSelected ? colors.accentYellow : colors.textMain }]}>
          {child.name[0]}
        </Text>
      </View>
      <Text style={s.childName}>{child.name}</Text>
      <Text style={s.childGrade}>{child.grade}</Text>
      <View style={[s.statusBadge, { backgroundColor: badgeColor + '18', borderColor: badgeColor + '40' }]}>
        <View style={[s.statusDot, { backgroundColor: badgeColor }]} />
        <Text style={[s.statusText, { color: badgeColor }]}>{badgeLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

// Stacked segment bar (Lego-brick style)
function StackedBar({
  minutes, maxMinutes, isGoalMet, colors,
}: { minutes: number; maxMinutes: number; isGoalMet: boolean; colors: AppColors }) {
  const SEGMENTS = 10;
  const active = maxMinutes > 0 ? Math.max(0, Math.round((minutes / maxMinutes) * SEGMENTS)) : 0;
  return (
    <View style={{ flexDirection: 'column', gap: 2, alignItems: 'center' }}>
      {Array.from({ length: SEGMENTS }).map((_, i) => {
        const isActive = i >= SEGMENTS - active;
        return (
          <View
            key={i}
            style={{
              width: 22, height: 7, borderRadius: 3,
              backgroundColor: isActive
                ? (isGoalMet ? colors.accentYellow : colors.accentYellow + 'AA')
                : 'rgba(255,255,255,0.06)',
            }}
          />
        );
      })}
    </View>
  );
}

// Circular progress ring (CSS-based on web)
function CircleProgress({ pct, colors }: { pct: number; colors: AppColors }) {
  const size = 100;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.min(pct, 100) / 100;

  if (Platform.OS === 'web') {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {/* @ts-ignore */}
        <svg width={size} height={size} style={{ position: 'absolute' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={colors.accentYellow}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.textMain, fontFamily: fonts.serif }}>{pct}%</Text>
          <Text style={{ fontSize: 9, color: colors.textMuted, textAlign: 'center' }}>Weekly{'\n'}Progress</Text>
        </View>
      </View>
    );
  }
  // Fallback for native
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: colors.accentYellow, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.textMain, fontFamily: fonts.serif }}>{pct}%</Text>
      <Text style={{ fontSize: 9, color: colors.textMuted, textAlign: 'center' }}>Weekly{'\n'}Progress</Text>
    </View>
  );
}

// ── Main Screen ──────────────────────────────────────────────

export default function ParentDashboardScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { unreadCount, unreadAssignments } = useNotification();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const totalNotifs = unreadCount + unreadAssignments;

  const [children, setChildren] = useState<ChildData[]>([]);
  const [selectedChild, setSelectedChild] = useState<ChildData>(EMPTY_CHILD);
  const [childrenLoading, setChildrenLoading] = useState(true);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [weeklyActivity, setWeeklyActivity] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [subjectPerf, setSubjectPerf] = useState<{ subject: string; avgScore: number; attempts: number }[]>([]);

  const [credsChild, setCredsChild] = useState<ChildData | null>(null);
  const [creds, setCreds] = useState<any>(null);
  const [loadingCreds, setLoadingCreds] = useState(false);
  const [copiedField, setCopiedField] = useState('');

  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  function copyToClipboard(text: string, field: string) {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(''), 1500);
  }

  async function fetchCreds(child: ChildData) {
    setCredsChild(child);
    setCreds(null);
    setLoadingCreds(true);
    try {
      const res = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children/${child.id}/credentials`);
      setCreds(res.ok ? await res.json() : null);
    } catch { setCreds(null); }
    finally { setLoadingCreds(false); }
  }

  async function generateReport() {
    if (!selectedChild.id) return;
    setReportModalVisible(true);
    setReportData(null);
    setLoadingReport(true);
    try {
      const res = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children/${selectedChild.id}/ai-report`);
      setReportData(res.ok ? await res.json() : null);
    } catch { setReportData(null); }
    finally { setLoadingReport(false); }
  }

  function downloadReportPDF() {
    if (!reportData) return;
    const { student, metrics, report, generatedAt } = reportData;
    const date = new Date(generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const studyH = `${Math.floor(metrics.studyTimeMinutes / 60)}h ${metrics.studyTimeMinutes % 60}m`;
    const weekH = `${Math.floor(metrics.weeklyStudyMinutes / 60)}h ${metrics.weeklyStudyMinutes % 60}m`;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report - ${student.name}</title>
<style>body{font-family:Georgia,serif;max-width:800px;margin:0 auto;padding:40px;color:#1a1a2e}.logo{font-size:24px;font-weight:700;color:#BAA467}.section-title{color:#BAA467;font-weight:700;text-transform:uppercase;font-size:13px;letter-spacing:1px;margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:4px}.metric-card{display:inline-block;background:#f8f9fa;border-radius:8px;padding:12px 16px;margin:4px;text-align:center}.metric-value{font-size:22px;font-weight:700;color:#BAA467}.footer{color:#aaa;font-size:11px;text-align:center;margin-top:40px;border-top:1px solid #eee;padding-top:16px}</style></head><body>
<div class="logo">AIVORAH</div><h2>Student Report — ${student.name}</h2><p style="color:#888">${date}</p>
<p>${student.grade} · ${student.curriculum}</p>
<div>${[{ l: 'XP', v: metrics.xp }, { l: 'Level', v: metrics.level }, { l: 'Streak', v: metrics.currentStreak + 'd' }, { l: 'Topics', v: metrics.topicsCompleted }, { l: 'Assignments', v: metrics.assignmentsDone }].map(m => `<span class="metric-card"><div class="metric-value">${m.v}</div><div style="font-size:11px;color:#888">${m.l}</div></span>`).join('')}</div>
${report.summary ? `<div class="section-title" style="margin-top:24px">Overview</div><p>${report.summary}</p>` : ''}
${(report.strengths || []).length ? `<div class="section-title">Strengths</div><ul>${report.strengths.map((s: string) => `<li>${s}</li>`).join('')}</ul>` : ''}
${(report.recommendations || []).length ? `<div class="section-title">Recommendations</div><ul>${report.recommendations.map((s: string) => `<li>${s}</li>`).join('')}</ul>` : ''}
${report.encouragement ? `<blockquote style="border-left:4px solid #BAA467;padding-left:16px;font-style:italic">"${report.encouragement}"</blockquote>` : ''}
<div class="footer">Generated by Aivorah AI</div></body></html>`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const win = window.open('', '_blank');
      if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 500); }
    }
  }

  const parentEmail = user?.email || 'parent@demo.com';
  const lastChildIdRef = useRef<string | undefined>(undefined);

  const loadChildren = useCallback((targetChildId?: string) => {
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          const mapped: ChildData[] = data.map(c => ({
            id: c.id, name: c.name, grade: c.grade,
            curriculum: c.curriculum ?? '', totalTopics: c.totalTopics ?? 0,
            school: c.school ?? '',
            status: (() => {
              const hasActivity = (c.xpPoints ?? 0) > 0 || (c.studyTimeMinutes ?? 0) > 0 || (c.completedTopics?.length ?? 0) > 0;
              if (!hasActivity) return 'getting_started';
              return (c.currentStreak ?? 0) >= 1 ? 'on_track' : 'needs_attention';
            })(),
            xpPoints: c.xpPoints ?? 0,
            completedTopics: c.completedTopics ?? [],
            currentStreak: c.currentStreak ?? 0,
            studyTimeMinutes: c.studyTimeMinutes ?? 0,
            assignmentsDone: c.assignmentsDone ?? 0,
            lastLesson: c.lastLesson || '',
          }));
          setChildren(mapped);
          const id = targetChildId ?? route.params?.childId;
          const found = id ? mapped.find(c => c.id === id) : null;
          setSelectedChild(found || mapped[0]);
        }
      })
      .catch(() => {})
      .finally(() => setChildrenLoading(false));
  }, [parentEmail, route.params?.childId]);

  useEffect(() => {
    const incoming = route.params?.childId;
    if (incoming !== lastChildIdRef.current) {
      lastChildIdRef.current = incoming;
      loadChildren(incoming);
    }
  }, [route.params?.childId, loadChildren]);

  useEffect(() => { loadChildren(); }, [parentEmail]); // eslint-disable-line

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => { if (interval) { clearInterval(interval); interval = null; } };
    const refresh = () => {
      fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
        .then(r => r.json())
        .then(data => {
          if (!Array.isArray(data) || data.length === 0) return;
          const mapped: ChildData[] = data.map(c => ({
            id: c.id, name: c.name, grade: c.grade,
            curriculum: c.curriculum ?? '', totalTopics: c.totalTopics ?? 0, school: c.school ?? '',
            status: (() => { const h = (c.xpPoints ?? 0) > 0 || (c.studyTimeMinutes ?? 0) > 0 || (c.completedTopics?.length ?? 0) > 0; if (!h) return 'getting_started'; return (c.currentStreak ?? 0) >= 1 ? 'on_track' : 'needs_attention'; })(),
            xpPoints: c.xpPoints ?? 0, completedTopics: c.completedTopics ?? [],
            currentStreak: c.currentStreak ?? 0, studyTimeMinutes: c.studyTimeMinutes ?? 0, assignmentsDone: c.assignmentsDone ?? 0, lastLesson: c.lastLesson || '',
          }));
          setChildren(mapped);
          setSelectedChild(prev => mapped.find(ch => ch.id === prev.id) ?? mapped[0]);
        }).catch(() => {});
    };
    const unsubFocus = navigation.addListener('focus', () => { refresh(); interval = setInterval(refresh, 30000); });
    const unsubBlur = navigation.addListener('blur', stopPolling);
    interval = setInterval(refresh, 30000);
    return () => { stopPolling(); unsubFocus(); unsubBlur(); };
  }, [navigation, parentEmail, selectedChild.id]);

  useEffect(() => {
    if (!selectedChild.id) return;
    setWeeklyActivity([0, 0, 0, 0, 0, 0, 0]);
    fetch(`${SERVER_URL}/student/${selectedChild.id}/weekly`)
      .then(r => r.json())
      .then(data => {
        if (data?.days) {
          const m: Record<string, number> = {};
          (data.days as { day: string; studyMinutes: number }[]).forEach(d => { m[d.day] = d.studyMinutes; });
          setWeeklyActivity(WEEK_DAYS_ORDER.map(d => m[d] ?? 0));
        }
      }).catch(() => {});
    fetch(`${SERVER_URL}/assignments?studentId=${selectedChild.id}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAssignments(data.slice(0, 4)); })
      .catch(() => {});
    setSubjectPerf([]);
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children/${selectedChild.id}/ai-report`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.subjectPerformance) setSubjectPerf(data.subjectPerformance); })
      .catch(() => {});
  }, [selectedChild.id]);

  const child = selectedChild;
  const weeklyStudyH = formatStudyTime(child.studyTimeMinutes);
  const tasksDone = child.completedTopics.length;
  const tasksTotal = child.totalTopics && child.totalTopics > 0 ? child.totalTopics : null;
  const activityMax = Math.max(...weeklyActivity, 120);
  const parentName = user?.name?.split(' ')[0] ?? 'Parent';

  // Derived AI insight data
  const weeklyProgressPct = Math.min(100, Math.round((child.studyTimeMinutes / (7 * 120)) * 100));
  const insightTopic = child.lastLesson || (child.completedTopics[child.completedTopics.length - 1]) || 'Learning Basics';

  // Badges
  const badges = [
    child.currentStreak >= 5 && { icon: 'zap', label: '5 Day Streak', color: colors.accentYellow },
    child.completedTopics.length >= 3 && { icon: 'award', label: 'Fast Learner', color: colors.accentYellow },
    child.assignmentsDone >= 1 && { icon: 'book-open', label: 'Reading Star', color: colors.accentYellow },
    child.xpPoints >= 1000 && { icon: 'star', label: '1000 XP', color: colors.accentYellow },
  ].filter(Boolean) as { icon: string; label: string; color: string }[];

  // Upcoming events from assignments
  const upcomingEvents = assignments.filter(a => a.status === 'pending').slice(0, 2);

  return (
    <ScreenLayout>
      <View style={s.screen}>
        <Header
          title={`Welcome, ${parentName}`}
          subtitle="Track your children's learning journey"
          onMenuPress={() => navigation.openDrawer()}
          notificationCount={totalNotifs}
          onNotificationPress={() => navigation.navigate('ParentMessages')}
        />

        <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* ── Alert banner ── */}
          {(unreadAssignments > 0 || unreadCount > 0) && (
            <TouchableOpacity
              style={s.alertBanner}
              onPress={() => unreadAssignments > 0 ? navigation.navigate('ParentAssignments') : navigation.navigate('ParentMessages')}
              activeOpacity={0.8}
            >
              <Feather name={unreadAssignments > 0 ? 'check-square' : 'message-square'} size={14} color={colors.accentYellow} />
              <Text style={s.alertBannerText}>
                {unreadAssignments > 0
                  ? `${unreadAssignments} new assignment${unreadAssignments > 1 ? 's' : ''} for your child`
                  : `${unreadCount} new message${unreadCount > 1 ? 's' : ''}`}
              </Text>
              <Feather name="chevron-right" size={13} color={colors.accentYellow} />
            </TouchableOpacity>
          )}

          {/* ── Row 1: Child cards + AI Insight ── */}
          <View style={[s.topRow, isWide && { flexDirection: 'row', gap: 16, alignItems: 'stretch' }]}>

            {/* Child cards */}
            <View style={[s.childSection, isWide && { flex: 1 }]}>
              <Text style={s.sectionTitle}>My Children</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.childScroll}>
                {childrenLoading ? (
                  <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40, marginLeft: 8 }} />
                ) : children.length === 0 ? (
                  <TouchableOpacity style={s.addChildBtn} onPress={() => navigation.navigate('ParentMyKids')} activeOpacity={0.7}>
                    <Feather name="plus" size={20} color={colors.textDim} />
                    <Text style={s.addChildText}>Add Child</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    {children.map(ch => (
                      <ChildCard
                        key={ch.id} child={ch}
                        isSelected={selectedChild.id === ch.id}
                        onPress={() => setSelectedChild(ch)}
                        onViewCreds={fetchCreds}
                        colors={colors} s={s}
                      />
                    ))}
                    <TouchableOpacity style={s.addChildBtn} onPress={() => navigation.navigate('ParentMyKids')} activeOpacity={0.7}>
                      <Feather name="plus" size={20} color={colors.textDim} />
                      <Text style={s.addChildText}>Add Child</Text>
                    </TouchableOpacity>
                  </>
                )}
              </ScrollView>

              {/* ── Child interest insights ── */}
              {child.id ? (() => {
                const mins = child.studyTimeMinutes ?? 0;
                const streak = child.currentStreak ?? 0;
                const topics = child.completedTopics ?? [];
                const lastLesson = child.lastLesson || '';

                // Derive subject interest from completedTopics or lastLesson
                const subjectCounts: Record<string, number> = {};
                topics.forEach((t: string) => {
                  const sub = t.split('|')[0] || t;
                  subjectCounts[sub] = (subjectCounts[sub] || 0) + 1;
                });
                const topSubject = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
                  || (lastLesson ? lastLesson.split('·')[0]?.trim() : null)
                  || 'Learning';

                const learnerType = streak >= 5 ? 'Consistent Learner' : mins >= 120 ? 'Deep Explorer' : child.assignmentsDone >= 3 ? 'Assignment Star' : 'Getting Started';
                const learnerIcon: any = streak >= 5 ? 'award' : mins >= 120 ? 'compass' : child.assignmentsDone >= 3 ? 'check-circle' : 'sunrise';

                const studyHint = mins >= 60
                  ? `${Math.round(mins / 60)}h logged this month`
                  : mins > 0 ? `${mins}m logged so far` : 'No sessions yet';

                return (
                  <View style={s.insightChipsCol}>
                    <View style={s.insightChip}>
                      <View style={s.insightChipIcon}><Feather name="book-open" size={13} color={colors.accentYellow} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.insightChipTitle}>Top Interest</Text>
                        <Text style={s.insightChipBody}>{topSubject}</Text>
                      </View>
                    </View>
                    <View style={s.insightChip}>
                      <View style={s.insightChipIcon}><Feather name={learnerIcon} size={13} color={colors.accentYellow} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.insightChipTitle}>Learning Style</Text>
                        <Text style={s.insightChipBody}>{learnerType}</Text>
                      </View>
                    </View>
                    <View style={s.insightChip}>
                      <View style={s.insightChipIcon}><Feather name="clock" size={13} color={colors.accentYellow} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.insightChipTitle}>Study Time</Text>
                        <Text style={s.insightChipBody}>{studyHint}</Text>
                      </View>
                    </View>
                  </View>
                );
              })() : null}
            </View>

            {/* AI Weekly Insight */}
            {child.id ? (
              <View style={[s.insightCard, isWide && { flex: 1 }]}>
                {/* Header */}
                <View style={s.insightHeader}>
                  <View style={s.insightPill}>
                    <Feather name="zap" size={11} color={colors.accentYellow} />
                    <Text style={s.insightPillText}>AI Weekly Insight</Text>
                  </View>
                </View>

                {/* Body row */}
                <View style={s.insightBody}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.insightHeadline}>
                      <Text style={{ color: colors.textMain }}>{child.name} is progressing well in </Text>
                      <Text style={{ color: colors.accentYellow, fontWeight: '700' }}>{insightTopic}</Text>
                      <Text style={{ color: colors.textMain }}>.</Text>
                    </Text>

                    <View style={s.insightBullets}>
                      <View style={s.insightBulletRow}>
                        <Feather name="check-circle" size={13} color={colors.accentYellow} />
                        <Text style={s.insightBulletText}>Learning consistency
                          <Text style={{ color: colors.accentYellow }}>{child.currentStreak > 0 ? `  +${Math.min(child.currentStreak * 6, 32)}% this week` : ''}</Text>
                        </Text>
                      </View>
                      <View style={s.insightBulletRow}>
                        <Feather name="check-circle" size={13} color={colors.accentYellow} />
                        <Text style={s.insightBulletText}>
                          {child.assignmentsDone > 0 ? 'Assignments completed on time' : 'Exploring learning paths'}
                        </Text>
                      </View>
                      <View style={s.insightBulletRow}>
                        <Feather name="alert-triangle" size={13} color={colors.accentYellow} />
                        <Text style={s.insightBulletText}>Needs more practice sessions</Text>
                      </View>
                    </View>

                    <View style={s.insightRec}>
                      <Text style={s.insightRecLabel}>Today's Recommendation</Text>
                      <View style={s.insightRecRow}>
                        <Feather name="book-open" size={14} color={colors.textMuted} />
                        <Text style={s.insightRecText}>
                          Spend 15 minutes on{'\n'}
                          <Text style={{ color: colors.textMain, fontWeight: '600' }}>"{insightTopic}"</Text>
                        </Text>
                      </View>
                    </View>
                  </View>

                  <CircleProgress pct={weeklyProgressPct} colors={colors} />
                </View>

                {/* CTA */}
                <TouchableOpacity style={s.insightCta} onPress={() => navigation.navigate('ParentAIReports', { childId: selectedChild.id })} activeOpacity={0.85}>
                  <Text style={s.insightCtaText}>View Detailed Report</Text>
                  <Feather name="arrow-right" size={13} color={colors.accentYellow} />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          {/* ── Row 2: Weekly Snapshot ── */}
          {child.id ? (
            <>
              <Text style={[s.sectionTitle, { marginTop: 22, marginBottom: 12 }]}>{child.name}'s Weekly Snapshot</Text>
              <View style={s.statsRow}>
                {/* Learning Journey */}
                <View style={s.statCard}>
                  <View style={[s.statIconWrap, { backgroundColor: colors.accentYellow + '18' }]}>
                    <Feather name="clock" size={16} color={colors.accentYellow} />
                  </View>
                  <View style={s.statInfo}>
                    <Text style={s.statLabel}>Learning Journey</Text>
                    <Text style={s.statValue}>{weeklyStudyH}</Text>
                    {child.currentStreak > 0 && (
                      <Text style={s.statSub}>↑ {child.currentStreak * 2}% this week</Text>
                    )}
                  </View>
                </View>

                {/* Mission Progress */}
                <View style={s.statCard}>
                  <View style={[s.statIconWrap, { backgroundColor: colors.accentYellow + '18' }]}>
                    <Feather name="layers" size={16} color={colors.accentYellow} />
                  </View>
                  <View style={s.statInfo}>
                    <Text style={s.statLabel}>Mission Progress</Text>
                    <Text style={s.statValue}>{tasksDone}{tasksTotal ? ` / ${tasksTotal}` : ' topics'}</Text>
                    {tasksTotal ? (
                      <>
                        <View style={s.progressBarTrack}>
                          <View style={[s.progressBarFill, { width: `${Math.min(100, Math.round((tasksDone / tasksTotal) * 100))}%` as any }]} />
                        </View>
                        <Text style={s.statSub}>{Math.min(100, Math.round((tasksDone / tasksTotal) * 100))}% Completed</Text>
                      </>
                    ) : (
                      <Text style={s.statSub}>Topics explored</Text>
                    )}
                  </View>
                </View>

                {/* Growth Points */}
                <View style={s.statCard}>
                  <View style={[s.statIconWrap, { backgroundColor: colors.accentYellow + '18' }]}>
                    <Feather name="star" size={16} color={colors.accentYellow} />
                  </View>
                  <View style={s.statInfo}>
                    <Text style={s.statLabel}>Growth Points</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                      <Text style={s.statValue}>{child.xpPoints.toLocaleString()}</Text>
                      <Text style={s.statXP}>XP</Text>
                    </View>
                    {child.xpPoints > 0 && (
                      <Text style={s.statSub}>↑ {Math.min(child.xpPoints, 150)} this week</Text>
                    )}
                  </View>
                </View>
              </View>

              {/* ── Row 3: Activity Overview ── */}
              <View style={[s.sectionHeader, { marginTop: 22 }]}>
                <Text style={s.sectionTitle}>Activity Overview</Text>
                <Text style={s.dailyGoal}>Daily goal: <Text style={{ color: colors.accentYellow, fontWeight: '700' }}>2h</Text></Text>
              </View>

              <View style={s.chartCard}>
                {/* Goal line */}
                <View style={s.goalLineRow}>
                  <View style={s.goalLineDash} />
                  <View style={s.goalBadge}><Text style={s.goalBadgeText}>2h</Text></View>
                </View>

                <View style={s.barsRow}>
                  {WEEK_DAYS.map((day, i) => {
                    const mins = weeklyActivity[i];
                    const isGoalMet = mins >= 120;
                    return (
                      <View key={day} style={s.barColumn}>
                        <Text style={s.barTimeLabel}>{mins > 0 ? formatStudyTime(mins) : ''}</Text>
                        <StackedBar minutes={mins} maxMinutes={activityMax} isGoalMet={isGoalMet} colors={colors} />
                        <Text style={s.barDayLabel}>{day}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* ── Row 4: 4-panel grid ── */}
              <View style={[s.bottomGrid, isWide && { flexDirection: 'row' }]}>

                {/* Learning Highlights */}
                <View style={[s.gridCard, isWide && { flex: 1 }]}>
                  <Text style={s.cardTitle}>Learning Highlights</Text>
                  <View style={{ gap: 10, marginTop: 8 }}>
                    {child.xpPoints > 0 && (
                      <View style={s.highlightRow}>
                        <View style={[s.highlightIcon, { backgroundColor: colors.accentYellow + '20' }]}>
                          <Feather name="award" size={14} color={colors.accentYellow} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.highlightTitle, { color: colors.accentYellow }]}>New Personal Best</Text>
                          <Text style={s.highlightDesc}>XP points: {child.xpPoints.toLocaleString()}</Text>
                        </View>
                      </View>
                    )}
                    {child.currentStreak >= 1 && (
                      <View style={s.highlightRow}>
                        <View style={[s.highlightIcon, { backgroundColor: colors.accentYellow + '20' }]}>
                          <Feather name="zap" size={14} color={colors.accentYellow} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.highlightTitle, { color: colors.textMain }]}>{child.currentStreak}-Day Streak</Text>
                          <Text style={s.highlightDesc}>Consistent daily learning</Text>
                        </View>
                      </View>
                    )}
                    {child.assignmentsDone > 0 && (
                      <View style={s.highlightRow}>
                        <View style={[s.highlightIcon, { backgroundColor: colors.primary + '20' }]}>
                          <Feather name="check-circle" size={14} color={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.highlightTitle, { color: colors.primary }]}>AI Recommendation</Text>
                          <Text style={s.highlightDesc}>Practice and revise topics tomorrow.</Text>
                        </View>
                      </View>
                    )}
                  </View>
                  <TouchableOpacity style={s.cardFooterBtn} onPress={() => navigation.navigate('ParentProgress')} activeOpacity={0.8}>
                    <Text style={s.cardFooterText}>View All Highlights</Text>
                    <Feather name="arrow-right" size={13} color={colors.accentYellow} />
                  </TouchableOpacity>
                </View>

                {/* Subject Performance */}
                <View style={[s.gridCard, isWide && { flex: 1 }]}>
                  <Text style={s.cardTitle}>Subject Performance</Text>
                  <View style={{ gap: 12, marginTop: 8 }}>
                    {subjectPerf.length === 0 ? (
                      <Text style={[s.highlightDesc, { textAlign: 'center', paddingVertical: 12 }]}>
                        No quiz data yet
                      </Text>
                    ) : subjectPerf.map(sub => (
                      <View key={sub.subject} style={s.subjectRow}>
                        <View style={s.subjectInfo}>
                          <Text style={s.subjectName}>{sub.subject}</Text>
                          <Text style={s.subjectPct}>{Math.round(sub.avgScore)}%</Text>
                        </View>
                        <View style={s.subjectTrack}>
                          <View style={[s.subjectFill, { width: `${Math.round(sub.avgScore)}%` as any, backgroundColor: colors.accentYellow }]} />
                        </View>
                      </View>
                    ))}
                  </View>
                  <TouchableOpacity style={s.cardFooterBtn} onPress={() => navigation.navigate('ParentAIReports', { childId: selectedChild.id })} activeOpacity={0.8}>
                    <Text style={s.cardFooterText}>View Detailed Report</Text>
                    <Feather name="arrow-right" size={13} color={colors.accentYellow} />
                  </TouchableOpacity>
                </View>

                {/* Learning Mood */}
                <View style={[s.gridCard, isWide && { flex: 1 }]}>
                  <Text style={s.cardTitle}>Learning Mood</Text>
                  <View style={s.moodCenter}>
                    <View style={s.moodCircle}>
                      <Feather name="smile" size={32} color={colors.accentYellow} />
                    </View>
                    <Text style={s.moodLabel}>
                      {child.currentStreak >= 3 ? 'Focused' : child.studyTimeMinutes > 60 ? 'Active' : 'Warming Up'}
                    </Text>
                    <Text style={s.moodSub}>
                      {child.currentStreak >= 3
                        ? `${child.currentStreak}-day streak going strong`
                        : child.studyTimeMinutes > 0
                        ? `${formatStudyTime(child.studyTimeMinutes)} total study time`
                        : 'Just getting started'}
                    </Text>
                  </View>
                  <View style={{ gap: 8, marginTop: 8 }}>
                    {child.currentStreak >= 1 && (
                      <View style={s.moodRow}>
                        <Feather name="zap" size={12} color={colors.accentYellow} />
                        <Text style={s.moodText}>{child.currentStreak} day{child.currentStreak > 1 ? 's' : ''} in a row</Text>
                      </View>
                    )}
                    {child.assignmentsDone > 0 && (
                      <View style={s.moodRow}>
                        <Feather name="check-circle" size={12} color={colors.primary} />
                        <Text style={s.moodText}>{child.assignmentsDone} assignment{child.assignmentsDone > 1 ? 's' : ''} completed</Text>
                      </View>
                    )}
                    {child.completedTopics.length > 0 && (
                      <View style={s.moodRow}>
                        <Feather name="book-open" size={12} color={colors.primary} />
                        <Text style={s.moodText}>{child.completedTopics.length} topic{child.completedTopics.length > 1 ? 's' : ''} explored</Text>
                      </View>
                    )}
                    {child.currentStreak === 0 && child.assignmentsDone === 0 && child.completedTopics.length === 0 && (
                      <View style={s.moodRow}>
                        <Feather name="info" size={12} color={colors.textDim} />
                        <Text style={s.moodText}>No activity logged yet</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Achievements */}
                <View style={[s.gridCard, isWide && { flex: 1 }]}>
                  <Text style={s.cardTitle}>Achievements</Text>
                  {badges.length > 0 ? (
                    <View style={s.badgeGrid}>
                      {badges.slice(0, 3).map((b, i) => (
                        <View key={i} style={s.badgeItem}>
                          <View style={s.badgeIconWrap}>
                            <Feather name={b.icon as any} size={20} color={colors.accentYellow} />
                          </View>
                          <Text style={s.badgeLabel}>{b.label}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View style={s.badgeGrid}>
                      {[
                        { icon: 'zap', label: '5 Day\nStreak' },
                        { icon: 'award', label: 'Fast\nLearner' },
                        { icon: 'book-open', label: 'Reading\nStar' },
                      ].map((b, i) => (
                        <View key={i} style={[s.badgeItem, { opacity: 0.35 }]}>
                          <View style={s.badgeIconWrap}>
                            <Feather name={b.icon as any} size={20} color={colors.accentYellow} />
                          </View>
                          <Text style={s.badgeLabel}>{b.label}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <TouchableOpacity style={s.cardFooterBtn} onPress={() => navigation.navigate('ParentProgress')} activeOpacity={0.8}>
                    <Text style={s.cardFooterText}>View All Badges</Text>
                    <Feather name="arrow-right" size={13} color={colors.accentYellow} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* ── Row 5: Upcoming Events ── */}
              {upcomingEvents.length > 0 && (
                <View style={s.eventsCard}>
                  <Text style={s.eventsLabel}>Upcoming{'\n'}Events</Text>
                  <View style={s.eventsList}>
                    {upcomingEvents.map(ev => (
                      <View key={ev.id} style={s.eventItem}>
                        <View style={s.eventIconWrap}>
                          <Feather name="calendar" size={16} color={colors.accentYellow} />
                        </View>
                        <View>
                          <Text style={s.eventDate}>{formatEventDate(ev.dueDate)}</Text>
                          <Text style={s.eventTitle}>{ev.title}</Text>
                          <Text style={s.eventTime}>{ev.subject}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                  <TouchableOpacity style={s.eventsViewAll} onPress={() => navigation.navigate('ParentAssignments')} activeOpacity={0.8}>
                    <Text style={s.cardFooterText}>View Calendar</Text>
                    <Feather name="arrow-right" size={13} color={colors.accentYellow} />
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : null}

        </ScrollView>
      </View>

      {/* ── AI Report Modal ── */}
      <Modal visible={reportModalVisible} transparent animationType="slide" onRequestClose={() => setReportModalVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { maxHeight: '90%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentYellow + '20', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="file-text" size={16} color={colors.accentYellow} />
                </View>
                <View>
                  <Text style={s.modalTitle}>AI Performance Report</Text>
                  <Text style={s.modalDesc}>{selectedChild.name}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setReportModalVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {loadingReport ? (
              <View style={{ alignItems: 'center', paddingVertical: 40, gap: 12 }}>
                <ActivityIndicator color={colors.accentYellow} size="large" />
                <Text style={[s.modalDesc, { textAlign: 'center' }]}>Analyzing {selectedChild.name}'s learning data...</Text>
              </View>
            ) : !reportData ? (
              <View style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
                <Feather name="alert-circle" size={28} color={colors.accentRed} />
                <Text style={[s.modalDesc, { textAlign: 'center' }]}>Could not generate report. Please try again.</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  {[
                    { label: 'XP', value: reportData.metrics.xp.toLocaleString() },
                    { label: 'Level', value: String(reportData.metrics.level) },
                    { label: 'Streak', value: `${reportData.metrics.currentStreak}d` },
                    { label: 'Topics', value: String(reportData.metrics.topicsCompleted) },
                    { label: 'Assignments', value: String(reportData.metrics.assignmentsDone) },
                    { label: 'Active Days', value: `${reportData.metrics.activeDaysThisWeek}/7` },
                  ].map(m => (
                    <View key={m.label} style={{ backgroundColor: colors.bgDark, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', minWidth: 70, borderWidth: 1, borderColor: colors.borderColor }}>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.accentYellow }}>{m.value}</Text>
                      <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>{m.label}</Text>
                    </View>
                  ))}
                </View>
                {reportData.report.summary ? <View style={s.reportSection}><Text style={s.reportSectionTitle}>Overview</Text><Text style={s.reportBody}>{reportData.report.summary}</Text></View> : null}
                {(reportData.report.strengths || []).length > 0 ? (
                  <View style={s.reportSection}>
                    <Text style={s.reportSectionTitle}>Strengths</Text>
                    {reportData.report.strengths.map((str: string, i: number) => (
                      <View key={i} style={s.reportListItem}><Feather name="check-circle" size={13} color={colors.accentYellow} style={{ marginTop: 2 }} /><Text style={[s.reportBody, { flex: 1 }]}>{str}</Text></View>
                    ))}
                  </View>
                ) : null}
                {(reportData.report.areas_for_improvement || []).length > 0 ? (
                  <View style={s.reportSection}>
                    <Text style={s.reportSectionTitle}>Areas for Improvement</Text>
                    {reportData.report.areas_for_improvement.map((str: string, i: number) => (
                      <View key={i} style={s.reportListItem}><Feather name="arrow-up-circle" size={13} color={colors.accentYellow} style={{ marginTop: 2 }} /><Text style={[s.reportBody, { flex: 1 }]}>{str}</Text></View>
                    ))}
                  </View>
                ) : null}
                {(reportData.report.recommendations || []).length > 0 ? (
                  <View style={s.reportSection}>
                    <Text style={s.reportSectionTitle}>Recommendations</Text>
                    {reportData.report.recommendations.map((str: string, i: number) => (
                      <View key={i} style={s.reportListItem}><Feather name="star" size={13} color={colors.primary} style={{ marginTop: 2 }} /><Text style={[s.reportBody, { flex: 1 }]}>{str}</Text></View>
                    ))}
                  </View>
                ) : null}
                {reportData.report.encouragement ? (
                  <View style={[s.reportSection, { backgroundColor: colors.accentYellow + '10', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.accentYellow + '30' }]}>
                    <Text style={[s.reportSectionTitle, { color: colors.accentYellow }]}>Share with {selectedChild.name}</Text>
                    <Text style={[s.reportBody, { fontStyle: 'italic' }]}>"{reportData.report.encouragement}"</Text>
                  </View>
                ) : null}
                <View style={{ height: 8 }} />
              </ScrollView>
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <TouchableOpacity style={{ flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', borderWidth: 1, borderColor: colors.borderColor }} onPress={() => setReportModalVisible(false)} activeOpacity={0.8}>
                <Text style={{ color: colors.textMuted, fontWeight: '600', fontSize: 14 }}>Close</Text>
              </TouchableOpacity>
              {reportData && Platform.OS === 'web' ? (
                <TouchableOpacity style={{ flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', backgroundColor: colors.accentYellow, flexDirection: 'row', justifyContent: 'center', gap: 8 }} onPress={downloadReportPDF} activeOpacity={0.85}>
                  <Feather name="download" size={15} color="#0B0B0B" />
                  <Text style={{ color: '#0B0B0B', fontWeight: '700', fontSize: 14 }}>Download PDF</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Credentials Modal ── */}
      <Modal visible={!!credsChild} transparent animationType="fade" onRequestClose={() => { setCredsChild(null); setCreds(null); }}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentYellow + '20', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="key" size={16} color={colors.accentYellow} />
                </View>
                <View>
                  <Text style={s.modalTitle}>Login Info</Text>
                  <Text style={s.modalDesc}>{credsChild?.name}'s credentials</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => { setCredsChild(null); setCreds(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {loadingCreds ? (
              <ActivityIndicator color={colors.accentYellow} style={{ paddingVertical: 24 }} />
            ) : (
              <View style={{ backgroundColor: colors.bgDark, borderRadius: 12, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.borderColor }}>
                <Text style={[s.modalDesc, { textAlign: 'center' }]}>Your child uses these to log in as a Student.</Text>
                {[
                  creds?.studentId    ? { label: 'Student ID',       value: creds.studentId,        field: 'dstu'   } : null,
                  creds?.loginId      ? { label: 'Login ID (Email)', value: creds.loginId,           field: 'dlogin' } : null,
                  creds?.initialPassword ? { label: 'Password',      value: creds.initialPassword,  field: 'dpass'  } : null,
                ].filter(Boolean).map(({ label, value, field }: any) => (
                  <View key={field} style={{ gap: 4 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: copiedField === field ? colors.accentYellow : colors.borderColor, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, gap: 8, backgroundColor: colors.cardDark }}
                      onPress={() => copyToClipboard(value, field)} activeOpacity={0.7}
                    >
                      <Text style={{ flex: 1, color: colors.textMain, fontSize: 13, fontFamily: 'monospace' }} selectable>{value}</Text>
                      <Feather name={copiedField === field ? 'check' : 'copy'} size={14} color={copiedField === field ? colors.accentYellow : colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))}
                {!creds?.initialPassword && (
                  <View style={{ backgroundColor: '#ef444415', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#ef444430' }}>
                    <Text style={{ fontSize: 12, color: '#ef4444', textAlign: 'center', lineHeight: 18 }}>
                      Password not saved for this account.{'\n'}
                      {creds?.loginId?.includes('@aivorah.')
                        ? 'Remove and re-add this child to generate fresh credentials.'
                        : 'Your child can use "Forgot Password" on the login screen.'}
                    </Text>
                  </View>
                )}
              </View>
            )}
            <TouchableOpacity
              style={{ backgroundColor: colors.accentYellow, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 4 }}
              onPress={() => { setCredsChild(null); setCreds(null); }} activeOpacity={0.8}
            >
              <Text style={{ color: '#0B0B0B', fontWeight: '700', fontSize: 15 }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

// ── Styles ───────────────────────────────────────────────────

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 48 },

  // Alert banner
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.accentYellow + '40',
    backgroundColor: c.accentYellow + '0C', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 20,
  },
  alertBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: c.accentYellow },

  // Section titles
  sectionTitle: { fontSize: 17, fontWeight: '700', color: c.textMain, fontFamily: fonts.serif },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  dailyGoal: { fontSize: 12, color: c.textMuted },

  // Top row
  topRow: { gap: 16, marginBottom: 4 },
  childSection: { alignSelf: 'flex-start' },
  childScroll: { marginTop: 12 },

  insightChipsCol: { marginTop: 14, gap: 8 },
  insightChip: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: c.borderColor, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: c.cardDark },
  insightChipIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: c.accentYellow + '18', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  insightChipTitle: { fontSize: 10, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  insightChipBody: { fontSize: 13, fontWeight: '700', color: c.textMain, marginTop: 1 },

  // Upcoming Events bar
  eventsBar: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: c.borderColor, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, backgroundColor: c.cardDark, marginTop: 14 },
  eventsBarTitle: { fontSize: 13, fontWeight: '800', color: c.textMain, minWidth: 72 },
  eventsList: { flex: 1, flexDirection: 'row', gap: 16 },
  eventItem: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  eventIconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: c.accentYellow + '18', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  eventDate: { fontSize: 11, fontWeight: '700', color: c.accentYellow, marginBottom: 2 },
  eventName: { fontSize: 13, fontWeight: '700', color: c.textMain },
  eventSub: { fontSize: 11, color: c.textMuted, marginTop: 1 },
  eventsViewAll: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  eventsViewAllText: { fontSize: 12, fontWeight: '700', color: c.accentYellow },

  // Child cards
  childCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: 16, padding: 14, alignItems: 'center', gap: 5,
    marginRight: 12, minWidth: 110, position: 'relative',
  },
  childKeyBtn: {
    position: 'absolute', top: 8, right: 8,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: c.borderColor, alignItems: 'center', justifyContent: 'center',
  },
  childAvatar: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  childAvatarText: { fontSize: 22, fontWeight: '700' },
  childName: { fontSize: 13, fontWeight: '700', color: c.textMain },
  childGrade: { fontSize: 11, color: c.textMuted },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '600' },
  addChildBtn: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: 16, padding: 16, alignItems: 'center', justifyContent: 'center',
    gap: 8, minWidth: 80, borderStyle: 'dashed',
  },
  addChildText: { fontSize: 11, color: c.textMuted },

  // AI Weekly Insight card
  insightCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.accentYellow + '30',
    borderRadius: 16, padding: 16, gap: 10, marginTop: 0,
    justifyContent: 'space-between',
  },
  insightHeader: { flexDirection: 'row', alignItems: 'center' },
  insightPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.accentYellow + '15', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: c.accentYellow + '40',
  },
  insightPillText: { fontSize: 12, fontWeight: '700', color: c.accentYellow, letterSpacing: 0.5 },
  insightBody: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  insightHeadline: { fontSize: 15, fontWeight: '600', color: c.textMain, lineHeight: 22, marginBottom: 10, fontFamily: fonts.serif },
  insightBullets: { gap: 7 },
  insightBulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  insightBulletText: { fontSize: 12, color: c.textMuted, flex: 1, lineHeight: 18 },
  insightRec: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.borderColor },
  insightRecLabel: { fontSize: 11, fontWeight: '700', color: c.accentYellow, marginBottom: 6 },
  insightRecRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  insightRecText: { fontSize: 12, color: c.textMuted, lineHeight: 18 },
  insightCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: c.accentYellow + '60', borderRadius: 10,
    paddingVertical: 10, backgroundColor: c.accentYellow + '08',
  },
  insightCtaText: { fontSize: 13, fontWeight: '600', color: c.accentYellow },

  // Stat cards — horizontal layout: icon left, content right
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  statIconWrap: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  statInfo: { flex: 1, gap: 2 },
  statLabel: { fontSize: 11, color: c.textMuted, letterSpacing: 0.2 },
  statValue: { fontSize: 20, fontWeight: '800', fontFamily: fonts.serif, color: c.textMain, letterSpacing: -0.5 },
  statXP: { fontSize: 13, fontWeight: '700', fontFamily: fonts.serif, color: c.accentYellow },
  statSub: { fontSize: 11, color: c.accentYellow, marginTop: 1 },
  progressBarTrack: { height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, marginTop: 5, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: c.accentYellow, borderRadius: 2 },

  // Activity chart
  chartCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: 16, padding: 16, position: 'relative', overflow: 'hidden',
  },
  goalLineRow: {
    position: 'absolute', left: 16, right: 16, top: '38%',
    flexDirection: 'row', alignItems: 'center',
  },
  goalLineDash: { flex: 1, height: 1, borderTopWidth: 1, borderTopColor: c.accentYellow + '35', borderStyle: 'dashed' },
  goalBadge: { backgroundColor: c.accentYellow + '20', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: c.accentYellow + '40', marginLeft: 5 },
  goalBadgeText: { fontSize: 9, fontWeight: '700', color: c.accentYellow },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 120, paddingTop: 16 },
  barColumn: { flex: 1, alignItems: 'center', gap: 4 },
  barTimeLabel: { fontSize: 8, color: c.textDim, textAlign: 'center' },
  barDayLabel: { fontSize: 9, color: c.textMuted, marginTop: 3 },

  // Bottom grid
  bottomGrid: { gap: 10, marginTop: 22, flexDirection: 'column' },
  gridCard: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: 14, padding: 14, gap: 4,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: c.textMain, fontFamily: fonts.serif },
  cardFooterBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  cardFooterText: { fontSize: 11, fontWeight: '600', color: c.accentYellow },

  // Highlights
  highlightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  highlightIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  highlightTitle: { fontSize: 12, fontWeight: '700' },
  highlightDesc: { fontSize: 11, color: c.textMuted, marginTop: 2 },

  // Subject performance
  subjectRow: { gap: 6 },
  subjectInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subjectName: { fontSize: 13, color: c.textMain, fontWeight: '500' },
  subjectPct: { fontSize: 12, fontWeight: '700', color: c.textMain },
  subjectTrack: { height: 5, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' },
  subjectFill: { height: '100%', borderRadius: 3 },

  // Learning mood
  moodCenter: { alignItems: 'center', paddingVertical: 10 },
  moodCircle: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 2, borderColor: c.accentYellow + '40',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.accentYellow + '10', marginBottom: 8,
  },
  moodLabel: { fontSize: 20, fontWeight: '700', color: c.accentYellow, fontFamily: fonts.serif },
  moodSub: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  moodRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moodDot: { width: 8, height: 8, borderRadius: 4 },
  moodText: { fontSize: 12, color: c.textMuted },

  // Achievements / Badges
  badgeGrid: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  badgeItem: { alignItems: 'center', gap: 6, flex: 1, minWidth: 60 },
  badgeIconWrap: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: c.accentYellow + '18', borderWidth: 1, borderColor: c.accentYellow + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  badgeLabel: { fontSize: 10, fontWeight: '600', color: c.textMuted, textAlign: 'center' },

  // Upcoming Events
  eventsCard: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: 16, padding: 18, marginTop: 12,
  },
  eventsLabel: { fontSize: 13, fontWeight: '700', color: c.textMain, fontFamily: fonts.serif, minWidth: 80 },
  eventsList: { flex: 1, flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  eventItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 140 },
  eventIconWrap: {
    width: 34, height: 34, borderRadius: 8,
    backgroundColor: c.accentYellow + '18', alignItems: 'center', justifyContent: 'center',
  },
  eventDate: { fontSize: 11, color: c.accentYellow, fontWeight: '700' },
  eventTitle: { fontSize: 13, fontWeight: '600', color: c.textMain, marginTop: 1 },
  eventTime: { fontSize: 11, color: c.textMuted, marginTop: 1 },
  eventsViewAll: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalBox: { width: '100%', maxWidth: 420, backgroundColor: c.cardDark, borderRadius: 20, borderWidth: 1, borderColor: c.borderColor, padding: 24, gap: 12 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: c.textMain, fontFamily: fonts.serif },
  modalDesc: { fontSize: 13, color: c.textMuted, lineHeight: 20 },
  reportSection: { marginBottom: 16 },
  reportSectionTitle: { fontSize: 12, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  reportBody: { fontSize: 13, color: c.textMain, lineHeight: 20 },
  reportListItem: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 6 },
});
