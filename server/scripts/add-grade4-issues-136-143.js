require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const { pipeline } = require('@xenova/transformers');
const { v4: uuidv4 } = require('uuid');

const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

const TOPICS = [
  {
    subject: 'Social Studies',
    topic: 'Space Exploration',
    unit: 'Space and Beyond',
    description: 'The age of the universe, the Milky Way, the Sun and Earth; supernovas, light years, the history of the universe, astronaut training, and astronaut research (Sunita Williams).',
    chunks: [
      'Space Exploration is studied in Grade 4 IB PYP Social Studies. The universe is everything that exists - all of space, time, planets, stars, galaxies, and matter. Scientists estimate the universe is about 13.8 billion years old, formed in an event called the Big Bang.',
      'A supernova is a huge explosion that happens at the end of a massive star\'s life. When a supernova occurs, it briefly outshines an entire galaxy and scatters elements like iron and gold into space - some of these elements later become part of new stars, planets, and even living things.',
      'A light year is the distance that light travels in one year - about 9.46 trillion kilometres. Scientists use light years to measure huge distances in space because the numbers in kilometres would be far too large to write easily. The nearest star to our Sun is about 4.2 light years away.',
      'Our home galaxy, the Milky Way, is about 13.6 billion years old and contains hundreds of billions of stars, including our Sun. Our Sun formed about 4.6 billion years ago, and the Earth formed shortly after, about 4.5 billion years ago, from the same cloud of dust and gas.',
      'History of the universe (timeline): about 13.8 billion years ago the universe began with the Big Bang; about 13.6 billion years ago galaxies like the Milky Way started forming; about 4.6 billion years ago our Sun formed; about 4.5 billion years ago Earth formed; life on Earth began roughly 3.5-4 billion years ago.',
      'Astronauts go through years of intense training before they can travel to space, including learning to operate spacecraft, surviving in extreme conditions, performing spacewalks in giant swimming pools that simulate zero gravity, and studying science experiments they will run in space.',
      'Sunita Williams is an American astronaut of Indian origin who has spent a record amount of time in space for a woman, including multiple long-duration missions to the International Space Station. She has performed spacewalks and conducted scientific research in microgravity, inspiring many students around the world, especially in India, to dream about careers in space exploration.',
      'Space technology helps life on Earth in many ways: satellites support telecommunications (phone calls, internet, TV), help meteorologists with weather forecasting, and allow scientists to monitor the environment - tracking deforestation, ice melt, and greenhouse gas emissions to help address climate change.',
    ],
  },
  {
    subject: 'Science',
    topic: 'Human Body - Nervous System',
    unit: 'Human Body Systems',
    description: 'The nervous system, the Central Nervous System (CNS), the Peripheral Nervous System (PNS), and the cerebrum.',
    chunks: [
      'The Nervous System is studied in Grade 4 IB PYP Science, as part of Human Body Systems. The nervous system is the body\'s communication network. It is made up of the brain, the spinal cord, and nerves that carry messages between the brain and the rest of the body.',
      'The nervous system has two main parts: the Central Nervous System (CNS) and the Peripheral Nervous System (PNS). The CNS is made up of the brain and the spinal cord - it is the control centre that processes information and decides how the body should respond.',
      'The Peripheral Nervous System (PNS) is made up of all the nerves that branch out from the brain and spinal cord to every other part of the body. The PNS carries messages from the CNS to muscles and organs, and carries information from the senses back to the CNS.',
      'The brain has different parts with different jobs. The cerebrum is the largest part of the brain. It controls thinking, memory, problem solving, language, the senses, and voluntary body movements like walking and writing.',
      'How a message travels: when you touch something hot, nerves in your skin (PNS) send a signal to your spinal cord and brain (CNS). The brain processes the signal almost instantly and sends a message back through the nerves to your muscles, telling your hand to pull away - this fast response can happen so quickly it is called a reflex.',
    ],
  },
];

async function run() {
  console.log('Loading embedder...');
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const points = [];
  for (const t of TOPICS) {
    for (let i = 0; i < t.chunks.length; i++) {
      const text = t.chunks[i];
      const output = await embedder(text, { pooling: 'mean', normalize: true });
      points.push({
        id: uuidv4(),
        vector: Array.from(output.data),
        payload: {
          grade:       'Grade 4',
          subject:     t.subject,
          curriculum:  'IB_PYP',
          unit:        t.unit,
          topic:       t.topic,
          description: t.description,
          text,
          chunk_index: i,
          source:      'curated',
        },
      });
      console.log(`  Embedded "${t.topic}" chunk ${i + 1}/${t.chunks.length}`);
    }
  }

  await client.upsert('ai_mentor_content', { wait: true, points });
  console.log(`\nDone. Added ${TOPICS.length} topics (${points.length} chunks) to Grade 4 content.`);
}

run().catch(console.error);
