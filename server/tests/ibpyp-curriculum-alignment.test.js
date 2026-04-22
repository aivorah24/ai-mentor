/**
 * IB PYP Curriculum Alignment Tests — Issue #59
 *
 * Verifies that our IB_PYP_TOPIC_BANK matches the actual IB PYP
 * curriculum for Grades 3, 4, and 5 across all subjects.
 *
 * Sources: IB PYP Programme of Inquiry (Mathematics, Language, Science,
 * Social Studies, Arts, PE, ICT) — Grades 3–5.
 */

// ── IB_PYP_TOPIC_BANK (mirrors LearningPathsScreen.tsx) ───────────────────
const IB_PYP_TOPIC_BANK = [
  // ── GRADE 3 ──────────────────────────────────────────────────────────────
  { grade: 'Grade 3', subject: 'Mathematics',        unit: 'Number Sense',    topic: 'Place Value to 1000' },
  { grade: 'Grade 3', subject: 'Mathematics',        unit: 'Number Sense',    topic: 'Addition & Subtraction' },
  { grade: 'Grade 3', subject: 'Mathematics',        unit: 'Number Sense',    topic: 'Multiplication Basics' },
  { grade: 'Grade 3', subject: 'Mathematics',        unit: 'Geometry',        topic: '2D and 3D Shapes' },
  { grade: 'Grade 3', subject: 'Mathematics',        unit: 'Measurement',     topic: 'Time and Calendar' },
  { grade: 'Grade 3', subject: 'Science',            unit: 'Living Things',   topic: 'Plant Life Cycles' },
  { grade: 'Grade 3', subject: 'Science',            unit: 'Living Things',   topic: 'Animal Habitats' },
  { grade: 'Grade 3', subject: 'Science',            unit: 'Earth & Space',   topic: 'Weather Patterns' },
  { grade: 'Grade 3', subject: 'Science',            unit: 'Earth & Space',   topic: 'Soil and Rocks' },
  { grade: 'Grade 3', subject: 'Science',            unit: 'Living Things',   topic: 'Food Chains' },
  { grade: 'Grade 3', subject: 'Social Studies',     unit: 'Communities',     topic: 'My Community & Neighbourhood' },
  { grade: 'Grade 3', subject: 'Social Studies',     unit: 'Communities',     topic: 'Maps and Directions' },
  { grade: 'Grade 3', subject: 'Social Studies',     unit: 'Heritage',        topic: 'Cultural Traditions' },
  { grade: 'Grade 3', subject: 'English',            unit: 'Reading',         topic: 'Story Elements' },
  { grade: 'Grade 3', subject: 'English',            unit: 'Reading',         topic: 'Retelling and Sequencing' },
  { grade: 'Grade 3', subject: 'English',            unit: 'Reading',         topic: 'Reading with Expression' },
  { grade: 'Grade 3', subject: 'English',            unit: 'Writing',         topic: 'Paragraphs & Punctuation' },
  { grade: 'Grade 3', subject: 'English',            unit: 'Writing',         topic: 'Describing Characters' },
  { grade: 'Grade 3', subject: 'English',            unit: 'Writing',         topic: 'Writing Instructions' },
  { grade: 'Grade 3', subject: 'English',            unit: 'Grammar',         topic: 'Nouns, Verbs & Adjectives' },
  { grade: 'Grade 3', subject: 'English',            unit: 'Grammar',         topic: 'Compound Words' },
  { grade: 'Grade 3', subject: 'English',            unit: 'Grammar',         topic: 'Prefixes and Suffixes' },
  { grade: 'Grade 3', subject: 'Arts',               unit: 'Visual Arts',     topic: 'Colour Theory & Mixing' },
  { grade: 'Grade 3', subject: 'Arts',               unit: 'Music',           topic: 'Rhythm and Beat' },
  { grade: 'Grade 3', subject: 'Physical Education', unit: 'Movement',        topic: 'Team Sports Basics' },
  { grade: 'Grade 3', subject: 'ICT',               unit: 'Digital Literacy', topic: 'Introduction to Computers' },

  // ── GRADE 4 ──────────────────────────────────────────────────────────────
  { grade: 'Grade 4', subject: 'Mathematics',        unit: 'Number Sense',    topic: 'Fractions and Decimals' },
  { grade: 'Grade 4', subject: 'Mathematics',        unit: 'Number Sense',    topic: 'Multiplication & Division' },
  { grade: 'Grade 4', subject: 'Mathematics',        unit: 'Data Handling',   topic: 'Graphs and Statistics' },
  { grade: 'Grade 4', subject: 'Science',            unit: 'Forces & Motion', topic: 'Push, Pull and Gravity' },
  { grade: 'Grade 4', subject: 'Science',            unit: 'Matter',          topic: 'States of Matter' },
  { grade: 'Grade 4', subject: 'Science',            unit: 'Living Things',   topic: 'Food Chains and Ecosystems' },
  { grade: 'Grade 4', subject: 'Social Studies',     unit: 'Global Connections', topic: 'Countries and Continents' },
  { grade: 'Grade 4', subject: 'English',            unit: 'Reading',         topic: 'Comprehension Strategies' },
  { grade: 'Grade 4', subject: 'English',            unit: 'Reading',         topic: 'Reading Fluency & Inference' },
  { grade: 'Grade 4', subject: 'English',            unit: 'Writing',         topic: 'Narrative Writing' },
  { grade: 'Grade 4', subject: 'English',            unit: 'Writing',         topic: 'Descriptive Writing' },
  { grade: 'Grade 4', subject: 'English',            unit: 'Writing',         topic: 'Paragraphing & Organisation' },
  { grade: 'Grade 4', subject: 'English',            unit: 'Grammar',         topic: 'Direct and Indirect Speech' },
  { grade: 'Grade 4', subject: 'English',            unit: 'Grammar',         topic: 'Tenses — Past, Present & Future' },
  { grade: 'Grade 4', subject: 'English',            unit: 'Grammar',         topic: 'Conjunctions and Connectives' },
  { grade: 'Grade 4', subject: 'English',            unit: 'Grammar',         topic: 'Punctuation — Commas, Apostrophes & Speech Marks' },
  { grade: 'Grade 4', subject: 'English',            unit: 'Vocabulary',      topic: 'Synonyms & Antonyms' },
  { grade: 'Grade 4', subject: 'Arts',               unit: 'Visual Arts',     topic: 'Perspective Drawing' },
  { grade: 'Grade 4', subject: 'ICT',               unit: 'Digital Literacy', topic: 'Internet Safety' },

  // ── GRADE 5 ──────────────────────────────────────────────────────────────
  { grade: 'Grade 5', subject: 'Mathematics',        unit: 'Algebra',         topic: 'Patterns and Variables' },
  { grade: 'Grade 5', subject: 'Mathematics',        unit: 'Number Sense',    topic: 'Percentages and Ratios' },
  { grade: 'Grade 5', subject: 'Science',            unit: 'Earth & Space',   topic: 'Solar System & Planets' },
  { grade: 'Grade 5', subject: 'Science',            unit: 'Life Science',    topic: 'Human Body Systems' },
  { grade: 'Grade 5', subject: 'Science',            unit: 'Life Science',    topic: 'Food Webs and Ecosystems' },
  { grade: 'Grade 5', subject: 'Social Studies',     unit: 'History',         topic: 'Ancient Civilisations' },
  { grade: 'Grade 5', subject: 'English',            unit: 'Writing',         topic: 'Persuasive Writing' },
  { grade: 'Grade 5', subject: 'English',            unit: 'Writing',         topic: 'Formal vs Informal Writing' },
  { grade: 'Grade 5', subject: 'English',            unit: 'Writing',         topic: 'Research and Note-taking' },
  { grade: 'Grade 5', subject: 'English',            unit: 'Literature',      topic: 'Poetry and Figurative Language' },
  { grade: 'Grade 5', subject: 'English',            unit: 'Literature',      topic: 'Literary Devices' },
  { grade: 'Grade 5', subject: 'English',            unit: 'Grammar',         topic: 'Direct and Indirect Speech' },
  { grade: 'Grade 5', subject: 'English',            unit: 'Grammar',         topic: 'Active and Passive Voice' },
  { grade: 'Grade 5', subject: 'English',            unit: 'Vocabulary',      topic: 'Idioms and Expressions' },
  { grade: 'Grade 5', subject: 'Arts',               unit: 'Performing Arts', topic: 'Drama and Expression' },
  { grade: 'Grade 5', subject: 'ICT',               unit: 'Coding',           topic: 'Introduction to Scratch' },
];

// ── Expected curriculum structure per IB PYP ──────────────────────────────
const EXPECTED = {
  'Grade 3': {
    subjects:         ['Mathematics', 'Science', 'Social Studies', 'English', 'Arts', 'Physical Education', 'ICT'],
    English: {
      minTopics: 9,
      mustInclude: ['Story Elements', 'Nouns, Verbs & Adjectives', 'Paragraphs & Punctuation',
                    'Retelling and Sequencing', 'Compound Words', 'Prefixes and Suffixes'],
      units: ['Reading', 'Writing', 'Grammar'],
    },
    Mathematics: {
      minTopics: 5,
      mustInclude: ['Place Value to 1000', 'Addition & Subtraction', 'Multiplication Basics', '2D and 3D Shapes', 'Time and Calendar'],
    },
    Science: {
      minTopics: 5,
      mustInclude: ['Plant Life Cycles', 'Animal Habitats', 'Weather Patterns', 'Food Chains'],
    },
  },
  'Grade 4': {
    subjects:         ['Mathematics', 'Science', 'Social Studies', 'English', 'Arts', 'ICT'],
    English: {
      minTopics: 10,
      mustInclude: [
        'Direct and Indirect Speech',           // Eilla's confirmed topic
        'Comprehension Strategies',
        'Narrative Writing',
        'Tenses — Past, Present & Future',
        'Conjunctions and Connectives',
        'Synonyms & Antonyms',
        'Descriptive Writing',
        'Paragraphing & Organisation',
        'Punctuation — Commas, Apostrophes & Speech Marks',
        'Reading Fluency & Inference',
      ],
      units: ['Reading', 'Writing', 'Grammar', 'Vocabulary'],
    },
    Mathematics: {
      minTopics: 3,
      mustInclude: ['Fractions and Decimals', 'Multiplication & Division', 'Graphs and Statistics'],
    },
    Science: {
      minTopics: 3,
      mustInclude: ['Push, Pull and Gravity', 'States of Matter', 'Food Chains and Ecosystems'],
    },
  },
  'Grade 5': {
    subjects:         ['Mathematics', 'Science', 'Social Studies', 'English', 'Arts', 'ICT'],
    English: {
      minTopics: 8,
      mustInclude: [
        'Persuasive Writing',
        'Poetry and Figurative Language',
        'Direct and Indirect Speech',
        'Active and Passive Voice',
        'Formal vs Informal Writing',
        'Literary Devices',
        'Idioms and Expressions',
        'Research and Note-taking',
      ],
      units: ['Writing', 'Literature', 'Grammar', 'Vocabulary'],
    },
    Mathematics: {
      minTopics: 2,
      mustInclude: ['Patterns and Variables', 'Percentages and Ratios'],
    },
    Science: {
      minTopics: 3,
      mustInclude: ['Solar System & Planets', 'Human Body Systems', 'Food Webs and Ecosystems'],
    },
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────
function topicsFor(grade, subject) {
  return IB_PYP_TOPIC_BANK.filter(t => t.grade === grade && t.subject === subject);
}

function allTopicsFor(grade) {
  return IB_PYP_TOPIC_BANK.filter(t => t.grade === grade);
}

function subjectsFor(grade) {
  return [...new Set(IB_PYP_TOPIC_BANK.filter(t => t.grade === grade).map(t => t.subject))];
}

// ── Structure tests ────────────────────────────────────────────────────────

describe('IB PYP Topic Bank — data integrity', () => {
  test('all entries have required fields: grade, subject, unit, topic', () => {
    IB_PYP_TOPIC_BANK.forEach((entry, i) => {
      expect(entry.grade).toBeTruthy();
      expect(entry.subject).toBeTruthy();
      expect(entry.unit).toBeTruthy();
      expect(entry.topic).toBeTruthy();
    });
  });

  test('only Grade 3, 4, 5 exist in the bank', () => {
    const grades = [...new Set(IB_PYP_TOPIC_BANK.map(t => t.grade))];
    expect(grades.sort()).toEqual(['Grade 3', 'Grade 4', 'Grade 5']);
  });

  test('no duplicate topics within the same grade and subject', () => {
    const seen = new Set();
    IB_PYP_TOPIC_BANK.forEach(entry => {
      const key = `${entry.grade}|${entry.subject}|${entry.topic}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    });
  });

  test('all topic strings are non-empty and trimmed', () => {
    IB_PYP_TOPIC_BANK.forEach(entry => {
      expect(entry.topic.trim()).toBe(entry.topic);
      expect(entry.topic.length).toBeGreaterThan(0);
    });
  });
});

// ── Grade 3 alignment ─────────────────────────────────────────────────────

describe('Grade 3 — IB PYP curriculum alignment', () => {
  const grade = 'Grade 3';

  test('all required subjects present', () => {
    const actual = subjectsFor(grade);
    EXPECTED[grade].subjects.forEach(subject => {
      expect(actual).toContain(subject);
    });
  });

  test('English: minimum 9 topics', () => {
    expect(topicsFor(grade, 'English').length).toBeGreaterThanOrEqual(9);
  });

  test('English: all required topics present', () => {
    const topics = topicsFor(grade, 'English').map(t => t.topic);
    EXPECTED[grade].English.mustInclude.forEach(required => {
      expect(topics).toContain(required);
    });
  });

  test('English: covers Reading, Writing and Grammar units', () => {
    const units = [...new Set(topicsFor(grade, 'English').map(t => t.unit))];
    EXPECTED[grade].English.units.forEach(unit => {
      expect(units).toContain(unit);
    });
  });

  test('Mathematics: all 5 core topics present', () => {
    const topics = topicsFor(grade, 'Mathematics').map(t => t.topic);
    EXPECTED[grade].Mathematics.mustInclude.forEach(required => {
      expect(topics).toContain(required);
    });
  });

  test('Science: Living Things and Earth & Space covered', () => {
    const topics = topicsFor(grade, 'Science').map(t => t.topic);
    EXPECTED[grade].Science.mustInclude.forEach(required => {
      expect(topics).toContain(required);
    });
  });

  test('Social Studies: community and heritage topics present', () => {
    const topics = topicsFor(grade, 'Social Studies').map(t => t.topic);
    expect(topics).toContain('My Community & Neighbourhood');
    expect(topics).toContain('Maps and Directions');
    expect(topics).toContain('Cultural Traditions');
  });

  test('Arts: Visual Arts and Music covered', () => {
    const units = topicsFor(grade, 'Arts').map(t => t.unit);
    expect(units).toContain('Visual Arts');
    expect(units).toContain('Music');
  });

  test('ICT: Introduction to Computers present', () => {
    const topics = topicsFor(grade, 'ICT').map(t => t.topic);
    expect(topics).toContain('Introduction to Computers');
  });
});

// ── Grade 4 alignment ─────────────────────────────────────────────────────

describe('Grade 4 — IB PYP curriculum alignment', () => {
  const grade = 'Grade 4';

  test('all required subjects present', () => {
    const actual = subjectsFor(grade);
    EXPECTED[grade].subjects.forEach(subject => {
      expect(actual).toContain(subject);
    });
  });

  test('English: minimum 10 topics', () => {
    expect(topicsFor(grade, 'English').length).toBeGreaterThanOrEqual(10);
  });

  test('English: Direct and Indirect Speech present (Eilla confirmed topic)', () => {
    const topics = topicsFor(grade, 'English').map(t => t.topic);
    expect(topics).toContain('Direct and Indirect Speech');
  });

  test('English: all 10 required topics present', () => {
    const topics = topicsFor(grade, 'English').map(t => t.topic);
    EXPECTED[grade].English.mustInclude.forEach(required => {
      expect(topics).toContain(required);
    });
  });

  test('English: covers Reading, Writing, Grammar and Vocabulary units', () => {
    const units = [...new Set(topicsFor(grade, 'English').map(t => t.unit))];
    EXPECTED[grade].English.units.forEach(unit => {
      expect(units).toContain(unit);
    });
  });

  test('English: Grammar unit has tenses, conjunctions, punctuation and speech', () => {
    const grammarTopics = topicsFor(grade, 'English')
      .filter(t => t.unit === 'Grammar')
      .map(t => t.topic);
    expect(grammarTopics).toContain('Direct and Indirect Speech');
    expect(grammarTopics).toContain('Tenses — Past, Present & Future');
    expect(grammarTopics).toContain('Conjunctions and Connectives');
    expect(grammarTopics).toContain('Punctuation — Commas, Apostrophes & Speech Marks');
  });

  test('Mathematics: Fractions, Multiplication and Graphs present', () => {
    const topics = topicsFor(grade, 'Mathematics').map(t => t.topic);
    EXPECTED[grade].Mathematics.mustInclude.forEach(required => {
      expect(topics).toContain(required);
    });
  });

  test('Science: Forces, Matter and Ecosystems covered', () => {
    const topics = topicsFor(grade, 'Science').map(t => t.topic);
    EXPECTED[grade].Science.mustInclude.forEach(required => {
      expect(topics).toContain(required);
    });
  });

  test('Social Studies: Global connections covered', () => {
    const topics = topicsFor(grade, 'Social Studies').map(t => t.topic);
    expect(topics).toContain('Countries and Continents');
  });

  test('ICT: Internet Safety present (age-appropriate for Grade 4)', () => {
    const topics = topicsFor(grade, 'ICT').map(t => t.topic);
    expect(topics).toContain('Internet Safety');
  });

  test('Arts: Perspective Drawing present', () => {
    const topics = topicsFor(grade, 'Arts').map(t => t.topic);
    expect(topics).toContain('Perspective Drawing');
  });
});

// ── Grade 5 alignment ─────────────────────────────────────────────────────

describe('Grade 5 — IB PYP curriculum alignment', () => {
  const grade = 'Grade 5';

  test('all required subjects present', () => {
    const actual = subjectsFor(grade);
    EXPECTED[grade].subjects.forEach(subject => {
      expect(actual).toContain(subject);
    });
  });

  test('English: minimum 8 topics', () => {
    expect(topicsFor(grade, 'English').length).toBeGreaterThanOrEqual(8);
  });

  test('English: all 8 required topics present', () => {
    const topics = topicsFor(grade, 'English').map(t => t.topic);
    EXPECTED[grade].English.mustInclude.forEach(required => {
      expect(topics).toContain(required);
    });
  });

  test('English: Direct and Indirect Speech in Grade 5 (advanced level)', () => {
    const topics = topicsFor(grade, 'English').map(t => t.topic);
    expect(topics).toContain('Direct and Indirect Speech');
  });

  test('English: Active and Passive Voice present (Grade 5 grammar)', () => {
    const topics = topicsFor(grade, 'English').map(t => t.topic);
    expect(topics).toContain('Active and Passive Voice');
  });

  test('English: covers Writing, Literature, Grammar and Vocabulary units', () => {
    const units = [...new Set(topicsFor(grade, 'English').map(t => t.unit))];
    EXPECTED[grade].English.units.forEach(unit => {
      expect(units).toContain(unit);
    });
  });

  test('Mathematics: Algebra and Number Sense covered', () => {
    const topics = topicsFor(grade, 'Mathematics').map(t => t.topic);
    EXPECTED[grade].Mathematics.mustInclude.forEach(required => {
      expect(topics).toContain(required);
    });
  });

  test('Science: Solar System, Human Body and Ecosystems covered', () => {
    const topics = topicsFor(grade, 'Science').map(t => t.topic);
    EXPECTED[grade].Science.mustInclude.forEach(required => {
      expect(topics).toContain(required);
    });
  });

  test('Social Studies: Ancient Civilisations present', () => {
    const topics = topicsFor(grade, 'Social Studies').map(t => t.topic);
    expect(topics).toContain('Ancient Civilisations');
  });

  test('ICT: Coding / Scratch present (Grade 5 progression)', () => {
    const topics = topicsFor(grade, 'ICT').map(t => t.topic);
    expect(topics).toContain('Introduction to Scratch');
  });

  test('Arts: Performing Arts covered', () => {
    const units = topicsFor(grade, 'Arts').map(t => t.unit);
    expect(units).toContain('Performing Arts');
  });
});

// ── Cross-grade progression ────────────────────────────────────────────────

describe('Cross-grade progression — topics build on each other', () => {
  test('ICT progresses: Computers (G3) → Internet Safety (G4) → Coding/Scratch (G5)', () => {
    expect(topicsFor('Grade 3', 'ICT').map(t => t.topic)).toContain('Introduction to Computers');
    expect(topicsFor('Grade 4', 'ICT').map(t => t.topic)).toContain('Internet Safety');
    expect(topicsFor('Grade 5', 'ICT').map(t => t.topic)).toContain('Introduction to Scratch');
  });

  test('English grammar progresses: Nouns/Verbs (G3) → Tenses/Speech (G4) → Voice (G5)', () => {
    expect(topicsFor('Grade 3', 'English').map(t => t.topic)).toContain('Nouns, Verbs & Adjectives');
    expect(topicsFor('Grade 4', 'English').map(t => t.topic)).toContain('Tenses — Past, Present & Future');
    expect(topicsFor('Grade 5', 'English').map(t => t.topic)).toContain('Active and Passive Voice');
  });

  test('Direct and Indirect Speech in both Grade 4 and Grade 5', () => {
    expect(topicsFor('Grade 4', 'English').map(t => t.topic)).toContain('Direct and Indirect Speech');
    expect(topicsFor('Grade 5', 'English').map(t => t.topic)).toContain('Direct and Indirect Speech');
  });

  test('Writing progresses: Instructions (G3) → Narrative (G4) → Persuasive (G5)', () => {
    expect(topicsFor('Grade 3', 'English').map(t => t.topic)).toContain('Writing Instructions');
    expect(topicsFor('Grade 4', 'English').map(t => t.topic)).toContain('Narrative Writing');
    expect(topicsFor('Grade 5', 'English').map(t => t.topic)).toContain('Persuasive Writing');
  });

  test('Science ecosystems progresses: Food Chains (G3) → Ecosystems (G4) → Food Webs (G5)', () => {
    expect(topicsFor('Grade 3', 'Science').map(t => t.topic)).toContain('Food Chains');
    expect(topicsFor('Grade 4', 'Science').map(t => t.topic)).toContain('Food Chains and Ecosystems');
    expect(topicsFor('Grade 5', 'Science').map(t => t.topic)).toContain('Food Webs and Ecosystems');
  });

  test('each grade has more English topics than the previous', () => {
    const g3 = topicsFor('Grade 3', 'English').length;
    const g4 = topicsFor('Grade 4', 'English').length;
    expect(g4).toBeGreaterThanOrEqual(g3);
  });

  test('total topic count increases grade by grade', () => {
    const g3 = allTopicsFor('Grade 3').length;
    const g4 = allTopicsFor('Grade 4').length;
    const g5 = allTopicsFor('Grade 5').length;
    // Each grade should have at least 15 topics
    expect(g3).toBeGreaterThanOrEqual(15);
    expect(g4).toBeGreaterThanOrEqual(15);
    expect(g5).toBeGreaterThanOrEqual(15);
  });
});
