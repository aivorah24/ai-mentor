require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const { pipeline } = require('@xenova/transformers');
const { v4: uuidv4 } = require('uuid');

const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

const TOPICS = [
  {
    topic: 'Rhythm',
    description: 'The pattern of beats in music — tempo, pulse, and rhythmic patterns.',
    chunks: [
      'Rhythm is studied in Grade 4 IB PYP Arts (Music). Rhythm is the pattern of sounds and silences in music. Every piece of music has a beat — a steady pulse like a heartbeat. Rhythm is how long or short sounds are arranged over that beat. Think of clapping: clap-clap-CLAP is a rhythm pattern. In music, rhythm is written using notes: a whole note lasts 4 beats, a half note 2 beats, a quarter note 1 beat, and an eighth note half a beat.',
      'Types of rhythmic patterns: A steady beat is called a pulse. When you tap your foot to music, you are feeling the pulse. Rhythm patterns sit on top of the pulse. Syncopation is when the rhythm deliberately goes against the expected beat — jazz music uses a lot of syncopation. A rest means silence — no sound for that beat. Learning to count rhythms: "1 and 2 and 3 and 4 and" helps students feel both the beats and the off-beats. Different cultures have unique rhythmic traditions — tabla in Indian classical music creates complex rhythmic cycles called tala.',
      'Rhythm in everyday life: Before formal music notation, humans made rhythm by clapping, stomping, and drumming. African drumming traditions, Indian classical tabla, Latin percussion — rhythm is the universal language of music. Fun facts: The heartbeat is nature\'s rhythm (about 60–100 beats per minute). A metronome is a tool musicians use to keep steady rhythm. The word "rhythm" comes from the Greek word rhythmos meaning "flow".',
    ],
  },
  {
    topic: 'Tempo and Dynamics',
    description: 'How fast or slow music is played (tempo) and how loud or soft (dynamics).',
    chunks: [
      'Tempo and Dynamics are studied in Grade 4 IB PYP Arts (Music). Tempo is the speed of music — how fast or slow it moves. Dynamics refers to how loud or soft the music is. Together, tempo and dynamics shape the mood and feeling of a piece of music. A fast, loud piece feels exciting and energetic. A slow, soft piece feels calm and peaceful.',
      'Tempo markings (from slowest to fastest): Largo (very slow, broad), Adagio (slow and stately), Andante (walking pace), Moderato (moderate speed), Allegro (fast and lively), Presto (very fast). These are Italian words — Italy was the centre of classical music in the 1600s and 1700s, so Italian terms became the standard worldwide. Example: Beethoven\'s "Ode to Joy" is marked Allegro — fast and joyful.',
      'Dynamic markings: pp (pianissimo) = very soft, p (piano) = soft, mp (mezzo-piano) = medium soft, mf (mezzo-forte) = medium loud, f (forte) = loud, ff (fortissimo) = very loud. Special markings: crescendo (getting louder — shown as <), decrescendo/diminuendo (getting softer — shown as >). Fun fact: The piano was originally called "pianoforte" meaning "soft-loud" in Italian because it could play both soft and loud, unlike the harpsichord which could only play one volume.',
    ],
  },
  {
    topic: 'Timbre',
    description: 'The unique tone colour of an instrument or voice — why a guitar sounds different from a flute.',
    chunks: [
      'Timbre is studied in Grade 4 IB PYP Arts (Music). Timbre (pronounced "tam-ber") is the unique quality or colour of a sound that makes one instrument or voice different from another, even when playing the same note at the same volume. It is sometimes called "tone colour". Timbre is why a guitar playing the note A sounds completely different from a flute playing the same note A.',
      'What creates timbre? The shape of the instrument, the material it is made from, and how sound is produced all affect timbre. A violin has a warm, singing tone because a bow draws across strings. A trumpet has a bright, brassy tone because air vibrates through a metal tube. A drum has a resonant boom because hitting a membrane creates complex vibrations. The human voice has unique timbre too — that is why you can recognise your friend\'s voice on the phone.',
      'Categories of vocal timbre: Soprano (highest female voice), Alto/Contralto (lower female voice), Tenor (higher male voice), Bass (lowest male voice). In Indian classical music, timbre is called "swara quality" and each raga uses instruments chosen for their specific timbre to create a mood. Interesting fact: When you describe music as "bright", "warm", "harsh", or "mellow" — you are describing timbre. The study of timbre is one reason why orchestras have so many different instruments.',
    ],
  },
  {
    topic: 'Families of the Orchestra',
    description: 'The four instrument families — Strings, Brass, Woodwind, and Percussion.',
    chunks: [
      'Families of the Orchestra is studied in Grade 4 IB PYP Arts (Music). A symphony orchestra has about 80–100 musicians playing instruments that are grouped into four families: Strings, Woodwind, Brass, and Percussion. Each family makes sound in a different way and sits in a specific area of the orchestra. The conductor stands in the centre and directs all the musicians together.',
      'String family: Instruments whose strings vibrate to make sound — violin, viola, cello, double bass, harp. The string section is the largest in the orchestra. Bowing (drawing a bow across strings) or plucking (pizzicato) creates sound. From smallest (highest pitch) to largest (lowest pitch): violin → viola → cello → double bass. Indian equivalent: sitar, sarod, veena are string instruments. Woodwind family: Originally made of wood, now sometimes metal — flute, oboe, clarinet, bassoon, piccolo, saxophone. Air blown across or through the instrument creates sound. Flute is blown across a hole; clarinet uses a single reed; oboe uses a double reed.',
      'Brass family: Made of metal tubes bent into coils — trumpet, French horn, trombone, tuba. Sound made by buzzing lips into a mouthpiece. The tuba is the largest and lowest-pitched brass instrument. Trumpet plays fanfares; French horn has a rich mellow sound. Percussion family: Any instrument played by hitting, shaking, or scraping — drums (timpani, snare drum, bass drum), cymbals, xylophone, glockenspiel, triangle, tambourine, maracas. Divided into pitched (xylophone — makes specific notes) and unpitched (bass drum — just provides rhythm). Fun fact: The piano is technically a percussion instrument because felt hammers hit strings inside!',
    ],
  },
];

async function run() {
  console.log('Loading embedder...');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const points = [];
  for (const topic of TOPICS) {
    for (let i = 0; i < topic.chunks.length; i++) {
      const output = await embedder(topic.chunks[i], { pooling: 'mean', normalize: true });
      points.push({
        id: uuidv4(),
        vector: Array.from(output.data),
        payload: {
          grade:       'Grade 4',
          subject:     'Arts',
          curriculum:  'IB_PYP',
          unit:        'Music',
          topic:       topic.topic,
          description: topic.description,
          text:        topic.chunks[i],
          chunk_index: i,
          source:      'curated',
        },
      });
      console.log(`  Embedded: ${topic.topic} chunk ${i + 1}/${topic.chunks.length}`);
    }
  }

  await client.upsert('ai_mentor_content', { wait: true, points });
  console.log(`\nDone. Added ${points.length} Arts/Music points for Grade 4.`);
}

run().catch(console.error);
