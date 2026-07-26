// ─────────────────────────────────────────────────────────────────────────
// Canonical lesson-component model + type-driven adapter.
//
// This is the frontend half of the Aivorah Curriculum Intelligence contract
// (see .claude/agents/shared/ui-components.md + contracts.md). The pipeline's
// UI Planner emits `screens[].components[]` from a fixed canonical library and
// the Lesson Generator fills each component's `slots`. The LessonRenderer walks
// that list and renders each component by `type`.
//
// Until every topic carries a true ReleasePackage, `buildLessonComponents()`
// adapts the flat topic_resources payload we already store into the SAME
// canonical component list — keyed on the lesson's instructional type — so the
// UI is genuinely type-adaptive today and swaps to real ReleasePackages later
// with no renderer changes.
// ─────────────────────────────────────────────────────────────────────────

// Canonical component types (subset of ui-components.md we render today).
export type LessonComponentType =
  | 'TeacherCard'        // Aivorah introducing / framing the lesson
  | 'LearningGoalCard'   // "What you'll learn"
  | 'ReadingPane'        // core reading — variant switches poem / prose / takeaways
  | 'IllustrationViewer' // concept art / stanza illustrations
  | 'VocabularyCard'     // word meanings
  | 'ReflectionCard'     // Think & Reflect
  | 'WorkedExamples'     // math worked examples (problem → steps → answer)
  | 'QuizCard';          // sample assessment

export type ReadingVariant = 'poem' | 'prose' | 'takeaways';

export type LessonComponent = {
  component_id: string;
  type: LessonComponentType;
  slots: Record<string, any>;
};

// The instructional types the Curriculum Understanding agent classifies into
// (contracts.md: Story | Poem | Concept | Experiment | Case Study, plus Math).
export type LessonType =
  | 'Poem' | 'Story' | 'Concept' | 'Mathematics' | 'Experiment' | 'Science'
  | 'Case Study' | 'Activity' | 'Generic';

export function normalizeLessonType(raw?: string, subject?: string): LessonType {
  const t = (raw || '').toLowerCase();
  if (t.includes('poem')) return 'Poem';
  if (t.includes('story')) return 'Story';
  if (t.includes('experiment') || t.includes('observation')) return 'Experiment';
  if (t.includes('case')) return 'Case Study';
  if (t.includes('math')) return 'Mathematics';
  if (t.includes('concept')) return 'Concept';
  const s = (subject || '').toLowerCase();
  if (s.includes('math')) return 'Mathematics';
  if (s.includes('science')) return 'Science';
  return 'Generic';
}

// A flat topic payload (what topic_resources.AI_EXPLANATION currently stores).
type FlatPayload = {
  intro?: string;
  keyLearnings?: string[];
  whatYoullLearn?: string[];
  originalLesson?: string[];
  body?: string[];
  illustrationPrompts?: { prompt?: string; altText?: string }[];
  vocab?: { word: string; definition: string }[];
  thinkAndReflect?: string[];
  keyTakeaways?: string[];
  quiz?: any[];
  instructionalType?: string;
  subject?: string;
};

const nonEmpty = (a?: any[]) => Array.isArray(a) && a.length > 0;
let _id = 0;
const cid = (t: string) => `${t}_${++_id}`;

/**
 * Map a flat lesson payload into the ordered canonical component list for its
 * instructional type. This mirrors the Learning Experience Designer's Subject
 * Experience Matrix (Poem → Read/Illustrate/WordHelp/Reflect/Takeaways/Quiz,
 * Story → …, Math → …) so the layout is type-appropriate, not one-size-fits-all.
 */
export function buildLessonComponents(payload: FlatPayload): {
  lessonType: LessonType;
  components: LessonComponent[];
} {
  _id = 0;
  const p = payload || {};
  const lessonType = normalizeLessonType(p.instructionalType, p.subject);
  const learnings = nonEmpty(p.keyLearnings) ? p.keyLearnings! : (p.whatYoullLearn || []);
  const out: LessonComponent[] = [];

  const add = (type: LessonComponentType, slots: Record<string, any>) =>
    out.push({ component_id: cid(type), type, slots });

  // Shared opener: Aivorah frames the lesson, then the goal.
  if (p.intro) add('TeacherCard', { text: p.intro });
  if (nonEmpty(learnings)) add('LearningGoalCard', { items: learnings });

  const illustration = () => {
    if (nonEmpty(p.illustrationPrompts)) add('IllustrationViewer', { prompts: p.illustrationPrompts });
  };
  const vocab = () => { if (nonEmpty(p.vocab)) add('VocabularyCard', { words: p.vocab }); };
  const reflect = () => { if (nonEmpty(p.thinkAndReflect)) add('ReflectionCard', { prompts: p.thinkAndReflect }); };
  const takeaways = () => { if (nonEmpty(p.keyTakeaways)) add('ReadingPane', { variant: 'takeaways', items: p.keyTakeaways }); };
  const prose = () => { if (nonEmpty(p.body)) add('ReadingPane', { variant: 'prose', paragraphs: p.body }); };
  const poem = () => { if (nonEmpty(p.originalLesson)) add('ReadingPane', { variant: 'poem', lines: p.originalLesson }); };

  switch (lessonType) {
    case 'Poem':
    case 'Story':
      // Read the real text first (poetic/story form), art alongside, then help.
      poem();
      illustration();
      prose();        // simplified explanation, secondary
      vocab();
      reflect();
      takeaways();
      break;
    case 'Mathematics':
    case 'Concept':
      // Concept-first: explanation → worked examples (the heart of a maths
      // lesson) → vocab/reflect/takeaways.
      prose();
      if (nonEmpty((p as any).workedExamples)) add('WorkedExamples', { examples: (p as any).workedExamples });
      illustration();
      vocab();
      reflect();
      takeaways();
      break;
    case 'Experiment':
    case 'Science':
      illustration();
      prose();
      vocab();
      reflect();
      takeaways();
      break;
    default:
      // Generic reading lesson.
      poem();          // renders only if an original text exists
      prose();
      illustration();
      vocab();
      reflect();
      takeaways();
  }

  return { lessonType, components: out };
}
