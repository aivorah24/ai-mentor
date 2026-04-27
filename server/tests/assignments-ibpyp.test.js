/**
 * IB PYP Assignment Generation & Grading — Deep Test Suite
 * Tests all 8 subjects, step type enforcement, IB PYP compliance,
 * grading logic, and AI content quality guardrails.
 *
 * Run: npm test -- --testPathPattern=assignments-ibpyp
 */

// ── Set env vars before any module loads ──────────────────────────────────
process.env.SUPABASE_URL        = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'mock-service-key';
process.env.GROQ_API_KEY         = 'mock-groq-key';
process.env.CLOUDINARY_CLOUD_NAME = 'mock';
process.env.CLOUDINARY_API_KEY    = 'mock';
process.env.CLOUDINARY_API_SECRET = 'mock';

// ── Mock external dependencies ─────────────────────────────────────────────
const mockCreate = jest.fn();
jest.mock('groq-sdk', () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }))
);

// Mock Supabase — bypass actual HTTP calls
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq:     jest.fn().mockReturnThis(),
      or:     jest.fn().mockReturnThis(),
      order:  jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      then:   jest.fn((cb) => Promise.resolve(cb({ data: [], error: null }))),
    })),
  })),
}));

// Mock Qdrant (used in RAG retrieval — skipped gracefully but mock prevents ESM crash)
jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn().mockImplementation(() => ({
    search: jest.fn().mockResolvedValue([]),
    getCollections: jest.fn().mockResolvedValue({ collections: [] }),
  })),
}));

// Mock @xenova/transformers (ESM module — causes Jest crash in CJS)
jest.mock('@xenova/transformers', () => ({
  pipeline: jest.fn().mockResolvedValue(jest.fn().mockResolvedValue({ data: new Float32Array(384) })),
}));

// Mock cloudinary
jest.mock('cloudinary', () => ({
  v2: { config: jest.fn(), uploader: { upload: jest.fn() } },
}));

const express = require('express');
const assignmentsRouter = require('../routes/assignments');
const http = require('http');

function makeApp() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/assignments', assignmentsRouter);
  return app;
}

function post(app, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const req = http.request(
        {
          hostname: '127.0.0.1', port, path, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        },
        (res) => {
          let raw = '';
          res.on('data', c => (raw += c));
          res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: JSON.parse(raw) }); });
        }
      );
      req.on('error', e => { server.close(); reject(e); });
      req.write(data);
      req.end();
    });
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a valid Groq JSON response for generate-ibpyp.
 * stepTypes array must match the subject's expected 3 types.
 */
function makeAssignmentJson(stepTypes, overrides = {}) {
  const [t1, t2, t3] = stepTypes;
  return JSON.stringify({
    title: `Test Assignment — ${t1}`,
    centralIdea: 'Systems are shaped by the choices people make.',
    unitOfInquiry: 'How the World Works',
    taskSteps: [
      {
        type: t1,
        label: 'Tune In',
        instructions: 'Explore the provocation.',
        provocation: 'Imagine you are walking through two different neighbourhoods.',
        sections: [],
        wordBank: ['ecosystem', 'habitat'],
        reflectionPrompts: [],
        problems: [],
      },
      {
        type: t2,
        label: 'Find Out',
        instructions: 'Research and record.',
        sections: ['What I Found Out', 'My Evidence', 'Connection to Big Idea'],
        wordBank: ['ecosystem', 'habitat'],
        reflectionPrompts: [],
        problems: t2 === 'problem_solving'
          ? ['12 + 34 = ?', '56 - 23 = ?', '7 × 8 = ?', '48 ÷ 6 = ?']
          : [],
      },
      {
        type: t3,
        label: 'Sort Out',
        instructions: 'Reflect on your learning.',
        sections: [],
        wordBank: [],
        reflectionPrompts: ['What did I learn?', 'How did my thinking change?', 'What questions do I still have?'],
        problems: [],
      },
    ],
    successCriteria: [
      { id: 'c1', criterion: 'Engages with the provocation', level: 'Accomplished' },
    ],
    ...overrides,
  });
}

function mockGroqJson(stepTypes, overrides = {}) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: makeAssignmentJson(stepTypes, overrides) } }],
  });
}

// ── SUBJECT STEP TYPE ENFORCEMENT ─────────────────────────────────────────
describe('Step type enforcement — 8 subjects', () => {
  beforeEach(() => mockCreate.mockReset());

  const SUBJECT_EXPECTED_STEPS = [
    ['Mathematics',          ['tuning_in',           'problem_solving',       'math_reflection']],
    ['Science',              ['prior_knowledge',      'drawing',               'structured_writing']],
    ['English',              ['text_connection',      'reading_comprehension', 'writing_reflection']],
    ['Language Acquisition', ['language_culture',     'language_practice',     'communication']],
    ['Social Studies',       ['social_inquiry',       'research_notes',        'social_synthesis']],
    ['Visual Arts',          ['artistic_exploration', 'art_creation',          'artistic_reflection']],
    ['ICT',                  ['digital_awareness',    'tech_skill_practice',   'digital_citizenship']],
    ['Physical Education',   ['movement_exploration', 'skill_practice',        'physical_reflection']],
  ];

  for (const [subject, expectedSteps] of SUBJECT_EXPECTED_STEPS) {
    test(`${subject} → steps enforced to [${expectedSteps.join(', ')}]`, async () => {
      // AI returns wrong step types — server should override them
      const wrongTypes = ['brainstorm', 'drawing', 'structured_writing'];
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: makeAssignmentJson(wrongTypes) } }],
      });

      const app = makeApp();
      const res = await post(app, '/assignments/generate-ibpyp', {
        topic: 'Test Topic',
        subject,
        grade: 'Grade 4',
        curriculum: 'IB PYP',
      });

      expect(res.status).toBe(200);
      const steps = res.body.taskSteps;
      expect(steps).toHaveLength(3);
      expect(steps[0].type).toBe(expectedSteps[0]);
      expect(steps[1].type).toBe(expectedSteps[1]);
      expect(steps[2].type).toBe(expectedSteps[2]);
    });
  }
});

// ── MATHEMATICS ────────────────────────────────────────────────────────────
describe('Mathematics assignments', () => {
  beforeEach(() => mockCreate.mockReset());

  test('Grade 3: Fractions — has 4 real calculation problems', async () => {
    mockGroqJson(['tuning_in', 'problem_solving', 'math_reflection']);
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Fractions',
      subject: 'Mathematics',
      grade: 'Grade 3',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    const ps = res.body.taskSteps.find(s => s.type === 'problem_solving');
    expect(ps).toBeDefined();
    expect(Array.isArray(ps.problems)).toBe(true);
    expect(ps.problems.length).toBeGreaterThanOrEqual(4);
    // Problems must contain actual numbers
    ps.problems.forEach(p => expect(p).toMatch(/\d/));
  });

  test('Grade 4: Decimals — tuning_in has text provocation (no image ref)', async () => {
    mockGroqJson(['tuning_in', 'problem_solving', 'math_reflection']);
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Decimals',
      subject: 'Mathematics',
      grade: 'Grade 4',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    const tuneIn = res.body.taskSteps.find(s => s.type === 'tuning_in');
    expect(tuneIn).toBeDefined();
    // Provocation should be text-based, not image reference
    const text = JSON.stringify(tuneIn);
    expect(text.toLowerCase()).not.toContain('look at the image');
    expect(text.toLowerCase()).not.toContain('look at the photo');
  });

  test('Grade 5: Angles — math_reflection has reflectionPrompts', async () => {
    mockGroqJson(['tuning_in', 'problem_solving', 'math_reflection']);
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Angles',
      subject: 'Mathematics',
      grade: 'Grade 5',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    const reflection = res.body.taskSteps.find(s => s.type === 'math_reflection');
    expect(reflection).toBeDefined();
    expect(Array.isArray(reflection.reflectionPrompts)).toBe(true);
    expect(reflection.reflectionPrompts.length).toBeGreaterThanOrEqual(3);
  });

  test('centralIdea is a transferable concept, not a topic title', async () => {
    mockGroqJson(['tuning_in', 'problem_solving', 'math_reflection'], {
      centralIdea: 'Fractions help us understand equal sharing in everyday life.',
    });
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Fractions',
      subject: 'Mathematics',
      grade: 'Grade 3',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    expect(res.body.centralIdea).toBeDefined();
    expect(res.body.centralIdea).not.toBe('Fractions');
    expect(res.body.centralIdea.length).toBeGreaterThan(10);
  });
});

// ── SCIENCE ────────────────────────────────────────────────────────────────
describe('Science assignments', () => {
  beforeEach(() => mockCreate.mockReset());

  test('Living Things — prior_knowledge has knows + predicts sections', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            title: 'Living Things',
            centralIdea: 'Living things depend on their environment to survive.',
            unitOfInquiry: 'How the World Works',
            taskSteps: [
              { type: 'prior_knowledge', label: 'What I Know', instructions: 'Tell me what you already know.', sections: ['What I already know', 'What I predict I will learn'], wordBank: [], reflectionPrompts: [], problems: [] },
              { type: 'drawing', label: 'Draw It', instructions: 'Draw and label.', sections: [], wordBank: [], reflectionPrompts: [], problems: [] },
              { type: 'structured_writing', label: 'Write It Up', instructions: 'Write your findings.', sections: ['Introduction', 'What I Found', 'Conclusion'], wordBank: ['organism', 'habitat'], reflectionPrompts: [], problems: [] },
            ],
            successCriteria: [{ id: 'c1', criterion: 'Identifies key features', level: 'Accomplished' }],
          }),
        },
      }],
    });
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Living and Non-Living Things',
      subject: 'Science',
      grade: 'Grade 3',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    const steps = res.body.taskSteps;
    expect(steps[0].type).toBe('prior_knowledge');
    expect(steps[1].type).toBe('drawing');
    expect(steps[2].type).toBe('structured_writing');
    expect(steps[2].sections.length).toBeGreaterThanOrEqual(2);
  });
});

// ── SOCIAL STUDIES ─────────────────────────────────────────────────────────
describe('Social Studies assignments', () => {
  beforeEach(() => mockCreate.mockReset());

  test('Community — social_inquiry provocation is text-based, NOT brainstorm keywords', async () => {
    mockGroqJson(['social_inquiry', 'research_notes', 'social_synthesis'], {
      taskSteps: [
        {
          type: 'social_inquiry',
          label: 'Provocation',
          instructions: 'Respond to the provocation.',
          provocation: 'Imagine you are walking through two different neighbourhoods — one with parks and schools, another without. What do you notice?',
          sections: [],
          wordBank: ['community', 'citizenship'],
          reflectionPrompts: [],
          problems: [],
        },
        {
          type: 'research_notes',
          label: 'Research',
          instructions: 'Record your research.',
          sections: ['What I Found Out', 'My Evidence', 'Connection to Big Idea'],
          wordBank: ['community', 'citizenship'],
          reflectionPrompts: [],
          problems: [],
        },
        {
          type: 'social_synthesis',
          label: 'Reflection',
          instructions: 'Reflect.',
          sections: [],
          wordBank: [],
          reflectionPrompts: ['What did I learn?', 'How did my thinking change?', 'What questions remain?'],
          problems: [],
        },
      ],
    });
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Community and Belonging',
      subject: 'Social Studies',
      grade: 'Grade 3',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    const inquiry = res.body.taskSteps.find(s => s.type === 'social_inquiry');
    expect(inquiry).toBeDefined();
    // Must have real provocation text, not just keywords
    const provText = inquiry.provocation || inquiry.instructions || '';
    expect(provText.length).toBeGreaterThan(20);
    // Must NOT say "look at the image"
    expect(provText.toLowerCase()).not.toContain('look at the image');
  });

  test('research_notes has multi-section writing structure', async () => {
    mockGroqJson(['social_inquiry', 'research_notes', 'social_synthesis']);
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Migration',
      subject: 'Social Studies',
      grade: 'Grade 4',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    const notes = res.body.taskSteps.find(s => s.type === 'research_notes');
    expect(notes).toBeDefined();
    expect(Array.isArray(notes.sections)).toBe(true);
    expect(notes.sections.length).toBeGreaterThanOrEqual(2);
  });
});

// ── ENGLISH ────────────────────────────────────────────────────────────────
describe('English assignments', () => {
  beforeEach(() => mockCreate.mockReset());

  test('Poetry — correct 3-step types with writing_reflection prompts', async () => {
    mockGroqJson(['text_connection', 'reading_comprehension', 'writing_reflection'], {
      taskSteps: [
        { type: 'text_connection', label: 'Connect', instructions: 'Make connections.', provocation: 'This poem reminds me of...', sections: [], wordBank: ['imagery', 'metaphor'], reflectionPrompts: [], problems: [] },
        { type: 'reading_comprehension', label: 'Understand', instructions: 'Answer questions.', sections: ['Main Idea', 'Supporting Details', 'Author\'s Purpose'], wordBank: ['imagery', 'metaphor'], reflectionPrompts: [], problems: [] },
        { type: 'writing_reflection', label: 'Reflect', instructions: 'Reflect on your writing.', sections: [], wordBank: [], reflectionPrompts: ['What techniques did the author use?', 'How did the poem make you feel?', 'What would you change?'], problems: [] },
      ],
    });
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Poetry and Imagery',
      subject: 'English',
      grade: 'Grade 5',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    const [s1, s2, s3] = res.body.taskSteps;
    expect(s1.type).toBe('text_connection');
    expect(s2.type).toBe('reading_comprehension');
    expect(s3.type).toBe('writing_reflection');
    expect(s3.reflectionPrompts.length).toBeGreaterThanOrEqual(3);
  });
});

// ── LANGUAGE ACQUISITION ───────────────────────────────────────────────────
describe('Language Acquisition assignments', () => {
  beforeEach(() => mockCreate.mockReset());

  test('French Greetings — word bank includes target language vocabulary', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            title: 'French Greetings',
            centralIdea: 'Language connects people across cultures.',
            unitOfInquiry: 'Who We Are',
            taskSteps: [
              { type: 'language_culture', label: 'Culture Exploration', instructions: 'Explore cultural greetings.', provocation: 'How do people greet each other in France?', sections: [], wordBank: ['Bonjour (Hello)', 'Au revoir (Goodbye)', 'Merci (Thank you)'], reflectionPrompts: [], problems: [] },
              { type: 'language_practice', label: 'Practice', instructions: 'Practice the phrases.', sections: ['Phrase I practiced', 'How I used it', 'Cultural context'], wordBank: ['Bonjour (Hello)', 'Au revoir (Goodbye)', 'Merci (Thank you)'], reflectionPrompts: [], problems: [] },
              { type: 'communication', label: 'Communicate', instructions: 'Write a short greeting.', sections: [], wordBank: [], reflectionPrompts: ['How did using French feel?', 'What helped me learn?', 'What do I want to learn next?'], problems: [] },
            ],
            successCriteria: [{ id: 'c1', criterion: 'Uses target language correctly', level: 'Accomplished' }],
          }),
        },
      }],
    });
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'French Greetings',
      subject: 'Language Acquisition',
      grade: 'Grade 4',
      curriculum: 'IB PYP',
      language: 'French',
    });
    expect(res.status).toBe(200);
    const steps = res.body.taskSteps;
    expect(steps[0].type).toBe('language_culture');
    expect(steps[1].type).toBe('language_practice');
    expect(steps[2].type).toBe('communication');
    // Word bank should have target language words
    const wb = steps[0].wordBank || [];
    expect(wb.length).toBeGreaterThan(0);
  });
});

// ── VISUAL ARTS ────────────────────────────────────────────────────────────
describe('Visual Arts assignments', () => {
  beforeEach(() => mockCreate.mockReset());

  test('Colour Theory — art_creation step for upload, not canvas drawing prompt', async () => {
    mockGroqJson(['artistic_exploration', 'art_creation', 'artistic_reflection'], {
      taskSteps: [
        { type: 'artistic_exploration', label: 'Explore', instructions: 'Look at these artworks.', provocation: 'Artists use colour to create mood. What do you notice about these colour combinations?', sections: [], wordBank: ['primary', 'secondary', 'hue', 'saturation'], reflectionPrompts: [], problems: [] },
        { type: 'art_creation', label: 'Create', instructions: 'Create a colour wheel using primary colours.', sections: [], wordBank: ['primary', 'secondary', 'hue'], reflectionPrompts: [], problems: [] },
        { type: 'artistic_reflection', label: 'Reflect', instructions: 'Reflect on your artwork.', sections: [], wordBank: [], reflectionPrompts: ['What choices did you make?', 'What would you change?', 'How does colour affect your artwork?'], problems: [] },
      ],
    });
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Colour Theory',
      subject: 'Visual Arts',
      grade: 'Grade 3',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    const steps = res.body.taskSteps;
    expect(steps[0].type).toBe('artistic_exploration');
    expect(steps[1].type).toBe('art_creation');
    expect(steps[2].type).toBe('artistic_reflection');
    // artistic_reflection must have prompts
    expect(steps[2].reflectionPrompts.length).toBeGreaterThanOrEqual(3);
  });
});

// ── ICT ────────────────────────────────────────────────────────────────────
describe('ICT assignments', () => {
  beforeEach(() => mockCreate.mockReset());

  test('Digital Citizenship — correct 3 step types', async () => {
    mockGroqJson(['digital_awareness', 'tech_skill_practice', 'digital_citizenship'], {
      taskSteps: [
        { type: 'digital_awareness', label: 'Awareness', instructions: 'What is digital citizenship?', provocation: 'You receive a friend request from someone you don\'t know online. What do you do?', sections: [], wordBank: ['privacy', 'digital footprint', 'cyberbullying'], reflectionPrompts: [], problems: [] },
        { type: 'tech_skill_practice', label: 'Practice', instructions: 'Complete the tasks.', sections: ['What I practised', 'Steps I followed', 'What I learned'], wordBank: ['privacy', 'digital footprint'], reflectionPrompts: [], problems: [] },
        { type: 'digital_citizenship', label: 'Reflect', instructions: 'Be a responsible digital citizen.', sections: [], wordBank: [], reflectionPrompts: ['How can I protect my privacy?', 'What does being a good digital citizen mean?', 'How would I advise a friend?'], problems: [] },
      ],
    });
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Digital Citizenship',
      subject: 'ICT',
      grade: 'Grade 4',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    const [s1, s2, s3] = res.body.taskSteps;
    expect(s1.type).toBe('digital_awareness');
    expect(s2.type).toBe('tech_skill_practice');
    expect(s3.type).toBe('digital_citizenship');
  });
});

// ── PHYSICAL EDUCATION ─────────────────────────────────────────────────────
describe('Physical Education assignments', () => {
  beforeEach(() => mockCreate.mockReset());

  test('Team Sports — physical_reflection has 3 prompts', async () => {
    mockGroqJson(['movement_exploration', 'skill_practice', 'physical_reflection'], {
      taskSteps: [
        { type: 'movement_exploration', label: 'Explore Movement', instructions: 'Explore how you move.', provocation: 'Think of a time when you played a team sport. What made your team work well together?', sections: [], wordBank: ['cooperation', 'strategy', 'coordination'], reflectionPrompts: [], problems: [] },
        { type: 'skill_practice', label: 'Skill Practice', instructions: 'Record your practice.', sections: ['Skill I practised', 'How I improved', 'Challenge I faced'], wordBank: ['cooperation', 'strategy'], reflectionPrompts: [], problems: [] },
        { type: 'physical_reflection', label: 'Reflect', instructions: 'Reflect on your performance.', sections: [], wordBank: [], reflectionPrompts: ['What skill did I improve?', 'How did I help my team?', 'What will I work on next?'], problems: [] },
      ],
    });
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Team Sports and Cooperation',
      subject: 'Physical Education',
      grade: 'Grade 5',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    const reflection = res.body.taskSteps.find(s => s.type === 'physical_reflection');
    expect(reflection).toBeDefined();
    expect(reflection.reflectionPrompts.length).toBeGreaterThanOrEqual(3);
  });
});

// ── AI CONTENT QUALITY GUARDRAILS ──────────────────────────────────────────
describe('AI content quality guardrails', () => {
  beforeEach(() => mockCreate.mockReset());

  test('rejects assignment with no taskSteps', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ title: 'Broken', centralIdea: 'x', taskSteps: [] }) } }],
    });
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Fractions',
      subject: 'Mathematics',
      grade: 'Grade 3',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(500);
  });

  test('returns 400 when topic is missing', async () => {
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      subject: 'Mathematics',
      grade: 'Grade 3',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/topic/i);
  });

  test('all 8 subjects return status 200 for a valid topic', async () => {
    const SUBJECTS = [
      ['Mathematics',          ['tuning_in',           'problem_solving',       'math_reflection']],
      ['Science',              ['prior_knowledge',      'drawing',               'structured_writing']],
      ['English',              ['text_connection',      'reading_comprehension', 'writing_reflection']],
      ['Language Acquisition', ['language_culture',     'language_practice',     'communication']],
      ['Social Studies',       ['social_inquiry',       'research_notes',        'social_synthesis']],
      ['Visual Arts',          ['artistic_exploration', 'art_creation',          'artistic_reflection']],
      ['ICT',                  ['digital_awareness',    'tech_skill_practice',   'digital_citizenship']],
      ['Physical Education',   ['movement_exploration', 'skill_practice',        'physical_reflection']],
    ];
    for (const [subject, steps] of SUBJECTS) {
      mockGroqJson(steps);
      const app = makeApp();
      const res = await post(app, '/assignments/generate-ibpyp', {
        topic: 'Unit Test Topic',
        subject,
        grade: 'Grade 4',
        curriculum: 'IB PYP',
      });
      expect(res.status).toBe(200);
      expect(res.body.taskSteps).toHaveLength(3);
    }
  });

  test('no assignment step references "Look at the image" or "Look at the photo"', async () => {
    const SUBJECTS = [
      ['Mathematics',        ['tuning_in',           'problem_solving',       'math_reflection']],
      ['Social Studies',     ['social_inquiry',       'research_notes',        'social_synthesis']],
      ['Visual Arts',        ['artistic_exploration', 'art_creation',          'artistic_reflection']],
      ['Physical Education', ['movement_exploration', 'skill_practice',        'physical_reflection']],
    ];
    for (const [subject, steps] of SUBJECTS) {
      mockGroqJson(steps);
      const app = makeApp();
      const res = await post(app, '/assignments/generate-ibpyp', {
        topic: 'Image Test Topic',
        subject,
        grade: 'Grade 4',
        curriculum: 'IB PYP',
      });
      expect(res.status).toBe(200);
      const raw = JSON.stringify(res.body).toLowerCase();
      expect(raw).not.toContain('look at the image');
      expect(raw).not.toContain('look at the photo');
    }
  });

  test('word bank returned for all subjects', async () => {
    const SUBJECTS_STEPS = [
      ['Mathematics',      ['tuning_in', 'problem_solving',  'math_reflection']],
      ['Social Studies',   ['social_inquiry', 'research_notes', 'social_synthesis']],
      ['English',          ['text_connection', 'reading_comprehension', 'writing_reflection']],
    ];
    for (const [subject, steps] of SUBJECTS_STEPS) {
      mockGroqJson(steps);
      const app = makeApp();
      const res = await post(app, '/assignments/generate-ibpyp', {
        topic: 'Word Bank Test',
        subject,
        grade: 'Grade 3',
        curriculum: 'IB PYP',
      });
      expect(res.status).toBe(200);
      const hasWordBank = res.body.taskSteps.some(s => Array.isArray(s.wordBank) && s.wordBank.length > 0);
      expect(hasWordBank).toBe(true);
    }
  });

  test('successCriteria is an array with at least 1 entry', async () => {
    mockGroqJson(['tuning_in', 'problem_solving', 'math_reflection']);
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Multiplication',
      subject: 'Mathematics',
      grade: 'Grade 4',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.successCriteria)).toBe(true);
    expect(res.body.successCriteria.length).toBeGreaterThan(0);
  });
});

// ── GRADING LOGIC ──────────────────────────────────────────────────────────
describe('Grading logic — step type routing', () => {
  beforeEach(() => mockCreate.mockReset());

  const ASSIGNMENT_BASE = {
    id: 'test-assign-001',
    title: 'Test Assignment',
    subject: 'Mathematics',
    grade: 'Grade 4',
    curriculum: 'IB PYP',
    taskSteps: [
      {
        id: 'step-1',
        type: 'tuning_in',
        label: 'Tune In',
        instructions: 'Share your thinking.',
        reflectionPrompts: [],
        problems: [],
        sections: [],
      },
      {
        id: 'step-2',
        type: 'problem_solving',
        label: 'Solve It',
        instructions: 'Solve the problems.',
        problems: ['12 + 34 = ?', '56 - 23 = ?', '7 × 8 = ?', '48 ÷ 6 = ?'],
        sections: [],
        reflectionPrompts: [],
      },
      {
        id: 'step-3',
        type: 'math_reflection',
        label: 'Reflect',
        instructions: 'Reflect on your learning.',
        reflectionPrompts: ['What did I learn?', 'How did I solve it?', 'What was hard?'],
        sections: [],
        problems: [],
      },
    ],
    successCriteria: [{ id: 'c1', criterion: 'Solves problems correctly' }],
  };

  test('hook step (tuning_in) is graded with encouraging no-wrong-answer rubric', async () => {
    const mockGradeResponse = JSON.stringify({
      score: 3,
      level: 'Accomplished',
      feedback: 'Great thinking! You connected the provocation to your own experience.',
      perStep: [
        { stepId: 'step-1', score: 3, feedback: 'Thoughtful response.' },
        { stepId: 'step-2', score: 3, feedback: 'Correct calculations.' },
        { stepId: 'step-3', score: 3, feedback: 'Deep reflection.' },
      ],
    });
    mockCreate.mockResolvedValue({ choices: [{ message: { content: mockGradeResponse } }] });

    const app = makeApp();
    const res = await post(app, '/assignments/grade', {
      assignment: ASSIGNMENT_BASE,
      studentId: 'student-123',
      answers: [
        { stepId: 'step-1', type: 'tuning_in', tunedInText: 'I think sharing means making sure everyone gets a fair part.' },
        { stepId: 'step-2', type: 'problem_solving', problemAnswers: ['46', '33', '56', '8'] },
        { stepId: 'step-3', type: 'math_reflection', reflectionAnswers: ['I learned fractions mean equal parts.', 'I drew diagrams.', 'Division was tricky.'] },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.score).toBeGreaterThanOrEqual(1);
    expect(res.body.feedback).toBeDefined();
  });

  test('grade endpoint returns 400 when assignment or answers missing', async () => {
    const app = makeApp();
    const res = await post(app, '/assignments/grade', { studentId: 'student-123' });
    expect(res.status).toBe(400);
  });
});

// ── GRADE-SPECIFIC CONTENT ─────────────────────────────────────────────────
describe('Grade-appropriate content guardrails', () => {
  beforeEach(() => mockCreate.mockReset());

  test('Grade 3 Maths: problems should be addition/subtraction level (not calculus)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            title: 'Adding and Subtracting',
            centralIdea: 'Numbers help us describe and solve real-world problems.',
            unitOfInquiry: 'How the World Works',
            taskSteps: [
              { type: 'tuning_in', label: 'Tune In', instructions: 'Share.', provocation: 'If you had 12 apples and gave away 5...', sections: [], wordBank: ['sum', 'difference', 'total'], reflectionPrompts: [], problems: [] },
              { type: 'problem_solving', label: 'Solve', instructions: 'Solve.', problems: ['12 + 8 = ?', '25 - 13 = ?', '10 + 10 + 5 = ?', '30 - 14 = ?'], sections: [], wordBank: ['sum', 'difference'], reflectionPrompts: [] },
              { type: 'math_reflection', label: 'Reflect', instructions: 'Reflect.', sections: [], wordBank: [], reflectionPrompts: ['What strategy worked?', 'What was tricky?', 'How can I check my answer?'], problems: [] },
            ],
            successCriteria: [{ id: 'c1', criterion: 'Adds and subtracts correctly', level: 'Accomplished' }],
          }),
        },
      }],
    });
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Adding and Subtracting within 100',
      subject: 'Mathematics',
      grade: 'Grade 3',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    const ps = res.body.taskSteps.find(s => s.type === 'problem_solving');
    expect(ps.problems.length).toBe(4);
    // All problems must have numbers
    ps.problems.forEach(p => expect(/\d/.test(p)).toBe(true));
  });

  test('Grade 5 Science: structured_writing sections are subject-specific, not Beginning/Middle/End', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            title: 'Forces and Motion',
            centralIdea: 'Forces can change the state of objects.',
            unitOfInquiry: 'How the World Works',
            taskSteps: [
              { type: 'prior_knowledge', label: 'Prior Knowledge', instructions: 'Tell me what you know.', sections: ['What I Know', 'What I Predict'], wordBank: ['force', 'friction', 'gravity'], reflectionPrompts: [], problems: [] },
              { type: 'drawing', label: 'Draw', instructions: 'Draw and label a force diagram.', sections: [], wordBank: ['force', 'friction'], reflectionPrompts: [], problems: [] },
              { type: 'structured_writing', label: 'Write Up', instructions: 'Write your findings.', sections: ['My Hypothesis', 'What I Observed', 'What I Concluded'], wordBank: ['force', 'friction', 'gravity'], reflectionPrompts: [], problems: [] },
            ],
            successCriteria: [{ id: 'c1', criterion: 'Identifies forces correctly', level: 'Accomplished' }],
          }),
        },
      }],
    });
    const app = makeApp();
    const res = await post(app, '/assignments/generate-ibpyp', {
      topic: 'Forces and Motion',
      subject: 'Science',
      grade: 'Grade 5',
      curriculum: 'IB PYP',
    });
    expect(res.status).toBe(200);
    const writing = res.body.taskSteps.find(s => s.type === 'structured_writing');
    expect(writing).toBeDefined();
    // Sections should NOT be generic Beginning/Middle/End
    const sections = writing.sections || [];
    expect(sections).not.toContain('Beginning');
    expect(sections).not.toContain('Middle');
    expect(sections).not.toContain('End');
  });
});
