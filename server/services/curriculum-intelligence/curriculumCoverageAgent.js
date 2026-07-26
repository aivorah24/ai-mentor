/**
 * Stage 0 — curriculumCoverageAgent
 *
 * Understand-first at the GRADE level: before generating any content, confirm a
 * grade has its FULL official NCERT subject set — not just whatever happens to
 * be ingested already. Reports which official subjects are PRESENT (published to
 * syllabus_chapters) vs MISSING, so missing ones can be sourced->ingested->
 * published->generated the same way.
 *
 * CRITICAL guardrail: only the OFFICIAL set per grade is declared here. We never
 * invent subjects a grade doesn't have (e.g. NCERT Grade 1-2 have NO EVS /
 * Science / Social Science / Sanskrit — those start Grade 3+). Declaring an
 * unofficial subject would violate "never invent".
 *
 * The official map is intentionally explicit + auditable. Book codes are the
 * NCERT textbook codes used for sourcing (ncert.nic.in/textbook/pdf/<code>NN.pdf).
 */

// grade number -> official NCERT subjects with their textbook + code.
// Sources: NCERT Foundational (G1-2) and Preparatory (G3-5) stage book lists.
const OFFICIAL_SUBJECTS = {
  1: [
    { subject: 'English', book: 'Mridang', code: 'aemr1' },
    { subject: 'Hindi', book: 'Sarangi', code: 'ahsr1' },
    { subject: 'Urdu', book: 'Ibtedai Urdu', code: 'auur1' },
    { subject: 'Mathematics', book: 'Joyful Mathematics', code: 'aejm1' },
  ],
  2: [
    { subject: 'English', book: 'Mridang', code: 'bemr1' },
    { subject: 'Hindi', book: 'Sarangi', code: 'bhsr1' },
    { subject: 'Urdu', book: 'Shahnai', code: 'bush1' },
    { subject: 'Mathematics', book: 'Joyful Mathematics', code: 'bejm1' },
  ],
  // Grade 3+ add Environmental Studies / language books — populate when needed.
  // Left conservative on purpose: only add a grade here once its official set is
  // verified, so coverage checks never fabricate subjects.
};

/**
 * @param {number} grade
 * @returns {Array<{subject,book,code}>|null} official set, or null if not declared
 */
function officialSet(grade) {
  return OFFICIAL_SUBJECTS[grade] || null;
}

/**
 * Compare the official set against what's actually published for the grade.
 * @param {{ grade:number, gradeLabel:string, supabase:any }} args
 * @returns {Promise<{ grade, official, present, missing, undeclared }>}
 *   present  = official subjects that already have published chapters
 *   missing  = official subjects with NO published chapters (need sourcing)
 *   undeclared = published subjects NOT in the official set (review — possible error)
 */
async function assessCoverage({ grade, gradeLabel, supabase }) {
  const official = officialSet(grade);
  const { data: chapters } = await supabase
    .from('syllabus_chapters').select('subject').eq('grade', gradeLabel || `Grade ${grade}`);
  const publishedSubjects = [...new Set((chapters || []).map((c) => c.subject))];

  if (!official) {
    return { grade, official: null, present: publishedSubjects, missing: [], undeclared: [],
      note: `No official subject set declared for Grade ${grade} — add it to OFFICIAL_SUBJECTS before coverage can be enforced.` };
  }

  const officialNames = official.map((o) => o.subject);
  const present = official.filter((o) => publishedSubjects.some((p) => p.toLowerCase() === o.subject.toLowerCase()));
  const missing = official.filter((o) => !publishedSubjects.some((p) => p.toLowerCase() === o.subject.toLowerCase()));
  const undeclared = publishedSubjects.filter((p) => !officialNames.some((n) => n.toLowerCase() === p.toLowerCase()));

  return { grade, official, present, missing, undeclared };
}

module.exports = { OFFICIAL_SUBJECTS, officialSet, assessCoverage };
