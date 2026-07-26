/**
 * Module 3 — teachingStrategyAgent
 * Picks a SUBJECT-APPROPRIATE teaching template based on the instructional type
 * inferred by the understanding agent. NEVER one generic layout for everything.
 * This is deterministic (a lookup) so it is fast, testable, and predictable; it
 * returns the section blueprint + the persisted layout_type the uiAgent/frontend
 * use to drive dynamic rendering.
 */

// Each strategy declares: which lesson sections matter, whether audio applies,
// how illustrations are placed, and a frontend layout_type token.
const STRATEGIES = {
  Poem: {
    layoutType: 'poem',
    audio: true,
    illustration: 'per-stanza',
    sections: ['fullPoem', 'stanzaIllustration', 'narration', 'wordMeanings', 'rhythmAndRhyme', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Present the FULL poem verbatim, illustrate each stanza, add gentle narration, word meanings, note the rhythm/rhyme, then Think & Reflect and Key Takeaways.',
  },
  Story: {
    layoutType: 'story',
    audio: true,
    illustration: 'scene-by-scene',
    sections: ['characters', 'storyFlow', 'moral', 'vocabulary', 'comprehension', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Introduce characters, retell the story flow scene by scene, draw out the moral, add vocabulary and comprehension questions.',
  },
  Mathematics: {
    layoutType: 'math',
    audio: false, // founder directive: NO audio for Maths
    illustration: 'visual-manipulative',
    sections: ['visualIntro', 'stepByStep', 'workedExamples', 'formula', 'keyIdeas', 'hints', 'commonMistakes', 'challenge', 'keyTakeaways', 'quiz'],
    guidance: 'Show a visual intro, step-by-step worked procedure (equation -> solve line by line), the formula(s)/rule used, key ideas, hints, common mistakes, and a challenge. NO audio narration.',
  },
  'Problem Solving': {
    layoutType: 'math',
    audio: false,
    illustration: 'visual-manipulative',
    sections: ['visualIntro', 'stepByStep', 'workedExamples', 'keyIdeas', 'hints', 'commonMistakes', 'challenge', 'keyTakeaways', 'quiz'],
    guidance: 'Model the problem-solving procedure step by step with worked examples, hints and common mistakes. NO audio.',
  },
  'Concept Explanation': {
    layoutType: 'science',
    audio: true,
    illustration: 'concept-diagram',
    sections: ['conceptCards', 'diagrams', 'simplifiedExplanation', 'realLifeExamples', 'vocabulary', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Break the concept into concept cards, add diagrams, a simplified explanation, real-life examples, vocabulary.',
  },
  Experiment: {
    layoutType: 'science',
    audio: true,
    illustration: 'concept-diagram',
    sections: ['conceptCards', 'observations', 'experimentSteps', 'realLifeExamples', 'vocabulary', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Explain the concept, list observations and experiment steps, connect to real life.',
  },
  Observation: {
    layoutType: 'science',
    audio: true,
    illustration: 'concept-diagram',
    sections: ['conceptCards', 'observations', 'realLifeExamples', 'vocabulary', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Guide the learner to observe, record observations, connect to real life.',
  },
  Activity: {
    layoutType: 'activity',
    audio: true,
    illustration: 'concept-diagram',
    sections: ['simplifiedExplanation', 'observations', 'interactiveActivities', 'realLifeExamples', 'vocabulary', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Explain simply, then drive hands-on interactive activities and observations rooted in daily life.',
  },
  Grammar: {
    layoutType: 'grammar',
    audio: true,
    illustration: 'concept-diagram',
    sections: ['rule', 'examples', 'practice', 'sentenceBuilder', 'vocabulary', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'State the rule, give examples, provide practice and a sentence builder.',
  },
  Vocabulary: {
    layoutType: 'grammar',
    audio: true,
    illustration: 'concept-diagram',
    sections: ['vocabulary', 'examples', 'practice', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Teach the words with meanings, examples and practice.',
  },
  'Reading Passage': {
    layoutType: 'story',
    audio: true,
    illustration: 'scene-by-scene',
    sections: ['readingPassage', 'vocabulary', 'comprehension', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Present the passage, add vocabulary and comprehension questions.',
  },
  Conversation: {
    layoutType: 'story',
    audio: true,
    illustration: 'scene-by-scene',
    sections: ['dialogue', 'vocabulary', 'practice', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Present the conversation, teach phrases, practice speaking.',
  },
  Writing: {
    layoutType: 'grammar',
    audio: true,
    illustration: 'concept-diagram',
    sections: ['modelText', 'steps', 'practice', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Show a model, break writing into steps, then practice.',
  },
  Map: {
    layoutType: 'social',
    audio: true,
    illustration: 'map',
    sections: ['maps', 'keyPlaces', 'causeAndEffect', 'discussion', 'vocabulary', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Use maps, identify key places, discuss cause & effect.',
  },
  Timeline: {
    layoutType: 'social',
    audio: true,
    illustration: 'timeline',
    sections: ['timeline', 'events', 'causeAndEffect', 'discussion', 'vocabulary', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Lay out the timeline of events and their cause & effect.',
  },
  'Case Study': {
    layoutType: 'social',
    audio: true,
    illustration: 'concept-diagram',
    sections: ['caseStudy', 'events', 'causeAndEffect', 'discussion', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Present the case, examine events, cause & effect, discuss.',
  },
  Project: {
    layoutType: 'activity',
    audio: true,
    illustration: 'concept-diagram',
    sections: ['simplifiedExplanation', 'projectSteps', 'interactiveActivities', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Explain the goal, break the project into steps, drive activities.',
  },
  Diagram: {
    layoutType: 'science',
    audio: true,
    illustration: 'concept-diagram',
    sections: ['conceptCards', 'diagrams', 'simplifiedExplanation', 'vocabulary', 'thinkAndReflect', 'keyTakeaways', 'quiz'],
    guidance: 'Center on the diagram, label parts, explain simply.',
  },
  Revision: {
    layoutType: 'science',
    audio: true,
    illustration: 'concept-diagram',
    sections: ['keyTakeaways', 'simplifiedExplanation', 'practice', 'quiz'],
    guidance: 'Recap key ideas, quick re-explanation, practice.',
  },
};

const DEFAULT_STRATEGY = STRATEGIES['Concept Explanation'];

function selectStrategy(understanding) {
  const type = understanding.instructionalType || 'Concept Explanation';
  // Maths subject always forces the no-audio math strategy even if the type
  // was inferred as something else (founder directive).
  const isMathSubject = /math/i.test(understanding.subject || '');
  let strategy = STRATEGIES[type];
  if (isMathSubject) strategy = STRATEGIES.Mathematics;
  if (!strategy) strategy = { ...DEFAULT_STRATEGY, layoutType: 'concept', _inferred: type };
  return { type, ...strategy };
}

module.exports = { selectStrategy, STRATEGIES };
