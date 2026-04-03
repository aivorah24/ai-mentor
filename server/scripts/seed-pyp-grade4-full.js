require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios  = require('axios');
const crypto = require('crypto');
const { embed }                       = require('../services/embeddings');
const { upsertContent, initCollection, client, COLLECTION } = require('../services/qdrant');

const GRADE      = 'Grade 4';
const CURRICULUM = 'IB_PYP';
const SEEDER_TAG = 'seed_grade4';

const TOPICS = [
  // ── MATHEMATICS ───────────────────────────────────────────────
  { wiki: 'Large_numbers',
    subject: 'Mathematics', unit: 'Number', topic: 'Large Numbers up to 100,000',
    desc: 'Grade 4 students read, write, and compare numbers up to 100,000. They understand place value for ten-thousands and hundred-thousands, round numbers to the nearest 100 and 1,000, and use number lines to order large numbers.' },

  { wiki: 'Multiplication_algorithm',
    subject: 'Mathematics', unit: 'Number', topic: 'Long Multiplication',
    desc: 'Long multiplication multiplies multi-digit numbers. To multiply 34 × 12: multiply 34 × 2 = 68, then 34 × 10 = 340, add together = 408. Students use grid method and standard algorithm, check with estimation, and apply to word problems.' },

  { wiki: 'Division_algorithm',
    subject: 'Mathematics', unit: 'Number', topic: 'Long Division',
    desc: 'Long division divides larger numbers step by step. Example: 96 ÷ 4. How many 4s in 9? Two (8), remainder 1. Bring down 6 to make 16. 16 ÷ 4 = 4. Answer: 24. Students check by multiplying quotient × divisor + remainder.' },

  { wiki: 'Decimal',
    subject: 'Mathematics', unit: 'Number', topic: 'Decimals',
    desc: 'Decimals represent parts of a whole using a decimal point. 0.5 = half, 0.25 = quarter, 1.75 = one and three quarters. Place values: tenths (0.1), hundredths (0.01). Students add, subtract, compare decimals and link them to fractions and money.' },

  { wiki: 'Fraction',
    subject: 'Mathematics', unit: 'Number', topic: 'Equivalent Fractions',
    desc: 'Equivalent fractions have the same value but different numerators and denominators. 1/2 = 2/4 = 4/8. To find equivalents: multiply or divide both top and bottom by the same number. Students simplify fractions to their lowest terms.' },

  { wiki: 'Negative_number',
    subject: 'Mathematics', unit: 'Number', topic: 'Negative Numbers',
    desc: 'Negative numbers are below zero, shown with a minus sign: −1, −5, −100. They appear in temperatures (−10°C), floors below ground, and debt. Students place negative numbers on number lines and compare using < and > symbols.' },

  { wiki: 'Angle',
    subject: 'Mathematics', unit: 'Shape and Space', topic: 'Angles',
    desc: 'An angle is the amount of turn between two lines meeting at a point, measured in degrees (°). Right angle = 90°. Acute angle < 90°. Obtuse angle: 90°–180°. Reflex angle > 180°. Students use protractors to measure and draw angles accurately.' },

  { wiki: 'Area',
    subject: 'Mathematics', unit: 'Measurement', topic: 'Area',
    desc: 'Area measures the surface inside a 2D shape, measured in square units (cm², m²). Area of a rectangle = length × width. Example: 6cm × 4cm = 24cm². Students count square units, use formulas, and compare areas of different shapes.' },

  { wiki: 'Perimeter',
    subject: 'Mathematics', unit: 'Measurement', topic: 'Perimeter and Area Problems',
    desc: 'Perimeter is the distance around a shape; area is the space inside. A rectangle with length 8m and width 5m has perimeter 26m and area 40m². Students solve real-world problems: fencing a garden (perimeter) or tiling a floor (area).' },

  { wiki: 'Roman_numerals',
    subject: 'Mathematics', unit: 'Number', topic: 'Roman Numerals',
    desc: 'Roman numerals use letters: I=1, V=5, X=10, L=50, C=100, D=500, M=1000. Rules: smaller before larger means subtract (IV=4, IX=9). Larger before smaller means add (VI=6, XI=11). Students read years, clock faces, and chapter numbers.' },

  { wiki: 'Probability',
    subject: 'Mathematics', unit: 'Data Handling', topic: 'Probability',
    desc: 'Probability measures how likely an event is to happen, from 0 (impossible) to 1 (certain). Tossing a fair coin: P(heads) = 1/2. Rolling a die: P(getting 3) = 1/6. Students use probability language: impossible, unlikely, even chance, likely, certain.' },

  { wiki: 'Line_graph',
    subject: 'Mathematics', unit: 'Data Handling', topic: 'Line Graphs and Data Analysis',
    desc: 'Line graphs show how data changes over time. The horizontal axis shows time; the vertical axis shows the value. Students plot points, draw lines, read values between plotted points, and identify trends such as increases and decreases.' },

  // ── SCIENCE ─────────────────────────────────────────────────
  { wiki: 'Force',
    subject: 'Science', unit: 'How the World Works', topic: 'Forces and Motion',
    desc: 'A force is a push or pull that changes an object\'s speed, direction, or shape. Gravity pulls everything down. Friction slows moving objects. Air resistance opposes motion. Students investigate how forces affect toy cars on ramps.' },

  { wiki: 'Simple_machine',
    subject: 'Science', unit: 'How the World Works', topic: 'Simple Machines',
    desc: 'Simple machines make work easier by changing force direction or size. Six types: lever (seesaw), wheel and axle (doorknob), pulley (flagpole), inclined plane (ramp), wedge (knife), screw (jar lid). Students build and test simple machines.' },

  { wiki: 'Electricity',
    subject: 'Science', unit: 'How the World Works', topic: 'Electricity and Circuits',
    desc: 'Electricity flows around a complete circuit from a battery through wires to a bulb and back. Components: battery (power), wire (conductor), bulb or buzzer (load), switch (on/off). Conductors (metals) allow flow; insulators (plastic, rubber) block it.' },

  { wiki: 'Adaptation',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Adaptations',
    desc: 'Adaptations are inherited features that help organisms survive in their habitat. Camel: fat-storing hump, long eyelashes for sand. Polar bear: thick white fur for camouflage and insulation. Cactus: stores water in thick stem, has spines instead of leaves.' },

  { wiki: 'Ecosystem',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Ecosystems and Food Webs',
    desc: 'An ecosystem includes all living organisms and their non-living environment in an area. Food webs show multiple overlapping food chains. Producers (plants) → Primary consumers (herbivores) → Secondary consumers (carnivores) → Decomposers (fungi, bacteria).' },

  { wiki: 'Human_body',
    subject: 'Science', unit: 'Who We Are', topic: 'Human Body Systems',
    desc: 'The human body has several systems working together. Skeletal (206 bones, support), muscular (movement), digestive (breaks food into nutrients), circulatory (heart pumps blood), respiratory (lungs exchange gases). All systems are interdependent.' },

  { wiki: 'Rock_cycle',
    subject: 'Science', unit: 'How the World Works', topic: 'Rock Cycle',
    desc: 'Rocks continuously change through the rock cycle. Igneous rock forms when magma cools. Weathering breaks rock into sediments. Sedimentary rock forms when sediments compact. Heat and pressure create metamorphic rock. The cycle repeats over millions of years.' },

  { wiki: 'Renewable_energy',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Renewable and Non-Renewable Energy',
    desc: 'Renewable energy comes from sources that replenish naturally: solar (sun), wind (turbines), hydro (water flow), geothermal (Earth\'s heat). Non-renewable: coal, oil, gas — formed over millions of years. Renewables reduce pollution and combat climate change.' },

  // ── SOCIAL STUDIES ──────────────────────────────────────────
  { wiki: 'Ancient_Egypt',
    subject: 'Social Studies', unit: 'Where We Are in Place and Time', topic: 'Ancient Civilizations',
    desc: 'Ancient civilizations were early complex societies with organised governments, writing, and cities. Ancient Egypt (Nile River) built pyramids and developed hieroglyphics. Mesopotamia (Tigris-Euphrates) invented the wheel and cuneiform writing. China built the Great Wall.' },

  { wiki: 'Government',
    subject: 'Social Studies', unit: 'How We Organize Ourselves', topic: 'Government and Democracy',
    desc: 'Government is the system that makes and enforces rules for a community or country. Democracy: people vote for representatives. Monarchy: ruled by a king or queen. Republic: elected officials govern. Students study local, national, and international government structures.' },

  { wiki: 'Trade',
    subject: 'Social Studies', unit: 'How We Organize Ourselves', topic: 'Trade and Economics',
    desc: 'Trade is the exchange of goods and services between people, regions, or countries. Import: buying goods from another country. Export: selling goods to another country. Barter: exchanging goods without money. Global trade connects countries and economies.' },

  { wiki: 'Human_migration',
    subject: 'Social Studies', unit: 'Where We Are in Place and Time', topic: 'Migration and Movement',
    desc: 'Migration is the movement of people from one place to another. Push factors cause people to leave: war, poverty, drought. Pull factors attract people: safety, jobs, education. Immigration: moving into a new country. Emigration: leaving a country.' },

  { wiki: 'Climate',
    subject: 'Social Studies', unit: 'Where We Are in Place and Time', topic: 'Climate Zones and Geography',
    desc: 'Climate is the average weather pattern over 30+ years in a region. Tropical (hot, wet year-round), arid (very dry), temperate (four seasons), polar (freezing). Climate affects clothing, food, shelter, and lifestyle. Students map world climate zones.' },

  // ── ENGLISH ─────────────────────────────────────────────────
  { wiki: 'Figurative_language',
    subject: 'English', unit: 'Reading', topic: 'Figurative Language',
    desc: 'Figurative language uses words beyond their literal meaning. Simile: comparing using like/as ("fast as lightning"). Metaphor: direct comparison ("He is a lion"). Personification: giving human traits to objects. Hyperbole: exaggeration ("I\'ve told you a million times").' },

  { wiki: 'Poetry',
    subject: 'English', unit: 'Writing', topic: 'Poetry Writing',
    desc: 'Poetry uses rhythm, rhyme, imagery, and figurative language to express ideas and emotions. Forms include haiku (5-7-5 syllables), acrostic (letters spell a word), free verse (no rules), and limerick (AABBA rhyme). Students write, perform, and analyse poems.' },

  { wiki: 'Persuasive_writing',
    subject: 'English', unit: 'Writing', topic: 'Persuasive Writing',
    desc: 'Persuasive writing aims to convince the reader to agree with a viewpoint. Structure: statement of position, arguments with evidence, counter-arguments addressed, strong conclusion. Techniques: rhetorical questions, emotive language, facts and statistics, rule of three.' },

  { wiki: 'Paragraph',
    subject: 'English', unit: 'Writing', topic: 'Paragraph Structure',
    desc: 'A paragraph is a group of sentences about one main idea. Structure: Topic sentence (main idea), Supporting sentences (evidence/examples), Concluding sentence (wrap up). Students use PEEL: Point, Evidence, Explain, Link. Good paragraphs improve essay clarity.' },

  { wiki: 'Adverb',
    subject: 'English', unit: 'Grammar', topic: 'Adverbs and Conjunctions',
    desc: 'Adverbs modify verbs, adjectives, or other adverbs: quickly, very, almost, never. Conjunctions join clauses: coordinating (and, but, or, so), subordinating (because, although, while, unless). Students use varied conjunctions to write complex, flowing sentences.' },

  // ── ARTS ────────────────────────────────────────────────────
  { wiki: 'Perspective_(graphical)',
    subject: 'Arts', unit: 'Visual Arts', topic: 'Perspective and Depth in Art',
    desc: 'Perspective creates the illusion of 3D depth on a flat surface. One-point perspective: parallel lines meet at one vanishing point on the horizon. Objects appear smaller as they get farther away. Artists use overlapping and shading to enhance depth.' },

  { wiki: 'Melody',
    subject: 'Arts', unit: 'Music', topic: 'Melody and Harmony',
    desc: 'Melody is a sequence of musical notes that form a recognisable tune — the part you sing or hum. Harmony is when two or more notes sound together pleasingly (chords). Students play simple melodies on recorder or xylophone and identify harmony in songs.' },

  // ── PHYSICAL EDUCATION ──────────────────────────────────────
  { wiki: 'Aerobic_exercise',
    subject: 'Physical Education', unit: 'Health and Wellness', topic: 'Aerobic Fitness',
    desc: 'Aerobic exercise uses oxygen and strengthens the heart and lungs. Activities: running, swimming, cycling, skipping, dancing. Benefits: stronger heart, better lung capacity, healthy weight, improved mood. Students measure heart rate before and after exercise.' },

  { wiki: 'Sportsmanship',
    subject: 'Physical Education', unit: 'Games', topic: 'Sportsmanship and Fair Play',
    desc: 'Sportsmanship is showing respect, fairness, and graciousness whether winning or losing. It includes following rules, encouraging teammates, accepting referee decisions, and congratulating opponents. Good sportsmanship builds character and positive team culture.' },

  // ── ICT ─────────────────────────────────────────────────────
  { wiki: 'Spreadsheet',
    subject: 'ICT', unit: 'Technology', topic: 'Spreadsheets and Data',
    desc: 'Spreadsheets organise data in rows and columns of cells. Students enter data, use basic formulas (=SUM, =AVERAGE, =MAX), and create charts. Applications: Google Sheets, Microsoft Excel. Spreadsheets are used in science experiments, budgeting, and surveys.' },

  { wiki: 'Algorithm',
    subject: 'ICT', unit: 'Computational Thinking', topic: 'Algorithms and Coding',
    desc: 'An algorithm is a step-by-step set of instructions to solve a problem or complete a task. Like a recipe: precise steps in a specific order. In coding, algorithms control what computers do. Students write pseudocode and use Scratch or Python to code simple programs.' },
];

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
  const raw  = `grade4_${topic}_${chunkIdx}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return [hash.slice(0,8), hash.slice(8,12), '4' + hash.slice(13,16), hash.slice(16,20), hash.slice(20,32)].join('-');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('\n🚀 Aivorah — IB PYP Grade 4 Full Curriculum Seeder\n');
  console.log(`   Topics: ${TOPICS.length} across ${[...new Set(TOPICS.map(t => t.subject))].length} subjects`);
  console.log(`   Vector DB: Qdrant   Embeddings: all-MiniLM-L6-v2 (384d)\n`);

  await initCollection();

  console.log('🗑️  Clearing previous seed_grade4 points...');
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

  let totalChunks = 0;
  let successCount = 0;

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
    const t    = TOPICS[i];
    const icon = subjectIcon[t.subject] ?? '📚';
    process.stdout.write(`[${String(i + 1).padStart(2)}/${TOPICS.length}] ${icon} ${t.subject} · ${t.topic} ... `);

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

    await upsertContent(points);
    totalChunks += points.length;
    successCount++;
    console.log(`✅ ${points.length} chunks`);
    await sleep(400);
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`✅ ${successCount}/${TOPICS.length} topics seeded`);
  console.log(`📦 Total chunks in Qdrant: ${totalChunks}`);
  const subjects = [...new Set(TOPICS.map(t => t.subject))];
  console.log('\nSubjects seeded:');
  for (const sub of subjects) {
    const count = TOPICS.filter(t => t.subject === sub).length;
    console.log(`   ${subjectIcon[sub] ?? '📚'} ${sub}: ${count} topics`);
  }
  console.log('\n✨ Done! IB PYP Grade 4 content ready in Qdrant.\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
