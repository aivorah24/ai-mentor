const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const FormDataNode = require('form-data');
const https = require('https');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const { getCachedAudio, saveAudio } = require('../services/audioCache');

// ── Cache directories ───────────────────────────────────────────────────────
const PASSAGE_DIR = path.join(__dirname, '..', 'data', 'read-aloud', 'passages');
const HISTORY_DIR = path.join(__dirname, '..', 'data', 'read-aloud', 'history');
const AUDIO_DIR   = path.join(__dirname, '..', 'data', 'read-aloud', 'audio');
const UPLOAD_DIR  = path.join(__dirname, '..', 'data', 'read-aloud', 'uploads');
fs.mkdirSync(PASSAGE_DIR, { recursive: true });
fs.mkdirSync(HISTORY_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR,   { recursive: true });
fs.mkdirSync(UPLOAD_DIR,  { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── ElevenLabs TTS for child-friendly voice ─────────────────────────────────
const EL_VOICE_ID = process.env.EL_VOICE_READALOUD || 'XrExE9yKIg1WjnnlVkGX'; // Matilda
const EL_VOICE_SETTINGS = { stability: 0.75, similarity_boost: 0.78, style: 0.45, use_speaker_boost: false };

function alignmentToWordTimings(text, alignment) {
  if (!alignment || !alignment.characters) return null;
  const chars  = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends   = alignment.character_end_times_seconds;
  if (!chars.length || !starts.length) return null;
  const wordTimings = [];
  const words = splitWords(text);
  let ai = 0;
  for (const word of words) {
    while (ai < chars.length && chars[ai] === ' ') ai++;
    const wordStartAi = ai;
    let lettersMatched = 0;
    while (ai < chars.length && lettersMatched < word.length) {
      if (chars[ai] !== ' ') lettersMatched++;
      ai++;
    }
    const wordEndAi = Math.min(ai - 1, chars.length - 1);
    const startTime = starts[wordStartAi] ?? 0;
    const endTime   = ends[wordEndAi]     ?? startTime + 0.1;
    wordTimings.push({ word, startTime, endTime });
  }
  return wordTimings;
}

async function generateTTS(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_AIVORAH_KEY;
  if (!apiKey) throw new Error('No ElevenLabs API key');
  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE_ID}/with-timestamps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({ text, model_id: modelId, voice_settings: EL_VOICE_SETTINGS }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const buffer = Buffer.from(json.audio_base64, 'base64');
  const wordTimings = alignmentToWordTimings(text, json.alignment);
  return { buffer, wordTimings };
}

// ── IB PYP Curriculum-aligned passages ──────────────────────────────────────
// Transdisciplinary themes: Who We Are, Where We Are in Place and Time,
// How We Express Ourselves, How the World Works, How We Organize Ourselves,
// Sharing the Planet
const SEED_PASSAGES = {
  'Grade 3': [
    // ── Easy ──
    { title: 'My Five Senses', text: 'I use my five senses every day. My eyes help me see the bright colours of flowers. My ears listen to the birds singing in the morning. My nose smells the fresh bread from the bakery. My tongue tastes the sweet mango my mother cuts for me. My fingers feel the soft fur of my cat. Each sense teaches me something new about the world around me. Together, they help me learn and stay safe.', topic: 'Who We Are', level: 'easy', icon: 'eye', gradient: ['#93B0AC', '#C3DCD8'] },
    { title: 'Feelings Are Okay', text: 'Sometimes I feel happy, like when I play with my friends. Sometimes I feel sad, like when my pet is unwell. Sometimes I feel angry, like when someone takes my turn. All these feelings are normal. My teacher says it is important to talk about how we feel. When I am upset, I take three deep breaths and count to ten. Then I feel a little better. Everyone has big feelings, and that is perfectly okay.', topic: 'Who We Are', level: 'easy', icon: 'heart', gradient: ['#EFD1D4', '#D4A898'] },
    { title: 'Our School Rules', text: 'Our school has rules that help everyone learn and play safely. We raise our hand before we speak. We walk quietly in the hallways. We share our things with our classmates. We listen when someone is talking. We keep our classroom clean and tidy. Rules are not punishments. They are like a promise we make to each other. When we follow rules, everyone feels happy and respected.', topic: 'How We Organize Ourselves', level: 'easy', icon: 'clipboard', gradient: ['#C5BD96', '#93B0AC'] },
    { title: 'Water Around Us', text: 'Water is everywhere. It fills the oceans, rivers, and lakes. It falls from the sky as rain. It freezes into ice on cold winter days. We use water to drink, cook, and take a bath. Plants need water to grow. Animals drink water from ponds and streams. Without water, nothing on Earth could live. That is why we must never waste water. Every drop is precious.', topic: 'Sharing the Planet', level: 'easy', icon: 'droplet', gradient: ['#C3DCD8', '#93B0AC'] },
    { title: 'A Map of My Town', text: 'I drew a map of my town for a school project. I marked my house with a red dot. The school is two streets away, so I drew it close. The park is at the corner with tall green trees. The library is next to the temple. The market is on the main road where buses pass. Maps help us find places and understand where things are. My teacher said maps are like bird\'s-eye pictures of the world.', topic: 'Where We Are in Place and Time', level: 'easy', icon: 'map', gradient: ['#D4A898', '#C5BD96'] },
    { title: 'How I Show I Care', text: 'There are many ways to show people I care. I help my grandmother carry her bags. I share my crayons with friends who forgot theirs. I say thank you when someone helps me. I write cards for my family on their birthdays. I hold the door open for others. When my little sister falls, I help her stand up and give her a hug. Small acts of kindness make the world a warmer place.', topic: 'How We Express Ourselves', level: 'easy', icon: 'gift', gradient: ['#EFD1D4', '#C3DCD8'] },

    // ── Medium ──
    { title: 'The Water Cycle Journey', text: 'Every drop of water on Earth has been on an incredible journey. The sun heats water in the ocean, and it rises as invisible water vapour into the sky. As it climbs higher, the air gets cooler, and the vapour turns into tiny water droplets. Millions of these droplets come together to form clouds. When the clouds become heavy, the water falls back to Earth as rain or snow. This is called precipitation. The rainwater flows into streams, rivers, and finally back to the ocean. Then the whole wonderful cycle begins again. Scientists call this the water cycle, and it has been happening for billions of years.', topic: 'How the World Works', level: 'medium', icon: 'cloud-rain', gradient: ['#93B0AC', '#C5BD96'] },
    { title: 'Communities Work Together', text: 'A community is a group of people who live, work, and play together in the same area. In our community, different people do different jobs to help everyone. The farmer grows vegetables and rice for us to eat. The doctor takes care of us when we are sick. The teacher helps us learn new things every day. The postman delivers letters and parcels to our homes. The bus driver takes people safely from one place to another. When everyone does their part, the community becomes a happy and well-organised place. No job is too small or too big. Each person is important.', topic: 'How We Organize Ourselves', level: 'medium', icon: 'users', gradient: ['#C5BD96', '#D4A898'] },
    { title: 'Stories From Long Ago', text: 'Every family has stories from long ago. My grandmother tells me about the village where she grew up. There were no cars, so people walked or rode bullock carts. There was only one school, and children of all ages sat in the same room. At night, the whole village gathered under a big banyan tree to listen to folk tales. Grandmother says the stars seemed brighter then because there were no city lights. These stories help me understand how life has changed over time. They connect me to my family\'s past and help me appreciate the world I live in today.', topic: 'Where We Are in Place and Time', level: 'medium', icon: 'book-open', gradient: ['#D4A898', '#EFD1D4'] },
    { title: 'What Makes Me Unique', text: 'No two people in the world are exactly alike, and that is what makes each of us special. I have my father\'s brown eyes and my mother\'s curly hair. I love painting pictures, while my best friend prefers writing poems. My neighbour speaks three languages, and I am learning my second one. Some children are great at running fast, while others are brilliant at solving puzzles. Our differences are not weaknesses. They are strengths that make our classroom and our world more interesting. When we respect what makes each person unique, we build friendships that last a lifetime.', topic: 'Who We Are', level: 'medium', icon: 'star', gradient: ['#EFD1D4', '#93B0AC'] },

    // ── Hard ──
    { title: 'Protecting Our Forests', text: 'Forests are one of Earth\'s most valuable treasures. They provide oxygen for us to breathe, shelter for countless animals, and wood for building homes. The roots of forest trees hold the soil together and prevent dangerous landslides during heavy rains. Forests also play a crucial role in controlling the climate by absorbing carbon dioxide from the atmosphere. Unfortunately, thousands of hectares of forest are cut down every year for farming, construction, and making paper. This is called deforestation, and it threatens the survival of many species. Conservation efforts around the world are working to replant trees and protect existing forests. Each of us can contribute by using less paper, recycling, and supporting organisations that plant trees. Protecting our forests means protecting our future.', topic: 'Sharing the Planet', level: 'hard', icon: 'feather', gradient: ['#93B0AC', '#C3DCD8'] },
    { title: 'Art Tells a Story', text: 'Throughout history, human beings have used art to express their thoughts, feelings, and experiences. Ancient cave paintings in France and Spain show that even thousands of years ago, people wanted to tell their stories through images. In India, the Mughal miniature paintings captured scenes of royal courts, battles, and celebrations with extraordinary detail. Japanese woodblock prints depicted landscapes, seasons, and daily life with bold colours and flowing lines. Today, artists use many different materials and techniques — paint, clay, digital tools, and even recycled objects — to create works that inspire, challenge, and move us. Art crosses the boundaries of language and culture. A painting created in one country can touch the heart of someone living thousands of kilometres away. Art connects us all.', topic: 'How We Express Ourselves', level: 'hard', icon: 'image', gradient: ['#D4A898', '#EFD1D4'] },
  ],
  'Grade 4': [
    // ── Easy ──
    { title: 'Our Solar System', text: 'Our solar system is a family of planets orbiting the Sun. The Sun is a giant star that gives us light and warmth. Mercury is the closest planet and moves the fastest. Earth is the third planet and the only one we know that has life. Mars is called the Red Planet because of its dusty red surface. Jupiter is the biggest planet and could fit over a thousand Earths inside it. Saturn has beautiful rings made of ice and rock. Learning about space helps us understand our place in the universe.', topic: 'Where We Are in Place and Time', level: 'easy', icon: 'sun', gradient: ['#C5BD96', '#D4A898'] },
    { title: 'Healthy Habits', text: 'Taking care of our body is very important. We should eat fruits and vegetables every day because they give us vitamins and energy. Drinking plenty of water keeps our body cool and healthy. Exercise makes our muscles and bones strong. Sleeping for at least eight hours helps our brain rest and grow. Washing our hands before eating keeps germs away. When we follow healthy habits every day, we feel stronger, happier, and ready to learn new things.', topic: 'Who We Are', level: 'easy', icon: 'activity', gradient: ['#93B0AC', '#C3DCD8'] },
    { title: 'Reduce, Reuse, Recycle', text: 'Every day, we throw away many things that could be used again. Old newspapers can become craft paper. Glass jars can hold spices or pencils. Clothes we have outgrown can be given to someone who needs them. When we reduce the amount of waste we create, we help our planet stay clean. Recycling turns old materials into new products, which saves energy and trees. The three Rs — Reduce, Reuse, and Recycle — are simple actions that make a big difference for the Earth.', topic: 'Sharing the Planet', level: 'easy', icon: 'refresh-cw', gradient: ['#C3DCD8', '#93B0AC'] },

    // ── Medium ──
    { title: 'Migration and Movement', text: 'Throughout history, people have moved from one place to another in search of food, safety, and better opportunities. Thousands of years ago, early humans were nomads who followed herds of animals across vast grasslands. As people discovered farming, they began to settle near rivers and fertile lands. Great civilisations grew along the Nile in Egypt, the Indus in India, and the Yangtze in China. Even today, people migrate for many reasons — to find work, to study, or to escape conflict. Migration brings new ideas, languages, and traditions to communities. It also brings challenges, as people must adapt to new environments and cultures. Understanding migration helps us appreciate the diverse world we live in and the journeys that shaped it.', topic: 'Where We Are in Place and Time', level: 'medium', icon: 'navigation', gradient: ['#D4A898', '#C5BD96'] },
    { title: 'The Power of Energy', text: 'Energy is what makes everything work. It lights our homes, powers our vehicles, and keeps our food cold in the refrigerator. Energy comes from different sources. Fossil fuels like coal, oil, and gas have been used for over a century, but they pollute the air and contribute to climate change. Renewable energy sources like sunlight, wind, and flowing water are much cleaner and will never run out. Solar panels on rooftops convert sunlight into electricity. Wind turbines spin in the breeze to generate power. Many countries are now investing in renewable energy to build a cleaner, healthier future. Every time we switch off a light we are not using, we save energy and help the planet.', topic: 'How the World Works', level: 'medium', icon: 'zap', gradient: ['#C5BD96', '#93B0AC'] },
    { title: 'Music Around the World', text: 'Music is a universal language that every culture understands. In Africa, drums carry messages across villages and set the rhythm for celebrations. In India, the sitar and tabla create intricate ragas that can express joy, longing, or peace. Japanese koto music is gentle and meditative, often inspired by nature. In South America, the rhythms of samba and salsa make people want to dance. Western classical music, with its orchestras and symphonies, tells stories without a single word. Music brings people together, crossing borders and breaking barriers. Whether it is a grandmother humming a lullaby or a crowd singing at a concert, music has the power to connect hearts and heal minds.', topic: 'How We Express Ourselves', level: 'medium', icon: 'music', gradient: ['#EFD1D4', '#D4A898'] },

    // ── Hard ──
    { title: 'Democracy and Governance', text: 'In a democracy, the people have the power to choose their leaders through elections. Every citizen\'s vote is equally important, whether they are a farmer, a teacher, or a business owner. The leaders who are elected form a government that makes laws, manages public services, and represents the people\'s interests. India, the world\'s largest democracy, has a parliament where elected members debate and discuss issues that affect millions of lives. A good democracy depends on informed citizens who understand their rights and responsibilities. Freedom of speech, the right to education, and access to fair courts are the pillars that hold a democracy together. When people participate actively — by voting, asking questions, and holding leaders accountable — democracy becomes stronger. It is not just a system of government; it is a way of living together with mutual respect and shared responsibility.', topic: 'How We Organize Ourselves', level: 'hard', icon: 'shield', gradient: ['#93B0AC', '#C5BD96'] },
    { title: 'Endangered Species', text: 'Across our planet, thousands of animal and plant species are at risk of disappearing forever. The Bengal tiger, once found across much of Asia, now survives in small protected reserves. The African elephant is hunted for its ivory tusks despite international laws against poaching. Coral reefs, home to a quarter of all marine species, are bleaching and dying because of rising ocean temperatures. When a species becomes extinct, the entire ecosystem suffers. Predators lose their prey, plants lose their pollinators, and the delicate balance of nature is disrupted. Conservation programmes around the world are working tirelessly to protect endangered species through breeding programmes, habitat restoration, and stricter laws. Organisations like the World Wildlife Fund educate communities about the importance of biodiversity. Each of us can help by learning about the species in our region, supporting conservation efforts, and making choices that reduce our environmental impact.', topic: 'Sharing the Planet', level: 'hard', icon: 'feather', gradient: ['#C3DCD8', '#EFD1D4'] },
  ],
  'Grade 5': [
    // ── Easy ──
    { title: 'The Human Body', text: 'The human body is like an amazing machine with many parts working together. The heart pumps blood through our body day and night without resting. Our lungs take in fresh air and release the air we do not need. The brain controls everything we think, feel, and do. Our bones give our body shape and protect important organs. Muscles help us move, run, and lift things. Eating healthy food and exercising regularly keeps all these parts working well. Our body truly is a wonder of nature.', topic: 'Who We Are', level: 'easy', icon: 'heart', gradient: ['#EFD1D4', '#D4A898'] },
    { title: 'Maps and Navigation', text: 'For thousands of years, maps have helped people find their way. Ancient sailors used the stars to navigate across oceans. Explorers drew maps by hand as they discovered new lands. Today we have digital maps on our phones that can tell us the fastest route to any place. GPS satellites orbiting the Earth send signals to help us know exactly where we are. Even with all this technology, learning to read a paper map is still a valuable skill. Maps teach us about geography, scale, and direction.', topic: 'Where We Are in Place and Time', level: 'easy', icon: 'compass', gradient: ['#C5BD96', '#93B0AC'] },

    // ── Medium ──
    { title: 'Inventions That Changed the World', text: 'Some inventions have transformed the way human beings live, work, and communicate. The printing press, invented by Johannes Gutenberg in the fifteenth century, made it possible to produce books quickly and affordably. Before the printing press, books were copied by hand and only the wealthy could own them. The steam engine powered the Industrial Revolution, bringing factories, railways, and new cities into existence. In the twentieth century, the invention of the internet connected people across continents in seconds. Today, we carry powerful computers in our pockets in the form of smartphones. Each great invention builds on the ideas that came before it. The wheel led to the cart, the cart led to the car, and the car led to space rovers on Mars. Human curiosity and creativity have no limits.', topic: 'How the World Works', level: 'medium', icon: 'tool', gradient: ['#93B0AC', '#C5BD96'] },
    { title: 'Trade and Economy', text: 'Trade is the exchange of goods and services between people, communities, and countries. Thousands of years ago, people used the barter system — trading rice for cloth or spices for pottery. As societies grew more complex, money was invented to make trade easier and fairer. Ancient trade routes like the Silk Road connected China to Europe, carrying silk, spices, and ideas across continents. Today, international trade is powered by ships, aeroplanes, and the internet. When you buy a chocolate bar, the cocoa might have come from Ghana, the sugar from Brazil, and the packaging from Germany. Trade creates jobs, spreads technology, and allows countries to specialise in what they do best. Understanding how trade works helps us see how interconnected our world truly is.', topic: 'How We Organize Ourselves', level: 'medium', icon: 'trending-up', gradient: ['#D4A898', '#C5BD96'] },

    // ── Hard ──
    { title: 'Climate Change and Our Responsibility', text: 'Climate change is one of the most significant challenges facing humanity today. Over the past century, the burning of fossil fuels — coal, oil, and natural gas — has released enormous quantities of carbon dioxide and other greenhouse gases into the atmosphere. These gases trap heat from the sun, causing the Earth\'s average temperature to rise gradually. This phenomenon, known as global warming, is melting polar ice caps, raising sea levels, and causing more frequent and intense storms, droughts, and wildfires. The consequences affect every living thing on the planet. Island nations face the threat of being submerged, while farmers in many regions struggle with unpredictable rainfall and failing crops. However, there is still hope. Scientists, governments, and ordinary citizens are working together to find solutions. Renewable energy is becoming cheaper and more accessible. Electric vehicles are replacing petrol cars. Reforestation projects are restoring damaged ecosystems. Young people around the world are raising their voices, demanding urgent action from leaders. Every choice we make — from the food we eat to the energy we use — has an impact on the climate. Understanding this responsibility is the first step towards building a sustainable future for all.', topic: 'Sharing the Planet', level: 'hard', icon: 'globe', gradient: ['#93B0AC', '#C3DCD8'] },
    { title: 'The Power of Storytelling', text: 'Since the dawn of civilisation, storytelling has been one of the most powerful ways human beings share knowledge, preserve culture, and make sense of the world. Before writing was invented, stories were passed down orally from generation to generation. Elders would gather children around fires and weave tales of heroes, gods, and moral lessons. The Mahabharata and Ramayana, two of the world\'s longest epic poems, were recited for centuries before they were written down. In West Africa, griots — traditional storytellers — memorised the entire history of their people and performed it through song and spoken word. Today, storytelling takes many forms: novels, films, podcasts, graphic novels, and even video games. Each medium offers a unique way to experience a narrative. What remains constant is the human need to tell and hear stories. A well-told story can change minds, challenge assumptions, and inspire action. When we read stories from different cultures, we develop empathy and understanding for lives very different from our own.', topic: 'How We Express Ourselves', level: 'hard', icon: 'book-open', gradient: ['#EFD1D4', '#D4A898'] },
  ],
};

function getPassageKey(grade, topic, level) {
  return crypto.createHash('md5').update(`${grade}_${topic}_${level}`).digest('hex').slice(0, 12);
}

function getTTSCachePaths(text) {
  const hash = crypto.createHash('md5').update(text).digest('hex').slice(0, 16);
  return {
    hash,
    audioFile: path.join(AUDIO_DIR, `${hash}.mp3`),
    timingFile: path.join(AUDIO_DIR, `${hash}_timings.json`),
    audioUrl: `/data/read-aloud/audio/${hash}.mp3`,
  };
}

function readCachedTTS(text) {
  const cache = getTTSCachePaths(text);
  if (!fs.existsSync(cache.audioFile)) return null;
  return {
    audioUrl: cache.audioUrl,
    wordTimings: fs.existsSync(cache.timingFile) ? JSON.parse(fs.readFileSync(cache.timingFile, 'utf8')) : null,
    cached: true,
  };
}

// ── POST /read-aloud/passage — Get a reading passage ────────────────────
router.post('/passage', express.json(), async (req, res) => {
  try {
    const { grade = 'Grade 3', topic, level = 'easy', curriculum = 'IB_PYP' } = req.body;

    // 1. Try seed passages first
    const gradePassages = SEED_PASSAGES[grade] || SEED_PASSAGES['Grade 3'];
    let matching = gradePassages;
    if (topic) {
      const topicLower = topic.toLowerCase();
      const topicMatches = gradePassages.filter(p =>
        p.topic.toLowerCase().includes(topicLower) || p.title.toLowerCase().includes(topicLower)
      );
      if (topicMatches.length > 0) matching = topicMatches;
    }
    if (level && level !== 'any') {
      const levelMatches = matching.filter(p => p.level === level);
      if (levelMatches.length > 0) matching = levelMatches;
    }

    // Pick a random seed passage
    if (matching.length > 0) {
      const passage = matching[Math.floor(Math.random() * matching.length)];
      return res.json({
        title: passage.title,
        text: passage.text,
        topic: passage.topic,
        level: passage.level,
        icon: passage.icon || 'book-open',
        gradient: passage.gradient || ['#93B0AC', '#C3DCD8'],
        wordCount: passage.text.split(/\s+/).length,
        source: 'curated',
      });
    }

    // 2. Check cache
    const cacheKey = getPassageKey(grade, topic || 'general', level);
    const cachePath = path.join(PASSAGE_DIR, `${cacheKey}.json`);
    if (fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return res.json({ ...cached, source: 'cached' });
    }

    // 3. Generate via Groq LLM
    const wordRange = level === 'easy' ? '60-90' : level === 'hard' ? '130-170' : '90-130';
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{
        role: 'user',
        content: `Generate a short reading passage (${wordRange} words) for a ${grade} student (age 8-11) following the IB PYP curriculum.
Topic: ${topic || 'any IB PYP transdisciplinary theme (Who We Are, How the World Works, Sharing the Planet, etc.)'}
Difficulty: ${level}

Requirements:
- Use simple, grade-appropriate vocabulary
- Include 2-3 slightly challenging words to help build reading skills
- Make it interesting and engaging for children
- Include proper punctuation and varied sentence lengths
- Content should be inquiry-based and connected to real-world understanding
- Appropriate for international school students

Return ONLY a JSON object with these fields:
{"title": "passage title", "text": "the full passage text", "topic": "IB PYP theme name", "level": "${level}"}

Return ONLY valid JSON, no markdown fences.`,
      }],
      temperature: 0.8,
      max_tokens: 500,
    });

    let generated;
    try {
      let raw = completion.choices[0]?.message?.content?.trim() || '';
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      generated = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'Failed to parse generated passage' });
    }

    generated.wordCount = (generated.text || '').split(/\s+/).length;
    generated.icon = 'book-open';
    generated.gradient = ['#93B0AC', '#C3DCD8'];

    // Cache it
    fs.writeFileSync(cachePath, JSON.stringify(generated, null, 2));

    res.json({ ...generated, source: 'generated' });
  } catch (err) {
    console.error('[read-aloud/passage] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Lexile helpers ──────────────────────────────────────────────────────
const LEXILE_DIR = path.join(__dirname, '..', 'data', 'read-aloud', 'lexile');
fs.mkdirSync(LEXILE_DIR, { recursive: true });

const GRADE_BASE_LEXILE = { 'Grade 1': 200, 'Grade 2': 300, 'Grade 3': 400, 'Grade 4': 500, 'Grade 5': 600 };

function lexileToLevel(lexile) {
  if (lexile < 300) return 'easy';
  if (lexile <= 600) return 'medium';
  return 'hard';
}

function getStudentLexile(email) {
  const hash = crypto.createHash('md5').update(email).digest('hex').slice(0, 12);
  const lexilePath = path.join(LEXILE_DIR, `${hash}.json`);
  if (fs.existsSync(lexilePath)) return JSON.parse(fs.readFileSync(lexilePath, 'utf8'));
  return null;
}

function saveStudentLexile(email, data) {
  const hash = crypto.createHash('md5').update(email).digest('hex').slice(0, 12);
  const lexilePath = path.join(LEXILE_DIR, `${hash}.json`);
  fs.writeFileSync(lexilePath, JSON.stringify(data, null, 2));
}

// ── Calibration passages (one per grade, ~100 words, medium difficulty) ──
const CALIBRATION_PASSAGES = {
  'Grade 3': { title: 'The Butterfly Garden', text: 'Last spring, our class planted a butterfly garden behind the school. We chose flowers that butterflies love, like marigolds and sunflowers. Every morning, we watered the plants and pulled out the weeds. After a few weeks, tiny green caterpillars appeared on the leaves. We watched them grow bigger each day. One morning, we found a chrysalis hanging from a branch. Two weeks later, a beautiful orange butterfly came out and flew into the sky. Our teacher said that butterflies help flowers grow by carrying pollen from one plant to another. Now our garden is full of colour and life.' },
  'Grade 4': { title: 'The River Journey', text: 'Rivers are nature\'s highways. They begin as tiny streams high up in the mountains, fed by melting snow and rainfall. As the water flows downhill, it gathers strength and joins other streams to form a river. Along the way, rivers carve valleys, create waterfalls, and carry soil to new places. Many great cities were built beside rivers because people needed water for drinking, farming, and transportation. The Ganges in India, the Nile in Egypt, and the Amazon in South America are among the world\'s most important rivers. They provide water to millions of people and support countless plants and animals.' },
  'Grade 5': { title: 'The Science of Sound', text: 'Every sound you hear is created by vibrations. When you pluck a guitar string, it vibrates back and forth very quickly. These vibrations push the air molecules around them, creating invisible waves that travel through the air. When these sound waves reach your ear, tiny bones and a thin membrane called the eardrum vibrate in response. Your brain interprets these vibrations as sound. Sound travels at different speeds through different materials. In air, sound moves at about three hundred and forty metres per second. In water, it travels four times faster. In steel, sound races along at over five thousand metres per second. That is why you can hear a train coming by pressing your ear to the railway track long before you can hear it through the air.' },
};

// ── GET /read-aloud/lexile — Get student's Lexile level ─────────────────
router.get('/lexile', (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'email required' });
  const data = getStudentLexile(email);
  if (!data) return res.json({ lexile: null, needsCalibration: true });
  res.json({ lexile: data.lexile, level: lexileToLevel(data.lexile), history: data.history || [], needsCalibration: false });
});

// ── POST /read-aloud/lexile — Set/update Lexile after calibration ───────
router.post('/lexile', express.json(), (req, res) => {
  const { email, lexile, source } = req.body;
  if (!email || lexile == null) return res.status(400).json({ error: 'email and lexile required' });
  const clamped = Math.max(100, Math.min(900, Math.round(lexile)));
  const existing = getStudentLexile(email) || { history: [] };
  existing.lexile = clamped;
  existing.history = existing.history || [];
  existing.history.push({ date: new Date().toISOString(), lexile: clamped, source: source || 'manual' });
  if (existing.history.length > 50) existing.history.splice(0, existing.history.length - 50);
  saveStudentLexile(email, existing);
  res.json({ lexile: clamped, level: lexileToLevel(clamped) });
});

// ── GET /read-aloud/calibration — Get calibration passage for grade ─────
router.get('/calibration', (req, res) => {
  const grade = req.query.grade || 'Grade 3';
  const passage = CALIBRATION_PASSAGES[grade] || CALIBRATION_PASSAGES['Grade 3'];
  res.json({ ...passage, wordCount: passage.text.split(/\s+/).length });
});

// ── Star rewards constants ──────────────────────────────────────────────
const STARS = { listen: 10, read: 50, questions: 150 };

// ── GET /read-aloud/passages — List available passages for a grade ──────
router.get('/passages', (req, res) => {
  const grade = req.query.grade || 'Grade 3';
  const lexile = req.query.lexile ? parseInt(req.query.lexile) : null;
  const passages = SEED_PASSAGES[grade] || SEED_PASSAGES['Grade 3'];

  // If lexile provided, filter to matching difficulty + one level up/down
  let filtered = passages;
  if (lexile != null) {
    const targetLevel = lexileToLevel(lexile);
    // Show target level first, then adjacent levels
    const levelOrder = targetLevel === 'easy' ? ['easy', 'medium'] :
                       targetLevel === 'hard' ? ['hard', 'medium'] :
                       ['medium', 'easy', 'hard'];
    filtered = passages.slice().sort((a, b) => {
      const ai = levelOrder.indexOf(a.level);
      const bi = levelOrder.indexOf(b.level);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }

  res.json({
    grade,
    recommendedLevel: lexile != null ? lexileToLevel(lexile) : null,
    passages: filtered.map(p => ({
      title: p.title,
      topic: p.topic,
      level: p.level,
      icon: p.icon || 'book-open',
      gradient: p.gradient || ['#93B0AC', '#C3DCD8'],
      wordCount: p.text.split(/\s+/).length,
    })),
  });
});

// ── POST /read-aloud/assess — Assess reading performance ────────────────
router.post('/assess', express.json(), async (req, res) => {
  try {
    const { passage, transcript, wordStatuses, duration, studentEmail, grade, topic } = req.body;

    if (!passage || !wordStatuses || !duration) {
      return res.status(400).json({ error: 'Missing required fields: passage, wordStatuses, duration' });
    }

    const words = splitWords(passage);
    const totalWords = words.length;

    // Count statuses
    const correct = wordStatuses.filter(s => s === 'correct').length;
    const misread = wordStatuses.filter(s => s === 'misread').length;
    const skipped = wordStatuses.filter(s => s === 'skipped').length;

    const accuracy = Math.round((correct / totalWords) * 100);
    const durationMin = duration / 60;
    const wcpm = Math.round(correct / durationMin); // words correct per minute
    const wpm = Math.round(totalWords / durationMin); // total words attempted per minute

    // Build error list
    const errors = [];
    for (let i = 0; i < wordStatuses.length; i++) {
      if (wordStatuses[i] === 'misread' || wordStatuses[i] === 'skipped') {
        errors.push({ word: words[i] || '', position: i + 1, type: wordStatuses[i] });
      }
    }

    // Determine level
    const level = accuracy >= 95 ? 'excellent'
                : accuracy >= 80 ? 'good'
                : accuracy >= 60 ? 'developing'
                : 'needs-practice';

    // Generate encouraging feedback via Groq
    let feedback = '';
    try {
      const errorSummary = errors.slice(0, 5).map(e => `"${e.word}" (${e.type})`).join(', ');
      const fbCompletion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [{
          role: 'user',
          content: `You are a warm, encouraging reading tutor for a ${grade || 'Grade 3'} student (age 8-11).
The student just read a passage aloud. Results:
- Accuracy: ${accuracy}%
- Speed: ${wcpm} words correct per minute
- Errors: ${errorSummary || 'none'}

Give brief, encouraging feedback (2-3 sentences max). Be specific about what they did well. If there are errors, gently suggest practising those words. Never be discouraging. Use simple language a child would understand.`,
        }],
        temperature: 0.7,
        max_tokens: 150,
      });
      feedback = fbCompletion.choices[0]?.message?.content?.trim() || '';
    } catch {
      // Fallback feedback
      if (accuracy >= 90) feedback = `Amazing reading! You got ${accuracy}% of the words right. Keep up the great work!`;
      else if (accuracy >= 70) feedback = `Good job! You read ${accuracy}% of the words correctly. Keep practising and you'll get even better!`;
      else feedback = `Nice try! Reading gets easier with practice. Try reading the passage again slowly, one word at a time.`;
    }

    // Star rewards: reading mode = 50 stars
    const starsEarned = STARS.read;

    // Auto-adjust Lexile based on errors
    let lexileChange = 0;
    let newLexile = null;
    if (studentEmail) {
      const lexileData = getStudentLexile(studentEmail);
      if (lexileData) {
        const errorCount = misread + skipped;
        if (errorCount > 5) lexileChange = -25;
        else if (errorCount < 3) lexileChange = 25;
        if (lexileChange !== 0) {
          newLexile = Math.max(100, Math.min(900, lexileData.lexile + lexileChange));
          lexileData.lexile = newLexile;
          lexileData.history = lexileData.history || [];
          lexileData.history.push({ date: new Date().toISOString(), lexile: newLexile, source: 'auto', errors: errorCount });
          if (lexileData.history.length > 50) lexileData.history.splice(0, lexileData.history.length - 50);
          saveStudentLexile(studentEmail, lexileData);
          console.log(`[read-aloud] Lexile ${lexileChange > 0 ? 'up' : 'down'}: ${newLexile} (errors=${errorCount})`);
        } else {
          newLexile = lexileData.lexile;
        }
      }
    }

    const result = {
      accuracy,
      wcpm,
      wpm,
      totalWords,
      correct,
      misread,
      skipped,
      duration: Math.round(duration),
      errors,
      feedback,
      level,
      starsEarned,
      lexile: newLexile,
      lexileChange,
    };

    // Save to history
    if (studentEmail) {
      try {
        const emailHash = crypto.createHash('md5').update(studentEmail).digest('hex').slice(0, 12);
        const historyPath = path.join(HISTORY_DIR, `${emailHash}.json`);
        const history = fs.existsSync(historyPath)
          ? JSON.parse(fs.readFileSync(historyPath, 'utf8'))
          : [];
        history.push({
          date: new Date().toISOString(),
          topic: topic || 'Unknown',
          grade: grade || 'Grade 3',
          accuracy,
          wcpm,
          level,
          totalWords,
          duration: Math.round(duration),
          starsEarned,
          lexile: newLexile,
        });
        // Keep last 50 entries
        if (history.length > 50) history.splice(0, history.length - 50);
        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
      } catch (e) {
        console.warn('[read-aloud] Failed to save history:', e.message);
      }
    }

    res.json(result);
  } catch (err) {
    console.error('[read-aloud/assess] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /read-aloud/history — Reading history for a student ─────────────
router.get('/history', (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'email required' });

  const emailHash = crypto.createHash('md5').update(email).digest('hex').slice(0, 12);
  const historyPath = path.join(HISTORY_DIR, `${emailHash}.json`);

  if (!fs.existsSync(historyPath)) return res.json({ history: [], stats: {} });

  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  const recent = history.slice(-10);

  // Compute stats
  const avgAccuracy = Math.round(recent.reduce((s, h) => s + h.accuracy, 0) / recent.length);
  const avgWcpm = Math.round(recent.reduce((s, h) => s + h.wcpm, 0) / recent.length);
  const totalSessions = history.length;
  const bestAccuracy = Math.max(...history.map(h => h.accuracy));
  const bestWcpm = Math.max(...history.map(h => h.wcpm));

  res.json({
    history: recent,
    stats: { avgAccuracy, avgWcpm, totalSessions, bestAccuracy, bestWcpm },
  });
});

// ── Whisper transcription helper ─────────────────────────────────────────
function splitWords(text) {
  return (text || '').split(/[-—–\s]+/).filter(Boolean);
}

function norm(w) {
  return (w || '').toLowerCase().replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');
}

function getStem(w) {
  if (!w) return '';
  let s = w.replace(/our($|s|ed|ing)/, 'or$1')
           .replace(/ise($|s|d|ing)/, 'ize$1')
           .replace(/tre($|s)/, 'ter$1')
           .replace(/isation($|s)/, 'ization$1')
           .replace(/aeroplane/, 'airplane')
           .replace(/grey/, 'gray');
  s = s.replace(/ied$/, 'y')
       .replace(/ies$/, 'y')
       .replace(/(.)\1(ed|ing)$/, '$1');
  if (w.length > 4 && !/(?:thing|ning|ling|ring|king|wing|spring|bring)$/.test(w)) {
    s = s.replace(/(?:es|s|ed|ing)$/, '');
  } else if (w.length > 3) {
    s = s.replace(/(?:es|s)$/, '');
  }
  return s;
}

const EQUIV_MAP = {
  'mr': ['mister'], 'mrs': ['missus', 'missis'], 'dr': ['doctor'], 'st': ['street', 'saint'],
  'vs': ['versus'], 'etc': ['etcetera'], 'and': ['&'],
  'hear': ['here'], 'here': ['hear'],
  'there': ['their', 'theyre'], 'their': ['there', 'theyre'], 'theyre': ['there', 'their'],
  'to': ['too', 'two'], 'too': ['to', 'two'], 'two': ['to', 'too'],
  'for': ['four'], 'four': ['for'],
  'no': ['know'], 'know': ['no'],
  'right': ['write'], 'write': ['right'],
  'by': ['buy'], 'buy': ['by'],
  'one': ['won'], 'won': ['one'],
  'cant': ['cannot'], 'cannot': ['cant'],
  'dont': ['do not'], 'wont': ['will not'],
  '10': ['ten'], '100': ['hundred', 'one hundred'], '1000': ['thousand', 'one thousand'],
  '1st': ['first'], '2nd': ['second'], '3rd': ['third'], '4th': ['fourth'], '5th': ['fifth'],
};

function isEquivalent(spoken, expected) {
  if (!spoken || !expected) return false;
  if (spoken === expected) return true;
  if (EQUIV_MAP[expected] && EQUIV_MAP[expected].includes(spoken)) return true;
  if (EQUIV_MAP[spoken] && EQUIV_MAP[spoken].includes(expected)) return true;
  return false;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = a[i-1] === b[j-1] ? d[i-1][j-1] : 1 + Math.min(d[i-1][j], d[i][j-1], d[i-1][j-1]);
  return d[m][n];
}

function fuzzy(spoken, expected) {
  if (!spoken || !expected) return false;
  if (spoken === expected) return true;
  if (isEquivalent(spoken, expected)) return true;

  const sStem = getStem(spoken);
  const eStem = getStem(expected);
  if (sStem.length >= 3 && sStem === eStem) return true;

  if (expected.length <= 5) return false;

  if (Math.abs(spoken.length - expected.length) > 2) return false;
  if (spoken.slice(0, 3) !== expected.slice(0, 3) && sStem.slice(0, 3) !== eStem.slice(0, 3)) return false;

  const maxDist = expected.length >= 10 ? 2 : 1;
  return levenshtein(spoken, expected) <= maxDist || (sStem.length >= 5 && levenshtein(sStem, eStem) <= maxDist);
}

// Optimal sequence alignment supporting 1-to-1, 1-to-2 (e.g. everyday -> every day), and 2-to-1 (e.g. can not -> cannot)
function matchWordsToPassage(spokenWords, passageWords, isLive = false) {
  const spoken = (spokenWords || []).map(norm).filter(Boolean);
  const passage = (passageWords || []).map(norm).filter(Boolean);
  const N = passage.length;
  const M = spoken.length;

  if (N === 0) return { statuses: [], matchedUpTo: 0 };
  if (M === 0) {
    const statuses = new Array(N).fill(isLive ? 'pending' : 'skipped');
    if (isLive && N > 0) statuses[0] = 'current';
    return { statuses, matchedUpTo: 0 };
  }

  const dp = Array.from({ length: M + 1 }, () => new Float32Array(N + 1));
  const trace = Array.from({ length: M + 1 }, () => new Uint8Array(N + 1));
  // Trace codes: 1 = SUB/match, 2 = DEL (skip passage word), 3 = INS (extra spoken word), 4 = 2-to-1 match, 5 = 1-to-2 match

  for (let i = 0; i <= M; i++) {
    dp[i][0] = i * 0.5;
    trace[i][0] = 3;
  }
  for (let j = 0; j <= N; j++) {
    dp[0][j] = j * 1.0;
    trace[0][j] = 2;
  }
  trace[0][0] = 0;

  for (let i = 1; i <= M; i++) {
    for (let j = 1; j <= N; j++) {
      const isMatch = fuzzy(spoken[i - 1], passage[j - 1]);
      const costSub = dp[i - 1][j - 1] + (isMatch ? 0 : 1.4);
      const costDel = dp[i][j - 1] + 1.0;
      const costIns = dp[i - 1][j] + 0.6;

      let minCost = costSub;
      let step = 1;
      if (costDel < minCost) { minCost = costDel; step = 2; }
      if (costIns < minCost) { minCost = costIns; step = 3; }

      // Check 2-to-1 (two spoken words match one passage word, e.g. "can" + "not" = "cannot")
      if (i >= 2) {
        if (fuzzy(spoken[i - 2] + spoken[i - 1], passage[j - 1])) {
          const cost2to1 = dp[i - 2][j - 1] + 0.0;
          if (cost2to1 < minCost) { minCost = cost2to1; step = 4; }
        }
      }

      // Check 1-to-2 (one spoken word matches two passage words, e.g. "everyday" = "every" + "day")
      if (j >= 2) {
        if (fuzzy(spoken[i - 1], passage[j - 2] + passage[j - 1])) {
          const cost1to2 = dp[i - 1][j - 2] + 0.0;
          if (cost1to2 < minCost) { minCost = cost1to2; step = 5; }
        }
      }

      dp[i][j] = minCost;
      trace[i][j] = step;
    }
  }

  const statuses = new Array(N).fill('pending');
  let i = M, j = N;
  let matchedUpTo = 0;

  while (i > 0 || j > 0) {
    const step = trace[i][j];
    if (step === 1) {
      j--; i--;
      if (fuzzy(spoken[i], passage[j])) {
        statuses[j] = 'correct';
        if (matchedUpTo === 0) matchedUpTo = j + 1;
      } else {
        statuses[j] = 'misread';
        if (matchedUpTo === 0) matchedUpTo = j + 1;
      }
    } else if (step === 2) {
      j--;
      statuses[j] = 'skipped';
    } else if (step === 3) {
      i--;
    } else if (step === 4) {
      j--; i -= 2;
      statuses[j] = 'correct';
      if (matchedUpTo === 0) matchedUpTo = j + 1;
    } else if (step === 5) {
      j -= 2; i--;
      statuses[j + 1] = 'correct';
      statuses[j] = 'correct';
      if (matchedUpTo === 0) matchedUpTo = j + 2;
    } else {
      break;
    }
  }

  if (isLive) {
    for (let k = matchedUpTo; k < N; k++) statuses[k] = 'pending';
    if (matchedUpTo < N) statuses[matchedUpTo] = 'current';
  } else {
    for (let k = 0; k < N; k++) {
      if (statuses[k] === 'pending' || statuses[k] === 'current') statuses[k] = 'skipped';
    }
  }

  return { statuses, matchedUpTo };
}

async function transcribeWithWhisper(audioBuffer, mimeType, passageHint) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('No GROQ_API_KEY');

  // Determine file extension from mime type
  const ext = mimeType?.includes('webm') ? 'webm'
            : mimeType?.includes('ogg')  ? 'ogg'
            : mimeType?.includes('mp4')  ? 'mp4'
            : mimeType?.includes('wav')  ? 'wav'
            : 'webm';

  // Use form-data npm package (not browser FormData) to reliably send multipart
  // from Node.js. Native fetch + browser Blob + FormData in Node can produce
  // a malformed multipart body that Groq rejects with 400.
  // Also: Groq Whisper does NOT support timestamp_granularities[] — removed.
  const form = new FormDataNode();
  form.append('file', audioBuffer, { filename: `recording.${ext}`, contentType: mimeType || 'audio/webm' });
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  form.append('language', 'en');
  form.append('timestamp_granularities[]', 'word');

  // Pass a vocabulary hint (NOT the full passage — Whisper treats the prompt
  // as "already spoken" context and will skip matching words at the start).
  // Extract unique long words as domain vocabulary hints only.
  if (passageHint) {
    const uniqueWords = [...new Set(passageHint.match(/\b[a-zA-Z]{5,}\b/g) || [])];
    const vocabHint = uniqueWords.slice(0, 30).join(', ');
    if (vocabHint) form.append('prompt', vocabHint);
  }

  const responseBody = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${apiKey}`,
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Whisper ${res.statusCode}: ${body.slice(0, 300)}`));
        } else {
          try { resolve(JSON.parse(body)); } catch { reject(new Error(`Whisper parse error: ${body.slice(0, 200)}`)); }
        }
      });
    });
    req.on('error', reject);
    form.pipe(req);
  });

  return responseBody;
}

// ── POST /read-aloud/transcribe-live — Lightweight live ASR for real-time highlight ──
// Called every ~3 seconds with the accumulated audio so far.
// Returns word-level statuses matched against the passage — no AI feedback, no history save.
router.post('/transcribe-live', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file' });

    const passageText = req.body.passage || '';
    const passageWords = splitWords(passageText);
    if (!passageWords.length) return res.json({ wordStatuses: [], matchedUpTo: 0 });

    const data = await transcribeWithWhisper(req.file.buffer, req.file.mimetype, passageText);
    const rawWords = data.words || [];
    const audioDuration = data.duration || 0;
    console.log(`[transcribe-live] duration=${audioDuration}s, rawWords=${rawWords.length}:`, rawWords.map(w => `${w.word}(${w.start?.toFixed(1)}s)`).join(', '));

    // Hallucination detection: if Whisper words don't span at least 25% of
    // the audio duration, they're likely noise-generated artifacts.
    // Real speech fills the audio; hallucinations cluster at 0.0s.
    const wordTimeSpan = rawWords.length > 0
      ? Math.max(...rawWords.map(w => w.end || w.start || 0)) - Math.min(...rawWords.map(w => w.start || 0))
      : 0;
    if (audioDuration > 1 && wordTimeSpan < audioDuration * 0.25) {
      console.log(`[transcribe-live] REJECTED: hallucination (span=${wordTimeSpan.toFixed(1)}s vs duration=${audioDuration.toFixed(1)}s)`);
      return res.json({ wordStatuses: new Array(passageWords.length).fill('pending'), matchedUpTo: 0 });
    }

    const whisperWords = rawWords.map(w => w.word);
    console.log(`[transcribe-live] duration=${audioDuration.toFixed(1)}s, words=${whisperWords.length}, span=${wordTimeSpan.toFixed(1)}s`);

    const { statuses, matchedUpTo } = matchWordsToPassage(whisperWords, passageWords, true);

    // Time-based cap: a child reads max ~3 words/second.
    // If Whisper hallucinated matches from noise, matchedUpTo will be impossibly high.
    let pos = matchedUpTo;
    const maxByDuration = Math.ceil(audioDuration * 3);
    if (pos > maxByDuration) {
      console.log(`[transcribe-live] CAPPED ${pos} → ${maxByDuration} (${audioDuration.toFixed(1)}s audio)`);
      for (let i = maxByDuration; i < passageWords.length; i++) statuses[i] = 'pending';
      pos = maxByDuration;
      if (pos < passageWords.length) statuses[pos] = 'current';
    }

    console.log(`[transcribe-live] matched ${pos}/${passageWords.length}`);
    res.json({ wordStatuses: statuses, matchedUpTo: pos });
  } catch (err) {
    console.error('[read-aloud/transcribe-live] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /read-aloud/transcribe — Transcribe recorded audio + match words ──
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file' });

    const passageText = req.body.passage || '';
    const passageWords = splitWords(passageText);

    console.log(`[read-aloud/transcribe] Received ${(req.file.size / 1024).toFixed(0)}KB audio (${req.file.mimetype}), passage: ${passageWords.length} words`);

    const data = await transcribeWithWhisper(req.file.buffer, req.file.mimetype, passageText);
    const transcript = data.text || '';
    const whisperWords = (data.words || []).map(w => w.word);

    console.log(`[read-aloud/transcribe] Whisper: "${transcript.slice(0, 100)}..." (${whisperWords.length} words)`);

    // Match spoken words against passage (isLive = false)
    const { statuses, matchedUpTo } = matchWordsToPassage(whisperWords, passageWords, false);

    res.json({
      transcript,
      whisperWords,
      wordStatuses: statuses,
      matchedUpTo,
      totalWords: passageWords.length,
    });
  } catch (err) {
    console.error('[read-aloud/transcribe] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /read-aloud/deepgram-key — Provide Deepgram API key to client ───
router.get('/deepgram-key', (req, res) => {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return res.status(500).json({ error: 'DEEPGRAM_API_KEY not configured' });
  res.json({ key });
});

// ── POST /read-aloud/tts — Generate audio for a passage ─────────────────
router.post('/tts', express.json(), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });

    const { hash } = getTTSCachePaths(text);

    // Serve from persistent cache (Cloudinary in prod → absolute URL; local disk in dev)
    const cached = await getCachedAudio(hash, AUDIO_DIR);
    if (cached) {
      return res.json({ audioUrl: cached.mp3Url, wordTimings: cached.timings, cached: true });
    }

    // Generate via ElevenLabs → persist to Cloudinary (timings come from ElevenLabs)
    const { buffer, wordTimings } = await generateTTS(text);
    const { mp3Url } = await saveAudio(hash, AUDIO_DIR, buffer, wordTimings || undefined);
    console.log(`[read-aloud/tts] Generated ${(buffer.length / 1024).toFixed(0)}KB audio, timings=${!!wordTimings}`);

    res.json({
      audioUrl: mp3Url,
      wordTimings: wordTimings || null,
      cached: false,
    });
  } catch (err) {
    console.error('[read-aloud/tts] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /read-aloud/tts/preload — Warm local TTS cache for curated passages ──
router.post('/tts/preload', express.json(), async (req, res) => {
  const { grade = 'all' } = req.body || {};
  const grades = grade === 'all'
    ? Object.keys(SEED_PASSAGES)
    : [grade];

  const summary = { requested: 0, cached: 0, generated: 0, failed: 0, errors: [] };

  for (const g of grades) {
    const passages = SEED_PASSAGES[g] || [];
    for (const passage of passages) {
      summary.requested++;
      const { hash } = getTTSCachePaths(passage.text);
      const cached = await getCachedAudio(hash, AUDIO_DIR);
      if (cached) {
        summary.cached++;
        continue;
      }

      try {
        const { buffer, wordTimings } = await generateTTS(passage.text);
        await saveAudio(hash, AUDIO_DIR, buffer, wordTimings || undefined);
        summary.generated++;
      } catch (err) {
        summary.failed++;
        summary.errors.push({ grade: g, title: passage.title, error: err.message });
      }
    }
  }

  res.json(summary);
});

module.exports = router;
