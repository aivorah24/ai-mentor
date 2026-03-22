/**
 * seed-ncert-math.js
 * Seeds NCERT Mathematics content for Classes 3, 4 & 5 into Qdrant.
 * Fetches rich content from Wikipedia + uses detailed NCERT-aligned descriptions.
 *
 * Usage:  node scripts/seed-ncert-math.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const axios = require('axios');
const crypto = require('crypto');
const { embed } = require('../services/embeddings');
const { upsertContent, initCollection } = require('../services/qdrant');

const CURRICULUM = 'NCERT';
const SEEDER_TAG = 'seed_ncert_math';

// ─────────────────────────────────────────────────────────────────────────────
// NCERT Mathematics Topics — Classes 3, 4, 5
// ─────────────────────────────────────────────────────────────────────────────
const TOPICS = [
  // ══════════════════════════════════════════════════════════════
  // CLASS 3 — NCERT Maths Magic
  // ══════════════════════════════════════════════════════════════
  {
    grade: 'Class 3', subject: 'Mathematics', unit: 'Numbers', topic: 'Where to Look for Numbers',
    wiki: 'Natural_number',
    desc: 'Students explore numbers in everyday life — on buses, calendars, clocks, and price tags. They practise reading and writing numbers up to 999, understand number names, and compare numbers using greater than and less than symbols. Activities include number hunts and sorting.',
  },
  {
    grade: 'Class 3', subject: 'Mathematics', unit: 'Numbers', topic: 'Fun with Numbers',
    wiki: 'Positional_notation',
    desc: 'Students learn about odd and even numbers, number patterns, skip counting by 2s, 5s, and 10s. They arrange numbers in ascending and descending order, find the greatest and smallest numbers, and play number games. Place value of hundreds, tens, and ones is introduced.',
  },
  {
    grade: 'Class 3', subject: 'Mathematics', unit: 'Addition', topic: 'Give and Take',
    wiki: 'Addition',
    desc: 'Addition of 3-digit numbers with and without carrying (regrouping). Students learn to add using the column method, estimate sums, and solve word problems involving money, distances, and quantities. Mental addition strategies like breaking numbers are taught.',
  },
  {
    grade: 'Class 3', subject: 'Mathematics', unit: 'Subtraction', topic: 'Long and Short',
    wiki: 'Subtraction',
    desc: 'Subtraction of 3-digit numbers with and without borrowing. Students subtract to find differences in lengths, weights, and quantities. Word problems include comparing heights of buildings, distances between cities, and removing items from a collection.',
  },
  {
    grade: 'Class 3', subject: 'Mathematics', unit: 'Multiplication', topic: 'Multiplication',
    wiki: 'Multiplication',
    desc: 'Multiplication as repeated addition. Students learn times tables from 2 to 10, use arrays and equal groups, and multiply 2-digit numbers by 1-digit numbers. Real-world contexts include buying multiple items at the same price and arranging objects in rows.',
  },
  {
    grade: 'Class 3', subject: 'Mathematics', unit: 'Division', topic: 'Division',
    wiki: 'Division_(mathematics)',
    desc: 'Division as equal sharing and grouping. Students divide objects into equal groups, learn the relationship between multiplication and division, and solve simple division problems. Introduction to remainders using real-life examples like distributing sweets equally.',
  },
  {
    grade: 'Class 3', subject: 'Mathematics', unit: 'Measurement', topic: 'Jugs and Mugs',
    wiki: 'Volume',
    desc: 'Measuring capacity and volume using litres and millilitres. Students compare containers, estimate how much liquid they hold, and convert between litres and millilitres. Activities include filling jugs, measuring cooking ingredients, and solving capacity word problems.',
  },
  {
    grade: 'Class 3', subject: 'Mathematics', unit: 'Measurement', topic: 'Can We Share?',
    wiki: 'Fraction',
    desc: 'Introduction to fractions — half, quarter, three-quarters, and one-third. Students share food items equally, fold paper, and shade shapes. They compare fractions and understand that fractions represent equal parts of a whole or a group.',
  },
  {
    grade: 'Class 3', subject: 'Mathematics', unit: 'Geometry', topic: 'Shapes and Designs',
    wiki: 'Geometric_shape',
    desc: 'Identifying and describing 2D shapes (circle, square, triangle, rectangle, hexagon). Students sort shapes by properties, find shapes in environment, create patterns using shapes, and explore symmetry. Introduction to tessellations using tiles and stamps.',
  },
  {
    grade: 'Class 3', subject: 'Mathematics', unit: 'Measurement', topic: 'Time Goes On',
    wiki: 'Time',
    desc: 'Reading time on analog clocks to the nearest 5 minutes. Students learn hours, half-hours, quarter-hours, AM and PM. They read calendars, calculate elapsed time, and understand days, weeks, months, and years in a year. Daily schedule activities are included.',
  },
  {
    grade: 'Class 3', subject: 'Mathematics', unit: 'Data Handling', topic: 'Smart Charts',
    wiki: 'Pictogram',
    desc: 'Reading and making pictographs and tally charts. Students collect data from their class (favourite fruits, colours, pets), organise it into tables, and represent it using pictures. They answer questions using data from charts.',
  },
  {
    grade: 'Class 3', subject: 'Mathematics', unit: 'Money', topic: 'Rupees and Paise',
    wiki: 'Indian_rupee',
    desc: 'Identifying Indian coins and notes. Students count money, add prices, calculate change, and solve shopping word problems. Activities include role-playing as shopkeeper and customer, making bills, and understanding the value of different denominations.',
  },

  // ══════════════════════════════════════════════════════════════
  // CLASS 4 — NCERT Maths Magic
  // ══════════════════════════════════════════════════════════════
  {
    grade: 'Class 4', subject: 'Mathematics', unit: 'Numbers', topic: 'Building with Bricks',
    wiki: 'Positional_notation',
    desc: 'Place value of 4-digit and 5-digit numbers. Students read, write, compare, and order numbers up to 99,999. They learn about the Indian number system with periods (ones, thousands, lakhs) and practise expanded form, standard form, and word form.',
  },
  {
    grade: 'Class 4', subject: 'Mathematics', unit: 'Addition & Subtraction', topic: 'Long Long Journey',
    wiki: 'Addition',
    desc: 'Addition and subtraction of 4-digit and 5-digit numbers with regrouping. Students solve multi-step word problems involving distance, money, and population. Estimation of sums and differences using rounding is introduced along with the column algorithm.',
  },
  {
    grade: 'Class 4', subject: 'Mathematics', unit: 'Multiplication', topic: 'Tick-Tick-Tick',
    wiki: 'Multiplication',
    desc: 'Multiplication of 2-digit and 3-digit numbers by 1-digit and 2-digit numbers using the standard algorithm. Students apply multiplication to time calculations (minutes in hours, seconds in minutes), area of rectangles, and real-world quantity problems.',
  },
  {
    grade: 'Class 4', subject: 'Mathematics', unit: 'Division', topic: 'The Way the World Looks',
    wiki: 'Division_(mathematics)',
    desc: 'Long division of 3-digit numbers by 1-digit numbers. Students understand the division algorithm (divide, multiply, subtract, bring down), interpret remainders in context, and use division to share equally, find rates, and solve word problems.',
  },
  {
    grade: 'Class 4', subject: 'Mathematics', unit: 'Fractions', topic: 'The Junk Seller',
    wiki: 'Fraction',
    desc: 'Fractions with same and different denominators. Students compare fractions, find equivalent fractions, add and subtract like fractions, and represent fractions on a number line. Real-life contexts include sharing food, measuring ingredients, and dividing land.',
  },
  {
    grade: 'Class 4', subject: 'Mathematics', unit: 'Measurement', topic: 'Carts and Wheels',
    wiki: 'Circle',
    desc: 'Introduction to circles — centre, radius, diameter, and circumference. Students use a compass to draw circles, measure radius and diameter, and explore the relationship between them. Activities include designing wheel patterns and measuring circular objects.',
  },
  {
    grade: 'Class 4', subject: 'Mathematics', unit: 'Geometry', topic: 'Halves and Quarters',
    wiki: 'Symmetry',
    desc: 'Lines of symmetry in 2D shapes and real-life objects. Students fold shapes to find lines of symmetry, identify symmetric figures, complete symmetric patterns on grids, and create symmetric designs. Mirror symmetry is explored through paper folding and drawing.',
  },
  {
    grade: 'Class 4', subject: 'Mathematics', unit: 'Measurement', topic: 'Fields and Fences',
    wiki: 'Area',
    desc: 'Concept of area as the space covered by a shape. Students count unit squares to find area of rectangles and irregular shapes on grid paper. They calculate perimeter as the total boundary length and solve problems about fencing fields and tiling floors.',
  },
  {
    grade: 'Class 4', subject: 'Mathematics', unit: 'Data Handling', topic: 'Tables and Shares',
    wiki: 'Bar_chart',
    desc: 'Reading and constructing bar graphs from data. Students collect data, organise it in frequency tables, and draw bar graphs with appropriate scale. They interpret bar graphs to answer questions about most popular, least popular, and total counts.',
  },
  {
    grade: 'Class 4', subject: 'Mathematics', unit: 'Patterns', topic: 'Smart Charts',
    wiki: 'Sequence',
    desc: 'Number patterns, growing patterns, and repeating patterns. Students identify rules in sequences (add 3, multiply by 2), extend patterns, create their own patterns, and connect patterns to multiplication tables. Magic squares and number puzzles are explored.',
  },

  // ══════════════════════════════════════════════════════════════
  // CLASS 5 — NCERT Maths Magic
  // ══════════════════════════════════════════════════════════════
  {
    grade: 'Class 5', subject: 'Mathematics', unit: 'Numbers', topic: 'The Fish Tale',
    wiki: 'Large_numbers',
    desc: 'Reading and writing large numbers up to crores in the Indian number system and billions in the International system. Students compare place value in both systems, convert between them, and apply large numbers to real-world contexts like population and distances.',
  },
  {
    grade: 'Class 5', subject: 'Mathematics', unit: 'Shapes', topic: 'Shapes and Angles',
    wiki: 'Angle',
    desc: 'Types of angles — acute, obtuse, right, straight, and reflex. Students measure angles using protractors, classify triangles by angles (acute, obtuse, right-angled), and explore angles in real-life objects. Activities include creating angle viewers and measuring classroom angles.',
  },
  {
    grade: 'Class 5', subject: 'Mathematics', unit: 'Multiplication & Division', topic: 'How Many Squares?',
    wiki: 'Area',
    desc: 'Area of rectangles and squares using the formula (length × breadth). Students calculate area in square centimetres and square metres, compare areas, and solve problems about tiling, farming, and flooring. Relationship between area and perimeter is explored.',
  },
  {
    grade: 'Class 5', subject: 'Mathematics', unit: 'Fractions', topic: 'Parts and Wholes',
    wiki: 'Fraction',
    desc: 'Addition and subtraction of unlike fractions by finding the LCM of denominators. Students multiply fractions, find fractions of quantities, and understand mixed numbers. Real-world problems involve recipes, distances, and sharing unequal portions.',
  },
  {
    grade: 'Class 5', subject: 'Mathematics', unit: 'Decimals', topic: 'Does it Look the Same?',
    wiki: 'Decimal',
    desc: 'Introduction to decimals as an extension of fractions with denominators 10, 100, and 1000. Students read and write decimals, place decimals on a number line, compare and order decimals, and convert between fractions and decimals. Money and measurement contexts are used.',
  },
  {
    grade: 'Class 5', subject: 'Mathematics', unit: 'Decimals', topic: 'Be My Multiple, I\'ll be Your Factor',
    wiki: 'Divisor',
    desc: 'Factors, multiples, prime numbers, and composite numbers. Students find factors of numbers, identify prime and composite numbers up to 100, find HCF (Highest Common Factor) and LCM (Lowest Common Multiple) using prime factorisation and listing methods.',
  },
  {
    grade: 'Class 5', subject: 'Mathematics', unit: 'Percentage', topic: 'Can You See the Pattern?',
    wiki: 'Percentage',
    desc: 'Introduction to percentage as parts per hundred. Students convert fractions and decimals to percentages and vice versa. They calculate percentage of a quantity (e.g. 25% of 80), find discounts, and apply percentages to marks, profit/loss, and daily life situations.',
  },
  {
    grade: 'Class 5', subject: 'Mathematics', unit: 'Geometry', topic: 'Mapping Your Way',
    wiki: 'Map',
    desc: 'Reading and drawing simple maps using scale. Students understand compass directions (N, S, E, W and NE, NW, SE, SW), follow map instructions, calculate actual distances from map distances using ratio and scale, and draw maps of their school or neighbourhood.',
  },
  {
    grade: 'Class 5', subject: 'Mathematics', unit: 'Geometry', topic: 'Boxes and Sketches',
    wiki: 'Cuboid',
    desc: '3D shapes — cube, cuboid, cylinder, cone, sphere, and pyramid. Students identify faces, edges, and vertices, match 3D shapes to their nets, and fold nets to make 3D shapes. They draw front, top, and side views of 3D objects and relate volume to space.',
  },
  {
    grade: 'Class 5', subject: 'Mathematics', unit: 'Data Handling', topic: 'How Big? How Heavy?',
    wiki: 'Statistics',
    desc: 'Collecting and organising data using tally marks and frequency tables. Students calculate mean (average) of a data set, interpret bar graphs and pie charts, and compare data sets. Activities include measuring heights/weights and analysing class survey results.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Wikipedia fetch helper
// ─────────────────────────────────────────────────────────────────────────────
async function fetchWikiSummary(title) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const { data } = await axios.get(url, { timeout: 8000 });
    return data.extract || '';
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main seeder
// ─────────────────────────────────────────────────────────────────────────────
async function seed() {
  console.log('\n📚 NCERT Math Seeder — Classes 3, 4 & 5');
  console.log('─'.repeat(50));

  await initCollection();

  let totalChunks = 0;
  let failed = 0;

  for (const t of TOPICS) {
    process.stdout.write(`  ⏳ [${t.grade}] ${t.topic} ...`);
    try {
      const wiki = await fetchWikiSummary(t.wiki);
      const fullText = [t.desc, wiki].filter(Boolean).join('\n\n');

      // Split into 2 chunks max for concise topics
      const words = fullText.split(/\s+/);
      const chunks = [];
      const size = 300;
      for (let i = 0; i < words.length; i += size - 50) {
        const chunk = words.slice(i, i + size).join(' ');
        if (chunk.trim().length >= 40) chunks.push(chunk);
      }

      const points = [];
      for (const chunk of chunks) {
        const vector = await embed(chunk);
        points.push({
          id: crypto.randomUUID(),
          vector,
          payload: {
            curriculum: CURRICULUM,
            grade: t.grade,
            subject: t.subject,
            unit: t.unit,
            topic: t.topic,
            content_type: 'explanation',
            content: chunk,
            school_id: 'default',
            uploaded_by: SEEDER_TAG,
            source: `Wikipedia: ${t.wiki}`,
            ingested_at: new Date().toISOString(),
          },
        });
      }

      await upsertContent(points);
      totalChunks += points.length;
      console.log(` ✅ ${points.length} chunk(s)`);
    } catch (err) {
      failed++;
      console.log(` ❌ ${err.message}`);
    }
  }

  console.log('─'.repeat(50));
  console.log(`✅ Done! ${totalChunks} chunks ingested across ${TOPICS.length - failed} topics.`);
  if (failed > 0) console.log(`⚠️  ${failed} topic(s) failed — re-run to retry.`);
  process.exit(0);
}

seed().catch(err => { console.error('Fatal:', err); process.exit(1); });
