/**
 * syllabusRegistry.ts
 * Single lookup point for "does this curriculum/grade/subject have a
 * curated, chapter-accurate syllabus?" — used by both SubjectSyllabusScreen
 * (chapter list) and LessonScreen (Learn/Listen/Ask/Practice). Previously
 * both screens hardcoded CBSE_G6_ENGLISH_SYLLABUS directly, so adding a
 * second subject meant touching two places; this is the one place to add
 * a new curated subject going forward.
 */
import { CBSE_G6_ENGLISH_SYLLABUS, type SyllabusChapter } from './cbseG6EnglishSyllabus';
import { CBSE_G6_SCIENCE_SYLLABUS } from './cbseG6ScienceSyllabus';
import { CBSE_G6_SOCIAL_SCIENCE_SYLLABUS } from './cbseG6SocialScienceSyllabus';
import { CBSE_G6_MATHEMATICS_SYLLABUS } from './cbseG6MathematicsSyllabus';

export type { SyllabusChapter, SyllabusTopic, ListenPart, VocabWord } from './cbseG6EnglishSyllabus';

export function getSubjectSyllabus(curriculum: string, grade: string, subject: string): SyllabusChapter[] {
  const isCBSE = /^(cbse|ncert)$/i.test(curriculum.trim());
  const isG6 = /^grade\s*6$/i.test(grade.trim());
  if (!isCBSE || !isG6) return [];

  const s = subject.trim();
  if (/english/i.test(s)) return CBSE_G6_ENGLISH_SYLLABUS;
  if (/science/i.test(s) && !/social/i.test(s)) return CBSE_G6_SCIENCE_SYLLABUS;
  if (/social/i.test(s)) return CBSE_G6_SOCIAL_SCIENCE_SYLLABUS;
  if (/math/i.test(s)) return CBSE_G6_MATHEMATICS_SYLLABUS;
  return [];
}
