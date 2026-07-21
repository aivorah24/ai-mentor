/**
 * TeacherSyllabusImportScreen.tsx — Mode B: Smart AI Syllabus Import.
 * 4-panel flow: Upload → AI analysing → Detected changes (preview, no writes
 * yet) → Review & Publish. Publish diffs against whatever is currently live.
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius, fonts } from '../../theme';
import SERVER_URL from '../../config/serverUrl';
import { getSubjectsForEntry } from '../school-admin/TeachingEntriesEditor';

// ── Canonical extraction types (Stage 1 output — the single source of truth) ──
// Mirrors server/services/syllabusExtraction.js exactly. The Preview Generator
// renders ONLY from this shape — no other draft/legacy structure is read.
type ResourceStatus = 'READY' | 'COMING_SOON' | 'UNDER_REVIEW' | 'NOT_AVAILABLE';
type Practice = { question: string; options: string[]; correctIndex: number; confidence?: number };
type ImageRef = { description: string; page?: string; confidence?: number };
type ActivityRef = { text: string; confidence?: number };
type VocabRef = { word: string; meaning: string; confidence?: number };
type ObjectiveRef = { text: string; confidence?: number };
type Topic = {
  name: string; kind: string; page: string; confidence?: number;
  summary?: string; summaryConfidence?: number;
  images?: ImageRef[]; activities?: ActivityRef[]; vocabulary?: VocabRef[];
  learningObjectives?: ObjectiveRef[]; practice?: Practice;
};
type Unit = { unitNo: number; title: string; confidence?: number; topics: Topic[] };
type Canonical = {
  jobId?: string; extractedAt?: string; extractionMs?: number;
  book?: { title: string; confidence?: number };
  units: Unit[];
  overallConfidence: number;
  warnings: string[];
};
type Diff = { addedTopics: string[]; removedTopics: string[]; addedUnits: string[]; removedUnits: string[]; unitCountBefore: number; topicCountBefore: number };
type Phase = 'idle' | 'analysing' | 'preview' | 'reviewing' | 'published';

const CONFIDENCE_UNDER_REVIEW_THRESHOLD = 70;
function statusFor<T>(items: T[] | undefined, elementConfidence?: number): ResourceStatus {
  if (!items || items.length === 0) return 'COMING_SOON';
  if (typeof elementConfidence === 'number' && elementConfidence < CONFIDENCE_UNDER_REVIEW_THRESHOLD) return 'UNDER_REVIEW';
  return 'READY';
}

const ANALYSE_STEPS = ['Reading document', 'Detecting units', 'Detecting chapters', 'Detecting topics', 'Comparing with existing syllabus', 'Preparing preview'];
const CURRICULA = ['IB PYP', 'IB MYP', 'IB DP', 'CBSE', 'ICSE', 'Cambridge'];
// Each curriculum only spans a specific grade range — the Grade picker
// narrows to match whichever curriculum is selected.
const GRADES_BY_CURRICULUM: Record<string, string[]> = {
  'IB PYP':    ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5'],
  'IB MYP':    ['Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'],
  'IB DP':     ['Grade 11', 'Grade 12'],
  'CBSE':      ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],
  'ICSE':      ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'],
  'Cambridge': ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],
};

export default function TeacherSyllabusImportScreen({ navigation }: any) {
  const { colors } = useTheme();
  const [curriculum, setCurriculum] = useState('CBSE');
  const [grade, setGrade] = useState('Grade 6');
  const [subject, setSubject] = useState('English');
  const [academicYear, setAcademicYear] = useState('2026-27');
  const ACADEMIC_YEARS = ['2024-25', '2025-26', '2026-27', '2027-28'];
  const GRADES = GRADES_BY_CURRICULUM[curriculum] || GRADES_BY_CURRICULUM['CBSE'];
  // Real subjects for whichever curriculum + grade is selected — same source
  // of truth as Teacher Settings / School Admin's teaching-entries editor.
  const SUBJECTS = getSubjectsForEntry(curriculum, grade);

  function changeCurriculum(next: string) {
    setCurriculum(next);
    const validGrades = GRADES_BY_CURRICULUM[next] || [];
    const nextGrade = validGrades.includes(grade) ? grade : validGrades[0];
    if (nextGrade !== grade) setGrade(nextGrade);
    const validSubjects = getSubjectsForEntry(next, nextGrade);
    if (!validSubjects.includes(subject)) setSubject(validSubjects[0]);
  }
  function changeGrade(next: string) {
    setGrade(next);
    const validSubjects = getSubjectsForEntry(curriculum, next);
    if (!validSubjects.includes(subject)) setSubject(validSubjects[0]);
  }
  const [phase, setPhase] = useState<Phase>('idle');
  // Which topic (unit index, topic index) is shown in the student-view preview.
  const [previewTopic, setPreviewTopic] = useState<{ ui: number; ti: number } | null>(null);
  const [previewTab, setPreviewTab] = useState<'learn' | 'listen' | 'ask' | 'practice' | 'book'>('learn');
  const [analyseStepIdx, setAnalyseStepIdx] = useState(0);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [error, setError] = useState('');
  // The ONLY source of truth for everything rendered below — no separate
  // book/units/draft state. Set once from the canonical extraction response.
  const [canonical, setCanonical] = useState<Canonical | null>(null);
  const units = canonical?.units ?? [];
  function setUnits(updater: (prev: Unit[]) => Unit[]) {
    setCanonical(prev => prev ? { ...prev, units: updater(prev.units) } : prev);
  }
  const [diff, setDiff] = useState<Diff | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [practiceAnswer, setPracticeAnswer] = useState<number | null>(null);
  const [listenPlaying, setListenPlaying] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const analyseTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (analyseTimer.current) clearInterval(analyseTimer.current); }, []);

  function pickFile() {
    if (Platform.OS !== 'web') { setError('Upload is available on the web app for now.'); return; }
    if (!fileRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.docx';
      input.onchange = (e: any) => handleFile(e.target.files?.[0]);
      fileRef.current = input;
    }
    fileRef.current.click();
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setFileName(file.name);
    setFileSize(`${(file.size / (1024 * 1024)).toFixed(1)} MB`);
    setPhase('analysing');
    setAnalyseStepIdx(0);
    analyseTimer.current = setInterval(() => {
      setAnalyseStepIdx(i => (i < ANALYSE_STEPS.length - 2 ? i + 1 : i));
    }, 650);

    try {
      const form = new FormData();
      form.append('doc', file);
      form.append('grade', grade);
      form.append('subject', subject);
      form.append('curriculum', curriculum);
      const res = await fetch(`${SERVER_URL}/teacher/syllabus/extract`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        // 422 = confidence gate tripped server-side. Still surface whatever
        // canonical/warnings came back so the teacher sees WHY, not just a
        // generic failure — but the pipeline stops here, exactly as required.
        if (res.status === 422 && data.warnings) {
          setCanonical({ units: [], overallConfidence: data.overallConfidence, warnings: data.warnings, jobId: data.jobId });
        }
        throw new Error(data.error || 'Extraction failed');
      }
      if (analyseTimer.current) clearInterval(analyseTimer.current);
      setAnalyseStepIdx(ANALYSE_STEPS.length - 1);
      // Render exclusively from the canonical object — data.draft is a
      // temporary backward-compatible shape the server still sends, but the
      // Preview Generator never reads it.
      setCanonical(data.canonical as Canonical);
      setDiff(data.diff);
      setPreviewFile(data.previewFile || null);
      setTimeout(() => setPhase('preview'), 400);
    } catch (e: any) {
      if (analyseTimer.current) clearInterval(analyseTimer.current);
      setError(e.message || 'Something went wrong reading that file.');
      setPhase('idle');
    }
  }

  function renameUnit(ui: number, title: string) {
    setUnits(prev => prev.map((u, i) => i === ui ? { ...u, title } : u));
  }
  function renameTopic(ui: number, ti: number, name: string) {
    setUnits(prev => prev.map((u, i) => i !== ui ? u : { ...u, topics: u.topics.map((t, j) => j === ti ? { ...t, name } : t) }));
  }
  function deleteTopic(ui: number, ti: number) {
    setUnits(prev => prev.map((u, i) => i !== ui ? u : { ...u, topics: u.topics.filter((_, j) => j !== ti) }));
  }
  function deleteUnit(ui: number) {
    setUnits(prev => prev.filter((_, i) => i !== ui));
  }

  async function publish() {
    setError('');
    try {
      const res = await fetch(`${SERVER_URL}/teacher/syllabus/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade, subject, curriculum, units }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Publish failed');
      setDiff(data.diff);
      setPhase('published');
    } catch (e: any) {
      setError(e.message || 'Publish failed.');
    }
  }

  function reset() {
    setPhase('idle'); setCanonical(null); setDiff(null); setFileName(''); setError(''); setPreviewFile(null);
  }

  const newUnitCount = units.length;
  const newTopicCount = units.reduce((s, u) => s + u.topics.length, 0);

  return (
    <ScreenLayout>
      <View style={{ flex: 1, backgroundColor: colors.bgDark }}>
        <Header title="Manage Syllabus" subtitle="AI-assisted syllabus import" showBack onMenuPress={() => navigation.openDrawer()} />
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
          showsVerticalScrollIndicator={false}
          style={Platform.OS === 'web' ? ({ scrollbarWidth: 'none', msOverflowStyle: 'none' } as any) : undefined}
        >

          {/* Filter bar */}
          <View style={{ flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' }}>
            <View style={[s.filterCard, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
              <View style={s.filterRow}>
                {[{ label: 'Curriculum', value: curriculum, opts: CURRICULA, set: changeCurriculum },
                  { label: 'Grade', value: grade, opts: GRADES, set: changeGrade },
                  { label: 'Subject', value: subject, opts: SUBJECTS, set: setSubject }].map((f, i) => (
                  <View key={i} style={{ flex: 1, minWidth: 160 }}>
                    <Text style={[s.filterLabel, { color: colors.textMuted }]}>{f.label}</Text>
                    {Platform.OS === 'web' ? (
                      React.createElement('select', {
                        value: f.value,
                        onChange: (e: any) => f.set(e.target.value),
                        style: {
                          marginTop: 8, width: '100%', fontWeight: 700, fontSize: 14, color: colors.textMain,
                          background: 'transparent', border: `1px solid ${colors.borderColor}`,
                          borderRadius: 8, padding: '8px 10px', outline: 'none',
                        },
                      }, f.opts.map(o => React.createElement('option', { key: o, value: o }, o)))
                    ) : (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                        {f.opts.map(o => (
                          <TouchableOpacity key={o} onPress={() => f.set(o)}
                            style={[s.pill, { borderColor: f.value === o ? colors.accentYellow : colors.borderColor, backgroundColor: f.value === o ? colors.accentYellow : 'transparent' }]}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: f.value === o ? '#fff' : colors.textMuted }}>{o}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
                <View style={{ minWidth: 110 }}>
                  <Text style={[s.filterLabel, { color: colors.textMuted }]}>Academic Year</Text>
                  {Platform.OS === 'web' ? (
                    React.createElement('select', {
                      value: academicYear,
                      onChange: (e: any) => setAcademicYear(e.target.value),
                      style: {
                        marginTop: 8, fontWeight: 700, fontSize: 14, color: colors.textMain,
                        background: 'transparent', border: `1px solid ${colors.borderColor}`,
                        borderRadius: 8, padding: '6px 8px', outline: 'none',
                      },
                    }, ACADEMIC_YEARS.map(y => React.createElement('option', { key: y, value: y }, y)))
                  ) : (
                    <Text style={{ color: colors.textMain, fontWeight: '700', fontSize: 14, marginTop: 8 }}>{academicYear}</Text>
                  )}
                </View>
              </View>
            </View>
            <View style={[s.tipCard, { borderColor: colors.borderColor, backgroundColor: colors.primary + '10' }]}>
              <Feather name="zap" size={16} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.textMain, fontWeight: '700', fontSize: 12.5 }}>Keep your curriculum always up-to-date</Text>
                <Text style={{ color: colors.textMuted, fontSize: 11.5, marginTop: 2 }}>Upload the new syllabus whenever it changes. Aivorah handles the rest.</Text>
              </View>
            </View>
          </View>

          {/* Panel grid */}
          <View style={{ flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' }}>

            {/* Panel 1: Upload */}
            <View style={[s.panel, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
              <PanelHeader n={1} title="Upload Latest Syllabus" colors={colors} />
              <Text style={{ color: colors.textMuted, fontSize: 11.5, marginBottom: 12 }}>Supported formats: PDF or DOCX  ·  Max file size: 20 MB</Text>
              <TouchableOpacity style={[s.dropZone, { borderColor: colors.primary }]} onPress={pickFile} disabled={phase === 'analysing'}>
                <Feather name="upload-cloud" size={26} color={colors.primary} />
                <Text style={{ color: colors.textMuted, fontSize: 12.5, marginTop: 8 }}>Drag & drop your file here</Text>
                <Text style={{ color: colors.textMuted, fontSize: 11, marginVertical: 4 }}>or</Text>
                <View style={[s.chooseBtn, { backgroundColor: colors.accentYellow }]}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 12.5 }}>Choose File</Text></View>
              </TouchableOpacity>
              {!!fileName && (
                <View style={[s.fileChip, { borderColor: colors.borderColor }]}>
                  <Feather name="file-text" size={16} color="#C98A8A" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.textMain, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>{fileName}</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 10.5 }}>{fileSize} · Uploaded just now</Text>
                  </View>
                  {phase !== 'analysing' && phase !== 'idle' && <Feather name="check-circle" size={16} color={colors.primary} />}
                </View>
              )}
              {!!error && <Text style={{ color: '#C98A8A', fontSize: 12, marginTop: 8 }}>{error}</Text>}
            </View>

            {/* Panel 2: Analysing */}
            <View style={[s.panel, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
              <PanelHeader n={2} title={phase === 'idle' ? 'Aivorah will analyse your syllabus' : phase === 'analysing' ? 'Aivorah is analysing your syllabus…' : 'Analysis complete'} colors={colors} />
              {phase === 'idle' ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 }}>
                  <Feather name="cpu" size={22} color={colors.textMuted} />
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8, textAlign: 'center' }}>Upload a file to begin</Text>
                </View>
              ) : (
                <>
                  {ANALYSE_STEPS.map((step, i) => {
                    const done = i < analyseStepIdx || phase === 'preview' || phase === 'reviewing' || phase === 'published';
                    const active = i === analyseStepIdx && phase === 'analysing';
                    return (
                      <View key={step} style={s.stepRow}>
                        {done ? <Feather name="check-circle" size={14} color={colors.primary} />
                          : active ? <ActivityIndicator size="small" color={colors.primary} />
                          : <Feather name="circle" size={14} color={colors.borderColor} />}
                        <Text style={{ flex: 1, fontSize: 12.5, color: done ? colors.textMain : colors.textMuted }}>{step}</Text>
                        <Text style={{ fontSize: 10.5, color: done ? colors.primary : active ? colors.textMuted : colors.borderColor }}>
                          {done ? 'Completed' : active ? 'In progress…' : ''}
                        </Text>
                      </View>
                    );
                  })}
                  {phase === 'analysing' && (
                    <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 10, textAlign: 'center' }}>Please wait a moment, this may take a few seconds.</Text>
                  )}
                </>
              )}
            </View>

            {/* Panel 3: Detected changes */}
            <View style={[s.panel, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
              <PanelHeader n={3} title="Detected Changes (Preview)" colors={colors} />
              {!diff ? (
                <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 20 }}>Nothing to compare yet.</Text>
              ) : (
                <>
                  <Text style={{ color: colors.textMuted, fontSize: 11.5, marginBottom: 10 }}>Compared with the currently published syllabus.</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                    <StatChip label="Units" value={`${diff.unitCountBefore} → ${newUnitCount}`} sub={diff.unitCountBefore === newUnitCount ? 'No change' : ''} tone="neutral" colors={colors} />
                    <StatChip label="Topics" value={`${diff.topicCountBefore} → ${newTopicCount}`} sub={diff.addedTopics.length ? `${diff.addedTopics.length} added` : ''} tone="info" colors={colors} />
                    <StatChip label="Removed" value={String(diff.removedTopics.length + diff.removedUnits.length)} sub="From old syllabus" tone="danger" colors={colors} />
                  </View>
                  <View style={{ gap: 6 }}>
                    {diff.addedUnits.map(u => <ChangeLine key={'au' + u} kind="Added" text={`Unit — ${u}`} colors={colors} />)}
                    {diff.removedUnits.map(u => <ChangeLine key={'ru' + u} kind="Removed" text={`Unit — ${u}`} colors={colors} />)}
                    {diff.addedTopics.slice(0, 4).map(t => <ChangeLine key={'at' + t} kind="Added" text={t} colors={colors} />)}
                    {diff.removedTopics.slice(0, 4).map(t => <ChangeLine key={'rt' + t} kind="Removed" text={t} colors={colors} />)}
                    {!diff.addedUnits.length && !diff.removedUnits.length && !diff.addedTopics.length && !diff.removedTopics.length && (
                      <Text style={{ color: colors.textMuted, fontSize: 12 }}>No changes detected — matches the current syllabus.</Text>
                    )}
                  </View>
                </>
              )}
            </View>

            {/* Panel 4: Review & Publish */}
            <View style={[s.panel, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
              <PanelHeader n={4} title="Review & Publish" colors={colors} />
              <Text style={{ color: colors.textMuted, fontSize: 11.5, marginBottom: 12 }}>Review the changes in detail before publishing to your classes.</Text>
              <View style={[s.safeBanner, { backgroundColor: colors.primary + '12', borderColor: colors.primary + '30' }]}>
                <Feather name="shield" size={14} color={colors.primary} />
                <Text style={{ color: colors.textMuted, fontSize: 11.5, flex: 1 }}>Nothing is changed or published until you review and approve.</Text>
              </View>
              <ActionRow icon="search" label="Preview Changes" sub="Review units, chapters and topics before publishing" colors={colors}
                disabled={!units.length} onPress={() => {
                  setPhase('reviewing');
                  if (units[0]?.topics?.[0]) { setPreviewTopic({ ui: 0, ti: 0 }); setPreviewTab('learn'); setPracticeAnswer(null); setListenPlaying(false); }
                }} />
              <ActionRow icon="bookmark" label="Save as Draft" sub="Save changes and review later" colors={colors} disabled={!units.length} onPress={() => {}} />
              <ActionRow icon="send" label="Publish Updates" sub="Publish changes and update syllabus for classes" colors={colors}
                primary disabled={!units.length} onPress={publish} />
              {!!error && <Text style={{ color: '#C98A8A', fontSize: 12, marginTop: 8 }}>{error}</Text>}
            </View>
          </View>

          {/* Review detail (opens when "Preview Changes" tapped) */}
          {phase === 'reviewing' && (
            <View style={[s.card, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
              <Text style={[s.title, { color: colors.textMain }]}>Detailed review — edit before publishing</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12.5, marginTop: 4, marginBottom: 14 }}>
                {canonical?.book?.title ? `Detected: ${canonical.book.title} · ` : ''}{units.length} units.
              </Text>
              {units.map((u, ui) => (
                <View key={ui} style={[s.unitBlock, { borderColor: colors.borderColor }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>Unit {u.unitNo}</Text>
                    <TextInputInline value={u.title} onChangeText={(v: string) => renameUnit(ui, v)} color={colors.textMain} />
                    <TouchableOpacity onPress={() => deleteUnit(ui)}><Feather name="trash-2" size={14} color="#C98A8A" /></TouchableOpacity>
                  </View>
                  {u.topics.map((t, ti) => {
                    const isPreviewing = previewTopic?.ui === ui && previewTopic?.ti === ti;
                    return (
                      <View key={ti} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginLeft: 14 }}>
                        <Feather name="check-circle" size={12} color={colors.primary} />
                        <TextInputInline value={t.name} onChangeText={(v: string) => renameTopic(ui, ti, v)} color={colors.textMuted} small />
                        <TouchableOpacity onPress={() => { setPreviewTopic({ ui, ti }); setPreviewTab('learn'); setPracticeAnswer(null); setListenPlaying(false); }}>
                          <Feather name="eye" size={13} color={isPreviewing ? colors.accentYellow : colors.textMuted} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => deleteTopic(ui, ti)}><Feather name="x" size={13} color={colors.textMuted} /></TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              ))}
              <TouchableOpacity style={[s.publishBtn, { backgroundColor: colors.primary }]} onPress={publish}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>Publish</Text>
              </TouchableOpacity>
            </View>
          )}

          {phase === 'reviewing' && previewTopic && units[previewTopic.ui]?.topics[previewTopic.ti] && (() => {
            const previewUnit = units[previewTopic.ui];
            const previewTopicData = previewUnit.topics[previewTopic.ti];
            const tabs: { key: typeof previewTab; label: string; icon: any }[] = [
              { key: 'learn', label: 'Learn', icon: 'book-open' },
              { key: 'listen', label: 'Listen', icon: 'headphones' },
              { key: 'ask', label: 'Ask Aivorah', icon: 'message-circle' },
              { key: 'practice', label: 'Practice', icon: 'check-square' },
              { key: 'book', label: 'View in Book', icon: 'file-text' },
            ];
            return (
              <View style={[s.card, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Feather name="smartphone" size={14} color={colors.accentYellow} />
                  <Text style={[s.title, { color: colors.textMain }]}>Student preview — {previewTopicData.name}</Text>
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 11.5, marginBottom: 8 }}>
                  This is exactly the layout students will see for this topic — {previewUnit.title} ({previewTopicData.kind}{previewTopicData.page ? `, p.${previewTopicData.page}` : ''}).
                </Text>

                {/* Teacher-only — never shown to students. Confidence/validation
                    summary the AI Validator (next stage) will build on top of. */}
                {canonical && (
                  <View style={[s.confidencePanel, { borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Feather name="shield" size={11} color={canonical.overallConfidence >= 95 ? colors.primary : colors.accentYellow} />
                      <Text style={{ fontSize: 10.5, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>Teacher-only · Extraction Quality</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
                      <Text style={{ fontSize: 11.5, color: colors.textMain }}>Overall confidence: <Text style={{ fontWeight: '800' }}>{canonical.overallConfidence}%</Text></Text>
                      <Text style={{ fontSize: 11.5, color: colors.textMuted }}>Topic confidence: {previewTopicData.confidence ?? '—'}%</Text>
                      {typeof canonical.extractionMs === 'number' && <Text style={{ fontSize: 11.5, color: colors.textMuted }}>Extracted in {(canonical.extractionMs / 1000).toFixed(1)}s</Text>}
                    </View>
                    {canonical.warnings.length > 0 && (
                      <View style={{ marginTop: 6 }}>
                        {canonical.warnings.map((w, i) => (
                          <Text key={i} style={{ fontSize: 10.5, color: '#C98A8A', marginTop: 2 }}>⚠ {w}</Text>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                <View style={s.previewTabBar}>
                  {tabs.map(t => (
                    <TouchableOpacity key={t.key} style={[s.previewTab, previewTab === t.key && { backgroundColor: colors.bgDark }]} onPress={() => setPreviewTab(t.key)}>
                      <Feather name={t.icon} size={12} color={previewTab === t.key ? colors.accentYellow : colors.textMuted} />
                      <Text style={{ fontSize: 11, fontWeight: '700', color: previewTab === t.key ? colors.accentYellow : colors.textMuted }}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {(previewTab === 'learn' || previewTab === 'listen') && (
                  <View style={s.previewDualPane}>
                    <View style={[s.previewLeftPane, { borderColor: colors.borderColor }]}>
                      {previewTab === 'learn' ? (
                        <>
                          <Text style={{ color: colors.textMain, fontWeight: '700', fontSize: 13.5, marginBottom: 6 }}>{previewTopicData.name}</Text>
                          <Text style={{ color: colors.textMuted, fontSize: 12.5, lineHeight: 19 }}>
                            {previewTopicData.summary || 'Aivorah is still drafting this explanation — it will appear here once ready.'}
                          </Text>

                          <ResourceSection label="Illustrations" icon="image" status={statusFor(previewTopicData.images)} colors={colors}>
                            {previewTopicData.images?.map((img, i) => (
                              <Text key={i} style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 3 }}>• {img.description}{img.page ? ` (p.${img.page})` : ''}</Text>
                            ))}
                          </ResourceSection>

                          <ResourceSection label="Activities" icon="edit-3" status={statusFor(previewTopicData.activities)} colors={colors}>
                            {previewTopicData.activities?.map((a, i) => (
                              <Text key={i} style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 3 }}>• {a.text}</Text>
                            ))}
                          </ResourceSection>

                          <ResourceSection label="Vocabulary" icon="book" status={statusFor(previewTopicData.vocabulary)} colors={colors}>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
                              {previewTopicData.vocabulary?.map((v, i) => (
                                <View key={i} style={[s.vocabChip, { borderColor: colors.borderColor }]}>
                                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMain }}>{v.word}</Text>
                                  <Text style={{ fontSize: 10.5, color: colors.textMuted }}>{v.meaning}</Text>
                                </View>
                              ))}
                            </View>
                          </ResourceSection>

                          <ResourceSection label="Learning Objectives" icon="target" status={statusFor(previewTopicData.learningObjectives)} colors={colors}>
                            {previewTopicData.learningObjectives?.map((o, i) => (
                              <Text key={i} style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 3 }}>• {o.text}</Text>
                            ))}
                          </ResourceSection>
                        </>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <TouchableOpacity
                            style={[s.playBtn, { backgroundColor: colors.primary }]}
                            onPress={() => {
                              if (!previewTopicData.summary || Platform.OS !== 'web') return;
                              const synth = (window as any).speechSynthesis;
                              if (!synth) return;
                              if (listenPlaying) { synth.cancel(); setListenPlaying(false); return; }
                              const utter = new SpeechSynthesisUtterance(previewTopicData.summary);
                              utter.onend = () => setListenPlaying(false);
                              synth.speak(utter);
                              setListenPlaying(true);
                            }}>
                            <Feather name={listenPlaying ? 'pause' : 'play'} size={16} color="#fff" />
                          </TouchableOpacity>
                          <Text style={{ color: colors.textMuted, fontSize: 12.5, flex: 1 }}>
                            {previewTopicData.summary ? (listenPlaying ? 'Narrating…' : 'Tap to hear how this topic will be narrated to students.') : 'Narration will be available once the explanation is drafted.'}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={[s.previewRightPane, { borderColor: colors.borderColor, backgroundColor: colors.bgDark }]}>
                      <Text style={{ color: colors.textMuted, fontSize: 10.5, fontWeight: '700', padding: 8 }}>ORIGINAL TEXTBOOK — REAL PAGE</Text>
                      {Platform.OS === 'web' && previewFile ? (
                        React.createElement('iframe', {
                          src: `${SERVER_URL}/teacher/syllabus/preview-upload/${previewFile}${previewTopicData.page ? `#page=${previewTopicData.page}` : ''}`,
                          style: { flex: 1, width: '100%', height: 260, border: 'none' },
                          title: 'Real book preview',
                        })
                      ) : (
                        <View style={{ padding: 14 }}>
                          <ResourcePlaceholder status="NOT_AVAILABLE" colors={colors} />
                        </View>
                      )}
                    </View>
                  </View>
                )}
                {previewTab === 'ask' && (
                  <View style={[s.previewBody, { borderColor: colors.borderColor }]}>
                    <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>Students can ask Aivorah anything about "{previewTopicData.name}" — the AI tutor is pre-loaded with this exact topic's context.</Text>
                  </View>
                )}
                {previewTab === 'practice' && (
                  <View style={[s.previewBody, { borderColor: colors.borderColor }]}>
                    {previewTopicData.practice ? (
                      <>
                        <Text style={{ color: colors.textMain, fontWeight: '700', fontSize: 13, marginBottom: 10 }}>{previewTopicData.practice.question}</Text>
                        {previewTopicData.practice.options.map((opt, oi) => {
                          const isCorrect = practiceAnswer !== null && oi === previewTopicData.practice!.correctIndex;
                          const isWrongPick = practiceAnswer === oi && oi !== previewTopicData.practice!.correctIndex;
                          return (
                            <TouchableOpacity key={oi} onPress={() => setPracticeAnswer(oi)}
                              style={[s.practiceOpt, { borderColor: isCorrect ? colors.primary : isWrongPick ? '#C98A8A' : colors.borderColor }]}>
                              <Text style={{ color: colors.textMain, fontSize: 12.5 }}>{opt}</Text>
                              {isCorrect && <Feather name="check" size={13} color={colors.primary} />}
                            </TouchableOpacity>
                          );
                        })}
                      </>
                    ) : (
                      <ResourcePlaceholder status={statusFor(undefined)} colors={colors} />
                    )}
                  </View>
                )}
              </View>
            );
          })()}

          {phase === 'published' && diff && (
            <View style={[s.card, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
              <Text style={[s.title, { color: colors.textMain }]}>Published ✓</Text>
              {diff.addedUnits.length > 0 && <Text style={{ color: colors.primary, fontSize: 12.5, marginTop: 8 }}>Added units: {diff.addedUnits.join(', ')}</Text>}
              {diff.removedUnits.length > 0 && <Text style={{ color: '#C98A8A', fontSize: 12.5, marginTop: 4 }}>Removed units: {diff.removedUnits.join(', ')}</Text>}
              <TouchableOpacity style={[s.publishBtn, { backgroundColor: colors.primary, marginTop: 16 }]} onPress={reset}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>Import Another</Text>
              </TouchableOpacity>
            </View>
          )}

        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

// Renders one resource type (images/activities/vocabulary/objectives) with a
// status badge — never an empty/broken-looking section, always either the
// real content or a professional "Coming Soon" / "Not Available" placeholder.
function ResourceSection({ label, icon, status, colors, children }: { label: string; icon: any; status: ResourceStatus; colors: any; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Feather name={icon} size={12} color={colors.textMuted} />
        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMain, flex: 1 }}>{label}</Text>
        <StatusBadge status={status} colors={colors} />
      </View>
      {status === 'READY' ? children : <ResourcePlaceholder status={status} colors={colors} />}
    </View>
  );
}
function StatusBadge({ status, colors }: { status: ResourceStatus; colors: any }) {
  const map: Record<ResourceStatus, { label: string; color: string }> = {
    READY:          { label: 'Ready',         color: colors.primary },
    COMING_SOON:    { label: 'Coming Soon',   color: colors.accentYellow },
    UNDER_REVIEW:   { label: 'Under Review',  color: colors.accentYellow },
    NOT_AVAILABLE:  { label: 'Not Available', color: colors.textMuted },
  };
  const m = map[status];
  return (
    <View style={[s.statusBadge, { borderColor: m.color, backgroundColor: m.color + '14' }]}>
      <Text style={{ fontSize: 9.5, fontWeight: '800', color: m.color }}>{m.label}</Text>
    </View>
  );
}
function ResourcePlaceholder({ status, colors }: { status: ResourceStatus; colors: any }) {
  const msg = status === 'COMING_SOON'
    ? 'Aivorah hasn\'t generated this yet — it will appear here once ready.'
    : status === 'UNDER_REVIEW'
      ? 'Detected with low confidence — a teacher should verify this before publishing.'
      : 'Not available for this topic.';
  return (
    <View style={[s.placeholderBox, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
      <Feather name="clock" size={12} color={colors.textMuted} />
      <Text style={{ fontSize: 11, color: colors.textMuted, flex: 1 }}>{msg}</Text>
    </View>
  );
}

function PanelHeader({ n, title, colors }: { n: number; title: string; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <View style={[s.numBadge, { backgroundColor: colors.primary + '18' }]}><Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>{n}</Text></View>
      <Text style={{ color: colors.textMain, fontWeight: '700', fontSize: 14, flex: 1 }}>{title}</Text>
    </View>
  );
}
function StatChip({ label, value, sub, tone, colors }: { label: string; value: string; sub: string; tone: 'neutral' | 'info' | 'danger'; colors: any }) {
  const bg = tone === 'danger' ? '#C98A8A18' : tone === 'info' ? colors.primary + '14' : colors.borderColor + '30';
  const fg = tone === 'danger' ? '#C98A8A' : tone === 'info' ? colors.primary : colors.textMain;
  return (
    <View style={[s.statChip, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontWeight: '800', fontSize: 14 }}>{value}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 10 }}>{label}</Text>
      {!!sub && <Text style={{ color: fg, fontSize: 9.5, marginTop: 2 }}>{sub}</Text>}
    </View>
  );
}
function ChangeLine({ kind, text, colors }: { kind: 'Added' | 'Removed'; text: string; colors: any }) {
  const color = kind === 'Added' ? colors.primary : '#C98A8A';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Feather name={kind === 'Added' ? 'plus' : 'minus'} size={12} color={color} />
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{kind}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 11.5, flex: 1 }} numberOfLines={1}>{text}</Text>
    </View>
  );
}
function ActionRow({ icon, label, sub, colors, primary, disabled, onPress }: any) {
  return (
    <TouchableOpacity
      style={[s.actionRow, { borderColor: colors.borderColor, backgroundColor: primary ? colors.accentYellow : 'transparent', opacity: disabled ? 0.5 : 1 }]}
      onPress={onPress} disabled={disabled}>
      <Feather name={icon} size={13} color={primary ? '#fff' : colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: primary ? '#fff' : colors.textMain, fontWeight: '700', fontSize: 11.5 }}>{label}</Text>
        <Text style={{ color: primary ? '#ffffffcc' : colors.textMuted, fontSize: 9.5 }}>{sub}</Text>
      </View>
      <Feather name="chevron-right" size={12} color={primary ? '#fff' : colors.textMuted} />
    </TouchableOpacity>
  );
}
function TextInputInline({ value, onChangeText, color, small }: any) {
  const { TextInput } = require('react-native');
  return <TextInput value={value} onChangeText={onChangeText} style={{ flex: 1, color, fontWeight: small ? '400' : '700', fontSize: small ? 12.5 : 14 }} />;
}

const s = StyleSheet.create({
  card:  { borderWidth: 1, borderRadius: radius.lg, padding: 20 },
  title: { fontFamily: fonts.serif, fontSize: 17, fontWeight: '700' },
  filterCard: { flex: 2, minWidth: 620, borderWidth: 1, borderRadius: radius.lg, padding: 16, overflow: 'hidden' },
  filterRow: { flexDirection: 'row', gap: 20, flexWrap: 'wrap' },
  filterLabel: { fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9 },
  tipCard: { flex: 1, minWidth: 260, borderWidth: 1, borderRadius: radius.lg, padding: 16, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  panel: { flex: 1, minWidth: 320, borderWidth: 1, borderRadius: radius.lg, padding: 18 },
  numBadge: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  dropZone: { borderWidth: 2, borderStyle: 'dashed', borderRadius: radius.lg, paddingVertical: 24, alignItems: 'center', justifyContent: 'center' },
  chooseBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.md },
  fileChip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius.md, padding: 10, marginTop: 12 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  statChip: { flex: 1, borderRadius: radius.md, padding: 10, alignItems: 'flex-start' },
  safeBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: radius.md, padding: 10, marginBottom: 12 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius.sm ?? 8, paddingVertical: 8, paddingHorizontal: 10, marginTop: 6 },
  unitBlock: { borderTopWidth: 1, paddingVertical: 12 },
  previewTabBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 10 },
  previewTab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  previewBody: { borderWidth: 1, borderRadius: radius.md, padding: 14 },
  confidencePanel: { borderWidth: 1, borderRadius: radius.md, padding: 10, marginBottom: 12 },
  vocabChip: { borderWidth: 1, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8, minWidth: 90 },
  statusBadge: { borderWidth: 1, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7 },
  placeholderBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.sm ?? 8, padding: 10, marginTop: 4 },
  previewDualPane: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  previewLeftPane: { flex: 1.4, minWidth: 220, borderWidth: 1, borderRadius: radius.md, padding: 14 },
  previewRightPane: { flex: 1, minWidth: 200, borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  playBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  practiceOpt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: radius.sm ?? 8, padding: 10, marginTop: 6 },
  publishBtn: { marginTop: 16, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center' },
});
