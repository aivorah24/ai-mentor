import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import SERVER_URL from '../../config/serverUrl';

interface ChildOption {
  id: string;
  name: string;
  grade: string;
}

export default function ParentAIReportsScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const parentEmail = user?.email || '';
  const incomingChildId = route?.params?.childId;

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [selectedChild, setSelectedChild] = useState<ChildOption | null>(null);
  const [loadingChildren, setLoadingChildren] = useState(true);

  const [reportData, setReportData] = useState<any>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState('');

  // Load children on mount, then auto-generate if childId was passed
  useEffect(() => {
    fetch(`${SERVER_URL}/parent/${encodeURIComponent(parentEmail)}/children`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          const opts: ChildOption[] = data.map(c => ({ id: c.id, name: c.name, grade: c.grade }));
          setChildren(opts);
          const target = incomingChildId ? (opts.find(c => c.id === incomingChildId) ?? opts[0]) : opts[0];
          setSelectedChild(target);
          if (incomingChildId) {
            // auto-kick report generation when navigated from dashboard
            generateReportFor(target, parentEmail);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoadingChildren(false));
  }, [parentEmail]);

  async function generateReportFor(child: ChildOption, email: string) {
    setReportData(null);
    setError('');
    setLoadingReport(true);
    try {
      const res = await fetch(`${SERVER_URL}/parent/${encodeURIComponent(email)}/children/${child.id}/ai-report`);
      if (!res.ok) throw new Error('Failed to generate report');
      const data = await res.json();
      setReportData(data);
    } catch (e: any) {
      setError(e.message || 'Could not generate report. Please try again.');
    } finally {
      setLoadingReport(false);
    }
  }

  function generateReport(child: ChildOption) {
    setSelectedChild(child);
    generateReportFor(child, parentEmail);
  }

  async function downloadPDF() {
    if (!reportData || Platform.OS !== 'web') return;
    const { jsPDF } = await import('jspdf');
    const { student, metrics, report, generatedAt } = reportData;
    const date = new Date(generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210;
    const ML = 20;   // left margin
    const MR = 20;   // right margin
    const col = W - ML - MR;   // 170mm usable width
    const TW = col - 10;       // text wrap width — 5mm right padding from col boundary

    // Aivorah brand palette — teal only, no foreign colors
    const TEAL    : [number,number,number] = [95,  138, 134]; // primary brand
    const TEAL_D  : [number,number,number] = [65,  105, 102]; // darker teal for emphasis
    const TEAL_BG : [number,number,number] = [235, 246, 244]; // very light teal background
    const TEAL_MID: [number,number,number] = [180, 215, 212]; // mid teal for bars/accents
    const DARK    : [number,number,number] = [22,  26,  34 ]; // near-black body text
    const MUTED   : [number,number,number] = [110, 118, 135]; // secondary text
    const LIGHT   : [number,number,number] = [247, 249, 249]; // card background
    const WHITE   : [number,number,number] = [255, 255, 255];
    const BORDER  : [number,number,number] = [210, 224, 222]; // teal-tinted border
    // Aliases — everything maps to teal family
    const GREEN    = TEAL;
    const GREEN_BG = TEAL_BG;
    const RED      = TEAL_D;
    const RED_BG   = TEAL_BG;
    const BLUE     = TEAL;
    const BLUE_BG  = TEAL_BG;
    const AMBER    = TEAL_D;
    const AMBER_BG = TEAL_BG;

    let y = 0;

    // ── Utilities ─────────────────────────────────────────────────────────────
    function wrap(text: string): string[] {
      // Always measure with the body font so wrap width is consistent everywhere
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      return doc.splitTextToSize(text || '', TW);
    }

    function checkY(need: number) {
      if (y + need > 278) addNewPage();
    }

    function addNewPage() {
      doc.addPage();
      y = 14;
      // Thin teal top rule on continuation pages
      doc.setFillColor(...TEAL);
      doc.rect(0, 0, W, 4, 'F');
      // Running header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...TEAL);
      doc.text('AIVORAH', ML, 10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUTED);
      doc.text(`${student.name}  ·  Student Performance Report  ·  ${date}`, ML + 18, 10);
      y = 18;
    }

    const HEADING_H = 10; // height reserved for a section heading (text + rule + gap)

    function sectionHeading(label: string, color: [number,number,number], minContentH = 20) {
      // Ensure heading + at least first content block fit on the same page
      checkY(HEADING_H + minContentH);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...color);
      doc.text(label.toUpperCase(), ML, y);
      doc.setDrawColor(...color);
      doc.setLineWidth(0.4);
      doc.line(ML, y + 1.5, ML + col, y + 1.5);
      doc.setDrawColor(0, 0, 0);
      y += 6;
    }

    function bodyText(lines: string[]) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...DARK);
      for (const line of lines) {
        doc.text(line, ML, y);
        y += 5.6;
      }
    }

    function gap(mm = 4) { y += mm; }

    // Score bar for strong/weak topics
    function scoreBar(topic: string, score: number, barColor: [number,number,number], bgColor: [number,number,number]) {
      checkY(9);
      const barW = col * 0.38;
      const labelW = col - barW - 22;
      // label
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...DARK);
      const labelLines = doc.splitTextToSize(topic, labelW);
      doc.text(labelLines[0], ML, y + 4);
      // score text
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...barColor);
      doc.text(`${score}%`, ML + labelW + barW + 2, y + 4);
      // bg track
      doc.setFillColor(...TEAL_MID);
      doc.roundedRect(ML + labelW, y, barW, 5, 1, 1, 'F');
      // filled
      doc.setFillColor(...TEAL);
      doc.roundedRect(ML + labelW, y, barW * (score / 100), 5, 1, 1, 'F');
      y += 8;
    }

    // ── COVER HEADER ─────────────────────────────────────────────────────────
    // Deep teal banner
    doc.setFillColor(...TEAL);
    doc.rect(0, 0, W, 52, 'F');

    // Brand
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    doc.setTextColor(255, 255, 255);
    doc.text('Aivorah', ML, 22);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(200, 232, 228);
    doc.text('AI-Powered Learning Platform', ML, 30);

    // Report type — right aligned
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text('Student Performance Report', W - MR, 22, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(200, 232, 228);
    doc.text(date, W - MR, 29, { align: 'right' });

    // Decorative circle
    doc.setFillColor(255, 255, 255);
    doc.setGState(doc.GState({ opacity: 0.06 }));
    doc.circle(W - 20, 0, 48, 'F');
    doc.setGState(doc.GState({ opacity: 1 }));

    y = 60;

    // ── STUDENT CARD ─────────────────────────────────────────────────────────
    doc.setFillColor(...WHITE);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(ML, y, col, 32, 3, 3, 'FD');

    // Avatar circle — centered at (ML+18, y+16)
    const avatarCX = ML + 18;
    const avatarCY = y + 16;
    doc.setFillColor(...TEAL_BG);
    doc.circle(avatarCX, avatarCY, 10, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...TEAL);
    // vertically center: baseline = centerY + fontSize*0.352/2 ≈ centerY + 2.1
    doc.text(student.name.charAt(0).toUpperCase(), avatarCX, avatarCY + 2.2, { align: 'center' });

    // Name + meta
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...DARK);
    doc.text(student.name, ML + 33, y + 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(`${student.grade}  ·  ${student.curriculum}${student.school ? `  ·  ${student.school}` : ''}`, ML + 33, y + 20);

    // Pattern badge — compact pill, auto-width, right-aligned
    const patLabel = (report.learning_pattern || '').replace(/_/g, ' ');
    const patCapitalized = patLabel.charAt(0).toUpperCase() + patLabel.slice(1);
    doc.setFontSize(8);
    const badgeW = Math.min(doc.getTextWidth(patCapitalized) + 14, 50);
    const badgeX = W - MR - badgeW;
    const badgeY = y + 11;
    doc.setFillColor(...TEAL_BG);
    doc.setDrawColor(...TEAL);
    doc.setLineWidth(0.4);
    doc.roundedRect(badgeX, badgeY, badgeW, 9, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...TEAL);
    doc.text(patCapitalized, badgeX + badgeW / 2, badgeY + 6, { align: 'center' });

    y += 40;

    // ── METRICS ROW ──────────────────────────────────────────────────────────
    const metricItems = [
      { label: 'XP Earned',   value: metrics.xp.toLocaleString(), color: AMBER,  bg: AMBER_BG  },
      { label: 'Level',       value: String(metrics.level),        color: TEAL,   bg: TEAL_BG   },
      { label: 'Streak',      value: `${metrics.currentStreak}d`,  color: GREEN,  bg: GREEN_BG  },
      { label: 'Topics',      value: String(metrics.topicsCompleted), color: BLUE, bg: BLUE_BG  },
      { label: 'Assignments', value: String(metrics.assignmentsDone), color: GREEN, bg: GREEN_BG },
      { label: 'Active Days', value: `${metrics.activeDays}/14`,   color: BLUE,   bg: BLUE_BG   },
      ...(metrics.avgAssignmentScore != null
        ? [{ label: 'Avg Score', value: `${metrics.avgAssignmentScore}%`, color: TEAL, bg: TEAL_BG }]
        : []),
    ];
    const mCount = metricItems.length;
    const mw = col / mCount;
    metricItems.forEach((m, i) => {
      const mx = ML + i * mw;
      doc.setFillColor(...m.bg);
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.25);
      doc.roundedRect(mx, y, mw - 1.5, 22, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...m.color);
      doc.text(m.value, mx + mw / 2 - 0.75, y + 11, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...MUTED);
      doc.text(m.label, mx + mw / 2 - 0.75, y + 17, { align: 'center' });
    });
    y += 30;

    // ── INTRO NOTE ────────────────────────────────────────────────────────────
    // Intro uses italic 9pt — measure explicitly to avoid overflow
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    const introLines = doc.splitTextToSize(`Here is ${student.name}'s personalised learning report, generated by Aivorah based on their actual activity, quiz scores, and study patterns over the past two weeks. Every insight below reflects real data — nothing is assumed.`, TW - 6);
    checkY(introLines.length * 5.6 + 10);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    for (const line of introLines) { doc.text(line, ML, y); y += 5.4; }
    gap(4);

    // ── LEARNING PATTERN ─────────────────────────────────────────────────────
    if (report.learning_pattern_insight) {
      const lines = wrap(report.learning_pattern_insight);
      sectionHeading("How " + student.name.split(' ')[0] + " Is Learning Right Now", TEAL, lines.length * 5.6);
      bodyText(lines);
      gap(4);
    }

    // ── WHAT'S GOING WELL ─────────────────────────────────────────────────────
    if (report.whats_going_well) {
      const lines = wrap(report.whats_going_well);
      const strong = (report.strong_topics || []) as any[];
      sectionHeading("What's Going Well", GREEN, lines.length * 5.6 + strong.length * 8);
      bodyText(lines);
      if (strong.length > 0) {
        gap(4);
        strong.forEach((t: any) => scoreBar(t.topic, t.score, GREEN, GREEN_BG));
      }
      gap(4);
    }

    // ── WHERE TO FOCUS ────────────────────────────────────────────────────────
    if (report.where_to_focus) {
      const lines = wrap(report.where_to_focus);
      const weak = (report.weak_topics || []) as any[];
      sectionHeading("Where to Focus Next", RED, lines.length * 5.6 + weak.length * 8);
      bodyText(lines);
      if (weak.length > 0) {
        gap(4);
        weak.forEach((t: any) => scoreBar(t.topic, t.score, RED, RED_BG));
      }
      gap(4);
    }

    // ── SUBJECT INSIGHTS ─────────────────────────────────────────────────────
    const subjectInsights = (report.subject_insights || []) as any[];
    if (subjectInsights.length > 0) {
      sectionHeading('Subject Breakdown', BLUE, 16);
      subjectInsights.forEach((si: any) => {
        const lines = wrap(`${si.subject}:  ${si.insight}`);
        checkY(lines.length * 5.6 + 4);
        // subject in bold, rest normal
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...DARK);
        doc.text(`${si.subject}`, ML, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...MUTED);
        doc.text(':  ' + doc.splitTextToSize(si.insight, TW - doc.getTextWidth(`${si.subject}:  `))[0], ML + doc.getTextWidth(`${si.subject}`), y);
        y += 5.6;
        // remaining lines of insight
        const rest = wrap(si.insight).slice(1);
        rest.forEach(l => { doc.text(l, ML, y); y += 5.4; });
        gap(2);
      });
      gap(4);
    }

    // ── STUDY CONSISTENCY ─────────────────────────────────────────────────────
    if (report.consistency_insight) {
      const lines = wrap(report.consistency_insight);
      sectionHeading('Study Consistency', BLUE, lines.length * 5.6 + 14);
      bodyText(lines);
      // mini stat pills inline
      gap(4);
      const pills = [
        `${metrics.currentStreak} day streak`,
        `${metrics.activeDays} of 14 days active`,
        ...(metrics.avgDailyMinutes > 0 ? [`~${metrics.avgDailyMinutes} min/session`] : []),
      ];
      let px = ML;
      pills.forEach(p => {
        const pw = doc.getTextWidth(p) + 10;
        doc.setFillColor(...BLUE_BG);
        doc.roundedRect(px, y, pw, 7, 1.5, 1.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...BLUE);
        doc.text(p, px + 5, y + 4.8);
        px += pw + 4;
      });
      y += 11;
      gap(4);
    }

    // ── ASSIGNMENT PERFORMANCE ────────────────────────────────────────────────
    if (report.assignment_insight) {
      const lines = wrap(report.assignment_insight);
      sectionHeading('Assignment Performance', GREEN, lines.length * 5.6);
      bodyText(lines);
      if (metrics.assignmentTrend) {
        gap(3);
        const trendColor = metrics.assignmentTrend === 'improving' ? GREEN : metrics.assignmentTrend === 'declining' ? RED : BLUE;
        const trendBg    = metrics.assignmentTrend === 'improving' ? GREEN_BG : metrics.assignmentTrend === 'declining' ? RED_BG : BLUE_BG;
        const trendLabel = `Trend: ${metrics.assignmentTrend.charAt(0).toUpperCase() + metrics.assignmentTrend.slice(1)}`;
        const tw2 = doc.getTextWidth(trendLabel) + 10;
        doc.setFillColor(...trendBg);
        doc.roundedRect(ML, y, tw2, 7, 1.5, 1.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(...trendColor);
        doc.text(trendLabel, ML + 5, y + 4.8);
        y += 11;
      }
      gap(4);
    }

    // ── THIS WEEK — ACTION PLAN ───────────────────────────────────────────────
    const actions = (report.this_week_actions || []) as string[];
    if (actions.length > 0) {
      sectionHeading("This Week — Action Plan for Parents", TEAL, actions.length * 12);
      actions.forEach((a: string, i: number) => {
        const lines = wrap(a);
        checkY(lines.length * 5.6 + 6);
        // Number circle
        doc.setFillColor(...TEAL_BG);
        doc.circle(ML + 4, y + 3, 3.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...TEAL);
        doc.text(String(i + 1), ML + 4, y + 5, { align: 'center' });
        // Action text
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(...DARK);
        lines.forEach((line, li) => {
          doc.text(line, ML + 10, y + (li === 0 ? 4.5 : 4.5 + li * 5.6));
        });
        y += lines.length * 5.6 + 4;
      });
      gap(4);
    }

    // ── MESSAGE TO CHILD ──────────────────────────────────────────────────────
    if (report.message_to_child) {
      // italic 10pt — measure explicitly with matching font
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(`"${report.message_to_child}"`, TW - 16);
      const cardH = lines.length * 5.8 + 20;
      checkY(cardH + 4);
      // card
      doc.setFillColor(...TEAL_BG);
      doc.setDrawColor(...TEAL);
      doc.setLineWidth(0.3);
      doc.roundedRect(ML, y, col, cardH, 3, 3, 'FD');
      // Label
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...TEAL);
      doc.text(`A message for ${student.name.split(' ')[0]}`, ML + 8, y + 8);
      // Quote
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10);
      doc.setTextColor(...DARK);
      lines.forEach((line, i) => doc.text(line, ML + 8, y + 15 + i * 5.8));
      y += cardH + 6;
    }

    // ── FOOTER ON ALL PAGES ───────────────────────────────────────────────────
    const totalPages = (doc as any).internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFillColor(...TEAL);
      doc.rect(0, 287, W, 2, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      doc.text(`Aivorah  ·  ${student.name}  ·  ${date}  ·  Confidential`, ML, 293);
      doc.text(`${p} / ${totalPages}`, W - MR, 293, { align: 'right' });
    }

    const fname = `Aivorah_Report_${student.name.replace(/\s+/g, '_')}_${new Date(generatedAt).toISOString().slice(0, 10)}.pdf`;
    doc.save(fname);
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="AI Progress Report"
          subtitle="AI-generated performance analysis for your child"
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* Child selector */}
          {loadingChildren ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 32 }} />
          ) : children.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="users" size={32} color={colors.textDim} />
              <Text style={styles.emptyTitle}>No children linked</Text>
              <Text style={styles.emptyDesc}>Add a child from My Kids to generate reports.</Text>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.accentYellow, marginTop: 12 }]} onPress={() => navigation.navigate('ParentMyKids')}>
                <Text style={styles.actionBtnText}>Go to My Kids</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Child selector + generate button row */}
              <View style={styles.childRowWrap}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
                  {children.map(child => {
                    const isActive = selectedChild?.id === child.id;
                    return (
                      <TouchableOpacity
                        key={child.id}
                        style={[styles.childPill, isActive && { backgroundColor: colors.accentYellow + '18', borderColor: colors.accentYellow }]}
                        onPress={() => { setSelectedChild(child); setReportData(null); setError(''); }}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.childDot, { backgroundColor: isActive ? '#ffffff40' : colors.accentYellow + '25' }]}>
                          <Text style={[styles.childDotText, { color: isActive ? '#fff' : colors.accentYellow }]}>
                            {child.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View>
                          <Text style={[styles.childPillName, { color: isActive ? '#fff' : colors.textMain }]}>{child.name}</Text>
                          <Text style={[styles.childPillGrade, { color: isActive ? '#ffffff80' : colors.textMuted }]}>{child.grade}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {selectedChild && !reportData && !loadingReport && (
                  <TouchableOpacity
                    style={[styles.generateBtn, { backgroundColor: colors.accentYellow }]}
                    onPress={() => generateReport(selectedChild)}
                    activeOpacity={0.85}
                  >
                    <Feather name="cpu" size={14} color="#fff" />
                    <Text style={styles.generateBtnText}>Generate</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Initial prompt — shown before any report is generated */}
              {!loadingReport && !reportData && !error && (
                <>
                  {/* Hero card */}
                  <View style={styles.heroCard}>
                    <View style={styles.heroContent}>
                      {/* AI badge */}
                      <View style={styles.aiBadge}>
                        <Feather name="zap" size={11} color={colors.accentYellow} />
                        <Text style={styles.aiBadgeText}>AI POWERED INSIGHTS</Text>
                      </View>
                      <Text style={styles.heroTitle}>
                        AI Performance{'\n'}<Text style={{ color: colors.accentYellow }}>Report</Text>
                      </Text>
                      <Text style={styles.heroDesc}>
                        Get a personalised AI generated analysis of {selectedChild?.name}'s learning patterns, strengths, areas to improve, and a weekly action plan — all based on their real activity data.
                      </Text>
                      <TouchableOpacity
                        style={styles.heroBtn}
                        onPress={() => selectedChild && generateReport(selectedChild)}
                        activeOpacity={0.85}
                      >
                        <Feather name="cpu" size={15} color="#0B0B0B" />
                        <Text style={styles.heroBtnText}>Generate Report for {selectedChild?.name}</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Feature chips row */}
                    <View style={styles.heroFeatures}>
                      {[
                        { icon: 'trending-up', label: 'Learning pattern\nanalysis' },
                        { icon: 'star',        label: 'Strengths &\nweak areas' },
                        { icon: 'clipboard',   label: 'Weekly action\nplan for parents' },
                        { icon: 'file-text',   label: 'Downloadable\nPDF report' },
                      ].map(f => (
                        <View key={f.label} style={styles.heroFeatureChip}>
                          <View style={styles.heroFeatureIcon}>
                            <Feather name={f.icon as any} size={16} color={colors.accentYellow} />
                          </View>
                          <Text style={styles.heroFeatureText}>{f.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* What's Inside section */}
                  <View style={styles.insideCard}>
                    <View style={styles.insideHeader}>
                      <Feather name="zap" size={14} color={colors.accentYellow} />
                      <Text style={styles.insideTitle}>What's Inside Your Report</Text>
                    </View>
                    <View style={styles.insideGrid}>
                      {[
                        { num: '01', icon: 'trending-up', title: 'Learning Overview',    desc: `Time spent, consistency,\nand learning trends.` },
                        { num: '02', icon: 'star',        title: 'Strengths',            desc: `Topics where ${selectedChild?.name?.split(' ')[0]} excels and shines.` },
                        { num: '03', icon: 'alert-triangle', title: 'Areas to Improve', desc: 'Topics that need more\nfocus and practice.' },
                        { num: '04', icon: 'clipboard',   title: 'Action Plan',          desc: 'Personalised recommendations\nfor the week ahead.' },
                      ].map(card => (
                        <View key={card.num} style={styles.insideItem}>
                          <View style={styles.insideItemTop}>
                            <View style={styles.insideItemIcon}>
                              <Feather name={card.icon as any} size={18} color={colors.accentYellow} />
                            </View>
                            <Text style={styles.insideItemNum}>{card.num}</Text>
                          </View>
                          <Text style={styles.insideItemTitle}>{card.title}</Text>
                          <Text style={styles.insideItemDesc}>{card.desc}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={styles.insideFooter}>
                      <Feather name="zap" size={12} color={colors.textDim} />
                      <Text style={styles.insideFooterText}>Reports are AI-generated and updated with the latest learning data.</Text>
                    </View>
                  </View>
                </>
              )}

              {/* Loading */}
              {loadingReport && (
                <View style={styles.loadingBox}>
                  <ActivityIndicator color={colors.accentYellow} size="large" />
                  <Text style={styles.loadingText}>Analyzing {selectedChild?.name}'s learning data...</Text>
                  <Text style={styles.loadingSubText}>This takes a few seconds</Text>
                </View>
              )}

              {/* No data yet */}
              {reportData?.noData && (
                <View style={[styles.errorBox, { gap: 12, paddingVertical: 48 }]}>
                  <Feather name="inbox" size={36} color={colors.textDim} />
                  <Text style={[styles.emptyTitle, { textAlign: 'center' }]}>Not enough activity yet</Text>
                  <Text style={[styles.emptyDesc, { textAlign: 'center', maxWidth: 300 }]}>
                    {reportData.student?.name} hasn't started learning on Aivorah yet. Once they complete topics, assignments, or log study time, the AI report will have real data to analyze.
                  </Text>
                </View>
              )}

              {/* Error */}
              {!!error && (
                <View style={styles.errorBox}>
                  <Feather name="alert-circle" size={20} color={colors.accentRed} />
                  <Text style={styles.errorText}>{error}</Text>
                  <TouchableOpacity onPress={() => selectedChild && generateReport(selectedChild)}>
                    <Text style={[styles.errorText, { color: colors.accentYellow, fontWeight: '700' }]}>Try again</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Report */}
              {reportData && !reportData.noData && !loadingReport && (
                <View style={styles.reportContainer}>
                  {/* Report header */}
                  <View style={styles.reportHeader}>
                    <View>
                      <Text style={styles.reportName}>{reportData.student.name}</Text>
                      <Text style={styles.reportMeta}>{reportData.student.grade} · {reportData.student.curriculum}</Text>
                      <Text style={styles.reportDate}>
                        Generated {new Date(reportData.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </Text>
                    </View>
                    {Platform.OS === 'web' && (
                      <TouchableOpacity style={[styles.actionBtn, { flexDirection: 'row', gap: 6 }]} onPress={downloadPDF}>
                        <Feather name="download" size={14} color="#0F0F0F" />
                        <Text style={styles.actionBtnText}>Download PDF</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Metrics strip */}
                  <View style={styles.metricsGrid}>
                    {[
                      { icon: 'zap',         label: 'Total XP',    value: reportData.metrics.xp.toLocaleString() },
                      { icon: 'award',       label: 'Level',       value: String(reportData.metrics.level) },
                      { icon: 'trending-up', label: 'Streak',      value: `${reportData.metrics.currentStreak}d` },
                      { icon: 'book-open',   label: 'Topics Done', value: String(reportData.metrics.topicsCompleted) },
                      { icon: 'check-square',label: 'Assignments', value: String(reportData.metrics.assignmentsDone) },
                      { icon: 'calendar',    label: 'Active Days', value: `${reportData.metrics.activeDays}/14` },
                      ...(reportData.metrics.avgAssignmentScore != null ? [{ icon: 'percent', label: 'Avg Score', value: `${reportData.metrics.avgAssignmentScore}%` }] : []),
                    ].map((m: any) => (
                      <View key={m.label} style={styles.metricCard}>
                        <View style={styles.metricIcon}>
                          <Feather name={m.icon} size={14} color={colors.accentYellow} />
                        </View>
                        <Text style={styles.metricValue}>{m.value}</Text>
                        <Text style={styles.metricLabel}>{m.label}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Learning Pattern Insight */}
                  {reportData.report?.learning_pattern_insight ? (
                    <ReportSection title="Learning Pattern" icon="activity" styles={styles} colors={colors}>
                      <Text style={styles.bodyText}>{reportData.report.learning_pattern_insight}</Text>
                    </ReportSection>
                  ) : null}

                  {/* What's Going Well */}
                  {reportData.report?.whats_going_well ? (
                    <ReportSection title="What's Going Well" icon="star" styles={styles} colors={colors}>
                      <Text style={styles.bodyText}>{reportData.report.whats_going_well}</Text>
                      {(reportData.report.strong_topics || []).length > 0 && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {reportData.report.strong_topics.map((t: any, i: number) => (
                            <View key={i} style={styles.topicChip}>
                              <Feather name="check-circle" size={11} color={colors.accentYellow} />
                              <Text style={styles.topicChipText}>{t.topic} · {t.score}%</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </ReportSection>
                  ) : null}

                  {/* Where to Focus */}
                  {reportData.report?.where_to_focus ? (
                    <ReportSection title="Where to Focus" icon="alert-circle" styles={styles} colors={colors}>
                      <Text style={styles.bodyText}>{reportData.report.where_to_focus}</Text>
                      {(reportData.report.weak_topics || []).length > 0 && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {reportData.report.weak_topics.map((t: any, i: number) => (
                            <View key={i} style={[styles.topicChip, styles.topicChipWeak]}>
                              <Feather name="alert-circle" size={11} color={colors.accentRed} />
                              <Text style={[styles.topicChipText, { color: colors.accentRed }]}>{t.topic} · {t.score}%</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </ReportSection>
                  ) : null}

                  {/* Subject Insights */}
                  {(reportData.report?.subject_insights || []).length > 0 ? (
                    <ReportSection title="Subject Breakdown" icon="bar-chart-2" styles={styles} colors={colors}>
                      {reportData.report.subject_insights.map((si: any, i: number) => (
                        <View key={i} style={styles.bulletRow}>
                          <Feather name="book-open" size={13} color={colors.accentYellow} style={{ marginTop: 3 }} />
                          <Text style={[styles.bodyText, { flex: 1 }]}>
                            <Text style={{ fontWeight: '700', color: colors.textMain }}>{si.subject}: </Text>
                            {si.insight}
                          </Text>
                        </View>
                      ))}
                    </ReportSection>
                  ) : null}

                  {/* Study Consistency */}
                  {reportData.report?.consistency_insight ? (
                    <ReportSection title="Study Consistency" icon="clock" styles={styles} colors={colors}>
                      <Text style={styles.bodyText}>{reportData.report.consistency_insight}</Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        {[
                          { val: `${reportData.metrics.currentStreak}d`, lbl: 'Streak' },
                          { val: `${reportData.metrics.activeDays}/14`, lbl: 'Active Days' },
                          ...(reportData.metrics.avgDailyMinutes > 0 ? [{ val: `${reportData.metrics.avgDailyMinutes}m`, lbl: 'Avg Session' }] : []),
                        ].map(chip => (
                          <View key={chip.lbl} style={styles.statChip}>
                            <Text style={styles.statChipVal}>{chip.val}</Text>
                            <Text style={styles.statChipLabel}>{chip.lbl}</Text>
                          </View>
                        ))}
                      </View>
                    </ReportSection>
                  ) : null}

                  {/* Assignment Performance */}
                  {reportData.report?.assignment_insight ? (
                    <ReportSection title="Assignment Performance" icon="check-square" styles={styles} colors={colors}>
                      <Text style={styles.bodyText}>{reportData.report.assignment_insight}</Text>
                      {reportData.metrics.assignmentTrend && (
                        <View style={styles.trendBadge}>
                          <Feather
                            name={reportData.metrics.assignmentTrend === 'improving' ? 'trending-up' : reportData.metrics.assignmentTrend === 'declining' ? 'trending-down' : 'minus'}
                            size={12} color={colors.accentYellow}
                          />
                          <Text style={styles.trendText}>Trend: {reportData.metrics.assignmentTrend}</Text>
                        </View>
                      )}
                    </ReportSection>
                  ) : null}

                  {/* This Week Actions */}
                  {(reportData.report?.this_week_actions || []).length > 0 ? (
                    <ReportSection title="This Week — Action Plan" icon="target" styles={styles} colors={colors}>
                      {reportData.report.this_week_actions.map((s: string, i: number) => (
                        <View key={i} style={styles.bulletRow}>
                          <View style={styles.stepNum}>
                            <Text style={styles.stepNumText}>{i + 1}</Text>
                          </View>
                          <Text style={[styles.bodyText, { flex: 1 }]}>{s}</Text>
                        </View>
                      ))}
                    </ReportSection>
                  ) : null}

                  {/* Message to Child */}
                  {reportData.report?.message_to_child ? (
                    <View style={styles.encouragementCard}>
                      <Feather name="heart" size={16} color={colors.accentYellow} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.sectionLabel, { marginBottom: 4 }]}>
                          Share with {reportData.student.name}
                        </Text>
                        <Text style={[styles.bodyText, { fontStyle: 'italic', color: colors.textMain }]}>
                          "{reportData.report.message_to_child}"
                        </Text>
                      </View>
                    </View>
                  ) : null}

                  {/* Regenerate */}
                  <TouchableOpacity
                    style={[styles.regenBtn, { borderColor: colors.borderColor }]}
                    onPress={() => selectedChild && generateReport(selectedChild)}
                    activeOpacity={0.7}
                  >
                    <Feather name="refresh-cw" size={14} color={colors.textMuted} />
                    <Text style={[styles.regenBtnText, { color: colors.textMuted }]}>Regenerate Report</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

function ReportSection({ title, icon, colors, styles, children }: any) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionTitleRow}>
        <View style={styles.sectionIcon}>
          <Feather name={icon} size={13} color={colors.accentYellow} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={{ gap: 6 }}>{children}</View>
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 48 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: c.accentYellow, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.md },

  childRowWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  childPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 28,
    borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark,
  },
  childDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentYellow + '18' },
  childDotText: { fontSize: 12, fontWeight: '700', color: c.accentYellow },
  childPillName: { fontSize: 13, fontWeight: '700', color: c.textMain },
  childPillGrade: { fontSize: 10, color: c.textMuted },

  generateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: radius.lg, paddingVertical: 10, paddingHorizontal: 16,
    backgroundColor: c.accentYellow,
  },
  generateBtnText: { color: '#0B0B0B', fontWeight: '700', fontSize: 13 },

  loadingBox: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  loadingText: { fontSize: 15, fontWeight: '600', color: c.textMain },
  loadingSubText: { fontSize: 12, color: c.textMuted },

  errorBox: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  errorText: { fontSize: 13, color: c.accentRed, textAlign: 'center' },

  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: c.textMain },
  emptyDesc: { fontSize: 13, color: c.textMuted, textAlign: 'center' },

  actionBtn: { borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', backgroundColor: c.accentYellow },
  actionBtnText: { color: '#0B0B0B', fontWeight: '700', fontSize: 13 },

  reportContainer: { gap: spacing.lg },
  reportHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    backgroundColor: c.cardDark, borderRadius: radius.xl, padding: spacing.lg,
    borderWidth: 1, borderColor: c.borderColor,
  },
  reportName: { fontSize: 20, fontWeight: '800', color: c.textMain, fontFamily: fonts.serif },
  reportMeta: { fontSize: 13, color: c.accentYellow, marginTop: 3 },
  reportDate: { fontSize: 11, color: c.textDim, marginTop: 4 },

  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metricCard: {
    flex: 1, minWidth: 90, backgroundColor: c.cardDark, borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.borderColor, padding: spacing.md,
    alignItems: 'center', gap: 6,
  },
  metricIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentYellow + '18' },
  metricValue: { fontSize: 20, fontWeight: '800', color: c.accentYellow, fontFamily: fonts.serif },
  metricLabel: { fontSize: 10, color: c.textMuted, textAlign: 'center' },

  sectionCard: {
    backgroundColor: c.cardDark, borderRadius: radius.xl,
    borderWidth: 1, borderColor: c.borderColor, padding: spacing.lg, gap: spacing.md,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  sectionIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentYellow + '18' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: c.textMain, fontFamily: fonts.serif },
  bodyText: { fontSize: 13, color: c.textMuted, lineHeight: 21 },
  bulletRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },

  encouragementCard: {
    flexDirection: 'row', gap: 12, borderRadius: radius.xl,
    borderWidth: 1, borderColor: c.accentYellow + '30',
    backgroundColor: c.accentYellow + '08', padding: spacing.lg, alignItems: 'flex-start',
  },

  regenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: radius.lg, paddingVertical: 12,
    borderWidth: 1, borderColor: c.borderColor, marginTop: spacing.sm,
  },
  regenBtnText: { fontSize: 13, fontWeight: '600', color: c.textMuted },

  subjectCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: 6 },
  subjectName: { fontSize: 14, fontWeight: '700' },
  scoreBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  scoreBadgeText: { fontSize: 12, fontWeight: '700' },
  topicRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, flexWrap: 'wrap' },
  topicLabel: { fontSize: 11, fontWeight: '700' },
  topicText: { fontSize: 11, flex: 1 },

  trendBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6,
    alignSelf: 'flex-start', marginTop: 4,
    backgroundColor: c.accentYellow + '15', borderWidth: 1, borderColor: c.accentYellow + '40',
  },
  trendText: { fontSize: 12, fontWeight: '600', color: c.accentYellow },

  stepNum: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1, backgroundColor: c.accentYellow + '20', borderWidth: 1, borderColor: c.accentYellow + '40' },
  stepNumText: { fontSize: 11, fontWeight: '700', color: c.accentYellow },

  topicChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: c.accentYellow + '12', borderColor: c.accentYellow + '35' },
  topicChipWeak: { backgroundColor: c.accentRed + '12', borderColor: c.accentRed + '35' },
  topicChipText: { fontSize: 11, fontWeight: '600', color: c.accentYellow },

  statChip: { borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', backgroundColor: c.accentYellow + '12', borderWidth: 1, borderColor: c.accentYellow + '30' },
  statChipVal: { fontSize: 17, fontWeight: '800', color: c.accentYellow, fontFamily: fonts.serif },
  statChipLabel: { fontSize: 10, marginTop: 1, color: c.textMuted },

  // Hero card
  heroCard: {
    backgroundColor: c.cardDark, borderRadius: radius.xl, borderWidth: 1,
    borderColor: c.borderColor, overflow: 'hidden', marginBottom: spacing.lg,
  },
  heroContent: { padding: spacing.xxxl, gap: spacing.lg },
  aiBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: c.accentYellow + '18', borderWidth: 1, borderColor: c.accentYellow + '35',
  },
  aiBadgeText: { fontSize: 10, fontWeight: '700', color: c.accentYellow, letterSpacing: 1.2 },
  heroTitle: { fontSize: 28, fontWeight: '800', color: c.textMain, lineHeight: 36, fontFamily: fonts.serif },
  heroDesc: { fontSize: 13, color: c.textMuted, lineHeight: 21, maxWidth: 480 },
  heroBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    borderRadius: radius.xl, paddingVertical: 14, paddingHorizontal: 28,
    backgroundColor: c.accentYellow, marginTop: 4,
  },
  heroBtnText: { fontSize: 14, fontWeight: '700', color: '#0B0B0B' },
  heroFeatures: {
    flexDirection: 'row', borderTopWidth: 1, borderColor: c.borderColor,
  },
  heroFeatureChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: spacing.lg, borderRightWidth: 1, borderColor: c.borderColor,
  },
  heroFeatureIcon: {
    width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.accentYellow + '18',
  },
  heroFeatureText: { fontSize: 11, color: c.textMuted, lineHeight: 16, flex: 1 },

  // What's Inside card
  insideCard: {
    backgroundColor: c.cardDark, borderRadius: radius.xl, borderWidth: 1,
    borderColor: c.borderColor, overflow: 'hidden',
  },
  insideHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: spacing.xl, paddingBottom: spacing.lg,
  },
  insideTitle: { fontSize: 16, fontWeight: '700', color: c.textMain, fontFamily: fonts.serif },
  insideGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.md, gap: spacing.md, paddingTop: 0 },
  insideItem: {
    flex: 1, minWidth: 160, backgroundColor: c.bgDark, borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.borderColor, padding: spacing.lg, gap: 6,
  },
  insideItemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  insideItemIcon: {
    width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.accentYellow + '15',
  },
  insideItemNum: { fontSize: 22, fontWeight: '700', color: c.borderColor, fontFamily: fonts.serif },
  insideItemTitle: { fontSize: 14, fontWeight: '700', color: c.textMain },
  insideItemDesc: { fontSize: 11, color: c.textMuted, lineHeight: 17 },
  insideFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: spacing.xl, paddingTop: spacing.sm,
    borderTopWidth: 1, borderColor: c.borderColor,
  },
  insideFooterText: { fontSize: 11, color: c.textDim, flex: 1 },
});



