require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios  = require('axios');
const crypto = require('crypto');
const { embed }                       = require('../services/embeddings');
const { upsertContent, initCollection, client, COLLECTION } = require('../services/qdrant');

const GRADE      = 'Grade 3';
const CURRICULUM = 'NCERT';
const SUBJECT    = 'English';
const BOOK       = 'Marigold';
const SEEDER_TAG = 'seed_ncert_g3_english';

// NCERT Grade 3 English — Marigold
// Covers all units: poems, stories, grammar, vocabulary, and language skills
const TOPICS = [
  // ── UNIT 1 ──────────────────────────────────────────────────
  { wiki: 'Greeting',
    subject: 'English', unit: 'Unit 1', topic: 'Good Morning — Greetings and Politeness',
    desc: 'Good Morning is a poem about greeting others cheerfully. Students learn how to say hello, good morning, good afternoon, and good night. Greetings show respect and friendliness. Practice: greeting friends, family, and teachers politely every day.' },

  { wiki: 'Garden',
    subject: 'English', unit: 'Unit 1', topic: 'The Magic Garden — Describing a Garden',
    desc: 'The Magic Garden story teaches students to describe nature using adjectives. A garden has flowers, trees, grass, insects, and birds. Describing words: colourful, beautiful, tall, tiny, buzzing. Students practise reading, answering comprehension questions, and drawing their own magic garden.' },

  // ── UNIT 2 ──────────────────────────────────────────────────
  { wiki: 'Bird',
    subject: 'English', unit: 'Unit 2', topic: 'Bird Talk — Learning About Birds',
    desc: 'Bird Talk is a fun poem where birds speak to each other. Students learn names of birds (sparrow, crow, parrot, peacock, eagle) and the sounds they make. New words: tweet, chirp, squawk, feathers, beak, nest. Students identify rhyming words and practice reading aloud with expression.' },

  { wiki: 'Sparrow',
    subject: 'English', unit: 'Unit 2', topic: 'Nina and the Baby Sparrows — Caring for Animals',
    desc: 'Nina and the Baby Sparrows is a story about a girl who rescues baby birds. Teaches values: kindness, responsibility, and care for animals. Language focus: past tense verbs (found, picked, placed, fed). Comprehension: who, what, where, when, why questions. Students retell the story in their own words.' },

  // ── UNIT 3 ──────────────────────────────────────────────────
  { wiki: 'Seed_germination',
    subject: 'English', unit: 'Unit 3', topic: 'Little by Little — Growth and Patience',
    desc: 'Little by Little is a poem about a seed growing into a tree slowly and steadily. Theme: patience and hard work lead to growth. Vocabulary: seed, sprout, sapling, branch, roots, slowly, gradually. Literary device: repetition ("little by little"). Students discuss things that grow slowly in life.' },

  { wiki: 'Turnip',
    subject: 'English', unit: 'Unit 3', topic: 'The Enormous Turnip — Teamwork Story',
    desc: 'The Enormous Turnip is a classic folk tale about working together. Characters pull a giant turnip out of the ground one by one until everyone helps. Themes: cooperation, teamwork, perseverance. Sequence words: first, then, next, finally. Students act out the story and write the sequence of events.' },

  // ── UNIT 4 ──────────────────────────────────────────────────
  { wiki: 'Ocean',
    subject: 'English', unit: 'Unit 4', topic: 'Sea Song — Describing the Ocean',
    desc: 'Sea Song is a rhythmic poem about the sea. Students learn ocean vocabulary: waves, tide, shore, shells, sand, deep, blue, vast. Identify rhyming pairs. Poetic devices: rhythm and repetition. Students write their own nature poem using sensory words (what they see, hear, feel, smell at the sea).' },

  { wiki: 'Fish',
    subject: 'English', unit: 'Unit 4', topic: 'A Little Fish Story — Ocean Life',
    desc: 'A Little Fish Story is about a small fish exploring the ocean. Students learn about underwater life: fish, coral, seaweed, crab, jellyfish. Language focus: size adjectives (tiny, small, big, enormous), prepositions (under, beside, through, around). Comprehension: character feelings, story events, moral.' },

  // ── UNIT 5 ──────────────────────────────────────────────────
  { wiki: 'Balloon',
    subject: 'English', unit: 'Unit 5', topic: 'The Balloon Man — Community Helpers',
    desc: 'The Balloon Man is a poem about a street vendor selling colourful balloons. Students identify community helpers and their roles. Colour vocabulary in context. Language focus: describing colours and shapes. Extension: students write about their favourite community helper using the sentence frame: "I see a ___ who ___."' },

  { wiki: 'Train',
    subject: 'English', unit: 'Unit 5', topic: 'Trains — Transport and Travel',
    desc: 'Trains is a story about a journey by train. Vocabulary: station, platform, ticket, passengers, engine, compartment, whistle, track, speed. Language focus: present continuous tense (The train is moving. People are waving.). Students sequence the events of a train journey and describe travel experiences.' },

  // ── UNIT 6 ──────────────────────────────────────────────────
  { wiki: 'Nose',
    subject: 'English', unit: 'Unit 6', topic: 'Noses — Sense of Smell',
    desc: 'Noses is a humorous poem comparing different animal noses. Students learn about the five senses with focus on smell. Animal vocabulary: elephant, dog, rabbit, pig, bear. Adjectives for smell: sweet, flowery, stinky, fresh. Students write sentences using "My nose smells ___" and identify rhyming pairs in the poem.' },

  { wiki: 'Ant',
    subject: 'English', unit: 'Unit 6', topic: 'The Tiny Teacher — Learning from Ants',
    desc: 'The Tiny Teacher is an informational story about ants and how they work together. Facts: ants live in colonies, carry food, have a queen, communicate with antennae. Language focus: singular/plural (ant/ants, colony/colonies). Comprehension: fact vs opinion. Students write 3 facts they learnt about ants.' },

  // ── UNIT 7 ──────────────────────────────────────────────────
  { wiki: 'Tiger',
    subject: 'English', unit: 'Unit 7', topic: 'A Little Tiger — Wild Animals',
    desc: 'A Little Tiger poem introduces wild animals with descriptive language. Students learn adjectives for wild animals: fierce, swift, striped, powerful, graceful. Vocabulary: jungle, prey, hunt, pounce, roar. Language focus: using adjectives before nouns. Students write a description of their favourite wild animal.' },

  { wiki: 'Sibling',
    subject: 'English', unit: 'Unit 7', topic: 'My Silly Sister — Family and Relationships',
    desc: 'My Silly Sister is a funny story about sibling relationships. Themes: family, humour, love. Language focus: pronouns (she, her, they, we), possessives (my, her, our). Students relate to the story and write about a funny incident with a sibling or friend using past tense verbs.' },

  // ── UNIT 8 ──────────────────────────────────────────────────
  { wiki: 'Magnet',
    subject: 'English', unit: 'Unit 8', topic: 'Fun with Magnets — Science in English',
    desc: 'Fun with Magnets poem makes learning science vocabulary fun. Students learn: attract, repel, poles, magnetic, force. Language focus: imperative sentences (Pull! Push! Try! Discover!). Cross-curricular: links English with science. Students write instructions for a simple experiment using imperative verbs.' },

  { wiki: 'Ice_cream',
    subject: 'English', unit: 'Unit 8', topic: 'Ice-Cream Man — Seasons and Street Vendors',
    desc: 'Ice-Cream Man poem describes the joy of summer and ice cream. Vocabulary: cool, refreshing, flavours, summer, vendor, cart. Seasons vocabulary: hot, cold, rainy, windy. Language focus: sensory adjectives. Students write about their favourite season and food using descriptive language.' },

  // ── GRAMMAR SKILLS ──────────────────────────────────────────
  { wiki: 'Noun',
    subject: 'English', unit: 'Grammar', topic: 'Nouns — People, Places, Things, Animals',
    desc: 'A noun names a person (teacher, child), place (school, garden, market), thing (book, ball, flower), or animal (dog, sparrow, tiger). Common nouns are general. Proper nouns are specific names and always start with a capital letter: Arjun, India, Mumbai. Students sort words into noun categories.' },

  { wiki: 'Pronoun',
    subject: 'English', unit: 'Grammar', topic: 'Pronouns — He, She, It, They',
    desc: 'Pronouns replace nouns to avoid repetition. I (speaking about yourself), You (the person spoken to), He (male), She (female), It (thing/animal), We (self + others), They (more than one). Example: "Priya is kind. She helps everyone." Students replace nouns with correct pronouns in sentences.' },

  { wiki: 'Verb',
    subject: 'English', unit: 'Grammar', topic: 'Action Words — Verbs',
    desc: 'Verbs are action words that tell us what someone or something does. Run, jump, eat, sleep, write, read, sing, play. The verb must agree with the subject: "She runs." "They run." Students identify verbs in sentences, mime actions, and fill in the blanks with correct verb forms.' },

  { wiki: 'Adjective',
    subject: 'English', unit: 'Grammar', topic: 'Describing Words — Adjectives',
    desc: 'Adjectives describe nouns. Colour: red, blue. Size: big, tiny, enormous. Shape: round, square. Feel: soft, rough, smooth. Taste: sweet, sour, spicy. Adjectives make writing more interesting and detailed. Students add adjectives to plain sentences: "The dog barked." → "The big, brown dog barked loudly."' },

  { wiki: 'Preposition',
    subject: 'English', unit: 'Grammar', topic: 'Prepositions — Position Words',
    desc: 'Prepositions tell us where something is or when something happens. Place prepositions: in, on, under, behind, beside, between, above, below. Example: "The cat is under the table." "The book is on the shelf." Students use prepositions to describe where objects are in classroom pictures.' },

  { wiki: 'Sentence',
    subject: 'English', unit: 'Grammar', topic: 'Types of Sentences',
    desc: 'A sentence is a group of words that makes complete sense and has a subject and verb. Types: Statement (tells something — "The sky is blue."), Question (asks something — "Is it raining?"), Exclamation (shows strong feeling — "What a beautiful day!"), Command (gives an order — "Open your book."). Students identify and write each type.' },

  // ── VOCABULARY & COMPREHENSION ───────────────────────────────
  { wiki: 'Reading_comprehension',
    subject: 'English', unit: 'Reading Skills', topic: 'Reading Comprehension',
    desc: 'Reading comprehension means understanding what you read. Steps: read carefully, look for main idea, find key details, understand new words from context. Question types: Literal (directly in the text), Inferential (read between the lines), Personal response (your opinion). Students answer all three types for each passage.' },

  { wiki: 'Vocabulary',
    subject: 'English', unit: 'Word Study', topic: 'Building Vocabulary',
    desc: 'Vocabulary is knowing the meaning of words. Strategies: use context clues, look for root words, use a dictionary. Antonyms are opposites: hot/cold, big/small. Synonyms are words with similar meanings: happy/joyful, run/sprint. Rhyming words end with the same sound: cat/bat/hat. Students build word families and use new words in sentences.' },

  { wiki: 'Creative_writing',
    subject: 'English', unit: 'Writing Skills', topic: 'Creative Writing',
    desc: 'Creative writing expresses ideas and imagination. Types: stories (beginning, middle, end), poems (rhythm, rhyme), descriptions (using senses), letters (friendly or formal). Tips: start with an interesting sentence, use descriptive words, vary sentence length, have a clear ending. Students write short stories and poems on familiar topics.' },
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
  const raw  = `ncert_g3_english_${topic}_${chunkIdx}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return [hash.slice(0,8), hash.slice(8,12), '4' + hash.slice(13,16), hash.slice(16,20), hash.slice(20,32)].join('-');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('\n📗 Aivorah — NCERT Grade 3 English (Marigold) Seeder\n');
  console.log(`   Topics: ${TOPICS.length} | Book: ${BOOK}`);
  console.log(`   Vector DB: Qdrant | Embeddings: all-MiniLM-L6-v2 (384d)\n`);

  await initCollection();

  console.log('🗑️  Clearing previous NCERT G3 English points...');
  try {
    await client.delete(COLLECTION, {
      filter: { must: [
        { key: 'grade',       match: { value: GRADE      } },
        { key: 'uploaded_by', match: { value: SEEDER_TAG } },
      ]},
    });
    console.log('   Done.\n');
  } catch { console.log('   (Fresh start)\n'); }

  let totalChunks = 0;
  console.log('─'.repeat(60));

  for (let i = 0; i < TOPICS.length; i++) {
    const t = TOPICS[i];
    process.stdout.write(`[${String(i + 1).padStart(2)}/${TOPICS.length}] 📖 ${t.unit} · ${t.topic} ... `);

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
        subject:      SUBJECT,
        unit:         t.unit,
        topic:        t.topic,
        content_type: 'explanation',
        content:      chunk,
        description:  t.desc,
        book:         BOOK,
        school_id:    'demo',
        uploaded_by:  SEEDER_TAG,
        source:       `https://en.wikipedia.org/wiki/${t.wiki}`,
        ingested_at:  new Date().toISOString(),
      },
    }));

    for (const p of points) p.vector = await embed(p.payload.content);
    await upsertContent(points);
    totalChunks += points.length;
    console.log(`✅ ${points.length} chunks`);
    await sleep(400);
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`✅ ${TOPICS.length}/${TOPICS.length} topics seeded`);
  console.log(`📦 Total chunks: ${totalChunks}`);
  console.log('\n✨ Done! NCERT Grade 3 English ready in Qdrant.\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
