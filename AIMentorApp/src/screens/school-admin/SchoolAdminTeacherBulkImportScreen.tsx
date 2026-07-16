/**
 * School Admin — Teacher Bulk Import (5-step wizard, mirrors the student one).
 * Upload -> Map columns -> Validate -> Review -> Results.
 *
 * A teacher can teach different subjects in different grades (e.g. Social
 * Studies in Grade 3, Science in Grade 4). Recommended pattern: ONE row with
 * "|" separating each grade's group in the Grade and Subjects cells, matched
 * by position — see the template's sample rows. This is preferred over
 * repeating the same Email across multiple rows, since that only works with
 * an explicit, exactly-matching Email per row (a blank/auto-generated Email
 * can't be repeated, and a typo'd repeat silently creates a duplicate
 * account instead of merging) — still supported, just riskier.
 *
 * Contract:
 *   GET  /school-admin/teachers/template.csv|.xlsx?adminEmail=
 *   POST /school-admin/teachers/bulk?adminEmail=
 *        body { rows: [{ teacherName, email, curriculum, grade, subjects, phone }] }
 *        -> { created, updated, errors: [{row,error}], credentials: [{name,email,password,role}] }
 */
import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Pressable, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

type FieldKey = 'teacherName' | 'email' | 'curriculum' | 'grade' | 'subjects' | 'phone';
interface ParsedRow { teacherName: string; email: string; curriculum: string; grade: string; subjects: string; phone: string; }
interface InvalidRow { rowNum: number; reason: string; }
interface ImportError { row: number; error: string; }
interface Credential { name: string; email: string; password: string; role: string; }
interface ImportResult { created: number; updated: number; errors: ImportError[]; credentials: Credential[]; }

const STEP_LABELS = ['Upload', 'Map columns', 'Validate', 'Review', 'Results'];
const FIELD_OPTIONS: { value: FieldKey | ''; label: string }[] = [
  { value: '', label: "Don't import" },
  { value: 'teacherName', label: 'Teacher Name' },
  { value: 'email', label: 'Email' },
  { value: 'curriculum', label: 'Curriculum' },
  { value: 'grade', label: 'Grade' },
  { value: 'subjects', label: 'Subjects' },
  { value: 'phone', label: 'Phone' },
];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '', inQuotes = false;
  let row: string[] = [];
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function xlsxToGrid(buffer: ArrayBuffer): string[][] {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  return rows.map((r) => r.map((c) => String(c ?? '').trim()));
}

function guessField(header: string): FieldKey | '' {
  const h = header.trim().toLowerCase();
  switch (h) {
    case 'teacher name': case 'name': return 'teacherName';
    case 'email': case 'login email': return 'email';
    case 'curriculum': case 'board': return 'curriculum';
    case 'grade': return 'grade';
    case 'subjects': case 'subject': return 'subjects';
    case 'phone': case 'contact': case 'mobile': return 'phone';
    default: return '';
  }
}

function emptyRow(): ParsedRow { return { teacherName: '', email: '', curriculum: '', grade: '', subjects: '', phone: '' }; }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function csvEscape(v: string): string { const s = v ?? ''; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function downloadCsv(filename: string, content: string) {
  if (Platform.OS !== 'web') return;
  try {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* non-web */ }
}

function StepIndicator({ step, colors }: { step: number; colors: AppColors }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.stepperRow}>
      {STEP_LABELS.map((label, i) => {
        const num = i + 1, active = num === step, done = num < step, filled = active || done;
        return (
          <React.Fragment key={label}>
            <View style={styles.stepItem}>
              <View style={[styles.stepCircle, filled && styles.stepCircleActive]}>
                {done ? <Feather name="check" size={13} color="#0B0B0B" /> : <Text style={[styles.stepCircleText, filled && styles.stepCircleTextActive]}>{num}</Text>}
              </View>
              <Text style={[styles.stepLabel, filled && styles.stepLabelActive]}>{label}</Text>
            </View>
            {i < STEP_LABELS.length - 1 && <View style={styles.stepConnector} />}
          </React.Fragment>
        );
      })}
    </View>
  );
}

function MapDropdown({ value, onChange, colors, open, onToggle }: {
  value: FieldKey | ''; onChange: (v: FieldKey | '') => void; colors: AppColors; open: boolean; onToggle: () => void;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const current = FIELD_OPTIONS.find((o) => o.value === value)?.label || "Don't import";
  return (
    <View style={{ position: 'relative' }}>
      <Pressable style={styles.ddTrigger} onPress={onToggle} accessibilityRole="button">
        <Text style={styles.ddTriggerText} numberOfLines={1}>{current}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textDim} />
      </Pressable>
      {open && (
        <>
          <Pressable style={Platform.select({ web: styles.ddBackdropWeb, default: styles.ddBackdropNative }) as any} onPress={onToggle} />
          <View style={styles.ddMenu}>
            {FIELD_OPTIONS.map((o) => (
              <Pressable key={o.value || 'none'} style={({ hovered }: any) => [styles.ddItem, Platform.OS === 'web' && hovered && styles.ddItemHovered, o.value === value && styles.ddItemActive]} onPress={() => { onChange(o.value); onToggle(); }}>
                <Text style={[styles.ddItemText, o.value === value && styles.ddItemTextActive]}>{o.label}</Text>
                {o.value === value && <Feather name="check" size={13} color={colors.accentYellow} />}
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

export default function SchoolAdminTeacherBulkImportScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [fileName, setFileName] = useState('');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawGrid, setRawGrid] = useState<string[][]>([]);
  const [columnMap, setColumnMap] = useState<(FieldKey | '')[]>([]);
  const [openMapRow, setOpenMapRow] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [validRows, setValidRows] = useState<ParsedRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<InvalidRow[]>([]);
  const [mappingSkipped, setMappingSkipped] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dropNode, setDropNode] = useState<HTMLElement | null>(null);

  function resetAll() {
    setStep(1); setFileName(''); setRawHeaders([]); setRawGrid([]); setColumnMap([]);
    setMappingSkipped(false); setUploadError(''); setValidRows([]); setInvalidRows([]);
    setSubmitError(''); setResult(null); setSubmitting(false);
  }
  function handleCancel() { if (step === 1) navigation?.navigate?.('SchoolAdminTeachers'); else resetAll(); }

  // Same-origin anchor download (see note in the student bulk import): window.open
  // can be popup-blocked or open a blank/navigating tab that lands on the
  // dashboard; <a download> forces a real download without touching app nav.
  // Fetch as a blob and download the blob: URL. A plain same-origin anchor gets
  // intercepted by the SPA router (navigates to dashboard); a blob: URL can't be
  // intercepted, so this reliably saves to Downloads without navigating.
  async function downloadTeacherTemplate(ext: 'csv' | 'xlsx') {
    if (!user?.email || Platform.OS !== 'web') return;
    const url = `${SERVER_URL}/school-admin/teachers/template.${ext}?adminEmail=${encodeURIComponent(user.email)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `teachers_template.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch (e) {
      console.error('[template download] failed:', e);
    }
  }
  function downloadTemplate() { downloadTeacherTemplate('csv'); }
  function downloadTemplateXlsx() { downloadTeacherTemplate('xlsx'); }

  function finishGrid(grid: string[][], filename: string) {
    if (grid.length < 1) { setUploadError('That file looks empty. Make sure it has a header row and at least one teacher.'); return; }
    const headers = grid[0];
    const dataRows = grid.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
    if (dataRows.length === 0) { setUploadError('No teacher rows found below the header row.'); return; }
    setFileName(filename); setRawHeaders(headers); setRawGrid(dataRows); setColumnMap(headers.map(guessField));
  }
  function processFile(file: File) {
    setUploadError('');
    const isExcel = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = () => { try { finishGrid(isExcel ? xlsxToGrid(reader.result as ArrayBuffer) : parseCsv(String(reader.result || '')), file.name); } catch { setUploadError(`Could not read that file. Please upload a valid ${isExcel ? 'Excel' : 'CSV'} file.`); } };
    reader.onerror = () => setUploadError('Could not read that file. Please try again.');
    if (isExcel) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  }
  function chooseFile() {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
    input.onchange = () => { const f = input.files && input.files[0]; if (f) processFile(f); };
    input.click();
  }
  useEffect(() => {
    if (Platform.OS !== 'web' || !dropNode) return;
    const node = dropNode;
    const over = (e: DragEvent) => { e.preventDefault(); setDragActive(true); };
    const leave = (e: DragEvent) => { e.preventDefault(); setDragActive(false); };
    const drop = (e: DragEvent) => { e.preventDefault(); setDragActive(false); const f = e.dataTransfer?.files?.[0]; if (f) processFile(f); };
    node.addEventListener('dragover', over); node.addEventListener('dragleave', leave); node.addEventListener('drop', drop);
    return () => { node.removeEventListener('dragover', over); node.removeEventListener('dragleave', leave); node.removeEventListener('drop', drop); };
  }, [dropNode]);

  function updateMap(index: number, field: FieldKey | '') { setColumnMap((prev) => { const n = [...prev]; n[index] = field; return n; }); }
  const mergeGroups = useMemo(() => {
    const counts = new Map<string, number>();
    validRows.forEach((r) => { const e = r.email.trim().toLowerCase(); if (e) counts.set(e, (counts.get(e) || 0) + 1); });
    return Array.from(counts.values()).filter((n) => n > 1);
  }, [validRows]);
  const mergedTeacherCount = mergeGroups.length;
  const mergedRowCount = mergeGroups.reduce((sum, n) => sum + n, 0);

  const nameIsMapped = columnMap.includes('teacherName');
  const isFullyMapped = columnMap.length > 0 && nameIsMapped && columnMap.every((f) => f !== '');
  function goToMappingOrValidation() { if (isFullyMapped) { setMappingSkipped(true); runValidation(); } else { setMappingSkipped(false); setStep(2); } }

  // A teacher who handles more than one grade uses "|" to separate a group
  // per grade in the Grade and Subjects cells (matched by position — see the
  // template's sample rows). Group counts must match exactly, or a grade
  // could silently end up with the wrong subjects (or none at all).
  function pipeGroupError(rec: ParsedRow): string | null {
    const grades = rec.grade.split('|').map((s) => s.trim()).filter(Boolean);
    if (grades.length <= 1) return null;
    const subjectGroups = rec.subjects.split('|').map((s) => s.trim());
    if (subjectGroups.length !== grades.length) {
      return `Grade has ${grades.length} "|" groups but Subjects has ${subjectGroups.length} — they must match one-to-one`;
    }
    const curricula = rec.curriculum.split('|').map((s) => s.trim()).filter(Boolean);
    if (curricula.length > 1 && curricula.length !== grades.length) {
      return `Grade has ${grades.length} "|" groups but Curriculum has ${curricula.length} — use one Curriculum for all grades, or one per grade`;
    }
    return null;
  }

  function runValidation() {
    const valid: ParsedRow[] = [], invalid: InvalidRow[] = [];
    rawGrid.forEach((cells, i) => {
      const rec = emptyRow();
      columnMap.forEach((field, c) => { if (field) rec[field] = (cells[c] ?? '').trim(); });
      const rowNum = i + 2;
      if (!rec.teacherName) { invalid.push({ rowNum, reason: 'Missing Teacher Name' }); return; }
      if (rec.email && !EMAIL_RE.test(rec.email)) { invalid.push({ rowNum, reason: `Invalid Email "${rec.email}"` }); return; }
      const groupError = pipeGroupError(rec);
      if (groupError) { invalid.push({ rowNum, reason: groupError }); return; }
      valid.push(rec);
    });
    setValidRows(valid); setInvalidRows(invalid); setStep(3);
  }

  async function submitImport() {
    if (!user?.email || validRows.length === 0) return;
    setSubmitting(true); setSubmitError('');
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/teachers/bulk?adminEmail=${encodeURIComponent(user.email)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: validRows, fileName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setSubmitError(data?.error || 'Import failed. Please check your file and try again.'); return; }
      setResult({ created: data.created || 0, updated: data.updated || 0, errors: Array.isArray(data.errors) ? data.errors : [], credentials: Array.isArray(data.credentials) ? data.credentials : [] });
      setStep(5);
    } catch { setSubmitError('Import failed. Check your connection and try again.'); }
    finally { setSubmitting(false); }
  }

  function downloadCredentials() {
    if (!result || result.credentials.length === 0) return;
    const lines = [['Name', 'Login Email', 'Password', 'Role'].map(csvEscape).join(',')];
    result.credentials.forEach((c) => lines.push([c.name, c.email, c.password, c.role].map((v) => csvEscape(v || '')).join(',')));
    downloadCsv('aivorah-teacher-credentials.csv', lines.join('\n'));
  }

  const subtitleByStep: Record<number, string> = {
    1: 'Upload a CSV file, map its columns, validate the data, and import.',
    2: 'Match each column in your file to a field in Aivorah.',
    3: 'We checked your rows for missing or malformed data.',
    4: 'Confirm the teachers you’re about to import.',
    5: 'Import complete.',
  };

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header title="Bulk Import Teachers" subtitle={subtitleByStep[step]} onMenuPress={() => navigation?.openDrawer?.()} />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <StepIndicator step={step} colors={colors} />
            {step === 1 && (
              <View style={styles.templateBtnGroup}>
                <TouchableOpacity style={styles.templateBtn} onPress={downloadTemplate}><Feather name="file-text" size={14} color={colors.textHeading} /><Text style={styles.templateBtnText}>CSV Template</Text></TouchableOpacity>
                <TouchableOpacity style={styles.templateBtn} onPress={downloadTemplateXlsx}><Feather name="grid" size={14} color={colors.textHeading} /><Text style={styles.templateBtnText}>Excel Template</Text></TouchableOpacity>
              </View>
            )}
          </View>

          {step === 1 && (
            <>
              <Pressable ref={setDropNode as any} onPress={chooseFile} accessibilityRole="button" style={[styles.dropzone, dragActive && styles.dropzoneActive]}>
                <View style={styles.dropzoneIconWrap}><Feather name="upload" size={22} color={colors.accentYellow} /></View>
                <Text style={styles.dropzoneTitle}>Drop your CSV or Excel file here, or click to browse</Text>
                <Text style={styles.dropzoneSub}>Up to 2,000 rows per import. Filled in the Excel template? Use "Save As → CSV" first.</Text>
                <Text style={styles.dropzoneSub}>Teaching more than one grade? Use "|" in the Grade and Subjects cells, e.g. Grade "Grade 1 | Grade 3", Subjects "Social | Maths" — one row, one teacher.</Text>
                {!!fileName && (
                  <View style={styles.fileChip}><Feather name="file-text" size={14} color={colors.textMuted} /><Text style={styles.fileChipText} numberOfLines={1}>{fileName}</Text><Text style={styles.fileChipCount}>{rawGrid.length} row{rawGrid.length === 1 ? '' : 's'}</Text></View>
                )}
              </Pressable>
              {!!uploadError && <View style={styles.emptyBox}><Feather name="alert-circle" size={22} color={colors.textDim} /><Text style={styles.emptyText}>{uploadError}</Text></View>}
              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={handleCancel}><Text style={styles.secondaryBtnText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.primaryBtn, rawGrid.length === 0 && styles.primaryBtnDisabled]} disabled={rawGrid.length === 0} onPress={goToMappingOrValidation}>
                  <Text style={styles.primaryBtnText}>{rawGrid.length > 0 && isFullyMapped ? 'Continue to Validation' : 'Continue to Mapping'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Map your columns</Text>
                <Text style={styles.cardSub}>We matched what we could recognize — adjust any that look wrong.</Text>
                <View style={styles.mapList}>
                  {rawHeaders.map((h, i) => (
                    <View key={i} style={[styles.mapRow, openMapRow === i && styles.mapRowOpen]}>
                      <View style={styles.mapSource}><Feather name="file-text" size={13} color={colors.textDim} /><Text style={styles.mapSourceText} numberOfLines={1}>{h || `Column ${i + 1}`}</Text></View>
                      <Feather name="arrow-right" size={14} color={colors.textDim} />
                      <View style={styles.mapTargetWrap}>
                        <MapDropdown value={columnMap[i] || ''} onChange={(v) => updateMap(i, v)} colors={colors} open={openMapRow === i} onToggle={() => setOpenMapRow((p) => (p === i ? null : i))} />
                      </View>
                    </View>
                  ))}
                </View>
                {!nameIsMapped && <View style={styles.warnBox}><Feather name="alert-triangle" size={14} color={colors.accentYellow} /><Text style={styles.warnBoxText}>Map at least one column to "Teacher Name" to continue.</Text></View>}
              </View>
              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(1)}><Text style={styles.secondaryBtnText}>Back</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.primaryBtn, !nameIsMapped && styles.primaryBtnDisabled]} disabled={!nameIsMapped} onPress={runValidation}><Text style={styles.primaryBtnText}>Continue to Validation</Text></TouchableOpacity>
              </View>
            </>
          )}

          {step === 3 && (
            <>
              <View style={styles.summaryCard}>
                <View style={[styles.summaryIcon, invalidRows.length > 0 && { backgroundColor: colors.accentYellow }]}><Feather name={invalidRows.length > 0 ? 'alert-triangle' : 'check'} size={20} color="#0B0B0B" /></View>
                <Text style={styles.summaryTitle}>{invalidRows.length === 0 ? 'All rows look good' : `${invalidRows.length} row${invalidRows.length === 1 ? '' : 's'} need attention`}</Text>
                <View style={styles.statRow}>
                  <View style={styles.statBox}><Text style={styles.statNum}>{validRows.length}</Text><Text style={styles.statLabel}>Valid</Text></View>
                  <View style={styles.statBox}><Text style={[styles.statNum, invalidRows.length > 0 && { color: colors.accentRed }]}>{invalidRows.length}</Text><Text style={styles.statLabel}>Skipped</Text></View>
                </View>
              </View>
              {invalidRows.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Rows that will be skipped</Text>
                  <View style={styles.errorList}>{invalidRows.map((e, i) => (<View key={i} style={styles.errorRow}><View style={styles.errorBadge}><Text style={styles.errorBadgeText}>Row {e.rowNum}</Text></View><Text style={styles.errorMsg}>{e.reason}</Text></View>))}</View>
                </View>
              )}
              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(mappingSkipped ? 1 : 2)}><Text style={styles.secondaryBtnText}>Back</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.primaryBtn, validRows.length === 0 && styles.primaryBtnDisabled]} disabled={validRows.length === 0} onPress={() => setStep(4)}><Text style={styles.primaryBtnText}>Continue to Review</Text></TouchableOpacity>
              </View>
            </>
          )}

          {step === 4 && (
            <>
              <View style={styles.previewHeader}><Text style={styles.previewCount}>{validRows.length} row{validRows.length === 1 ? '' : 's'} ready to import</Text></View>
              {mergedTeacherCount > 0 && (
                <View style={styles.warnBox}>
                  <Feather name="info" size={14} color={colors.accentYellow} />
                  <Text style={styles.warnBoxText}>{mergedRowCount} rows share an email with another row — they'll merge into {mergedTeacherCount} teacher account{mergedTeacherCount === 1 ? '' : 's'} with multiple grades, not separate teachers.</Text>
                </View>
              )}
              <View style={styles.table}>
                <View style={styles.theadRow}>
                  <View style={styles.pName}><Text style={styles.thText}>Teacher</Text></View>
                  <View style={styles.pEmail}><Text style={styles.thText}>Email</Text></View>
                  <View style={styles.pSub}><Text style={styles.thText}>Curriculum · Grade</Text></View>
                  <View style={styles.pSub}><Text style={styles.thText}>Subjects</Text></View>
                  <View style={styles.pPhone}><Text style={styles.thText}>Phone</Text></View>
                </View>
                <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                  {validRows.map((r, i) => (
                    <View key={i} style={[styles.tr, i === validRows.length - 1 && styles.trLast]}>
                      <View style={styles.pName}><Text style={styles.tdStrong} numberOfLines={1}>{r.teacherName || '—'}</Text></View>
                      <View style={styles.pEmail}><Text style={styles.td} numberOfLines={1}>{r.email || 'auto-generated'}</Text></View>
                      <View style={styles.pSub}><Text style={styles.td} numberOfLines={1}>{[r.curriculum, r.grade].filter(Boolean).join(' · ') || '—'}</Text></View>
                      <View style={styles.pSub}><Text style={styles.td} numberOfLines={1}>{r.subjects || '—'}</Text></View>
                      <View style={styles.pPhone}><Text style={styles.td} numberOfLines={1}>{r.phone || '—'}</Text></View>
                    </View>
                  ))}
                </ScrollView>
              </View>
              {!!submitError && <View style={styles.emptyBox}><Feather name="alert-circle" size={22} color={colors.textDim} /><Text style={styles.emptyText}>{submitError}</Text></View>}
              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(3)} disabled={submitting}><Text style={styles.secondaryBtnText}>Back</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.primaryBtn, submitting && styles.primaryBtnDisabled]} onPress={submitImport} disabled={submitting}>
                  {submitting ? <ActivityIndicator color="#0B0B0B" size="small" /> : <Text style={styles.primaryBtnText}>Import {validRows.length} Teacher{validRows.length === 1 ? '' : 's'}</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === 5 && result && (
            <>
              <View style={styles.summaryCard}>
                <View style={styles.summaryIcon}><Feather name="check" size={20} color="#0B0B0B" /></View>
                <Text style={styles.summaryTitle}>Import finished</Text>
                <View style={styles.statRow}>
                  <View style={styles.statBox}><Text style={styles.statNum}>{result.created}</Text><Text style={styles.statLabel}>Created</Text></View>
                  <View style={styles.statBox}><Text style={[styles.statNum, result.errors.length > 0 && { color: colors.accentRed }]}>{result.errors.length}</Text><Text style={styles.statLabel}>Errors</Text></View>
                </View>
              </View>
              {result.errors.length > 0 && (
                <View style={styles.card}><Text style={styles.cardTitle}>Rows that couldn't be imported</Text><View style={styles.errorList}>{result.errors.map((e, i) => (<View key={i} style={styles.errorRow}><View style={styles.errorBadge}><Text style={styles.errorBadgeText}>Row {e.row}</Text></View><Text style={styles.errorMsg}>{e.error}</Text></View>))}</View></View>
              )}
              {result.credentials.length > 0 && (
                <View style={styles.card}>
                  <View style={styles.credHeader}>
                    <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.cardTitle}>Login credentials ({result.credentials.length})</Text><Text style={styles.warnText}>Save these now — passwords won't be shown again.</Text></View>
                    {Platform.OS === 'web' && <TouchableOpacity style={styles.secondaryBtn} onPress={downloadCredentials}><Feather name="download" size={14} color={colors.textHeading} /><Text style={styles.secondaryBtnText}>Download CSV</Text></TouchableOpacity>}
                  </View>
                  <View style={styles.table}>
                    <View style={styles.theadRow}>
                      <View style={styles.colName}><Text style={styles.thText}>Name</Text></View>
                      <View style={styles.colEmail}><Text style={styles.thText}>Login Email</Text></View>
                      <View style={styles.colPass}><Text style={styles.thText}>Password</Text></View>
                    </View>
                    <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                      {result.credentials.map((c, i) => (
                        <View key={i} style={[styles.tr, i === result.credentials.length - 1 && styles.trLast]}>
                          <View style={styles.colName}><Text style={styles.tdStrong} numberOfLines={1}>{c.name || '—'}</Text></View>
                          <View style={styles.colEmail}><Text style={styles.td} numberOfLines={1} selectable>{c.email || '—'}</Text></View>
                          <View style={styles.colPass}><Text style={styles.tdMono} numberOfLines={1} selectable>{c.password || '—'}</Text></View>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              )}
              <TouchableOpacity style={styles.primaryBtn} onPress={resetAll}><Feather name="upload" size={15} color="#0B0B0B" /><Text style={styles.primaryBtnText}>Import another file</Text></TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bgDark },
    content: { padding: spacing.xl, paddingBottom: 60, width: '100%', maxWidth: 960, alignSelf: 'center' },
    stepperRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
    stepItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.borderColor, backgroundColor: colors.cardDark },
    stepCircleActive: { backgroundColor: colors.accentYellow, borderColor: colors.accentYellow },
    stepCircleText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.textDim },
    stepCircleTextActive: { color: '#0B0B0B' },
    stepLabel: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textDim },
    stepLabelActive: { color: colors.textHeading, fontWeight: '700' },
    stepConnector: { width: 28, height: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.borderColor, marginHorizontal: 10 },
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: spacing.xl, flexWrap: 'wrap' },
    templateBtnGroup: { flexDirection: 'row', gap: 8 },
    templateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingHorizontal: 14, height: 38 },
    templateBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.textHeading },
    dropzone: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderColor, backgroundColor: colors.cardDark, borderRadius: radius.lg, paddingVertical: 48, paddingHorizontal: 24, alignItems: 'center', gap: 6, marginBottom: spacing.lg },
    dropzoneActive: { borderColor: colors.accentYellow, backgroundColor: `${colors.accentYellow}0D` },
    dropzoneIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: `${colors.accentYellow}18`, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
    dropzoneTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: colors.textHeading },
    dropzoneSub: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted, textAlign: 'center', lineHeight: 18, maxWidth: 440 },
    fileChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8, marginTop: 14, maxWidth: '100%' },
    fileChipText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textHeading, flexShrink: 1 },
    fileChipCount: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim },
    footerRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: spacing.md },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingHorizontal: 18, height: 42 },
    primaryBtnDisabled: { opacity: 0.45 },
    primaryBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },
    secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingHorizontal: 16, height: 42 },
    secondaryBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading },
    card: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg },
    cardTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: colors.textHeading, marginBottom: 4 },
    cardSub: { fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted, marginBottom: 4, lineHeight: 17 },
    mapList: { marginTop: 14, gap: 10 },
    mapRow: { flexDirection: 'row', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1 },
    mapRowOpen: { zIndex: 50 },
    mapSource: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
    mapSourceText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textHeading, flexShrink: 1 },
    mapTargetWrap: { width: 220, flexShrink: 0 },
    warnBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, backgroundColor: `${colors.accentYellow}14`, borderWidth: 1, borderColor: `${colors.accentYellow}40`, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9 },
    warnBoxText: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '600', color: colors.textHeading, flex: 1 },
    ddTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark, borderRadius: radius.sm, paddingHorizontal: 12, height: 36 },
    ddTriggerText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textHeading, flexShrink: 1 },
    ddBackdropWeb: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 19 },
    ddBackdropNative: { position: 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 19 },
    ddMenu: { position: 'absolute', top: 40, right: 0, minWidth: 200, backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 4, zIndex: 21, maxHeight: 260, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
    ddItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 9 },
    ddItemHovered: { backgroundColor: colors.cardHover },
    ddItemActive: { backgroundColor: `${colors.accentYellow}14` },
    ddItemText: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted },
    ddItemTextActive: { color: colors.textHeading, fontWeight: '700' },
    previewHeader: { marginBottom: spacing.sm },
    previewCount: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading },
    table: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.lg },
    theadRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, backgroundColor: colors.cardHover, paddingVertical: 4 },
    thText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textDim, paddingVertical: 10, paddingHorizontal: 12 },
    tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, paddingVertical: 8 },
    trLast: { borderBottomWidth: 0 },
    td: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted, paddingHorizontal: 12 },
    tdStrong: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.textHeading, paddingHorizontal: 12 },
    tdMono: { fontFamily: Platform.select({ web: 'monospace', default: fonts.serif }), fontSize: 12.5, fontWeight: '600', color: colors.textHeading, paddingHorizontal: 12 },
    pName: { flex: 2, minWidth: 130 },
    pEmail: { flex: 2.4, minWidth: 160 },
    pSub: { flex: 2, minWidth: 120 },
    pPhone: { flex: 1.5, minWidth: 110 },
    colName: { flex: 2, minWidth: 130 },
    colEmail: { flex: 2.6, minWidth: 180 },
    colPass: { flex: 2, minWidth: 130 },
    summaryCard: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center' },
    summaryIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentGreen, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    summaryTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '700', color: colors.textHeading, marginBottom: 16 },
    statRow: { flexDirection: 'row', gap: 12, width: '100%', justifyContent: 'center' },
    statBox: { flex: 1, maxWidth: 160, alignItems: 'center', backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 14 },
    statNum: { fontFamily: fonts.serif, fontSize: 24, fontWeight: '700', color: colors.textHeading },
    statLabel: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textDim, marginTop: 4 },
    errorList: { marginTop: 10, gap: 8 },
    errorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    errorBadge: { backgroundColor: `${colors.accentRed}18`, borderWidth: 1, borderColor: `${colors.accentRed}55`, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
    errorBadgeText: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.accentRed },
    errorMsg: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted, flex: 1 },
    credHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
    warnText: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.accentYellow, marginTop: 3 },
    emptyBox: { alignItems: 'center', paddingTop: 20, paddingBottom: 20, gap: 10, paddingHorizontal: 24, marginBottom: spacing.md },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
  });
}
