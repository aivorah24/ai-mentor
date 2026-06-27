import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, TextInput, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface MathResult {
  problem:       string;
  hint:          string;
  steps:         string[];
  answer:        string;
  encouragement: string;
  tryThis:       string;
}

type Phase = 'attempt' | 'wrong' | 'correct';

// Aivorah pastel accents per subject
const SUBJECT_ACCENT: Record<string, string> = {
  Mathematics: '#BAA467',
  Science: '#BAA467',
  English: '#BAA467',
  'Social Studies': '#BAA467',
  Arts: '#BAA467',
  'Physical Education': '#BAA467',
  ICT: '#BAA467',
};

export default function MathHelperScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const { topic, chapterId, unit, subject = 'Mathematics', grade = 'Grade 3', curriculum = 'IB PYP' } = route.params ?? {};
  const accent = SUBJECT_ACCENT[subject] || '#BAA467';

  const [loading,       setLoading]       = useState(false);
  const [result,        setResult]        = useState<MathResult | null>(null);
  const [customInput,   setCustomInput]   = useState('');
  const [phase,         setPhase]         = useState<Phase>('attempt');
  const [studentAnswer, setStudentAnswer] = useState('');
  const [checking,      setChecking]      = useState(false);
  const [nudge,         setNudge]         = useState('');
  const [showSteps,     setShowSteps]     = useState(false);
  const [ttsLoading,    setTtsLoading]    = useState(false);
  const [error,         setError]         = useState('');
  const seenProblems = useRef<string[]>([]);
  const ttsAudio     = useRef<any>(null);

  // Stop audio when navigating away (drawer keeps screen mounted)
  useEffect(() => {
    const unsubBlur = navigation.addListener('blur', () => {
      if (ttsAudio.current) {
        try { ttsAudio.current.pause(); ttsAudio.current.src = ''; } catch {}
        ttsAudio.current = null;
      }
      if (Platform.OS === 'web' && (window as any).speechSynthesis) {
        try { (window as any).speechSynthesis.cancel(); } catch {}
      }
      setTtsLoading(false);
    });
    return () => {
      unsubBlur();
      if (ttsAudio.current) {
        try { ttsAudio.current.pause(); ttsAudio.current.src = ''; } catch {}
      }
    };
  }, [navigation]);

  const fetchProblem = useCallback(async (customProblem?: string) => {
    setLoading(true);
    setResult(null);
    setPhase('attempt');
    setStudentAnswer('');
    setNudge('');
    setShowSteps(false);
    setError('');
    try {
      const res = await fetch(`${SERVER_URL}/modules/math-helper`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          topic, unit, subject, grade, curriculum,
          problem:          customProblem || undefined,
          previousProblems: seenProblems.current.slice(-5),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      // Track seen problems to avoid repetition
      if (data.problem) {
        seenProblems.current = [...seenProblems.current, data.problem].slice(-10);
      }
      playTTS(data.problem);
    } catch {
      setError('Could not load problem. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [topic, unit]);

  useEffect(() => { fetchProblem(); }, [fetchProblem]);

  const playTTS = async (text: string) => {
    if (Platform.OS !== 'web') return;
    // Stop any currently playing audio first
    if (ttsAudio.current) {
      try { ttsAudio.current.pause(); ttsAudio.current.src = ''; } catch {}
      ttsAudio.current = null;
    }
    setTtsLoading(true);
    try {
      const res  = await fetch(`${SERVER_URL}/lesson/tts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.audioUrl) {
        const audio = new (window as any).Audio(`${SERVER_URL}${data.audioUrl}`);
        ttsAudio.current = audio;
        audio.onended = () => { ttsAudio.current = null; setTtsLoading(false); };
        audio.onerror = () => { ttsAudio.current = null; setTtsLoading(false); };
        audio.play();
        return;
      }
    } catch (_) {}
    setTtsLoading(false);
  };

  const checkAnswer = async () => {
    if (!result || !studentAnswer.trim()) return;
    setChecking(true);
    setNudge('');
    try {
      const res = await fetch(`${SERVER_URL}/modules/math-helper/check`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem:       result.problem,
          correctAnswer: result.answer,
          studentAnswer: studentAnswer.trim(),
          topic, unit, subject, grade, curriculum,
        }),
      });
      const data = await res.json();
      if (data.isCorrect) {
        setPhase('correct');
        playTTS(data.praise ?? result.encouragement);
      } else {
        setPhase('wrong');
        setNudge(data.nudge ?? '');
        playTTS(data.nudge ?? 'Check your calculation again. Try again!');
      }
    } catch {
      setPhase('wrong');
      setNudge('Check your calculation again. Try again — you can do it!');
    } finally {
      setChecking(false);
    }
  };

  const s = makeStyles(colors);

  return (
    <ScreenLayout>
      <View style={[s.screen, { backgroundColor: colors.bgDark }]}>
        <Header
          title="Math Helper"
          subtitle={`${curriculum} · ${grade} · ${topic}`}
          showBack={true}
          onMenuPress={() => navigation.openDrawer()}
        />

        {/* Back to Subject Topics */}
        <TouchableOpacity
          style={s.backRow}
          onPress={() => navigation.navigate('SubjectTopics', { subject, grade, curriculum })}
        >
          <Feather name="arrow-left" size={16} color={accent} />
          <Text style={[s.backText, { color: accent }]}>Back to {subject} Topics</Text>
        </TouchableOpacity>

        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* Label row */}
          <View style={s.row}>
            <View style={[s.badge, { backgroundColor: accent + '22' }]}>
              <Feather name="hash" size={13} color={accent} />
              <Text style={[s.badgeText, { color: accent }]}>Math Helper</Text>
            </View>
            <Text style={[s.chapterLabel, { color: colors.textMuted }]}>{topic}</Text>
          </View>

          {/* Custom problem input */}
          <View style={[s.inputRow, { borderColor: colors.borderColor, backgroundColor: colors.cardDark }]}>
            <TextInput
              style={[s.input, { color: colors.textMain }]}
              placeholder="Type your own problem... or leave empty for one!"
              placeholderTextColor={colors.textMuted}
              value={customInput}
              onChangeText={setCustomInput}
              returnKeyType="go"
              onSubmitEditing={() => { fetchProblem(customInput.trim() || undefined); setCustomInput(''); }}
            />
            <TouchableOpacity
              style={[s.askBtn, { backgroundColor: accent }]}
              onPress={() => { fetchProblem(customInput.trim() || undefined); setCustomInput(''); }}
            >
              <Feather name="arrow-right" size={16} color="#fff" />
            </TouchableOpacity>
          </View>

          {loading && (
            <View style={s.center}>
              <ActivityIndicator size="large" color={accent} />
              <Text style={[s.hintText, { color: colors.textMuted, marginTop: 12 }]}>
                Ms. Zara is preparing a problem…
              </Text>
            </View>
          )}

          {error ? (
            <View style={s.center}>
              <Feather name="alert-circle" size={32} color={colors.accentRed} />
              <Text style={[s.hintText, { color: colors.textMuted, marginTop: 8 }]}>{error}</Text>
              <TouchableOpacity style={[s.btn, { backgroundColor: accent, marginTop: 16 }]} onPress={() => fetchProblem()}>
                <Text style={s.btnText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {result && !loading && (
            <>
              {/* ── Problem card ─────────────────────────────────────────── */}
              <View style={[s.card, { backgroundColor: colors.cardDark, borderColor: accent + '50' }]}>
                <View style={s.cardHeader}>
                  <Feather name="help-circle" size={18} color={accent} />
                  <Text style={[s.cardTitle, { color: accent }]}>Problem</Text>
                  <TouchableOpacity style={s.speakBtn} onPress={() => playTTS(result.problem)} disabled={ttsLoading}>
                    {ttsLoading
                      ? <ActivityIndicator size="small" color={colors.textMuted} />
                      : <Feather name="volume-2" size={16} color={colors.textMuted} />
                    }
                  </TouchableOpacity>
                </View>
                <Text style={[s.problemText, { color: colors.textMain }]}>{result.problem}</Text>

                {/* Hint — only shown after wrong attempt */}
                {(phase === 'wrong' && result.hint) ? (
                  <View style={[s.hintBox, { backgroundColor: accent + '15' }]}>
                    <Feather name="info" size={13} color={accent} />
                    <Text style={[s.hintText, { color: accent }]}>{result.hint}</Text>
                  </View>
                ) : null}
              </View>

              {/* ── Student answer input (attempt phase) ─────────────────── */}
              {phase !== 'correct' && (
                <View style={[s.card, { backgroundColor: colors.cardDark, borderColor: colors.borderColor }]}>
                  <View style={s.cardHeader}>
                    <Feather name="edit-2" size={16} color={accent} />
                    <Text style={[s.cardTitle, { color: accent }]}>Your Answer</Text>
                  </View>
                  <View style={[s.answerInputRow, { borderColor: phase === 'wrong' ? colors.accentRed + '60' : colors.borderColor }]}>
                    <TextInput
                      style={[s.answerInput, { color: colors.textMain }]}
                      placeholder="Type your answer here…"
                      placeholderTextColor={colors.textMuted}
                      value={studentAnswer}
                      onChangeText={v => { setStudentAnswer(v); if (phase === 'wrong') setPhase('attempt'); }}
                      returnKeyType="done"
                      onSubmitEditing={checkAnswer}
                      keyboardType="default"
                    />
                  </View>

                  {/* Wrong nudge */}
                  {phase === 'wrong' && nudge ? (
                    <View style={[s.nudgeBox, { backgroundColor: colors.accentRed + '12', borderColor: colors.accentRed + '30' }]}>
                      <Feather name="alert-circle" size={14} color={colors.accentRed} />
                      <Text style={[s.nudgeText, { color: colors.accentRed }]}>{nudge}</Text>
                    </View>
                  ) : null}

                  <View style={s.row}>
                    <TouchableOpacity
                      style={[s.checkBtn, { backgroundColor: checking ? colors.cardDark : accent,
                        borderWidth: checking ? 1 : 0, borderColor: accent, flex: 1 }]}
                      onPress={checkAnswer}
                      disabled={checking || !studentAnswer.trim()}
                    >
                      {checking
                        ? <ActivityIndicator size="small" color={accent} />
                        : <Feather name="check" size={16} color="#fff" />
                      }
                      <Text style={[s.btnText, { color: checking ? accent : '#fff' }]}>
                        {checking ? 'Checking…' : 'Check My Answer'}
                      </Text>
                    </TouchableOpacity>

                    {/* Show steps after a wrong attempt */}
                    {phase === 'wrong' && (
                      <TouchableOpacity
                        style={[s.checkBtn, { backgroundColor: '#4A9E70', flex: 1 }]}
                        onPress={() => setShowSteps(v => !v)}
                      >
                        <Feather name={showSteps ? 'eye-off' : 'eye'} size={14} color="#fff" />
                        <Text style={s.btnText}>{showSteps ? 'Hide Steps' : 'Show Steps'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}

              {/* ── Correct answer celebration ───────────────────────────── */}
              {phase === 'correct' && (
                <View style={[s.card, { backgroundColor: '#4A9E70' + '15', borderColor: '#4A9E70' + '40' }]}>
                  <View style={s.cardHeader}>
                    <Feather name="check-circle" size={20} color="#10b981" />
                    <Text style={[s.cardTitle, { color: '#4A9E70', fontSize: 16 }]}>Correct!</Text>
                  </View>
                  <View style={[s.answerBox, { backgroundColor: '#4A9E70' + '20' }]}>
                    <Feather name="check-circle" size={16} color="#10b981" />
                    <Text style={[s.answerText, { color: '#4A9E70' }]}>{result.answer}</Text>
                  </View>
                  <Text style={[s.encourageText, { color: colors.textMain }]}>{result.encouragement}</Text>
                  <TouchableOpacity
                    style={[s.checkBtn, { backgroundColor: accent }]}
                    onPress={() => setShowSteps(v => !v)}
                  >
                    <Feather name={showSteps ? 'eye-off' : 'list'} size={14} color="#fff" />
                    <Text style={s.btnText}>{showSteps ? 'Hide Working' : 'See Full Working'}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Step-by-step working ─────────────────────────────────── */}
              {showSteps && (
                <View style={[s.card, { backgroundColor: colors.cardDark, borderColor: '#4A9E70' + '40' }]}>
                  <View style={s.cardHeader}>
                    <Feather name="list" size={18} color="#10b981" />
                    <Text style={[s.cardTitle, { color: '#4A9E70' }]}>Step by Step</Text>
                    <TouchableOpacity style={s.speakBtn} onPress={() => playTTS(result.steps.join('. ') + '. ' + result.answer)}>
                      <Feather name="volume-2" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                  {result.steps.map((step, i) => (
                    <View key={i} style={s.stepRow}>
                      <View style={[s.stepNum, { backgroundColor: accent }]}>
                        <Text style={s.stepNumText}>{i + 1}</Text>
                      </View>
                      <Text style={[s.stepText, { color: colors.textMain }]}>
                        {step.replace(/^Step \d+:\s*/i, '')}
                      </Text>
                    </View>
                  ))}
                  <View style={[s.answerBox, { backgroundColor: '#4A9E70' + '15' }]}>
                    <Feather name="check-circle" size={16} color="#10b981" />
                    <Text style={[s.answerText, { color: '#4A9E70' }]}>{result.answer}</Text>
                  </View>
                </View>
              )}

              {/* ── Now You Try ──────────────────────────────────────────── */}
              {(phase === 'correct' || showSteps) && (
                <View style={[s.card, { backgroundColor: colors.cardDark, borderColor: accent + '40' }]}>
                  <View style={s.cardHeader}>
                    <Feather name="zap" size={16} color={accent} />
                    <Text style={[s.cardTitle, { color: accent }]}>Now You Try!</Text>
                  </View>
                  <Text style={[s.problemText, { color: colors.textMain }]}>{result.tryThis}</Text>
                  <TouchableOpacity
                    style={[s.checkBtn, { backgroundColor: accent }]}
                    onPress={() => {
                      const tryProblem = result.tryThis.replace(/^Now try:?\s*/i, '').trim();
                      fetchProblem(tryProblem);
                    }}
                  >
                    <Feather name="arrow-right" size={14} color="#fff" />
                    <Text style={s.btnText}>Try This Problem</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* ── Action buttons ───────────────────────────────────────── */}
              <View style={s.row}>
                <TouchableOpacity
                  style={[s.btn, { backgroundColor: accent, flex: 1 }]}
                  onPress={() => fetchProblem()}
                >
                  <Feather name="refresh-cw" size={14} color="#fff" />
                  <Text style={s.btnText}>New Problem</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.btn, { backgroundColor: colors.cardDark, borderWidth: 1, borderColor: accent + '50', flex: 1 }]}
                  onPress={() => navigation.navigate('SubjectTopics', { subject, grade, curriculum })}
                >
                  <Feather name="arrow-left" size={14} color={accent} />
                  <Text style={[s.btnText, { color: accent }]}>Back to Topics</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    screen:         { flex: 1 },
    backRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.xl, paddingTop: 12, paddingBottom: 4 },
    backText:       { fontSize: 13, fontWeight: '700' },
    content:        { padding: spacing.xl, paddingBottom: 48, gap: spacing.md },
    center:         { alignItems: 'center', paddingVertical: 40 },
    row:            { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    badge:          { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    badgeText:      { fontSize: 12, fontWeight: '700' },
    chapterLabel:   { fontSize: 12 },
    inputRow:       { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
    input:          { flex: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
    askBtn:         { padding: 14 },
    card:           { borderRadius: radius.lg, borderWidth: 1, padding: 16, gap: 10 },
    cardHeader:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
    cardTitle:      { fontSize: 14, fontWeight: '700', flex: 1 },
    speakBtn:       { padding: 4 },
    problemText:    { fontSize: 15, lineHeight: 22, fontWeight: '500' },
    hintBox:        { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 10, borderRadius: 10 },
    hintText:       { fontSize: 13, lineHeight: 18, flex: 1, fontStyle: 'italic' },
    answerInputRow: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 2 },
    answerInput:    { fontSize: 16, paddingVertical: 10, fontWeight: '600' },
    nudgeBox:       { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
    nudgeText:      { fontSize: 13, lineHeight: 18, flex: 1 },
    checkBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 11, borderRadius: radius.md },
    stepRow:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    stepNum:        { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    stepNumText:    { color: '#fff', fontSize: 11, fontWeight: '700' },
    stepText:       { fontSize: 14, lineHeight: 20, flex: 1 },
    answerBox:      { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10 },
    answerText:     { fontSize: 15, fontWeight: '700' },
    encourageText:  { fontSize: 14, lineHeight: 20 },
    btn:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md },
    btnText:        { color: '#fff', fontWeight: '700', fontSize: 13 },
  });
}
