require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
function clean(text, title) {
  let out = String(text)
    .replace(/\d{1,2}-\d{1,2}-\d{2,4}\s*\d{1,2}[:.]\d{2}(?:[:.]\d{2})?/g, ' ')
    .replace(/\bReprint\s*20\d{2}-\d{2}\b/gi, ' ')
    .replace(/Chapter\s*\d+\.indd\s*\d+/gi, ' ')
    .replace(/\bMridang\b/g, ' ')
    .replace(/\bUnit\s*\d+\b[^.]*?\bChapter\s*\d+\b[^.]*?(?=\bLet us\b|\bSight words\b|[A-Z][a-z])/gi, ' ')
    .replace(/\bLet us (sing|read|speak|do|write|match|play|learn|listen)\b/gi, ' ')
    .replace(/\b\d*\s*Sight words\b[^.]*?(?=[A-Z][a-z])/gi, ' ')
    .replace(/\bNew words\b[^.]*/gi, ' ')
    .replace(/\bNote to the teacher\b[^]*/gi, ' ')
    .replace(/\b[A-D]\.\s*(Repeat after the teacher|Talk in pairs|Read|Match|Circle|Look and say|Draw)\b[^]*/gi, ' ')
    .replace(/\b(Teacher|Children|Nitin|Neha)\s*:[^]*/gi, ' ')
    .replace(/\bNow circle\b[^.]*\.?/gi, ' ')
    .replace(/\bAsk your partner\b[^.]*\.?/gi, ' ')
    .replace(/[•·]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // Remove the chapter-title echo that PDF headers splice mid-text (keep a
  // title only if it legitimately opens the passage), plus a common "one to"
  // sight-word residue.
  if (title) {
    const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?!^)\\b${esc}\\b\\s*(one to)?`, 'gi'), ' ');
  }
  return out.replace(/\bone to\b(?=\s+[A-Z])/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
}
(async () => {
  const subject = process.argv[2] || 'English';
  const { data: ch } = await sb.from('syllabus_chapters').select('id').match({ grade: 'Grade 1', subject, curriculum: 'CBSE' });
  const { data: tp } = await sb.from('syllabus_topics').select('id,name').in('chapter_id', (ch || []).map((c) => c.id));
  let changed = 0;
  for (const t of tp || []) {
    const { data: rr } = await sb.from('topic_resources').select('id,static_payload').eq('topic_id', t.id).eq('resource_type', 'AI_EXPLANATION').maybeSingle();
    if (!rr || !rr.static_payload) continue;
    const p = rr.static_payload;
    if (Array.isArray(p.listenParts)) p.listenParts = p.listenParts.map((x) => ({ ...x, text: clean(x.text, t.name) })).filter((x) => x.text.length > 0);
    if (p.body) p.body = clean(p.body, t.name);
    if (p.intro) p.intro = clean(p.intro, t.name);
    await sb.from('topic_resources').update({ static_payload: p }).eq('id', rr.id);
    changed++;
    if (/Two Little Hands/i.test(t.name)) console.log('=== Two Little Hands Part 1 ===\n' + (p.listenParts[0]?.text || '').slice(0, 400) + '\n');
  }
  console.log(`Re-cleaned ${subject} topics:`, changed);
})().catch((e) => console.log('ERR', e.message));
