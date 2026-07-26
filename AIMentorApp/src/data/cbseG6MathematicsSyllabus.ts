/**
 * cbseG6MathematicsSyllabus.ts
 * Curated, chapter-accurate syllabus for CBSE / NCERT Grade 6 Mathematics —
 * "Ganita Prakash". Chapter titles and section names verified directly
 * against the official NCERT source PDFs (fegp101-fegp110.pdf), the same
 * verification standard used for cbseG6EnglishSyllabus.ts — this replaces
 * the flat, AI-generated "1906 Topics" fallback list (bogus titles like
 * "5-digit palindrome puzzle") that Grade 6 Mathematics was falling back to
 * because no curated syllabus existed for it yet.
 *
 * Only the Fractions chapter (ch.7) has full curated readText so far — its
 * content is sourced from the same real chapter text that grounds the Math
 * Learning Engine's Fractions lesson (server/pipelines/math/*, chapterCode
 * "fegp107"). The remaining 9 chapters are marked `comingSoon` with their
 * real NCERT chapter/section titles (not invented ones) so the syllabus
 * list is honest about what's ready vs pending, matching the English/
 * Science/Social Science pilots' pattern.
 */
import type { SyllabusChapter } from './cbseG6EnglishSyllabus';

export const CBSE_G6_MATHEMATICS_SYLLABUS: SyllabusChapter[] = [
  {
    title: 'Patterns in Mathematics',
    comingSoon: true,
    topics: [
      {
        name: 'What is Mathematics?', kind: 'Concept', page: 'p.1', pdfFile: 'fegp101.pdf', pdfPage: 1,
        comingSoon: false, // ready individually — rest of this chapter isn't yet
        readText: {
          intro: 'Mathematics is, in large part, the search for patterns, and for the explanations as to why those patterns exist.',
          body: [
            'Such patterns exist all around us — in nature, in our homes and schools, and in the motion of the sun, moon, and stars. They occur in everything we do and see, from shopping and cooking, to throwing a ball and playing games, to understanding weather patterns and using technology.',
            'The search for patterns and their explanations can be a fun and creative endeavour. It is for this reason that mathematicians think of mathematics both as an art and as a science.',
            'Mathematics aims not just to find out what patterns exist, but also the explanations for why they exist. Such explanations can often then be used in applications well beyond the context in which they were discovered.',
            'For example, understanding patterns in the motion of stars, planets, and their satellites led humankind to develop the theory of gravitation — allowing us to launch satellites and send rockets to the Moon and Mars. Understanding patterns in genomes has helped in diagnosing and curing diseases.',
            'Many number sequences can be visualised using pictures — seeing a pattern drawn as dots or shapes can make it much easier to understand. The picture alongside shows counting numbers, odd numbers, even numbers, triangular numbers, squares, and cubes, each drawn as a growing pattern of dots.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1784802482/ncert/grade6/Mathematics/fegp101_p4_pageimg.png',
          figureCaption: 'Number sequences visualised as pictures — squares, triangular numbers, and cubes, each as a pattern of dots (NCERT, Ganita Prakash Grade 6, p.4).',
          activity: 'Think of one place in your everyday life where you notice a pattern (in shopping, cooking, games, or weather) — can you explain why that pattern happens?',
        },
      },
      { name: 'Number Patterns', kind: 'Concept', page: 'p.4',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Visualising Number Sequences', kind: 'Concept', page: 'p.10',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
    ],
  },
  {
    title: 'Lines and Angles',
    comingSoon: true,
    topics: [
      { name: 'Points, Lines, Rays and Line Segments', kind: 'Concept', page: 'p.1', pdfFile: 'fegp102.pdf', pdfPage: 1,
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Angles — Naming and Measuring', kind: 'Concept', page: 'p.8',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Types of Angles', kind: 'Concept', page: 'p.14',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
    ],
  },
  {
    title: 'Number Play',
    comingSoon: true,
    topics: [
      { name: 'Supercells and Smallest/Largest Numbers', kind: 'Concept', page: 'p.1', pdfFile: 'fegp103.pdf', pdfPage: 1,
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Palindromes and Number Games', kind: 'Concept', page: 'p.6',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Estimation in Numbers', kind: 'Concept', page: 'p.12',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
    ],
  },
  {
    title: 'Data Handling and Presentation',
    comingSoon: true,
    topics: [
      { name: 'What is Data?', kind: 'Concept', page: 'p.1', pdfFile: 'fegp104.pdf', pdfPage: 1,
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Organising and Recording Data', kind: 'Concept', page: 'p.6',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Pictographs and Bar Graphs', kind: 'Concept', page: 'p.12',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
    ],
  },
  {
    title: 'Prime Time',
    comingSoon: true,
    topics: [
      { name: 'Multiples and Factors', kind: 'Concept', page: 'p.1', pdfFile: 'fegp105.pdf', pdfPage: 1,
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Prime and Composite Numbers', kind: 'Concept', page: 'p.6',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Common Factors and Common Multiples', kind: 'Concept', page: 'p.12',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
    ],
  },
  {
    title: 'Perimeter and Area',
    comingSoon: true,
    topics: [
      { name: 'Perimeter of Closed Figures', kind: 'Concept', page: 'p.1', pdfFile: 'fegp106.pdf', pdfPage: 1,
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Area — Counting Squares', kind: 'Concept', page: 'p.7',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Area of a Rectangle and Square', kind: 'Concept', page: 'p.13',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
    ],
  },
  {
    title: 'Fractions',
    topics: [
      {
        name: 'Fractional Units and Equal Shares', kind: 'Concept', page: 'p.151', pdfFile: 'fegp107.pdf', pdfPage: 1,
        readText: {
          // Kept for the plain Learn tab / older readers of readText.intro+body —
          // the real teaching happens in listenParts below (used by the AI Tutor
          // step view), built directly from the book's own Shabnam–Mukta and
          // Beni–Arvin dialogues rather than a paraphrased summary.
          intro: 'One roti, shared between 2 children. One roti, shared between 4 children. Which child gets more?',
          body: [
            'When 2 children share 1 roti equally, each child gets 1/2 roti. When 4 children share the same 1 roti equally, each child gets 1/4 roti. Since more children are sharing the same roti, each child\'s share gets smaller — so 1/2 roti is more than 1/4 roti.',
            'When one whole is divided into equal parts, each part is called a fractional unit (or "unit fraction") — 1/2, 1/3, 1/4, 1/5, ... 1/100 are all fractional units.',
            'A common mistake: is 1/9 bigger than 1/5, since 9 is a bigger number than 5? No — think of it as sharing. If 1 roti is shared among 9 children instead of 5, each child gets LESS, not more. So 1/9 is actually smaller than 1/5. The bigger the number you divide by, the smaller each share.',
          ],
          figureCaption: '',
          activity: 'From the book: Three guavas together weigh 1 kg, and they\'re all roughly the same size. About how much does each guava weigh?',
          hint: 'Think of it exactly like the roti: 1 kg is being shared equally among 3 guavas, the same way 1 roti was shared among the children. So each guava\'s share is 1 divided by 3.',
          example: {
            problem: 'From the book: A wholesale merchant packed 1 kg of rice into 4 packets of equal weight. What is the weight of each packet?',
            steps: [
              '1 kg of rice is shared equally among 4 packets — same idea as the roti shared among 4 children.',
              'Just like each child got 1/4 roti, each packet gets 1/4 kg of rice.',
            ],
          },
          listenParts: [
            {
              heading: 'Sharing a roti — 2 children vs. 4 children',
              text: 'Shabnam asks Mukta: if one roti is divided equally between two children, how much does each child get? Mukta says each child gets half a roti — we write this as 1/2. Then Shabnam asks: if the same one roti is shared equally among 4 children instead, how much does each child get now? Each child\'s share is 1/4 roti.',
              keyIdea: 'Same one roti, but shared among more children — so each child\'s piece has to be smaller. That\'s why 1/2 roti is more than 1/4 roti, even though 4 is a bigger number than 2.',
            },
            {
              heading: 'What is a "fractional unit"?',
              text: 'When one whole thing is divided into several equal parts, each part is called a fractional unit — also called a unit fraction. 1/2, 1/3, 1/4, 1/5, all the way up to 1/100, are all examples of fractional units.',
              keyIdea: 'The bottom number (denominator) tells you how many equal parts the whole was cut into. The top number (numerator) tells you how many of those parts you actually have.',
            },
            {
              heading: 'The common mistake: is 1/9 bigger than 1/5?',
              text: 'Beni asks Arvin: which fraction is greater, 1/5 or 1/9? Arvin guesses 1/9, since 9 is a bigger number than 5. Beni says that\'s a common mistake — think of these as shares instead. If one roti is shared among 5 children, each gets 1/5. If shared among 9 children, each gets 1/9.',
              keyIdea: 'Sharing with MORE people always means each person gets LESS — so 1/9 is actually smaller than 1/5, not bigger. The same idea means 1/100 is smaller than 1/50.',
            },
            {
              heading: 'Fractions have Indian names too',
              text: 'Fractions have been used and named in India since ancient times. In the Rig Veda, the fraction 3/4 is called "tri-pada" — the same idea behind "teen paav" in Hindi and "mukkaal" in Tamil, words still used today.',
              keyIdea: 'Ask your family what words they use at home for half, quarter, or three-quarters — fraction words have been part of everyday language in India for thousands of years.',
            },
          ],
        },
      },
      {
        name: 'Fractional Units as Parts of a Whole', kind: 'Concept', page: 'p.154', pdfFile: 'fegp107.pdf', pdfPage: 4,
        readText: {
          intro: 'A whole chikki, cut into 6 equal pieces two different ways — are the pieces still the same size?',
          body: [
            'By dividing a whole chikki into 6 equal parts in two different ways (different shapes), each piece is still 1/6 of the chikki — same size, just cut differently.',
            'A bigger piece made of 3 pieces of 1/4 chikki each is measured as 3/4 chikki — we count how many fractional units (1/4) make up the piece.',
            'Folding a paper strip in half gives two 1/2 pieces; folding it in half again gives four 1/4 pieces — each fold doubles how many equal pieces the whole is cut into.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1784812369/ncert/grade6/Mathematics/fegp107_p6_pageimg.png',
          figureCaption: 'The book\'s own paper-strip diagram — folding once makes 1/2, folding again makes 1/4 (NCERT, Ganita Prakash Grade 6, p.156).',
          activity: 'From the book: take a strip of paper (one unit long). Fold it in half, then in half again. What fraction is each of the 4 parts you now have?',
          hint: 'Look at the picture: the strip has already been folded once (giving two 1/2 pieces) and then again (giving four equal pieces). Count how many equal pieces you end up with after 2 folds.',
          example: {
            problem: 'From the book: if you fold the strip a third time, how many equal parts will you have, and what is each part called?',
            steps: [
              'Each fold doubles the number of equal pieces: 1 fold → 2 pieces, 2 folds → 4 pieces.',
              'So 3 folds → 8 equal pieces, and each piece is 1/8 of the whole strip.',
            ],
          },
          listenParts: [
            {
              heading: 'Same chikki, cut differently — still the same size?',
              text: 'The picture shows a whole chikki. By dividing the whole chikki into 6 equal parts in two different ways — different shapes — we get 1/6 chikki pieces. Are they the same size?',
              keyIdea: 'Yes — as long as the whole is divided into 6 EQUAL parts, each piece is 1/6, no matter what shape the cut makes.',
            },
            {
              heading: 'Measuring a bigger piece using a fractional unit',
              text: 'A chikki is broken into 2 pieces. The bigger piece has 3 pieces of 1/4 chikki in it — so we measure the bigger piece using the fractional unit 1/4. The bigger piece is 3/4 chikki.',
              keyIdea: 'To measure any piece, count how many of the small fractional unit (like 1/4) fit inside it.',
            },
            {
              heading: 'Folding a paper strip',
              text: 'Take a strip of paper, one unit long. Fold it into two equal parts, then open it up — each part is 1/2. Fold the strip again into two equal parts — you now get four equal parts, each 1/4.',
              keyIdea: 'Each time you fold the strip in half again, the number of equal pieces doubles — and each piece gets smaller.',
            },
          ],
        },
      },
      {
        name: 'Addition and Subtraction of Fractions', kind: 'Concept', page: 'p.181', pdfFile: 'fegp107.pdf', pdfPage: 20,
        readText: {
          intro: 'Four friends share 3 glasses of sugarcane juice equally. How much juice does each friend get?',
          body: [
            'Four friends ordered 3 glasses of sugarcane juice and shared it equally among themselves. Each one drank 3 ÷ 4 = 3/4 glass of sugarcane juice.',
            'The big fish weighs 1/2 kg, the small one weighs 1/4 kg. Added together, they weigh 3/4 kg.',
            'To subtract fractions like 5/8 − 3/8, subtract the numerators (top numbers) when the denominator (bottom number) is already the same: 5/8 − 3/8 = 2/8, which simplifies to 1/4.',
          ],
          figureCaption: '',
          activity: 'From the book: Jaya\'s school is 7/10 km from her home. She takes an auto for 1/2 km, then walks the rest. How much does she walk?',
          hint: 'This is a subtraction problem: total distance minus the auto distance. Before you can subtract 1/2 from 7/10, both fractions need the same denominator — try converting 1/2 into tenths first.',
          example: {
            problem: 'From the book (Brahmagupta\'s method, 628 CE): find the sum of 2/3 and 1/5.',
            steps: [
              'Find a common denominator: the denominators are 3 and 5, and their lowest common multiple is 15.',
              'Convert each fraction: 2/3 = (2×5)/(3×5) = 10/15, and 1/5 = (1×3)/(5×3) = 3/15.',
              'Now both fractions have the same fractional unit (1/15), so add the numerators: 10/15 + 3/15 = 13/15.',
            ],
          },
          listenParts: [
            {
              heading: 'Sharing 3 glasses of juice among 4 friends',
              text: 'Four friends ordered 3 glasses of sugarcane juice and shared it equally among themselves. Each one drank 3 ÷ 4 glass of sugarcane juice.',
              keyIdea: 'Sharing 3 whole glasses among 4 people is the same as the fraction 3/4 — the amount shared becomes the numerator, the number of people becomes the denominator.',
            },
            {
              heading: 'Adding two different weights',
              text: 'The big fish weighs 1/2 kg. The small one weighs 1/4 kg. Together they weigh 1/2 + 1/4 kg.',
              keyIdea: 'Before adding, we need both fractions to have the SAME denominator — 1/2 is the same as 2/4, so 2/4 + 1/4 = 3/4 kg together.',
            },
            {
              heading: 'Subtracting fractions with the same denominator',
              text: 'When two fractions already share the same denominator, like 5/8 and 3/8, subtracting is simple: 5/8 − 3/8 = 2/8.',
              keyIdea: '2/8 can be made simpler — both the top and bottom number can be divided by 2, giving 1/4. A fraction in its simplest form is easier to understand at a glance.',
            },
          ],
        },
      },
    ],
  },
  {
    title: 'Playing with Constructions',
    comingSoon: true,
    topics: [
      { name: 'Drawing Freehand Figures', kind: 'Concept', page: 'p.1', pdfFile: 'fegp108.pdf', pdfPage: 1,
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Using a Ruler and Compass', kind: 'Concept', page: 'p.8',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
    ],
  },
  {
    title: 'Symmetry',
    comingSoon: true,
    topics: [
      { name: 'Line Symmetry in Everyday Objects', kind: 'Concept', page: 'p.1', pdfFile: 'fegp109.pdf', pdfPage: 1,
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Multiple Lines of Symmetry', kind: 'Concept', page: 'p.7',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
    ],
  },
  {
    title: 'The Other Side of Zero',
    comingSoon: true,
    topics: [
      { name: 'Introducing Integers', kind: 'Concept', page: 'p.1', pdfFile: 'fegp110.pdf', pdfPage: 1,
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Ordering Integers on a Number Line', kind: 'Concept', page: 'p.8',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
      { name: 'Addition and Subtraction of Integers', kind: 'Concept', page: 'p.14',
        readText: { intro: '', body: [], figureCaption: '', activity: '' } },
    ],
  },
];
