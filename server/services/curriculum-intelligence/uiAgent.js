/**
 * Module 8 — uiAgent
 * Emits a DYNAMIC layout spec (never a hardcoded single page). The frontend
 * LessonScreen drives component order/visibility from this persisted layout_type
 * rather than a second hardcoded screen. Chosen by instructional type/strategy.
 */

// Map each layoutType to a sensible default component order + player/nav style.
// component_visibility hides sections that have no content so no empty boxes render.
function buildLayout({ lesson, strategy }) {
  const has = {
    keyLearnings: (lesson.whatYoullLearn || []).length > 0 || (lesson.learningObjectives || []).length > 0,
    body: (lesson.simplifiedExplanation || []).length > 0,
    original: (lesson.originalLesson || []).length > 0,
    illustration: !!lesson.figureUrl,
    audio: !!lesson.audioNarrationScript,
    listen: Array.isArray(lesson.listenParts) && lesson.listenParts.length > 0,
    mathHelper: strategy.layoutType === 'math',
    workedExamples: (lesson.workedExamples || []).length > 0,
    vocab: (lesson.vocabulary || []).length > 0,
    activity: (lesson.interactiveActivities || []).length > 0,
    reflect: (lesson.thinkAndReflect || []).length > 0,
    takeaways: (lesson.keyTakeaways || []).length > 0,
    quiz: (lesson.quiz || []).length > 0,
  };

  const orderByLayout = {
    poem: ['keyLearnings', 'original', 'illustration', 'listen', 'vocab', 'reflect', 'takeaways', 'quiz'],
    story: ['keyLearnings', 'original', 'illustration', 'listen', 'vocab', 'reflect', 'takeaways', 'quiz'],
    math: ['keyLearnings', 'body', 'illustration', 'mathHelper', 'workedExamples', 'vocab', 'activity', 'takeaways', 'quiz'],
    science: ['keyLearnings', 'body', 'illustration', 'listen', 'vocab', 'activity', 'reflect', 'takeaways', 'quiz'],
    grammar: ['keyLearnings', 'body', 'vocab', 'activity', 'listen', 'reflect', 'takeaways', 'quiz'],
    social: ['keyLearnings', 'body', 'illustration', 'listen', 'vocab', 'reflect', 'takeaways', 'quiz'],
    activity: ['keyLearnings', 'body', 'illustration', 'activity', 'listen', 'vocab', 'reflect', 'takeaways', 'quiz'],
    concept: ['keyLearnings', 'body', 'illustration', 'listen', 'vocab', 'activity', 'reflect', 'takeaways', 'quiz'],
  };
  const order = (orderByLayout[strategy.layoutType] || orderByLayout.concept).filter((c) => has[c]);

  const layout = {
    layout_type: strategy.layoutType,
    component_order: order,
    component_visibility: has,
    illustration_position: strategy.illustration === 'per-stanza' ? 'inline-per-section'
      : strategy.layoutType === 'math' ? 'top' : 'right-pane',
    audio_player_style: strategy.audio === false ? 'none' : 'sentence-highlight',
    navigation_style: strategy.layoutType === 'math' ? 'stepper' : 'scroll',
    interaction_style: strategy.layoutType === 'math' ? 'guided-steps'
      : (strategy.type === 'Poem' || strategy.type === 'Story') ? 'read-and-listen' : 'read-explore',
  };
  lesson.uiLayout = layout;
  return layout;
}

module.exports = { buildLayout };
