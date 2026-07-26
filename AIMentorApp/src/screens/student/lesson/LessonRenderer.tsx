// LessonRenderer — walks a canonical component list (see lessonComponents.ts)
// and renders each component. This is the frontend consumer of the Curriculum
// Intelligence pipeline's UI contract: the layout is whatever the component
// list says, so a poem renders poem-shaped and maths renders maths-shaped with
// no per-lesson code. Grade-aware sizing follows the Experience Designer's
// Grade Awareness rules (G1-2 larger + calmer, higher grades denser).
import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { spacing, radius, fonts } from '../../../theme';
import SERVER_URL from '../../../config/serverUrl';
import type { AppColors } from '../../../theme';
import type { LessonComponent } from './lessonComponents';

type Props = {
  components: LessonComponent[];
  grade?: number;
  colors: AppColors;
};

// Grade → reading scale. Younger learners get slightly larger type, but kept
// subtle so it reads as a normal lesson, not oversized.
function gradeScale(grade?: number): number {
  if (!grade || grade <= 2) return 1.04;
  if (grade <= 5) return 1.0;
  if (grade <= 8) return 0.96;
  return 0.94;
}

export default function LessonRenderer({ components, grade, colors }: Props) {
  const scale = gradeScale(grade);
  const s = makeStyles(colors, scale);
  return (
    <View style={{ gap: spacing.md }}>
      {components.map(c => (
        <View key={c.component_id}>{renderComponent(c, s, colors)}</View>
      ))}
    </View>
  );
}

function renderComponent(c: LessonComponent, s: any, colors: AppColors) {
  switch (c.type) {
    case 'TeacherCard':
      return (
        <View style={s.teacher}>
          <View style={s.teacherAvatar}><Feather name="feather" size={16} color={colors.primary} /></View>
          <Text style={s.teacherText}>{c.slots.text}</Text>
        </View>
      );

    case 'LearningGoalCard':
      return (
        <View style={[s.card, s.goal]}>
          <Text style={[s.label, { color: colors.accentGreen }]}>What you'll learn</Text>
          {(c.slots.items || []).map((it: string, i: number) => (
            <View key={i} style={s.goalRow}>
              <Feather name="check" size={14} color={colors.accentGreen} />
              <Text style={s.goalText}>{it}</Text>
            </View>
          ))}
        </View>
      );

    case 'ReadingPane':
      if (c.slots.variant === 'poem') {
        return (
          <View style={[s.card, s.poemCard]}>
            <Text style={[s.label, { color: colors.primary }]}>The Poem</Text>
            {(c.slots.lines || []).map((line: string, i: number) => (
              <Text key={i} style={s.poemLine}>{line}</Text>
            ))}
          </View>
        );
      }
      if (c.slots.variant === 'takeaways') {
        return (
          <View style={[s.card, s.takeCard]}>
            <Text style={[s.label, { color: colors.accentYellow }]}>Key Takeaways</Text>
            {(c.slots.items || []).map((it: string, i: number) => (
              <View key={i} style={s.goalRow}>
                <Feather name="star" size={13} color={colors.accentYellow} />
                <Text style={s.goalText}>{it}</Text>
              </View>
            ))}
          </View>
        );
      }
      return (
        <View style={s.prose}>
          {(c.slots.paragraphs || []).map((p: string, i: number) => (
            <Text key={i} style={s.bodyText}>{p}</Text>
          ))}
        </View>
      );

    case 'IllustrationViewer': {
      const prompts = c.slots.prompts || [];
      // Real images (reused NCERT book pictures) render full-width; entries with
      // no image fall back to a labelled placeholder box.
      const withImg = prompts.filter((p: any) => p.image || p.image_ref || p.url);
      if (withImg.length > 0) {
        return (
          <View style={{ gap: 10 }}>
            {withImg.map((ip: any, i: number) => {
              const raw = ip.image || ip.image_ref || ip.url;
              const uri = /^https?:/.test(raw) ? raw : `${SERVER_URL}${raw}`;
              return (
              <View key={i} style={s.bookFig}>
                <Image source={{ uri }} style={s.bookFigImg} resizeMode="contain" />
                {!!(ip.altText || ip.caption) && <Text style={s.illusCap}>{ip.altText || ip.caption}</Text>}
              </View>
              );
            })}
          </View>
        );
      }
      return (
        <View style={s.illusRow}>
          {prompts.slice(0, 3).map((ip: any, i: number) => (
            <View key={i} style={s.illusSlot}>
              <Feather name="image" size={20} color={colors.primary} />
              <Text style={s.illusCap} numberOfLines={3}>{ip.altText || ip.prompt || `Illustration ${i + 1}`}</Text>
            </View>
          ))}
        </View>
      );
    }

    case 'VocabularyCard':
      return (
        <View style={[s.card]}>
          <Text style={[s.label, { color: colors.primary }]}>Word Meanings</Text>
          <View style={s.vocabWrap}>
            {(c.slots.words || []).map((w: any, i: number) => (
              <View key={i} style={s.word}>
                <Text style={s.wordW}>{w.word}</Text>
                <Text style={s.wordD}>{w.definition}</Text>
              </View>
            ))}
          </View>
        </View>
      );

    case 'WorkedExamples':
      return (
        <View style={{ gap: 10 }}>
          <Text style={[s.label, { color: colors.accentGreen }]}>Worked Examples</Text>
          {(c.slots.examples || []).map((ex: any, i: number) => (
            <View key={i} style={[s.card, s.exampleCard]}>
              <Text style={s.exampleProblem}>{ex.problem}</Text>
              {(ex.steps || []).map((st: string, j: number) => (
                <View key={j} style={s.stepRow}>
                  <Text style={s.stepNum}>{j + 1}</Text>
                  <Text style={s.stepText}>{st}</Text>
                </View>
              ))}
              {ex.answer != null && (
                <Text style={s.exampleAnswer}>Answer: {ex.answer}</Text>
              )}
            </View>
          ))}
        </View>
      );

    case 'ReflectionCard':
      return (
        <View style={[s.card, s.reflectCard]}>
          <Text style={[s.label, { color: colors.primary }]}>Think &amp; Reflect</Text>
          {(c.slots.prompts || []).map((q: string, i: number) => (
            <View key={i} style={s.goalRow}>
              <Feather name="help-circle" size={13} color={colors.primary} />
              <Text style={s.goalText}>{q}</Text>
            </View>
          ))}
        </View>
      );

    case 'QuizCard': {
      const q = (c.slots.questions || [])[0];
      if (!q) return null;
      return (
        <View style={[s.card]}>
          <Text style={[s.label, { color: colors.accentGreen }]}>Practice · sample question</Text>
          <Text style={s.qText}>{q.question}</Text>
          {Array.isArray(q.options) && q.options.map((opt: string, i: number) => {
            const correct = i === q.correctIndex;
            return (
              <View key={i} style={[s.opt, correct && s.optCorrect]}>
                <Text style={[s.optKey, correct && s.optKeyCorrect]}>{String.fromCharCode(65 + i)}</Text>
                <Text style={s.optText}>{opt}</Text>
              </View>
            );
          })}
          <View style={s.grounded}>
            <Feather name="check-circle" size={12} color={colors.accentGreen} />
            <Text style={s.groundedText}>Grounded in the lesson — cites the source concept.</Text>
          </View>
        </View>
      );
    }

    default:
      return null;
  }
}

const makeStyles = (c: AppColors, scale: number) => StyleSheet.create({
  card: { backgroundColor: c.cardDark, borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.lg, padding: spacing.lg },
  label: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },

  teacher: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: c.primary + '0d',
             borderWidth: 1, borderColor: c.primary + '33', borderRadius: radius.lg, padding: spacing.lg },
  teacherAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.primary + '22', alignItems: 'center', justifyContent: 'center' },
  teacherText: { flex: 1, fontFamily: fonts.serif, fontSize: 15.5 * scale, lineHeight: 23 * scale, color: c.textMain, fontWeight: '600' },

  goal: { backgroundColor: c.accentGreen + '10', borderColor: c.accentGreen + '44' },
  goalRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 6 },
  goalText: { flex: 1, fontSize: 14 * scale, lineHeight: 21 * scale, color: c.textMain },

  poemCard: { backgroundColor: c.primary + '0a', borderColor: c.primary + '44' },
  poemLine: { fontFamily: fonts.serif, fontSize: 16.5 * scale, lineHeight: 30 * scale, color: c.textMain },

  prose: { gap: 6 },
  bodyText: { fontSize: 14 * scale, lineHeight: 22 * scale, color: c.textMuted },

  takeCard: { backgroundColor: c.accentYellow + '10', borderColor: c.accentYellow + '44' },
  reflectCard: { backgroundColor: c.primary + '0a', borderColor: c.primary + '33' },

  exampleCard: { backgroundColor: c.accentGreen + '0a', borderColor: c.accentGreen + '40', gap: 6 },
  exampleProblem: { fontSize: 15 * scale, fontWeight: '800', color: c.textMain, marginBottom: 2 },
  stepRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  stepNum: { width: 18, height: 18, borderRadius: 9, backgroundColor: c.accentGreen + '22', color: c.accentGreen,
             fontSize: 11, fontWeight: '800', textAlign: 'center', overflow: 'hidden', lineHeight: 18 },
  stepText: { flex: 1, fontSize: 13.5 * scale, lineHeight: 20 * scale, color: c.textMuted },
  exampleAnswer: { fontSize: 14 * scale, fontWeight: '800', color: c.accentGreen, marginTop: 4 },

  illusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  illusSlot: { flex: 1, minWidth: 110, aspectRatio: 1.2, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.primary + '66',
               borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8, backgroundColor: c.primary + '08' },
  illusCap: { fontSize: 10.5, lineHeight: 14, textAlign: 'center', color: c.textMuted },
  bookFig: { borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, padding: 8, backgroundColor: c.bgDark, gap: 6 },
  bookFigImg: { width: '100%', height: 460, borderRadius: radius.sm ?? 6 },

  vocabWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  word: { flexGrow: 1, flexBasis: '46%', borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, padding: 10, backgroundColor: c.bgDark },
  wordW: { fontSize: 13.5 * scale, fontWeight: '700', color: c.primary },
  wordD: { fontSize: 12.5 * scale, lineHeight: 17 * scale, color: c.textMuted, marginTop: 2 },

  qText: { fontSize: 14.5 * scale, fontWeight: '600', color: c.textMain, marginBottom: 8 },
  opt: { flexDirection: 'row', gap: 9, alignItems: 'center', borderWidth: 1, borderColor: c.borderColor, borderRadius: radius.md, padding: 9, marginTop: 6, backgroundColor: c.bgDark },
  optCorrect: { borderColor: c.accentGreen, backgroundColor: c.accentGreen + '14' },
  optKey: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: c.textDim, textAlign: 'center', fontSize: 11, color: c.textDim, overflow: 'hidden' },
  optKeyCorrect: { borderColor: c.accentGreen, backgroundColor: c.accentGreen, color: '#fff' },
  optText: { flex: 1, fontSize: 13.5 * scale, color: c.textMain },
  grounded: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  groundedText: { fontSize: 11, color: c.accentGreen },
});
