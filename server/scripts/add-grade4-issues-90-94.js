require('dotenv').config();
const { QdrantClient } = require('@qdrant/js-client-rest');
const { pipeline } = require('@xenova/transformers');
const { v4: uuidv4 } = require('uuid');

const client = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY, checkCompatibility: false });

const TOPICS = [
  {
    topic: 'Estimation and Rounding Off',
    unit: 'Number',
    description: 'Rounding numbers to the nearest 10, 100, and 1000, and estimating answers in real-life situations.',
    chunks: [
      'Estimation and Rounding Off is studied in Grade 4 IB PYP Mathematics. An estimate is a sensible guess that is close to the real answer, found by rounding numbers to make them simpler before working with them.',
      'The rounding rule: look at the digit in the place you are rounding to. If it is 0, 1, 2, 3, or 4, round down (the digit stays the same and everything after becomes 0). If it is 5, 6, 7, 8, or 9, round up (the digit increases by 1 and everything after becomes 0). Example: 47 rounded to the nearest 10 is 50 (ones digit 7 rounds up). 43 rounded to the nearest 10 is 40 (ones digit 3 rounds down).',
      'Rounding to the nearest 100: look at the tens digit. 350 rounds up to 400 (tens digit 5). 240 rounds down to 200 (tens digit 4). Rounding to the nearest 1000: look at the hundreds digit. 4500 rounds up to 5000 (hundreds digit 5). 3200 rounds down to 3000 (hundreds digit 2).',
      'Practice example: round 2780 to the nearest 100. The tens digit is 8, which is 5 or more, so round up to 2800.',
      'Estimation in real life: if you buy three items costing 198, 95, and 210 rupees, round each to the nearest 100 (200, 100, 200) and add them to estimate the total is about 500 rupees, before working out the exact total.',
    ],
  },
  {
    topic: 'Properties of Lines',
    unit: 'Shape and Space',
    description: 'Parallel, perpendicular, horizontal, vertical, and intersecting lines.',
    chunks: [
      'Properties of Lines is studied in Grade 4 IB PYP Mathematics, under Shape and Space. There are five special types of lines to recognise: horizontal, vertical, parallel, perpendicular, and intersecting lines.',
      'A horizontal line runs flat from left to right, like the horizon or the top and bottom edges of a book. A vertical line runs straight up and down, like a flagpole or the edge of a door.',
      'Parallel lines point in the same direction and stay the same distance apart forever, never meeting, like railway tracks or the two long edges of a ruler.',
      'Perpendicular lines meet at a perfect right angle of 90 degrees, like the corner of a page or the letter L. Intersecting lines cross each other at any one point and any angle; perpendicular lines are a special type of intersecting lines that cross at exactly 90 degrees.',
      'Spotting lines in real life: the top and side edges of a door meet at a corner (perpendicular), the two edges of a ladder rail never meet (parallel to each other), and the rungs of a ladder are parallel to each other and perpendicular to the side rails.',
    ],
  },
  {
    topic: 'Types of Fractions',
    unit: 'Number',
    description: 'Unit, proper, improper, mixed, like, and unlike fractions, with bar models.',
    chunks: [
      'Types of Fractions is studied in Grade 4 IB PYP Mathematics. A fraction has a numerator (top number, how many parts we have) and a denominator (bottom number, how many equal parts the whole is split into).',
      'A unit fraction has 1 as its numerator, such as 1/4, 1/3, or 1/5 — just one part of the whole. A proper fraction has a numerator smaller than its denominator, so it is always less than one whole, such as 3/4.',
      'An improper fraction has a numerator equal to or greater than its denominator, so it represents one whole or more, such as 7/4. A mixed fraction combines a whole number with a proper fraction, such as 1 3/4, which is the same as 7/4.',
      'Like fractions have the same denominator, such as 2/5 and 3/5, making them easy to compare and add directly. Unlike fractions have different denominators, such as 1/2 and 1/3, and need extra steps (like finding a common denominator) to compare.',
      'Bar models help visualise fractions: a bar split into 4 equal parts with 3 shaded shows 3/4 (a proper fraction); a bar split into 4 parts that is fully shaded plus 3 more parts of a second bar shows 7/4 or 1 3/4 (an improper/mixed fraction). Example: classify 5/8 — numerator 5 is less than denominator 8, so it is a proper fraction (and not a unit fraction since the numerator is more than 1).',
    ],
  },
  {
    topic: 'Fractions on a Number Line',
    unit: 'Number',
    description: 'Placing and comparing fractions on a number line.',
    chunks: [
      'Fractions on a Number Line is studied in Grade 4 IB PYP Mathematics. Fractions can be placed in the space between whole numbers on a number line by splitting that space into equal hops.',
      'To show quarters, split the gap from 0 to 1 into 4 equal hops. After 1 hop you are at 1/4, after 2 hops at 2/4 (equal to 1/2), after 3 hops at 3/4, and after 4 hops you reach the whole number 1.',
      'To show thirds, split the same gap from 0 to 1 into 3 equal hops instead, each hop now being 1/3 — a bigger step than 1/4 because there are fewer hops covering the same distance.',
      'Comparing fractions on a number line: whichever fraction sits further to the right is the larger fraction. Since 1/3 needs a bigger hop than 1/4 to cover the same gap, 1/3 is greater than 1/4. Similarly, 1/2 is greater than 1/5.',
      'Real-life example: a ruler is a number line — the small marks between centimetres show fractions like half or a quarter of a centimetre. Measuring jugs work the same way, with marks between litres showing fractional amounts.',
    ],
  },
  {
    topic: 'Conversion of Length Units',
    unit: 'Measurement',
    description: 'Converting between kilometres, metres, centimetres, and millimetres, with real-life measurement problems.',
    chunks: [
      'Conversion of Length Units is studied in Grade 4 IB PYP Mathematics. The length conversion chart: 1 kilometre (km) = 1000 metres (m), 1 metre = 100 centimetres (cm), 1 centimetre = 10 millimetres (mm). To go down the chart (bigger unit to smaller unit), multiply. To go up the chart (smaller unit to bigger unit), divide.',
      'Example: kilometres to metres — multiply by 1000. 3 km = 3 x 1000 = 3000 m. Example: metres to centimetres — multiply by 100. 5 m = 5 x 100 = 500 cm. Example: centimetres to millimetres — multiply by 10. 7 cm = 7 x 10 = 70 mm.',
      'Going the other way (smaller to bigger unit), divide. 250 cm divided by 100 = 2.5 m. Practice: 2 km = 2 x 1000 = 2000 m.',
      'Application of measurement in real life — adding volumes: 1 litre (L) = 1000 millilitres (ml). To add 2 L 200 ml and 1 L 300 ml, add the litres (2 + 1 = 3) and the millilitres (200 + 300 = 500) separately, giving a total of 3 L 500 ml.',
      'Practice questions: How many centimetres are in 4 metres? (400 cm, multiply 4 x 100). How many millimetres are in 1 metre? (1000 mm, since 1 m = 100 cm = 100 x 10 mm).',
    ],
  },
  {
    topic: 'Successors and Predecessors',
    unit: 'Number',
    description: 'Finding the number that comes just before (predecessor) and just after (successor) a given number.',
    chunks: [
      'Successors and Predecessors is studied in Grade 4 IB PYP Mathematics. The successor of a number is the number that comes right after it — found by adding 1. The successor of 47 is 47 + 1 = 48.',
      'The predecessor of a number is the number that comes right before it — found by subtracting 1. The predecessor of 47 is 47 - 1 = 46. Together, 46 (predecessor), 47 (number), and 48 (successor) sit in order on the number line.',
      'Tricky cases near round numbers: the successor of 9 is 9 + 1 = 10, and the predecessor of 10 is 10 - 1 = 9 — the whole number changes shape. The same applies to bigger numbers: the successor of 999 is 999 + 1 = 1000, and the predecessor of 1000 is 1000 - 1 = 999, where all digits change at once.',
      'Practice: the successor of 2999 is 2999 + 1 = 3000, and the predecessor of 3000 is 3000 - 1 = 2999.',
      'Real-life example: token, ticket, and page numbers use successors and predecessors. If a token number is 199, the next token number (its successor) is 200. Practice question: the predecessor of 500 is 499.',
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
          subject:     'Mathematics',
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
  console.log(`\nDone. Added ${TOPICS.length} topics (${points.length} chunks) to Grade 4 Mathematics.`);
}

run().catch(console.error);
