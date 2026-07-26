// Push a generated lesson payload into a topic's AI_EXPLANATION resource so the
// "Learn with Aivorah" pane picks it up on the next refresh.
//
// SAFE BY DESIGN: merges only the fields present in the input JSON into the
// existing static_payload — it never overwrites the whole object, so rich
// fields the generator didn't emit (quiz, vocab, layout, audioNarrationScript,
// listenParts, keyTakeaways, ...) are preserved.
//
//   node scripts/push-lesson-to-topic.cjs <topicId> <payload.json>
//
// The "What you'll learn" pane reads `keyLearnings` (LessonScreen.tsx), so when
// the input carries keyLearnings we also mirror it into `whatYoullLearn` to keep
// the two in sync (they are identical in existing rows).
require('dotenv').config();
const fs = require('fs');
const sb = require('../services/supabase');

const [, , topicId, jsonPath] = process.argv;
if (!topicId || !jsonPath) {
  console.error('usage: node scripts/push-lesson-to-topic.cjs <topicId> <payload.json>');
  process.exit(1);
}

// Only these keys are allowed to flow from a generated payload into the resource.
// Anything else in the file is ignored, so a stray field can't clobber structure.
const MERGE_KEYS = ['intro', 'keyLearnings', 'body', 'activity'];

(async () => {
  const incoming = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const { data: row, error: readErr } = await sb
    .from('topic_resources')
    .select('id, static_payload')
    .eq('topic_id', topicId)
    .eq('resource_type', 'AI_EXPLANATION')
    .maybeSingle();
  if (readErr) { console.error('read failed:', readErr.message); process.exit(1); }
  if (!row) { console.error(`No AI_EXPLANATION resource for topic ${topicId}.`); process.exit(1); }

  const existing = row.static_payload || {};
  const merged = { ...existing };
  const touched = [];
  for (const k of MERGE_KEYS) {
    if (incoming[k] !== undefined) { merged[k] = incoming[k]; touched.push(k); }
  }
  // Keep the "What you'll learn" pane's field in sync with keyLearnings.
  if (incoming.keyLearnings !== undefined) { merged.whatYoullLearn = incoming.keyLearnings; touched.push('whatYoullLearn'); }

  if (touched.length === 0) { console.log('Nothing to update — input had none of:', MERGE_KEYS.join(', ')); return; }

  const preservedCount = Object.keys(existing).length - MERGE_KEYS.filter(k => k in existing).length;
  const { error: updErr } = await sb
    .from('topic_resources')
    .update({ static_payload: merged, status: 'READY', updated_at: new Date().toISOString() })
    .eq('id', row.id);
  if (updErr) { console.error('update failed:', updErr.message); process.exit(1); }

  console.log(`✅ Updated topic ${topicId}`);
  console.log('   fields written:', touched.join(', '));
  console.log(`   preserved ${preservedCount} other payload fields (quiz, vocab, layout, audio, ...)`);
  console.log('\n   new keyLearnings:');
  (merged.keyLearnings || []).forEach(k => console.log('     •', k));
})();
