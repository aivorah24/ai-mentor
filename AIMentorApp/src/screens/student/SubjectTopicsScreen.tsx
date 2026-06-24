import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useStudentData } from '../../context/StudentDataContext';
import { useAuth } from '../../context/AuthContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius, fonts } from '../../theme';
import type { AppColors } from '../../theme';
import SERVER_URL from '../../config/serverUrl';
import { useResponsive } from '../../hooks/useResponsive';
import { LinearGradient } from 'expo-linear-gradient';

// ─── Types ────────────────────────────────────────────────────────────────────
interface TopicItem {
  topic:       string;
  unit:        string;
  description: string;
  imageUrl?:   string; // per-topic illustration (filled by the image pipeline)
}

// Per-card accent cycle — muted landing-palette colours (sage / purple / gold /
// teal / amber / rose), so each numbered topic card reads distinctly but stays
// on-brand instead of using neon hues.
const TOPIC_COLORS = ['#5F8A86', '#7E7AAD', '#B89150', '#5E8F86', '#B0894A', '#A85F77'];

// ─── Subject visual config ────────────────────────────────────────────────────
const SUBJECT_META: Record<string, { icon: any; color: string; bgFrom: string; bgTo: string }> = {
  'Mathematics':        { icon: 'trending-up', color: '#4A9E9A', bgFrom: '#B8DDD8', bgTo: '#C8EAE6' },
  'Science':            { icon: 'zap',         color: '#4A9E70', bgFrom: '#B0D8C0', bgTo: '#C4E8D4' },
  'EVS':                { icon: 'sun',         color: '#8A9E4A', bgFrom: '#D0D8A0', bgTo: '#DEE8B8' },
  'Social Studies':     { icon: 'globe',       color: '#A89840', bgFrom: '#E0D898', bgTo: '#EEE8B4' },
  'English':            { icon: 'book-open',   color: '#C85870', bgFrom: '#F0C8D0', bgTo: '#F8D8E0' },
  'Arts':               { icon: 'feather',     color: '#C87848', bgFrom: '#F0C8A8', bgTo: '#F8D8BC' },
  'Physical Education': { icon: 'activity',    color: '#C84868', bgFrom: '#F0B8C8', bgTo: '#F8CCD8' },
  'ICT':                { icon: 'monitor',     color: '#3A9896', bgFrom: '#A8D8D8', bgTo: '#BCE8E8' },
};
function meta(subject: string) {
  return SUBJECT_META[subject] ?? { icon: 'book', color: '#5F8A86', bgFrom: '#B8DDD8', bgTo: '#C8EAE6' };
}

// ─── Module buttons per subject ───────────────────────────────────────────────
const SUBJECT_MODULES: Record<string, Array<{ label: string; icon: any; color: string; route: string }>> = {
  'Mathematics': [
    { label: 'Start Learning', icon: 'play-circle', color: '#5F8A86', route: 'Learn5E'      },
    { label: 'Practice Test',  icon: 'check-square', color: '#4A9E9A', route: 'IBPYPQuiz'  },
    { label: 'Math Helper',    icon: 'hash',         color: '#7AADA8', route: 'MathHelper'  },
  ],
  'Science': [
    { label: 'Start Learning', icon: 'play-circle',  color: '#5A8A70', route: 'Learn5E'      },
    { label: 'Practice Test',  icon: 'check-square', color: '#3D8A60', route: 'IBPYPQuiz'   },
    { label: 'Drawing Buddy',  icon: 'edit-3',       color: '#B8797E', route: 'DrawingBuddy' },
  ],
  'EVS': [
    { label: 'Start Learning', icon: 'play-circle',  color: '#8A9E4A', route: 'Learn5E'      },
    { label: 'Practice Test',  icon: 'check-square', color: '#6A8A3A', route: 'IBPYPQuiz'   },
  ],
  'English': [
    { label: 'Start Learning', icon: 'play-circle',  color: '#B8797E', route: 'Learn5E'   },
    { label: 'Practice Test',  icon: 'check-square', color: '#C85870', route: 'IBPYPQuiz' },
    { label: 'Word Wizard',    icon: 'book',         color: '#8A8358', route: 'WordWizard' },
  ],
  'Social Studies': [
    { label: 'Start Learning', icon: 'play-circle',  color: '#8A8358', route: 'Learn5E'   },
    { label: 'Practice Test',  icon: 'check-square', color: '#A89840', route: 'IBPYPQuiz' },
    { label: 'Word Wizard',    icon: 'book',         color: '#B8797E', route: 'WordWizard' },
  ],
  'Arts': [
    { label: 'Start Learning', icon: 'play-circle',  color: '#C4836A', route: 'Learn5E'      },
    { label: 'Practice Test',  icon: 'check-square', color: '#C87848', route: 'IBPYPQuiz'   },
    { label: 'Drawing Buddy',  icon: 'edit-3',       color: '#B8797E', route: 'DrawingBuddy' },
  ],
  'Physical Education': [
    { label: 'Start Learning', icon: 'play-circle',  color: '#B8595F', route: 'Learn5E'   },
    { label: 'Practice Test',  icon: 'check-square', color: '#C84868', route: 'IBPYPQuiz' },
  ],
  'ICT': [
    { label: 'Start Learning', icon: 'play-circle',  color: '#7AADA8', route: 'Learn5E'   },
    { label: 'Practice Test',  icon: 'check-square', color: '#3A9896', route: 'IBPYPQuiz' },
  ],
};
function subjectModules(subject: string) {
  return SUBJECT_MODULES[subject] ?? [
    { label: 'Start Learning', icon: 'play-circle',  color: '#5F8A86', route: 'Learn5E'   },
    { label: 'Practice Test',  icon: 'check-square', color: '#4A9E9A', route: 'IBPYPQuiz' },
  ];
}

// ─── Static IB PYP topic fallbacks (shown when Qdrant not yet seeded) ─────────
const IB_PYP_STATIC_TOPICS: Record<string, Record<string, TopicItem[]>> = {
  'Grade 3': {
    'Mathematics': [
      { topic: 'Addition',                 unit: 'Number',              description: 'Combining numbers to find totals using + sign. Counting objects, number lines, and adding with carrying.' },
      { topic: 'Subtraction',              unit: 'Number',              description: 'Taking one number away from another using − sign. Counting back and borrowing.' },
      { topic: 'Multiplication',           unit: 'Number',              description: 'Repeated addition using × sign. Times tables for 2, 3, 4, 5, and 10.' },
      { topic: 'Division',                 unit: 'Number',              description: 'Sharing equally using ÷ sign. Grouping and sharing problems with counters.' },
      { topic: 'Place Value',              unit: 'Number',              description: 'A digit\'s value depends on its position — hundreds, tens, ones. Using base-ten blocks.' },
      { topic: 'Introduction to Fractions', unit: 'Number',             description: 'Equal parts of a whole. Halves, quarters, and fraction walls.' },
      { topic: 'Telling Time',             unit: 'Measurement',         description: 'Reading analog and digital clocks. Hours, half-hours, and 5-minute intervals.' },
      { topic: 'Length and Distance',      unit: 'Measurement',         description: 'Measuring length using cm, m, and km. Rulers and estimation.' },
      { topic: 'Mass and Weight',          unit: 'Measurement',         description: 'How heavy objects are using grams and kilograms. Balance scales.' },
      { topic: 'Money and Change',         unit: 'Measurement',         description: 'Identifying coins and notes, adding prices, calculating change.' },
      { topic: '2D Shapes',                unit: 'Shape and Space',     description: 'Flat shapes — triangles, squares, circles, hexagons. Sides and corners.' },
      { topic: '3D Shapes',                unit: 'Shape and Space',     description: 'Solid shapes — cubes, cylinders, pyramids. Faces, edges, and vertices.' },
      { topic: 'Symmetry',                 unit: 'Shape and Space',     description: 'Lines of symmetry in shapes and real-world objects.' },
      { topic: 'Perimeter',                unit: 'Shape and Space',     description: 'Total distance around a shape by adding all side lengths.' },
      { topic: 'Graphs and Data',          unit: 'Data Handling',       description: 'Reading and drawing bar charts, pictographs, and tally charts.' },
      { topic: 'Number Patterns',          unit: 'Patterns and Algebra', description: 'Skip counting, sequences, and rules for growing patterns.' },
    ],
    'Science': [
      { topic: 'Food Chains',              unit: 'Sharing the Planet',  description: 'How energy moves from plants to animals through eating.' },
      { topic: 'Plant Life Cycles',        unit: 'Sharing the Planet',  description: 'Seed → sprout → plant → flower → seed again. What plants need to grow.' },
      { topic: 'Animal Life Cycles',       unit: 'Sharing the Planet',  description: 'How animals are born, grow, reproduce, and die.' },
      { topic: 'Habitats and Ecosystems',  unit: 'Sharing the Planet',  description: 'Where animals and plants live and how they depend on each other.' },
      { topic: 'States of Matter',         unit: 'How the World Works', description: 'Solid, liquid, and gas — properties and how matter changes state.' },
      { topic: 'Magnets',                  unit: 'How the World Works', description: 'Magnetic forces — attract, repel, poles, and uses of magnets.' },
      { topic: 'Light and Shadow',         unit: 'How the World Works', description: 'How light travels, makes shadows, and reflects off surfaces.' },
      { topic: 'Sound',                    unit: 'How the World Works', description: 'How sound is made by vibrations and travels through materials.' },
      { topic: 'Water Cycle',              unit: 'How the World Works', description: 'Evaporation, condensation, precipitation, and collection.' },
      { topic: 'Weather and Seasons',      unit: 'How the World Works', description: 'Types of weather, seasons, and how they affect living things.' },
      { topic: 'Soil and Rocks',           unit: 'How the World Works', description: 'Types of soil, rock formation, and importance to living things.' },
    ],
    'English': [
      { topic: 'Phonics and Decoding',     unit: 'Reading',   description: 'Letter sounds, blends, and strategies to decode unfamiliar words.' },
      { topic: 'Reading Comprehension',    unit: 'Reading',   description: 'Understanding texts — main idea, details, and making inferences.' },
      { topic: 'Narrative Writing',        unit: 'Writing',   description: 'Writing stories with a beginning, middle, and end.' },
      { topic: 'Informational Writing',    unit: 'Writing',   description: 'Writing facts and explanations on real topics.' },
      { topic: 'Nouns and Pronouns',       unit: 'Grammar',   description: 'People, places, things; replacing nouns with he, she, it, they.' },
      { topic: 'Verbs and Tenses',         unit: 'Grammar',   description: 'Action words in past, present, and future tense.' },
      { topic: 'Adjectives and Describing Words', unit: 'Grammar', description: 'Words that describe nouns — size, colour, shape, feeling.' },
      { topic: 'Punctuation',              unit: 'Grammar',   description: 'Full stops, commas, question marks, and exclamation marks.' },
      { topic: 'Vocabulary and Word Study', unit: 'Word Study', description: 'Building vocabulary through reading, prefixes, suffixes, and context.' },
    ],
    'Social Studies': [
      { topic: 'Maps and Globes',          unit: 'Where We Are in Place and Time', description: 'Reading maps, understanding globes, continents, and oceans.' },
      { topic: 'Cardinal Directions',      unit: 'Where We Are in Place and Time', description: 'North, South, East, West — using a compass and map keys.' },
      { topic: 'Landforms and Bodies of Water', unit: 'Where We Are in Place and Time', description: 'Mountains, valleys, rivers, lakes — Earth\'s physical features.' },
      { topic: 'Communities',              unit: 'How We Organize Ourselves', description: 'What makes a community — rules, roles, and responsibilities.' },
      { topic: 'Needs and Wants',          unit: 'How We Organize Ourselves', description: 'Difference between things we must have and things we\'d like.' },
      { topic: 'Goods and Services',       unit: 'How We Organize Ourselves', description: 'Products people make vs. work people do for others.' },
      { topic: 'Cultural Traditions',      unit: 'Who We Are',                description: 'Celebrations, food, music, and customs from different cultures.' },
      { topic: 'Timelines and History',    unit: 'Where We Are in Place and Time', description: 'Ordering events in time — personal, local, and world history.' },
    ],
    'Arts': [
      { topic: 'Elements of Art',          unit: 'Visual Arts', description: 'Line, shape, colour, texture, space — building blocks of artwork.' },
      { topic: 'Color Theory',             unit: 'Visual Arts', description: 'Primary, secondary, warm and cool colours. The colour wheel.' },
      { topic: 'Rhythm and Beat',          unit: 'Music',       description: 'Keeping time, clapping rhythms, and understanding musical pulse.' },
      { topic: 'Musical Instruments',      unit: 'Music',       description: 'Families of instruments — strings, wind, percussion, keyboard.' },
    ],
    'Physical Education': [
      { topic: 'Fundamental Motor Skills', unit: 'Movement Skills',    description: 'Running, jumping, throwing, catching — building athletic foundations.' },
      { topic: 'Nutrition and Healthy Living', unit: 'Health and Wellness', description: 'Food groups, balanced diet, hydration, and daily exercise habits.' },
      { topic: 'Team Games and Sports',    unit: 'Games',              description: 'Cooperation, rules, fair play, and basic team sports.' },
    ],
    'ICT': [
      { topic: 'Computer Basics',          unit: 'Technology',          description: 'Parts of a computer, keyboard, mouse, and how to use software.' },
      { topic: 'Internet Safety',          unit: 'Digital Citizenship', description: 'Staying safe online — passwords, sharing, and cyberbullying.' },
    ],
  },
  'Grade 4': {
    'Mathematics': [
      { topic: 'Indian Place Value Chart',    unit: 'Number',             description: 'Ones, tens, hundreds, thousands, ten-thousands, lakhs, ten-lakhs, crores — the Indian number system.' },
      { topic: 'LCM (Least Common Multiple)', unit: 'Number',             description: 'Finding the LCM using the listing-multiples and prime-factorisation methods, with real-life examples.' },
      { topic: 'Large Numbers up to 100,000', unit: 'Number',           description: 'Reading, writing, comparing, and ordering 5-digit numbers.' },
      { topic: 'Long Multiplication',       unit: 'Number',             description: 'Multiplying 2 and 3-digit numbers using the column method.' },
      { topic: 'Long Division',             unit: 'Number',             description: 'Dividing larger numbers with and without remainders.' },
      { topic: 'Decimals',                  unit: 'Number',             description: 'Tenths and hundredths — reading, writing, comparing decimal numbers.' },
      { topic: 'Decimal Operations',        unit: 'Number',             description: 'Adding, subtracting, and multiplying decimals — including multiplying a decimal by a whole number.' },
      { topic: 'Currency Conversion',       unit: 'Number',             description: 'Converting between Indian Rupees and foreign currencies (GBP, USD, SGD, CAD) using multiplication and division.' },
      { topic: 'Equivalent Fractions',      unit: 'Number',             description: 'Finding fractions equal in value. Simplifying and comparing fractions.' },
      { topic: 'Negative Numbers',          unit: 'Number',             description: 'Numbers below zero — temperature, number lines, and ordering.' },
      { topic: 'Angles',                    unit: 'Shape and Space',    description: 'Right, acute, and obtuse angles. Measuring angles with a protractor.' },
      { topic: 'Area',                      unit: 'Measurement',        description: 'Space inside a 2D shape — counting squares and using formulas.' },
      { topic: 'Perimeter and Area Problems', unit: 'Measurement',      description: 'Solving real-world problems involving perimeter and area.' },
      { topic: 'Roman Numerals',            unit: 'Number',             description: 'Reading and writing Roman numerals I to C.' },
      { topic: 'Probability',               unit: 'Data Handling',      description: 'Likelihood of events — impossible, unlikely, even, likely, certain.' },
      { topic: 'Line Graphs and Data Analysis', unit: 'Data Handling',  description: 'Reading and interpreting line graphs. Identifying trends.' },
      { topic: 'Estimation and Rounding Off', unit: 'Number',           description: 'Rounding numbers to the nearest 10, 100, and 1000, and estimating answers in real-life situations.' },
      { topic: 'Properties of Lines',       unit: 'Shape and Space',    description: 'Parallel, perpendicular, horizontal, vertical, and intersecting lines.' },
      { topic: 'Types of Fractions',        unit: 'Number',             description: 'Unit, proper, improper, mixed, like, and unlike fractions, with bar models.' },
      { topic: 'Fractions on a Number Line', unit: 'Number',            description: 'Placing and comparing fractions on a number line.' },
      { topic: 'Conversion of Length Units', unit: 'Measurement',       description: 'Converting between kilometres, metres, centimetres, and millimetres, with real-life measurement problems.' },
      { topic: 'Successors and Predecessors', unit: 'Number',           description: 'Finding the number that comes just before (predecessor) and just after (successor) a given number.' },
    ],
    'Science': [
      { topic: 'Forces and Motion',         unit: 'How the World Works', description: 'Push, pull, gravity, friction — how forces change movement.' },
      { topic: 'Simple Machines',           unit: 'How the World Works', description: 'Levers, pulleys, inclined planes — how they make work easier.' },
      { topic: 'Electricity and Circuits',  unit: 'How the World Works', description: 'Circuits, conductors, insulators — how electricity flows.' },
      { topic: 'Adaptations',               unit: 'Sharing the Planet',  description: 'How animals and plants adapt to survive in their environments.' },
      { topic: 'Ecosystems and Food Webs',  unit: 'Sharing the Planet',  description: 'Interconnected food chains — producers, consumers, decomposers.' },
      { topic: 'Human Body Systems',        unit: 'Who We Are',          description: 'Digestive, circulatory, and respiratory systems and how they work.' },
      { topic: 'Rock Cycle',                unit: 'How the World Works', description: 'Igneous, sedimentary, metamorphic rocks and how they form.' },
      { topic: 'Renewable and Non-Renewable Energy', unit: 'Sharing the Planet', description: 'Solar, wind, water vs. coal and oil — sustainable choices.' },
    ],
    'Social Studies': [
      { topic: 'Identity and Self-Awareness', unit: 'Who We Are',                    description: 'Who we are — exploring personal identity, cultural heritage, emotions, and self-awareness.' },
      { topic: 'Human Body Systems',        unit: 'Who We Are',                     description: 'Digestive, circulatory, and respiratory systems — connecting to identity and self-awareness.' },
      { topic: 'Government and Democracy',  unit: 'How We Organize Ourselves',      description: 'How governments work, voting, laws, and citizen rights.' },
      { topic: 'Trade and Economics',       unit: 'How We Organize Ourselves',      description: 'Import, export, supply and demand in local and global trade.' },
      { topic: 'Migration and Movement',    unit: 'Where We Are in Place and Time', description: 'Why people move — push and pull factors, refugees, immigration.' },
      { topic: 'History of Migration',      unit: 'Where We Are in Place and Time', description: 'Why people have moved across history — trade routes, conquests, famines, and the search for better lives.' },
      { topic: 'Historical Timeline',       unit: 'Where We Are in Place and Time', description: 'Reading and creating timelines — placing events in chronological order to understand how history progressed.' },
      { topic: 'Economic Activities',       unit: 'How We Organize Ourselves',      description: 'Barter system, trade, currency, and how economies function.' },
      { topic: 'Barter System',             unit: 'How We Organize Ourselves',      description: 'The earliest form of trade — exchanging goods without money, its history, problems, and evolution into modern currency.' },
    ],
    'English': [
      { topic: 'Figurative Language',       unit: 'Reading',   description: 'Similes, metaphors, personification — how writers make language vivid.' },
      { topic: 'Poetry Writing',            unit: 'Writing',   description: 'Rhyme, rhythm, haiku, free verse — expressing ideas through poetry.' },
      { topic: 'Persuasive Writing',        unit: 'Writing',   description: 'Arguments, opinions, and convincing language techniques.' },
      { topic: 'Paragraph Structure',       unit: 'Writing',   description: 'Topic sentence, supporting details, concluding sentence.' },
      { topic: 'Adverbs and Conjunctions',  unit: 'Grammar',   description: 'Words that modify verbs; joining clauses with because, although, while.' },
    ],
    'Economics & Trade': [
      { topic: 'Barter System',         unit: 'How We Organize Ourselves', description: 'The earliest form of trade — exchanging goods without money, its history, problems, and evolution into modern currency.' },
      { topic: 'Currency Conversion',   unit: 'How We Organize Ourselves', description: 'Converting between Indian Rupees and world currencies — GBP, USD, SGD, CAD. Which currency does France use?' },
      { topic: 'Types of Money',        unit: 'How We Organize Ourselves', description: 'From shells and salt to coins and paper money — how currency evolved across history.' },
      { topic: 'Trade Routes',          unit: 'How We Organize Ourselves', description: 'How the Portuguese came to India for spices — ancient and modern trade routes that connected the world.' },
    ],
    'Arts': [
      { topic: 'Perspective and Depth in Art', unit: 'Visual Arts', description: 'Creating 3D illusions on paper — foreground, middleground, background.' },
      { topic: 'Melody and Harmony',        unit: 'Music',           description: 'Creating and layering musical lines. Chords and musical keys.' },
      { topic: 'Rhythm',                    unit: 'Music',           description: 'The pattern of beats in music — tempo, pulse, and rhythmic patterns.' },
      { topic: 'Tempo and Dynamics',        unit: 'Music',           description: 'How fast or slow music is played (tempo) and how loud or soft (dynamics — forte, piano, crescendo).' },
      { topic: 'Timbre',                    unit: 'Music',           description: 'The unique tone colour of an instrument or voice — why a guitar sounds different from a flute.' },
      { topic: 'Families of the Orchestra', unit: 'Music',           description: 'The four instrument families — Strings, Brass, Woodwind, and Percussion — and the instruments in each.' },
    ],
    'Physical Education': [
      { topic: 'Aerobic Fitness',           unit: 'Health and Wellness', description: 'Cardio exercises, heart rate, and building stamina.' },
      { topic: 'Sportsmanship and Fair Play', unit: 'Games',           description: 'Respect, teamwork, winning and losing gracefully.' },
    ],
    'ICT': [
      { topic: 'Spreadsheets and Data',     unit: 'Technology',          description: 'Using spreadsheet software to organise, sort, and analyse data.' },
      { topic: 'Algorithms and Coding',     unit: 'Computational Thinking', description: 'Writing step-by-step instructions. Intro to block coding.' },
    ],
  },
  'Grade 5': {
    'Mathematics': [
      { topic: 'Order of Operations (BODMAS)', unit: 'Number',          description: 'Brackets, Orders, Division, Multiplication, Addition, Subtraction.' },
      { topic: 'Adding and Subtracting Fractions', unit: 'Number',      description: 'Finding common denominators to add and subtract fractions.' },
      { topic: 'Percentages',               unit: 'Number',             description: 'Converting between fractions, decimals, and percentages.' },
      { topic: 'Ratio and Proportion',      unit: 'Number',             description: 'Comparing quantities using ratios. Scaling recipes and maps.' },
      { topic: 'Prime and Composite Numbers', unit: 'Number',           description: 'Identifying primes, finding factors, and prime factorisation.' },
      { topic: 'Integers and Number Lines', unit: 'Number',             description: 'Positive and negative whole numbers. Adding and subtracting integers.' },
      { topic: 'Volume and Capacity',       unit: 'Measurement',        description: 'Volume of 3D shapes. Litres and millilitres conversion.' },
      { topic: 'Coordinates',               unit: 'Shape and Space',    description: 'Plotting and reading points on a coordinate grid (4 quadrants).' },
      { topic: 'Transformations',           unit: 'Shape and Space',    description: 'Translation, reflection, rotation of shapes on a grid.' },
      { topic: 'Mean, Median, Mode and Range', unit: 'Data Handling',   description: 'Measures of average and spread for a data set.' },
      { topic: 'Introduction to Algebra',   unit: 'Patterns and Algebra', description: 'Using letters for unknowns. Solving simple equations.' },
    ],
    'Science': [
      { topic: 'Earth and the Solar System', unit: 'How the World Works', description: 'Planets, orbits, seasons, day and night — Earth\'s place in space.' },
      { topic: 'Physical and Chemical Changes', unit: 'How the World Works', description: 'Reversible vs. irreversible changes — melting, burning, rusting.' },
      { topic: 'Inheritance and Genetics Basics', unit: 'Sharing the Planet', description: 'How traits pass from parents to offspring through genes.' },
      { topic: 'Climate Change and Environment', unit: 'Sharing the Planet', description: 'Causes and effects of global warming. Our role in sustainability.' },
      { topic: 'Microorganisms',            unit: 'Who We Are',          description: 'Bacteria, viruses, fungi — helpful and harmful microbes.' },
      { topic: 'Photosynthesis',            unit: 'Sharing the Planet',  description: 'How plants make food using sunlight, water, and CO₂.' },
      { topic: 'Nervous System and Senses', unit: 'Who We Are',          description: 'Brain, spinal cord, nerves — how your body receives information.' },
    ],
    'Social Studies': [
      { topic: 'Ancient Civilizations',     unit: 'Where We Are in Place and Time', description: 'Egypt, Greece, Rome — how early civilizations shaped our world.' },
      { topic: 'Climate Zones and Geography', unit: 'Where We Are in Place and Time', description: 'Tropical, temperate, polar zones — how climate shapes life.' },
      { topic: 'Human Rights',              unit: 'Who We Are',                    description: 'Universal Declaration, children\'s rights, and responsibilities.' },
      { topic: 'Globalisation',             unit: 'How We Organize Ourselves',     description: 'How countries are connected through trade, technology, and culture.' },
      { topic: 'Sustainability',            unit: 'Sharing the Planet',            description: 'Balancing human needs with protecting the environment for the future.' },
      { topic: 'Colonialism and Independence', unit: 'Where We Are in Place and Time', description: 'History of colonisation and how nations gained independence.' },
      { topic: 'International Organisations', unit: 'How We Organize Ourselves',   description: 'UN, WHO, UNESCO — how global bodies tackle world challenges.' },
    ],
    'English': [
      { topic: 'Literary Devices',          unit: 'Reading',   description: 'Symbolism, irony, foreshadowing, alliteration in literature.' },
      { topic: 'Debate and Argumentation',  unit: 'Speaking and Listening', description: 'Structuring arguments, using evidence, and responding to counter-arguments.' },
      { topic: 'Research and Essay Writing', unit: 'Writing',  description: 'Finding sources, taking notes, and writing a structured essay.' },
      { topic: 'Media Literacy',            unit: 'Reading',   description: 'Analysing news, advertisements, and digital content critically.' },
      { topic: 'Prepositions, Clauses and Complex Sentences', unit: 'Grammar', description: 'Advanced sentence construction using subordinate and relative clauses.' },
    ],
    'Arts': [
      { topic: 'Mixed Media and Abstract Art', unit: 'Visual Arts', description: 'Combining paint, collage, and found materials to create abstract work.' },
      { topic: 'Music Composition',         unit: 'Music',           description: 'Writing original melodies. Understanding musical notation and structure.' },
    ],
    'Physical Education': [
      { topic: 'Mental Health and Wellbeing', unit: 'Health and Wellness', description: 'Stress, emotions, mindfulness, and healthy habits for mental wellness.' },
      { topic: 'Game Strategy and Tactics', unit: 'Games',           description: 'Analysing and applying strategies in individual and team games.' },
    ],
    'ICT': [
      { topic: 'Introduction to Artificial Intelligence', unit: 'Computational Thinking', description: 'What AI is, how it learns, and how it affects our daily lives.' },
      { topic: 'Cybersecurity and Digital Responsibility', unit: 'Digital Citizenship', description: 'Protecting personal data, ethical use of technology, and online safety.' },
    ],
  },
};

function getStaticTopics(curriculum: string, grade: string, subject: string): TopicItem[] {
  const isPYP = /^ib.?pyp$/i.test(curriculum.trim());
  if (!isPYP) return [];
  return IB_PYP_STATIC_TOPICS[grade]?.[subject] ?? [];
}

// ─── Topic Card ───────────────────────────────────────────────────────────────
function TopicCard({
  index, t, done, subject, onModule, colors, isDark, cardWidth,
}: {
  index:     number;
  t:         TopicItem;
  done:      boolean;
  subject:   string;
  onModule:  (route: string) => void;
  colors:    AppColors;
  isDark:    boolean;
  cardWidth: any;
}) {
  const accent    = done ? '#3FA06A' : TOPIC_COLORS[index % TOPIC_COLORS.length];
  const onAccent  = isDark ? '#0B140F' : '#FFFFFF';
  const modules   = subjectModules(subject);
  const primary   = modules.find(mod => mod.route === 'Learn5E') ?? modules[0];
  const secondary = modules.filter(mod => mod !== primary);
  const subjIcon  = meta(subject).icon;
  const hasImg    = !!t.imageUrl;
  const imgUri    = hasImg ? (t.imageUrl!.startsWith('http') ? t.imageUrl! : `${SERVER_URL}${t.imageUrl}`) : '';

  return (
    <View style={[tc.card, { width: cardWidth, backgroundColor: isDark ? colors.cardDark : '#fff', borderColor: colors.borderColor }]}>
      {/* Illustration banner (real image when available, else themed placeholder) */}
      <View style={[tc.illu, { borderBottomColor: accent + '2E' }]}>
        <LinearGradient
          colors={[accent + (isDark ? '40' : '26'), isDark ? '#0E140F' : (accent + '10')]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill as any}
        />
        {hasImg
          ? <Image source={{ uri: imgUri }} style={StyleSheet.absoluteFillObject as any} resizeMode="cover" />
          : <Feather name={subjIcon} size={42} color={accent} style={{ opacity: 0.92 }} />}
        <View style={[tc.numBadge, { backgroundColor: accent }]}>
          <Text style={[tc.numText, { color: onAccent }]}>{String(index + 1).padStart(2, '0')}</Text>
        </View>
        {done && (
          <View style={tc.doneBadge}>
            <Feather name="check" size={12} color="#fff" />
          </View>
        )}
      </View>

      {/* Body */}
      <View style={tc.body}>
        <Text style={[tc.title, { color: colors.textMain }]} numberOfLines={2}>{t.topic}</Text>
        {!!t.description && (
          <Text style={[tc.desc, { color: colors.textMuted }]} numberOfLines={3}>{t.description}</Text>
        )}

        <TouchableOpacity
          style={[tc.primaryBtn, { backgroundColor: accent }]}
          activeOpacity={0.85}
          onPress={() => onModule(primary.route)}
        >
          <Feather name="play-circle" size={14} color={onAccent} />
          <Text style={[tc.primaryText, { color: onAccent }]}>Start Learning</Text>
        </TouchableOpacity>

        {secondary.length > 0 && (
          <View style={tc.secRow}>
            {secondary.map(mod => (
              <TouchableOpacity
                key={mod.route}
                style={[tc.secBtn, { borderColor: accent + '4D' }]}
                activeOpacity={0.75}
                onPress={() => onModule(mod.route)}
              >
                <Feather name={mod.icon} size={12} color={accent} />
                <Text style={[tc.secText, { color: accent }]}>{mod.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const tc = StyleSheet.create({
  card:        { borderRadius: 18, borderWidth: 1, overflow: 'hidden', marginBottom: 0 },
  illu:        { height: 150, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1 },
  numBadge:    { position: 'absolute', top: 12, left: 12, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  numText:     { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  doneBadge:   { position: 'absolute', top: 12, right: 12, width: 24, height: 24, borderRadius: 12, backgroundColor: '#3FA06A', alignItems: 'center', justifyContent: 'center' },
  body:        { padding: 16, gap: 8 },
  title:       { fontFamily: fonts.serif, fontSize: 18, fontWeight: '700', lineHeight: 24, letterSpacing: -0.3 },
  desc:        { fontSize: 12.5, lineHeight: 18 },
  primaryBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 10, marginTop: 2 },
  primaryText: { fontSize: 13, fontWeight: '700' },
  secRow:      { flexDirection: 'row', gap: 8 },
  secBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 9, borderWidth: 1 },
  secText:     { fontSize: 11.5, fontWeight: '600' },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function SubjectTopicsScreen({ navigation, route }: any) {
  const subject    = (route?.params?.subject    ?? 'Mathematics') as string;
  const curriculum = (route?.params?.curriculum ?? 'IB PYP')      as string;
  const grade      = (route?.params?.grade      ?? 'Grade 3')      as string;

  const { colors, isDark } = useTheme();
  const { isMobile }       = useResponsive();
  const { width }          = useWindowDimensions();
  const cardWidth          = isMobile ? '100%' : (width >= 1080 ? '31.5%' : '48.5%');
  const { stats }     = useStudentData();
  const { user }      = useAuth();
  const styles        = useMemo(() => makeStyles(colors), [colors]);

  const completedSet = useMemo(() => new Set(stats.completedTopics ?? []), [stats.completedTopics]);
  const m            = meta(subject);

  const [topics,  setTopics]  = useState<TopicItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const qdrantCurriculum = curriculum.replace(/ /g, '_'); // IB PYP → IB_PYP

  useEffect(() => {
    // Pre-load static topics instantly so screen is never empty
    const staticFallback = getStaticTopics(curriculum, grade, subject);
    setTopics(staticFallback);
    setLoading(staticFallback.length === 0);
    setError('');

    let cancelled = false;
    fetch(
      `${SERVER_URL}/curriculum/subjects?grade=${encodeURIComponent(grade)}&curriculum=${encodeURIComponent(qdrantCurriculum)}`,
    )
      .then(r => r.json())
      .then((data: { subjects: Array<{ subject: string; topics: TopicItem[] }> }) => {
        if (cancelled) return;
        const found = data.subjects?.find(s => s.subject === subject);
        // Override with Qdrant data only if it has real content
        if (found?.topics && found.topics.length > 0) {
          setTopics(found.topics);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Static fallback already showing — just stop loading, no error needed
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [subject, grade, curriculum, qdrantCurriculum]);

  const doneCount = topics.filter(t => completedSet.has(t.topic)).length;
  const pct       = topics.length > 0 ? Math.round((doneCount / topics.length) * 100) : 0;

  function handleModule(routeName: string, topic: TopicItem, index: number) {
    if (routeName === 'Learn5E') {
      navigation.navigate('VideoLesson', { topic: topic.topic, grade, subject, curriculum });
    } else if (routeName === 'IBPYPQuiz') {
      navigation.navigate('IBPYPQuiz', { topic: topic.topic, grade, subject, curriculum });
    } else {
      navigation.navigate(routeName, {
        topic: topic.topic,
        chapterId: index + 1,
        unit: topic.unit || subject,
        subject,
        grade,
        curriculum,
      });
    }
  }

  if (loading) {
    return (
      <ScreenLayout>
        <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator size="large" color={m.color} />
          <Text style={[styles.dimText, { marginTop: 16 }]}>Loading {subject} topics…</Text>
        </View>
      </ScreenLayout>
    );
  }

  if (error) {
    return (
      <ScreenLayout>
        <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center', padding: 32 }]}>
          <Feather name="wifi-off" size={40} color={colors.textMuted} />
          <Text style={[styles.dimText, { marginTop: 16, textAlign: 'center' }]}>{error}</Text>
        </View>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <View style={styles.screen}>
        <Header
          title={subject}
          subtitle={`${curriculum} · ${grade} · ${topics.length} Topics`}
          showBack={true}
          onMenuPress={() => navigation.openDrawer()}
        />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* ── My Learning Path header + progress ── */}
          <View style={[styles.pathHeader, isMobile && { flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pathTitle}>My Learning Path</Text>
              <Text style={styles.pathSub}>Complete each topic step by step. Your progress is saved automatically.</Text>
            </View>
            <View style={[styles.progressCard, { borderColor: colors.borderColor }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.progressLabel, { color: colors.textMuted }]}>Your Progress</Text>
                <Text style={[styles.progressPctText, { color: colors.textMain }]}>{pct}% Complete</Text>
                <View style={[styles.progBarTrack, { backgroundColor: colors.borderColor }]}>
                  <LinearGradient
                    colors={['#3FA06A', '#BAA467']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={[styles.progBarFill, { width: `${pct}%` as any }]}
                  />
                </View>
              </View>
              <View style={[styles.owl, { backgroundColor: m.color + '22', borderColor: m.color + '55' }]}>
                <Feather name="feather" size={22} color={m.color} />
              </View>
            </View>
          </View>

          {/* ── Topics grid ── */}
          {topics.length === 0 ? (
            <View style={styles.emptyBox}>
              <Feather name="inbox" size={36} color={colors.textMuted} />
              <Text style={[styles.dimText, { marginTop: 12, textAlign: 'center' }]}>
                No topics found for {subject} in {grade} {curriculum}.
              </Text>
            </View>
          ) : (
            <View style={styles.topicsGrid}>
              {topics.map((t, i) => (
                <TopicCard
                  key={t.topic}
                  index={i}
                  t={t}
                  done={completedSet.has(t.topic)}
                  subject={subject}
                  onModule={(modRoute) => handleModule(modRoute, t, i)}
                  colors={colors}
                  isDark={isDark}
                  cardWidth={cardWidth}
                />
              ))}
            </View>
          )}

        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (c: AppColors) => StyleSheet.create({
  screen:   { flex: 1, backgroundColor: c.bgDark },
  content:  { padding: spacing.xl, paddingBottom: 40, gap: spacing.xl },
  dimText:  { fontSize: 13, color: c.textMuted },
  backRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.xl, paddingVertical: 8 },
  backText: { fontSize: 13, fontWeight: '500' },

  // My Learning Path header
  pathHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  pathTitle:  { fontFamily: fonts.serif, fontSize: 26, fontWeight: '700', color: c.textMain, letterSpacing: -0.4 },
  pathSub:    { fontSize: 13, color: c.textMuted, marginTop: 4, lineHeight: 19 },

  progressCard:    { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: 16, minWidth: 280 },
  progressLabel:   { fontSize: 12, fontWeight: '600' },
  progressPctText: { fontSize: 14, fontWeight: '700', marginTop: 1 },
  progBarTrack:    { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 8 },
  progBarFill:     { height: '100%', borderRadius: 3 },
  owl:             { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  topicsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, justifyContent: 'flex-start' },

  emptyBox: { alignItems: 'center', paddingVertical: 48 },

  // Aivorah tutor footer
  tutorFooter: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: radius.lg, padding: 16 },
  tutorAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  tutorName:   { fontSize: 14, fontWeight: '600' },
  tutorMsg:    { fontSize: 12.5, marginTop: 2 },
  helpBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  helpText:    { fontSize: 12.5, fontWeight: '600' },
});
