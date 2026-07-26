// qa-gather.cjs — collect EVERYTHING a QA reviewer needs to verify one topic,
// into a single bundle the Lesson-QA subagent then checks + corrects. This is
// how we verify each lesson automatically instead of screenshotting every grade.
//
//   node scripts/qa-gather.cjs <topicId> <outBundle.json>
//
// The bundle contains, for the topic:
//   - the AI_EXPLANATION payload (the whole lesson) + PRACTICE quiz
//   - the linked NCERT book text (so QA can replicate the book's own exercises,
//     and flag if no book is linked)
//   - a live Ask-Aivorah (/ask) response for the topic (so QA can judge whether
//     the AI Coach answers correctly + grounded on this specific topic)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sb = require('../services/supabase');

const SERVER = process.env.QA_SERVER_URL || 'http://localhost:3006';
const BOOKS = path.resolve(__dirname, '..', 'data', 'ncert_books');

function subjectFolder(subject) {
  const s = String(subject || '').toLowerCase();
  if (s.includes('math')) return 'mathematics';
  if (s.includes('english')) return 'english';
  if (s.includes('hindi')) return 'hindi';
  if (s.includes('science') || s.includes('evs') || s.includes('environ')) return 'evs';
  if (s.includes('social')) return 'socialscience';
  return s.replace(/\s+/g, '');
}

(async () => {
  const topicId = process.argv[2];
  const outFile = process.argv[3] || `qa_bundle_${topicId}.json`;
  if (!topicId) { console.error('usage: qa-gather.cjs <topicId> <out.json>'); process.exit(1); }

  const { data: topic } = await sb.from('syllabus_topics').select('*').eq('id', topicId).maybeSingle();
  const { data: chapter } = topic?.chapter_id
    ? await sb.from('syllabus_chapters').select('*').eq('id', topic.chapter_id).maybeSingle()
    : { data: null };
  const { data: resources } = await sb.from('topic_resources').select('resource_type,status,static_payload').eq('topic_id', topicId);

  const ai = (resources || []).find(r => r.resource_type === 'AI_EXPLANATION')?.static_payload || null;
  const practice = (resources || []).find(r => r.resource_type === 'PRACTICE')?.static_payload || null;

  const grade = chapter?.grade || `Grade ${ai?.grade || ''}`;
  const subject = chapter?.subject || ai?.subject || '';
  const curriculum = chapter?.curriculum || 'CBSE';
  const topicName = topic?.name || '';

  // Book text (for replicating the book's own exercises + confirming a link exists).
  let bookText = null, bookLinked = false;
  const pdfFile = ai?.pdfFile;
  if (pdfFile) {
    const p = path.join(BOOKS, `grade${String(grade).replace(/[^0-9]/g, '')}`, subjectFolder(subject), pdfFile);
    if (fs.existsSync(p)) {
      bookLinked = true;
      try { const pdf = require('pdf-parse'); bookText = (await pdf(fs.readFileSync(p))).text.replace(/\s+/g, ' ').slice(0, 6000); } catch {}
    }
  }

  // Live Ask-Aivorah grounding probe for this topic.
  let askResponse = null;
  try {
    const q = `Explain ${topicName} for a ${grade} student, and give one worked example.`;
    const res = await fetch(`${SERVER}/ask`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, grade, subject, topic: topicName, curriculum }),
    });
    if (res.ok) { const d = await res.json(); askResponse = d.answer || null; }
  } catch (e) { askResponse = `(/ask call failed: ${e.message})`; }

  const bundle = {
    topicId, grade, subject, curriculum, topicName,
    bookLinked, pdfFile: pdfFile || null,
    lesson: ai,
    practiceQuiz: practice?.quiz || ai?.practiceQuiz || null,
    bookText,
    askAivorahResponse: askResponse,
  };
  fs.writeFileSync(outFile, JSON.stringify(bundle, null, 1));
  console.log(`✅ QA bundle → ${outFile}`);
  console.log(`   book linked: ${bookLinked} | quiz Qs: ${(bundle.practiceQuiz || []).length} | ask len: ${(askResponse || '').length}`);
})();
