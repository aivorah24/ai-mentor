/**
 * mathChapterMap.ts
 * Maps a human-readable topic title to the NCERT textbook chapter code the
 * Math Learning Engine pipeline was run against (see
 * server/pipelines/math/{extract,generate}.js). Adding support for another
 * grade/chapter is purely a data addition here — no navigation or screen
 * code changes required.
 */
type ChapterKey = string; // `${curriculum}|${gradeNum}|${subject}|${topicTitle}`

const MATH_CHAPTER_MAP: Record<ChapterKey, string> = {
  'NCERT|6|Mathematics|Fractions': 'fegp107',
};

function key(curriculum: string, grade: string, subject: string, topic: string) {
  const gradeNum = (String(grade).match(/\d+/) || [''])[0];
  return `${curriculum}|${gradeNum}|${subject}|${topic}`;
}

export function getMathChapterCode(curriculum: string, grade: string, subject: string, topic: string): string | null {
  return MATH_CHAPTER_MAP[key(curriculum, grade, subject, topic)] || null;
}
