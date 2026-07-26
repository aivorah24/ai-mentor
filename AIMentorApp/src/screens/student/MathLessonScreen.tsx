/**
 * MathLessonScreen.tsx
 * Math Learning Engine renderer (Stage 4). Fetches the canonical math lesson
 * schema from /math-engine/lesson and derives its step sequence generically
 * from whichever schema fields are present — no per-chapter/per-grade
 * branching lives here, so any chapter following the schema renders
 * correctly without screen changes.
 *
 * Voice only ever narrates spokenIntro/spokenExplanation fields — equations
 * and numbers are rendered as visual text, never spoken.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import { spacing, radius } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

type Step = { stepText: string; spokenExplanation: string; visual?: string | null };
type WorkedExample = { problem: string; spokenIntro: string; steps: Step[]; finalAnswer: string };
type ExerciseQuestion = WorkedExample & { officialAnswer: string; commonMistake?: string | null; hint?: string | null };
type PracticeProblem = { problem: string; hint?: string | null; finalAnswer: string };

type MathLesson = {
  meta: { curriculum: string; grade: string; subject: string; chapterCode: string; chapterTitle: string };
  concept: { title: string; description: string; learningObjective: string; prerequisites: string[] };
  formulas: { name: string; expression: string; description: string }[];
  properties: { title: string; description: string }[];
  visuals: { description: string; figureUrl?: string }[];
  workedExamples: WorkedExample[];
  exerciseQuestions: ExerciseQuestion[];
  practiceProblems: PracticeProblem[];
};

// A flat, generic scene the renderer walks through. Derived from whichever
// schema sections the lesson actually has — chapters that lack a section
// (e.g. no formulas) simply produce fewer scenes, no special-casing needed.
type Scene =
  | { kind: 'concept'; data: MathLesson['concept'] }
  | { kind: 'formula'; data: MathLesson['formulas'][number] }
  | { kind: 'property'; data: MathLesson['properties'][number] }
  | { kind: 'worked_example'; data: WorkedExample }
  | { kind: 'exercise_question'; data: ExerciseQuestion }
  | { kind: 'practice_attempt'; data: PracticeProblem; index: number };

function buildScenes(lesson: MathLesson): Scene[] {
  const scenes: Scene[] = [];
  if (lesson.concept) scenes.push({ kind: 'concept', data: lesson.concept });
  (lesson.formulas || []).forEach(f => scenes.push({ kind: 'formula', data: f }));
  (lesson.properties || []).forEach(p => scenes.push({ kind: 'property', data: p }));
  (lesson.workedExamples || []).forEach(w => scenes.push({ kind: 'worked_example', data: w }));
  (lesson.exerciseQuestions || []).forEach(e => scenes.push({ kind: 'exercise_question', data: e }));
  (lesson.practiceProblems || []).forEach((p, i) => scenes.push({ kind: 'practice_attempt', data: p, index: i }));
  return scenes;
}

function speak(text: string) {
  if (!text) return;
  try {
    // @ts-ignore — web speech API, guarded for RN environments without it
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      // @ts-ignore
      const utterance = new window.SpeechSynthesisUtterance(text);
      // @ts-ignore
      window.speechSynthesis.cancel();
      // @ts-ignore
      window.speechSynthesis.speak(utterance);
    }
  } catch (_) { /* voice is a nice-to-have, never block on it */ }
}

export default function MathLessonScreen({ route, navigation }: any) {
  const { grade, subject, topic, curriculum = 'NCERT' } = route.params || {};
  const { colors } = useTheme();

  const [lesson, setLesson] = useState<MathLesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [attemptValue, setAttemptValue] = useState('');
  const [attemptResult, setAttemptResult] = useState<{ correct: boolean; hint?: string | null } | null>(null);

  useEffect(() => {
    const gradeNum = (String(grade).match(/\d+/) || [''])[0];
    const url = `${SERVER_URL}/math-engine/lesson?curriculum=${encodeURIComponent(curriculum)}&grade=${gradeNum}&subject=${encodeURIComponent(subject)}&code=${encodeURIComponent(topic)}`;
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(res.status === 404 ? 'not_ready' : `HTTP ${res.status}`);
        return res.json();
      })
      .then(setLesson)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [grade, subject, topic, curriculum]);

  const scenes = useMemo(() => (lesson ? buildScenes(lesson) : []), [lesson]);
  const scene = scenes[sceneIndex];

  useEffect(() => {
    setStepIndex(0);
    setAttemptValue('');
    setAttemptResult(null);
    if (!scene) return;
    if (scene.kind === 'concept') speak(scene.data.description);
    if (scene.kind === 'property') speak(scene.data.description);
    if (scene.kind === 'worked_example' || scene.kind === 'exercise_question') speak(scene.data.spokenIntro);
  }, [sceneIndex, scene]);

  const goNext = useCallback(() => setSceneIndex(i => Math.min(i + 1, scenes.length - 1)), [scenes.length]);
  const goPrev = useCallback(() => setSceneIndex(i => Math.max(i - 1, 0)), []);

  const nextStep = useCallback(() => {
    if (!scene || (scene.kind !== 'worked_example' && scene.kind !== 'exercise_question')) return;
    const total = scene.data.steps.length;
    if (stepIndex < total - 1) {
      const next = stepIndex + 1;
      setStepIndex(next);
      speak(scene.data.steps[next].spokenExplanation);
    } else {
      goNext();
    }
  }, [scene, stepIndex, goNext]);

  const submitAttempt = useCallback(async () => {
    if (!scene || scene.kind !== 'practice_attempt') return;
    try {
      const gradeNum = (String(grade).match(/\d+/) || [''])[0];
      const res = await fetch(`${SERVER_URL}/math-engine/check-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          curriculum, grade: gradeNum, subject, code: topic,
          problemIndex: scene.index, studentAnswer: attemptValue,
        }),
      });
      const data = await res.json();
      setAttemptResult(data);
    } catch (_) {
      setAttemptResult({ correct: false, hint: 'Could not check your answer right now — try again.' });
    }
  }, [scene, attemptValue, grade, subject, topic, curriculum]);

  if (loading) {
    return (
      <ScreenLayout>
        <Header title={topic} subtitle={`${subject} · ${grade}`} showBack onMenuPress={() => navigation.openDrawer?.()} />
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>
      </ScreenLayout>
    );
  }

  if (error || !lesson || scenes.length === 0) {
    return (
      <ScreenLayout>
        <Header title={topic} subtitle={`${subject} · ${grade}`} showBack onMenuPress={() => navigation.openDrawer?.()} />
        <View style={styles.centered}>
          <Feather name="tool" size={32} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            {error === 'not_ready'
              ? "This chapter's step-by-step lesson isn't ready yet — check back soon!"
              : 'Could not load this lesson right now.'}
          </Text>
        </View>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <Header title={lesson.meta.chapterTitle} subtitle={`${subject} · ${grade}`} showBack onMenuPress={() => navigation.openDrawer?.()} />
      <ScrollView contentContainerStyle={styles.content}>
        {scene.kind === 'concept' && (
          <View>
            <Text style={[styles.title, { color: colors.textMain }]}>{scene.data.title}</Text>
            <Text style={[styles.body, { color: colors.textMain }]}>{scene.data.description}</Text>
            <Text style={[styles.label, { color: colors.textMuted }]}>Learning objective</Text>
            <Text style={[styles.body, { color: colors.textMain }]}>{scene.data.learningObjective}</Text>
            {scene.data.prerequisites?.length > 0 && (
              <>
                <Text style={[styles.label, { color: colors.textMuted }]}>Before you start</Text>
                {scene.data.prerequisites.map((p, i) => (
                  <Text key={i} style={[styles.bullet, { color: colors.textMain }]}>• {p}</Text>
                ))}
              </>
            )}
          </View>
        )}

        {scene.kind === 'formula' && (
          <View>
            <Text style={[styles.label, { color: colors.textMuted }]}>Formula</Text>
            <Text style={[styles.title, { color: colors.textMain }]}>{scene.data.name}</Text>
            <Text style={[styles.equation, { color: colors.primary }]}>{scene.data.expression}</Text>
            <Text style={[styles.body, { color: colors.textMain }]}>{scene.data.description}</Text>
          </View>
        )}

        {scene.kind === 'property' && (
          <View>
            <Text style={[styles.title, { color: colors.textMain }]}>{scene.data.title}</Text>
            <Text style={[styles.body, { color: colors.textMain }]}>{scene.data.description}</Text>
          </View>
        )}

        {(scene.kind === 'worked_example' || scene.kind === 'exercise_question') && (
          <View>
            <Text style={[styles.label, { color: colors.textMuted }]}>
              {scene.kind === 'worked_example' ? 'Worked example' : 'Guided solution'}
            </Text>
            <Text style={[styles.body, { color: colors.textMain }]}>{scene.data.problem}</Text>
            {scene.data.steps.slice(0, stepIndex + 1).map((step, i) => (
              <View key={i} style={[styles.stepCard, { borderColor: colors.borderColor }]}>
                <Text style={[styles.stepLabel, { color: colors.textMuted }]}>Step {i + 1}</Text>
                {!!step.visual && <Text style={[styles.equation, { color: colors.primary }]}>{step.visual}</Text>}
                <Text style={[styles.body, { color: colors.textMain }]}>{step.stepText}</Text>
              </View>
            ))}
            {'commonMistake' in scene.data && scene.data.commonMistake && stepIndex === scene.data.steps.length - 1 && (
              <Text style={[styles.mistakeNote, { color: colors.textMuted }]}>⚠ Common mistake: {scene.data.commonMistake}</Text>
            )}
          </View>
        )}

        {scene.kind === 'practice_attempt' && (
          <View>
            <Text style={[styles.label, { color: colors.textMuted }]}>Try it yourself</Text>
            <Text style={[styles.body, { color: colors.textMain }]}>{scene.data.problem}</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.borderColor, color: colors.textMain }]}
              value={attemptValue}
              onChangeText={setAttemptValue}
              placeholder="Your answer"
              placeholderTextColor={colors.textMuted}
            />
            <TouchableOpacity style={[styles.checkButton, { backgroundColor: colors.primary }]} onPress={submitAttempt}>
              <Text style={styles.checkButtonText}>Check my answer</Text>
            </TouchableOpacity>
            {attemptResult && (
              <Text style={[styles.body, { color: attemptResult.correct ? '#2E7D32' : '#C62828' }]}>
                {attemptResult.correct ? 'Correct! Well done.' : `Not quite — ${attemptResult.hint || 'try again'}`}
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity onPress={goPrev} disabled={sceneIndex === 0} style={styles.navButton}>
          <Feather name="arrow-left" size={20} color={sceneIndex === 0 ? colors.textMuted : colors.textMain} />
        </TouchableOpacity>
        <Text style={[styles.progress, { color: colors.textMuted }]}>{sceneIndex + 1} / {scenes.length}</Text>
        {(scene.kind === 'worked_example' || scene.kind === 'exercise_question') ? (
          <TouchableOpacity onPress={nextStep} style={styles.navButton}>
            <Feather name="arrow-right" size={20} color={colors.textMain} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={goNext} disabled={sceneIndex === scenes.length - 1} style={styles.navButton}>
            <Feather name="arrow-right" size={20} color={sceneIndex === scenes.length - 1 ? colors.textMuted : colors.textMain} />
          </TouchableOpacity>
        )}
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm },
  emptyText: { fontSize: 15, textAlign: 'center' },
  content: { padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: 22, fontWeight: '700', marginBottom: spacing.sm },
  label: { fontSize: 12, fontWeight: '600', marginTop: spacing.md, marginBottom: spacing.xs, textTransform: 'uppercase' },
  body: { fontSize: 15, lineHeight: 22 },
  bullet: { fontSize: 15, marginLeft: spacing.sm },
  equation: { fontSize: 18, fontFamily: 'monospace', marginVertical: spacing.xs },
  stepCard: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  stepLabel: { fontSize: 12, fontWeight: '600', marginBottom: spacing.xs },
  mistakeNote: { fontSize: 12, marginTop: spacing.md, fontStyle: 'italic' },
  input: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm, fontSize: 15 },
  checkButton: { borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  checkButtonText: { color: '#fff', fontWeight: '600' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  navButton: { padding: spacing.sm },
  progress: { fontSize: 12 },
});
