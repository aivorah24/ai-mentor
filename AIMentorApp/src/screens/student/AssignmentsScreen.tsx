import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Modal, Platform, Alert, Image, Linking, TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { spacing, radius } from '../../theme';
import type { AppColors } from '../../theme';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { useTheme } from '../../context/ThemeContext';
import { useStudentData } from '../../context/StudentDataContext';
import { useNotification } from '../../context/NotificationContext';
import SERVER_URL from '../../config/serverUrl';

const FILTERS = ['All', 'Pending', 'Completed', 'Quizzes'];

interface Assignment {
  id: string;
  title: string;
  subject: string;
  chapter: string;
  dueDate: string;
  type: string;
  note: string;
  studentId: string | null;
  createdBy: string;
  status: 'pending' | 'completed';
  score: number | null;
  createdAt: string;
  completedAt?: string;
  grade?: string | null;
  curriculum?: string | null;
  questions: string[];
  aiFeedback?: string | null;
  documentUrl?: string | null;
  documentUrls?: string[];
  successCriteria?: string[];
  taskSteps?: TaskStep[];
  quizQuestions?: QuizQuestion[];
}

interface QuizQuestion {
  id: string;
  question: string;
  type: 'mcq' | 'short_answer';
  options?: string[];
  correct: string;
  hint?: string;
  explanation?: string;
}

type StepType = 'brainstorm' | 'drawing' | 'structured_writing';
interface TaskStep {
  id: string;
  type: StepType;
  label: string;
  instructions: string;
  sections?: string[];
  wordBank?: string[];
}
type StepAnswer = {
  stepId: string;
  type: StepType;
  keywords: string[];
  drawingBase64: string | null;
  drawingMime: string;
  sections: { label: string; text: string }[];
};

const STEP_COLORS: Record<StepType, string> = {
  brainstorm: '#f59e0b', drawing: '#8b5cf6', structured_writing: '#3b82f6',
};
const STEP_ICONS: Record<StepType, string> = {
  brainstorm: 'cloud', drawing: 'edit-3', structured_writing: 'align-left',
};

const SUBJECT_ICON: Record<string, string> = {
  Mathematics: 'hash', Science: 'zap', English: 'book-open', 'Social Studies': 'globe',
};
const SUBJECT_COLOR: Record<string, string> = {
  Mathematics: '#818CF8', Science: '#34D399', English: '#C084FC', 'Social Studies': '#FBBF24',
};

function formatDueDate(iso: string) {
  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(iso); due.setHours(0,0,0,0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { label: `Overdue by ${Math.abs(diff)}d`, colorKey: 'accentRed' as const, isOverdue: true };
  if (diff === 0) return { label: 'Due today', colorKey: 'accentYellow' as const, isOverdue: false };
  if (diff === 1) return { label: 'Due tomorrow', colorKey: 'accentYellow' as const, isOverdue: false };
  return { label: `Due ${due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, colorKey: 'textMuted' as const, isOverdue: false };
}

// ── Stamp config ─────────────────────────────────────────────────────────────
const STAMPS = [
  { id: 'amazing',    label: 'Amazing Storyteller', icon: 'star',         color: '#f59e0b', min: 80 },
  { id: 'hardworking',label: 'Hardworking Farmer',  icon: 'award',        color: '#10b981', min: 60 },
  { id: 'keepgoing',  label: 'Keep Going!',          icon: 'trending-up',  color: '#6366f1', min: 0  },
];
function getStamp(score: number | null) {
  if (score == null) return STAMPS[2];
  return STAMPS.find(s => score >= s.min) ?? STAMPS[2];
}

// ── Worksheet Viewer — expanded by default, tap image to zoom fullscreen ─────

function WorksheetViewer({ assignment, color, colors }: { assignment: Assignment; color: string; colors: AppColors }) {
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const urls = (assignment.documentUrls?.length ?? 0) > 0 ? assignment.documentUrls! : (assignment.documentUrl ? [assignment.documentUrl] : []);
  if (urls.length === 0) return null;

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Feather name="file-text" size={13} color={color} />
        <Text style={{ fontSize: 12, fontWeight: '700', color, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Worksheet{urls.length > 1 ? ` (${urls.length} pages)` : ''}
        </Text>
        <Text style={{ fontSize: 11, color: colors.textDim, marginLeft: 4 }}>Tap image to zoom</Text>
      </View>

      {urls.map((url, idx) => (
        url.match(/\.(jpg|jpeg|png|gif|webp)/i) || url.includes('cloudinary') ? (
          <View key={idx}>
            {urls.length > 1 && (
              <Text style={{ fontSize: 11, color: colors.textDim, marginBottom: 4, fontWeight: '600' }}>Page {idx + 1}</Text>
            )}
            <TouchableOpacity onPress={() => setZoomUrl(url)} activeOpacity={0.9}>
              <Image
                source={{ uri: url }}
                style={{ width: '100%', height: 340, borderRadius: 12, backgroundColor: '#f0f0f0', borderWidth: 1, borderColor: color + '30' }}
                resizeMode="contain"
              />
              <View style={{ position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: 5 }}>
                <Feather name="zoom-in" size={14} color="#fff" />
              </View>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity key={idx} onPress={() => Linking.openURL(url)} activeOpacity={0.8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, backgroundColor: color + '10', borderWidth: 1, borderColor: color + '30' }}>
            <Feather name="file-text" size={18} color={color} />
            <Text style={{ flex: 1, color, fontWeight: '600' }}>Open Page {idx + 1}</Text>
            <Feather name="external-link" size={14} color={color} />
          </TouchableOpacity>
        )
      ))}

      {/* Fullscreen zoom modal */}
      {zoomUrl && (
        <Modal visible animationType="fade" transparent onRequestClose={() => setZoomUrl(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }}>
            <TouchableOpacity
              style={{ position: 'absolute', top: 48, right: 20, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: 8 }}
              onPress={() => setZoomUrl(null)} activeOpacity={0.8}
            >
              <Feather name="x" size={22} color="#fff" />
            </TouchableOpacity>
            <ScrollView
              style={{ flex: 1, width: '100%' }}
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}
              maximumZoomScale={4}
              minimumZoomScale={1}
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              bouncesZoom
            >
              <Image
                source={{ uri: zoomUrl }}
                style={{ width: '100%', height: undefined, aspectRatio: 0.75 }}
                resizeMode="contain"
              />
            </ScrollView>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, paddingBottom: 24 }}>Pinch to zoom - Tap X to close</Text>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type PageAnswer = { preview: string | null; base64: string | null; mime: string };
type PerQ = { number: number; question: string; answered: boolean; score: number; studentAnswer: string | null; correct: boolean; comment: string };
type GradeResult = { score: number | null; feedback: string; stamp: string; wellDone: string; improve: string; perQuestion: PerQ[] };

// ── Quiz Modal ────────────────────────────────────────────────────────────────

function QuizModal({ assignment, colors, onClose, onSubmitted }: {
  assignment: Assignment; colors: AppColors;
  onClose: () => void; onSubmitted: (updated: any) => void;
}) {
  const styles = useMemo(() => makeModalStyles(colors), [colors]);
  const { studentId } = useStudentData();
  const color = SUBJECT_COLOR[assignment.subject] ?? '#6366f1';
  const questions = assignment.quizQuestions || [];

  const [currentQ,   setCurrentQ]   = useState(0);
  const [answers,    setAnswers]     = useState<Record<number, string>>({});
  const [showHint,   setShowHint]    = useState(false);
  const [submitting, setSubmitting]  = useState(false);
  const [result,     setResult]      = useState<GradeResult | null>(null);
  const [showReview, setShowReview]  = useState(false);
  const [shortInput, setShortInput]  = useState('');

  const q         = questions[currentQ];
  const isLast    = currentQ === questions.length - 1;
  const answered  = answers[currentQ] !== undefined;
  const stamp     = result ? getStamp(result.score) : null;

  function selectOption(option: string) {
    setAnswers(prev => ({ ...prev, [currentQ]: option }));
  }
  function submitShort() {
    if (shortInput.trim()) {
      setAnswers(prev => ({ ...prev, [currentQ]: shortInput.trim() }));
      setShortInput('');
    }
  }
  function next() { setShowHint(false); setShortInput(''); setCurrentQ(i => i + 1); }
  function prev() { setShowHint(false); setShortInput(''); setCurrentQ(i => i - 1); }

  async function handleSubmit() {
    setShowReview(false); setSubmitting(true);
    try {
      const quizAnswers = questions.map((_, i) => ({ answer: answers[i] || '' }));
      const res = await fetch(`${SERVER_URL}/assignments/${assignment.id}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, quizAnswers, quizQuestions: questions }),
      });
      const data = await res.json();
      if (res.ok) {
        let feedbackText = data.aiFeedback || '';
        let stamp = ''; let wellDone = ''; let improve = ''; let pq: PerQ[] = [];
        try {
          const parsed = JSON.parse(feedbackText);
          feedbackText = parsed.text || feedbackText;
          stamp = parsed.stamp || ''; wellDone = parsed.wellDone || ''; improve = parsed.improve || '';
          pq = Array.isArray(parsed.perQuestion) ? parsed.perQuestion : [];
        } catch { pq = data.perQuestion || []; }
        setResult({ score: data.score, feedback: feedbackText, stamp, wellDone, improve, perQuestion: pq });
        onSubmitted(data);
      } else { Alert.alert('Error', data.error || 'Submission failed'); }
    } catch { Alert.alert('Network error. Please try again.'); }
    finally { setSubmitting(false); }
  }

  // Spinner
  if (submitting) return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, styles.quizSheet, { justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 24 }]}>
          <ActivityIndicator size="large" color={color} />
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.textMain, textAlign: 'center' }}>Checking your answers...</Text>
        </View>
      </View>
    </Modal>
  );

  // Results
  if (result) return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, styles.quizSheet]}>
          <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
            <View style={[styles.subjectDot, { backgroundColor: color + '20' }]}>
              <Feather name="check-circle" size={18} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Quiz Results</Text>
              <Text style={styles.meta}>{assignment.title}</Text>
            </View>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={22} color={colors.textMuted} /></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <View style={styles.resultBox}>
              <View style={[styles.scoreBadge, { backgroundColor: color + '15', borderColor: color + '30' }]}>
                <Text style={[styles.scoreNum, { color }]}>{result.score != null ? `${result.score}%` : 'Done'}</Text>
                <Text style={[styles.scoreLabel, { color }]}>{result.score != null ? result.score >= 85 ? 'Excellent!' : result.score >= 60 ? 'Good job!' : 'Keep going!' : 'Submitted'}</Text>
              </View>
              {stamp && (
                <View style={[styles.stampCard, { backgroundColor: stamp.color + '15', borderColor: stamp.color + '40' }]}>
                  <View style={[styles.stampIcon, { backgroundColor: stamp.color }]}><Feather name={stamp.icon as any} size={20} color="#fff" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stampLabel}>Stamp earned!</Text>
                    <Text style={[styles.stampName, { color: stamp.color }]}>{result.stamp || stamp.label}</Text>
                  </View>
                </View>
              )}
              <View style={styles.feedbackCard}>
                <Text style={styles.feedbackTitle}>Feedforward</Text>
                <Text style={styles.feedbackText}>{result.feedback}</Text>
              </View>
              {result.perQuestion.length > 0 ? (
                <View style={[styles.criteriaRow, { borderColor: color + '35', backgroundColor: color + '08' }]}>
                  <Feather name="bar-chart-2" size={16} color={color} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.criteriaLabel, { color }]}>Exact Result</Text>
                    <Text style={[styles.criteriaText, { color: colors.textMuted }]}>
                      Correct {result.perQuestion.filter((pq: any) => pq.correct).length} of {result.perQuestion.length} questions
                    </Text>
                  </View>
                </View>
              ) : null}
              {result.wellDone ? (
                <View style={[styles.criteriaRow, { borderColor: colors.accentGreen + '40', backgroundColor: colors.accentGreen + '08' }]}>
                  <Feather name="check-circle" size={16} color={colors.accentGreen} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.criteriaLabel, { color: colors.accentGreen }]}>Well done</Text>
                    <Text style={[styles.criteriaText, { color: colors.textMuted }]}>{result.wellDone}</Text>
                  </View>
                </View>
              ) : null}
              {result.improve ? (
                <View style={[styles.criteriaRow, { borderColor: colors.accentYellow + '40', backgroundColor: colors.accentYellow + '08' }]}>
                  <Feather name="book-open" size={16} color={colors.accentYellow} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.criteriaLabel, { color: colors.accentYellow }]}>Review this topic</Text>
                    <Text style={[styles.criteriaText, { color: colors.textMuted }]}>{result.improve}</Text>
                  </View>
                </View>
              ) : null}
              {/* Per question breakdown */}
              {result.perQuestion.length > 0 && (
                <View style={{ gap: 8 }}>
                  <Text style={styles.feedbackTitle}>Question by Question</Text>
                  {result.perQuestion.map((q: any, idx: number) => {
                    const qc = !q.answered ? colors.textDim : q.correct ? colors.accentGreen : colors.accentRed;
                    return (
                      <View key={idx} style={[styles.qRow, { borderColor: qc + '40', backgroundColor: qc + '06' }]}>
                        <View style={styles.qLeft}>
                          <Feather name={!q.answered ? 'minus-circle' : q.correct ? 'check-circle' : 'x-circle'} size={16} color={qc} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.qNum, { color: qc }]}>Q{q.number}</Text>
                            <Text style={styles.qText} numberOfLines={2}>{q.question}</Text>
                            {q.studentAnswer && <Text style={[styles.qAnswer, { color: colors.textDim }]}>Your answer: {q.studentAnswer}</Text>}
                            {!q.correct && q.correctAnswer && <Text style={[styles.qAnswer, { color: colors.accentGreen, fontWeight: '600' }]}>Correct: {q.correctAnswer}</Text>}
                            <Text style={[styles.qComment, { color: colors.textMuted }]}>{q.comment}</Text>
                            {q.explanation ? <Text style={[styles.qAnswer, { color: colors.textDim, fontStyle: 'italic' }]}>{q.explanation}</Text> : null}
                          </View>
                        </View>
                        <View style={[styles.qScore, { backgroundColor: qc + '20' }]}>
                          <Text style={[styles.qScoreText, { color: qc }]}>{q.answered ? `${q.score}%` : '--'}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
              <TouchableOpacity style={[styles.submitBtn, { backgroundColor: color }]} onPress={onClose} activeOpacity={0.85}>
                <Feather name="check" size={16} color="#fff" />
                <Text style={styles.submitBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // Review before submit
  if (showReview) return (
    <Modal visible animationType="slide" transparent onRequestClose={() => setShowReview(false)}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, styles.quizSheet]}>
          <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
            <View style={[styles.subjectDot, { backgroundColor: color + '20' }]}><Feather name="list" size={18} color={color} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Review Answers</Text>
              <Text style={styles.meta}>{Object.keys(answers).length} of {questions.length} answered</Text>
            </View>
            <TouchableOpacity onPress={() => setShowReview(false)}><Feather name="x" size={22} color={colors.textMuted} /></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {questions.map((q, i) => (
              <TouchableOpacity key={i} onPress={() => { setCurrentQ(i); setShowReview(false); }} activeOpacity={0.8}
                style={[styles.qReviewRow, { borderColor: answers[i] ? color + '40' : colors.accentRed + '40', backgroundColor: answers[i] ? color + '06' : colors.accentRed + '06' }]}>
                <View style={[styles.taskNum, { backgroundColor: answers[i] ? color : colors.accentRed }]}>
                  <Text style={[styles.taskNumText, { color: '#fff' }]}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, color: colors.textMain, fontWeight: '600' }} numberOfLines={1}>{q.question}</Text>
                  <Text style={{ fontSize: 11, color: answers[i] ? colors.accentGreen : colors.accentRed, marginTop: 2, fontWeight: '600' }}>
                    {answers[i] ? answers[i] : 'Not answered — tap to answer'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            {Object.keys(answers).length < questions.length && (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 10, backgroundColor: colors.accentYellow + '12', borderWidth: 1, borderColor: colors.accentYellow + '30' }}>
                <Feather name="alert-triangle" size={14} color={colors.accentYellow} />
                <Text style={{ flex: 1, fontSize: 12, color: colors.accentYellow, fontWeight: '600' }}>
                  {questions.length - Object.keys(answers).length} question{questions.length - Object.keys(answers).length > 1 ? 's' : ''} unanswered.
                </Text>
              </View>
            )}
            <TouchableOpacity style={[styles.submitBtn, { backgroundColor: color }]} onPress={handleSubmit} activeOpacity={0.85}>
              <Feather name="send" size={16} color="#fff" />
              <Text style={styles.submitBtnText}>Submit Quiz</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  if (!q) return null;

  // Question step
  return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, styles.quizSheet]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
            <View style={[styles.subjectDot, { backgroundColor: color + '20' }]}>
              <Feather name="help-circle" size={18} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{assignment.title}</Text>
              <Text style={[styles.meta, { color }]}>Question {currentQ + 1} of {questions.length}</Text>
            </View>
          </View>

          {/* Progress dots */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 10, gap: 5 }}>
            {questions.map((_, i) => (
              <View key={i} style={{ flex: 1, height: 4, borderRadius: 2,
                backgroundColor: answers[i] !== undefined ? color : i === currentQ ? color + '60' : colors.borderColor }} />
            ))}
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { gap: 16 }]}>
            {/* Question */}
            <View style={[styles.questionCard, { borderColor: color + '30', backgroundColor: color + '06' }]}>
              <View style={[styles.qNumBadge, { backgroundColor: color }]}>
                <Text style={styles.qNumBadgeText}>Q{currentQ + 1} - {q.type === 'mcq' ? 'Multiple Choice' : 'Short Answer'}</Text>
              </View>
              <Text style={styles.questionText}>{q.question}</Text>

              {/* Hint toggle */}
              {q.hint && (
                <TouchableOpacity onPress={() => setShowHint(h => !h)} activeOpacity={0.75}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
                  <Feather name="help-circle" size={13} color={color} />
                  <Text style={{ fontSize: 12, color, fontWeight: '600' }}>{showHint ? 'Hide hint' : 'Show hint'}</Text>
                </TouchableOpacity>
              )}
              {showHint && q.hint && (
                <View style={{ padding: 10, borderRadius: 8, backgroundColor: color + '12', borderWidth: 1, borderColor: color + '30' }}>
                  <Text style={{ fontSize: 13, color: colors.textMuted, fontStyle: 'italic' }}>{q.hint}</Text>
                </View>
              )}
            </View>

            {/* MCQ options */}
            {q.type === 'mcq' && q.options && (
              <View style={{ gap: 10 }}>
                {q.options.map((opt, oi) => {
                  const selected = answers[currentQ] === opt;
                  return (
                    <TouchableOpacity key={oi} onPress={() => selectOption(opt)} activeOpacity={0.75}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1.5,
                        borderColor: selected ? color : colors.borderColor,
                        backgroundColor: selected ? color + '12' : colors.bgDark }}>
                      <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1.5,
                        borderColor: selected ? color : colors.textDim,
                        backgroundColor: selected ? color : 'transparent',
                        alignItems: 'center', justifyContent: 'center' }}>
                        {selected && <Feather name="check" size={14} color="#fff" />}
                      </View>
                      <Text style={{ flex: 1, fontSize: 14, color: selected ? colors.textMain : colors.textMuted, fontWeight: selected ? '600' : '400', lineHeight: 20 }}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Short answer */}
            {q.type === 'short_answer' && (
              <View style={{ gap: 8 }}>
                {answers[currentQ] ? (
                  <View style={{ gap: 6 }}>
                    <View style={{ padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: color + '60', backgroundColor: color + '08' }}>
                      <Text style={{ fontSize: 14, color: colors.textMain, lineHeight: 22 }}>{answers[currentQ]}</Text>
                    </View>
                    <TouchableOpacity onPress={() => { setAnswers(prev => { const n = {...prev}; delete n[currentQ]; return n; }); setShortInput(answers[currentQ] || ''); }}
                      activeOpacity={0.75} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' }}>
                      <Feather name="edit-2" size={12} color={color} />
                      <Text style={{ fontSize: 12, color, fontWeight: '600' }}>Edit answer</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    <TextInput
                      style={{ borderWidth: 1.5, borderColor: color + '60', borderRadius: 12, padding: 14,
                        fontSize: 15, color: colors.textMain, backgroundColor: colors.bgDark,
                        minHeight: 90, textAlignVertical: 'top', lineHeight: 24 }}
                      placeholder="Write your answer here..."
                      placeholderTextColor={colors.textDim}
                      value={shortInput}
                      onChangeText={setShortInput}
                      multiline
                    />
                    <TouchableOpacity
                      style={[styles.submitBtn, styles.compactBtn, { backgroundColor: color, alignSelf: 'flex-start' }]}
                      onPress={submitShort}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.submitBtnText}>Save Answer</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* Navigation */}
            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
              {currentQ > 0 && (
                <TouchableOpacity
                  style={[styles.submitBtn, styles.compactBtn, { backgroundColor: colors.borderColor }]}
                  onPress={prev}
                  activeOpacity={0.85}
                >
                  <Feather name="chevron-left" size={16} color={colors.textMuted} />
                  <Text style={[styles.submitBtnText, { color: colors.textMuted }]}>Back</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.submitBtn, styles.compactBtn, { backgroundColor: answered ? color : colors.borderColor }]}
                onPress={() => isLast ? setShowReview(true) : next()}
                activeOpacity={0.85}
              >
                <Text style={[styles.submitBtnText, { color: answered ? '#fff' : colors.textMuted }]}>
                  {isLast ? 'Review & Submit' : 'Next Question'}
                </Text>
                <Feather name={isLast ? 'check-square' : 'chevron-right'} size={16} color={answered ? '#fff' : colors.textMuted} />
              </TouchableOpacity>
            </View>

            {!answered && (
              <TouchableOpacity onPress={() => isLast ? setShowReview(true) : next()} activeOpacity={0.7} style={{ alignSelf: 'center' }}>
                <Text style={{ fontSize: 12, color: colors.textDim, textDecorationLine: 'underline' }}>Skip this question</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Web Drawing Canvas ────────────────────────────────────────────────────────

class DrawingErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) {
      return (
        <View style={{ padding: 20, alignItems: 'center' }}>
          <Text style={{ color: '#ef4444', fontSize: 13 }}>Drawing canvas failed to load. Please refresh the page.</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

function WebDrawingCanvas({ onCapture, color }: { onCapture: (b64: string, mime: string) => void; color: string }) {
  const canvasRef = useRef<any>(null);
  const drawing   = useRef(false);
  const history   = useRef<any[]>([]);
  const [penColor, setPenColor] = useState('#1e293b');
  const [penSize,  setPenSize]  = useState(10);
  const [eraser,   setEraser]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  function getXY(e: any) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    return { x: (clientX - r.left) * (c.width / r.width), y: (clientY - r.top) * (c.height / r.height) };
  }
  function ctx() {
    return canvasRef.current ? canvasRef.current.getContext('2d') : null;
  }
  function start(e: any) {
    const c = canvasRef.current;
    const cx = ctx();
    if (!c || !cx) return;
    const snap = cx.getImageData(0, 0, c.width, c.height);
    history.current.push(snap);
    if (history.current.length > 20) history.current.shift();
    const { x, y } = getXY(e);
    cx.beginPath(); cx.moveTo(x, y);
    drawing.current = true;
    setSaved(false);
  }
  function move(e: any) {
    if (!drawing.current) return;
    const cx = ctx();
    if (!cx) return;
    const { x, y } = getXY(e);
    if (eraser) {
      cx.globalCompositeOperation = 'destination-out';
      cx.strokeStyle = 'rgba(0,0,0,1)';
      cx.lineWidth = 36;
    } else {
      cx.globalCompositeOperation = 'source-over';
      cx.strokeStyle = penColor;
      cx.lineWidth = penSize;
    }
    cx.lineCap = 'round';
    cx.lineJoin = 'round';
    cx.lineTo(x, y);
    cx.stroke();
  }
  function stop() {
    if (!drawing.current) return;
    drawing.current = false;
    const dataUrl = canvasRef.current ? canvasRef.current.toDataURL('image/png') : null;
    if (dataUrl) { onCapture(dataUrl.split(',')[1], 'image/png'); setSaved(true); }
  }
  function undo() {
    if (!history.current.length) return;
    const snap = history.current.pop();
    const cx = ctx();
    if (cx && snap) cx.putImageData(snap, 0, 0);
    const dataUrl = canvasRef.current ? canvasRef.current.toDataURL('image/png') : null;
    if (dataUrl) onCapture(dataUrl.split(',')[1], 'image/png');
    setSaved(true);
  }
  function clear() {
    const c = canvasRef.current;
    const cx = ctx();
    if (!c || !cx) return;
    const snap = cx.getImageData(0, 0, c.width, c.height);
    history.current.push(snap);
    if (history.current.length > 20) history.current.shift();
    cx.clearRect(0, 0, c.width, c.height);
    setSaved(false);
  }

  const COLORS = ['#1e293b','#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#ffffff'];

  return (
    <View style={{ marginBottom: 8 }}>
        {/* Color swatches */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
          {COLORS.map(c => (
            <TouchableOpacity key={c} onPress={() => { setPenColor(c); setEraser(false); }} activeOpacity={0.8}
              style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c, margin: 3,
                borderWidth: (!eraser && penColor === c) ? 3 : 1,
                borderColor: (!eraser && penColor === c) ? '#6366f1' : '#d1d5db' }} />
          ))}
        </View>

        {/* Tools row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          {/* Pen sizes */}
          {([5, 10, 20] as number[]).map(sz => (
            <TouchableOpacity key={sz} onPress={() => { setPenSize(sz); setEraser(false); }} activeOpacity={0.8}
              style={{ width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 6,
                backgroundColor: (!eraser && penSize === sz) ? '#ede9fe' : '#f8fafc',
                borderWidth: 1, borderColor: (!eraser && penSize === sz) ? '#7c3aed' : '#e2e8f0' }}>
              <View style={{ width: sz, height: sz, borderRadius: Math.round(sz / 2), backgroundColor: penColor }} />
            </TouchableOpacity>
          ))}

          <View style={{ width: 1, height: 28, backgroundColor: '#e2e8f0', marginHorizontal: 6 }} />

          {/* Eraser */}
          <TouchableOpacity onPress={() => setEraser(prev => !prev)} activeOpacity={0.8}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginRight: 6,
              backgroundColor: eraser ? '#fef3c7' : '#f8fafc',
              borderWidth: 1, borderColor: eraser ? '#d97706' : '#e2e8f0' }}>
            <Feather name="delete" size={16} color={eraser ? '#d97706' : '#64748b'} />
            <Text style={{ fontSize: 12, marginLeft: 4, fontWeight: '600', color: eraser ? '#d97706' : '#64748b' }}>Eraser</Text>
          </TouchableOpacity>

          {/* Undo */}
          <TouchableOpacity onPress={undo} activeOpacity={0.8}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginRight: 6,
              backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' }}>
            <Feather name="corner-left-up" size={16} color="#64748b" />
            <Text style={{ fontSize: 12, marginLeft: 4, fontWeight: '600', color: '#64748b' }}>Undo</Text>
          </TouchableOpacity>

          {/* Clear */}
          <TouchableOpacity onPress={clear} activeOpacity={0.8}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
              backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' }}>
            <Feather name="trash-2" size={16} color="#ef4444" />
            <Text style={{ fontSize: 12, marginLeft: 4, fontWeight: '600', color: '#ef4444' }}>Clear</Text>
          </TouchableOpacity>
        </View>

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          width={800}
          height={500}
          style={{ width: '100%', height: 300, borderRadius: 12, backgroundColor: '#fff',
            border: '2px dashed #c4b5fd', cursor: 'crosshair', touchAction: 'none', display: 'block' } as any}
          onMouseDown={start as any}
          onMouseMove={move as any}
          onMouseUp={stop as any}
          onMouseLeave={stop as any}
          onTouchStart={start as any}
          onTouchMove={move as any}
          onTouchEnd={stop as any}
        />
        {saved && <Text style={{ fontSize: 11, color: '#10b981', textAlign: 'center', marginTop: 4, fontWeight: '600' }}>Drawing saved</Text>}
    </View>
  );
}

// ── Scaffolded Submission Modal ───────────────────────────────────────────────
// Flow: Step 1 (brainstorm/drawing/writing/photo) → ... → Self-Assessment → Submit → Results

function ScaffoldedModal({ assignment, colors, onClose, onSubmitted }: {
  assignment: Assignment; colors: AppColors;
  onClose: () => void;
  onSubmitted: (updated: any) => void;
}) {
  const styles    = useMemo(() => makeModalStyles(colors), [colors]);
  const { studentId } = useStudentData();
  const steps     = assignment.taskSteps || [];
  const criteria  = assignment.successCriteria || [];
  const color     = SUBJECT_COLOR[assignment.subject] ?? '#6366f1';

  const [stepAnswers, setStepAnswers] = useState<StepAnswer[]>(() =>
    steps.map(s => ({
      stepId: s.id, type: s.type, keywords: [],
      drawingBase64: null, drawingMime: 'image/png',
      sections: (s.sections?.length ? s.sections : ['Beginning','Middle','End']).map(l => ({ label: l, text: '' })),
    }))
  );
  const [currentStep,   setCurrentStep]   = useState(0);   // 0..steps.length = self-assess
  const [selfChecked,   setSelfChecked]   = useState<Record<string, boolean>>({});
  const [keywordInput,  setKeywordInput]  = useState('');
  const [submitting,    setSubmitting]    = useState(false);
  const [result,        setResult]        = useState<GradeResult | null>(null);

  const isSelfAssess   = currentStep === steps.length;
  const isLastDataStep = currentStep === steps.length - 1;
  const step           = steps[currentStep];
  const ans            = stepAnswers[currentStep];
  const stamp          = result ? getStamp(result.score) : null;

  function patchAns(patch: Partial<StepAnswer>) {
    setStepAnswers(prev => prev.map((a, i) => i === currentStep ? { ...a, ...patch } : a));
  }

  function addKeyword() {
    const kw = keywordInput.trim();
    if (!kw || ans.keywords.includes(kw)) return;
    patchAns({ keywords: [...ans.keywords, kw] });
    setKeywordInput('');
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch(`${SERVER_URL}/assignments/${assignment.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, stepAnswers, selfAssessment: selfChecked }),
      });
      const data = await res.json();
      if (res.ok) {
        let feedbackText = data.aiFeedback || '';
        let stamp = ''; let wellDone = ''; let improve = ''; let pq: PerQ[] = [];
        try {
          const parsed = JSON.parse(feedbackText);
          feedbackText = parsed.text || feedbackText;
          stamp = parsed.stamp || ''; wellDone = parsed.wellDone || ''; improve = parsed.improve || '';
          pq = Array.isArray(parsed.perQuestion) ? parsed.perQuestion : [];
        } catch { pq = data.perQuestion || []; }
        setResult({ score: data.score, feedback: feedbackText, stamp, wellDone, improve, perQuestion: pq });
        onSubmitted(data);
      } else {
        Alert.alert('Error', data.error || 'Submission failed');
      }
    } catch {
      Alert.alert('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Grading spinner ──
  if (submitting) return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 24 }]}>
          <ActivityIndicator size="large" color={color} />
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.textMain, textAlign: 'center' }}>AI is grading your work...</Text>
          <Text style={{ fontSize: 13, color: colors.textDim, textAlign: 'center', lineHeight: 22, paddingHorizontal: 32 }}>Reading your brainstorm, drawing, and writing.{'\n'}Takes about 20–40 seconds.</Text>
        </View>
      </View>
    </Modal>
  );

  // ── Results ──
  if (result) return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
            <View style={[styles.subjectDot, { backgroundColor: color + '20' }]}>
              <Feather name="check-circle" size={18} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Your Results</Text>
              <Text style={styles.meta}>{assignment.title}</Text>
            </View>
            <TouchableOpacity onPress={onClose} activeOpacity={0.7}><Feather name="x" size={22} color={colors.textMuted} /></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <View style={styles.resultBox}>
              <View style={[styles.scoreBadge, { backgroundColor: color + '15', borderColor: color + '30' }]}>
                <Text style={[styles.scoreNum, { color }]}>{result.score != null ? `${result.score}%` : 'Done'}</Text>
                <Text style={[styles.scoreLabel, { color }]}>{result.score != null ? result.score >= 85 ? 'Excellent!' : result.score >= 60 ? 'Good effort!' : 'Keep going!' : 'Submitted'}</Text>
              </View>
              {stamp && (
                <View style={[styles.stampCard, { backgroundColor: stamp.color + '15', borderColor: stamp.color + '40' }]}>
                  <View style={[styles.stampIcon, { backgroundColor: stamp.color }]}>
                    <Feather name={stamp.icon as any} size={20} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stampLabel}>You earned a stamp!</Text>
                    <Text style={[styles.stampName, { color: stamp.color }]}>{result.stamp || stamp.label}</Text>
                  </View>
                </View>
              )}
              <View style={styles.feedbackCard}>
                <Text style={styles.feedbackTitle}>Overall Feedforward</Text>
                <Text style={styles.feedbackText}>{result.feedback}</Text>
              </View>
              {result.wellDone ? (
                <View style={[styles.criteriaRow, { borderColor: colors.accentGreen + '40', backgroundColor: colors.accentGreen + '08' }]}>
                  <Feather name="check-circle" size={16} color={colors.accentGreen} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.criteriaLabel, { color: colors.accentGreen }]}>Well done</Text>
                    <Text style={[styles.criteriaText, { color: colors.textMuted }]}>{result.wellDone}</Text>
                  </View>
                </View>
              ) : null}
              {result.improve ? (
                <View style={[styles.criteriaRow, { borderColor: colors.accentYellow + '40', backgroundColor: colors.accentYellow + '08' }]}>
                  <Feather name="target" size={16} color={colors.accentYellow} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.criteriaLabel, { color: colors.accentYellow }]}>Next time, try to...</Text>
                    <Text style={[styles.criteriaText, { color: colors.textMuted }]}>{result.improve}</Text>
                  </View>
                </View>
              ) : null}
              {result.perQuestion.length > 0 && (
                <View style={{ gap: 8 }}>
                  <Text style={styles.feedbackTitle}>Step by Step</Text>
                  {result.perQuestion.map((q: any, idx: number) => {
                    const qc = !q.answered ? colors.textDim : q.correct ? colors.accentGreen : q.score >= 50 ? colors.accentYellow : colors.accentRed;
                    const qi = !q.answered ? 'minus-circle' : q.correct ? 'check-circle' : q.score >= 50 ? 'alert-circle' : 'x-circle';
                    const stepColor = STEP_COLORS[q.type as StepType] || color;
                    return (
                      <View key={idx} style={[styles.qRow, { borderColor: qc + '40', backgroundColor: qc + '08' }]}>
                        <View style={styles.qLeft}>
                          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: stepColor, alignItems: 'center', justifyContent: 'center' }}>
                            <Feather name={STEP_ICONS[q.type as StepType] as any || 'check'} size={13} color="#fff" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.qNum, { color: stepColor }]}>{q.stepLabel || `Step ${idx + 1}`}</Text>
                            <Text style={[styles.qComment, { color: colors.textMuted }]}>{q.comment}</Text>
                            {q.studentAnswer ? <Text style={[styles.qAnswer, { color: colors.textDim }]}>{q.studentAnswer}</Text> : null}
                          </View>
                        </View>
                        <View style={[styles.qScore, { backgroundColor: qc + '20' }]}>
                          <Text style={[styles.qScoreText, { color: qc }]}>{q.answered ? `${q.score}%` : '--'}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
              <TouchableOpacity style={[styles.submitBtn, { backgroundColor: color }]} onPress={onClose} activeOpacity={0.85}>
                <Feather name="check" size={16} color="#fff" />
                <Text style={styles.submitBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // ── Self-Assessment ──
  if (isSelfAssess) return (
    <Modal visible animationType="slide" transparent onRequestClose={() => setCurrentStep(steps.length - 1)}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
            <View style={[styles.subjectDot, { backgroundColor: color + '20' }]}>
              <Feather name="check-square" size={18} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Check Yourself</Text>
              <Text style={styles.meta}>Before you submit — how did you do?</Text>
            </View>
            <TouchableOpacity onPress={() => setCurrentStep(steps.length - 1)} activeOpacity={0.7}>
              <Feather name="chevron-left" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Text style={{ fontSize: 13, color: colors.textDim, lineHeight: 20, marginBottom: 4 }}>
              Read each statement and tick if you did it. Be honest — this helps you learn!
            </Text>
            {criteria.length > 0 ? criteria.map((c, i) => {
              const checked = !!selfChecked[c];
              return (
                <TouchableOpacity key={i} activeOpacity={0.75} onPress={() => setSelfChecked(prev => ({ ...prev, [c]: !prev[c] }))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, marginBottom: 8,
                    borderWidth: 1.5, borderColor: checked ? color + '60' : colors.borderColor,
                    backgroundColor: checked ? color + '08' : colors.bgDark }}>
                  <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2,
                    borderColor: checked ? color : colors.textDim,
                    backgroundColor: checked ? color : 'transparent',
                    alignItems: 'center', justifyContent: 'center' }}>
                    {checked && <Feather name="check" size={14} color="#fff" />}
                  </View>
                  <Text style={{ flex: 1, fontSize: 14, color: colors.textMain, lineHeight: 20 }}>{c}</Text>
                </TouchableOpacity>
              );
            }) : (
              <View style={{ padding: 16, borderRadius: 12, backgroundColor: colors.borderColor, alignItems: 'center' }}>
                <Text style={{ color: colors.textDim, fontSize: 13 }}>No success criteria set for this assignment.</Text>
              </View>
            )}
            <View style={{ height: 16 }} />
            <TouchableOpacity style={[styles.submitBtn, { backgroundColor: color }]} onPress={handleSubmit} activeOpacity={0.85}>
              <Feather name="send" size={16} color="#fff" />
              <Text style={styles.submitBtnText}>Submit for AI Grading</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setCurrentStep(steps.length - 1)} activeOpacity={0.7} style={{ alignSelf: 'center', paddingVertical: 4 }}>
              <Text style={{ fontSize: 12, color: colors.textDim, textDecorationLine: 'underline' }}>Go back to last step</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // ── Step UI ──
  if (!step) return null;
  const stepColor = STEP_COLORS[step.type as StepType] ?? '#6366f1';
  return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
            <View style={[styles.subjectDot, { backgroundColor: stepColor + '20' }]}>
              <Feather name={STEP_ICONS[step.type] as any} size={18} color={stepColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{step.label}</Text>
              <Text style={[styles.meta, { color: stepColor }]}>Step {currentStep + 1} of {steps.length}</Text>
            </View>
          </View>

          {/* Progress bar */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 4, gap: 4 }}>
            {steps.map((s, i) => (
              <View key={i} style={{ flex: 1, height: 4, borderRadius: 2,
                backgroundColor: i < currentStep ? STEP_COLORS[s.type] : i === currentStep ? stepColor : colors.borderColor,
                opacity: i === currentStep ? 1 : 0.5 }} />
            ))}
            <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.borderColor, opacity: 0.3 }} />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { gap: 16 }]}>
            {/* Instructions */}
            {step.instructions ? (
              <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderRadius: 10, backgroundColor: stepColor + '12', borderWidth: 1, borderColor: stepColor + '30' }}>
                <Feather name="info" size={14} color={stepColor} style={{ marginTop: 1 }} />
                <Text style={{ flex: 1, fontSize: 13, color: colors.textMuted, lineHeight: 20 }}>{step.instructions}</Text>
              </View>
            ) : null}

            {/* ── BRAINSTORM ── */}
            {step.type === 'brainstorm' && (
              <View style={{ gap: 12 }}>
                <Text style={[styles.sectionLabel, { color: stepColor }]}>Your Keywords</Text>
                {/* Existing keywords as chips */}
                {ans.keywords.length > 0 && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {ans.keywords.map((kw, ki) => (
                      <TouchableOpacity key={ki} activeOpacity={0.7}
                        onPress={() => patchAns({ keywords: ans.keywords.filter((_, j) => j !== ki) })}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8,
                          borderRadius: 20, backgroundColor: stepColor + '20', borderWidth: 1, borderColor: stepColor + '50' }}>
                        <Text style={{ fontSize: 14, color: stepColor, fontWeight: '700' }}>{kw}</Text>
                        <Feather name="x" size={11} color={stepColor} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {/* Input */}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={[styles.content, { flex: 1, borderWidth: 1.5, borderColor: stepColor + '60', borderRadius: 12,
                      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: colors.textMain, backgroundColor: colors.bgDark }]}
                    placeholder="Type a keyword and press Add..."
                    placeholderTextColor={colors.textDim}
                    value={keywordInput}
                    onChangeText={setKeywordInput}
                    onSubmitEditing={addKeyword}
                    returnKeyType="done"
                  />
                  <TouchableOpacity onPress={addKeyword} activeOpacity={0.8}
                    style={{ paddingHorizontal: 16, borderRadius: 12, backgroundColor: stepColor, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Add</Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ fontSize: 11, color: colors.textDim, textAlign: 'center' }}>Tap a keyword to remove it</Text>
              </View>
            )}

            {/* ── DRAWING ── */}
            {step.type === 'drawing' && (
              <View style={{ gap: 10 }}>
                <Text style={[styles.sectionLabel, { color: stepColor }]}>
                  {Platform.OS === 'web' ? 'Draw with your mouse or finger' : 'Take a photo of your drawing'}
                </Text>
                {Platform.OS === 'web' ? (
                  <DrawingErrorBoundary>
                    <WebDrawingCanvas color={stepColor} onCapture={(b64, mime) => patchAns({ drawingBase64: b64, drawingMime: mime })} />
                  </DrawingErrorBoundary>
                ) : (
                  <View style={{ gap: 10 }}>
                    {ans.drawingBase64 ? (
                      <View style={{ gap: 8 }}>
                        <Image source={{ uri: `data:${ans.drawingMime};base64,${ans.drawingBase64}` }}
                          style={{ width: '100%', height: 240, borderRadius: 12, backgroundColor: '#f0f0f0' }} resizeMode="contain" />
                        <TouchableOpacity onPress={async () => {
                          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                          if (status !== 'granted') { Alert.alert('Permission needed'); return; }
                          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, base64: true });
                          if (!r.canceled && r.assets?.[0]) patchAns({ drawingBase64: r.assets[0].base64 ?? null, drawingMime: r.assets[0].mimeType ?? 'image/jpeg' });
                        }} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' }}>
                          <Feather name="camera" size={14} color={stepColor} />
                          <Text style={{ fontSize: 13, color: stepColor, fontWeight: '600' }}>Change photo</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={async () => {
                        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                        if (status !== 'granted') { Alert.alert('Permission needed'); return; }
                        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, base64: true });
                        if (!r.canceled && r.assets?.[0]) patchAns({ drawingBase64: r.assets[0].base64 ?? null, drawingMime: r.assets[0].mimeType ?? 'image/jpeg' });
                      }} activeOpacity={0.8}
                        style={{ alignItems: 'center', justifyContent: 'center', gap: 12, padding: 36,
                          borderWidth: 2, borderStyle: 'dashed', borderColor: stepColor + '60', borderRadius: 16, backgroundColor: stepColor + '08' }}>
                        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: stepColor + '20', alignItems: 'center', justifyContent: 'center' }}>
                          <Feather name="camera" size={28} color={stepColor} />
                        </View>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.textMain }}>Upload Drawing Photo</Text>
                        <Text style={{ fontSize: 12, color: colors.textDim }}>Draw on paper, then take a clear photo</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* ── STRUCTURED WRITING ── */}
            {step.type === 'structured_writing' && (
              <View style={{ gap: 12 }}>
                {/* Word Bank */}
                {(step.wordBank?.length ?? 0) > 0 && (
                  <View style={{ gap: 6 }}>
                    <Text style={[styles.sectionLabel, { color: stepColor }]}>Word Bank — Tap to insert</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {step.wordBank!.map((word, wi) => (
                        <TouchableOpacity key={wi} activeOpacity={0.75}
                          style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: stepColor + '15', borderWidth: 1, borderColor: stepColor + '40' }}>
                          <Text style={{ fontSize: 13, color: stepColor, fontWeight: '600' }}>{word}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
                {/* Section text boxes */}
                {ans.sections.map((sec, si) => (
                  <View key={si} style={{ gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: stepColor }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.5 }}>{sec.label}</Text>
                      </View>
                    </View>
                    <TextInput
                      style={{ borderWidth: 1.5, borderColor: stepColor + '40', borderRadius: 12,
                        padding: 14, fontSize: 15, color: colors.textMain, backgroundColor: colors.bgDark,
                        minHeight: 90, textAlignVertical: 'top', lineHeight: 24 }}
                      placeholder={`Write your ${sec.label.toLowerCase()} here...`}
                      placeholderTextColor={colors.textDim}
                      value={sec.text}
                      onChangeText={t => patchAns({ sections: ans.sections.map((s, j) => j === si ? { ...s, text: t } : s) })}
                      multiline
                    />
                  </View>
                ))}
              </View>
            )}

            {/* Navigation */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {currentStep > 0 && (
                <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: colors.borderColor }]}
                  onPress={() => setCurrentStep(s => s - 1)} activeOpacity={0.85}>
                  <Feather name="chevron-left" size={16} color={colors.textMuted} />
                  <Text style={[styles.submitBtnText, { color: colors.textMuted }]}>Back</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.submitBtn, { flex: 2, backgroundColor: stepColor }]}
                onPress={() => setCurrentStep(s => s + 1)} activeOpacity={0.85}>
                <Text style={styles.submitBtnText}>{isLastDataStep ? 'Check Yourself' : 'Next Step'}</Text>
                <Feather name={isLastDataStep ? 'check-square' : 'chevron-right'} size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Submission Modal ──────────────────────────────────────────────────────────
// Flow: Page 1 image → upload answer → Page 2 → upload → ... → Review → Submit → Results

function SubmissionModal({ assignment, colors, onClose, onSubmitted }: {
  assignment: Assignment;
  colors: AppColors;
  onClose: () => void;
  onSubmitted: (updated: Assignment & { aiFeedback: string; perQuestion: any[] }) => void;
}) {
  const styles = useMemo(() => makeModalStyles(colors), [colors]);
  const { studentId } = useStudentData();
  const color = SUBJECT_COLOR[assignment.subject] ?? '#6366f1';

  // Pages = worksheet images uploaded by teacher
  const pages: string[] = (assignment.documentUrls?.length ?? 0) > 0
    ? assignment.documentUrls!
    : assignment.documentUrl ? [assignment.documentUrl] : [];

  const totalSteps = pages.length || 1; // at least 1 step even if no pages

  // answers[i] = student's photo answer for page i
  const [answers, setAnswers] = useState<PageAnswer[]>(() =>
    Array.from({ length: totalSteps }, () => ({ preview: null, base64: null, mime: 'image/jpeg' }))
  );
  const [step, setStep]           = useState(0); // 0..totalSteps-1 = page steps
  const [showReview, setShowReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult]       = useState<GradeResult | null>(null);

  const currentAnswer = answers[step] ?? { preview: null, base64: null, mime: 'image/jpeg' };
  const answeredCount = answers.filter(a => a.base64).length;
  const stamp = result ? getStamp(result.score) : null;

  function setAns(stepIndex: number, a: Partial<PageAnswer>) {
    setAnswers(prev => prev.map((x, i) => i === stepIndex ? { ...x, ...a } : x));
  }

  async function pickPhoto(stepIndex: number) {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          setAns(stepIndex, { preview: dataUrl, base64: dataUrl.split(',')[1], mime: file.type });
        };
        reader.readAsDataURL(file);
      };
      input.click();
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Allow access to your photos.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, quality: 0.7, base64: true });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setAns(stepIndex, { preview: asset.uri, base64: asset.base64 ?? null, mime: asset.mimeType ?? 'image/jpeg' });
    }
  }

  async function handleSubmit() {
    setShowReview(false);
    setSubmitting(true);
    try {
      const questionImages = answers.map(a => ({ imageBase64: a.base64 || null, imageMime: a.mime }));
      const res = await fetch(`${SERVER_URL}/assignments/${assignment.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, answers: [], questionImages }),
      });
      const data = await res.json();
      if (res.ok) {
        let feedbackText = data.aiFeedback || '';
        let stamp = ''; let wellDone = ''; let improve = ''; let pq: PerQ[] = [];
        try {
          const parsed = JSON.parse(feedbackText);
          feedbackText = parsed.text     || feedbackText;
          stamp        = parsed.stamp    || '';
          wellDone     = parsed.wellDone || '';
          improve      = parsed.improve  || '';
          pq           = Array.isArray(parsed.perQuestion) ? parsed.perQuestion : (data.perQuestion || []);
        } catch { pq = data.perQuestion || []; }
        setResult({ score: data.score, feedback: feedbackText, stamp, wellDone, improve, perQuestion: pq });
        onSubmitted(data);
      } else {
        Alert.alert('Error', data.error || 'Submission failed');
        setShowReview(true);
      }
    } catch {
      Alert.alert('Network error. Please try again.');
      setShowReview(true);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Grading screen ──
  if (submitting) {
    return (
      <Modal visible animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { justifyContent: 'center', alignItems: 'center', paddingVertical: 80, gap: 24 }]}>
            <ActivityIndicator size="large" color={color} />
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.textMain, textAlign: 'center' }}>
              AI is grading your work...
            </Text>
            <Text style={{ fontSize: 13, color: colors.textDim, textAlign: 'center', lineHeight: 22, paddingHorizontal: 32 }}>
              Analysing each page and comparing with your answers.{'\n'}This takes 20–40 seconds.
            </Text>
          </View>
        </View>
      </Modal>
    );
  }

  // ── Results screen ──
  if (result) {
    return (
      <Modal visible animationType="slide" transparent onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
              <View style={[styles.subjectDot, { backgroundColor: color + '20' }]}>
                <Feather name="check-circle" size={18} color={color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Your Results</Text>
                <Text style={styles.meta}>{assignment.title}</Text>
              </View>
              <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
                <Feather name="x" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <View style={styles.resultBox}>
                {/* Score */}
                <View style={[styles.scoreBadge, { backgroundColor: color + '15', borderColor: color + '30' }]}>
                  <Text style={[styles.scoreNum, { color }]}>{result.score != null ? `${result.score}%` : 'Done'}</Text>
                  <Text style={[styles.scoreLabel, { color }]}>
                    {result.score != null ? result.score >= 85 ? 'Excellent work!' : result.score >= 60 ? 'Good effort!' : 'Keep practising!' : 'Submitted'}
                  </Text>
                </View>
                {/* Stamp */}
                {stamp && (
                  <View style={[styles.stampCard, { backgroundColor: stamp.color + '15', borderColor: stamp.color + '40' }]}>
                    <View style={[styles.stampIcon, { backgroundColor: stamp.color }]}>
                      <Feather name={stamp.icon as any} size={20} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stampLabel}>You earned a stamp!</Text>
                      <Text style={[styles.stampName, { color: stamp.color }]}>{result.stamp || stamp.label}</Text>
                    </View>
                  </View>
                )}
                {/* Feedback */}
                <View style={styles.feedbackCard}>
                  <Text style={styles.feedbackTitle}>Overall Feedback</Text>
                  <Text style={styles.feedbackText}>{result.feedback}</Text>
                </View>
                {result.wellDone ? (
                  <View style={[styles.criteriaRow, { borderColor: colors.accentGreen + '40', backgroundColor: colors.accentGreen + '08' }]}>
                    <Feather name="check-circle" size={16} color={colors.accentGreen} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.criteriaLabel, { color: colors.accentGreen }]}>Well done</Text>
                      <Text style={[styles.criteriaText, { color: colors.textMuted }]}>{result.wellDone}</Text>
                    </View>
                  </View>
                ) : null}
                {result.improve ? (
                  <View style={[styles.criteriaRow, { borderColor: colors.accentYellow + '40', backgroundColor: colors.accentYellow + '08' }]}>
                    <Feather name="target" size={16} color={colors.accentYellow} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.criteriaLabel, { color: colors.accentYellow }]}>Next time</Text>
                      <Text style={[styles.criteriaText, { color: colors.textMuted }]}>{result.improve}</Text>
                    </View>
                  </View>
                ) : null}
                {/* Per-page breakdown */}
                {result.perQuestion.length > 0 && (
                  <View style={{ gap: 8 }}>
                    <Text style={styles.feedbackTitle}>Page by Page</Text>
                    {result.perQuestion.map((q, idx) => {
                      const qColor = !q.answered ? colors.textDim : q.correct ? colors.accentGreen : q.score >= 50 ? colors.accentYellow : colors.accentRed;
                      const qIcon = !q.answered ? 'minus-circle' : q.correct ? 'check-circle' : q.score >= 50 ? 'alert-circle' : 'x-circle';
                      return (
                        <View key={idx} style={[styles.qRow, { borderColor: qColor + '40', backgroundColor: qColor + '08' }]}>
                          <View style={styles.qLeft}>
                            <Feather name={qIcon as any} size={16} color={qColor} />
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.qNum, { color: qColor }]}>Page {q.number ?? idx + 1}</Text>
                              {q.question ? <Text style={styles.qText} numberOfLines={2}>{q.question}</Text> : null}
                              <Text style={[styles.qComment, { color: q.answered ? colors.textMuted : qColor }]}>{q.comment}</Text>
                              {q.studentAnswer ? <Text style={[styles.qAnswer, { color: colors.textDim }]}>You wrote: {q.studentAnswer}</Text> : null}
                            </View>
                          </View>
                          <View style={[styles.qScore, { backgroundColor: qColor + '20' }]}>
                            <Text style={[styles.qScoreText, { color: qColor }]}>{q.answered ? `${q.score}%` : '--'}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
                <TouchableOpacity style={[styles.submitBtn, { backgroundColor: color }]} onPress={onClose} activeOpacity={0.85}>
                  <Feather name="check" size={16} color="#fff" />
                  <Text style={styles.submitBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  // ── Review screen ──
  if (showReview) {
    return (
      <Modal visible animationType="slide" transparent onRequestClose={() => setShowReview(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
              <View style={[styles.subjectDot, { backgroundColor: color + '20' }]}>
                <Feather name="check-square" size={18} color={color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Review Answers</Text>
                <Text style={styles.meta}>{answeredCount} of {totalSteps} pages answered</Text>
              </View>
              <TouchableOpacity onPress={() => setShowReview(false)} activeOpacity={0.7}>
                <Feather name="x" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <Text style={{ fontSize: 13, color: colors.textDim, marginBottom: 12 }}>
                Tap any page to go back and change your answer.
              </Text>
              {answers.map((ans, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.qReviewRow, {
                    borderColor: ans.base64 ? color + '40' : colors.accentRed + '40',
                    backgroundColor: ans.base64 ? color + '06' : colors.accentRed + '06',
                  }]}
                  onPress={() => { setStep(i); setShowReview(false); }}
                  activeOpacity={0.8}
                >
                  <View style={[styles.taskNum, { backgroundColor: ans.base64 ? color : colors.accentRed }]}>
                    <Text style={[styles.taskNumText, { color: '#fff' }]}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textMain }}>Page {i + 1}</Text>
                    <Text style={{ fontSize: 11, color: ans.base64 ? colors.accentGreen : colors.accentRed, marginTop: 2, fontWeight: '600' }}>
                      {ans.base64 ? 'Answer uploaded' : 'No answer — tap to add'}
                    </Text>
                  </View>
                  {ans.preview ? (
                    <Image source={{ uri: ans.preview }} style={{ width: 56, height: 56, borderRadius: 8 }} resizeMode="cover" />
                  ) : (
                    <View style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: colors.borderColor, alignItems: 'center', justifyContent: 'center' }}>
                      <Feather name="camera" size={22} color={colors.textDim} />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
              {answeredCount < totalSteps && (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 10, backgroundColor: colors.accentYellow + '12', borderWidth: 1, borderColor: colors.accentYellow + '30', marginBottom: 4 }}>
                  <Feather name="alert-triangle" size={14} color={colors.accentYellow} />
                  <Text style={{ flex: 1, fontSize: 12, color: colors.accentYellow, fontWeight: '600' }}>
                    {totalSteps - answeredCount} page{totalSteps - answeredCount > 1 ? 's' : ''} not answered. You can still submit.
                  </Text>
                </View>
              )}
              <TouchableOpacity style={[styles.submitBtn, { backgroundColor: color }]} onPress={handleSubmit} activeOpacity={0.85}>
                <Feather name="send" size={16} color="#fff" />
                <Text style={styles.submitBtnText}>Submit for AI Grading</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  // ── Page step (main flow) ──
  const pageUrl = pages[step] ?? null;
  const isLastStep = step === totalSteps - 1;

  return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
            <View style={[styles.subjectDot, { backgroundColor: color + '20' }]}>
              <Feather name={(SUBJECT_ICON[assignment.subject] ?? 'book-open') as any} size={18} color={color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{assignment.title}</Text>
              <Text style={[styles.meta, { color }]}>Page {step + 1} of {totalSteps}</Text>
            </View>
            {/* No close on page steps — must go through review */}
          </View>

          {/* Progress bar */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 10, gap: 5 }}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <View key={i} style={{
                flex: i === step ? 2 : 1, height: 5, borderRadius: 3,
                backgroundColor: i === step ? color : answers[i]?.base64 ? color + '70' : colors.borderColor,
              }} />
            ))}
            <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.borderColor }} />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {/* Worksheet page image — full width */}
            {pageUrl ? (
              <WorksheetPageImage url={pageUrl} pageNum={step + 1} color={color} colors={colors} />
            ) : (
              assignment.note ? (
                <View style={[styles.noteBox, { backgroundColor: color + '12', borderColor: color + '30' }]}>
                  <Feather name="info" size={14} color={color} />
                  <Text style={[styles.noteText, { color: colors.textMuted }]}>{assignment.note}</Text>
                </View>
              ) : null
            )}

            {/* Upload answer for this page */}
            <View style={styles.uploadSection}>
              <Text style={styles.sectionLabel}>Your Answer for Page {step + 1}</Text>
              <Text style={[styles.uploadHint, { color: colors.textDim }]}>
                Complete this page on paper, then take a clear photo of your answers.
              </Text>
              {currentAnswer.preview ? (
                <View style={styles.previewWrap}>
                  <Image source={{ uri: currentAnswer.preview }} style={styles.photoPreview} resizeMode="contain" />
                  <TouchableOpacity style={styles.changePhotoBtn} onPress={() => pickPhoto(step)} activeOpacity={0.8}>
                    <Feather name="camera" size={13} color={color} />
                    <Text style={[styles.changePhotoText, { color }]}>Change photo</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.uploadBtn, { borderColor: color + '60', backgroundColor: color + '08' }]}
                  onPress={() => pickPhoto(step)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.uploadIconCircle, { backgroundColor: color + '20' }]}>
                    <Feather name="camera" size={28} color={color} />
                  </View>
                  <Text style={[styles.uploadBtnTitle, { color: colors.textMain }]}>Upload Your Answer</Text>
                  <Text style={[styles.uploadBtnSub, { color: colors.textDim }]}>Take a clear photo of your written answers</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Navigation */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {step > 0 && (
                <TouchableOpacity
                  style={[styles.submitBtn, { flex: 1, backgroundColor: colors.borderColor }]}
                  onPress={() => setStep(s => s - 1)}
                  activeOpacity={0.85}
                >
                  <Feather name="chevron-left" size={16} color={colors.textMuted} />
                  <Text style={[styles.submitBtnText, { color: colors.textMuted }]}>Back</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.submitBtn, { flex: 2, backgroundColor: color }]}
                onPress={() => isLastStep ? setShowReview(true) : setStep(s => s + 1)}
                activeOpacity={0.85}
              >
                <Text style={styles.submitBtnText}>
                  {isLastStep ? 'Review & Submit' : 'Next Page'}
                </Text>
                <Feather name={isLastStep ? 'check-square' : 'chevron-right'} size={16} color="#fff" />
              </TouchableOpacity>
            </View>

            {!currentAnswer.base64 && (
              <TouchableOpacity
                onPress={() => isLastStep ? setShowReview(true) : setStep(s => s + 1)}
                activeOpacity={0.7}
                style={{ alignSelf: 'center', paddingVertical: 4 }}
              >
                <Text style={{ fontSize: 12, color: colors.textDim, textDecorationLine: 'underline' }}>
                  Skip this page
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Single page image with zoom ───────────────────────────────────────────────

function WorksheetPageImage({ url, pageNum, color, colors }: { url: string; pageNum: number; color: string; colors: AppColors }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <View>
      <TouchableOpacity onPress={() => setZoomed(true)} activeOpacity={0.92}>
        <Image source={{ uri: url }} style={{ width: '100%', height: 360, borderRadius: 12, backgroundColor: '#f0f0f0', borderWidth: 1, borderColor: color + '30' }} resizeMode="contain" />
        <View style={{ position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Feather name="zoom-in" size={12} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>Tap to zoom</Text>
        </View>
      </TouchableOpacity>
      {zoomed && (
        <Modal visible animationType="fade" transparent onRequestClose={() => setZoomed(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.97)' }}>
            <TouchableOpacity
              style={{ position: 'absolute', top: 48, right: 20, zIndex: 10, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20, padding: 10 }}
              onPress={() => setZoomed(false)} activeOpacity={0.8}
            >
              <Feather name="x" size={22} color="#fff" />
            </TouchableOpacity>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 8 }}
              maximumZoomScale={4}
              minimumZoomScale={1}
              bouncesZoom
              showsVerticalScrollIndicator={false}
            >
              <Image source={{ uri: url }} style={{ width: '100%', aspectRatio: 0.75 }} resizeMode="contain" />
            </ScrollView>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, textAlign: 'center', paddingBottom: 24 }}>Pinch to zoom - Scroll to pan</Text>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────────

export default function AssignmentsScreen({ navigation }: any) {
  const [activeFilter, setActiveFilter] = useState('All');
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { studentId } = useStudentData();
  const { clearUnreadAssignments } = useNotification();

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeAssignment, setActiveAssignment] = useState<Assignment | null>(null);
  const [openingAssignmentId, setOpeningAssignmentId] = useState<string | null>(null);

  function load() {
    if (!studentId) return;
    fetch(`${SERVER_URL}/assignments?studentId=${studentId}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAssignments(data); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    load();
    clearUnreadAssignments(); // mark assignments as seen when screen opens
  }, [studentId]);

  const sortByPendingFirst = (list: Assignment[]) =>
    [...list].sort((a, b) => {
      if (a.status === b.status) {
        // Both pending: sort by due date ascending (soonest first)
        if (a.status === 'pending') return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        // Both completed: sort by most recent first
        return new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime();
      }
      return a.status === 'pending' ? -1 : 1; // pending always before completed
    });

  const filtered = useMemo(() => {
    if (activeFilter === 'All')       return sortByPendingFirst(assignments);
    if (activeFilter === 'Pending')   return sortByPendingFirst(assignments.filter(a => a.status === 'pending'));
    if (activeFilter === 'Completed') return assignments.filter(a => a.status === 'completed').sort((a,b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());
    if (activeFilter === 'Quizzes')   return sortByPendingFirst(assignments.filter(a => a.type === 'quiz'));
    return sortByPendingFirst(assignments);
  }, [assignments, activeFilter]);

  const pending   = assignments.filter(a => a.status === 'pending').length;
  const completed = assignments.filter(a => a.status === 'completed').length;
  const overdue   = assignments.filter(a => {
    if (a.status !== 'pending') return false;
    const today = new Date(); today.setHours(0,0,0,0);
    return new Date(a.dueDate) < today;
  }).length;

  function handleSubmitted(updated: Assignment & { aiFeedback: string; perQuestion: any[] }) {
    setAssignments(prev => prev.map(a => a.id === updated.id ? updated : a));
  }

  function normalizeQuizQuestions(rawQuestions: any[]): QuizQuestion[] {
    return (rawQuestions || []).reduce<QuizQuestion[]>((acc, q: any, i: number) => {
      if (!q) return acc;

      // MCQ-only policy: ignore plain string questions (treated as short-answer legacy data)
      if (typeof q === 'string') return acc;

      const questionText = String(q.question || '').trim();
      if (!questionText) return acc;

      const options = Array.isArray(q.options)
        ? q.options.map((opt: any) => String(opt).trim()).filter(Boolean)
        : undefined;
      const optionTexts = options?.map((opt: string) => opt.replace(/^[A-D]\.\s*/i, '').trim());
      const normalizedType: 'mcq' | 'short_answer' =
        (q.type === 'short_answer' || !optionTexts || optionTexts.length === 0) ? 'short_answer' : 'mcq';
      if (normalizedType !== 'mcq') return acc;
      if (!optionTexts || optionTexts.length !== 4) return acc;

      let correct = '';
      if (normalizedType === 'mcq' && optionTexts && optionTexts.length > 0) {
        if (typeof q.correct === 'number' && optionTexts[q.correct]) {
          correct = optionTexts[q.correct];
        } else if (typeof q.correct === 'string') {
          const letter = q.correct.trim().match(/^([A-D])(?:\.|\b)/i)?.[1]?.toUpperCase();
          if (letter) {
            const idx = 'ABCD'.indexOf(letter);
            correct = idx >= 0 && optionTexts[idx] ? optionTexts[idx] : q.correct.replace(/^[A-D]\.\s*/i, '').trim();
          } else {
            correct = q.correct.replace(/^[A-D]\.\s*/i, '').trim();
          }
        }
      } else if (typeof q.correct === 'string') {
        correct = q.correct.trim();
      }

      acc.push({
        id: String(q.id || `q${i + 1}`),
        question: questionText,
        type: 'mcq',
        options: optionTexts,
        correct,
        hint: q.hint ? String(q.hint) : '',
        explanation: q.explanation ? String(q.explanation) : '',
      });
      return acc;
    }, []);
  }

  async function hydrateQuizQuestions(item: Assignment): Promise<QuizQuestion[]> {
    const fromLocal = normalizeQuizQuestions((item as any).quizQuestions || []);
    if (fromLocal.length > 0) return fromLocal;

    const fromLegacy = normalizeQuizQuestions((item as any).questions || []);
    if (fromLegacy.length > 0) return fromLegacy;

    const topic = (item.chapter || item.subject || '').trim();
    if (!topic) return [];

    try {
      const primaryRes = await fetch(`${SERVER_URL}/assignments/generate-quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: item.subject || 'Mathematics',
          chapter: topic,
          grade: item.grade || 'Grade 3',
          curriculum: item.curriculum || 'NCERT',
          difficulty: 'medium',
          count: 5,
          teacherNotes: '',
        }),
      });
      const primaryData = await primaryRes.json().catch(() => null);
      if (primaryRes.ok && Array.isArray(primaryData?.questions)) {
        const normalized = normalizeQuizQuestions(primaryData.questions);
        if (normalized.length > 0) return normalized;
      }
    } catch {
      // fallback below
    }

    try {
      const fallbackPath = item.subject?.toLowerCase().includes('science') ? '/ncert/science-quiz' : '/ncert/quiz';
      const fallbackRes = await fetch(`${SERVER_URL}${fallbackPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, context: '' }),
      });
      const fallbackData = await fallbackRes.json().catch(() => null);
      if (fallbackRes.ok && Array.isArray(fallbackData?.questions)) {
        return normalizeQuizQuestions(fallbackData.questions);
      }
    } catch {
      // no-op
    }

    return [];
  }

  async function openAssignment(item: Assignment) {
    setOpeningAssignmentId(item.id);
    try {
      if (item.type === 'quiz') {
        const local = normalizeQuizQuestions((item.quizQuestions as any[]) || (item.questions as any[]) || []);
        if (local.length > 0) {
          setActiveAssignment({ ...item, quizQuestions: local });
          return;
        }
        const hydrated = await hydrateQuizQuestions(item);
        if (hydrated.length === 0) {
          Alert.alert('Quiz not ready', 'This quiz has no questions yet. Please ask your teacher to regenerate it.');
          return;
        }
        setActiveAssignment({ ...item, quizQuestions: hydrated });
        return;
      }
      setActiveAssignment(item);
    } finally {
      setOpeningAssignmentId(null);
    }
  }

  if (loading) {
    return (
      <ScreenLayout>
        <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title="Assignments"
          subtitle="Your tasks and upcoming deadlines"
          searchPlaceholder="Search assignments..."
          onMenuPress={() => navigation.openDrawer()}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Stats */}
          <View style={styles.statsRow}>
            {[
              { label: 'Pending',   value: pending,   color: colors.accentYellow, icon: 'clock' as const },
              { label: 'Completed', value: completed, color: colors.accentGreen,  icon: 'check-circle' as const },
              { label: 'Overdue',   value: overdue,   color: colors.accentRed,    icon: 'alert-circle' as const },
            ].map((s) => (
              <View key={s.label} style={styles.statCard}>
                <View>
                  <Text style={styles.statLabel}>{s.label}</Text>
                  <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                </View>
                <View style={[styles.statIcon, { backgroundColor: s.color + '18', borderColor: s.color + '33' }]}>
                  <Feather name={s.icon} size={20} color={s.color} />
                </View>
              </View>
            ))}
          </View>

          {/* Filter Tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
            {FILTERS.map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.filterTab, activeFilter === f && styles.filterTabActive]}
                onPress={() => setActiveFilter(f)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterText, activeFilter === f && styles.filterTextActive]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Assignment list */}
          {filtered.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 48 }}>
              <Feather name="check-square" size={36} color={colors.textDim} />
              <Text style={[styles.sectionTitle, { color: colors.textMuted, marginTop: 12, fontWeight: '400' }]}>
                {activeFilter === 'Completed' ? 'No completed assignments yet.' : 'No assignments yet. Your teacher will assign work soon.'}
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  {activeFilter === 'All' ? 'All Assignments' : activeFilter === 'Completed' ? 'Completed' : activeFilter === 'Quizzes' ? 'Quizzes' : 'Pending Tasks'}
                </Text>
                <Text style={styles.sectionSub}>{filtered.length} item{filtered.length !== 1 ? 's' : ''}</Text>
              </View>
              {filtered.map((item) => {
                const icon  = SUBJECT_ICON[item.subject] ?? 'book-open';
                const color = SUBJECT_COLOR[item.subject] ?? colors.primary;
                const due   = item.status === 'completed'
                  ? { label: item.score != null ? `Score: ${item.score}%` : 'Completed', colorKey: 'textMuted' as const, isOverdue: false }
                  : formatDueDate(item.dueDate);
                const dueColor = colors[due.colorKey as keyof AppColors] as string;
                const statusColor = item.status === 'completed'
                  ? colors.accentGreen
                  : due.isOverdue
                  ? colors.accentRed
                  : colors.accentYellow;
                const statusStyle = {
                  bg: statusColor + '16',
                  color: statusColor,
                  border: statusColor + '38',
                  label: item.status === 'completed'
                    ? (item.score != null ? `${item.score}%` : 'Done')
                    : due.isOverdue ? 'Overdue' : 'Pending',
                };

                return (
                  <View key={item.id} style={[styles.card, item.status === 'completed' && styles.cardCompleted]}>
                    <View style={[styles.subjectIcon, { backgroundColor: color + '16', borderColor: color + '38' }]}>
                      <Feather name={icon as any} size={20} color={color} />
                    </View>
                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle}>{item.title}</Text>
                      <Text style={styles.cardMeta}>
                        {item.subject}{item.chapter ? ` - ${item.chapter}` : ''}{item.grade ? ` - ${item.grade}` : ''}
                      </Text>
                      {item.questions?.length > 0 && (
                        <Text style={[styles.cardNote, { color: colors.textDim }]}>{item.questions.length} question{item.questions.length !== 1 ? 's' : ''}</Text>
                      )}
                      {item.aiFeedback && item.status === 'completed' && (() => {
                        try { return <Text style={styles.feedbackPreview} numberOfLines={1}>{JSON.parse(item.aiFeedback!).text}</Text>; }
                        catch { return <Text style={styles.feedbackPreview} numberOfLines={1}>{item.aiFeedback}</Text>; }
                      })()}
                      <View style={styles.cardBottom}>
                        <View style={styles.dueRow}>
                          {due.isOverdue && <Feather name="alert-triangle" size={12} color={dueColor} style={{ marginRight: 4 }} />}
                          {!due.isOverdue && item.status === 'pending' && <Feather name="clock" size={12} color={dueColor} style={{ marginRight: 4 }} />}
                          <Text style={[styles.dueText, { color: dueColor }]}>{due.label}</Text>
                        </View>
                        <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg, borderColor: statusStyle.border }]}>
                          <Text style={[styles.statusText, { color: statusStyle.color }]}>{statusStyle.label}</Text>
                        </View>
                      </View>
                    </View>
                    {item.status === 'pending' && (
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: color + '20', borderColor: color + '40', borderWidth: 1 }]}
                        activeOpacity={0.7}
                        onPress={() => openAssignment(item)}
                        disabled={openingAssignmentId === item.id}
                      >
                        {openingAssignmentId === item.id
                          ? <ActivityIndicator size="small" color={color} />
                          : <Feather name="play" size={13} color={color} />}
                        <Text style={[styles.actionBtnText, { color }]}>{openingAssignmentId === item.id ? 'Loading' : 'Start'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>

        {activeAssignment && (activeAssignment.quizQuestions?.length ?? 0) > 0 ? (
          <QuizModal
            assignment={activeAssignment}
            colors={colors}
            onClose={() => setActiveAssignment(null)}
            onSubmitted={(updated) => { handleSubmitted(updated); setActiveAssignment(null); }}
          />
        ) : activeAssignment && (activeAssignment.taskSteps?.length ?? 0) > 0 ? (
          <ScaffoldedModal
            assignment={activeAssignment}
            colors={colors}
            onClose={() => setActiveAssignment(null)}
            onSubmitted={(updated) => { handleSubmitted(updated); setActiveAssignment(null); }}
          />
        ) : activeAssignment ? (
          <SubmissionModal
            assignment={activeAssignment}
            colors={colors}
            onClose={() => setActiveAssignment(null)}
            onSubmitted={(updated) => { handleSubmitted(updated); setActiveAssignment(null); }}
          />
        ) : null}
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgDark },
  scroll: { flex: 1 },
  content: { padding: spacing.xl, paddingBottom: 40 },
  statsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xxl },
  statCard: {
    flex: 1, backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.lg, padding: spacing.lg, flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center',
  },
  statLabel: { fontSize: 11, color: c.textMuted, fontWeight: '500', marginBottom: 4 },
  statValue: { fontSize: 28, fontWeight: '700', letterSpacing: -1 },
  statIcon: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  filtersScroll: { marginBottom: spacing.xxl },
  filterTab: { paddingHorizontal: spacing.lg, paddingVertical: 10, marginRight: spacing.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  filterTabActive: { borderBottomColor: c.primary },
  filterText: { fontSize: 13, fontWeight: '500', color: c.textMuted },
  filterTextActive: { color: c.textMain },
  sectionHeader: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.textMain },
  sectionSub: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  card: {
    backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor,
    borderRadius: radius.xl, padding: spacing.xl, marginBottom: spacing.md,
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
  },
  cardCompleted: { borderColor: c.accentGreen + '2D' },
  subjectIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: c.textMain, marginBottom: 3 },
  cardMeta: { fontSize: 12, color: c.textMuted },
  cardNote: { fontSize: 11, marginTop: 2 },
  feedbackPreview: { fontSize: 11, marginTop: 4, color: c.accentGreen, lineHeight: 16 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  dueRow: { flexDirection: 'row', alignItems: 'center' },
  dueText: { fontSize: 12, fontWeight: '500' },
  statusBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '600' },
  actionBtn: { height: 34, paddingHorizontal: spacing.md, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, minWidth: 64 },
  actionBtnText: { fontSize: 12, fontWeight: '700' },
});

const makeModalStyles = (c: AppColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.cardDark, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '94%', borderWidth: 1, borderBottomWidth: 0, borderColor: c.borderColor },
  quizSheet: { maxHeight: '100%', height: '100%', borderTopLeftRadius: 0, borderTopRightRadius: 0, borderWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.xl, borderBottomWidth: 1, gap: spacing.md },
  subjectDot: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: c.textMain },
  meta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  content: { padding: spacing.xl, paddingBottom: 48, gap: spacing.xl },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  noteBox: { flexDirection: 'row', gap: 8, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, alignItems: 'flex-start' },
  noteText: { flex: 1, fontSize: 13, lineHeight: 20 },

  // Tasks list
  tasksList: { gap: 8 },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  taskNum: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  taskNumText: { fontSize: 11, fontWeight: '800' },
  taskText: { flex: 1, fontSize: 14, color: c.textMain, lineHeight: 22 },

  // Upload
  uploadSection: { gap: 8 },
  uploadHint: { fontSize: 13, lineHeight: 20, marginBottom: 4 },
  uploadBtn: {
    alignItems: 'center', justifyContent: 'center', gap: 12,
    borderWidth: 2, borderStyle: 'dashed', borderRadius: radius.xl,
    paddingVertical: 36, paddingHorizontal: spacing.xl,
  },
  uploadIconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  uploadBtnTitle: { fontSize: 16, fontWeight: '700' },
  uploadBtnSub: { fontSize: 12 },
  previewWrap: { gap: 8 },
  photoPreview: { width: '100%', height: 240, borderRadius: radius.lg, backgroundColor: '#111' },
  changePhotoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' },
  changePhotoText: { fontSize: 13, fontWeight: '600' },

  // Submit
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderRadius: radius.lg },
  compactBtn: { paddingVertical: 12, paddingHorizontal: 18, minWidth: 140 },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Results
  resultBox: { gap: spacing.lg },
  scoreBadge: { alignItems: 'center', padding: spacing.xxl, borderRadius: radius.xl, borderWidth: 1 },
  scoreNum: { fontSize: 56, fontWeight: '900', letterSpacing: -2 },
  scoreLabel: { fontSize: 17, fontWeight: '700', marginTop: 6 },

  stampCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, borderWidth: 1 },
  stampIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  stampLabel: { fontSize: 11, color: c.textDim, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  stampName: { fontSize: 16, fontWeight: '800', marginTop: 2 },

  feedbackCard: { backgroundColor: c.bgDark, borderRadius: radius.lg, padding: spacing.lg, gap: 6 },
  feedbackTitle: { fontSize: 11, fontWeight: '700', color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.8 },
  feedbackText: { fontSize: 15, color: c.textMain, lineHeight: 24 },

  criteriaRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  criteriaLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  criteriaText: { fontSize: 13, lineHeight: 20 },

  // Question step
  questionCard: { borderWidth: 1.5, borderRadius: radius.xl, padding: spacing.xl, gap: 12 },
  qNumBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  qNumBadgeText: { fontSize: 12, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  questionText: { fontSize: 17, fontWeight: '700', color: c.textMain, lineHeight: 26 },

  // Review row
  qReviewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, marginBottom: 10 },

  // Per-question breakdown
  qRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginBottom: 8 },
  qLeft: { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  qNum: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 1 },
  qText: { fontSize: 13, fontWeight: '600', color: c.textMain, lineHeight: 18, marginBottom: 3 },
  qComment: { fontSize: 12, lineHeight: 18 },
  qAnswer: { fontSize: 11, marginTop: 3, fontStyle: 'italic' },
  qScore: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, alignItems: 'center', justifyContent: 'center', minWidth: 44 },
  qScoreText: { fontSize: 13, fontWeight: '800' },
});

