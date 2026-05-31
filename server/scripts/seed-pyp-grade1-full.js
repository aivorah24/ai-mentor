require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios  = require('axios');
const crypto = require('crypto');
const { embed }                       = require('../services/embeddings');
const { upsertContent, initCollection, client, COLLECTION } = require('../services/qdrant');

const GRADE      = 'Grade 1';
const CURRICULUM = 'IB_PYP';
const SEEDER_TAG = 'seed_grade1';
const IB_COLLECTION = 'ai_mentor_content';

// ─────────────────────────────────────────────────────────────────────────────
// Full IB PYP Grade 1 curriculum — age-appropriate for 5-6 year olds
// ─────────────────────────────────────────────────────────────────────────────
const TOPICS = [
  // ── MATHEMATICS ───────────────────────────────────────────
  { wiki: 'Counting',
    subject: 'Mathematics', unit: 'Number', topic: 'Counting to 100',
    desc: 'Counting means saying numbers in order. Students count objects one by one from 1 to 100, learning to count forwards and backwards. They use fingers, blocks, beads, and songs to practice. Counting helps us know how many things we have.' },

  { wiki: 'Addition',
    subject: 'Mathematics', unit: 'Number', topic: 'Addition Within 10',
    desc: 'Addition means putting things together to find how many in all. Using the plus (+) sign, students add numbers up to 10. Example: 3 + 2 = 5 means 3 apples and 2 more apples make 5 apples. Students use counters and fingers to add.' },

  { wiki: 'Subtraction',
    subject: 'Mathematics', unit: 'Number', topic: 'Subtraction Within 10',
    desc: 'Subtraction means taking away. Using the minus (-) sign, students take one number from another within 10. Example: 5 - 2 = 3 means having 5 toys and giving away 2, leaving 3. Students act out subtraction stories.' },

  { wiki: 'Number',
    subject: 'Mathematics', unit: 'Number', topic: 'Number Recognition 1-20',
    desc: 'Number recognition means knowing what each number looks like and what it stands for. Students learn to read, write, and match numbers 1 to 20 with groups of objects. They order numbers from smallest to biggest.' },

  { wiki: 'Ordinal_number',
    subject: 'Mathematics', unit: 'Number', topic: 'Ordinal Numbers',
    desc: 'Ordinal numbers tell the position or order of things: first, second, third, fourth, fifth. Students line up toys and tell which is first, which is last. Ordinal numbers help us describe order in everyday life.' },

  { wiki: 'Shape',
    subject: 'Mathematics', unit: 'Shape and Space', topic: 'Basic 2D Shapes',
    desc: 'Basic 2D shapes are flat shapes we see everywhere. Circle is round with no corners. Square has 4 equal sides and 4 corners. Triangle has 3 sides and 3 corners. Rectangle has 4 sides. Students find shapes in their classroom and outdoors.' },

  { wiki: 'Three-dimensional_space',
    subject: 'Mathematics', unit: 'Shape and Space', topic: 'Basic 3D Shapes',
    desc: '3D shapes are solid shapes you can hold. A ball is a sphere. A box is a cuboid. A can is a cylinder. An ice cream cone is a cone. Students sort and name 3D shapes found in everyday objects like dice, balls, and cans.' },

  { wiki: 'Pattern',
    subject: 'Mathematics', unit: 'Patterns', topic: 'Simple Patterns',
    desc: 'A pattern is something that repeats in a predictable way. Red-blue-red-blue is a colour pattern. Big-small-big-small is a size pattern. Students create, copy, and extend patterns using colours, shapes, sounds, and movements.' },

  { wiki: 'Comparison_(mathematics)',
    subject: 'Mathematics', unit: 'Number', topic: 'Comparing Numbers',
    desc: 'Comparing numbers means deciding which is bigger, smaller, or equal. Students use words like more than, less than, and the same as. They compare groups of objects by matching one-to-one and learn the symbols > and <.' },

  { wiki: 'Measurement',
    subject: 'Mathematics', unit: 'Measurement', topic: 'Length and Height',
    desc: 'Measurement means finding out how long, tall, or heavy something is. Students compare objects as longer, shorter, or taller. They measure using non-standard units like hand spans, pencils, and footsteps before using rulers.' },

  // ── SCIENCE ─────────────────────────────────────────────────
  { wiki: 'Sense',
    subject: 'Science', unit: 'Who We Are', topic: 'Five Senses',
    desc: 'We have five senses to explore the world: sight (eyes), hearing (ears), touch (skin), taste (tongue), and smell (nose). Students do sensory activities like guessing objects by touch or smell. Our senses help us stay safe.' },

  { wiki: 'Plant',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Plants Around Us',
    desc: 'Plants are living things that grow in soil, need water and sunlight, and make their own food. Parts of a plant include roots, stem, leaves, and flowers. Students plant seeds and watch them grow, learning plants give us food, shade, and oxygen.' },

  { wiki: 'Animal',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Animals Around Us',
    desc: 'Animals are living things that move, eat, and grow. Some live on land (dog, cat, elephant), some in water (fish, whale), and some fly (bird, butterfly). Students sort animals by where they live, what they eat, and how they move.' },

  { wiki: 'Weather',
    subject: 'Science', unit: 'How the World Works', topic: 'Weather',
    desc: 'Weather tells us what it is like outside each day: sunny, rainy, cloudy, windy, or snowy. Students observe and record daily weather using pictures. They learn how weather affects what we wear and do.' },

  { wiki: 'Water',
    subject: 'Science', unit: 'How the World Works', topic: 'Water Around Us',
    desc: 'Water is essential for all living things. We drink it, cook with it, wash with it, and play in it. Water comes from rain, rivers, lakes, and oceans. Students explore floating and sinking and learn not to waste water.' },

  { wiki: 'Human_body',
    subject: 'Science', unit: 'Who We Are', topic: 'My Body',
    desc: 'Our body has many parts that work together. Head, arms, legs, hands, and feet help us move. Eyes, ears, nose, and mouth are on our face. Students learn body part names, what each part does, and how to keep their body healthy.' },

  // ── SOCIAL STUDIES ──────────────────────────────────────────
  { wiki: 'Family',
    subject: 'Social Studies', unit: 'Who We Are', topic: 'My Family',
    desc: 'A family is a group of people who love and care for each other. Families can be big or small. Family members include parents, siblings, grandparents, aunts, and uncles. Students share about their own families and learn every family is special.' },

  { wiki: 'School',
    subject: 'Social Studies', unit: 'How We Organize Ourselves', topic: 'My School',
    desc: 'School is a place where children learn, play, and make friends. There are classrooms, a playground, a library, and a cafeteria. Teachers, helpers, and the principal work at school. Students learn school rules and how to be kind to classmates.' },

  { wiki: 'Helping_behavior',
    subject: 'Social Studies', unit: 'How We Organize Ourselves', topic: 'People Who Help Us',
    desc: 'Community helpers are people who do important jobs to help everyone. Doctors keep us healthy. Firefighters put out fires. Police officers keep us safe. Teachers help us learn. Students learn about different helpers and how to say thank you.' },

  { wiki: 'Safety',
    subject: 'Social Studies', unit: 'Who We Are', topic: 'Staying Safe',
    desc: 'Staying safe means knowing rules that protect us. Look both ways before crossing the road. Never talk to strangers. Wear a helmet when cycling. Know your home address and phone number. Students practice safety rules through role play.' },

  { wiki: 'Tradition',
    subject: 'Social Studies', unit: 'Who We Are', topic: 'Celebrations and Traditions',
    desc: 'Celebrations are special times when people come together. Birthdays, holidays, and festivals are celebrations. Different cultures have different traditions like special foods, songs, and clothes. Students share their family traditions and learn about others.' },

  // ── ENGLISH / LANGUAGE ARTS ─────────────────────────────────
  { wiki: 'Alphabet',
    subject: 'English', unit: 'Reading', topic: 'Alphabet and Letter Sounds',
    desc: 'The alphabet has 26 letters from A to Z. Each letter has a name and a sound. A says /a/ like apple. B says /b/ like ball. Students learn to recognise, name, and write all uppercase and lowercase letters and match them to their sounds.' },

  { wiki: 'Phonics',
    subject: 'English', unit: 'Reading', topic: 'Beginning Phonics',
    desc: 'Phonics teaches how letters make sounds. Students blend sounds to read simple CVC words: c-a-t = cat, d-o-g = dog. They learn consonant sounds and short vowel sounds (a, e, i, o, u). Phonics is the key to reading independently.' },

  { wiki: 'Reading',
    subject: 'English', unit: 'Reading', topic: 'Reading Simple Words',
    desc: 'Reading means understanding written words. Students start with sight words (the, is, and, I, a, to) and simple three-letter words. They read short sentences and simple picture books. Reading opens the door to all learning.' },

  { wiki: 'Writing',
    subject: 'English', unit: 'Writing', topic: 'Writing Letters and Words',
    desc: 'Writing starts with holding a pencil correctly and forming letters. Students trace and write uppercase and lowercase letters. They write their name, simple words, and short sentences like "I see a cat." Writing helps us share our ideas.' },

  { wiki: 'Narrative',
    subject: 'English', unit: 'Listening', topic: 'Listening to Stories',
    desc: 'Listening to stories helps children love reading. Students hear stories read aloud, look at pictures, and answer questions: Who is in the story? What happened? How did it end? They retell stories in their own words and act them out.' },

  { wiki: 'Rhyme',
    subject: 'English', unit: 'Reading', topic: 'Rhyming Words',
    desc: 'Rhyming words sound the same at the end: cat-hat, sun-fun, dog-log. Students listen for rhymes in songs and poems, find pairs of rhyming words, and make up their own silly rhymes. Rhyming builds reading skills.' },

  { wiki: 'Vocabulary',
    subject: 'English', unit: 'Word Study', topic: 'First Words and Labels',
    desc: 'Vocabulary means all the words a person knows. Students learn new words every day by labelling objects in the classroom: desk, chair, door, window, book. They use words to describe colours, sizes, and feelings: happy, sad, big, small.' },

  // ── ARTS ────────────────────────────────────────────────────
  { wiki: 'Drawing',
    subject: 'Arts', unit: 'Visual Arts', topic: 'Drawing and Colouring',
    desc: 'Drawing means making pictures with pencils, crayons, and markers. Students draw people, animals, houses, and nature. They learn to colour inside the lines, use different colours, and express their ideas and feelings through art.' },

  { wiki: 'Singing',
    subject: 'Arts', unit: 'Music', topic: 'Singing and Rhymes',
    desc: 'Singing is making music with your voice. Students learn nursery rhymes, action songs, and counting songs. They clap along to the beat, sing softly and loudly, and learn that music can make us happy, calm, or excited.' },

  { wiki: 'Dance',
    subject: 'Arts', unit: 'Performing Arts', topic: 'Movement and Dance',
    desc: 'Dance is moving your body to music. Students learn to move in different ways: fast, slow, high, low, round, and straight. They follow simple choreography, express emotions through movement, and perform for classmates.' },

  // ── PHYSICAL EDUCATION ──────────────────────────────────────
  { wiki: 'Motor_skill',
    subject: 'Physical Education', unit: 'Movement Skills', topic: 'Basic Movement Skills',
    desc: 'Basic movement skills include walking, running, jumping, hopping, and skipping. Students practice balancing on one foot, crawling, and climbing. These movements build coordination and strength. Active play keeps our bodies healthy and strong.' },

  { wiki: 'Catching',
    subject: 'Physical Education', unit: 'Games', topic: 'Throwing and Catching',
    desc: 'Throwing means sending a ball through the air. Catching means receiving it with your hands. Students practice underhand throws, overhand throws, and catching with two hands. These skills are used in many games and sports.' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Wikipedia helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchWikipedia(title) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'AIMentorApp/1.0 (educational project)' },
      timeout: 10000,
    });
    return data.extract || null;
  } catch { return null; }
}

async function fetchWikipediaFull(title) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=true&titles=${encodeURIComponent(title)}&format=json&exsectionformat=plain`;
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'AIMentorApp/1.0 (educational project)' },
      timeout: 12000,
    });
    const pages = data.query.pages;
    const page  = pages[Object.keys(pages)[0]];
    return page.extract || null;
  } catch { return null; }
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

function makeId(topic, chunkIdx) {
  const raw = `grade1_${topic}_${chunkIdx}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return [hash.slice(0,8), hash.slice(8,12), '4' + hash.slice(13,16), hash.slice(16,20), hash.slice(20,32)].join('-');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nIB PYP Grade 1 Full Curriculum Seeder\n');
  console.log(`   Topics: ${TOPICS.length} across ${[...new Set(TOPICS.map(t => t.subject))].length} subjects`);
  console.log(`   Vector DB: Qdrant   Embeddings: all-MiniLM-L6-v2 (384d)\n`);

  await initCollection();

  // Clear existing auto-seeded Grade 1 content
  console.log('Clearing previous seed_grade1 points...');
  try {
    await client.delete(IB_COLLECTION, {
      filter: {
        must: [
          { key: 'grade',       match: { value: GRADE      } },
          { key: 'uploaded_by', match: { value: SEEDER_TAG } },
        ],
      },
    });
    console.log('   Done.\n');
  } catch (e) {
    console.log('   (No previous seed found)\n');
  }

  let totalChunks = 0;
  let successCount = 0;

  for (let i = 0; i < TOPICS.length; i++) {
    const t = TOPICS[i];
    process.stdout.write(`[${String(i + 1).padStart(2)}/${TOPICS.length}] ${t.subject} - ${t.topic} ... `);

    let text = await fetchWikipediaFull(t.wiki);
    if (!text || text.length < 200) text = await fetchWikipedia(t.wiki);

    const combined = text
      ? `${t.desc}\n\n${text.split(/\s+/).slice(0, 1800).join(' ')}`
      : t.desc;

    const chunks = chunkText(combined);
    const points = chunks.map((chunk, ci) => ({
      id:      makeId(t.topic, ci),
      vector:  null,
      payload: {
        curriculum:   CURRICULUM,
        grade:        GRADE,
        subject:      t.subject,
        unit:         t.unit,
        topic:        t.topic,
        content_type: 'explanation',
        content:      chunk,
        description:  t.desc,
        school_id:    'demo',
        uploaded_by:  SEEDER_TAG,
        source:       `https://en.wikipedia.org/wiki/${t.wiki}`,
        ingested_at:  new Date().toISOString(),
      },
    }));

    for (const p of points) {
      p.vector = await embed(p.payload.content);
    }

    await client.upsert(IB_COLLECTION, { points, wait: true });
    totalChunks += points.length;
    successCount++;
    console.log(`${points.length} chunks`);

    await sleep(400);
  }

  console.log(`\n${successCount}/${TOPICS.length} topics seeded`);
  console.log(`Total chunks in Qdrant: ${totalChunks}`);

  const subjects = [...new Set(TOPICS.map(t => t.subject))];
  console.log('\nSubjects seeded:');
  for (const sub of subjects) {
    const count = TOPICS.filter(t => t.subject === sub).length;
    console.log(`   ${sub}: ${count} topics`);
  }
  console.log('\nDone! IB PYP Grade 1 content is ready.\n');
}

module.exports = main;

if (require.main === module) {
  main().then(() => process.exit(0)).catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
