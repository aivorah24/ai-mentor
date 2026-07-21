/**
 * School Admin — Bulk Import (V1 write access).
 *
 * Five-step wizard per the approved Claude design: Upload -> Map columns ->
 * Validate -> Review -> Results. Column mapping matters because admins export
 * their own spreadsheets with slightly different header names — mapping lets
 * them point any column at our fields instead of forcing an exact header
 * match. Validation runs client-side (required Student Name, email shape)
 * before Review, so obviously-bad rows never reach the server; the server
 * still does its own per-row validation (duplicate email etc.) and reports
 * those in the Results step.
 *
 * Re-themed to Aivorah's own system (Inter/fonts.serif, existing color
 * tokens, card/table conventions) to match SchoolAdminStudentsScreen.
 *
 * Contract:
 *   GET  /school-admin/students/template.csv?adminEmail=<email>
 *   POST /school-admin/students/bulk?adminEmail=<email>
 *        body { rows: [{ studentName, studentEmail, admissionNo, grade,
 *               section, parentName, parentEmail, parentPhone }] }
 *        -> { created, updated, errors: [{row, error}],
 *             credentials: [{name, email, password, role}] }
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

type FieldKey = 'studentName' | 'studentEmail' | 'admissionNo' | 'curriculum' | 'grade' | 'section' | 'parentName' | 'parentEmail' | 'parentPhone';

interface ParsedRow {
  studentName: string;
  studentEmail: string;
  admissionNo: string;
  curriculum: string;
  grade: string;
  section: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
}

interface InvalidRow {
  rowNum: number;
  reason: string;
}

interface ImportError {
  row: number;
  error: string;
}

interface Credential {
  name: string;
  email: string;
  password: string;
  role: string;
}

interface ImportResult {
  created: number;
  updated: number;
  errors: ImportError[];
  credentials: Credential[];
}

const STEP_LABELS = ['Upload', 'Map columns', 'Validate', 'Review', 'Results'];

const FIELD_OPTIONS: { value: FieldKey | ''; label: string }[] = [
  { value: '', label: "Don't import" },
  { value: 'studentName', label: 'Student Name' },
  { value: 'studentEmail', label: 'Student Email' },
  { value: 'admissionNo', label: 'Admission No' },
  { value: 'curriculum', label: 'Curriculum' },
  { value: 'grade', label: 'Grade' },
  { value: 'section', label: 'Section' },
  { value: 'parentName', label: 'Parent Name' },
  { value: 'parentEmail', label: 'Parent Email' },
  { value: 'parentPhone', label: 'Parent Phone' },
];

// ── Robust CSV parsing ──────────────────────────────────────────────────────
// Handles quoted cells containing commas and escaped double-quotes (""),
// CRLF/LF line endings, and skips fully-empty lines.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Excel cells come back as native strings/numbers/dates depending on how the
// admin typed them (e.g. a grade like "3" as a real number) — force every
// cell to a string so downstream mapping/validation matches the CSV path
// exactly, which is all strings by construction.
function xlsxToGrid(buffer: ArrayBuffer): string[][] {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  return rows.map((row) => row.map((cell) => String(cell ?? '').trim()));
}

// Header variants → default field guess (case-insensitive, trimmed). Used to
// pre-select the mapping step so most admins never have to touch it.
function guessField(header: string): FieldKey | '' {
  const h = header.trim().toLowerCase();
  switch (h) {
    case 'student name': case 'name': return 'studentName';
    case 'student email': case 'email': return 'studentEmail';
    case 'admission no': case 'admission number': case 'admission #': return 'admissionNo';
    case 'curriculum': case 'board': return 'curriculum';
    case 'grade': return 'grade';
    case 'section': return 'section';
    case 'parent name': return 'parentName';
    case 'parent email': return 'parentEmail';
    case 'parent phone': case 'parent contact': return 'parentPhone';
    default: return '';
  }
}

function emptyRow(): ParsedRow {
  return { studentName: '', studentEmail: '', admissionNo: '', curriculum: '', grade: '', section: '', parentName: '', parentEmail: '', parentPhone: '' };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Web download helpers ────────────────────────────────────────────────────
function csvEscape(value: string): string {
  const v = value ?? '';
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function downloadCsv(filename: string, content: string) {
  if (Platform.OS !== 'web') return;
  try {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    // no-op — non-web / restricted environments
  }
}

// ── Step indicator ──────────────────────────────────────────────────────────
function StepIndicator({ step, colors }: { step: number; colors: AppColors }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.stepperRow}>
      {STEP_LABELS.map((label, i) => {
        const num = i + 1;
        const active = num === step;
        const done = num < step;
        const filled = active || done;
        return (
          <React.Fragment key={label}>
            <View style={styles.stepItem}>
              <View style={[styles.stepCircle, filled && styles.stepCircleActive]}>
                {done ? (
                  <Feather name="check" size={13} color="#0B0B0B" />
                ) : (
                  <Text style={[styles.stepCircleText, filled && styles.stepCircleTextActive]}>{num}</Text>
                )}
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

// ── Lightweight dropdown for column mapping (same pattern as filters) ──────
// Controlled by the parent (open/onToggle), not local state — a MapDropdown
// only knowing its OWN open/closed state can elevate itself above its own
// menu, but not above the mapRow *below* it in the list. Every non-positioned
// sibling row still paints on top of an ancestor's z-index regardless of a
// deeply-nested descendant's z-index (same stacking-context gotcha fixed
// earlier on the Students screen filters) — so the row that owns the open
// dropdown needs ITS OWN elevated zIndex, set by the parent.
function MapDropdown({ value, onChange, colors, open, onToggle }: {
  value: FieldKey | ''; onChange: (v: FieldKey | '') => void; colors: AppColors;
  open: boolean; onToggle: () => void;
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
              <Pressable
                key={o.value || 'none'}
                style={({ hovered }: any) => [styles.ddItem, Platform.OS === 'web' && hovered && styles.ddItemHovered, o.value === value && styles.ddItemActive]}
                onPress={() => { onChange(o.value); onToggle(); }}
              >
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

export default function SchoolAdminBulkImportScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [fileName, setFileName] = useState('');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawGrid, setRawGrid] = useState<string[][]>([]);
  const [columnMap, setColumnMap] = useState<(FieldKey | '')[]>([]);
  const [mappingSkipped, setMappingSkipped] = useState(false);
  const [openMapRow, setOpenMapRow] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [validRows, setValidRows] = useState<ParsedRow[]>([]);
  const [invalidRows, setInvalidRows] = useState<InvalidRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  // Callback ref (via state, not useRef) — a plain ref mutation doesn't
  // trigger a re-render, so a useEffect keyed on `ref.current` never actually
  // re-fires once the DOM node attaches. Storing it in state makes the
  // attachment itself the trigger for wiring up drag-and-drop.
  const [dropNode, setDropNode] = useState<HTMLElement | null>(null);

  function resetAll() {
    setStep(1);
    setFileName('');
    setRawHeaders([]);
    setRawGrid([]);
    setColumnMap([]);
    setMappingSkipped(false);
    setUploadError('');
    setValidRows([]);
    setInvalidRows([]);
    setSubmitError('');
    setResult(null);
    setSubmitting(false);
  }

  function handleCancel() {
    if (step === 1) { navigation?.navigate?.('SchoolAdminStudents'); return; }
    resetAll();
  }

  // Use a same-origin anchor with the `download` attribute rather than
  // window.open — window.open can be popup-blocked or (in this SPA) open a
  // blank/navigating tab that lands on the dashboard instead of saving the
  // file. An <a download> forces a real download without touching app nav.
  // Fetch as a blob and download the blob: URL. A plain same-origin anchor gets
  // intercepted by the SPA router (navigates to dashboard); a blob: URL can't be
  // intercepted, so this reliably saves to Downloads without navigating.
  async function downloadServerTemplate(ext: 'csv' | 'xlsx') {
    if (!user?.email || Platform.OS !== 'web') return;
    const url = `${SERVER_URL}/school-admin/students/template.${ext}?adminEmail=${encodeURIComponent(user.email)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `students_template.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch (e) {
      console.error('[template download] failed:', e);
    }
  }

  function downloadTemplate() { downloadServerTemplate('csv'); }

  // CSV has no way to carry column widths/fonts/colors — opened directly in
  // Excel it always renders as narrow, unstyled default columns. The .xlsx
  // template is a properly formatted spreadsheet (bold header, sane widths,
  // borders) for admins who'd rather work from that.
  function downloadTemplateXlsx() { downloadServerTemplate('xlsx'); }

  function finishGrid(grid: string[][], filename: string) {
    if (grid.length < 1) {
      setUploadError('That file looks empty. Make sure it has a header row and at least one student.');
      return;
    }
    const headers = grid[0];
    const dataRows = grid.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
    if (dataRows.length === 0) {
      setUploadError('No student rows found below the header row.');
      return;
    }
    setFileName(filename);
    setRawHeaders(headers);
    setRawGrid(dataRows);
    setColumnMap(headers.map(guessField));
  }

  function processFile(file: File) {
    setUploadError('');
    const isExcel = /\.xlsx?$/i.test(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const grid = isExcel ? xlsxToGrid(reader.result as ArrayBuffer) : parseCsv(String(reader.result || ''));
        finishGrid(grid, file.name);
      } catch {
        setUploadError(`Could not read that file. Please upload a valid ${isExcel ? 'Excel' : 'CSV'} file.`);
      }
    };
    reader.onerror = () => setUploadError('Could not read that file. Please try again.');
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }

  function chooseFile() {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (file) processFile(file);
    };
    input.click();
  }

  // Native drag-and-drop wiring — react-native-web forwards the View ref to
  // the underlying DOM node, so we attach real drag events to it directly.
  // Depends on `dropNode` (state), not a ref, so it actually re-runs once the
  // node mounts.
  useEffect(() => {
    if (Platform.OS !== 'web' || !dropNode) return;
    const node = dropNode;
    const onDragOver = (e: DragEvent) => { e.preventDefault(); setDragActive(true); };
    const onDragLeave = (e: DragEvent) => { e.preventDefault(); setDragActive(false); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) processFile(file);
    };
    node.addEventListener('dragover', onDragOver);
    node.addEventListener('dragleave', onDragLeave);
    node.addEventListener('drop', onDrop);
    return () => {
      node.removeEventListener('dragover', onDragOver);
      node.removeEventListener('dragleave', onDragLeave);
      node.removeEventListener('drop', onDrop);
    };
  }, [dropNode]);

  function updateMap(index: number, field: FieldKey | '') {
    setColumnMap((prev) => {
      const next = [...prev];
      next[index] = field;
      return next;
    });
  }

  const nameIsMapped = columnMap.includes('studentName');
  // When every detected column mapped to a real field with no ambiguity
  // (i.e. the admin used our own template), Map Columns has nothing left to
  // confirm — skip straight to Validation. Anyone bringing their own
  // spreadsheet with different headers still gets the mapping step, since
  // auto-guess can miss or misalign columns there.
  const isFullyMapped = columnMap.length > 0 && nameIsMapped && columnMap.every((f) => f !== '');

  function goToMappingOrValidation() {
    if (isFullyMapped) { setMappingSkipped(true); runValidation(); }
    else { setMappingSkipped(false); setStep(2); }
  }

  function runValidation() {
    const valid: ParsedRow[] = [];
    const invalid: InvalidRow[] = [];
    rawGrid.forEach((cells, i) => {
      const rec = emptyRow();
      columnMap.forEach((field, c) => {
        if (!field) return;
        rec[field] = (cells[c] ?? '').trim();
      });
      const rowNum = i + 2; // +1 header, +1 to make it 1-indexed for the file
      if (!rec.studentName) {
        invalid.push({ rowNum, reason: 'Missing Student Name' });
        return;
      }
      if (rec.studentEmail && !EMAIL_RE.test(rec.studentEmail)) {
        invalid.push({ rowNum, reason: `Invalid Student Email "${rec.studentEmail}"` });
        return;
      }
      if (rec.parentEmail && !EMAIL_RE.test(rec.parentEmail)) {
        invalid.push({ rowNum, reason: `Invalid Parent Email "${rec.parentEmail}"` });
        return;
      }
      valid.push(rec);
    });
    setValidRows(valid);
    setInvalidRows(invalid);
    setStep(3);
  }

  async function submitImport() {
    if (!user?.email || validRows.length === 0) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch(`${SERVER_URL}/school-admin/students/bulk?adminEmail=${encodeURIComponent(user.email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: validRows, fileName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(data?.error || 'Import failed. Please check your file and try again.');
        return;
      }
      setResult({
        created: data.created || 0,
        updated: data.updated || 0,
        errors: Array.isArray(data.errors) ? data.errors : [],
        credentials: Array.isArray(data.credentials) ? data.credentials : [],
      });
      setStep(5);
    } catch {
      setSubmitError('Import failed. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function downloadCredentials() {
    if (!result || result.credentials.length === 0) return;
    const header = ['Name', 'Login Email', 'Password', 'Role'];
    const lines = [header.map(csvEscape).join(',')];
    result.credentials.forEach((c) => {
      lines.push([c.name, c.email, c.password, c.role].map((v) => csvEscape(v || '')).join(','));
    });
    downloadCsv('aivorah-credentials.csv', lines.join('\n'));
  }

  const subtitleByStep: Record<number, string> = {
    1: 'Upload a CSV file, map its columns, validate the data, and import.',
    2: 'Match each column in your file to a field in Aivorah.',
    3: 'We checked your rows for missing or malformed data.',
    4: 'Confirm the students and parents you’re about to import.',
    5: 'Import complete.',
  };

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Bulk Import Students"
          subtitle={subtitleByStep[step]}
          onMenuPress={() => navigation?.openDrawer?.()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <StepIndicator step={step} colors={colors} />
          </View>
          {step === 1 && (
            <View style={styles.templateBtnGroup}>
              <TouchableOpacity style={styles.templateBtn} onPress={downloadTemplate} accessibilityRole="button">
                <Feather name="file-text" size={14} color={colors.textHeading} />
                <Text style={styles.templateBtnText}>CSV Template</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.templateBtn} onPress={downloadTemplateXlsx} accessibilityRole="button">
                <Feather name="grid" size={14} color={colors.textHeading} />
                <Text style={styles.templateBtnText}>Excel Template</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Step 1: Upload ─────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <Pressable
                ref={setDropNode as any}
                onPress={chooseFile}
                accessibilityRole="button"
                accessibilityLabel="Choose a CSV or Excel file"
                style={[styles.dropzone, dragActive && styles.dropzoneActive]}
              >
                <View style={styles.dropzoneIconWrap}>
                  <Feather name="upload" size={22} color={colors.accentYellow} />
                </View>
                <Text style={styles.dropzoneTitle}>Drop your CSV or Excel file here, or click to browse</Text>
                <Text style={styles.dropzoneSub}>Up to 2,000 rows per import.</Text>
                {!!fileName && (
                  <View style={styles.fileChip}>
                    <Feather name="file-text" size={14} color={colors.textMuted} />
                    <Text style={styles.fileChipText} numberOfLines={1}>{fileName}</Text>
                    <Text style={styles.fileChipCount}>{rawGrid.length} row{rawGrid.length === 1 ? '' : 's'}</Text>
                  </View>
                )}
              </Pressable>

              {!!uploadError && (
                <View style={styles.emptyBox}>
                  <Feather name="alert-circle" size={22} color={colors.textDim} />
                  <Text style={styles.emptyText}>{uploadError}</Text>
                </View>
              )}

              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={handleCancel} accessibilityRole="button">
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, rawGrid.length === 0 && styles.primaryBtnDisabled]}
                  disabled={rawGrid.length === 0}
                  onPress={goToMappingOrValidation}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryBtnText}>
                    {rawGrid.length > 0 && isFullyMapped ? 'Continue to Validation' : 'Continue to Mapping'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── Step 2: Map columns ────────────────────────────────────── */}
          {step === 2 && (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Map your columns</Text>
                <Text style={styles.cardSub}>We matched what we could recognize — adjust any that look wrong.</Text>
                <View style={styles.mapList}>
                  {rawHeaders.map((h, i) => (
                    <View key={i} style={[styles.mapRow, openMapRow === i && styles.mapRowOpen]}>
                      <View style={styles.mapSource}>
                        <Feather name="file-text" size={13} color={colors.textDim} />
                        <Text style={styles.mapSourceText} numberOfLines={1}>{h || `Column ${i + 1}`}</Text>
                      </View>
                      <Feather name="arrow-right" size={14} color={colors.textDim} />
                      <View style={styles.mapTargetWrap}>
                        <MapDropdown
                          value={columnMap[i] || ''}
                          onChange={(v) => updateMap(i, v)}
                          colors={colors}
                          open={openMapRow === i}
                          onToggle={() => setOpenMapRow((prev) => (prev === i ? null : i))}
                        />
                      </View>
                    </View>
                  ))}
                </View>
                {!nameIsMapped && (
                  <View style={styles.warnBox}>
                    <Feather name="alert-triangle" size={14} color={colors.accentYellow} />
                    <Text style={styles.warnBoxText}>Map at least one column to "Student Name" to continue.</Text>
                  </View>
                )}
              </View>

              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(1)} accessibilityRole="button">
                  <Text style={styles.secondaryBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, !nameIsMapped && styles.primaryBtnDisabled]}
                  disabled={!nameIsMapped}
                  onPress={runValidation}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryBtnText}>Continue to Validation</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── Step 3: Validate ───────────────────────────────────────── */}
          {step === 3 && (
            <>
              <View style={styles.summaryCard}>
                <View style={[styles.summaryIcon, invalidRows.length > 0 && { backgroundColor: colors.accentYellow }]}>
                  <Feather name={invalidRows.length > 0 ? 'alert-triangle' : 'check'} size={20} color="#0B0B0B" />
                </View>
                <Text style={styles.summaryTitle}>
                  {invalidRows.length === 0 ? 'All rows look good' : `${invalidRows.length} row${invalidRows.length === 1 ? '' : 's'} need attention`}
                </Text>
                <View style={styles.statRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statNum}>{validRows.length}</Text>
                    <Text style={styles.statLabel}>Valid</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={[styles.statNum, invalidRows.length > 0 && { color: colors.accentRed }]}>{invalidRows.length}</Text>
                    <Text style={styles.statLabel}>Skipped</Text>
                  </View>
                </View>
              </View>

              {invalidRows.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Rows that will be skipped</Text>
                  <Text style={styles.cardSub}>These won't be imported. Fix them in your file and re-upload, or continue without them.</Text>
                  <View style={styles.errorList}>
                    {invalidRows.map((e, i) => (
                      <View key={i} style={styles.errorRow}>
                        <View style={styles.errorBadge}><Text style={styles.errorBadgeText}>Row {e.rowNum}</Text></View>
                        <Text style={styles.errorMsg}>{e.reason}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(mappingSkipped ? 1 : 2)} accessibilityRole="button">
                  <Text style={styles.secondaryBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, validRows.length === 0 && styles.primaryBtnDisabled]}
                  disabled={validRows.length === 0}
                  onPress={() => setStep(4)}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryBtnText}>Continue to Review</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── Step 4: Review ─────────────────────────────────────────── */}
          {step === 4 && (
            <>
              <View style={styles.previewHeader}>
                <Text style={styles.previewCount}>{validRows.length} row{validRows.length === 1 ? '' : 's'} ready to import</Text>
              </View>
              <View style={styles.table}>
                <View style={styles.theadRow}>
                  <View style={styles.pName}><Text style={styles.thText}>Student</Text></View>
                  <View style={styles.pEmail}><Text style={styles.thText}>Student Email</Text></View>
                  <View style={styles.pCurric}><Text style={styles.thText}>Curriculum</Text></View>
                  <View style={styles.pGrade}><Text style={styles.thText}>Grade · Sec</Text></View>
                  <View style={styles.pParent}><Text style={styles.thText}>Parent</Text></View>
                  <View style={styles.pPhone}><Text style={styles.thText}>Parent Phone</Text></View>
                </View>
                <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                  {validRows.map((r, i) => (
                    <View key={i} style={[styles.tr, i === validRows.length - 1 && styles.trLast]}>
                      <View style={styles.pName}><Text style={styles.tdStrong} numberOfLines={1}>{r.studentName || '—'}</Text></View>
                      <View style={styles.pEmail}><Text style={styles.td} numberOfLines={1}>{r.studentEmail || '—'}</Text></View>
                      <View style={styles.pCurric}><Text style={styles.td} numberOfLines={1}>{r.curriculum || '—'}</Text></View>
                      <View style={styles.pGrade}><Text style={styles.td} numberOfLines={1}>{[r.grade, r.section].filter(Boolean).join(' · ') || '—'}</Text></View>
                      <View style={styles.pParent}>
                        <Text style={styles.tdStrong} numberOfLines={1}>{r.parentName || '—'}</Text>
                        {!!r.parentEmail && <Text style={styles.tdSub} numberOfLines={1}>{r.parentEmail}</Text>}
                      </View>
                      <View style={styles.pPhone}><Text style={styles.td} numberOfLines={1}>{r.parentPhone || '—'}</Text></View>
                    </View>
                  ))}
                </ScrollView>
              </View>

              {!!submitError && (
                <View style={styles.emptyBox}>
                  <Feather name="alert-circle" size={22} color={colors.textDim} />
                  <Text style={styles.emptyText}>{submitError}</Text>
                </View>
              )}

              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(3)} accessibilityRole="button" disabled={submitting}>
                  <Text style={styles.secondaryBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, submitting && styles.primaryBtnDisabled]}
                  onPress={submitImport}
                  disabled={submitting}
                  accessibilityRole="button"
                >
                  {submitting ? (
                    <ActivityIndicator color="#0B0B0B" size="small" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Import {validRows.length} Student{validRows.length === 1 ? '' : 's'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── Step 5: Results ────────────────────────────────────────── */}
          {step === 5 && result && (
            <>
              <View style={styles.summaryCard}>
                <View style={styles.summaryIcon}><Feather name="check" size={20} color="#0B0B0B" /></View>
                <Text style={styles.summaryTitle}>Import finished</Text>
                <View style={styles.statRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statNum}>{result.created}</Text>
                    <Text style={styles.statLabel}>Created</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statNum}>{result.updated}</Text>
                    <Text style={styles.statLabel}>Updated</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={[styles.statNum, result.errors.length > 0 && { color: colors.accentRed }]}>{result.errors.length}</Text>
                    <Text style={styles.statLabel}>Errors</Text>
                  </View>
                </View>
              </View>

              {result.errors.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Rows that couldn't be imported</Text>
                  <View style={styles.errorList}>
                    {result.errors.map((e, i) => (
                      <View key={i} style={styles.errorRow}>
                        <View style={styles.errorBadge}><Text style={styles.errorBadgeText}>Row {e.row}</Text></View>
                        <Text style={styles.errorMsg}>{e.error}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {result.credentials.length > 0 && (
                <View style={styles.card}>
                  <View style={styles.credHeader}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.cardTitle}>Login credentials ({result.credentials.length})</Text>
                      <Text style={styles.warnText}>Save these now — passwords won't be shown again.</Text>
                    </View>
                    {Platform.OS === 'web' && (
                      <TouchableOpacity style={styles.secondaryBtn} onPress={downloadCredentials} accessibilityRole="button">
                        <Feather name="download" size={14} color={colors.textHeading} />
                        <Text style={styles.secondaryBtnText}>Download CSV</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <View style={styles.table}>
                    <View style={styles.theadRow}>
                      <View style={styles.colName}><Text style={styles.thText}>Name</Text></View>
                      <View style={styles.colEmail}><Text style={styles.thText}>Login Email</Text></View>
                      <View style={styles.colPass}><Text style={styles.thText}>Password</Text></View>
                      <View style={styles.colRole}><Text style={styles.thText}>Role</Text></View>
                    </View>
                    <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                      {result.credentials.map((c, i) => (
                        <View key={i} style={[styles.tr, i === result.credentials.length - 1 && styles.trLast]}>
                          <View style={styles.colName}><Text style={styles.tdStrong} numberOfLines={1}>{c.name || '—'}</Text></View>
                          <View style={styles.colEmail}><Text style={styles.td} numberOfLines={1} selectable>{c.email || '—'}</Text></View>
                          <View style={styles.colPass}><Text style={styles.tdMono} numberOfLines={1} selectable>{c.password || '—'}</Text></View>
                          <View style={styles.colRole}><Text style={styles.td} numberOfLines={1}>{c.role || '—'}</Text></View>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              )}

              <TouchableOpacity style={styles.primaryBtn} onPress={resetAll} accessibilityRole="button">
                <Feather name="upload" size={15} color="#0B0B0B" />
                <Text style={styles.primaryBtnText}>Import another file</Text>
              </TouchableOpacity>
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
    // Unlike a data table (which should fill the screen), a step-wizard's
    // cards read as unprofessional when stretched edge-to-edge across a wide
    // viewport — and worse, they visually jump in width every time the
    // sidebar collapses/expands. Capping + centering keeps this wizard a
    // stable, comfortable width regardless of sidebar state.
    content: { padding: spacing.xl, paddingBottom: 60, width: '100%', maxWidth: 960, alignSelf: 'center' },

    // ── Step indicator ──────────────────────────────────────────────────
    stepperRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
    stepItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepCircle: {
      width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderColor: colors.borderColor, backgroundColor: colors.cardDark,
    },
    stepCircleActive: { backgroundColor: colors.accentYellow, borderColor: colors.accentYellow },
    stepCircleText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.textDim },
    stepCircleTextActive: { color: '#0B0B0B' },
    stepLabel: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textDim },
    stepLabelActive: { color: colors.textHeading, fontWeight: '700' },
    stepConnector: { width: 28, height: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.borderColor, marginHorizontal: 10 },

    // ── Dropzone ──────────────────────────────────────────────────────────
    dropzone: {
      borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderColor,
      backgroundColor: colors.cardDark, borderRadius: radius.lg,
      paddingVertical: 48, paddingHorizontal: 24, alignItems: 'center', gap: 6,
      marginBottom: spacing.lg,
    },
    dropzoneActive: { borderColor: colors.accentYellow, backgroundColor: `${colors.accentYellow}0D` },
    dropzoneIconWrap: {
      width: 44, height: 44, borderRadius: 22, backgroundColor: `${colors.accentYellow}18`,
      alignItems: 'center', justifyContent: 'center', marginBottom: 6,
    },
    dropzoneTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: colors.textHeading },
    dropzoneSub: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted, textAlign: 'center', lineHeight: 18, maxWidth: 420 },

    topBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, marginBottom: spacing.xl, flexWrap: 'wrap',
    },
    templateBtnGroup: { flexDirection: 'row', gap: 8, justifyContent: 'center', width: '100%', marginBottom: spacing.lg },
    templateBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
      backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.sm, paddingHorizontal: 14, height: 38,
    },
    templateBtnText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.textHeading },

    fileChip: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8, marginTop: 14, maxWidth: '100%',
    },
    fileChipText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textHeading, flexShrink: 1 },
    fileChipCount: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.textDim },

    // ── Footer buttons ────────────────────────────────────────────────────
    footerRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: spacing.md },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
      backgroundColor: colors.accentYellow, borderRadius: radius.sm, paddingHorizontal: 18, height: 42,
    },
    primaryBtnDisabled: { opacity: 0.45 },
    primaryBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: '#0B0B0B' },
    secondaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.sm, paddingHorizontal: 16, height: 42,
    },
    secondaryBtnText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading },

    // ── Generic card ──────────────────────────────────────────────────────
    card: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg,
    },
    cardTitle: { fontFamily: fonts.serif, fontSize: 15, fontWeight: '700', color: colors.textHeading, marginBottom: 4 },
    cardSub: { fontFamily: fonts.serif, fontSize: 12, color: colors.textMuted, marginBottom: 4, lineHeight: 17 },

    // ── Column mapping ────────────────────────────────────────────────────
    mapList: { marginTop: 14, gap: 10 },
    mapRow: { flexDirection: 'row', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1 },
    mapRowOpen: { zIndex: 50 },
    mapSource: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
    mapSourceText: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '600', color: colors.textHeading, flexShrink: 1 },
    mapTargetWrap: { width: 220, flexShrink: 0 },
    warnBox: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14,
      backgroundColor: `${colors.accentYellow}14`, borderWidth: 1, borderColor: `${colors.accentYellow}40`,
      borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9,
    },
    warnBoxText: { fontFamily: fonts.serif, fontSize: 12, fontWeight: '600', color: colors.textHeading, flex: 1 },

    // ── Dropdown (column mapping select) ─────────────────────────────────
    ddTrigger: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      borderWidth: 1, borderColor: colors.borderColor, backgroundColor: colors.bgDark,
      borderRadius: radius.sm, paddingHorizontal: 12, height: 36,
    },
    ddTriggerText: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '600', color: colors.textHeading, flexShrink: 1 },
    ddBackdropWeb: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 19 },
    ddBackdropNative: { position: 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 19 },
    ddMenu: {
      position: 'absolute', top: 40, right: 0, minWidth: 200, backgroundColor: colors.cardDark,
      borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 4,
      zIndex: 21, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8,
      // Same fix as the sibling Students/Add Student screens — cap the
      // absolutely-positioned container itself, not just an inner scroller
      // (this menu's option list is short today, but this keeps it safe if
      // that ever changes).
      maxHeight: 260, overflow: 'hidden',
    },
    ddItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 9 },
    ddItemHovered: { backgroundColor: colors.cardHover },
    ddItemActive: { backgroundColor: `${colors.accentYellow}14` },
    ddItemText: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted },
    ddItemTextActive: { color: colors.textHeading, fontWeight: '700' },

    previewHeader: { marginBottom: spacing.sm },
    previewCount: { fontFamily: fonts.serif, fontSize: 13, fontWeight: '700', color: colors.textHeading },

    // ── Table ───────────────────────────────────────────────────────────
    table: { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.lg },
    theadRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, backgroundColor: colors.cardHover, paddingVertical: 4 },
    thText: { fontFamily: fonts.serif, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textDim, paddingVertical: 10, paddingHorizontal: 12 },
    tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.borderColor, paddingVertical: 8 },
    trLast: { borderBottomWidth: 0 },
    td: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted, paddingHorizontal: 12 },
    tdStrong: { fontFamily: fonts.serif, fontSize: 12.5, fontWeight: '700', color: colors.textHeading, paddingHorizontal: 12 },
    tdSub: { fontFamily: fonts.serif, fontSize: 11, color: colors.textDim, paddingHorizontal: 12, marginTop: 1 },
    tdMono: { fontFamily: Platform.select({ web: 'monospace', default: fonts.serif }), fontSize: 12.5, fontWeight: '600', color: colors.textHeading, paddingHorizontal: 12 },

    // preview columns (proportional flex)
    pName: { flex: 2, minWidth: 130 },
    pEmail: { flex: 2.4, minWidth: 160 },
    pCurric: { flex: 1.2, minWidth: 90 },
    pGrade: { flex: 1.3, minWidth: 100 },
    pParent: { flex: 2, minWidth: 140 },
    pPhone: { flex: 1.5, minWidth: 110 },

    // credentials columns
    colName: { flex: 2, minWidth: 130 },
    colEmail: { flex: 2.6, minWidth: 180 },
    colPass: { flex: 2, minWidth: 130 },
    colRole: { flex: 1.2, minWidth: 90 },

    // ── Results summary ─────────────────────────────────────────────────
    summaryCard: {
      backgroundColor: colors.cardDark, borderWidth: 1, borderColor: colors.borderColor,
      borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center',
    },
    summaryIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentGreen, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    summaryTitle: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '700', color: colors.textHeading, marginBottom: 16 },
    statRow: { flexDirection: 'row', gap: 12, width: '100%', justifyContent: 'center' },
    statBox: { flex: 1, maxWidth: 160, alignItems: 'center', backgroundColor: colors.bgDark, borderWidth: 1, borderColor: colors.borderColor, borderRadius: radius.sm, paddingVertical: 14 },
    statNum: { fontFamily: fonts.serif, fontSize: 24, fontWeight: '700', color: colors.textHeading },
    statLabel: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', color: colors.textDim, marginTop: 4 },

    // ── Errors list ─────────────────────────────────────────────────────
    errorList: { marginTop: 10, gap: 8 },
    errorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    errorBadge: { backgroundColor: `${colors.accentRed}18`, borderWidth: 1, borderColor: `${colors.accentRed}55`, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
    errorBadgeText: { fontFamily: fonts.serif, fontSize: 11, fontWeight: '700', color: colors.accentRed },
    errorMsg: { fontFamily: fonts.serif, fontSize: 12.5, color: colors.textMuted, flex: 1 },

    // ── Credentials ─────────────────────────────────────────────────────
    credHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
    warnText: { fontFamily: fonts.serif, fontSize: 11.5, color: colors.accentYellow, marginTop: 3 },

    // ── Empty / error state ─────────────────────────────────────────────
    emptyBox: { alignItems: 'center', paddingTop: 20, paddingBottom: 20, gap: 10, paddingHorizontal: 24, marginBottom: spacing.md },
    emptyText: { fontFamily: fonts.serif, fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
  });
}
