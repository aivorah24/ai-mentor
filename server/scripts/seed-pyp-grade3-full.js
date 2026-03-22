require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios  = require('axios');
const crypto = require('crypto');
const { embed }                       = require('../services/embeddings');
const { upsertContent, initCollection, client, COLLECTION } = require('../services/qdrant');

const GRADE      = 'Grade 3';
const CURRICULUM = 'IB_PYP';
const SEEDER_TAG = 'seed_grade3';       // identifies auto-seeded points for safe re-seed

// ─────────────────────────────────────────────────────────────────────────────
// Full IB PYP Grade 3 curriculum — all subjects
// wiki   : Wikipedia article title  (used as primary content source)
// desc   : Fallback description if Wikipedia fetch fails (also appended for richer context)
// ─────────────────────────────────────────────────────────────────────────────
const TOPICS = [
  // ── MATHEMATICS ───────────────────────────────────────────────
  { wiki: 'Addition',
    subject: 'Mathematics', unit: 'Number', topic: 'Addition',
    desc: 'Addition combines numbers to find a total using the plus (+) sign. Students count objects, use number lines, and learn to add with carrying (regrouping). Real-life examples include adding apples in a basket.' },

  { wiki: 'Subtraction',
    subject: 'Mathematics', unit: 'Number', topic: 'Subtraction',
    desc: 'Subtraction takes one number away from another using the minus (−) sign. Students count back, use number lines, and learn borrowing. Example: 7 − 3 = 4 is like having 7 cookies and eating 3.' },

  { wiki: 'Multiplication',
    subject: 'Mathematics', unit: 'Number', topic: 'Multiplication',
    desc: 'Multiplication is repeated addition using the times (×) sign. 3 × 4 = 12 means adding 3 four times. Students learn times tables for 2, 3, 4, 5, and 10 through songs, arrays, and real-life grouping.' },

  { wiki: 'Division_(mathematics)',
    subject: 'Mathematics', unit: 'Number', topic: 'Division',
    desc: 'Division shares objects equally using the divide (÷) sign. 12 ÷ 3 = 4 means sharing 12 into 3 equal groups. Students solve sharing and grouping problems using counters and number lines.' },

  { wiki: 'Positional_notation',
    subject: 'Mathematics', unit: 'Number', topic: 'Place Value',
    desc: 'Place value means a digit\'s value depends on its position. In 345: the 3 means 300 (hundreds), 4 means 40 (tens), 5 means 5 (ones). Students use base-ten blocks to build and compare three-digit numbers.' },

  { wiki: 'Fraction',
    subject: 'Mathematics', unit: 'Number', topic: 'Introduction to Fractions',
    desc: 'Fractions represent equal parts of a whole. One half (½) = 1 of 2 equal parts. Quarter (¼) = 1 of 4 equal parts. Students fold shapes, share food, and use fraction walls to understand equal parts.' },

  { wiki: 'Time',
    subject: 'Mathematics', unit: 'Measurement', topic: 'Telling Time',
    desc: 'Telling time means reading analog and digital clocks. Students learn hours, half-hours, quarter-hours, and 5-minute intervals. They understand AM/PM, use calendars, and solve elapsed-time problems.' },

  { wiki: 'Length',
    subject: 'Mathematics', unit: 'Measurement', topic: 'Length and Distance',
    desc: 'Length measures how long or tall something is using centimetres (cm), metres (m), and kilometres (km). Students measure objects with rulers, estimate lengths, compare measurements, and convert units.' },

  { wiki: 'Mass',
    subject: 'Mathematics', unit: 'Measurement', topic: 'Mass and Weight',
    desc: 'Mass measures how heavy an object is using grams (g) and kilograms (kg). Students use balance scales and digital scales, compare masses, and solve word problems involving weighing real objects.' },

  { wiki: 'Money',
    subject: 'Mathematics', unit: 'Measurement', topic: 'Money and Change',
    desc: 'Money is used to buy things. Students identify coins and notes, count money, add prices, calculate change, and practise real shopping scenarios. Understanding money builds number sense and real-world maths.' },

  { wiki: 'Polygon',
    subject: 'Mathematics', unit: 'Shape and Space', topic: '2D Shapes',
    desc: '2D shapes are flat and have length and width. Triangle: 3 sides. Square: 4 equal sides. Rectangle: 4 sides, 2 pairs equal. Pentagon: 5 sides. Hexagon: 6 sides. Students sort shapes by sides and corners.' },

  { wiki: 'Three-dimensional_space',
    subject: 'Mathematics', unit: 'Shape and Space', topic: '3D Shapes',
    desc: '3D shapes are solid and have faces, edges, and vertices. Cube: 6 square faces. Sphere: 1 curved surface. Cylinder: 2 circular faces. Cone: 1 circular base, 1 apex. Students build 3D models from nets.' },

  { wiki: 'Symmetry',
    subject: 'Mathematics', unit: 'Shape and Space', topic: 'Symmetry',
    desc: 'Symmetry means a shape looks the same on both sides of a fold line. A square has 4 lines of symmetry. Students find symmetry in shapes, letters (A, H, M), butterflies, and architecture by folding and mirroring.' },

  { wiki: 'Perimeter',
    subject: 'Mathematics', unit: 'Shape and Space', topic: 'Perimeter',
    desc: 'Perimeter is the distance around the outside of a shape. Add all side lengths: a rectangle 4cm × 3cm has perimeter 4+3+4+3 = 14cm. Students measure classroom objects and design shapes with given perimeters.' },

  { wiki: 'Bar_chart',
    subject: 'Mathematics', unit: 'Data Handling', topic: 'Graphs and Data',
    desc: 'Data handling means collecting, displaying, and reading information. Students create and interpret bar graphs, pictographs, and tally charts. They ask questions, gather data from classmates, and draw conclusions.' },

  { wiki: 'Arithmetic_progression',
    subject: 'Mathematics', unit: 'Patterns and Algebra', topic: 'Number Patterns',
    desc: 'Number patterns follow a rule. Skip counting by 2s: 2, 4, 6, 8. By 5s: 5, 10, 15, 20. Students find rules in sequences, continue patterns, identify odd/even numbers, and create their own number sequences.' },

  // ── SCIENCE ─────────────────────────────────────────────────
  { wiki: 'Food_chain',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Food Chains',
    desc: 'A food chain shows the flow of energy from one living thing to another. Plants (producers) make food from sunlight. Herbivores (primary consumers) eat plants. Carnivores eat animals. Energy moves up the chain.' },

  { wiki: 'Plant',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Plant Life Cycles',
    desc: 'Plants grow from seeds through germination (sprouting), seedling, young plant, mature plant, flowering, and seed production. Students plant seeds, observe growth stages, and learn how plants need sunlight, water, and soil.' },

  { wiki: 'Biological_life_cycle',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Animal Life Cycles',
    desc: 'Life cycles describe how animals grow, change, reproduce, and die. Butterfly: egg → caterpillar → chrysalis → butterfly (complete metamorphosis). Frog: egg → tadpole → froglet → frog. Students compare and draw life cycles.' },

  { wiki: 'Habitat',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Habitats and Ecosystems',
    desc: 'A habitat is an animal\'s natural home providing food, water, shelter, and space. Desert animals adapt to heat and dryness. Rainforest animals need moisture and warmth. Students match animals to their habitats.' },

  { wiki: 'State_of_matter',
    subject: 'Science', unit: 'How the World Works', topic: 'States of Matter',
    desc: 'Matter exists as solid (fixed shape and volume), liquid (flows, no fixed shape), or gas (fills any container). Water is ice (solid), liquid water, and steam (gas). Heating and cooling cause changes of state.' },

  { wiki: 'Magnet',
    subject: 'Science', unit: 'How the World Works', topic: 'Magnets',
    desc: 'Magnets attract magnetic materials (iron, steel, nickel) and have two poles: north and south. Opposite poles attract, same poles repel. Students test magnetic vs non-magnetic materials and make simple compasses.' },

  { wiki: 'Light',
    subject: 'Science', unit: 'How the World Works', topic: 'Light and Shadow',
    desc: 'Light travels in straight lines from sources like the sun, fire, and bulbs. Opaque objects block light and form shadows. Transparent materials let light through. Shadow size changes as light source position changes.' },

  { wiki: 'Sound',
    subject: 'Science', unit: 'How the World Works', topic: 'Sound',
    desc: 'Sound is produced when objects vibrate and travels as waves through air to our ears. Loud sounds have large amplitude. High-pitched sounds have high frequency. Students create sounds and explore how materials affect sound travel.' },

  { wiki: 'Water_cycle',
    subject: 'Science', unit: 'How the World Works', topic: 'Water Cycle',
    desc: 'The water cycle continuously moves water. Evaporation: sun heats water, turning it to vapour. Condensation: vapour cools and forms clouds. Precipitation: water falls as rain, snow, or hail. Runoff returns water to oceans and rivers.' },

  { wiki: 'Season',
    subject: 'Science', unit: 'How the World Works', topic: 'Weather and Seasons',
    desc: 'Weather describes daily atmospheric conditions: temperature, cloud cover, wind, and precipitation. The four seasons (spring, summer, autumn, winter) result from Earth\'s tilted axis. Students keep weather journals and read thermometers.' },

  { wiki: 'Soil',
    subject: 'Science', unit: 'How the World Works', topic: 'Soil and Rocks',
    desc: 'Soil is a mixture of rock particles, humus (dead organic matter), water, air, and organisms. The three main rock types are igneous (from magma), sedimentary (from layers), and metamorphic (from heat and pressure).' },

  // ── SOCIAL STUDIES ──────────────────────────────────────────
  { wiki: 'Map',
    subject: 'Social Studies', unit: 'Where We Are in Place and Time', topic: 'Maps and Globes',
    desc: 'A map is a flat representation of a place viewed from above. A globe is a round 3D model of Earth. Maps have a key (legend) explaining symbols, a compass rose showing directions, and a scale for real distances.' },

  { wiki: 'Cardinal_direction',
    subject: 'Social Studies', unit: 'Where We Are in Place and Time', topic: 'Cardinal Directions',
    desc: 'The four cardinal directions are North, South, East, and West. Intermediate directions are Northeast, Northwest, Southeast, Southwest. A compass needle always points north. Students use compass roses to navigate maps.' },

  { wiki: 'Landform',
    subject: 'Social Studies', unit: 'Where We Are in Place and Time', topic: 'Landforms and Bodies of Water',
    desc: 'Landforms are natural features of the Earth\'s surface: mountains (high peaks), valleys (low areas between mountains), plains (flat land), deserts (very dry), hills. Bodies of water include oceans, lakes, rivers, and bays.' },

  { wiki: 'Community',
    subject: 'Social Studies', unit: 'How We Organize Ourselves', topic: 'Communities',
    desc: 'A community is a group of people living or working together in the same area. Urban communities are in cities with tall buildings. Rural communities are in the countryside. Suburban communities are near cities. All communities have shared services.' },

  { wiki: 'Need',
    subject: 'Social Studies', unit: 'How We Organize Ourselves', topic: 'Needs and Wants',
    desc: 'Needs are necessities for survival: food, water, shelter, clothing. Wants are desires but not essential: toys, games, sweets. People must prioritise needs over wants. Understanding this helps with making good choices about money.' },

  { wiki: 'Goods_and_services',
    subject: 'Social Studies', unit: 'How We Organize Ourselves', topic: 'Goods and Services',
    desc: 'Goods are physical products you can touch and own: food, clothes, furniture, books. Services are actions performed for others: teaching, medical care, police, transport. Communities depend on the exchange of goods and services.' },

  { wiki: 'Tradition',
    subject: 'Social Studies', unit: 'Who We Are', topic: 'Cultural Traditions',
    desc: 'Cultural traditions are customs, beliefs, festivals, foods, music, and stories passed down through generations. Different cultures celebrate unique holidays and have distinct ways of dress, cooking, and art. Diversity enriches communities.' },

  { wiki: 'Timeline',
    subject: 'Social Studies', unit: 'Where We Are in Place and Time', topic: 'Timelines and History',
    desc: 'A timeline displays events in chronological order from past to present. The past has already happened, the present is now, and the future is yet to come. Students create personal timelines and study community and world history events.' },

  // ── ENGLISH / LANGUAGE ARTS ─────────────────────────────────
  { wiki: 'Phonics',
    subject: 'English', unit: 'Reading', topic: 'Phonics and Decoding',
    desc: 'Phonics teaches the relationships between letters and sounds. Students learn consonant blends (bl, cr, str), digraphs (ch, sh, th), vowel patterns (ai, ea, oo), and silent letters to decode and spell unfamiliar words independently.' },

  { wiki: 'Reading_comprehension',
    subject: 'English', unit: 'Reading', topic: 'Reading Comprehension',
    desc: 'Reading comprehension is understanding and making meaning from texts. Students identify main idea and supporting details, make predictions, distinguish fact from opinion, find cause and effect, and make inferences from fiction and non-fiction.' },

  { wiki: 'Narrative',
    subject: 'English', unit: 'Writing', topic: 'Narrative Writing',
    desc: 'Narrative writing tells a story with a beginning (introduce characters and setting), middle (problem and events), and end (resolution). Students use descriptive language, dialogue, and story structure to engage their readers.' },

  { wiki: 'Expository_writing',
    subject: 'English', unit: 'Writing', topic: 'Informational Writing',
    desc: 'Informational writing explains facts about a topic. It includes an introduction, body paragraphs with facts and examples, and a conclusion. Students research, take notes, use text features (headings, diagrams), and write with an objective voice.' },

  { wiki: 'Noun',
    subject: 'English', unit: 'Grammar', topic: 'Nouns and Pronouns',
    desc: 'Nouns name people (teacher, Emma), places (school, London), things (book, table), or ideas (friendship, happiness). Common nouns are general; proper nouns are specific and capitalised. Pronouns (he, she, they, it) replace nouns in sentences.' },

  { wiki: 'Verb',
    subject: 'English', unit: 'Grammar', topic: 'Verbs and Tenses',
    desc: 'Verbs express actions or states. Past tense: ran, wrote, was. Present tense: runs, writes, is. Future tense: will run, will write. Students identify verbs in sentences, practise correct tense agreement, and use powerful action verbs in writing.' },

  { wiki: 'Adjective',
    subject: 'English', unit: 'Grammar', topic: 'Adjectives and Describing Words',
    desc: 'Adjectives describe nouns by telling size (huge, tiny), colour (scarlet, navy), shape (oval, jagged), texture (silky, rough), quantity (several, few), and quality (magnificent, dreadful). Students use adjectives to create vivid, detailed writing.' },

  { wiki: 'Punctuation',
    subject: 'English', unit: 'Grammar', topic: 'Punctuation',
    desc: 'Punctuation marks guide readers through text. Full stop (.) ends statements. Question mark (?) ends questions. Exclamation mark (!) shows strong emotion. Comma (,) separates items in lists or clauses. Apostrophe (\'): possession or contraction.' },

  { wiki: 'Vocabulary',
    subject: 'English', unit: 'Word Study', topic: 'Vocabulary and Word Study',
    desc: 'Vocabulary is the collection of words a person knows and uses. Students learn new words through reading, context clues, word roots, prefixes (un-, re-, pre-, mis-), and suffixes (-ful, -less, -tion). Rich vocabulary improves comprehension and expression.' },

  // ── ARTS ────────────────────────────────────────────────────
  { wiki: 'Elements_of_art',
    subject: 'Arts', unit: 'Visual Arts', topic: 'Elements of Art',
    desc: 'The seven elements of art are line, shape, form, colour, texture, space, and value. Artists use these building blocks in every artwork. Students analyse famous artworks and apply elements in their own drawings, paintings, and sculptures.' },

  { wiki: 'Color_theory',
    subject: 'Arts', unit: 'Visual Arts', topic: 'Color Theory',
    desc: 'Colour theory explores how colours relate and interact. Primary colours: red, blue, yellow. Mix two to make secondary: orange, green, purple. Warm colours (red, orange, yellow) feel energetic; cool colours (blue, green, violet) feel calm.' },

  { wiki: 'Rhythm',
    subject: 'Arts', unit: 'Music', topic: 'Rhythm and Beat',
    desc: 'Rhythm is the pattern of long and short sounds in music. The beat is the steady underlying pulse. Tempo is the speed: allegro (fast), andante (walking pace), largo (slow). Students clap rhythms, play percussion, and read simple notation.' },

  { wiki: 'Musical_instrument',
    subject: 'Arts', unit: 'Music', topic: 'Musical Instruments',
    desc: 'Instruments are grouped into families. Strings (violin, guitar, harp) vibrate strings. Woodwinds (flute, clarinet, recorder) vibrate air in tubes. Brass (trumpet, trombone) vibrate lips. Percussion (drums, xylophone) are struck or shaken.' },

  // ── PHYSICAL EDUCATION ──────────────────────────────────────
  { wiki: 'Motor_skill',
    subject: 'Physical Education', unit: 'Movement Skills', topic: 'Fundamental Motor Skills',
    desc: 'Fundamental motor skills are basic movement competencies. Locomotor skills: running, skipping, hopping, galloping. Non-locomotor: balancing, stretching, twisting. Manipulative: throwing, catching, kicking. These form the foundation for all sport.' },

  { wiki: 'Nutrition',
    subject: 'Physical Education', unit: 'Health and Wellness', topic: 'Nutrition and Healthy Living',
    desc: 'Nutrition means eating a balanced variety of foods. The five food groups are grains, fruits, vegetables, dairy, and proteins. Drinking water, limiting sugar and processed foods, regular sleep, and physical activity maintain good health.' },

  { wiki: 'Team_sport',
    subject: 'Physical Education', unit: 'Games', topic: 'Team Games and Sports',
    desc: 'Team sports develop cooperation, communication, strategy, and sportsmanship. Students play modified games of soccer, basketball, volleyball, and tag games. They learn fair play, rules, team positions, and how to encourage teammates.' },

  // ── ICT ─────────────────────────────────────────────────────
  { wiki: 'Personal_computer',
    subject: 'ICT', unit: 'Technology', topic: 'Computer Basics',
    desc: 'Computers have input devices (keyboard, mouse, microphone) and output devices (screen, printer, speakers). Students practise typing, file management, using word processors, and creating simple presentations using educational software.' },

  { wiki: 'Internet_safety',
    subject: 'ICT', unit: 'Digital Citizenship', topic: 'Internet Safety',
    desc: 'Internet safety means protecting yourself online. Never share personal information (name, address, school, password) with strangers. Tell a trusted adult about upsetting content. Be kind online — cyberbullying is harmful. Think before you post.' },
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

// Deterministic UUID-style id → safe to re-seed without duplicates
function makeId(topic, chunkIdx) {
  const raw = `grade3_${topic}_${chunkIdx}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return [hash.slice(0,8), hash.slice(8,12), '4' + hash.slice(13,16), hash.slice(16,20), hash.slice(20,32)].join('-');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 AI Mentor — IB PYP Grade 3 Full Curriculum Seeder\n');
  console.log(`   Topics: ${TOPICS.length} across ${[...new Set(TOPICS.map(t => t.subject))].length} subjects`);
  console.log(`   Vector DB: Qdrant   Embeddings: all-MiniLM-L6-v2 (384d)\n`);

  await initCollection();

  // ── Step 1: Clear existing auto-seeded Grade 3 content ──────
  console.log('🗑️  Clearing previous seed_grade3 points...');
  try {
    await client.delete(COLLECTION, {
      filter: {
        must: [
          { key: 'grade',       match: { value: GRADE      } },
          { key: 'uploaded_by', match: { value: SEEDER_TAG } },
        ],
      },
    });
    console.log('   Done.\n');
  } catch (e) {
    console.log('   (No previous seed found — fresh start)\n');
  }

  // ── Step 2: Seed each topic ─────────────────────────────────
  let totalChunks = 0;
  let successCount = 0;

  const subjects = [...new Set(TOPICS.map(t => t.subject))];
  const subjectIcon = {
    'Mathematics':        '📐',
    'Science':            '🔬',
    'Social Studies':     '🌍',
    'English':            '📖',
    'Arts':               '🎨',
    'Physical Education': '⚽',
    'ICT':                '💻',
  };

  console.log('─'.repeat(60));

  for (let i = 0; i < TOPICS.length; i++) {
    const t = TOPICS[i];
    const icon = subjectIcon[t.subject] ?? '📚';
    process.stdout.write(`[${String(i + 1).padStart(2)}/${TOPICS.length}] ${icon} ${t.subject} · ${t.topic} ... `);

    // Fetch content: try full Wikipedia article, then summary, then fallback to desc
    let text = await fetchWikipediaFull(t.wiki);
    if (!text || text.length < 200) text = await fetchWikipedia(t.wiki);

    // Always prepend our curated description for better IB-context relevance
    const combined = text
      ? `${t.desc}\n\n${text.split(/\s+/).slice(0, 1800).join(' ')}`
      : t.desc;

    const chunks = chunkText(combined);
    const points = chunks.map((chunk, ci) => ({
      id:      makeId(t.topic, ci),
      vector:  null,        // filled below
      payload: {
        curriculum:   CURRICULUM,
        grade:        GRADE,
        subject:      t.subject,
        unit:         t.unit,
        topic:        t.topic,
        content_type: 'explanation',
        content:      chunk,
        description:  t.desc,        // quick display without vector search
        school_id:    'demo',
        uploaded_by:  SEEDER_TAG,
        source:       `https://en.wikipedia.org/wiki/${t.wiki}`,
        ingested_at:  new Date().toISOString(),
      },
    }));

    // Embed all chunks
    for (const p of points) {
      p.vector = await embed(p.payload.content);
    }

    await upsertContent(points);
    totalChunks += points.length;
    successCount++;
    console.log(`✅ ${points.length} chunks`);

    await sleep(400);
  }

  // ── Step 3: Summary ─────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log(`✅ ${successCount}/${TOPICS.length} topics seeded`);
  console.log(`📦 Total chunks in Qdrant: ${totalChunks}`);
  console.log('\nSubjects seeded:');
  for (const sub of subjects) {
    const count = TOPICS.filter(t => t.subject === sub).length;
    console.log(`   ${subjectIcon[sub] ?? '📚'} ${sub}: ${count} topics`);
  }
  console.log('\n✨ Done! Students can now browse and search all Grade 3 topics.\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
