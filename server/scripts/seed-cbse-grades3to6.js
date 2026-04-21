require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { embed }                                          = require('../services/embeddings');
const { upsertContent, initCollection, client, COLLECTION } = require('../services/qdrant');

const CURRICULUM = 'CBSE';
const SEEDER_TAG = 'seed_cbse_g3_g6';

// ─────────────────────────────────────────────────────────────────────────────
// CBSE Curriculum — Grade 3 to 6
// Based on ACTUAL NCERT textbook chapters (NCF 2023 / NEP 2020)
// Class 3-5: EVS (Environmental Studies), NOT separate Science
// Class 6: Separate Science
// ─────────────────────────────────────────────────────────────────────────────

const CHAPTERS = [

  // ══════════════════════════════════════════════════════════════════
  // CLASS 3 — Mathematics — "Maths Mela" (NCERT, 14 chapters)
  // ══════════════════════════════════════════════════════════════════
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 1, topic: "What's in a Name?",
    desc: 'Introduction to numbers and their names. Students learn to read, write and identify numbers in words and figures. Builds number sense through naming and recognising numbers in everyday contexts.' },
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 2, topic: 'Toy Joy',
    desc: 'Understanding numbers through toys — counting, comparing and ordering. Students explore addition and subtraction concepts using toy-based scenarios and play-based learning.' },
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 3, topic: 'Double Century',
    desc: 'Numbers up to 200 and beyond. Students practice place value, skip counting and number patterns. They learn to compare and order larger numbers using real-life examples.' },
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 4, topic: 'Vacation with My Nani Maa',
    desc: 'Application of numbers in daily life during a vacation story. Students solve problems involving money, time, distances and quantities encountered during travel and family visits.' },
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 5, topic: 'Fun with Shapes',
    desc: 'Exploring 2D and 3D shapes. Students identify, name and describe shapes in their surroundings. They learn about sides, corners and faces through hands-on activities.' },
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 6, topic: 'House of Hundreds — I',
    desc: 'Understanding hundreds — place value with hundreds, tens and ones. Students group objects into hundreds, read and write 3-digit numbers, and use number charts.' },
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 7, topic: 'Raksha Bandhan',
    desc: 'Maths in festivals — students solve problems involving sharing sweets, tying rakhis, counting gifts. Multiplication and division concepts through cultural celebration contexts.' },
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 8, topic: 'Fair Share',
    desc: 'Introduction to division as equal sharing. Students divide objects equally among groups, understand remainders, and connect division to multiplication through sharing activities.' },
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 9, topic: 'House of Hundreds — II',
    desc: 'Deeper work with 3-digit numbers. Addition and subtraction of hundreds with regrouping. Students solve word problems and build fluency with larger numbers.' },
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 10, topic: 'Fun at Class Party!',
    desc: 'Data handling and counting through a class party scenario. Students collect data, make tally marks, create simple charts and answer questions about party arrangements.' },
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 11, topic: 'Filling and Lifting',
    desc: 'Measurement of capacity (volume) and weight. Students compare containers, estimate and measure using standard units (litres, kilograms). Practical measurement activities.' },
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 12, topic: 'Give and Take',
    desc: 'Addition and subtraction word problems. Students practice mental math strategies, learn to check answers, and solve multi-step problems involving giving and receiving.' },
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 13, topic: 'Time Goes On',
    desc: 'Telling time on clocks — hours, half hours, quarter hours. Students read calendars, understand days, weeks, months and solve problems involving duration and elapsed time.' },
  { grade: 'Grade 3', subject: 'Mathematics', textbook: 'Maths Mela', chapter: 14, topic: 'The Surajkund Fair',
    desc: 'Consolidation chapter using a fair/mela context. Students apply money, measurement, counting, and problem-solving skills in a rich real-world scenario at Surajkund Fair.' },

  // ══════════════════════════════════════════════════════════════════
  // CLASS 3 — EVS — "Our Wondrous World" (NCERT, 24 chapters)
  // ══════════════════════════════════════════════════════════════════
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 1, topic: "Poonam's Day Out",
    desc: 'A day in Poonam\'s life exploring nature. Students observe plants, animals and natural surroundings. Introduction to the living world and developing curiosity about the environment.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 2, topic: 'The Plant Fairy',
    desc: 'Exploring plants — parts, types, and their importance. Students observe different plants, learn about roots, stems, leaves, flowers and how plants help us.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 3, topic: "Water O' Water",
    desc: 'Sources of water, importance of water in daily life, water conservation. Students explore where water comes from and why we must save it.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 4, topic: 'Our First School',
    desc: 'Family as our first school. Students learn about family roles, relationships, values learned at home, and how families teach us about the world.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 5, topic: "Chhotu's House",
    desc: 'Different types of houses and shelters. Students explore why houses look different in different places — materials used, climate, and local resources.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 6, topic: 'Food We Eat',
    desc: 'Understanding food sources, types of food, and healthy eating habits. Students learn where food comes from — plants and animals — and the importance of nutrition.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 7, topic: 'Saying Without Speaking',
    desc: 'Communication without words — sign language, body language, animal communication. Students explore how humans and animals convey messages without speaking.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 8, topic: 'Flying High',
    desc: 'Birds and their world — types of birds, beaks, claws, nests, feathers. Students observe birds and learn how different birds are adapted to their environments.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 9, topic: "It's Raining",
    desc: 'Rain and weather — where rain comes from, how it affects us, rainy season activities. Students explore the water cycle at a basic level and seasonal changes.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 10, topic: 'What is Cooking',
    desc: 'Cooking and food preparation. Students learn about different ways of cooking, fuels used, kitchen safety, and how cooking changes food.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 11, topic: 'From Here to There',
    desc: 'Transport and travel — different means of transport (land, water, air). Students explore how people and goods move from one place to another.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 12, topic: 'Work We Do',
    desc: 'Different occupations and types of work. Students learn about various jobs people do, the dignity of labour, and community helpers.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 13, topic: 'Sharing Our Feelings',
    desc: 'Emotions and feelings — happiness, sadness, fear, anger. Students learn to identify and express feelings, empathy, and caring for others.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 14, topic: 'The Story of Food',
    desc: 'Journey of food from farm to plate. Students explore farming, harvesting, processing and how food reaches our homes.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 15, topic: 'Making Pots',
    desc: 'Pottery and clay work. Students learn about clay as a material, how pots are made, the art of pottery, and different uses of pots in daily life.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 16, topic: 'Games We Play',
    desc: 'Indoor and outdoor games, traditional games of India. Students learn about the importance of play, teamwork, physical activity and fair play.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 17, topic: 'Here Comes A Letter',
    desc: 'Communication through letters and post. Students learn about the postal system, writing letters, and different ways people communicate over distances.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 18, topic: 'A House Like This',
    desc: 'Animal homes and shelters. Students explore where different animals live — nests, burrows, hives, dens — and why animals need homes.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 19, topic: 'Our Friends — Animals',
    desc: 'Animals that help humans — pets, farm animals, service animals. Students learn about caring for animals and the bond between humans and animals.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 20, topic: 'Drop by Drop',
    desc: 'Water conservation — every drop counts. Students learn about water scarcity, saving water at home and school, and simple ways to conserve water.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 21, topic: 'Families Can Be Different',
    desc: 'Diversity in families — joint families, nuclear families, single-parent families. Students learn to appreciate different family structures and respect diversity.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 22, topic: 'Left-Right',
    desc: 'Directions and spatial awareness. Students learn left, right, up, down, near, far. Basic map reading and understanding directions in their surroundings.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 23, topic: 'A Beautiful Cloth',
    desc: 'Textiles and fabrics — where cloth comes from, different types of fabric, weaving. Students explore cotton, silk, wool and how clothes are made.' },
  { grade: 'Grade 3', subject: 'EVS', textbook: 'Our Wondrous World', chapter: 24, topic: 'Web of Life',
    desc: 'Interconnections in nature — food chains, ecosystems. Students learn how plants, animals and humans are all connected and depend on each other.' },

  // ══════════════════════════════════════════════════════════════════
  // CLASS 4 — Mathematics — "Math-Magic" (NCERT, 14 chapters)
  // ══════════════════════════════════════════════════════════════════
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 1, topic: 'Shapes Around Us',
    desc: 'Exploring shapes in everyday life. Students identify and classify 2D and 3D shapes, learn about edges, faces and corners, and discover geometry in their surroundings.' },
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 2, topic: 'Hide and Seek',
    desc: 'Number patterns and puzzles. Students explore number relationships, find hidden patterns, and use logical thinking to solve mathematical puzzles and games.' },
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 3, topic: 'Pattern Around Us',
    desc: 'Identifying and creating patterns — number patterns, shape patterns, tiling patterns. Students recognise regularity and extend patterns in sequences.' },
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 4, topic: 'Thousands Around Us',
    desc: 'Numbers in thousands — reading, writing and comparing 4-digit and 5-digit numbers. Place value, expanded form, and using large numbers in real-life contexts.' },
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 5, topic: 'Sharing and Measuring',
    desc: 'Division and fractions through sharing. Students divide objects equally, understand fractions as parts of a whole, and connect sharing to measurement.' },
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 6, topic: 'Measuring Length',
    desc: 'Standard units of length — cm, m, km. Students measure objects, estimate lengths, convert between units, and solve problems involving distances.' },
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 7, topic: 'The Cleanest Village',
    desc: 'Data collection and interpretation through a village cleanliness survey. Students gather data, organise it in tables, and draw conclusions about community practices.' },
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 8, topic: 'Weigh it Pour it',
    desc: 'Measurement of weight and capacity. Students use scales and measuring cups, compare weights in grams and kilograms, and measure liquids in litres and millilitres.' },
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 9, topic: 'Equal Groups',
    desc: 'Multiplication as equal groups. Students make groups of equal size, write multiplication sentences, explore times tables and solve word problems.' },
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 10, topic: 'Elephants Tigers and Leopards',
    desc: 'Large numbers and data handling through wildlife census data. Students read large numbers, compare animal populations, and interpret data from real surveys.' },
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 11, topic: 'Fun with Symmetry',
    desc: 'Symmetry in shapes and nature. Students identify lines of symmetry, create symmetric patterns, and find symmetry in letters, shapes and natural objects.' },
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 12, topic: 'Ticking Clocks and Turning Calendar',
    desc: 'Time — reading clocks (hours, minutes), calendars (days, weeks, months, years). Students calculate durations, plan schedules and solve time-related problems.' },
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 13, topic: 'The Transport Museum',
    desc: 'Maths in a museum context. Students solve problems involving tickets, distances, timings and collections — applying arithmetic in an engaging real-world setting.' },
  { grade: 'Grade 4', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 14, topic: 'Data Handling',
    desc: 'Collecting, organising and representing data. Students create pictographs and bar graphs, read data displays, and answer questions based on data.' },

  // ══════════════════════════════════════════════════════════════════
  // CLASS 4 — EVS — "Looking Around" (NCERT, 27 chapters)
  // ══════════════════════════════════════════════════════════════════
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 1, topic: 'Going to School',
    desc: 'How children travel to school in different parts of India. Students explore transport, distances, terrains and the challenges children face reaching school.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 2, topic: 'Ear to Ear',
    desc: 'Diversity in appearance — how we all look different. Students explore facial features, heredity basics, and learn to appreciate physical diversity.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 3, topic: 'A Day with Nandu',
    desc: 'A day in the life of an elephant. Students learn about elephants — their habits, food, family groups, habitats and why they need protection.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 4, topic: 'A Story of Amrita',
    desc: 'The Bishnoi community and tree conservation. Students learn about Amrita Devi\'s sacrifice to save trees and the importance of environmental conservation.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 5, topic: 'Anita and the Honeybees',
    desc: 'Beekeeping and honey production. Students learn about honeybees — their colonies, how they make honey, pollination, and the value of bees in nature.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 6, topic: "Omana's Journey",
    desc: 'Travel across Kerala — houseboats, backwaters, coconut trees. Students explore geography, culture and livelihood of people in coastal Kerala.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 7, topic: 'From the Window',
    desc: 'Observing the world from a train window. Students learn about landscapes, crops, rivers and changes in geography as one travels across India.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 8, topic: "Reaching Grandmother's House",
    desc: 'A journey to grandmother\'s village. Students explore rural life, farming, village occupations and the differences between city and village life.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 9, topic: 'Changing Families',
    desc: 'How families change over time — births, marriages, aging. Students discuss family trees, generations and how family structures evolve.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 10, topic: 'Hu Tu Tu Hu Tu Tu',
    desc: 'Traditional games of India — kabaddi, kho-kho, gilli-danda. Students learn about indigenous sports, teamwork, physical fitness and cultural heritage through play.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 11, topic: 'The Valley of Flowers',
    desc: 'The Valley of Flowers in Uttarakhand. Students learn about biodiversity, alpine meadows, rare plants and flowers, and why this area is protected.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 12, topic: 'Changing Times',
    desc: 'How things have changed over time — transport, communication, clothing, food. Students compare past and present and think about future changes.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 13, topic: "A River's Tale",
    desc: 'The journey of a river from source to sea. Students learn about rivers, water pollution, the communities that depend on rivers, and river conservation.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 14, topic: "Basva's Farm",
    desc: 'Farming life in rural India. Students learn about crops, seasons of farming (kharif/rabi), irrigation, farm animals and the hard work of farmers.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 15, topic: 'From Market to Home',
    desc: 'The journey of goods from market to home. Students explore where things come from, how they reach shops, and the chain from producer to consumer.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 16, topic: 'A Busy Month',
    desc: 'Planning and organising activities over a month. Students learn about calendars, festivals, seasons and how communities plan their activities around nature.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 17, topic: 'Nandita in Mumbai',
    desc: 'Life in a big city — Mumbai. Students explore urban life, housing, transport, water supply and the challenges of living in a metropolitan city.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 18, topic: 'Too Much Water Too Little Water',
    desc: 'Floods and droughts — too much or too little water. Students learn about water management, the impact of extreme weather, and how communities cope.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 19, topic: 'Abdul in the Garden',
    desc: 'Gardening and plant care. Students learn about growing plants, seeds, soil, watering, composting and the joy of nurturing a garden.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 20, topic: 'Eating Together',
    desc: 'Food diversity across India. Students explore different regional cuisines, cooking methods, food sharing traditions and the culture around eating together.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 21, topic: 'Food and Fun',
    desc: 'Food preservation and fun with food. Students learn about drying, pickling, freezing food and explore food-related activities and traditions.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 22, topic: 'The World in My Home',
    desc: 'Diversity within families and homes. Students explore different cultures, languages, religions and traditions that coexist within Indian homes and communities.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 23, topic: 'Pochampalli',
    desc: 'The Pochampalli village famous for its weaving. Students learn about handloom weaving, textile art, the lives of weavers and India\'s textile heritage.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 24, topic: 'Home and Abroad',
    desc: 'Connecting India with the world. Students explore how goods, people and ideas travel across countries, and learn about India\'s connections with other nations.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 25, topic: 'Spicy Riddles',
    desc: 'Spices of India — where they grow, how they are used. Students explore India\'s spice heritage through riddles and learn about spice farming and trade.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 26, topic: 'Defence Officer: Wahida',
    desc: 'The story of a woman defence officer. Students learn about the armed forces, bravery, gender equality and breaking stereotypes in career choices.' },
  { grade: 'Grade 4', subject: 'EVS', textbook: 'Looking Around', chapter: 27, topic: 'Chuskit Goes to School',
    desc: 'A girl in Ladakh going to school despite challenges. Students learn about education in remote areas, determination, and the right to education.' },

  // ══════════════════════════════════════════════════════════════════
  // CLASS 5 — Mathematics — "Math-Magic" (NCERT, 15 chapters)
  // ══════════════════════════════════════════════════════════════════
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 1, topic: 'We the Travellers — I',
    desc: 'Maths in travel — distances, fares, time calculations. Students solve problems involving bus/train routes, ticket costs, distances between cities and journey planning.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 2, topic: 'Fractions',
    desc: 'Understanding fractions deeply — proper, improper, mixed. Equivalent fractions, comparing fractions, adding and subtracting fractions with like and unlike denominators.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 3, topic: 'Angles as Turns',
    desc: 'Understanding angles as rotations. Students explore full turns, half turns, quarter turns. Measuring angles, types of angles and their connection to directions.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 4, topic: 'We the Travellers — II',
    desc: 'Continuation of travel maths with more complex problems. Students work with larger numbers, multi-step calculations involving speed, distance and time.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 5, topic: 'Far and Near',
    desc: 'Measurement and estimation of distances. Students estimate and measure lengths, convert between km, m and cm, and solve problems involving near and far distances.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 6, topic: 'The Dairy Farm',
    desc: 'Maths at a dairy farm — multiplication, division, measurement. Students solve problems about milk production, feed quantities, costs and daily farm operations.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 7, topic: 'Shapes and Patterns',
    desc: 'Advanced patterns and shape exploration. Students create tessellations, identify rotational and reflective symmetry, and explore geometric patterns.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 8, topic: 'Weight and Capacity',
    desc: 'Measuring weight (g, kg) and capacity (ml, l). Students compare, estimate and convert between units. Word problems involving recipes, shopping and daily life.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 9, topic: 'Coconut Farm',
    desc: 'Area, perimeter and large numbers through a coconut farm context. Students calculate areas of fields, count trees in rows/columns, and work with farm data.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 10, topic: 'Symmetrical Designs',
    desc: 'Symmetry in art and design. Students identify lines of symmetry, create symmetrical designs, explore rangoli patterns and understand bilateral symmetry.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 11, topic: "Grandmother's Quilt",
    desc: 'Geometry through quilting — tessellation, area using grids. Students explore how shapes fit together to make quilts, calculate areas of patches.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 12, topic: 'Racing Seconds',
    desc: 'Time — seconds, minutes, hours. Students calculate elapsed time, convert between units, solve speed problems and work with timelines and schedules.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 13, topic: 'Animal Jumps',
    desc: 'Measurement and multiplication through animal jump distances. Students compare jumps, calculate multiples, create bar graphs and analyse animal movement data.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 14, topic: 'Maps and Locations',
    desc: 'Introduction to maps — directions, scales, grid references. Students read simple maps, locate places using coordinates, and understand the concept of scale.' },
  { grade: 'Grade 5', subject: 'Mathematics', textbook: 'Math-Magic', chapter: 15, topic: 'Data Through Pictures',
    desc: 'Data representation — pictographs, bar graphs, tables. Students collect data, choose appropriate representations, and interpret data displays to draw conclusions.' },

  // ══════════════════════════════════════════════════════════════════
  // CLASS 5 — EVS — "Looking Around" (NCERT, 22 chapters)
  // ══════════════════════════════════════════════════════════════════
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 1, topic: 'Super Senses',
    desc: 'Animal senses — how animals see, hear, smell, taste and feel differently from humans. Students explore extraordinary senses in the animal kingdom.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 2, topic: "A Snake Charmer's Story",
    desc: 'Snakes and the community of snake charmers. Students learn about different snakes, snake bites, conservation, and the changing lives of snake charmers.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 3, topic: 'From Tasting to Digesting',
    desc: 'The digestive system — how food is tasted, chewed, swallowed and digested. Students trace the journey of food through the body.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 4, topic: 'Mangoes Round the Year',
    desc: 'Food preservation — how mangoes and other foods are preserved. Students learn about pickling, drying, freezing, canning and why we preserve food.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 5, topic: 'Seeds and Seeds',
    desc: 'Seed germination, types of seeds, how seeds travel. Students explore seed dispersal methods and conduct germination experiments.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 6, topic: 'Every Drop Counts',
    desc: 'Water scarcity and conservation. Students learn about water sources, distribution, the water crisis in India, and ways to save water.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 7, topic: 'Experiment with Water',
    desc: 'Properties of water — dissolving, floating, sinking. Students conduct experiments to understand what dissolves in water and what floats or sinks.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 8, topic: 'A Treat for Mosquitoes',
    desc: 'Mosquitoes and diseases — malaria, dengue. Students learn about mosquito breeding, prevention methods, and how diseases spread through mosquito bites.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 9, topic: 'Up You Go!',
    desc: 'Mountains and hill life. Students explore mountain geography, altitude, climate, people who live in mountains, and activities like trekking and climbing.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 10, topic: 'Walls Tell Stories',
    desc: 'Historical monuments and what they tell us about the past. Students explore forts, palaces, and ancient buildings as sources of history.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 11, topic: 'Sunita in Space',
    desc: 'Sunita Williams and space travel. Students learn about life in space, the International Space Station, astronaut training and India\'s space achievements.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 12, topic: 'What If It Finishes…?',
    desc: 'Fossil fuels and energy conservation. Students explore petroleum, coal, natural gas — how they formed, why they are running out, and renewable alternatives.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 13, topic: 'A Shelter So High',
    desc: 'Houses in extreme environments — mountains, deserts, cold regions. Students explore how people build shelters adapted to harsh climates and terrains.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 14, topic: 'When the Earth Shook!',
    desc: 'Earthquakes — what causes them, how to stay safe. Students learn about tectonic plates, earthquake preparedness, and disaster management basics.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 15, topic: 'Blow Hot Blow Cold',
    desc: 'Heat and temperature in daily life. Students explore how things get hot or cold, insulators and conductors, and effects of heating and cooling.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 16, topic: 'Who Will Do This Work?',
    desc: 'Dignity of labour and caste-based discrimination. Students discuss the work of sanitation workers, the importance of all jobs, and equality.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 17, topic: 'Across the Wall',
    desc: 'Gender equality and breaking barriers. Students explore stories of girls and women who crossed boundaries and challenged stereotypes.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 18, topic: 'No Place for Us?',
    desc: 'Displacement and migration — people who lose their homes due to development projects. Students learn about dams, deforestation and displaced communities.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 19, topic: "A Seed Tells a Farmer's Story",
    desc: 'Agriculture — seeds, farming practices, crop diversity. Students learn about traditional farming, seed saving, and the connection between seeds and food security.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 20, topic: 'Whose Forests?',
    desc: 'Forests and forest communities. Students explore who lives in forests, tribal rights, deforestation, wildlife conservation and forest products.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 21, topic: 'Like Father Like Daughter',
    desc: 'Heredity and family traits. Students explore how children resemble their parents, inherited traits, and diversity within families.' },
  { grade: 'Grade 5', subject: 'EVS', textbook: 'Looking Around', chapter: 22, topic: 'On the Move Again',
    desc: 'Migration — why people move from place to place. Students learn about nomadic communities, seasonal migration, urbanisation and the search for livelihoods.' },

  // ══════════════════════════════════════════════════════════════════
  // CLASS 6 — Mathematics — "Ganita Prakash" (NCERT, 10 chapters)
  // ══════════════════════════════════════════════════════════════════
  { grade: 'Grade 6', subject: 'Mathematics', textbook: 'Ganita Prakash', chapter: 1, topic: 'Patterns in Mathematics',
    desc: 'Discovering patterns in numbers, shapes and nature. Students explore sequences, visual patterns, and learn how recognising patterns is fundamental to mathematical thinking.' },
  { grade: 'Grade 6', subject: 'Mathematics', textbook: 'Ganita Prakash', chapter: 2, topic: 'Lines and Angles',
    desc: 'Types of lines — parallel, intersecting, perpendicular. Types of angles — acute, right, obtuse, straight, reflex. Measuring angles with a protractor. Angle relationships.' },
  { grade: 'Grade 6', subject: 'Mathematics', textbook: 'Ganita Prakash', chapter: 3, topic: 'Number Play',
    desc: 'Exploring numbers through games and puzzles. Students work with large numbers, divisibility, prime numbers, and discover interesting number properties through play.' },
  { grade: 'Grade 6', subject: 'Mathematics', textbook: 'Ganita Prakash', chapter: 4, topic: 'Data Handling and Presentation',
    desc: 'Collecting, organising and presenting data. Frequency tables, bar graphs, pictographs. Students learn to interpret data, calculate mean and draw conclusions.' },
  { grade: 'Grade 6', subject: 'Mathematics', textbook: 'Ganita Prakash', chapter: 5, topic: 'Prime Time',
    desc: 'Prime and composite numbers. Prime factorisation, factor trees, HCF and LCM. Tests of divisibility. Students explore the building blocks of numbers.' },
  { grade: 'Grade 6', subject: 'Mathematics', textbook: 'Ganita Prakash', chapter: 6, topic: 'Perimeter and Area',
    desc: 'Calculating perimeter of polygons and area of rectangles, squares and triangles. Using formulas. Word problems on fencing, tiling and covering surfaces.' },
  { grade: 'Grade 6', subject: 'Mathematics', textbook: 'Ganita Prakash', chapter: 7, topic: 'Fractions',
    desc: 'Types of fractions — proper, improper, mixed. Equivalent fractions. Comparing, adding, subtracting and multiplying fractions. Fractions in real-life contexts.' },
  { grade: 'Grade 6', subject: 'Mathematics', textbook: 'Ganita Prakash', chapter: 8, topic: 'Playing with Constructions',
    desc: 'Geometric constructions using ruler and compass. Constructing line segments, angles, perpendicular bisectors, and angle bisectors. Exploring properties through construction.' },
  { grade: 'Grade 6', subject: 'Mathematics', textbook: 'Ganita Prakash', chapter: 9, topic: 'Symmetry',
    desc: 'Lines of symmetry, reflection symmetry and rotational symmetry. Students identify symmetry in shapes, letters, nature and art. Creating symmetric designs.' },
  { grade: 'Grade 6', subject: 'Mathematics', textbook: 'Ganita Prakash', chapter: 10, topic: 'The Other Side of Zero',
    desc: 'Introduction to negative numbers and integers. The number line extended below zero. Adding and subtracting integers. Real-life uses — temperature, altitude, debt.' },

  // ══════════════════════════════════════════════════════════════════
  // CLASS 6 — Science — "Curiosity" (NCERT, 12 chapters)
  // ══════════════════════════════════════════════════════════════════
  { grade: 'Grade 6', subject: 'Science', textbook: 'Curiosity', chapter: 1, topic: 'The Wonderful World of Science',
    desc: 'Introduction to science — what is science, the scientific method, observation, curiosity and questioning. Students explore how science helps us understand the world around us.' },
  { grade: 'Grade 6', subject: 'Science', textbook: 'Curiosity', chapter: 2, topic: 'Diversity in Living World',
    desc: 'Biodiversity — the variety of plants and animals. Classification basics. Habitats — forests, deserts, oceans, grasslands. Why diversity matters for a healthy planet.' },
  { grade: 'Grade 6', subject: 'Science', textbook: 'Curiosity', chapter: 3, topic: 'Mindful Eating: A Path to a Healthy Body',
    desc: 'Nutrition and health. Nutrients — carbohydrates, proteins, fats, vitamins, minerals. Balanced diet, deficiency diseases, and making mindful food choices.' },
  { grade: 'Grade 6', subject: 'Science', textbook: 'Curiosity', chapter: 4, topic: 'Exploring Magnets',
    desc: 'Properties of magnets — poles, attraction, repulsion. Magnetic and non-magnetic materials. Making magnets. Magnetic compass and its uses. Earth as a magnet.' },
  { grade: 'Grade 6', subject: 'Science', textbook: 'Curiosity', chapter: 5, topic: 'Measurement of Length and Motion',
    desc: 'Standard units of measurement. Measuring length accurately. Types of motion — linear, circular, periodic, oscillatory. Speed and distance concepts.' },
  { grade: 'Grade 6', subject: 'Science', textbook: 'Curiosity', chapter: 6, topic: 'Material Around Us',
    desc: 'Properties of materials — hardness, solubility, transparency, conductivity. Grouping materials. Natural vs synthetic. How material properties determine their uses.' },
  { grade: 'Grade 6', subject: 'Science', textbook: 'Curiosity', chapter: 7, topic: 'Temperature and its Measurement',
    desc: 'What is temperature. Thermometers — clinical and laboratory. Celsius and Fahrenheit scales. How temperature affects our daily life. Heat vs temperature.' },
  { grade: 'Grade 6', subject: 'Science', textbook: 'Curiosity', chapter: 8, topic: 'A Journey through States of Water',
    desc: 'States of matter — solid, liquid, gas. Changes of state — melting, freezing, evaporation, condensation, boiling. The water cycle in nature.' },
  { grade: 'Grade 6', subject: 'Science', textbook: 'Curiosity', chapter: 9, topic: 'Methods of Separation in Everyday Life',
    desc: 'Separation techniques — handpicking, sieving, filtration, sedimentation, decantation, evaporation, distillation. Why separation is needed and where it is used.' },
  { grade: 'Grade 6', subject: 'Science', textbook: 'Curiosity', chapter: 10, topic: 'Living Creatures: Exploring Their Characteristics',
    desc: 'Characteristics of living organisms — growth, respiration, reproduction, movement, response to stimuli, excretion. Differentiating living from non-living things.' },
  { grade: 'Grade 6', subject: 'Science', textbook: 'Curiosity', chapter: 11, topic: "Nature's Treasures",
    desc: 'Natural resources — air, water, soil, minerals, forests, wildlife. Renewable vs non-renewable resources. Conservation and sustainable use of nature\'s treasures.' },
  { grade: 'Grade 6', subject: 'Science', textbook: 'Curiosity', chapter: 12, topic: 'Beyond Earth',
    desc: 'The solar system — Sun, planets, moons. Earth\'s rotation and revolution. Day-night cycle, seasons. Stars, constellations. India\'s space missions and exploration.' },
];

// ─────────────────────────────────────────────────────────────────────────────
async function seed() {
  console.log('Initialising Qdrant collection...');
  await initCollection();

  const grades = [...new Set(CHAPTERS.map(t => t.grade))];
  console.log(`Seeding CBSE curriculum: ${grades.join(', ')}`);
  console.log(`Total chapters: ${CHAPTERS.length}\n`);

  let success = 0, failed = 0;

  for (const t of CHAPTERS) {
    try {
      const content = `${t.textbook} — Chapter ${t.chapter}: ${t.topic}\n\n${t.desc}`;
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
          textbook:   t.textbook,
          chapter:    t.chapter,
          topic:      t.topic,
          text:       content,
          source:     'ncert_textbook',
          seeder:     SEEDER_TAG,
          type:       'curriculum',
        },
      }]);

      success++;
      console.log(`  ✓ [${t.grade}] ${t.subject} Ch${t.chapter}: ${t.topic}`);
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
