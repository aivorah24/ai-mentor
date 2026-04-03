require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios  = require('axios');
const crypto = require('crypto');
const { embed }                       = require('../services/embeddings');
const { upsertContent, initCollection, client, COLLECTION } = require('../services/qdrant');

const GRADE      = 'Grade 5';
const CURRICULUM = 'IB_PYP';
const SEEDER_TAG = 'seed_grade5';

const TOPICS = [
  // ── MATHEMATICS ───────────────────────────────────────────────
  { wiki: 'Order_of_operations',
    subject: 'Mathematics', unit: 'Number', topic: 'Order of Operations (BODMAS)',
    desc: 'BODMAS tells us the order to solve calculations: Brackets first, then Orders (powers/roots), then Division and Multiplication (left to right), then Addition and Subtraction (left to right). Example: 3 + 4 × 2 = 3 + 8 = 11 (not 14).' },

  { wiki: 'Fraction',
    subject: 'Mathematics', unit: 'Number', topic: 'Adding and Subtracting Fractions',
    desc: 'To add or subtract fractions, denominators must be the same. 1/4 + 2/4 = 3/4. If different: find the lowest common denominator. 1/3 + 1/4 = 4/12 + 3/12 = 7/12. Students add mixed numbers and solve fraction word problems in real contexts.' },

  { wiki: 'Percentage',
    subject: 'Mathematics', unit: 'Number', topic: 'Percentages',
    desc: 'Percentage means "out of 100". 50% = 50/100 = 0.5 = half. 25% = 1/4. To find 20% of 80: 80 × 0.20 = 16. Students convert between fractions, decimals, and percentages, and apply to real life: discounts, tax, test scores, and survey results.' },

  { wiki: 'Ratio',
    subject: 'Mathematics', unit: 'Number', topic: 'Ratio and Proportion',
    desc: 'A ratio compares two quantities. If a recipe uses 2 cups flour : 1 cup sugar, ratio is 2:1. Proportion means two ratios are equal: 2:4 = 1:2. Students scale recipes, draw maps to scale, mix paint colours, and solve proportion word problems.' },

  { wiki: 'Prime_number',
    subject: 'Mathematics', unit: 'Number', topic: 'Prime and Composite Numbers',
    desc: 'A prime number has exactly two factors: 1 and itself. Primes: 2, 3, 5, 7, 11, 13, 17, 19, 23. A composite number has more than two factors: 6 (1,2,3,6). 1 is neither prime nor composite. Students use the Sieve of Eratosthenes to find primes.' },

  { wiki: 'Integer',
    subject: 'Mathematics', unit: 'Number', topic: 'Integers and Number Lines',
    desc: 'Integers include all whole numbers, zero, and negative numbers: ...-3, -2, -1, 0, 1, 2, 3... Adding a negative is like subtracting: 5 + (−3) = 2. Subtracting a negative is like adding: 5 − (−3) = 8. Students use number lines and real-life contexts.' },

  { wiki: 'Volume',
    subject: 'Mathematics', unit: 'Measurement', topic: 'Volume and Capacity',
    desc: 'Volume is the amount of 3D space an object occupies, measured in cubic units (cm³, m³). Volume of a cuboid = length × width × height. Capacity is the amount a container holds (litres, millilitres). 1 litre = 1,000 millilitres = 1,000 cm³.' },

  { wiki: 'Coordinate_system',
    subject: 'Mathematics', unit: 'Shape and Space', topic: 'Coordinates',
    desc: 'Coordinates locate a point on a grid using two numbers: (x, y). x is the horizontal position, y is the vertical position. (3, 5) means 3 right, 5 up. Students plot shapes on a coordinate grid, reflect shapes, and read map references.' },

  { wiki: 'Translation_(geometry)',
    subject: 'Mathematics', unit: 'Shape and Space', topic: 'Transformations',
    desc: 'Transformations move or change shapes. Translation: sliding without rotation. Reflection: flipping over a mirror line. Rotation: turning around a fixed point (90°, 180°, 270°). Enlargement: scaling a shape up or down. The shape stays congruent through translation, reflection, and rotation.' },

  { wiki: 'Mean',
    subject: 'Mathematics', unit: 'Data Handling', topic: 'Mean, Median, Mode and Range',
    desc: 'Mean (average) = sum of values ÷ number of values. Median = middle value when sorted. Mode = most frequent value. Range = largest − smallest. For data set [3, 5, 7, 7, 8]: mean=6, median=7, mode=7, range=5. Used in science experiments and surveys.' },

  { wiki: 'Algebraic_expression',
    subject: 'Mathematics', unit: 'Patterns and Algebra', topic: 'Introduction to Algebra',
    desc: 'Algebra uses letters (variables) to represent unknown numbers. An expression like 3x + 5 means 3 times an unknown number plus 5. If x = 4, then 3(4) + 5 = 17. Students solve simple equations: x + 7 = 12, so x = 5. Algebra is the language of mathematics.' },

  // ── SCIENCE ─────────────────────────────────────────────────
  { wiki: 'Solar_System',
    subject: 'Science', unit: 'How the World Works', topic: 'Earth and the Solar System',
    desc: 'The Solar System has 8 planets orbiting the Sun: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune. Earth is the third planet and the only one with liquid water and life. The Moon orbits Earth every 27 days. Day/night is caused by Earth\'s rotation.' },

  { wiki: 'Chemical_change',
    subject: 'Science', unit: 'How the World Works', topic: 'Physical and Chemical Changes',
    desc: 'Physical change: shape or state changes but the substance stays the same (cutting paper, melting ice). Chemical change: a new substance is formed (burning, rusting, cooking). Signs of chemical change: colour change, gas produced, temperature change, irreversible reaction.' },

  { wiki: 'Genetics',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Inheritance and Genetics Basics',
    desc: 'Genetics is the study of how traits are passed from parents to offspring through genes. Genes are found in chromosomes inside cells. Some traits (eye colour, blood type) follow dominant/recessive patterns. Darwin\'s natural selection: organisms best adapted to their environment survive and reproduce.' },

  { wiki: 'Climate_change',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Climate Change and Environment',
    desc: 'Climate change refers to long-term shifts in global temperatures and weather patterns. The greenhouse effect traps heat in the atmosphere (CO₂, methane). Human activities (burning fossil fuels, deforestation) are accelerating warming. Effects: rising sea levels, extreme weather, species extinction.' },

  { wiki: 'Microorganism',
    subject: 'Science', unit: 'Who We Are', topic: 'Microorganisms',
    desc: 'Microorganisms are living things too small to see without a microscope. Bacteria: single-celled, can be helpful (yogurt, antibiotics) or harmful (food poisoning). Viruses cause diseases like flu and cold. Fungi: mushrooms, moulds. Students learn hygiene practices to prevent disease.' },

  { wiki: 'Photosynthesis',
    subject: 'Science', unit: 'Sharing the Planet', topic: 'Photosynthesis',
    desc: 'Photosynthesis is how plants make food using sunlight. Equation: Carbon dioxide + Water + Light energy → Glucose + Oxygen. Chlorophyll in leaves captures sunlight. Plants release oxygen — essential for animal life. Deforestation reduces Earth\'s capacity for photosynthesis.' },

  { wiki: 'Nervous_system',
    subject: 'Science', unit: 'Who We Are', topic: 'Nervous System and Senses',
    desc: 'The nervous system controls all body functions. Brain (control centre), spinal cord (message pathway), nerves (signal carriers). Five senses: sight (eyes), hearing (ears), smell (nose), taste (tongue), touch (skin). Reflex actions happen automatically without conscious thought.' },

  // ── SOCIAL STUDIES ──────────────────────────────────────────
  { wiki: 'Human_rights',
    subject: 'Social Studies', unit: 'Who We Are', topic: 'Human Rights',
    desc: 'Human rights are basic rights and freedoms every person has regardless of nationality, sex, or religion. The UN Universal Declaration of Human Rights (1948) lists 30 rights: right to life, education, free speech, fair trial, freedom from slavery. Students explore rights and responsibilities.' },

  { wiki: 'Globalisation',
    subject: 'Social Studies', unit: 'How We Organize Ourselves', topic: 'Globalisation',
    desc: 'Globalisation is the increasing interconnection of the world\'s economies, cultures, and populations. Trade, the internet, and travel link countries. A phone is designed in the USA, made in China, with parts from 40 countries. Benefits: cheaper goods, cultural exchange. Challenges: inequality, cultural erosion.' },

  { wiki: 'Sustainable_development',
    subject: 'Social Studies', unit: 'Sharing the Planet', topic: 'Sustainability',
    desc: 'Sustainability means meeting today\'s needs without compromising future generations\' ability to meet theirs. Three pillars: environmental (protect nature), social (fair communities), economic (stable economies). UN Sustainable Development Goals (SDGs): 17 goals including zero poverty, clean energy, quality education.' },

  { wiki: 'Colonialism',
    subject: 'Social Studies', unit: 'Where We Are in Place and Time', topic: 'Colonialism and Independence',
    desc: 'Colonialism is when one country takes political control over another, usually for resources and trade. European powers (Britain, France, Spain, Portugal) colonised Africa, Asia, and the Americas. Independence movements reclaimed self-governance. This history shapes today\'s global inequalities.' },

  { wiki: 'United_Nations',
    subject: 'Social Studies', unit: 'How We Organize Ourselves', topic: 'International Organisations',
    desc: 'The United Nations (UN, founded 1945) promotes peace, human rights, and international cooperation among 193 member states. Key bodies: General Assembly, Security Council, UNICEF (children), WHO (health), UNESCO (education). Students explore how international cooperation solves global problems.' },

  // ── ENGLISH ─────────────────────────────────────────────────
  { wiki: 'Literary_device',
    subject: 'English', unit: 'Reading', topic: 'Literary Devices',
    desc: 'Literary devices are techniques authors use to convey meaning. Foreshadowing: hints at future events. Irony: opposite of what is expected. Alliteration: repeated consonant sounds ("Peter Piper"). Onomatopoeia: words that sound like what they mean (buzz, crash). Students identify and use these in analysis and creative writing.' },

  { wiki: 'Debate',
    subject: 'English', unit: 'Speaking and Listening', topic: 'Debate and Argumentation',
    desc: 'Debate is structured argument where teams present opposing views on a motion. Structure: opening statement, arguments with evidence, rebuttal, closing statement. Skills: researching evidence, logical reasoning, respectful disagreement, active listening. Students debate real-world issues relevant to their lives.' },

  { wiki: 'Research',
    subject: 'English', unit: 'Writing', topic: 'Research and Essay Writing',
    desc: 'Research involves gathering information from multiple reliable sources (books, websites, experts), evaluating credibility, taking notes, avoiding plagiarism, and citing sources. An essay has introduction (thesis), body paragraphs (evidence and analysis), and conclusion. Students write 5-paragraph essays on chosen topics.' },

  { wiki: 'Media_literacy',
    subject: 'English', unit: 'Reading', topic: 'Media Literacy',
    desc: 'Media literacy is the ability to access, analyse, evaluate, and create media. Students question: Who created this? For what purpose? Whose viewpoint is missing? Fact vs opinion. Bias in news. Advertising techniques. Digital footprint. Critical media literacy protects against misinformation.' },

  { wiki: 'Preposition',
    subject: 'English', unit: 'Grammar', topic: 'Prepositions, Clauses and Complex Sentences',
    desc: 'Prepositions show relationship between nouns and other words: in, on, at, beside, beneath, throughout. A clause has a subject and verb. Main clause can stand alone; subordinate clause cannot. Complex sentence: main clause + subordinate clause joined by conjunction (because, although, whenever, unless).' },

  // ── ARTS ────────────────────────────────────────────────────
  { wiki: 'Mixed_media',
    subject: 'Arts', unit: 'Visual Arts', topic: 'Mixed Media and Abstract Art',
    desc: 'Mixed media art combines different materials: paint, collage, photography, fabric, found objects. Abstract art does not represent real objects — it expresses ideas through colour, shape, texture, and line. Artists like Picasso and Kandinsky pioneered abstract expression. Students create mixed media pieces on social themes.' },

  { wiki: 'Composition_(music)',
    subject: 'Arts', unit: 'Music', topic: 'Music Composition',
    desc: 'Music composition is the process of creating original music. Elements: melody (tune), harmony (chords), rhythm (beat pattern), dynamics (loud/soft), tempo (speed), timbre (sound quality). Students compose short pieces using notation, digital tools, or Garageband, expressing a chosen theme or emotion.' },

  // ── PHYSICAL EDUCATION ──────────────────────────────────────
  { wiki: 'Mental_health',
    subject: 'Physical Education', unit: 'Health and Wellness', topic: 'Mental Health and Wellbeing',
    desc: 'Mental health is emotional and psychological wellbeing. Strategies to support it: regular exercise, adequate sleep (9–11 hrs for Grade 5), healthy eating, talking to trusted adults, mindfulness and breathing exercises. Recognising stress, anxiety, and when to seek help are important life skills.' },

  { wiki: 'Strategy_(game_theory)',
    subject: 'Physical Education', unit: 'Games', topic: 'Game Strategy and Tactics',
    desc: 'Strategy in sport is a plan to achieve success. Tactics are specific actions within the plan. Basketball: pick and roll, zone defence. Soccer: pressing, counter-attack. Students analyse opponents\' strengths and weaknesses, make real-time decisions, and adapt strategies during competition.' },

  // ── ICT ─────────────────────────────────────────────────────
  { wiki: 'Artificial_intelligence',
    subject: 'ICT', unit: 'Computational Thinking', topic: 'Introduction to Artificial Intelligence',
    desc: 'Artificial Intelligence (AI) is computer systems performing tasks that normally require human intelligence: speech recognition, image recognition, decision making, translation. Machine learning: computers learn from data. Students explore ethical questions: fairness, privacy, and the future of work in an AI-driven world.' },

  { wiki: 'Cybersecurity',
    subject: 'ICT', unit: 'Digital Citizenship', topic: 'Cybersecurity and Digital Responsibility',
    desc: 'Cybersecurity protects computers, networks, and data from digital attacks. Threats: phishing (fake emails), malware (harmful software), hacking. Protection: strong passwords, two-factor authentication, keeping software updated. Digital citizenship: responsible online behaviour, copyright respect, and protecting personal data.' },
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
  const raw  = `grade5_${topic}_${chunkIdx}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return [hash.slice(0,8), hash.slice(8,12), '4' + hash.slice(13,16), hash.slice(16,20), hash.slice(20,32)].join('-');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('\n🚀 Aivorah — IB PYP Grade 5 Full Curriculum Seeder\n');
  console.log(`   Topics: ${TOPICS.length} across ${[...new Set(TOPICS.map(t => t.subject))].length} subjects`);
  console.log(`   Vector DB: Qdrant   Embeddings: all-MiniLM-L6-v2 (384d)\n`);

  await initCollection();

  console.log('🗑️  Clearing previous seed_grade5 points...');
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
  console.log('\n✨ Done! IB PYP Grade 5 content ready in Qdrant.\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
