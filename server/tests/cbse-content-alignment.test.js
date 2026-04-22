/**
 * CBSE Content Alignment Tests
 * Verifies that seed data matches actual NCERT textbook curriculum
 * for Grades 3-6 (NCF 2023 / NEP 2020 editions).
 */

// Pull CHAPTERS from the seed script without executing Qdrant calls
const fs = require('fs');
const path = require('path');

// Extract CHAPTERS array by evaluating the file in a sandbox
let CHAPTERS;
const seedPath = path.join(__dirname, '../scripts/seed-cbse-grades3to6.js');
const seedSrc = fs.readFileSync(seedPath, 'utf8');

// Extract just the CHAPTERS array definition
const arrMatch = seedSrc.match(/const CHAPTERS\s*=\s*\[([\s\S]*?)\n\];/);
if (!arrMatch) throw new Error('Could not extract CHAPTERS from seed file');
// eslint-disable-next-line no-eval
CHAPTERS = eval(`[${arrMatch[1]}]`);

// ── Expected NCERT textbook structure ──────────────────────────────────────
// Source: NCERT official syllabus (NCF 2023 / NEP 2020)

const EXPECTED = {
  'Grade 3': {
    Mathematics: { textbook: 'Maths Mela',         chapters: 14 },
    EVS:         { textbook: 'Our Wondrous World',  chapters: 24 },
  },
  'Grade 4': {
    Mathematics: { textbook: 'Math-Magic',     chapters: 14 },
    EVS:         { textbook: 'Looking Around',  chapters: 27 },
  },
  'Grade 5': {
    Mathematics: { textbook: 'Math-Magic',     chapters: 15 },
    EVS:         { textbook: 'Looking Around',  chapters: 22 },
  },
  'Grade 6': {
    Mathematics: { textbook: 'Ganita Prakash', chapters: 10 },
    Science:     { textbook: 'Curiosity',      chapters: 12 },
  },
};

// Key chapter names per grade+subject that MUST exist (spot-check)
const MUST_HAVE_TOPICS = {
  'Grade 3|Mathematics': ["What's in a Name?", 'Fun with Shapes', 'Double Century'],
  'Grade 3|EVS':         ["Poonam's Day Out", 'The Plant Fairy', 'Water O\' Water'],
  'Grade 4|Mathematics': ['Shapes Around Us', 'Hide and Seek', 'Pattern Around Us'],
  'Grade 4|EVS':         ['Going to School', 'Ear to Ear', 'A Day with Nandu'],
  'Grade 5|Mathematics': ['Fractions', 'Angles as Turns', 'Shapes and Patterns'],
  'Grade 5|EVS':         ['Super Senses', 'Experiment with Water'],
  'Grade 6|Mathematics': ['Patterns in Mathematics', 'Lines and Angles', 'Number Play'],
  'Grade 6|Science':     ['The Wonderful World of Science', 'Diversity in Living World'],
};

// ── Helpers ────────────────────────────────────────────────────────────────
function chaptersFor(grade, subject) {
  return CHAPTERS.filter(c => c.grade === grade && c.subject === subject);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CBSE Seed Data — Structural Integrity', () => {
  test('total chapter count is 138', () => {
    expect(CHAPTERS.length).toBe(138);
  });

  test('every entry has required fields', () => {
    for (const ch of CHAPTERS) {
      expect(ch).toHaveProperty('grade');
      expect(ch).toHaveProperty('subject');
      expect(ch).toHaveProperty('textbook');
      expect(ch).toHaveProperty('chapter');
      expect(ch).toHaveProperty('topic');
      expect(ch).toHaveProperty('desc');
      expect(typeof ch.chapter).toBe('number');
      expect(ch.topic.length).toBeGreaterThan(0);
      expect(ch.desc.length).toBeGreaterThan(10);
    }
  });

  test('no duplicate grade+subject+chapter numbers', () => {
    const seen = new Set();
    for (const ch of CHAPTERS) {
      const key = `${ch.grade}|${ch.subject}|${ch.chapter}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test('curriculum field defaults to CBSE in seed script', () => {
    // The seed script uses CURRICULUM = 'CBSE' constant
    expect(seedSrc).toMatch(/CURRICULUM\s*=\s*'CBSE'/);
  });
});

describe('CBSE Seed Data — Grade & Subject Alignment', () => {
  for (const [grade, subjects] of Object.entries(EXPECTED)) {
    describe(grade, () => {
      for (const [subject, expected] of Object.entries(subjects)) {
        const chs = chaptersFor(grade, subject);

        test(`${subject} has exactly ${expected.chapters} chapters`, () => {
          expect(chs.length).toBe(expected.chapters);
        });

        test(`${subject} chapters are numbered 1..${expected.chapters}`, () => {
          const nums = chs.map(c => c.chapter).sort((a, b) => a - b);
          const expectedNums = Array.from({ length: expected.chapters }, (_, i) => i + 1);
          expect(nums).toEqual(expectedNums);
        });

        test(`${subject} uses textbook "${expected.textbook}"`, () => {
          for (const ch of chs) {
            expect(ch.textbook).toBe(expected.textbook);
          }
        });
      }

      // Class 3-5 should NOT have separate Science
      if (['Grade 3', 'Grade 4', 'Grade 5'].includes(grade)) {
        test('has EVS (not separate Science)', () => {
          const sci = chaptersFor(grade, 'Science');
          const evs = chaptersFor(grade, 'EVS');
          expect(sci.length).toBe(0);
          expect(evs.length).toBeGreaterThan(0);
        });
      }

      // Class 6 should have Science (not EVS)
      if (grade === 'Grade 6') {
        test('has separate Science (not EVS)', () => {
          const sci = chaptersFor(grade, 'Science');
          const evs = chaptersFor(grade, 'EVS');
          expect(sci.length).toBeGreaterThan(0);
          expect(evs.length).toBe(0);
        });
      }
    });
  }
});

describe('CBSE Seed Data — Key Topic Spot-Checks', () => {
  for (const [key, requiredTopics] of Object.entries(MUST_HAVE_TOPICS)) {
    const [grade, subject] = key.split('|');
    const chs = chaptersFor(grade, subject);
    const topicNames = chs.map(c => c.topic);

    for (const t of requiredTopics) {
      test(`${grade} ${subject} includes "${t}"`, () => {
        expect(topicNames).toContain(t);
      });
    }
  }
});

describe('CBSE Seed Data — Content Quality', () => {
  test('descriptions are meaningful (>30 chars, no placeholder text)', () => {
    for (const ch of CHAPTERS) {
      expect(ch.desc.length).toBeGreaterThan(30);
      expect(ch.desc.toLowerCase()).not.toContain('lorem ipsum');
      expect(ch.desc.toLowerCase()).not.toContain('placeholder');
      expect(ch.desc.toLowerCase()).not.toContain('todo');
    }
  });

  test('topic names are unique within each grade+subject', () => {
    for (const [grade, subjects] of Object.entries(EXPECTED)) {
      for (const subject of Object.keys(subjects)) {
        const chs = chaptersFor(grade, subject);
        const names = chs.map(c => c.topic);
        const unique = new Set(names);
        expect(unique.size).toBe(names.length);
      }
    }
  });

  test('only valid grades present', () => {
    const grades = new Set(CHAPTERS.map(c => c.grade));
    expect([...grades].sort()).toEqual(['Grade 3', 'Grade 4', 'Grade 5', 'Grade 6']);
  });

  test('only valid subjects present', () => {
    const subjects = new Set(CHAPTERS.map(c => c.subject));
    expect([...subjects].sort()).toEqual(['EVS', 'Mathematics', 'Science']);
  });
});
