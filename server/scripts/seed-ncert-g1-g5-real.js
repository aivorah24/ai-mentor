/**
 * seed-ncert-g1-g5-real.js
 *
 * Replaces mock NCERT G1-5 data (from seed-multi-curriculum-g1-g5-semantic.js)
 * with real, curriculum-aligned content generated via Groq LLM.
 *
 * - Deletes old mock data (uploaded_by: 'multi_curriculum_seed', curriculum: NCERT)
 * - Generates rich educational content via Groq API
 * - Embeds with all-MiniLM-L6-v2 (384-dim)
 * - Upserts to aivorah_curriculum_chunks_v1 with integer grade (matching G6-12 convention)
 *
 * Usage: node server/scripts/seed-ncert-g1-g5-real.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const crypto = require('crypto');
const { embed } = require('../services/embeddings');
const { initCollection, client, COLLECTION } = require('../services/qdrant');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL   = 'llama-3.1-8b-instant';

// ─────────────────────────────────────────────────────────────────────────────
// NCERT Classes 1-5 Real Topic Lists (aligned with actual NCERT syllabus)
// Classes 1-2: Mathematics + EVS (Environmental Studies) + English + Hindi
// Class 3-4: Mathematics + EVS + English + Hindi
// Class 5: Mathematics + Science + Social Studies + English
// ─────────────────────────────────────────────────────────────────────────────

const NCERT_TOPICS = {
  1: {
    Mathematics: [
      'Shapes and Space — Identifying basic shapes like circle, triangle, rectangle, square in surroundings',
      'Numbers from One to Nine — Counting objects, recognizing and writing numbers 1-9',
      'Addition — Adding small numbers within 9 using objects and pictures',
      'Subtraction — Taking away and finding how many are left within 9',
      'Numbers from Ten to Twenty — Understanding teen numbers as ten and some more',
      'Time — Understanding concepts of morning, afternoon, evening, days of the week',
      'Measurement — Comparing lengths, heights, and weights using non-standard units',
      'Numbers up to Fifty — Skip counting by 2s, 5s, 10s up to 50',
      'Data Handling — Collecting and recording simple data using tally marks',
      'Patterns — Recognizing and extending simple patterns with shapes, colours, and numbers',
    ],
    'Environmental Studies': [
      'My Family and Friends — Family members, roles, relationships, and caring for each other',
      'Animals Around Us — Common animals, their homes, food habits, and sounds',
      'Plants Around Us — Common plants, parts of a plant, and why plants are important',
      'Food We Eat — Different types of food, healthy eating, and where food comes from',
      'Our Body and Senses — Body parts, five senses, personal hygiene, and health habits',
      'Shelter and Clothing — Types of houses, clothing for different weather and occasions',
      'Water — Sources of water, uses of water, and importance of saving water',
      'Travel and Safety — Types of transport, road safety rules, and traffic signals',
    ],
    English: [
      'Alphabet and Letter Recognition — Learning A to Z, capital and small letters',
      'Simple Words and Phonics — Three-letter words like cat, bat, dog, sounding out letters',
      'Reading Simple Sentences — Short sentences with sight words: I, am, is, the, a',
      'Listening to Stories and Rhymes — Nursery rhymes, short stories, understanding main idea',
      'Writing My Name and Simple Words — Proper letter formation, tracing and writing',
    ],
    Hindi: [
      'Swar and Vyanjan — Hindi vowels and consonants, recognizing Devanagari letters',
      'Simple Hindi Words — Reading and writing two-letter and three-letter Hindi words',
      'Hindi Rhymes and Stories — Popular Hindi nursery rhymes like Machli Jal Ki Rani',
      'Matching Pictures and Words — Connecting pictures with Hindi words for common objects',
    ],
  },

  2: {
    Mathematics: [
      'Numbers up to Hundred — Reading, writing, comparing two-digit numbers',
      'Addition with Carrying — Adding two-digit numbers with regrouping',
      'Subtraction with Borrowing — Subtracting two-digit numbers with regrouping',
      'Shapes and Patterns — Identifying 2D and 3D shapes, symmetry, creating patterns',
      'Measurement — Measuring length in centimetres, weight in grams and kilograms',
      'Time and Calendar — Reading a clock (hours and half-hours), months, and dates',
      'Money — Identifying Indian coins and notes, simple addition of money amounts',
      'Data Handling — Reading and creating simple pictographs and bar graphs',
      'Multiplication Introduction — Understanding multiplication as repeated addition',
      'Mental Math — Quick addition and subtraction strategies, doubles, near doubles',
    ],
    'Environmental Studies': [
      'My Neighbourhood — Places near home, community helpers, local shops and services',
      'Animals and Their Young Ones — Baby animals, animal families, pet care responsibilities',
      'Plants and Their Uses — Medicinal plants, food crops, plants that give us shelter',
      'Weather and Seasons — Rainy, winter, summer seasons in India, appropriate clothing',
      'Water and Air — Clean water importance, air pollution, keeping environment clean',
      'My Body and Health — Good food habits, exercise, sleep, personal cleanliness',
      'Festivals and Celebrations — Major Indian festivals: Diwali, Eid, Christmas, Pongal, Holi',
      'Safety and First Aid — Fire safety, electrical safety, basic first aid concepts',
    ],
    English: [
      'Reading Short Stories — Understanding characters, setting, and main events',
      'Nouns and Pronouns — Naming words, he/she/it/they, singular and plural',
      'Action Words (Verbs) — Identifying action words in sentences: run, jump, eat, sleep',
      'Writing Simple Paragraphs — Three to four sentences about a topic with proper structure',
      'Comprehension Skills — Answering questions about a passage, finding details in text',
    ],
    Hindi: [
      'Hindi Matras — Vowel signs in Hindi, reading words with matras',
      'Simple Hindi Sentences — Forming sentences in Hindi with subject and verb',
      'Hindi Stories — Short stories from Rimjhim textbook, moral stories',
      'Hindi Grammar Basics — Gender in Hindi nouns, simple opposites (vilom shabd)',
    ],
  },

  3: {
    Mathematics: [
      'Numbers up to Thousand — Place value (hundreds, tens, ones), expanded form, comparison',
      'Addition and Subtraction of 3-Digit Numbers — With and without regrouping, word problems',
      'Multiplication Tables — Times tables 2 through 10, multiplication as arrays and groups',
      'Division — Sharing equally, division as inverse of multiplication, simple division facts',
      'Fractions — Understanding halves, quarters, thirds, fractions of a whole and a group',
      'Measurement — Length in metres and centimetres, weight in kg and g, capacity in litres',
      'Time — Reading clocks to 5-minute intervals, elapsed time, AM and PM',
      'Money — Making change, adding and subtracting money amounts in rupees and paise',
      'Geometry — Identifying angles, lines, curves, 2D shapes and their properties',
      'Data Handling — Collecting data, tally charts, bar graphs, interpreting simple data',
    ],
    'Environmental Studies': [
      'Food and Nutrition — Balanced diet, food groups, junk food vs healthy food',
      'Animals and Adaptation — How animals adapt to their habitat, camouflage, migration',
      'Plants and Their Parts — Root, stem, leaf, flower, fruit, seed and their functions',
      'Water Cycle and Conservation — Evaporation, condensation, precipitation, saving water',
      'Our Environment — Types of pollution, importance of trees, waste management basics',
      'Houses and Materials — Types of houses across India, building materials, kutcha vs pukka',
      'Maps and Directions — Cardinal directions, reading simple maps, symbols on maps',
      'Community and Occupations — Different jobs in a community, services people provide',
    ],
    English: [
      'Reading Comprehension — Reading passages and answering factual and inferential questions',
      'Parts of Speech — Nouns, pronouns, verbs, adjectives, and articles in sentences',
      'Story Writing — Writing short stories with beginning, middle, and end',
      'Punctuation — Full stops, question marks, exclamation marks, commas, apostrophes',
      'Vocabulary Building — Synonyms, antonyms, homophones, compound words, prefixes',
    ],
    Hindi: [
      'Hindi Reading Fluency — Reading passages from Rimjhim with correct pronunciation',
      'Hindi Grammar — Vachan (number), ling (gender), sarvanam (pronouns), visheshan (adjectives)',
      'Hindi Composition — Short paragraph writing on common topics: my school, my friend',
      'Hindi Poetry — Understanding and reciting Hindi poems, rhyme and rhythm',
      'Hindi Vocabulary — Common word meanings, muhavare (idioms) for beginners',
    ],
  },

  4: {
    Mathematics: [
      'Large Numbers — Numbers up to 10,000, Indian place value system, comparison',
      'Factors and Multiples — Finding factors, HCF basics, multiples and LCM basics',
      'Fractions — Equivalent fractions, comparing fractions, addition of like fractions',
      'Decimals — Understanding tenths and hundredths, decimal notation for money and length',
      'Geometry — Types of angles (acute, right, obtuse), parallel and perpendicular lines',
      'Perimeter and Area — Calculating perimeter of simple shapes, area of rectangle and square',
      'Patterns in Mathematics — Number patterns, growing patterns, rules for sequences',
      'Data Handling — Organizing data in tables, bar graphs, pie charts introduction',
      'Measurement — Converting between units (km-m, kg-g, L-mL), word problems',
      'Multiplication and Division — Multi-digit multiplication, long division, word problems',
    ],
    'Environmental Studies': [
      'Food and Digestion — Digestive system basics, food preservation, spices of India',
      'Water — Sources, water cycle in detail, water treatment, water scarcity in India',
      'Shelter and Architecture — Earthquake-resistant buildings, different house types in India',
      'Our Environment — Forests, deforestation effects, national parks and sanctuaries of India',
      'Transport and Communication — Evolution of transport, postal system, internet basics',
      'States of India — Major states, their capitals, languages, famous landmarks',
      'Our Earth — Continents, oceans, rotation and revolution, day and night, seasons',
      'Conservation — Endangered animals of India, tiger conservation, Project Tiger',
    ],
    English: [
      'Reading and Comprehension — Unseen passages, story elements, theme identification',
      'Tenses — Simple present, past, and future tense, correct tense usage in writing',
      'Letter Writing — Informal letters, format, greeting, body, closing',
      'Creative Writing — Diary entries, short essays, descriptive paragraphs',
      'Grammar — Prepositions, conjunctions, sentence types (declarative, interrogative)',
    ],
    Hindi: [
      'Hindi Prose — Stories from Rimjhim textbook, comprehension and summary',
      'Hindi Grammar — Kaal (tenses in Hindi), kriya (verbs), sandhi basics',
      'Hindi Essay Writing — Nibandh on topics like my favourite festival, my village',
      'Hindi Letter Writing — Informal letter format in Hindi',
      'Hindi Vocabulary Advanced — Paryayvachi (synonyms), vilom shabd (antonyms) for Class 4',
    ],
  },

  5: {
    Mathematics: [
      'Large Numbers and Operations — Numbers up to lakh, Indian and International systems',
      'Fractions and Decimals — Unlike fractions, mixed numbers, decimal operations',
      'Percentage — Understanding percentage as per hundred, simple percentage calculations',
      'Geometry — Triangles (types by sides and angles), circles (radius, diameter, circumference)',
      'Area and Volume — Area of triangle, volume of cube and cuboid, surface area basics',
      'Data Handling — Mean, mode, probability introduction, interpreting complex graphs',
      'Symmetry and Transformations — Lines of symmetry, reflection, rotation basics',
      'Number Patterns and Algebra — Variables, simple equations, pattern rules as expressions',
      'Ratio and Proportion — Understanding ratios, simple proportion problems',
      'Time, Speed, Distance — Calculating speed, distance, and time, unit conversion',
    ],
    Science: [
      'Food and Health — Nutrients, balanced diet, diseases caused by deficiency',
      'Living Things and Their Habitats — Terrestrial and aquatic habitats, adaptation',
      'Human Body Systems — Skeletal, muscular, and digestive systems overview',
      'Plants — Photosynthesis basics, germination, seed dispersal methods',
      'States of Matter — Properties of solids, liquids, gases, changes of state, evaporation',
      'Force and Energy — Types of forces, simple machines, energy forms and transformations',
      'Water — Water cycle, water purification, water harvesting, conservation',
      'Air and Weather — Composition of air, wind patterns, weather instruments',
      'Light and Shadow — Properties of light, reflection, transparent/opaque/translucent',
      'Soil and Rocks — Types of soil, soil profile, rock cycle basics',
    ],
    'Social Studies': [
      'India — Our Country — Physical features, states and UTs, national symbols',
      'Climate and Weather — Climatic zones of India, monsoons, effect on agriculture',
      'History — Ancient India — Indus Valley Civilization, Vedic age, Maurya and Gupta empires',
      'Natural Resources — Minerals, forests, wildlife, renewable vs non-renewable resources',
      'Government and Democracy — How government works, Panchayati Raj, fundamental rights',
      'Maps and Globes — Latitude and longitude, types of maps, scale and symbols',
      'Transport and Communication — Modern transport, mass media, internet and its uses',
      'Indian Culture and Heritage — Dance forms, festivals, unity in diversity',
    ],
    English: [
      'Prose and Poetry — NCERT Marigold stories and poems, comprehension and appreciation',
      'Grammar — Active and passive voice basics, direct and indirect speech introduction',
      'Essay Writing — Structured essays with introduction, body, and conclusion',
      'Story Writing — Creative stories with plot, characters, conflict, and resolution',
      'Vocabulary Advanced — Idioms, proverbs, phrasal verbs, word origins',
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Groq LLM content generation
// ─────────────────────────────────────────────────────────────────────────────

async function generateContent(grade, subject, topicLine) {
  const topicName = topicLine.split('—')[0].trim();
  const topicDesc = topicLine.includes('—') ? topicLine.split('—').slice(1).join('—').trim() : topicLine;

  const prompt = `You are an expert NCERT curriculum content writer for Indian schools. Write a clear, engaging educational explanation for Class ${grade} students on the topic "${topicName}" in ${subject}.

Topic context: ${topicDesc}

Requirements:
- Write 300-500 words of educational content
- Use simple language appropriate for Class ${grade} (age ${grade + 5}-${grade + 6})
- Include real-world Indian examples where relevant
- Cover key concepts, definitions, and important facts
- Make it engaging and student-friendly
- Do NOT use markdown formatting, just plain text paragraphs

Write the educational content now:`;

  // Retry with exponential backoff for rate limits
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 800,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.choices[0]?.message?.content?.trim() || topicDesc;
    }

    if (response.status === 429 && attempt < 3) {
      const wait = (attempt + 1) * 10000; // 10s, 20s, 30s
      process.stdout.write(`(rate limited, waiting ${wait / 1000}s) `);
      await sleep(wait);
      continue;
    }

    const errText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errText}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function deterministicUuid(input) {
  const hash = crypto.createHash('md5').update(input).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function chunkText(text, chunkSize = 250, overlap = 50) {
  const words  = text.split(/\s+/).filter(w => w.length > 0);
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length >= 80) chunks.push(chunk);
    i += chunkSize - overlap;
  }
  return chunks;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nNCERT Grades 1-5 Real Content Seeder');
  console.log('Replaces mock data with LLM-generated educational content');
  console.log('-'.repeat(60));

  if (!GROQ_API_KEY) {
    console.error('ERROR: GROQ_API_KEY not set in .env');
    process.exit(1);
  }

  await initCollection();

  // ── Step 1: Delete old mock NCERT G1-5 data from BOTH collections ──
  console.log('\nStep 1: Deleting old mock NCERT G1-5 data...');

  // Delete from ai_mentor_content (where seed-multi-curriculum seeded NCERT with string grades)
  const IB_COLLECTION = 'ai_mentor_content';
  for (let g = 1; g <= 5; g++) {
    try {
      await client.delete(IB_COLLECTION, {
        filter: {
          must: [
            { key: 'curriculum', match: { value: 'NCERT' } },
            { key: 'grade',      match: { value: `Grade ${g}` } },
            { key: 'uploaded_by', match: { value: 'multi_curriculum_seed' } },
          ],
        },
      });
      console.log(`   Deleted NCERT mock data for Grade ${g} from ${IB_COLLECTION}`);
    } catch (e) {
      console.log(`   (No mock data for Grade ${g} in ${IB_COLLECTION})`);
    }
  }

  // Also delete from aivorah_curriculum_chunks_v1 (with integer grades) in case any exist
  for (let g = 1; g <= 5; g++) {
    try {
      await client.delete(COLLECTION, {
        filter: {
          must: [
            { key: 'curriculum', match: { value: 'NCERT' } },
            { key: 'grade',      match: { value: g } },
            { key: 'uploaded_by', match: { value: 'multi_curriculum_seed' } },
          ],
        },
      });
    } catch (e) { /* ignore */ }
  }

  console.log('   Mock data cleanup complete.\n');

  // ── Step 2: Generate and ingest real content ──
  console.log('Step 2: Generating and ingesting real NCERT content...\n');

  let totalTopics = 0;
  let totalChunks = 0;
  const summary = {};

  for (let grade = 1; grade <= 5; grade++) {
    const subjects = NCERT_TOPICS[grade];
    summary[grade] = {};

    console.log(`\n${'='.repeat(50)}`);
    console.log(`  CLASS ${grade}`);
    console.log(`${'='.repeat(50)}`);

    for (const [subject, topics] of Object.entries(subjects)) {
      summary[grade][subject] = topics.length;
      console.log(`\n  ${subject} (${topics.length} topics):`);

      for (let ti = 0; ti < topics.length; ti++) {
        const topicLine = topics[ti];
        const topicName = topicLine.split('—')[0].trim();

        process.stdout.write(`    [${ti + 1}/${topics.length}] ${topicName} ... `);

        // Generate content via Groq
        let content;
        try {
          content = await generateContent(grade, subject, topicLine);
        } catch (err) {
          console.log(`GROQ ERROR: ${err.message}`);
          // Fallback to topic description
          content = topicLine.includes('—') ? topicLine.split('—').slice(1).join('—').trim() : topicLine;
        }

        // Chunk the content
        const chunks = chunkText(content);
        if (chunks.length === 0) {
          // Content too short to chunk, use as-is
          chunks.push(content);
        }

        // Build Qdrant points — store in aivorah_curriculum_chunks_v1 with integer grade
        const points = [];
        for (let ci = 0; ci < chunks.length; ci++) {
          const sourceId = `ncert-real-g${grade}-${subject.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${topicName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-c${ci}`;
          const vector = await embed(chunks[ci]);

          points.push({
            id: deterministicUuid(sourceId),
            vector,
            payload: {
              curriculum: 'NCERT',
              grade: grade,  // integer, matching G6-12 convention
              subject: subject,
              topic: topicName,
              content_type: 'explanation',
              content: chunks[ci],
              description: topicLine,
              school_id: 'default',
              uploaded_by: 'ncert_g1_g5_real_seed',
              source: 'groq_llm_generated_ncert_aligned',
              ingested_at: new Date().toISOString(),
            },
          });
        }

        // Upsert to NCERT collection
        await client.upsert(COLLECTION, { points, wait: true });
        totalChunks += points.length;
        totalTopics++;
        console.log(`${points.length} chunks`);

        // Rate limit: 8s between Groq calls (free tier: 6000 TPM)
        await sleep(8000);
      }
    }
  }

  // ── Step 3: Summary ──
  console.log('\n' + '='.repeat(60));
  console.log('  INGESTION COMPLETE');
  console.log('='.repeat(60));
  console.log(`\nTotal topics: ${totalTopics}`);
  console.log(`Total chunks: ${totalChunks}`);
  console.log(`Collection: ${COLLECTION}`);
  console.log('\nBreakdown by grade:');

  for (let grade = 1; grade <= 5; grade++) {
    const subjects = summary[grade];
    const total = Object.values(subjects).reduce((a, b) => a + b, 0);
    console.log(`  Class ${grade}: ${total} topics`);
    for (const [sub, count] of Object.entries(subjects)) {
      console.log(`    ${sub}: ${count}`);
    }
  }

  console.log('\nDone! NCERT G1-5 real content is ready.\n');
}

module.exports = main;

if (require.main === module) {
  main().then(() => process.exit(0)).catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
