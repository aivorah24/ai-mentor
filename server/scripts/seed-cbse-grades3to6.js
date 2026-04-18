require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { embed }                                          = require('../services/embeddings');
const { upsertContent, initCollection, client, COLLECTION } = require('../services/qdrant');

const CURRICULUM = 'CBSE';
const SEEDER_TAG = 'seed_cbse_g3_g6';

// ─────────────────────────────────────────────────────────────────────────────
// CBSE Curriculum — Grade 3 to 6 — Mathematics + Science
// Based on official NCERT/CBSE syllabus
// ─────────────────────────────────────────────────────────────────────────────

const TOPICS = [

  // ══════════════════════════════════════════════════════════════════
  // GRADE 3
  // ══════════════════════════════════════════════════════════════════

  // ── Grade 3 Mathematics ───────────────────────────────────────────
  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Numbers', topic: 'Numbers up to 999',
    wiki: 'Positional_notation',
    desc: 'Students read, write and compare numbers up to 999. They understand place value — hundreds, tens and ones — using base-ten blocks and number charts. They order numbers on a number line.' },

  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Numbers', topic: 'Addition up to 999',
    wiki: 'Addition',
    desc: 'Adding 2-digit and 3-digit numbers with and without carrying (regrouping). Students use column addition and solve word problems involving totals in real-life contexts like shopping and counting.' },

  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Numbers', topic: 'Subtraction up to 999',
    wiki: 'Subtraction',
    desc: 'Subtracting 2-digit and 3-digit numbers with and without borrowing. Students use column subtraction and check answers by addition. Word problems involve finding differences in real-life situations.' },

  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Numbers', topic: 'Multiplication',
    wiki: 'Multiplication',
    desc: 'Multiplication as repeated addition. Times tables for 2 to 10. Students use arrays, skip counting and mental strategies. Word problems involve equal groups, rows and columns.' },

  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Numbers', topic: 'Division',
    wiki: 'Division_(mathematics)',
    desc: 'Division as equal sharing and equal grouping. Students divide by 2 to 10 using counters and pictures. They understand the relationship between multiplication and division.' },

  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Measurement', topic: 'Length',
    wiki: 'Length',
    desc: 'Measuring length using cm and m. Students measure objects with rulers, estimate lengths, compare and order measurements, and convert between cm and m.' },

  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Measurement', topic: 'Weight (Mass)',
    wiki: 'Mass',
    desc: 'Measuring weight using grams and kilograms. Students use balance scales and spring balances. They compare weights and solve problems involving g and kg.' },

  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Measurement', topic: 'Capacity (Volume)',
    wiki: 'Volume',
    desc: 'Measuring capacity using litres and millilitres. Students fill and compare containers, read measurements on jugs, and solve problems involving l and ml.' },

  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Measurement', topic: 'Time',
    wiki: 'Time',
    desc: 'Telling time to the nearest 5 minutes on analog and digital clocks. Students understand AM/PM, days of the week, months, calendars, and simple elapsed time.' },

  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Money', topic: 'Money',
    wiki: 'Money',
    desc: 'Indian currency — identifying coins and notes (1, 2, 5, 10, 20, 50, 100 rupees). Students add and subtract money amounts and solve simple shopping problems.' },

  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Geometry', topic: '2D Shapes',
    wiki: 'Polygon',
    desc: 'Identifying and describing 2D shapes — triangle, square, rectangle, circle, pentagon, hexagon. Students count sides and corners, draw shapes and find shapes in their environment.' },

  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Geometry', topic: '3D Shapes',
    wiki: 'Three-dimensional_space',
    desc: 'Identifying 3D shapes — cube, cuboid, cylinder, cone, sphere. Students describe faces, edges and vertices. They match 3D shapes to everyday objects like boxes and balls.' },

  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Data Handling', topic: 'Pictographs and Tally Charts',
    wiki: 'Pictogram',
    desc: 'Collecting data, making tally marks and drawing pictographs. Students read and interpret pictographs to answer questions about favourite colours, sports, and animals.' },

  { grade: 'Grade 3', subject: 'Mathematics', unit: 'Patterns', topic: 'Patterns',
    wiki: 'Pattern',
    desc: 'Identifying, extending and creating repeating patterns using shapes, colours and numbers. Students find number patterns like odd/even numbers and skip counting sequences.' },

  // ── Grade 3 Science (EVS — Environmental Studies) ─────────────────
  { grade: 'Grade 3', subject: 'Science', unit: 'Plants', topic: 'Plants Around Us',
    wiki: 'Plant',
    desc: 'Parts of a plant — roots, stem, leaves, flowers, fruits, seeds. Students observe plants, understand their needs (water, sunlight, soil) and classify plants as trees, shrubs and herbs.' },

  { grade: 'Grade 3', subject: 'Science', unit: 'Animals', topic: 'Animals Around Us',
    wiki: 'Animal',
    desc: 'Types of animals — domestic and wild, land and water animals, birds and insects. Students learn about animal homes, food habits (herbivores, carnivores, omnivores) and baby animals.' },

  { grade: 'Grade 3', subject: 'Science', unit: 'Food', topic: 'Food We Eat',
    wiki: 'Food',
    desc: 'Sources of food — plants and animals. Students learn about balanced diet, meals of the day, eating healthy vs junk food, and how food gives us energy to grow and stay healthy.' },

  { grade: 'Grade 3', subject: 'Science', unit: 'Water', topic: 'Water',
    wiki: 'Water',
    desc: 'Sources of water — rain, rivers, ponds, wells, taps. States of water — solid, liquid and gas. Why we need water, saving water, water purification and water pollution.' },

  { grade: 'Grade 3', subject: 'Science', unit: 'Air', topic: 'Air Around Us',
    wiki: 'Atmosphere_of_Earth',
    desc: 'Air is everywhere and takes up space. We breathe air. Properties of air — no colour, no smell, no taste. Wind is moving air. Air helps plants, animals and humans survive.' },

  { grade: 'Grade 3', subject: 'Science', unit: 'Our Body', topic: 'Human Body',
    wiki: 'Human_body',
    desc: 'Parts of the body and their functions — head, eyes, ears, nose, mouth, hands and legs. Five sense organs. Importance of personal hygiene, cleanliness and healthy habits.' },

  { grade: 'Grade 3', subject: 'Science', unit: 'Shelter', topic: 'Houses and Shelters',
    wiki: 'House',
    desc: 'Types of houses — permanent and temporary. Materials used — bricks, wood, mud, straw. Why we need homes. Different homes in different regions — huts, flats, bungalows, houseboats.' },

  { grade: 'Grade 3', subject: 'Science', unit: 'Transport', topic: 'Means of Transport',
    wiki: 'Transport',
    desc: 'Land, water and air transport. Vehicles powered by fuel, electricity and animals. Public vs private transport. Road safety rules — traffic signals, zebra crossing.' },

  // ══════════════════════════════════════════════════════════════════
  // GRADE 4
  // ══════════════════════════════════════════════════════════════════

  // ── Grade 4 Mathematics ───────────────────────────────────────────
  { grade: 'Grade 4', subject: 'Mathematics', unit: 'Numbers', topic: 'Numbers up to 99,999',
    wiki: 'Positional_notation',
    desc: 'Reading, writing and comparing 5-digit numbers. Place value — ten thousands, thousands, hundreds, tens, ones. Expanding numbers and ordering on a number line.' },

  { grade: 'Grade 4', subject: 'Mathematics', unit: 'Numbers', topic: 'Addition and Subtraction',
    wiki: 'Addition',
    desc: '4-digit and 5-digit addition and subtraction with regrouping. Estimating sums and differences. Word problems involving money, distances and quantities.' },

  { grade: 'Grade 4', subject: 'Mathematics', unit: 'Numbers', topic: 'Multiplication',
    wiki: 'Multiplication',
    desc: 'Multiplying 2-digit and 3-digit numbers by 1-digit and 2-digit numbers. Long multiplication. Estimating products. Word problems using multiplication in real-life contexts.' },

  { grade: 'Grade 4', subject: 'Mathematics', unit: 'Numbers', topic: 'Division',
    wiki: 'Division_(mathematics)',
    desc: 'Long division of 2-digit and 3-digit numbers by 1-digit numbers. Quotient and remainder. Checking division using multiplication. Word problems involving sharing and grouping.' },

  { grade: 'Grade 4', subject: 'Mathematics', unit: 'Fractions', topic: 'Fractions',
    wiki: 'Fraction',
    desc: 'Proper, improper and mixed fractions. Equivalent fractions. Comparing fractions with same denominator. Adding and subtracting like fractions. Fractions on a number line.' },

  { grade: 'Grade 4', subject: 'Mathematics', unit: 'Measurement', topic: 'Length, Weight and Capacity',
    wiki: 'Measurement',
    desc: 'Converting between km-m-cm, kg-g, l-ml. Adding and subtracting measurements. Estimating and measuring using standard units. Word problems involving real-life measurements.' },

  { grade: 'Grade 4', subject: 'Mathematics', unit: 'Measurement', topic: 'Perimeter and Area',
    wiki: 'Perimeter',
    desc: 'Finding perimeter of squares, rectangles and triangles. Area of squares and rectangles by counting unit squares and using formula (length × breadth). Comparing areas.' },

  { grade: 'Grade 4', subject: 'Mathematics', unit: 'Geometry', topic: 'Lines and Angles',
    wiki: 'Angle',
    desc: 'Types of lines — straight, curved, parallel, perpendicular. Introduction to angles — right angle, acute angle, obtuse angle. Identifying angles in shapes and real life.' },

  { grade: 'Grade 4', subject: 'Mathematics', unit: 'Data Handling', topic: 'Bar Graphs',
    wiki: 'Bar_chart',
    desc: 'Reading and drawing bar graphs. Collecting data, organising in a table and representing as a bar graph. Interpreting bar graphs to answer questions about data.' },

  { grade: 'Grade 4', subject: 'Mathematics', unit: 'Numbers', topic: 'Roman Numerals',
    wiki: 'Roman_numerals',
    desc: 'Roman numerals I to C (1 to 100). Rules for writing Roman numerals — addition and subtraction rules. Converting between Roman and Hindu-Arabic numerals.' },

  // ── Grade 4 Science ───────────────────────────────────────────────
  { grade: 'Grade 4', subject: 'Science', unit: 'Plants', topic: 'Plants — Food and Reproduction',
    wiki: 'Photosynthesis',
    desc: 'How plants make food through photosynthesis — sunlight, water, carbon dioxide. Parts of a flower and reproduction. Seeds — how they travel and germinate. Importance of plants.' },

  { grade: 'Grade 4', subject: 'Science', unit: 'Animals', topic: 'Adaptations in Animals',
    wiki: 'Adaptation',
    desc: 'How animals adapt to their habitats — desert, polar, aquatic and forest animals. Features like thick fur, humps, webbed feet. Animal behaviour — migration and hibernation.' },

  { grade: 'Grade 4', subject: 'Science', unit: 'Food', topic: 'Food and Nutrition',
    wiki: 'Nutrition',
    desc: 'Nutrients — carbohydrates, proteins, fats, vitamins, minerals and water. Sources and functions of each nutrient. Deficiency diseases. Importance of a balanced diet.' },

  { grade: 'Grade 4', subject: 'Science', unit: 'Matter', topic: 'Materials and Matter',
    wiki: 'Matter',
    desc: 'Properties of materials — hard/soft, rough/smooth, transparent/opaque. Grouping materials by properties. Natural vs man-made materials. Soluble and insoluble materials.' },

  { grade: 'Grade 4', subject: 'Science', unit: 'Force and Energy', topic: 'Force, Work and Energy',
    wiki: 'Force',
    desc: 'What is force — push and pull. Types of forces — gravity, magnetic, friction. How force changes shape, speed and direction. Introduction to energy and its forms.' },

  { grade: 'Grade 4', subject: 'Science', unit: 'Earth and Space', topic: 'Earth — Rocks and Soil',
    wiki: 'Soil',
    desc: 'Types of soil — sandy, clayey, loamy. Properties of soil and plants that grow in each type. Rocks — types and uses. Importance of soil for farming and construction.' },

  { grade: 'Grade 4', subject: 'Science', unit: 'Environment', topic: 'Environment and Pollution',
    wiki: 'Pollution',
    desc: 'Types of pollution — air, water, land and noise pollution. Causes and effects. Ways to reduce pollution. Our responsibility towards keeping the environment clean.' },

  // ══════════════════════════════════════════════════════════════════
  // GRADE 5
  // ══════════════════════════════════════════════════════════════════

  // ── Grade 5 Mathematics ───────────────────────────────────────────
  { grade: 'Grade 5', subject: 'Mathematics', unit: 'Numbers', topic: 'Large Numbers (Lakhs and Crores)',
    wiki: 'Indian_numbering_system',
    desc: 'Reading and writing numbers up to 1 crore. Indian and international place value systems. Comparing and ordering large numbers. Rounding to nearest 10, 100, 1000.' },

  { grade: 'Grade 5', subject: 'Mathematics', unit: 'Numbers', topic: 'Fractions and Decimals',
    wiki: 'Decimal',
    desc: 'Decimals — tenths, hundredths, thousandths. Converting fractions to decimals and vice versa. Adding, subtracting and comparing decimals. Money and measurement problems.' },

  { grade: 'Grade 5', subject: 'Mathematics', unit: 'Numbers', topic: 'Factors and Multiples',
    wiki: 'Divisor',
    desc: 'Factors and multiples. Prime and composite numbers. HCF (Highest Common Factor) and LCM (Lowest Common Multiple). Divisibility rules for 2, 3, 4, 5, 6, 8, 9, 10.' },

  { grade: 'Grade 5', subject: 'Mathematics', unit: 'Fractions', topic: 'Operations on Fractions',
    wiki: 'Fraction',
    desc: 'Adding and subtracting unlike fractions using LCM. Multiplying fractions. Word problems involving fractions in cooking, measurement and sharing contexts.' },

  { grade: 'Grade 5', subject: 'Mathematics', unit: 'Geometry', topic: 'Angles and Triangles',
    wiki: 'Triangle',
    desc: 'Measuring angles using a protractor. Types of triangles — equilateral, isosceles, scalene. Right-angled, acute and obtuse triangles. Sum of angles in a triangle = 180°.' },

  { grade: 'Grade 5', subject: 'Mathematics', unit: 'Geometry', topic: 'Area and Perimeter',
    wiki: 'Area',
    desc: 'Area of squares, rectangles and right-angled triangles. Perimeter of polygons. Word problems on fencing, flooring and land. Introduction to volume of cuboids.' },

  { grade: 'Grade 5', subject: 'Mathematics', unit: 'Measurement', topic: 'Unitary Method',
    wiki: 'Unitary_method',
    desc: 'Finding the value of one unit to find the value of many. Speed, distance and time problems. Simple interest and profit/loss introductions through word problems.' },

  { grade: 'Grade 5', subject: 'Mathematics', unit: 'Data Handling', topic: 'Pie Charts and Averages',
    wiki: 'Pie_chart',
    desc: 'Reading pie charts. Mean (average) of a data set. Median and mode introduction. Representing data in bar graphs and pie charts. Interpreting real-life data.' },

  { grade: 'Grade 5', subject: 'Mathematics', unit: 'Patterns', topic: 'Number Patterns and Sequences',
    wiki: 'Sequence',
    desc: 'Arithmetic sequences — finding the rule and next terms. Square and triangular numbers. Fibonacci sequence. Using patterns to solve problems and make predictions.' },

  // ── Grade 5 Science ───────────────────────────────────────────────
  { grade: 'Grade 5', subject: 'Science', unit: 'Plants', topic: 'Reproduction in Plants',
    wiki: 'Plant_reproduction',
    desc: 'Sexual reproduction — flowers, pollination, fertilisation, seed formation. Asexual reproduction — cuttings, grafting, budding. Seed dispersal methods — wind, water, animals.' },

  { grade: 'Grade 5', subject: 'Science', unit: 'Animals', topic: 'Reproduction in Animals',
    wiki: 'Animal_reproduction',
    desc: 'Oviparous and viviparous animals. Life cycles — frog, butterfly, mosquito. Care of young ones. Human reproductive system basics — puberty and adolescence (age-appropriate).' },

  { grade: 'Grade 5', subject: 'Science', unit: 'Matter', topic: 'Changes in Matter',
    wiki: 'Chemical_change',
    desc: 'Physical changes vs chemical changes. Reversible changes — melting ice, dissolving sugar. Irreversible changes — burning, cooking, rusting. States of matter and change of state.' },

  { grade: 'Grade 5', subject: 'Science', unit: 'Force and Energy', topic: 'Simple Machines',
    wiki: 'Simple_machine',
    desc: 'Six types of simple machines — lever, pulley, wheel and axle, inclined plane, wedge, screw. How they make work easier. Examples in daily life. Mechanical advantage.' },

  { grade: 'Grade 5', subject: 'Science', unit: 'Light and Sound', topic: 'Light',
    wiki: 'Light',
    desc: 'Sources of light — natural and artificial. Transparent, translucent and opaque materials. Shadows — how they form and change. Reflection of light. Introduction to rainbows.' },

  { grade: 'Grade 5', subject: 'Science', unit: 'Light and Sound', topic: 'Sound',
    wiki: 'Sound',
    desc: 'How sound is produced — vibration. How sound travels — through solids, liquids, gases. Loud and soft sounds (amplitude). High and low pitch (frequency). Sound pollution.' },

  { grade: 'Grade 5', subject: 'Science', unit: 'Earth and Space', topic: 'Solar System',
    wiki: 'Solar_System',
    desc: 'The Sun and eight planets. Order of planets — Mercury to Neptune. Moon phases and eclipses. Stars and constellations. Day and night — Earth\'s rotation. Seasons — Earth\'s revolution.' },

  { grade: 'Grade 5', subject: 'Science', unit: 'Environment', topic: 'Natural Resources and Conservation',
    wiki: 'Natural_resource',
    desc: 'Renewable vs non-renewable resources. Fossil fuels — coal, petroleum, natural gas. Conservation of water, forests and wildlife. The 3Rs — reduce, reuse, recycle.' },

  // ══════════════════════════════════════════════════════════════════
  // GRADE 6
  // ══════════════════════════════════════════════════════════════════

  // ── Grade 6 Mathematics ───────────────────────────────────────────
  { grade: 'Grade 6', subject: 'Mathematics', unit: 'Numbers', topic: 'Knowing Our Numbers',
    wiki: 'Indian_numbering_system',
    desc: 'Large numbers — lakhs, crores. Indian vs international numeration systems. Comparing and ordering numbers. Estimation and rounding. Roman numerals up to 1000.' },

  { grade: 'Grade 6', subject: 'Mathematics', unit: 'Numbers', topic: 'Whole Numbers',
    wiki: 'Natural_number',
    desc: 'Natural numbers and whole numbers. Number line. Properties — closure, commutative, associative, distributive. Patterns in whole numbers. Predecessor and successor.' },

  { grade: 'Grade 6', subject: 'Mathematics', unit: 'Numbers', topic: 'Playing with Numbers',
    wiki: 'Divisor',
    desc: 'Factors, multiples, prime and composite numbers. HCF and LCM using prime factorisation. Tests of divisibility. Prime factorisation — factor tree method.' },

  { grade: 'Grade 6', subject: 'Mathematics', unit: 'Numbers', topic: 'Integers',
    wiki: 'Integer',
    desc: 'Positive and negative numbers. Integers on a number line. Ordering integers. Addition and subtraction of integers. Real-life use — temperature, altitude, bank balance.' },

  { grade: 'Grade 6', subject: 'Mathematics', unit: 'Fractions', topic: 'Fractions and Decimals',
    wiki: 'Fraction',
    desc: 'Types of fractions. Equivalent fractions. Comparing and ordering fractions. Operations on fractions. Decimal fractions — converting, comparing and operating.' },

  { grade: 'Grade 6', subject: 'Mathematics', unit: 'Algebra', topic: 'Introduction to Algebra',
    wiki: 'Algebra',
    desc: 'Variables and constants. Writing algebraic expressions. Simple linear equations — solving by trial and error and systematic method. Using algebra to solve word problems.' },

  { grade: 'Grade 6', subject: 'Mathematics', unit: 'Ratio and Proportion', topic: 'Ratio and Proportion',
    wiki: 'Ratio',
    desc: 'Ratio as comparison of two quantities. Equivalent ratios. Proportion — checking if four numbers are in proportion. Unitary method. Direct proportion in word problems.' },

  { grade: 'Grade 6', subject: 'Mathematics', unit: 'Geometry', topic: 'Basic Geometrical Ideas',
    wiki: 'Geometry',
    desc: 'Points, lines, line segments, rays. Angles — types and measurement. Curves — simple, closed. Polygons, triangles, quadrilaterals. Circles — centre, radius, diameter, arc.' },

  { grade: 'Grade 6', subject: 'Mathematics', unit: 'Geometry', topic: 'Symmetry',
    wiki: 'Symmetry',
    desc: 'Lines of symmetry in 2D shapes. Reflection symmetry. Rotational symmetry. Finding lines of symmetry in letters, shapes and patterns. Making symmetric patterns.' },

  { grade: 'Grade 6', subject: 'Mathematics', unit: 'Mensuration', topic: 'Perimeter and Area',
    wiki: 'Area',
    desc: 'Perimeter of polygons and irregular shapes. Area of squares, rectangles and triangles using formulae. Area of combined shapes. Application in real-life contexts.' },

  { grade: 'Grade 6', subject: 'Mathematics', unit: 'Data Handling', topic: 'Data Handling',
    wiki: 'Statistics',
    desc: 'Data collection and organisation. Frequency distribution tables. Bar graphs — drawing and interpreting. Mean, median and mode. Drawing conclusions from data.' },

  // ── Grade 6 Science ───────────────────────────────────────────────
  { grade: 'Grade 6', subject: 'Science', unit: 'Food', topic: 'Food — Sources and Components',
    wiki: 'Food',
    desc: 'Plant and animal sources of food. Nutrients — carbohydrates, proteins, fats, vitamins, minerals, water. Functions of each nutrient. Testing food for starch, protein and fat.' },

  { grade: 'Grade 6', subject: 'Science', unit: 'Plants', topic: 'Components of Food and Photosynthesis',
    wiki: 'Photosynthesis',
    desc: 'How plants prepare food using sunlight, water and CO₂ (photosynthesis). Chlorophyll and its role. Oxygen release. Autotrophs vs heterotrophs. Parasitic and insectivorous plants.' },

  { grade: 'Grade 6', subject: 'Science', unit: 'Matter', topic: 'Fibre to Fabric',
    wiki: 'Textile',
    desc: 'Natural fibres — cotton, jute, wool, silk. Synthetic fibres — nylon, polyester. How cotton and jute are obtained. Weaving and knitting. Properties and uses of different fabrics.' },

  { grade: 'Grade 6', subject: 'Science', unit: 'Matter', topic: 'Sorting Materials into Groups',
    wiki: 'Matter',
    desc: 'Properties of materials — appearance, hardness, solubility, transparency, conductivity. Grouping objects based on properties. Metals and non-metals. Soluble and insoluble substances.' },

  { grade: 'Grade 6', subject: 'Science', unit: 'Matter', topic: 'Separation of Substances',
    wiki: 'Separation_process',
    desc: 'Methods of separation — handpicking, threshing, winnowing, sieving, sedimentation, filtration, evaporation, distillation. Saturated solutions. Why separation is needed in daily life.' },

  { grade: 'Grade 6', subject: 'Science', unit: 'Matter', topic: 'Changes Around Us',
    wiki: 'Chemical_change',
    desc: 'Reversible and irreversible changes. Physical and chemical changes with examples. Expansion and contraction due to heat. Dissolving, melting, burning — which are reversible?' },

  { grade: 'Grade 6', subject: 'Science', unit: 'Living World', topic: 'The Living World',
    wiki: 'Biology',
    desc: 'Characteristics of living organisms — growth, reproduction, movement, respiration, excretion. Classification of plants and animals. Binomial nomenclature introduction.' },

  { grade: 'Grade 6', subject: 'Science', unit: 'Living World', topic: 'Cell — The Basic Unit of Life',
    wiki: 'Cell_(biology)',
    desc: 'Discovery of the cell. Cell structure — cell membrane, cell wall, nucleus, cytoplasm, vacuoles, chloroplasts. Difference between plant and animal cells. Unicellular vs multicellular.' },

  { grade: 'Grade 6', subject: 'Science', unit: 'Motion and Measurement', topic: 'Motion and Measurement of Distances',
    wiki: 'Motion_(physics)',
    desc: 'Standard units of length — metre, km, cm, mm. Measuring lengths using ruler and measuring tape. Types of motion — rectilinear, circular, periodic. Distance and displacement.' },

  { grade: 'Grade 6', subject: 'Science', unit: 'Light and Shadow', topic: 'Light, Shadows and Reflection',
    wiki: 'Light',
    desc: 'Sources of light. Transparent, translucent, opaque. Formation of shadows. Pinhole camera. Reflection of light — laws of reflection. Lateral inversion. Mirrors and their uses.' },

  { grade: 'Grade 6', subject: 'Science', unit: 'Electricity', topic: 'Electricity and Circuits',
    wiki: 'Electrical_circuit',
    desc: 'Electric cell, bulb, wires and switches. Simple electric circuit. Conductors and insulators. Series and parallel circuits. Safety precautions with electricity.' },

  { grade: 'Grade 6', subject: 'Science', unit: 'Magnets', topic: 'Fun with Magnets',
    wiki: 'Magnet',
    desc: 'Properties of magnets — attraction, repulsion, poles. Natural and artificial magnets. Making a magnet. Magnetic compass. Magnetic and non-magnetic materials. Uses of magnets.' },

  { grade: 'Grade 6', subject: 'Science', unit: 'Earth and Space', topic: 'Air Around Us',
    wiki: 'Atmosphere_of_Earth',
    desc: 'Composition of air — nitrogen, oxygen, CO₂, water vapour. Properties of air. Oxygen for burning and breathing. CO₂ in photosynthesis. Wind formation. Importance of atmosphere.' },

  { grade: 'Grade 6', subject: 'Science', unit: 'Earth and Space', topic: 'Water',
    wiki: 'Water_cycle',
    desc: 'Water cycle — evaporation, condensation, precipitation. Forms of precipitation. Ground water and water table. Importance of water conservation. Potable water and purification.' },
];

// ─────────────────────────────────────────────────────────────────────────────
async function fetchWikiSummary(title) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Aivorah-Seeder/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.extract || null;
  } catch { return null; }
}

async function seed() {
  console.log('Initialising Qdrant collection...');
  await initCollection();

  const grades = [...new Set(TOPICS.map(t => t.grade))];
  console.log(`Seeding CBSE curriculum: ${grades.join(', ')}`);
  console.log(`Total topics: ${TOPICS.length}\n`);

  let success = 0, failed = 0;

  for (const t of TOPICS) {
    try {
      // Fetch Wikipedia content for richer embeddings
      const wikiText = await fetchWikiSummary(t.wiki);
      const content  = wikiText ? `${t.desc}\n\n${wikiText}` : t.desc;

      const vector = await embed(content);

      const crypto = require('crypto');
      const id = parseInt(crypto.createHash('md5')
                    .update(`cbse|${t.grade}|${t.subject}|${t.topic}`).digest('hex').slice(0, 8), 16);

      await upsertContent([{
        id,
        vector,
        payload: {
          curriculum: CURRICULUM,
          grade:      t.grade,
          subject:    t.subject,
          unit:       t.unit,
          topic:      t.topic,
          text:       content,
          source:     'cbse_syllabus',
          seeder:     SEEDER_TAG,
          type:       'curriculum',
        },
      }]);

      success++;
      console.log(`  ✓ [${t.grade}] ${t.subject} → ${t.topic}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ [${t.grade}] ${t.topic}: ${err.message}`);
    }

    // Throttle to avoid rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nDone! ✓ ${success} succeeded, ✗ ${failed} failed`);
}

seed().catch(console.error);
