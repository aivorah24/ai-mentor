require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios  = require('axios');
const crypto = require('crypto');
const { embed }                       = require('../services/embeddings');
const { upsertContent, initCollection, client, COLLECTION } = require('../services/qdrant');

const GRADE      = 'Grade 2';
const CURRICULUM = 'IB_PYP';
const SEEDER_TAG = 'seed_grade2';
const IB_COLLECTION = 'ai_mentor_content';

// ─────────────────────────────────────────────────────────────────────────────
// Full IB PYP Grade 2 curriculum — age-appropriate for 6-7 year olds
// ─────────────────────────────────────────────────────────────────────────────
const TOPICS = [
  // ── MATHEMATICS ───────────────────────────────────────────
  { wiki: 'Addition',
    subject: 'Mathematics', unit: 'Number', topic: 'Addition Within 20',
    desc: 'Addition within 20 means combining two numbers where the answer is 20 or less. Students use number lines, ten frames, and counters. They learn to make 10 first: 8 + 5 = 8 + 2 + 3 = 10 + 3 = 13. This is called bridging through 10.' },

  { wiki: 'Subtraction',
    subject: 'Mathematics', unit: 'Number', topic: 'Subtraction Within 20',
    desc: 'Subtraction within 20 means taking away when both numbers are 20 or less. Students count back on number lines and use fact families: if 7 + 5 = 12, then 12 - 5 = 7. They solve word problems like "I had 15 stickers and gave away 6."' },

  { wiki: 'Positional_notation',
    subject: 'Mathematics', unit: 'Number', topic: 'Place Value to 100',
    desc: 'Place value means the position of a digit tells its value. In the number 47, the 4 is in the tens place (40) and the 7 is in the ones place (7). Students use base-ten blocks to build, read, and compare two-digit numbers up to 100.' },

  { wiki: 'Skip_counting',
    subject: 'Mathematics', unit: 'Number', topic: 'Skip Counting',
    desc: 'Skip counting means counting by 2s, 5s, or 10s instead of by 1. Counting by 2s: 2, 4, 6, 8, 10. By 5s: 5, 10, 15, 20. By 10s: 10, 20, 30. Skip counting helps with multiplication later and counting large groups of objects quickly.' },

  { wiki: 'Parity_(mathematics)',
    subject: 'Mathematics', unit: 'Number', topic: 'Odd and Even Numbers',
    desc: 'Even numbers can be split into two equal groups: 2, 4, 6, 8, 10. Odd numbers always have one left over: 1, 3, 5, 7, 9. Students pair objects to test even or odd. All even numbers end in 0, 2, 4, 6, or 8.' },

  { wiki: 'Time',
    subject: 'Mathematics', unit: 'Measurement', topic: 'Telling Time',
    desc: 'Telling time means reading a clock. The short hand shows the hour, the long hand shows minutes. Students learn o\'clock (12:00) and half past (12:30). They connect time to daily routines: breakfast at 7:00, school at 8:00, bedtime at 8:30.' },

  { wiki: 'Money',
    subject: 'Mathematics', unit: 'Measurement', topic: 'Money Basics',
    desc: 'Money is used to buy things. Coins have different values: 1 rupee, 2 rupees, 5 rupees, 10 rupees. Notes include 10, 20, 50, 100. Students count coins, compare prices, and play shop games to practice adding money amounts.' },

  { wiki: 'Length',
    subject: 'Mathematics', unit: 'Measurement', topic: 'Measuring Length',
    desc: 'Length tells how long something is. Students measure using non-standard units like paper clips and hand spans, then learn centimetres with a ruler. They estimate before measuring and compare: "The desk is 60 cm, the book is 25 cm, so the desk is longer."' },

  { wiki: 'Polygon',
    subject: 'Mathematics', unit: 'Shape and Space', topic: '2D Shapes and Properties',
    desc: 'Students explore 2D shapes in more detail. They count sides and corners: triangle (3 sides), rectangle (4 sides, opposite sides equal), pentagon (5 sides), hexagon (6 sides). They identify shapes in the environment and create shape pictures.' },

  { wiki: 'Symmetry',
    subject: 'Mathematics', unit: 'Shape and Space', topic: 'Lines of Symmetry',
    desc: 'A line of symmetry divides a shape into two identical halves. A heart has one line of symmetry. A square has four. Students fold shapes to find symmetry lines, draw the other half of symmetrical pictures, and find symmetry in nature (butterflies, leaves).' },

  { wiki: 'Bar_chart',
    subject: 'Mathematics', unit: 'Data Handling', topic: 'Pictographs and Bar Graphs',
    desc: 'Graphs help us show and understand information. A pictograph uses pictures to represent data. A bar graph uses bars of different heights. Students collect data (favourite fruits, pets), create graphs, and answer questions about them.' },

  { wiki: 'Fraction',
    subject: 'Mathematics', unit: 'Number', topic: 'Introduction to Halves and Quarters',
    desc: 'A half means splitting something into 2 equal parts and taking 1. A quarter means splitting into 4 equal parts and taking 1. Students fold paper, cut shapes, and share food equally. Half of 8 is 4. A quarter of 8 is 2.' },

  // ── SCIENCE ─────────────────────────────────────────────────
  { wiki: 'Plant',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Plant Needs and Growth',
    desc: 'Plants need water, sunlight, air, and soil to grow. Seeds germinate (sprout) when conditions are right. Students plant beans in cups, observe growth over weeks, and learn what happens when plants don\'t get enough light or water.' },

  { wiki: 'Animal',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Animal Habitats',
    desc: 'A habitat is where an animal lives and finds food, water, and shelter. Forest animals include deer and owls. Ocean animals include fish and dolphins. Desert animals include camels and lizards. Students match animals to their habitats.' },

  { wiki: 'Life_cycle',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Life Cycles',
    desc: 'A life cycle shows how a living thing grows and changes. A butterfly: egg, caterpillar, chrysalis, butterfly. A frog: egg, tadpole, froglet, frog. A plant: seed, sprout, plant, flower, seed. Students draw and label life cycle diagrams.' },

  { wiki: 'Material',
    subject: 'Science', unit: 'How the World Works', topic: 'Materials Around Us',
    desc: 'Everything is made of materials. Wood is hard and comes from trees. Plastic is light and waterproof. Metal is strong and shiny. Glass is transparent and fragile. Students sort objects by material and test properties like hardness and flexibility.' },

  { wiki: 'Force',
    subject: 'Science', unit: 'How the World Works', topic: 'Pushes and Pulls',
    desc: 'A push moves something away from you. A pull brings something towards you. Opening a door is a pull. Kicking a ball is a push. Forces make things start, stop, speed up, slow down, or change direction. Students explore forces with toys and ramps.' },

  { wiki: 'State_of_matter',
    subject: 'Science', unit: 'How the World Works', topic: 'Solids, Liquids, and Gases',
    desc: 'Matter comes in three forms. Solids keep their shape (ice, wood, rock). Liquids flow and take the shape of their container (water, juice, milk). Gases spread out to fill any space (air, steam). Heating and cooling can change one form to another.' },

  { wiki: 'Season',
    subject: 'Science', unit: 'How the World Works', topic: 'Seasons and Weather',
    desc: 'There are four seasons: spring (flowers bloom), summer (hot and sunny), autumn (leaves fall), and winter (cold, sometimes snow). Weather changes each day. Students keep a weather journal and observe how seasons affect plants and animals.' },

  { wiki: 'Recycling',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Caring for Earth',
    desc: 'We must take care of our planet. Reduce means using less. Reuse means using things again. Recycle means turning old things into new ones. Students learn to sort waste, save water, turn off lights, and plant trees to help the Earth.' },

  // ── SOCIAL STUDIES ──────────────────────────────────────────
  { wiki: 'Neighbourhood',
    subject: 'Social Studies', unit: 'Where We Are in Place and Time', topic: 'My Neighbourhood',
    desc: 'A neighbourhood is the area around your home. It has houses, shops, parks, and roads. Students explore their neighbourhood, draw maps, identify important places (hospital, post office, fire station), and learn about the people who live nearby.' },

  { wiki: 'Map',
    subject: 'Social Studies', unit: 'Where We Are in Place and Time', topic: 'Simple Maps',
    desc: 'A map is a drawing that shows where things are. Students draw maps of their classroom, school, and neighbourhood. They learn basic directions: up is north, down is south, left is west, right is east. Maps help us find our way.' },

  { wiki: 'Culture',
    subject: 'Social Studies', unit: 'Who We Are', topic: 'Festivals Around the World',
    desc: 'People around the world celebrate different festivals. Diwali has lights and sweets. Christmas has trees and gifts. Eid has prayers and feasts. Chinese New Year has dragons and lanterns. Students share their own festival traditions.' },

  { wiki: 'Rule_of_law',
    subject: 'Social Studies', unit: 'How We Organize Ourselves', topic: 'Rules and Responsibilities',
    desc: 'Rules help everyone stay safe and get along. Home rules: tidy up your toys. School rules: listen to the teacher, be kind. Road rules: cross at the zebra crossing. Students discuss why rules matter and create class rules together.' },

  { wiki: 'Transport',
    subject: 'Social Studies', unit: 'How the World Works', topic: 'Types of Transport',
    desc: 'Transport takes people and things from place to place. Land transport: cars, buses, trains, bicycles. Water transport: boats, ships, ferries. Air transport: aeroplanes, helicopters. Students sort vehicles and discuss which is best for different journeys.' },

  { wiki: 'Need',
    subject: 'Social Studies', unit: 'How We Organize Ourselves', topic: 'Needs and Wants',
    desc: 'Needs are things we must have to live: food, water, shelter, clothing. Wants are things we would like but don\'t need: toys, candy, games. Students sort pictures into needs and wants and learn to make smart choices about spending.' },

  // ── ENGLISH / LANGUAGE ARTS ─────────────────────────────────
  { wiki: 'Phonics',
    subject: 'English', unit: 'Reading', topic: 'Phonics and Blending',
    desc: 'Phonics helps students read by blending sounds. Consonant blends: bl, cr, st, tr. Digraphs: sh, ch, th, wh. Long vowels: a_e (cake), i_e (bike), o_e (home). Students practice sounding out new words and reading simple sentences fluently.' },

  { wiki: 'Sight_word',
    subject: 'English', unit: 'Reading', topic: 'Sight Words',
    desc: 'Sight words are common words students recognise instantly: the, and, is, was, you, they, said, have, are, were. Learning sight words helps reading become smooth and fast. Students practice with flashcards, games, and word walls.' },

  { wiki: 'Reading_comprehension',
    subject: 'English', unit: 'Reading', topic: 'Reading and Understanding',
    desc: 'Reading comprehension means understanding what you read. Students read short stories and answer: Who are the characters? Where does it happen? What is the problem? How is it solved? They retell stories and make predictions about what happens next.' },

  { wiki: 'Noun',
    subject: 'English', unit: 'Grammar', topic: 'Nouns and Verbs',
    desc: 'A noun is a naming word for people (teacher, girl), places (school, park), and things (ball, book). A verb is an action word that tells what someone does: run, jump, eat, sleep, read. Students find nouns and verbs in sentences and pictures.' },

  { wiki: 'Sentence_(linguistics)',
    subject: 'English', unit: 'Writing', topic: 'Writing Sentences',
    desc: 'A sentence is a group of words that tells a complete thought. It starts with a capital letter and ends with a full stop, question mark, or exclamation mark. Students write sentences about their day, their family, and stories they create.' },

  { wiki: 'Adjective',
    subject: 'English', unit: 'Grammar', topic: 'Describing Words',
    desc: 'Describing words (adjectives) tell more about nouns. They describe size (big, tiny), colour (red, blue), feeling (happy, scared), texture (soft, rough), and taste (sweet, sour). "The fluffy white cat" uses two describing words.' },

  { wiki: 'Narrative',
    subject: 'English', unit: 'Writing', topic: 'Story Writing',
    desc: 'A story has a beginning, middle, and end. The beginning introduces characters and setting. The middle has a problem or adventure. The end shows how it is solved. Students write their own short stories with pictures and share them with the class.' },

  { wiki: 'Spelling',
    subject: 'English', unit: 'Word Study', topic: 'Spelling Patterns',
    desc: 'Spelling patterns help us write words correctly. CVC words: cat, hop, fun. CVCE words: cake, time, bone (silent e makes the vowel long). Double letters: ball, egg, add. Students practice spelling with games, word sorts, and weekly lists.' },

  // ── ARTS ────────────────────────────────────────────────────
  { wiki: 'Color_theory',
    subject: 'Arts', unit: 'Visual Arts', topic: 'Colours and Mixing',
    desc: 'Primary colours are red, blue, and yellow. Mixing two primary colours makes a secondary colour: red + blue = purple, red + yellow = orange, blue + yellow = green. Students experiment with paint mixing and create colourful artwork.' },

  { wiki: 'Rhythm',
    subject: 'Arts', unit: 'Music', topic: 'Rhythm and Instruments',
    desc: 'Rhythm is a pattern of sounds in music. Students clap, tap, and play simple instruments like drums, triangles, maracas, and xylophones. They learn loud (forte) and soft (piano), fast and slow, and follow along with musical patterns.' },

  { wiki: 'Collage',
    subject: 'Arts', unit: 'Visual Arts', topic: 'Craft and Collage',
    desc: 'Collage means making pictures by cutting and gluing different materials: paper, fabric, buttons, leaves, and magazines. Students create collage artwork about topics they are studying. Craft projects develop fine motor skills and creativity.' },

  // ── PHYSICAL EDUCATION ──────────────────────────────────────
  { wiki: 'Motor_skill',
    subject: 'Physical Education', unit: 'Movement Skills', topic: 'Locomotor Skills',
    desc: 'Locomotor skills move the body from one place to another. Running, hopping, skipping, galloping, sliding, and leaping are locomotor skills. Students practice these through obstacle courses, relay races, and movement games to build coordination.' },

  { wiki: 'Ball_game',
    subject: 'Physical Education', unit: 'Games', topic: 'Ball Skills and Games',
    desc: 'Ball skills include throwing, catching, bouncing, kicking, and rolling. Students practice with different sized balls. They play cooperative games where everyone works together and learn simple rules, taking turns, and being a good sport.' },
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
  const raw = `grade2_${topic}_${chunkIdx}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return [hash.slice(0,8), hash.slice(8,12), '4' + hash.slice(13,16), hash.slice(16,20), hash.slice(20,32)].join('-');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nIB PYP Grade 2 Full Curriculum Seeder\n');
  console.log(`   Topics: ${TOPICS.length} across ${[...new Set(TOPICS.map(t => t.subject))].length} subjects`);
  console.log(`   Vector DB: Qdrant   Embeddings: all-MiniLM-L6-v2 (384d)\n`);

  await initCollection();

  // Clear existing auto-seeded Grade 2 content
  console.log('Clearing previous seed_grade2 points...');
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
  console.log('\nDone! IB PYP Grade 2 content is ready.\n');
}

module.exports = main;

if (require.main === module) {
  main().then(() => process.exit(0)).catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
