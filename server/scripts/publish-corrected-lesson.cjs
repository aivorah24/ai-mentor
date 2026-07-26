// publish-corrected-lesson.cjs — publish a corrected lesson JSON as a live,
// navigable topic. Deterministic (no AI): maps the corrected lesson into the
// flat topic_resources payload the UI renders, creating the chapter + topic if
// they don't already exist. Idempotent on (grade, subject, curriculum, topic).
//
//   node scripts/publish-corrected-lesson.cjs <corrected.json> \
//        --grade "Grade 2" --subject Mathematics --curriculum CBSE \
//        --chapter "Subtraction with Borrowing" --topic "Subtraction with Borrowing" [--unit 1]
//
// This is the "push" stage of the batch loop:
//   free-generate  →  subagent-correct  →  publish-corrected-lesson (this)
require('dotenv').config();
const fs = require('fs');
const sb = require('../services/supabase');

function arg(flag, def) { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : def; }

(async () => {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) { console.error('usage: publish-corrected-lesson.cjs <corrected.json> --grade .. --subject .. --curriculum .. --chapter .. --topic ..'); process.exit(1); }
  const L = JSON.parse(fs.readFileSync(file, 'utf8'));

  const grade = arg('--grade', 'Grade 2');
  const subject = arg('--subject', 'Mathematics');
  const curriculum = arg('--curriculum', 'CBSE');
  const chapterTitle = arg('--chapter', L.topic || 'Untitled Chapter');
  const topicName = arg('--topic', L.topic || chapterTitle);
  const unit = parseInt(arg('--unit', '1'), 10) || 1;

  const payload = {
    instructionalType: L.instructionalType || 'Concept',
    grade: parseInt(String(grade).replace(/[^0-9]/g, ''), 10) || undefined,
    subject,
    intro: L.intro,
    keyLearnings: L.keyLearnings || [],
    whatYoullLearn: L.keyLearnings || [],
    originalLesson: L.originalLesson || undefined,
    body: L.body || [],
    workedExamples: L.workedExamples || undefined,
    vocab: L.vocab || [],
    thinkAndReflect: L.thinkAndReflect || [],
    keyTakeaways: L.keyTakeaways || [],
    activity: (L.thinkAndReflect || [])[0] || '',
    illustrationPrompts: L.illustrationPrompts || undefined,
    listenParts: L.listenParts || undefined,
    practiceQuiz: L.quiz || undefined,
  };

  // Reuse an existing chapter/topic when present (idempotent re-publish).
  let { data: ch } = await sb.from('syllabus_chapters')
    .select('id').eq('grade', grade).eq('subject', subject).eq('curriculum', curriculum).eq('title', chapterTitle).maybeSingle();
  if (!ch) {
    const r = await sb.from('syllabus_chapters').insert({ grade, subject, curriculum, unit_no: unit, title: chapterTitle }).select('id').single();
    if (r.error) { console.error('chapter:', r.error.message); process.exit(1); }
    ch = r.data;
  }

  let { data: tp } = await sb.from('syllabus_topics').select('id').eq('chapter_id', ch.id).eq('name', topicName).maybeSingle();
  if (!tp) {
    const r = await sb.from('syllabus_topics').insert({ chapter_id: ch.id, topic_order: 1, name: topicName, kind: 'Chapter', intro: L.intro, content_origin: 'ai_generated' }).select('id').single();
    if (r.error) { console.error('topic:', r.error.message); process.exit(1); }
    tp = r.data;
  }

  // Upsert the AI_EXPLANATION + PRACTICE resources (replace if they exist).
  await sb.from('topic_resources').delete().eq('topic_id', tp.id).in('resource_type', ['AI_EXPLANATION', 'PRACTICE']);
  const rows = [
    { topic_id: tp.id, resource_type: 'AI_EXPLANATION', status: 'READY', source_tier: 'ORIGINAL_AI', source: 'Aivorah pipeline (free-gen + subagent-corrected)', static_payload: payload },
  ];
  if (payload.practiceQuiz) rows.push({ topic_id: tp.id, resource_type: 'PRACTICE', status: 'READY', source_tier: 'ORIGINAL_AI', source: 'Grounded quiz', static_payload: { quiz: payload.practiceQuiz } });
  const { error } = await sb.from('topic_resources').insert(rows);
  if (error) { console.error('resources:', error.message); process.exit(1); }

  console.log(`✅ Published: ${grade} · ${subject} · ${topicName}`);
  console.log(`   TOPIC_ID: ${tp.id}`);
})();
