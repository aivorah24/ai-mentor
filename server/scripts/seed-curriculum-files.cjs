/**
 * seed-curriculum-files.cjs — create a curriculum map file for every
 * grade/subject that has textbook PDFs on disk but no data/curricula entry.
 *
 * extract-ncert-structure.cjs only fills in files that already exist, so any
 * subject that was never seeded stayed invisible to the syllabus map. Grade 11
 * Accountancy and History both have full PDF sets and zero map entries, which is
 * why 136 of 330 Grade 11 lessons could not be placed under a real chapter.
 *
 * Chapter numbering here is provisional (from the filename index); running
 * extract-ncert-structure.cjs afterwards replaces it with the book's own
 * chapter number and title. Nothing is invented and nothing is overwritten:
 * existing curriculum files are left untouched.
 *
 *   node scripts/seed-curriculum-files.cjs [--dry]
 */
const fs = require('fs');
const path = require('path');

const CUR_DIR = path.resolve(__dirname, '..', 'data', 'curricula');
const BOOKS = path.resolve(__dirname, '..', 'data', 'ncert_books');
const DRY = process.argv.includes('--dry');

const SUBJECT_LABEL = {
  mathematics: 'Mathematics', english: 'English', science: 'Science', evs: 'EVS',
  social_science: 'Social Science', hindi: 'Hindi', sanskrit: 'Sanskrit', urdu: 'Urdu',
  physics: 'Physics', chemistry: 'Chemistry', biology: 'Biology', accountancy: 'Accountancy',
  business_studies: 'Business Studies', economics: 'Economics', history: 'History',
  geography: 'Geography', political_science: 'Political Science', sociology: 'Sociology',
  psychology: 'Psychology', computer_science: 'Computer Science', home_science: 'Home Science',
  fine_arts: 'Fine Arts', physical_education: 'Physical Education',
  environmental_studies: 'Environmental Studies', social_studies: 'Social Studies',
};

// Which (grade, subject, bookCode) already have a map file.
const existing = new Set();
for (const f of fs.readdirSync(CUR_DIR).filter(x => x.endsWith('-chapters.json'))) {
  const m = f.match(/^cbse-g(\d+)-(.+)-([a-z0-9]+)-chapters\.json$/i);
  if (m) existing.add(`${m[1]}|${m[2]}|${m[3]}`.toLowerCase());
}

let created = 0, skipped = 0;
const mixed = [];
for (const gd of fs.readdirSync(BOOKS)) {
  const gm = gd.match(/^grade(\d{1,2})$/); if (!gm) continue;
  const grade = parseInt(gm[1], 10);
  const gdir = path.join(BOOKS, gd);
  if (!fs.statSync(gdir).isDirectory()) continue;

  for (const subj of fs.readdirSync(gdir)) {
    const sdir = path.join(gdir, subj);
    if (!fs.statSync(sdir).isDirectory()) continue;
    const pdfs = fs.readdirSync(sdir).filter(f => /\.pdf$/i.test(f)).sort();
    if (!pdfs.length) continue;

    // Chapter PDFs are <bookCode><2-digit chapter>.pdf — group by book code, so a
    // multi-volume subject (Physics Part I/II) gets one file per volume.
    const byBook = {};
    for (const f of pdfs) {
      const m = f.match(/^([a-z]+\d?)(\d{2})\.pdf$/i);
      if (!m) continue;
      (byBook[m[1].toLowerCase()] = byBook[m[1].toLowerCase()] || []).push({ file: f, ch: parseInt(m[2], 10) });
    }

    // Some folders are mixed: grade9/social_science holds Maths (iemh), Science
    // (iesc), English (iemr/iebe) and PE (iehp) books. Seeding from the folder
    // name would label all of those "Social Science" — an invented curriculum,
    // the precise failure this work exists to remove. A genuine multi-volume
    // subject shares one 4-letter stem (keph1/keph2 = Physics I & II), so allow
    // that and skip anything where the stems disagree.
    const stems = new Set(Object.keys(byBook).map(c => c.slice(0, 4)));
    // Language subjects legitimately ship several distinct books under one
    // subject — Class 11 Hindi alone has Aroh, Vitan, Antra and Antral. Their
    // folder name IS the subject, so differing stems are expected rather than a
    // sign of misfiling (unlike grade9/social_science, which really did contain
    // maths and science books).
    const MULTI_BOOK_SUBJECTS = new Set(['hindi', 'urdu', 'sanskrit', 'english']);
    if (stems.size > 1 && !MULTI_BOOK_SUBJECTS.has(subj.toLowerCase())) {
      console.log(`! G${grade} ${subj}: mixed books (${[...stems].join(', ')}) — skipped, needs manual sorting`);
      mixed.push(`G${grade} ${subj}: ${[...stems].join(', ')}`);
      continue;
    }

    for (const [code, list] of Object.entries(byBook)) {
      if (existing.has(`${grade}|${subj}|${code}`)) { skipped++; continue; }
      const doc = {
        curriculum: 'CBSE',
        grade: `Grade ${grade}`,
        subject: SUBJECT_LABEL[subj] || subj.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        code,
        imageSubject: SUBJECT_LABEL[subj] || subj,
        seeded: true,                      // provisional until extraction runs
        chapters: list.sort((a, b) => a.ch - b.ch).map(x => ({
          chapter: x.ch,
          pdfFile: x.file,
          title: `Chapter ${x.ch}`,
          needsTitleReview: true,
          bookPath: `grade${grade}/${subj}/${x.file}`,
        })),
      };
      const out = path.join(CUR_DIR, `cbse-g${grade}-${subj}-${code}-chapters.json`);
      if (!DRY) fs.writeFileSync(out, JSON.stringify(doc, null, 1));
      console.log(`+ G${grade} ${doc.subject} (${code}) — ${doc.chapters.length} chapters`);
      created++;
    }
  }
}
console.log(`\ncreated ${created} curriculum file(s), ${skipped} already existed${DRY ? ' [DRY]' : ''}`);
