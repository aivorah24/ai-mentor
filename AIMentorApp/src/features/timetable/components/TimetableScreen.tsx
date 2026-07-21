/**
 * TimetableScreen — standalone weekly timetable for a class the user can access.
 * Class selector (from /classes/mine), the shared grid, the slot popup, a
 * setup action for template owners, and a web PDF/print export.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView, Platform, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Header from '../../../components/common/Header';
import ScreenLayout from '../../../components/common/ScreenLayout';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { spacing, radius, fonts } from '../../../theme';
import type { AppColors } from '../../../theme';
import SERVER_URL from '../../../config/serverUrl';
import { fetchMyClasses, MyClass } from '../../classes/api/classesApi';
import { fetchTimetable, saveSlot, saveTemplate, Timetable, PeriodDef, TimetableSlot, fmtTime, DAY_LABELS, subjectColor } from '../api/timetableApi';
import TimetableGrid from './TimetableGrid';
import SlotDetailModal, { SlotEdit } from './SlotDetailModal';
import PeriodEditorModal from './PeriodEditorModal';

// A full school-day bell structure (8:25 AM - 3:00 PM) for template owners to
// start from — mirrors a real IB day: a mid-morning break and a clearly-marked
// Lunch break (both rendered as full-width break strips with their times).
const DEFAULT_PERIODS: PeriodDef[] = [
  { code: 'P0', start: '08:25', end: '08:50', isBreak: false },
  { code: 'P1', start: '08:50', end: '09:40', isBreak: false },
  { code: 'P2', start: '09:40', end: '10:30', isBreak: false },
  { code: 'BRK', start: '10:30', end: '10:40', isBreak: true },
  { code: 'P3', start: '10:40', end: '11:30', isBreak: false },
  { code: 'P4', start: '11:30', end: '12:20', isBreak: false },
  { code: 'LUNCH', start: '12:20', end: '12:50', isBreak: true },
  { code: 'P5', start: '12:50', end: '13:40', isBreak: false },
  { code: 'P6', start: '13:40', end: '14:10', isBreak: false },
  { code: 'P7', start: '14:10', end: '15:00', isBreak: false },
];

export default function TimetableScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const email = user?.email || '';
  const schoolId = user?.schoolId || '';

  // When opened for a specific class (e.g. from ClassDetail), show just that
  // class and hide the selector. Otherwise list the user's own classes.
  const paramClass: MyClass | null = route?.params?.grade
    ? { grade: route.params.grade, section: route.params.section || '', label: route.params.label || `${route.params.grade}${route.params.section ? ' ' + route.params.section : ''}`, code: `${route.params.grade}${route.params.section || ''}`, classTeacherEmail: null, classTeacherName: null }
    : null;

  const [classes, setClasses] = useState<MyClass[]>(paramClass ? [paramClass] : []);
  const [selected, setSelected] = useState<MyClass | null>(paramClass);
  const [tt, setTt] = useState<Timetable | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<{ day: string; period: PeriodDef; slot: TimetableSlot | null } | null>(null);
  const [showPeriods, setShowPeriods] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // For the admin Programme → Grade → Section selector (IB schools).
  const [structure, setStructure] = useState<{ name: string; sections: string[] }[]>([]);
  const [curriculum, setCurriculum] = useState<string | null>(null);
  const [programme, setProgramme] = useState<string | null>(null);

  const isAdmin = user?.role === 'school_admin' || user?.role === 'super_admin';

  const loadClasses = useCallback(async () => {
    if (!email || paramClass) return; // param mode: fixed single class, skip listing
    try {
      if (isAdmin && schoolId) {
        // Admins aren't enrolled in a class — offer every grade+section in the
        // school (from the academic structure) as a selectable class.
        const res = await fetch(`${SERVER_URL}/user/school-structure?schoolId=${encodeURIComponent(schoolId)}`);
        const data = await res.json().catch(() => ({}));
        setStructure(data?.grades || []);
        setCurriculum(data?.curriculum || null);
        const opts: MyClass[] = [];
        for (const g of (data?.grades || [])) {
          const secs = g.sections?.length ? g.sections : [''];
          for (const s of secs) {
            opts.push({ grade: g.name, section: s, label: `${g.name}${s ? ' ' + s : ''}`, code: `${g.name}${s}`, classTeacherEmail: null, classTeacherName: null });
          }
        }
        setClasses(opts);
        setSelected((prev) => prev || opts[0] || null);
        return;
      }
      const cs = await fetchMyClasses(email);
      setClasses(cs);
      setSelected((prev) => prev || cs[0] || null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load classes');
    }
  }, [email, paramClass, isAdmin, schoolId]);

  const loadTimetable = useCallback(async (cls: MyClass) => {
    if (!schoolId || !cls) return;
    setLoading(true); setError('');
    try {
      setTt(await fetchTimetable(email, schoolId, cls.grade, cls.section));
    } catch (e: any) {
      setError(e?.message || 'Failed to load timetable');
      setTt(null);
    } finally {
      setLoading(false);
    }
  }, [email, schoolId]);

  // Reload classes list and the current timetable every time the screen gains
  // focus — this ensures that a save by a teacher/admin in another session is
  // picked up immediately when any user navigates back here, without requiring
  // them to switch classes or hard-reload the page.
  useFocusEffect(useCallback(() => {
    loadClasses();
    if (selected) loadTimetable(selected);
  }, [loadClasses, loadTimetable, selected]));
  // Also re-fetch the timetable whenever the selected class changes (covers
  // the initial load and when the user taps a different class chip).
  useEffect(() => { if (selected) loadTimetable(selected); }, [selected, loadTimetable]);

  const classLabel = selected ? selected.label : 'Timetable';

  // IB programme grouping: PYP (Grade 1-5), MYP (6-10), DP (11-12). Only applied
  // when the school's base curriculum is IB — mirrors resolveCurriculum() on the
  // server. Non-IB schools skip the programme row and use a flat grade list.
  const isIB = curriculum === 'IB';
  const programmeForGrade = (name: string): string | null => {
    if (!isIB) return null;
    const n = parseInt(String(name).replace(/\D/g, ''), 10);
    if (!n) return 'PYP';
    if (n <= 5) return 'PYP';
    if (n <= 10) return 'MYP';
    return 'DP';
  };
  const PROG_ORDER = ['PYP', 'MYP', 'DP'];
  const programmes = isIB
    ? PROG_ORDER.filter((p) => structure.some((g) => programmeForGrade(g.name) === p))
    : [];
  const activeProgramme = programme || (selected ? programmeForGrade(selected.grade) : null) || programmes[0] || null;
  const gradesForSelector = isIB
    ? structure.filter((g) => programmeForGrade(g.name) === activeProgramme)
    : structure;
  const sectionsForGrade = selected ? (structure.find((g) => g.name === selected.grade)?.sections || []) : [];

  const pickGrade = (gradeName: string) => {
    const g = structure.find((x) => x.name === gradeName);
    const sec = (g?.sections && g.sections[0]) || '';
    setSelected({ grade: gradeName, section: sec, label: `${gradeName}${sec ? ' ' + sec : ''}`, code: `${gradeName}${sec}`, classTeacherEmail: null, classTeacherName: null });
  };
  const pickSection = (sec: string) => {
    if (!selected) return;
    setSelected({ ...selected, section: sec, label: `${selected.grade}${sec ? ' ' + sec : ''}`, code: `${selected.grade}${sec}` });
  };
  const pickProgramme = (p: string) => {
    setProgramme(p);
    const firstGrade = structure.find((g) => programmeForGrade(g.name) === p);
    if (firstGrade) pickGrade(firstGrade.name);
  };

  const setupDefault = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await saveTemplate({ email, schoolId, grade: selected.grade, section: selected.section, title: `${selected.label} Timetable`, periodDefs: DEFAULT_PERIODS });
      await loadTimetable(selected);
    } catch (e: any) { setError(e?.message || 'Failed to set up periods'); }
    finally { setSaving(false); }
  };

  const onSaveSlot = async (edit: SlotEdit) => {
    if (!modal || !selected) return;
    setSaving(true);
    try {
      await saveSlot({ email, schoolId, grade: selected.grade, section: selected.section, day: modal.day, periodCode: modal.period.code, subject: edit.subject, room: edit.room, materialUrl: edit.materialUrl, materialName: edit.materialName, color: edit.color });
      await loadTimetable(selected);
      setModal(null);
    } catch (e: any) { setError(e?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const onSavePeriods = async (periods: PeriodDef[]) => {
    if (!selected) return;
    setSaving(true);
    try {
      await saveTemplate({ email, schoolId, grade: selected.grade, section: selected.section, title: `${selected.label} Timetable`, periodDefs: periods });
      await loadTimetable(selected);
      setShowPeriods(false);
    } catch (e: any) { setError(e?.message || 'Failed to save periods'); }
    finally { setSaving(false); }
  };

  const onClearSlot = async () => {
    if (!modal || !selected) return;
    setSaving(true);
    try {
      await saveSlot({ email, schoolId, grade: selected.grade, section: selected.section, day: modal.day, periodCode: modal.period.code, subject: '' });
      await loadTimetable(selected);
      setModal(null);
    } catch (e: any) { setError(e?.message || 'Failed to clear'); }
    finally { setSaving(false); }
  };

  const downloadPdf = async () => {
    if (Platform.OS !== 'web' || !tt || !selected) return;
    setDownloading(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const W = 842;
      const H = 595;
      const ML = 28;
      const MR = 28;
      const MT = 36;
      const MB = 28;
      const usableW = W - ML - MR;
      const axisW = 72;
      const days = tt.days || ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const colW = (usableW - axisW) / Math.max(1, days.length);

      const hexToRgb = (hex: string): [number, number, number] => {
        const clean = hex.replace('#', '');
        if (clean.length === 6) {
          return [
            parseInt(clean.slice(0, 2), 16) || 240,
            parseInt(clean.slice(2, 4), 16) || 240,
            parseInt(clean.slice(4, 6), 16) || 240,
          ];
        }
        return [240, 248, 255];
      };

      // Header: School Badge + School Name + Subtitle
      const schoolName = user?.school || 'The Shri Ram Academy';
      const studentSubtitle = user?.name ? `${user.name}'s Timetable (${classLabel})` : `${classLabel} — Timetable`;

      // Try to load stored TSRA / School Logo (from Cloudinary/Backend)
      let logoDataUrl: string | null = null;
      try {
        const logoTargetUrl = 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1783659219/aivorah/branding/school_THE_SHRI_RAM_ACADEMY.png';
        const imgRes = await fetch(logoTargetUrl);
        const blob = await imgRes.blob();
        logoDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.warn('[downloadPdf] could not load logo image, falling back to crest badge:', err);
      }

      if (logoDataUrl) {
        try {
          doc.addImage(logoDataUrl, 'PNG', ML, MT - 2, 28, 28);
        } catch (err) {
          doc.setFillColor(27, 54, 93);
          doc.circle(ML + 14, MT + 12, 14, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.setTextColor(255, 255, 255);
          doc.text('S', ML + 14, MT + 16, { align: 'center' });
        }
      } else {
        doc.setFillColor(27, 54, 93);
        doc.circle(ML + 14, MT + 12, 14, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(255, 255, 255);
        doc.text('S', ML + 14, MT + 16, { align: 'center' });
      }

      // School Name & Class Subtitle
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(26, 26, 26);
      doc.text(schoolName, ML + 36, MT + 10);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(90, 90, 90);
      doc.text(studentSubtitle, ML + 36, MT + 24);

      // Date Range / Title on Top Right
      doc.setFontSize(9);
      doc.setTextColor(110, 110, 110);
      doc.text(tt.title || '14 Jul 2026 – 18 May 2027', W - MR, MT + 10, { align: 'right' });

      // Draw table header (Aivorah Signature Model: Left PERIOD spine + clean day columns)
      let y = MT + 38;
      const headerH = 26;
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(1);

      const drawTableHeader = (startY: number) => {
        // Top-left PERIOD box
        doc.setFillColor(245, 245, 245);
        doc.rect(ML, startY, axisW, headerH, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(90, 90, 90);
        doc.text('PERIOD', ML + axisW / 2, startY + 16, { align: 'center' });

        // Day column headers
        days.forEach((d, i) => {
          const cx = ML + axisW + i * colW;
          doc.setFillColor(245, 245, 245);
          doc.rect(cx, startY, colW, headerH, 'FD');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10.5);
          if (d === 'SAT' || d === 'SUN') {
            doc.setTextColor(210, 50, 50);
          } else {
            doc.setTextColor(40, 40, 40);
          }
          doc.text(DAY_LABELS[d] || d, cx + colW / 2, startY + 16, { align: 'center' });
        });
      };

      drawTableHeader(y);
      y += headerH;

      // Draw rows
      for (const p of tt.periodDefs) {
        const isBreak = !!p.isBreak;
        const rowH = isBreak ? 28 : 58;

        // Check page overflow
        if (y + rowH > H - MB) {
          doc.addPage();
          y = MT;
          drawTableHeader(y);
          y += headerH;
        }

        if (isBreak) {
          // Break/Lunch row: clean full-width strip across all day columns
          doc.setFillColor(245, 245, 245);
          doc.rect(ML, y, axisW, rowH, 'FD');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9.5);
          doc.setTextColor(110, 110, 110);
          doc.text(p.code || 'BRK', ML + axisW / 2, y + 17, { align: 'center' });

          const stripX = ML + axisW;
          const stripW = usableW - axisW;
          doc.setFillColor(238, 238, 238);
          doc.rect(stripX, y, stripW, rowH, 'FD');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(110, 110, 110);
          const breakText = `${fmtTime(p.start)} – ${fmtTime(p.end)} · ${p.code || 'Break'}`;
          doc.text(breakText, stripX + stripW / 2, y + 17, { align: 'center' });
        } else {
          // Normal period row: left axis + pastel subject cards
          doc.setFillColor(250, 250, 250);
          doc.rect(ML, y, axisW, rowH, 'FD');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10.5);
          doc.setTextColor(40, 40, 40);
          doc.text(p.code, ML + axisW / 2, y + 22, { align: 'center' });
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8.5);
          doc.setTextColor(120, 120, 120);
          doc.text(fmtTime(p.start), ML + axisW / 2, y + 38, { align: 'center' });

          days.forEach((d, i) => {
            const cx = ML + axisW + i * colW;
            const s = tt.slots.find((x) => x.day === d && x.periodCode === p.code);
            if (s && (s.subject || s.room)) {
              const hex = s.color || subjectColor(s.subject || '') || '#E0F7FA';
              const [r, g, b] = hexToRgb(hex);
              doc.setFillColor(r, g, b);
              doc.rect(cx, y, colW, rowH, 'FD');

              // Draw subject
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(11);
              doc.setTextColor(30, 30, 30);
              const lines = doc.splitTextToSize(s.subject || '', colW - 14);
              doc.text(lines.slice(0, 2), cx + 8, y + 22);

              // Draw room/teacher below
              if (s.room) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(90, 90, 90);
                const roomLines = doc.splitTextToSize(s.room, colW - 14);
                doc.text(roomLines.slice(0, 1), cx + 8, y + 46);
              }
            } else {
              doc.setFillColor(255, 255, 255);
              doc.rect(cx, y, colW, rowH, 'FD');
            }
          });
        }
        y += rowH;
      }

      // Trigger direct file download
      doc.save(`${classLabel} Timetable.pdf`);
    } catch (err) {
      console.error('[downloadPdf]', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="Timetable" subtitle="Weekly class schedule" onMenuPress={() => navigation?.openDrawer?.()} />

        {/* Class selector + actions */}
        <View style={styles.toolbar}>
          {isAdmin && structure.length > 0 ? (
            // Admin: Programme (IB only) → Grade → Section hierarchy.
            <View style={{ flex: 1, gap: 8 }}>
              {programmes.length > 0 && (
                <View style={styles.selectorRow}>
                  <Text style={styles.selectorLabel}>Programme</Text>
                  {programmes.map((p) => (
                    <TouchableOpacity key={p} style={[styles.chip, activeProgramme === p && styles.chipActive]} onPress={() => pickProgramme(p)} accessibilityRole="button">
                      <Text style={[styles.chipText, activeProgramme === p && styles.chipTextActive]}>IB {p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={styles.selectorRow}>
                <Text style={styles.selectorLabel}>Grade</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {gradesForSelector.map((g) => (
                    <TouchableOpacity key={g.name} style={[styles.chip, selected?.grade === g.name && styles.chipActive]} onPress={() => pickGrade(g.name)} accessibilityRole="button">
                      <Text style={[styles.chipText, selected?.grade === g.name && styles.chipTextActive]}>{g.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              {sectionsForGrade.length > 0 && (
                <View style={styles.selectorRow}>
                  <Text style={styles.selectorLabel}>Section</Text>
                  {sectionsForGrade.map((s) => (
                    <TouchableOpacity key={s} style={[styles.chip, selected?.section === s && styles.chipActive]} onPress={() => pickSection(s)} accessibilityRole="button">
                      <Text style={[styles.chipText, selected?.section === s && styles.chipTextActive]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
              {classes.map((c) => {
                const active = selected && c.grade === selected.grade && c.section === selected.section;
                return (
                  <TouchableOpacity key={c.code} style={[styles.classPill, active && styles.classPillActive]} onPress={() => setSelected(c)} accessibilityRole="button">
                    <Text style={[styles.classPillText, active && styles.classPillTextActive]} numberOfLines={1}>{c.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
          {tt?.permissions.canManageTemplate && tt.periodDefs.length > 0 && (
            <TouchableOpacity style={styles.downloadBtn} onPress={() => setShowPeriods(true)} accessibilityRole="button">
              <Feather name="clock" size={14} color={colors.textHeading} />
              <Text style={styles.downloadText}>Periods</Text>
            </TouchableOpacity>
          )}
          {Platform.OS === 'web' && tt && tt.periodDefs.length > 0 && (
            <TouchableOpacity style={styles.downloadBtn} onPress={downloadPdf} disabled={downloading} accessibilityRole="button">
              {downloading ? (
                <ActivityIndicator size="small" color={colors.textHeading} />
              ) : (
                <Feather name="download" size={14} color={colors.textHeading} />
              )}
              <Text style={styles.downloadText}>{downloading ? 'Processing...' : 'Download'}</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                if (!selected) return;
                setRefreshing(true);
                await loadTimetable(selected).catch(() => {});
                setRefreshing(false);
              }}
              tintColor={colors.accentYellow}
              colors={[colors.accentYellow]}
            />
          }
        >
          {loading ? (
            <ActivityIndicator color={colors.accentYellow} style={{ marginTop: 40 }} />
          ) : error ? (
            <View style={styles.centerBox}><Feather name="alert-circle" size={26} color={colors.textDim} /><Text style={styles.centerText}>{error}</Text></View>
          ) : !selected ? (
            <View style={styles.centerBox}><Feather name="calendar" size={26} color={colors.textDim} /><Text style={styles.centerText}>No class to show a timetable for.</Text></View>
          ) : tt && tt.periodDefs.length === 0 && tt.permissions.canManageTemplate ? (
            <View style={styles.centerBox}>
              <Feather name="clock" size={26} color={colors.textDim} />
              <Text style={styles.centerTitle}>Set up the bell schedule</Text>
              <Text style={styles.centerText}>Start with a standard period grid — you can edit each slot afterwards.</Text>
              <TouchableOpacity style={styles.setupBtn} onPress={setupDefault} disabled={saving} accessibilityRole="button">
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.setupText}>Create default periods</Text>}
              </TouchableOpacity>
            </View>
          ) : tt ? (
            <TimetableGrid
              timetable={tt}
              classLabel={classLabel}
              onCellPress={(day, period, slot) => {
                // Read-only viewers still open the popup (detail view); editors get Edit.
                setModal({ day, period, slot });
              }}
            />
          ) : null}
        </ScrollView>

        <SlotDetailModal
          visible={!!modal}
          onClose={() => setModal(null)}
          classLabel={classLabel}
          dayLabel={modal ? (DAY_LABELS[modal.day] || modal.day) : ''}
          period={modal?.period || null}
          slot={modal?.slot || null}
          canEdit={!!tt?.permissions.canEditSlot}
          saving={saving}
          onSave={onSaveSlot}
          onClear={onClearSlot}
        />

        <PeriodEditorModal
          visible={showPeriods}
          onClose={() => setShowPeriods(false)}
          initial={tt?.periodDefs || []}
          saving={saving}
          onSave={onSavePeriods}
        />
      </View>
    </ScreenLayout>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bgDark },
    toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.lg, paddingVertical: 10, borderBottomWidth: 1, borderColor: c.borderColor },
    selectorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    selectorLabel: { fontFamily: fonts.serif, fontSize: 10, fontWeight: '800', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5, width: 74 },
    chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark },
    chipActive: { borderColor: c.accentYellow, backgroundColor: c.accentYellow + '18' },
    chipText: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '600', color: c.textMuted },
    chipTextActive: { color: c.accentYellow, fontWeight: '800' },
    classPill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.borderColor, backgroundColor: c.cardDark },
    classPillActive: { borderColor: c.accentYellow, backgroundColor: c.accentYellow + '18' },
    classPillText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: c.textMuted, maxWidth: 160 },
    classPillTextActive: { color: c.accentYellow, fontWeight: '800' },
    downloadBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
    downloadText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: c.textHeading },
    content: { padding: spacing.lg, paddingBottom: 60 },
    centerBox: { alignItems: 'center', paddingTop: 48, gap: 10, maxWidth: 420, alignSelf: 'center' },
    centerTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '800', color: c.textHeading },
    centerText: { fontFamily: fonts.serif, fontSize: 13, color: c.textMuted, textAlign: 'center' },
    setupBtn: { backgroundColor: c.accentYellow, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 12, marginTop: 6 },
    setupText: { fontFamily: fonts.serif, fontSize: 14, fontWeight: '800', color: '#fff' },
  });
}
