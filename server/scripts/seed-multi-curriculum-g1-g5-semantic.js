/**
 * Seeds safe, original Grades 1-5 multi-curriculum semantic references into Qdrant.
 *
 * This does not scrape or store publisher textbook text. It stores teacher-created
 * topic maps, learning objectives, and original semantic notes for alignment.
 *
 * Usage:
 *   node scripts/seed-multi-curriculum-g1-g5-semantic.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const crypto = require('crypto');
const { embed } = require('../services/embeddings');
const { initCollection, upsertContent, COLLECTION } = require('../services/qdrant');

const CURRICULA = [
  'NCERT',
  'Cambridge',
  'Oxford',
  'Pearson',
  'Hodder',
  'Arrow',
  'Singapore MOE',
];

const SUBJECT_TOPICS = {
  Mathematics: {
    1: ['Counting and Number Names', 'Addition Within 20', 'Shapes Around Us', 'Measurement Basics'],
    2: ['Place Value', 'Addition and Subtraction', 'Money and Time', 'Data and Simple Graphs'],
    3: ['Multiplication Basics', 'Division Basics', 'Fractions as Equal Parts', 'Measurement and Word Problems'],
    4: ['Large Numbers', 'Factors and Multiples', 'Fractions and Decimals', 'Area and Perimeter'],
    5: ['Decimal Operations', 'Equivalent Fractions', 'Geometry and Angles', 'Volume and Data Handling'],
  },
  Science: {
    1: ['Living and Non-living Things', 'Plants Around Us', 'Animals Around Us', 'Healthy Habits'],
    2: ['Plant Needs', 'Animal Homes', 'Materials Around Us', 'Weather and Seasons'],
    3: ['Plant Parts and Functions', 'Human Body and Senses', 'Water and Its Uses', 'Forces and Movement'],
    4: ['Food Chains', 'States of Matter', 'Simple Machines', 'Earth and Natural Resources'],
    5: ['Water Cycle', 'Solar System Basics', 'Adaptations in Living Things', 'Mixtures and Solutions'],
  },
  English: {
    1: ['Phonics and Simple Words', 'Naming Words', 'Picture Reading', 'Simple Sentences'],
    2: ['Nouns and Verbs', 'Reading Short Stories', 'Describing Words', 'Writing Simple Paragraphs'],
    3: ['Pronouns and Adjectives', 'Reading Comprehension', 'Story Sequencing', 'Friendly Letters'],
    4: ['Common and Proper Nouns', 'Tenses', 'Poetry and Rhyme', 'Paragraph Organization'],
    5: ['Complex Sentences', 'Inference in Reading', 'Creative Writing', 'Opinion Writing'],
  },
  'Social Studies': {
    1: ['My Family', 'My School', 'People Who Help Us', 'Good Manners'],
    2: ['My Neighbourhood', 'Maps and Directions', 'Festivals and Culture', 'Safety Rules'],
    3: ['Community Helpers', 'Natural Resources', 'Local Government Basics', 'Transport and Communication'],
    4: ['Landforms and Water Bodies', 'Indian States and Regions', 'Civic Responsibilities', 'Local History'],
    5: ['Continents and Oceans', 'Early Civilisations', 'Democracy Basics', 'Trade and Resources'],
  },
};

const BLOOM_BY_GRADE = {
  1: 'remember',
  2: 'understand',
  3: 'understand',
  4: 'apply',
  5: 'apply',
};

function deterministicUuid(input) {
  const hash = crypto.createHash('md5').update(input).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function sourceStatus(curriculum) {
  return curriculum === 'NCERT' ? 'open_or_official_reference' : 'processed_reference';
}

function learningObjective(grade, subject, topic) {
  const verb = grade <= 2 ? 'recognize and describe' : grade <= 4 ? 'explain and apply' : 'analyze and apply';
  return `Learners will ${verb} key ideas in ${topic} for Grade ${grade} ${subject}.`;
}

function semanticNote({ curriculum, grade, subject, topic }) {
  const alignment = curriculum === 'NCERT'
    ? 'This note aligns with open or official NCERT-style primary learning expectations.'
    : `This note is an original ${curriculum} curriculum-alignment reference and does not copy publisher textbook wording.`;

  return [
    `${topic} is introduced for Grade ${grade} ${subject} through simple examples, guided questions, and age-appropriate vocabulary.`,
    `Learners build conceptual understanding before moving to practice. Teachers can connect the idea to classroom objects, everyday situations, drawings, oral discussion, and short written responses.`,
    `The expected outcome is that a child can state the main idea, use the correct basic terms, solve or explain a simple example, and answer one or two questions independently.`,
    alignment,
  ].join(' ');
}

function buildRecords() {
  const records = [];
  for (const curriculum of CURRICULA) {
    for (let grade = 1; grade <= 5; grade += 1) {
      for (const [subject, topicsByGrade] of Object.entries(SUBJECT_TOPICS)) {
        for (const topic of topicsByGrade[grade]) {
          const sourceId = [
            'semantic',
            curriculum.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            `g${grade}`,
            subject.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            topic.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          ].join('-');

          records.push({
            id: deterministicUuid(sourceId),
            curriculum,
            grade: `Grade ${grade}`,
            grade_number: grade,
            subject,
            topic,
            unit: `${subject} Grade ${grade} Topic Map`,
            content: semanticNote({ curriculum, grade, subject, topic }),
            learning_objective: learningObjective(grade, subject, topic),
            difficulty: grade <= 2 ? 'easy' : grade <= 4 ? 'medium' : 'medium',
            bloom_taxonomy: BLOOM_BY_GRADE[grade],
            content_type: 'semantic_reference',
            source_type: 'teacher_created_semantic_note',
            license_status: sourceStatus(curriculum),
            source_reference: curriculum === 'NCERT'
              ? 'official/open curriculum reference or teacher-created semantic note'
              : 'teacher-created topic map / anonymized semantic reference; not textbook text',
            school_id: 'default',
            uploaded_by: 'multi_curriculum_seed',
            ingested_at: new Date().toISOString(),
          });
        }
      }
    }
  }
  return records;
}

async function run() {
  console.log('\nMulti-curriculum Grades 1-5 semantic seed');
  console.log('Policy: original semantic references only; no scraped publisher textbook text.');
  console.log('-'.repeat(72));

  await initCollection();

  const records = buildRecords();
  const batchSize = Number(process.env.SEED_BATCH_SIZE || 32);
  let total = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const points = [];

    for (const record of batch) {
      const vectorText = [
        record.curriculum,
        record.grade,
        record.subject,
        record.topic,
        record.learning_objective,
        record.content,
      ].join('\n');

      points.push({
        id: record.id,
        vector: await embed(vectorText),
        payload: record,
      });
    }

    await upsertContent(points);
    total += points.length;
    console.log(`Seeded ${total}/${records.length} records`);
  }

  console.log('-'.repeat(72));
  console.log(`Completed seeding ${total} semantic references into Qdrant collection: ${COLLECTION}`);
}

run().catch((err) => {
  console.error('Fatal seed error:', err);
  process.exit(1);
});

