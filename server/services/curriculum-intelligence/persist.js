/**
 * persist.js — writes the finished lesson JSON into topic_resources so the app
 * renders it. Maps the rich Curriculum-Intelligence lesson onto the
 * AI_EXPLANATION static_payload shape LessonScreen already consumes (intro,
 * keyLearnings, body, activity, vocab, listenParts, mathHelper, pdfFile) AND
 * extends it with the new dynamic-UI fields (layout, quiz, illustrationPrompts,
 * whatYoullLearn, keyTakeaways, thinkAndReflect) so the frontend can drive
 * component order/visibility from layout_type. Idempotent per topic.
 */
const supabase = require('../supabase');

function toPayload(lesson) {
  const isMath = lesson.layout_type === 'math';
  const payload = {
    // Fields LessonScreen already reads:
    intro: lesson.whatYoullLearn?.[0] || lesson.learningOutcomeMapping || `Let's learn "${lesson.title}".`,
    keyLearnings: lesson.whatYoullLearn && lesson.whatYoullLearn.length ? lesson.whatYoullLearn : lesson.learningObjectives,
    body: lesson.simplifiedExplanation || [],
    activity: (lesson.interactiveActivities && lesson.interactiveActivities[0]) || (lesson.thinkAndReflect && lesson.thinkAndReflect[0]) || '',
    vocab: lesson.vocabulary || [],
    grounded: true, grade: lesson.grade, subject: lesson.subject,
    pdfFile: lesson.pdfFile || undefined, pdfPage: lesson.pdfPage || 1,
    // New dynamic-UI + audit fields (additive; frontend can pick these up):
    layout: lesson.uiLayout || undefined,
    layout_type: lesson.layout_type,
    instructionalType: lesson.instructionalType,
    whatYoullLearn: lesson.whatYoullLearn || [],
    originalLesson: lesson.originalLesson || [],
    keyTakeaways: lesson.keyTakeaways || [],
    thinkAndReflect: lesson.thinkAndReflect || [],
    quiz: lesson.quiz || [],
    illustrationPrompts: lesson.illustrationPrompts || [],
    figures: lesson.figures || [],
    figureUrl: lesson.figureUrl || undefined,
    estReadingTime: lesson.estReadingTime,
  };
  if (isMath) {
    payload.mathHelper = {
      formula: lesson.formula || '',
      keyIdeas: lesson.keyIdeas || [],
      example: (lesson.workedExamples && lesson.workedExamples[0]) || null,
      commonMistakes: lesson.commonMistakes || [],
      workedExamples: lesson.workedExamples || [],
    };
  } else {
    if (Array.isArray(lesson.listenParts)) payload.listenParts = lesson.listenParts;
    if (lesson.audioNarrationScript) payload.audioNarrationScript = lesson.audioNarrationScript;
  }
  return payload;
}

async function persistLesson({ topicId, lesson }) {
  const isMath = lesson.layout_type === 'math';
  const payload = toPayload(lesson);
  const hasFig = !!lesson.figureUrl;
  const rows = [
    { topic_id: topicId, resource_type: 'AI_EXPLANATION', status: 'READY', source_tier: 'OFFICIAL_BOOK', source: 'NCERT textbook (Curriculum Intelligence, RAG-grounded)', static_payload: payload },
    { topic_id: topicId, resource_type: 'PRACTICE', status: 'READY', source_tier: 'ORIGINAL_AI', source: 'Grounded quiz', static_payload: { grounded: true, quiz: lesson.quiz || [] } },
    { topic_id: topicId, resource_type: 'BOOK_REFERENCE', status: 'READY', source_tier: 'OFFICIAL_BOOK', source: 'NCERT textbook', static_payload: null },
    { topic_id: topicId, resource_type: 'IMAGES', status: hasFig ? 'READY' : 'NOT_AVAILABLE', source_tier: hasFig ? 'OFFICIAL_BOOK' : null, source: hasFig ? 'NCERT extracted figure' : null, static_payload: hasFig ? { items: (lesson.figures || []).map((f) => ({ description: f.caption, url: f.url })), pageRef: lesson.pdfPage || 1 } : null },
    { topic_id: topicId, resource_type: 'AUDIO', status: isMath ? 'NOT_AVAILABLE' : (lesson.audioNarrationScript ? 'READY' : 'NOT_AVAILABLE'), source_tier: isMath ? null : (lesson.audioNarrationScript ? 'OFFICIAL_BOOK' : null), source: isMath ? null : (lesson.audioNarrationScript ? 'Read-aloud of chapter text' : null), static_payload: null },
    { topic_id: topicId, resource_type: 'FLASHCARDS', status: 'NOT_AVAILABLE', source_tier: null, source: null, static_payload: null },
    { topic_id: topicId, resource_type: 'WORKSHEETS', status: 'NOT_AVAILABLE', source_tier: null, source: null, static_payload: null },
    { topic_id: topicId, resource_type: 'OER_MAPPING', status: 'NOT_AVAILABLE', source_tier: null, source: null, static_payload: null },
  ];
  await supabase.from('topic_resources').delete().eq('topic_id', topicId);
  const { error } = await supabase.from('topic_resources').insert(rows);
  if (error) throw new Error(error.message);
  return payload;
}

module.exports = { persistLesson, toPayload };
