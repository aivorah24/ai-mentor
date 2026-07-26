/**
 * Module 12 — finalAuditAgent
 * Emits the final PASS/FAIL audit report per topic: curriculum alignment,
 * concept accuracy, lesson completeness, UI completeness, audio/illustration/
 * quiz quality, accessibility, overall score. Deterministic scoring over the
 * finished lesson so the report is reproducible.
 */
function scoreLesson({ lesson, strategy, validation }) {
  const dims = {};
  const bodyChars = (lesson.simplifiedExplanation || []).join(' ').length;

  dims.curriculumAlignment = lesson.learningOutcomeMapping ? 100 : 60;
  dims.conceptAccuracy = validation && validation.score ? validation.score : (validation && validation.ok ? 85 : 50);
  dims.lessonCompleteness = Math.min(100,
    ((lesson.whatYoullLearn || []).length ? 20 : 0) +
    (bodyChars >= 200 ? 25 : 10) +
    ((lesson.vocabulary || []).length ? 15 : 0) +
    ((lesson.keyTakeaways || []).length ? 15 : 0) +
    ((lesson.thinkAndReflect || []).length ? 10 : 0) +
    ((lesson.interactiveActivities || []).length ? 15 : 0));
  dims.uiCompleteness = lesson.uiLayout && lesson.uiLayout.component_order.length ? 100 : 40;
  dims.quizQuality = (lesson.quiz || []).length >= 4 ? 100 : (lesson.quiz || []).length >= 3 ? 75 : 40;
  // Maths: audio intentionally absent — score full so it doesn't drag the audit.
  dims.audioQuality = strategy.audio === false ? 100 : (lesson.audioNarrationScript ? 100 : 40);
  dims.illustrationQuality = (lesson.figureUrl ? 60 : 0) + ((lesson.illustrationPrompts || []).length ? 40 : 0);
  dims.accessibility = ((lesson.illustrationPrompts || []).some((p) => p.altText) ? 50 : 20) + (lesson.estReadingTime ? 25 : 0) + ((lesson.vocabulary || []).length ? 25 : 0);

  const overall = Math.round(Object.values(dims).reduce((a, b) => a + b, 0) / Object.keys(dims).length);
  const pass = validation.ok && overall >= 70;
  return { dimensions: dims, overall, pass };
}

function audit({ lesson, strategy, validation }) {
  const { dimensions, overall, pass } = scoreLesson({ lesson, strategy, validation });
  return {
    topic: lesson.title,
    subject: lesson.subject,
    grade: lesson.grade,
    instructionalType: lesson.instructionalType,
    layout_type: lesson.layout_type,
    result: pass ? 'PASS' : 'FAIL',
    overallScore: overall,
    dimensions,
    outstandingDefects: validation.defects || [],        // blocking
    advisoryNotes: validation.advisory || [],            // teacher nitpicks, non-blocking
    reviewScore: validation.score,
    audioApplicable: strategy.audio !== false,
    hasRealFigure: !!lesson.figureUrl,
    quizCount: (lesson.quiz || []).length,
  };
}

module.exports = { audit, scoreLesson };
