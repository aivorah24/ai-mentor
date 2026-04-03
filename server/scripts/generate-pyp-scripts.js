/**
 * Aivorah — PYP Lesson Script Generator
 * Generates scene + audio scripts for all IB PYP Grade 3, 4, 5 topics
 * Uses Groq (llama-3.1-8b-instant) to write scripts automatically
 *
 * Output: server/data/lessons/pyp/{grade}_{subject}_{topic_slug}.json
 * Usage:  node scripts/generate-pyp-scripts.js
 *         node scripts/generate-pyp-scripts.js --grade 3
 *         node scripts/generate-pyp-scripts.js --grade 4 --subject Science
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });
const OUT    = path.join(__dirname, '../data/lessons/pyp');
fs.mkdirSync(OUT, { recursive: true });

// ── CLI filters ───────────────────────────────────────────────
const args       = process.argv.slice(2);
const gradeArg   = args.includes('--grade')   ? args[args.indexOf('--grade')   + 1] : null;
const subjectArg = args.includes('--subject') ? args[args.indexOf('--subject') + 1] : null;

// ── Accent palette per subject ────────────────────────────────
const ACCENTS = {
  Mathematics:    '#38bdf8',
  Science:        '#22c55e',
  'English':      '#f59e0b',
  'Social Studies':'#a855f7',
  Arts:           '#ec4899',
  PE:             '#f97316',
  ICT:            '#06b6d4',
};

// ── All PYP topics across G3, G4, G5 ─────────────────────────
const TOPICS = [

  // ══════════════════════════════════════════════════════════════
  // GRADE 3
  // ══════════════════════════════════════════════════════════════

  // Mathematics
  { grade: 3, subject: 'Mathematics', topic: 'Number Sense and Place Value',        key_concepts: 'ones, tens, hundreds, comparing numbers, number line' },
  { grade: 3, subject: 'Mathematics', topic: 'Addition and Subtraction',            key_concepts: 'carrying over, borrowing, mental math, word problems' },
  { grade: 3, subject: 'Mathematics', topic: 'Multiplication Basics',               key_concepts: 'equal groups, arrays, multiplication tables 1-5, repeated addition' },
  { grade: 3, subject: 'Mathematics', topic: 'Division Basics',                     key_concepts: 'sharing equally, grouping, division as reverse multiplication' },
  { grade: 3, subject: 'Mathematics', topic: 'Fractions',                           key_concepts: 'halves, thirds, quarters, numerator, denominator, equal parts' },
  { grade: 3, subject: 'Mathematics', topic: 'Measurement — Length and Mass',       key_concepts: 'centimetres, metres, kilograms, grams, measuring tools' },
  { grade: 3, subject: 'Mathematics', topic: 'Time',                                key_concepts: 'hours, minutes, reading a clock, am and pm, calendar' },
  { grade: 3, subject: 'Mathematics', topic: 'Shapes and Geometry',                 key_concepts: '2D shapes, 3D shapes, sides, corners, symmetry, patterns' },
  { grade: 3, subject: 'Mathematics', topic: 'Data and Graphs',                     key_concepts: 'pictograph, bar graph, tally chart, collecting and reading data' },
  { grade: 3, subject: 'Mathematics', topic: 'Money and Word Problems',             key_concepts: 'rupees, coins, notes, giving change, multi-step word problems' },

  // Science
  { grade: 3, subject: 'Science', topic: 'Living and Non-Living Things',            key_concepts: 'characteristics of living things, breathe, grow, move, reproduce' },
  { grade: 3, subject: 'Science', topic: 'Plants — Parts and Functions',            key_concepts: 'roots, stem, leaves, flowers, photosynthesis, types of plants' },
  { grade: 3, subject: 'Science', topic: 'Animals — Habitats and Adaptations',      key_concepts: 'land, water, air habitats, adaptation, food chain' },
  { grade: 3, subject: 'Science', topic: 'Human Body — Senses',                    key_concepts: 'five senses, eyes, ears, nose, tongue, skin, sense organs' },
  { grade: 3, subject: 'Science', topic: 'Magnets',                                 key_concepts: 'attract, repel, poles, magnetic materials, everyday uses' },
  { grade: 3, subject: 'Science', topic: 'Weather and Seasons',                     key_concepts: 'sunny, rainy, cloudy, windy, four seasons, weather instruments' },
  { grade: 3, subject: 'Science', topic: 'Water — States and Water Cycle',          key_concepts: 'solid, liquid, gas, evaporation, condensation, water cycle' },
  { grade: 3, subject: 'Science', topic: 'Materials and Their Properties',          key_concepts: 'hard, soft, rough, smooth, transparent, opaque, waterproof' },

  // Social Studies
  { grade: 3, subject: 'Social Studies', topic: 'My Community',                    key_concepts: 'neighbourhood, community helpers, responsibilities, belonging' },
  { grade: 3, subject: 'Social Studies', topic: 'Maps and Directions',             key_concepts: 'map, compass, North South East West, legend, scale' },
  { grade: 3, subject: 'Social Studies', topic: 'Cultures and Traditions',         key_concepts: 'festivals, food, clothing, customs, diversity, respect' },
  { grade: 3, subject: 'Social Studies', topic: 'Natural Resources',               key_concepts: 'air, water, soil, forests, conservation, reduce reuse recycle' },

  // English
  { grade: 3, subject: 'English', topic: 'Reading Comprehension',                  key_concepts: 'main idea, details, inference, predict, summarise, vocabulary in context' },
  { grade: 3, subject: 'English', topic: 'Grammar — Nouns Verbs Adjectives',       key_concepts: 'common nouns, proper nouns, action verbs, describing words, sentences' },
  { grade: 3, subject: 'English', topic: 'Creative Writing — Stories',             key_concepts: 'beginning middle end, characters, setting, plot, descriptive language' },
  { grade: 3, subject: 'English', topic: 'Poetry and Rhymes',                      key_concepts: 'rhyming words, rhythm, verses, imagery, writing simple poems' },

  // Arts
  { grade: 3, subject: 'Arts', topic: 'Colour Theory and Mixing',                  key_concepts: 'primary colours, secondary colours, warm and cool colours, colour wheel' },
  { grade: 3, subject: 'Arts', topic: 'Drawing and Sketching',                     key_concepts: 'lines, shapes, shading, perspective, observation drawing' },

  // PE
  { grade: 3, subject: 'PE', topic: 'Team Sports and Fair Play',                   key_concepts: 'cooperation, rules, sportsmanship, teamwork, leadership' },
  { grade: 3, subject: 'PE', topic: 'Health and Nutrition',                        key_concepts: 'food groups, balanced diet, exercise, hygiene, healthy habits' },

  // ══════════════════════════════════════════════════════════════
  // GRADE 4
  // ══════════════════════════════════════════════════════════════

  // Mathematics
  { grade: 4, subject: 'Mathematics', topic: 'Large Numbers and Place Value',       key_concepts: 'thousands, ten-thousands, rounding, estimating, number patterns' },
  { grade: 4, subject: 'Mathematics', topic: 'Long Multiplication',                 key_concepts: '2-digit by 2-digit, partial products, area model, estimation' },
  { grade: 4, subject: 'Mathematics', topic: 'Division with Remainders',            key_concepts: 'long division, remainders, quotient, divisor, dividend, word problems' },
  { grade: 4, subject: 'Mathematics', topic: 'Fractions and Decimals',              key_concepts: 'equivalent fractions, comparing, adding fractions, tenths, hundredths' },
  { grade: 4, subject: 'Mathematics', topic: 'Angles and Geometry',                 key_concepts: 'acute, obtuse, right angle, protractor, parallel, perpendicular lines' },
  { grade: 4, subject: 'Mathematics', topic: 'Area and Perimeter',                  key_concepts: 'area formula, perimeter formula, composite shapes, real-life measurement' },
  { grade: 4, subject: 'Mathematics', topic: 'Probability and Statistics',          key_concepts: 'likely, unlikely, certain, impossible, mean, median, mode, data sets' },

  // Science
  { grade: 4, subject: 'Science', topic: 'Forces and Motion',                      key_concepts: 'push, pull, gravity, friction, balanced forces, speed, direction' },
  { grade: 4, subject: 'Science', topic: 'Electricity and Circuits',               key_concepts: 'circuit, conductor, insulator, open/closed circuit, battery, bulb, switch' },
  { grade: 4, subject: 'Science', topic: 'Light and Sound',                        key_concepts: 'reflection, refraction, shadow, pitch, volume, vibration, echoes' },
  { grade: 4, subject: 'Science', topic: 'Ecosystems and Food Webs',               key_concepts: 'producer, consumer, decomposer, food chain, food web, habitat, energy' },
  { grade: 4, subject: 'Science', topic: 'Human Body — Digestive System',          key_concepts: 'mouth, oesophagus, stomach, intestines, digestion, nutrients, absorption' },
  { grade: 4, subject: 'Science', topic: 'Rocks and Soil',                         key_concepts: 'igneous, sedimentary, metamorphic, rock cycle, soil layers, erosion' },
  { grade: 4, subject: 'Science', topic: 'Plant Reproduction',                     key_concepts: 'pollination, seed dispersal, germination, life cycle of a plant' },

  // Social Studies
  { grade: 4, subject: 'Social Studies', topic: 'Ancient Civilisations',           key_concepts: 'Egypt, Mesopotamia, Indus Valley, farming, writing, governance' },
  { grade: 4, subject: 'Social Studies', topic: 'Government and Democracy',        key_concepts: 'laws, rights, responsibilities, voting, local government, leaders' },
  { grade: 4, subject: 'Social Studies', topic: 'Economic Systems',                key_concepts: 'goods, services, trade, supply, demand, producers, consumers, markets' },
  { grade: 4, subject: 'Social Studies', topic: 'Geography — Landforms',           key_concepts: 'mountains, valleys, plains, rivers, oceans, continents, climate zones' },

  // English
  { grade: 4, subject: 'English', topic: 'Advanced Reading — Inference and Theme', key_concepts: 'inference, theme, author purpose, point of view, fact vs opinion' },
  { grade: 4, subject: 'English', topic: 'Grammar — Tenses and Punctuation',       key_concepts: 'past present future tense, commas, apostrophes, speech marks, paragraphs' },
  { grade: 4, subject: 'English', topic: 'Report Writing',                         key_concepts: 'structure, heading, facts, formal language, research, conclusion' },
  { grade: 4, subject: 'English', topic: 'Persuasive Writing',                     key_concepts: 'argument, opinion, evidence, rhetorical questions, emotive language' },

  // Arts
  { grade: 4, subject: 'Arts', topic: 'Sculpture and 3D Art',                     key_concepts: 'clay modelling, form, texture, proportion, abstract vs realistic' },
  { grade: 4, subject: 'Arts', topic: 'Music — Rhythm and Notation',              key_concepts: 'beat, rhythm, tempo, notes, rests, reading basic music notation' },

  // PE
  { grade: 4, subject: 'PE', topic: 'Athletics — Running Jumping Throwing',       key_concepts: 'sprint technique, long jump, shot put, personal best, goal setting' },
  { grade: 4, subject: 'PE', topic: 'Wellbeing and Mental Health',                key_concepts: 'emotions, stress, mindfulness, resilience, empathy, self-care' },

  // ICT
  { grade: 4, subject: 'ICT', topic: 'Introduction to Coding',                   key_concepts: 'algorithm, sequence, loop, conditional, debugging, Scratch basics' },
  { grade: 4, subject: 'ICT', topic: 'Internet Safety',                           key_concepts: 'password, personal information, cyberbullying, trusted adults, screen time' },

  // ══════════════════════════════════════════════════════════════
  // GRADE 5
  // ══════════════════════════════════════════════════════════════

  // Mathematics
  { grade: 5, subject: 'Mathematics', topic: 'Order of Operations (BODMAS)',       key_concepts: 'brackets, order, division, multiplication, addition, subtraction, BODMAS rules' },
  { grade: 5, subject: 'Mathematics', topic: 'Percentages and Ratios',             key_concepts: 'percent, ratio, proportion, converting fractions decimals percentages' },
  { grade: 5, subject: 'Mathematics', topic: 'Algebra Basics',                    key_concepts: 'variable, expression, equation, solving for x, substitution, patterns' },
  { grade: 5, subject: 'Mathematics', topic: 'Prime Numbers and Factors',         key_concepts: 'prime, composite, factor, multiple, HCF, LCM, factor tree' },
  { grade: 5, subject: 'Mathematics', topic: 'Coordinates and Graphs',            key_concepts: 'x-axis, y-axis, ordered pairs, plotting points, line graphs, quadrants' },
  { grade: 5, subject: 'Mathematics', topic: 'Volume and Surface Area',           key_concepts: 'volume formula, surface area, cubes, cuboids, nets, cubic units' },
  { grade: 5, subject: 'Mathematics', topic: 'Data Analysis and Probability',     key_concepts: 'probability scale, sample space, mean median mode range, pie charts' },

  // Science
  { grade: 5, subject: 'Science', topic: 'Solar System and Space',                key_concepts: 'planets, orbits, moon phases, gravity, sun, stars, asteroid belt' },
  { grade: 5, subject: 'Science', topic: 'Photosynthesis and Plant Biology',      key_concepts: 'chlorophyll, glucose, oxygen, carbon dioxide, light energy, leaf structure' },
  { grade: 5, subject: 'Science', topic: 'Human Body — Circulatory System',       key_concepts: 'heart, blood, arteries, veins, capillaries, pulse rate, oxygen transport' },
  { grade: 5, subject: 'Science', topic: 'Mixtures and Separation',               key_concepts: 'mixture, solution, solute, solvent, filtering, evaporation, distillation' },
  { grade: 5, subject: 'Science', topic: 'Climate Change and Environment',        key_concepts: 'greenhouse gases, global warming, carbon footprint, renewable energy, sustainability' },
  { grade: 5, subject: 'Science', topic: 'Genetics and Inheritance',              key_concepts: 'DNA, genes, traits, heredity, variation, adaptation, natural selection' },

  // Social Studies
  { grade: 5, subject: 'Social Studies', topic: 'Human Rights and Responsibilities', key_concepts: 'UN rights of the child, equality, justice, freedom, global citizenship' },
  { grade: 5, subject: 'Social Studies', topic: 'Globalisation and Trade',           key_concepts: 'imports, exports, multinational companies, fair trade, global supply chain' },
  { grade: 5, subject: 'Social Studies', topic: 'Sustainability and Environment',    key_concepts: 'SDGs, deforestation, ocean pollution, renewable energy, future generations' },
  { grade: 5, subject: 'Social Studies', topic: 'World History — Colonisation',      key_concepts: 'colonisation, independence, empire, resistance, impact on culture and people' },

  // English
  { grade: 5, subject: 'English', topic: 'Literary Analysis — Novels',           key_concepts: 'character development, plot structure, theme, symbolism, authorial intent' },
  { grade: 5, subject: 'English', topic: 'Debate and Argument',                  key_concepts: 'thesis, counter-argument, evidence, rebuttal, logical fallacies, conclusion' },
  { grade: 5, subject: 'English', topic: 'Media Literacy',                       key_concepts: 'bias, audience, purpose, analysing news, advertising techniques, fake news' },
  { grade: 5, subject: 'English', topic: 'Grammar — Complex Sentences',          key_concepts: 'subordinate clause, relative clause, conjunctions, semicolons, cohesion' },

  // Arts
  { grade: 5, subject: 'Arts', topic: 'Photography and Digital Art',             key_concepts: 'composition, framing, rule of thirds, digital editing, visual storytelling' },
  { grade: 5, subject: 'Arts', topic: 'Drama and Performance',                   key_concepts: 'character, script, stage directions, voice projection, emotion, improvisation' },

  // PE
  { grade: 5, subject: 'PE', topic: 'Fitness and Training Principles',           key_concepts: 'cardiovascular fitness, strength, flexibility, FITT principle, warm-up cool-down' },
  { grade: 5, subject: 'PE', topic: 'Leadership and Teamwork',                   key_concepts: 'communication, leadership styles, conflict resolution, team roles, strategy' },

  // ICT
  { grade: 5, subject: 'ICT', topic: 'Introduction to AI and Machine Learning',  key_concepts: 'what is AI, training data, pattern recognition, uses of AI, ethical AI' },
  { grade: 5, subject: 'ICT', topic: 'Cybersecurity and Digital Citizenship',    key_concepts: 'encryption, phishing, digital footprint, copyright, online privacy, responsibility' },
];

// ── Groq: generate lesson script ─────────────────────────────
async function generateScript(topic) {
  const gradeLabel = `Grade ${topic.grade}`;
  const accent = ACCENTS[topic.subject] || '#38bdf8';

  const prompt = `You are a lesson script writer for Aivorah, an AI education platform for kids aged 8-12.
Create a lesson video script for: "${topic.topic}" (IB PYP ${gradeLabel} ${topic.subject})
Key concepts to cover: ${topic.key_concepts}

Output ONLY valid JSON matching this exact structure (no markdown, no extra text):
{
  "id": "pyp_g${topic.grade}_${slugify(topic.subject)}_${slugify(topic.topic)}",
  "title": "${topic.topic}",
  "grade": "${gradeLabel}",
  "subject": "${topic.subject}",
  "curriculum": "IB PYP",
  "accent": "${accent}",
  "duration_estimate": "3-4 minutes",
  "scenes": [
    {
      "id": "01_intro",
      "scene_number": 1,
      "type": "intro",
      "words": ["WORD1", "WORD2"],
      "subtext": "Grade ${topic.grade} · ${topic.subject}",
      "voice": "Energetic 2-3 sentence voiceover for kids. Exciting hook. Charlie voice reads this.",
      "accent": "${accent}",
      "duration": 5
    }
  ]
}

Rules:
- Exactly 7 scenes: intro, concept_1, concept_2, concept_3, concept_4, quiz, summary
- "words" array: MAX 3 words, ALL CAPS, what appears BIG on screen
- "voice": 2-4 sentences, energetic, simple language for ${gradeLabel} kids, Charlie reads it
- Scene types must be: intro, concept, concept, concept, concept, quiz, summary
- Make quiz scene ask ONE simple question kids can answer
- Summary scene should celebrate and review 3 key points
- Keep voice scripts age-appropriate for ${gradeLabel} kids`;

  const response = await groq.chat.completions.create({
    model:       'llama-3.1-8b-instant',
    messages:    [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens:  2000,
  });

  const text = response.choices[0].message.content.trim();

  // Extract JSON (handle any markdown wrapping)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Groq response');

  const script = JSON.parse(jsonMatch[0]);

  // Ensure accent is set on all scenes
  if (script.scenes) {
    script.scenes.forEach(s => { if (!s.accent) s.accent = accent; });
  }

  return script;
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('\n📚  Aivorah — PYP Lesson Script Generator');
  console.log('    Grades: 3, 4, 5 | Curriculum: IB PYP\n');

  // Apply filters
  let topics = TOPICS;
  if (gradeArg)   topics = topics.filter(t => String(t.grade) === gradeArg);
  if (subjectArg) topics = topics.filter(t => t.subject.toLowerCase() === subjectArg.toLowerCase());

  console.log(`   Topics to generate: ${topics.length}\n`);
  console.log('─'.repeat(60));

  let done = 0, skipped = 0, failed = 0;

  for (let i = 0; i < topics.length; i++) {
    const t = topics[i];
    const slug     = `pyp_g${t.grade}_${slugify(t.subject)}_${slugify(t.topic)}`;
    const outFile  = path.join(OUT, `${slug}.json`);
    const label    = `[${String(i+1).padStart(3)}/${topics.length}] G${t.grade} ${t.subject} — ${t.topic}`;

    // Skip if already exists
    if (fs.existsSync(outFile)) {
      console.log(`${label} ... ⏭️  exists`);
      skipped++;
      continue;
    }

    process.stdout.write(`${label} ... `);

    try {
      const script = await generateScript(t);
      fs.writeFileSync(outFile, JSON.stringify(script, null, 2));
      console.log(`✅ ${script.scenes?.length || 0} scenes`);
      done++;
    } catch (err) {
      console.log(`❌ ${err.message.slice(0, 60)}`);
      failed++;
    }

    // Rate limit — Groq free tier: ~30 req/min
    await sleep(1200);
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`✅ Generated: ${done} | ⏭️  Skipped: ${skipped} | ❌ Failed: ${failed}`);
  console.log(`📁 Output: server/data/lessons/pyp/\n`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
