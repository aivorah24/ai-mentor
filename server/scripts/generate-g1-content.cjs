/**
 * generate-g1-content.cjs — fills real, grounded lesson content for Grade 1
 * English and Hindi topics that currently have none.
 *
 * Grounding: extracts each topic's own PDF text with pdf-parse (both books
 * are real Unicode text, not Kruti-Dev — verified before writing this) and
 * feeds ONLY that text to the LLM as source material, so the lesson is about
 * the actual poem/story on the page rather than invented filler.
 *
 * Output shape matches the verified real row already in the DB ("My
 * Bicycle", Grade 2 English) — text/intro/vocab/keyConcepts stored under
 * AI_EXPLANATION, plus practiceQuiz + listenParts so Listen/Practice work
 * immediately with no separate generation step (both read off this payload).
 *
 *   node scripts/generate-g1-content.cjs            # dry run (prints only)
 *   node scripts/generate-g1-content.cjs --apply
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const { generateJSON } = require('../services/llm');

const APPLY = process.argv.includes('--apply');
const BOOKS = path.resolve(__dirname, '..', 'data', 'ncert_books');

const TOPICS = [
  // Grade 1 English — book aemr1, unit->pdf mapping confirmed by direct read
  { grade: 1, subject: 'English', topicName: 'Two Little Hands', chapterTitle: 'My Family and Me', unitNo: 1, pdf: 'grade1/english/aemr101.pdf', instructionalType: 'Poem' },
  { grade: 1, subject: 'English', topicName: 'Greetings', chapterTitle: 'My Family and Me', unitNo: 1, pdf: 'grade1/english/aemr102.pdf', instructionalType: 'Lesson' },
  { grade: 1, subject: 'English', topicName: 'Picture Time', chapterTitle: 'Life Around Us', unitNo: 2, pdf: 'grade1/english/aemr103.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'English', topicName: 'A Farm', chapterTitle: 'Life Around Us', unitNo: 2, pdf: 'grade1/english/aemr105.pdf', instructionalType: 'Poem' },
  { grade: 1, subject: 'English', topicName: 'Fun with Pictures', chapterTitle: 'Food', unitNo: 3, pdf: 'grade1/english/aemr106.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'English', topicName: 'The Four Seasons', chapterTitle: 'Seasons', unitNo: 4, pdf: 'grade1/english/aemr108.pdf', instructionalType: 'Poem' },
  { grade: 1, subject: 'English', topicName: 'Anandi’s Rainbow', chapterTitle: 'Seasons', unitNo: 4, pdf: 'grade1/english/aemr109.pdf', instructionalType: 'Story' },

  // Grade 1 Hindi — book ahsr1, all 19 chapters, mapped by direct read
  { grade: 1, subject: 'Hindi', topicName: 'चित्र और बातचीत', chapterTitle: 'परिवार', unitNo: 1, pdf: 'grade1/hindi/ahsr101.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Hindi', topicName: 'दादा-दादी', chapterTitle: 'परिवार', unitNo: 1, pdf: 'grade1/hindi/ahsr102.pdf', instructionalType: 'Poem' },
  { grade: 1, subject: 'Hindi', topicName: 'रीना का दिन', chapterTitle: 'परिवार', unitNo: 1, pdf: 'grade1/hindi/ahsr103.pdf', instructionalType: 'Story' },
  { grade: 1, subject: 'Hindi', topicName: 'रानी भी', chapterTitle: 'परिवार', unitNo: 1, pdf: 'grade1/hindi/ahsr104.pdf', instructionalType: 'Story' },
  { grade: 1, subject: 'Hindi', topicName: 'मुर्गा बोला कुकड़ू-कूँ', chapterTitle: 'जीव-जगत', unitNo: 2, pdf: 'grade1/hindi/ahsr105.pdf', instructionalType: 'Poem' },
  { grade: 1, subject: 'Hindi', topicName: 'तीन साथी', chapterTitle: 'जीव-जगत', unitNo: 2, pdf: 'grade1/hindi/ahsr106.pdf', instructionalType: 'Story' },
  { grade: 1, subject: 'Hindi', topicName: 'वाह, मेरे घोड़े!', chapterTitle: 'जीव-जगत', unitNo: 2, pdf: 'grade1/hindi/ahsr107.pdf', instructionalType: 'Poem' },
  { grade: 1, subject: 'Hindi', topicName: 'खतरे में साँप', chapterTitle: 'जीव-जगत', unitNo: 2, pdf: 'grade1/hindi/ahsr108.pdf', instructionalType: 'Story' },
  { grade: 1, subject: 'Hindi', topicName: 'आलू की सड़क', chapterTitle: 'हमारा खान-पान', unitNo: 3, pdf: 'grade1/hindi/ahsr109.pdf', instructionalType: 'Story' },
  { grade: 1, subject: 'Hindi', topicName: 'झूलम-झूली', chapterTitle: 'हमारा खान-पान', unitNo: 3, pdf: 'grade1/hindi/ahsr110.pdf', instructionalType: 'Poem' },
  { grade: 1, subject: 'Hindi', topicName: 'भुट्टे', chapterTitle: 'हमारा खान-पान', unitNo: 3, pdf: 'grade1/hindi/ahsr111.pdf', instructionalType: 'Story' },
  { grade: 1, subject: 'Hindi', topicName: 'फूली रोटी', chapterTitle: 'हमारा खान-पान', unitNo: 3, pdf: 'grade1/hindi/ahsr112.pdf', instructionalType: 'Story' },
  { grade: 1, subject: 'Hindi', topicName: 'मेला', chapterTitle: 'त्योहार और मेले', unitNo: 4, pdf: 'grade1/hindi/ahsr113.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Hindi', topicName: 'बरखा और मेघा', chapterTitle: 'त्योहार और मेले', unitNo: 4, pdf: 'grade1/hindi/ahsr114.pdf', instructionalType: 'Story' },
  { grade: 1, subject: 'Hindi', topicName: 'होली', chapterTitle: 'त्योहार और मेले', unitNo: 4, pdf: 'grade1/hindi/ahsr115.pdf', instructionalType: 'Poem' },
  { grade: 1, subject: 'Hindi', topicName: 'जन्मदिवस पर पेड़ लगाओ', chapterTitle: 'त्योहार और मेले', unitNo: 4, pdf: 'grade1/hindi/ahsr116.pdf', instructionalType: 'Poem' },
  { grade: 1, subject: 'Hindi', topicName: 'हवा', chapterTitle: 'हरी-भरी दुनिया', unitNo: 5, pdf: 'grade1/hindi/ahsr117.pdf', instructionalType: 'Poem' },
  { grade: 1, subject: 'Hindi', topicName: 'कितनी प्यारी है ये दुनिया', chapterTitle: 'हरी-भरी दुनिया', unitNo: 5, pdf: 'grade1/hindi/ahsr118.pdf', instructionalType: 'Poem' },
  { grade: 1, subject: 'Hindi', topicName: 'चाँद का बच्चा', chapterTitle: 'हरी-भरी दुनिया', unitNo: 5, pdf: 'grade1/hindi/ahsr119.pdf', instructionalType: 'Poem' },

  // Grade 1 Mathematics — book aejm1, one chapter per unit, 1:1 with unit_no
  { grade: 1, subject: 'Mathematics', topicName: 'Finding the Furry Cat!', chapterTitle: 'Finding the Furry Cat!', unitNo: 1, pdf: 'grade1/mathematics/aejm101.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Mathematics', topicName: 'What is Long? What is Round?', chapterTitle: 'What is Long? What is Round?', unitNo: 2, pdf: 'grade1/mathematics/aejm102.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Mathematics', topicName: 'Mango Treat', chapterTitle: 'Mango Treat', unitNo: 3, pdf: 'grade1/mathematics/aejm103.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Mathematics', topicName: 'Dotty Bug and her Designs', chapterTitle: 'Dotty Bug and her Designs', unitNo: 4, pdf: 'grade1/mathematics/aejm104.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Mathematics', topicName: 'How Many?', chapterTitle: 'How Many?', unitNo: 5, pdf: 'grade1/mathematics/aejm105.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Mathematics', topicName: 'Vegetable Farm', chapterTitle: 'Vegetable Farm', unitNo: 6, pdf: 'grade1/mathematics/aejm106.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Mathematics', topicName: 'Lina’s Family Get Together', chapterTitle: 'Lina’s Family Get Together', unitNo: 7, pdf: 'grade1/mathematics/aejm107.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Mathematics', topicName: 'Fun with Numbers', chapterTitle: 'Fun with Numbers', unitNo: 8, pdf: 'grade1/mathematics/aejm108.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Mathematics', topicName: 'Utsav', chapterTitle: 'Utsav', unitNo: 9, pdf: 'grade1/mathematics/aejm109.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Mathematics', topicName: 'How do I Spend my Day?', chapterTitle: 'How do I Spend my Day?', unitNo: 10, pdf: 'grade1/mathematics/aejm110.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Mathematics', topicName: 'A Visit to an Amusement Park', chapterTitle: 'A Visit to an Amusement Park', unitNo: 11, pdf: 'grade1/mathematics/aejm111.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Mathematics', topicName: 'How Much Can We Spend ?', chapterTitle: 'How Much Can We Spend ?', unitNo: 12, pdf: 'grade1/mathematics/aejm112.pdf', instructionalType: 'Activity' },
  { grade: 1, subject: 'Mathematics', topicName: 'So Many Toys', chapterTitle: 'So Many Toys', unitNo: 13, pdf: 'grade1/mathematics/aejm113.pdf', instructionalType: 'Activity' },
];

function cleanText(raw) {
  // Strip footer/page-furniture lines the PDF text layer carries (reprint
  // stamps, indd export markers, bare page numbers) — keeps grounding text
  // free of noise the model might otherwise quote back.
  return String(raw || '')
    .split('\n')
    .filter(l => !/reprint\s*20\d\d/i.test(l) && !/\.indd\s/i.test(l) && !/^\d{1,3}$/.test(l.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function buildLesson(t, sourceText) {
  const isHindi = t.subject === 'Hindi';
  const language = isHindi ? 'Hindi (Devanagari script)' : 'English';
  const system = `You are an expert Grade 1 (age 6) ${t.subject} teacher writing lesson content for the Aivorah learning app. Ground EVERY sentence you write in the source text given — never invent plot, facts or vocabulary not present in it. Very simple words, short sentences (max 8 words), one idea at a time. Write all lesson fields in ${language}. Output strict JSON only, matching the requested schema exactly.`;
  const userPrompt = `Topic: "${t.topicName}" (a ${t.instructionalType.toLowerCase()} from the NCERT Grade 1 ${t.subject} textbook, chapter "${t.chapterTitle}").

Source material — the ONLY facts/words you may use:
"""
${sourceText.slice(0, 3000)}
"""

Return JSON with exactly these fields:
{
  "intro": "1-2 sentence warm intro to this ${t.instructionalType.toLowerCase()} for a 6-year-old",
  "body": ["2-4 short paragraphs explaining/retelling the piece in very simple words"],
  "vocab": [{"word":"...","definition":"simple 6-year-old definition"}] (3-6 words FROM the source text),
  "listenParts": [{"heading":"Stanza/Part 1","text":"..."}] (the ORIGINAL text from the source, broken into 2-4 natural parts for read-aloud, verbatim — do not simplify these),
  "keyLearnings": ["2-3 short learning goals"],
  "keyTakeaways": ["2-4 short one-line facts a child should remember, grounded in the text"],
  "activity": "one simple 'try this yourself' prompt related to the topic",
  "thinkAndReflect": ["2 short reflection questions"],
  "practiceQuiz": [
    {"type":"fill_blank","question":"... ___ ...","correct":"word","hint":"...","explanation":"..."},
    {"type":"fill_blank","question":"... ___ ...","correct":"word","hint":"...","explanation":"..."},
    {"type":"mcq","question":"True or False: ...","options":["True","False"],"correct":0,"hint":"...","explanation":"..."},
    {"type":"mcq","question":"True or False: ...","options":["True","False"],"correct":1,"hint":"...","explanation":"..."},
    {"type":"mcq","question":"True or False: ...","options":["True","False"],"correct":0,"hint":"...","explanation":"..."}
  ] (5 questions, ALL answers must be verifiable from the source text)
}`;

  return generateJSON({ systemPrompt: system, userPrompt, maxTokens: 2000 });
}

// A Devanagari word can never START with a dependent vowel sign (matra) —
// that character only attaches after a consonant. Corrupted output from the
// NVIDIA fallback model has been observed dropping the leading consonant
// ("रमा" -> "िमा"), which produces exactly this invalid pattern. Cheap,
// reliable signature for "regenerate this" without needing a full spell-check.
const MATRA_AT_WORD_START = /(^|[\s।,.!?()"'])[ा-्]/;
function findCorruption(obj, path = '') {
  if (typeof obj === 'string') {
    return MATRA_AT_WORD_START.test(obj) ? [`${path}: "${obj.slice(0, 60)}"`] : [];
  }
  if (Array.isArray(obj)) return obj.flatMap((v, i) => findCorruption(v, `${path}[${i}]`));
  if (obj && typeof obj === 'object') return Object.entries(obj).flatMap(([k, v]) => findCorruption(v, path ? `${path}.${k}` : k));
  return [];
}

async function buildLessonVerified(t, sourceText) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const lesson = await buildLesson(t, sourceText);
    const bad = findCorruption(lesson);
    if (!bad.length) return lesson;
    console.warn(`  corruption detected (attempt ${attempt}/3): ${bad[0]}`);
  }
  throw new Error('corrupted output persisted after 3 attempts');
}

(async () => {
  const sb = require('../services/supabase');
  let done = 0, skipped = 0, failed = 0;

  for (const t of TOPICS) {
    const { data: chs } = await sb.from('syllabus_chapters').select('id').eq('grade', `Grade ${t.grade}`).eq('subject', t.subject).eq('unit_no', t.unitNo).maybeSingle();
    if (!chs) { console.log(`SKIP (no chapter row) ${t.subject} ${t.topicName}`); skipped++; continue; }
    const { data: tp } = await sb.from('syllabus_topics').select('id').eq('chapter_id', chs.id).eq('name', t.topicName).maybeSingle();
    if (!tp) { console.log(`SKIP (no topic row) ${t.subject} ${t.topicName}`); skipped++; continue; }

    const { data: existing } = await sb.from('topic_resources').select('static_payload,source_tier').eq('topic_id', tp.id).eq('resource_type', 'AI_EXPLANATION').maybeSingle();
    if (existing && !existing.static_payload?.isSample && existing.source_tier !== 'PLACEHOLDER') {
      console.log(`SKIP (already real) ${t.subject} ${t.topicName}`); skipped++; continue;
    }

    const pdfPath = path.join(BOOKS, t.pdf);
    if (!fs.existsSync(pdfPath)) { console.log(`SKIP (no pdf) ${t.subject} ${t.topicName} -> ${t.pdf}`); skipped++; continue; }

    try {
      const raw = await pdf(fs.readFileSync(pdfPath));
      const sourceText = cleanText(raw.text);
      if (sourceText.length < 20) { console.log(`SKIP (empty extract) ${t.subject} ${t.topicName}`); skipped++; continue; }

      const lesson = await buildLessonVerified(t, sourceText);

      const payload = {
        grade: t.grade,
        subject: t.subject,
        chapterTitle: t.chapterTitle,
        instructionalType: t.instructionalType,
        pdfFile: path.basename(t.pdf),
        grounded: true,
        attribution: 'AI Generated — Aivorah',
        intro: lesson.intro,
        body: lesson.body,
        vocab: lesson.vocab,
        listenParts: lesson.listenParts,
        keyLearnings: lesson.keyLearnings,
        whatYoullLearn: lesson.keyLearnings,
        keyTakeaways: lesson.keyTakeaways,
        activity: lesson.activity,
        thinkAndReflect: lesson.thinkAndReflect,
        practiceQuiz: lesson.practiceQuiz,
        originalLesson: sourceText.split('\n').filter(Boolean).slice(0, 30),
      };

      console.log(`OK  ${t.subject} ${t.topicName}  (intro: ${(lesson.intro||'').slice(0,60)}...)`);
      if (APPLY) {
        const { error } = await sb.from('topic_resources').upsert({
          topic_id: tp.id, resource_type: 'AI_EXPLANATION', status: 'READY',
          source_tier: 'ORIGINAL_AI', static_payload: payload,
        }, { onConflict: 'topic_id,resource_type' });
        if (error) { console.error(`  WRITE FAILED: ${error.message}`); failed++; continue; }
      }
      done++;
    } catch (e) {
      console.error(`FAILED ${t.subject} ${t.topicName}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nTOTAL: ${TOPICS.length}  done: ${done}  skipped: ${skipped}  failed: ${failed}${APPLY ? '' : '\n[dry run — pass --apply to write]'}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
