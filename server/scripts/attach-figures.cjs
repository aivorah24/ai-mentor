/**
 * attach-figures.cjs — attach REAL NCERT book figures to published lessons so the
 * Listen/Learn illustration pane shows the book's own picture instead of the
 * "Illustration coming soon" placeholder.
 *
 * Source of images: data/ncert_figures_index.json, built by
 * extract-figures-to-cloudinary.js. Those are EMBEDDED figures cropped out of the
 * PDF (diagrams/photos), NOT full-page scans — banners and decorative art are
 * already filtered by the extractor.
 *
 * Relevance: we re-run the same grounded retrieval the generator used, read the
 * book chapter code off the winning chunks (payload.topic, e.g. "fepr105"), and
 * pick figures from THAT chapter only. A lesson never borrows another chapter's
 * picture.
 *
 *   node scripts/attach-figures.cjs --grade 6                 # one grade
 *   node scripts/attach-figures.cjs --grade 6 --subject Science
 *   node scripts/attach-figures.cjs --grade 6 --dry           # report only
 */
require('dotenv').config();
const path = require('path');
const sb = require('../services/supabase');
const { embed } = require('../services/embeddings');
const { searchGrounding, searchContent } = require('../services/qdrant');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry');
const MAX_FIGS = 3;       // the pane pages through one figure per Listen step
const MIN_SCORE = +arg('--min-score', 0.42); // below this the caption isn't really about the topic

// Vision captions were written as prose ("This image illustrates a banana
// plantation…") and were truncated to 80 chars in the payload's topic field.
// Turn one into a short caption a child can read under the picture.
function cleanCaption(raw) {
  let s = String(raw || '').replace(/\*\*/g, '').trim();
  s = s.replace(/^(this|the)\s+(image|picture|photo|figure|comic strip|diagram)\s+(appears to\s+)?(is|shows|depicts|illustrates|represents)\s*/i, '');
  s = s.replace(/\s+/g, ' ');
  // Captions are stored truncated at 80 chars, so they usually end mid-word
  // ("…enjoying ice cream cones f"). Drop that fragment instead of showing it.
  const truncated = String(raw || '').trim().length >= 78 && !/[.!?]$/.test(s);
  if (truncated) s = s.replace(/\s+\S*$/, '') + '…';
  if (s.length > 140) s = s.slice(0, 137).replace(/\s+\S*$/, '') + '…';
  if (!s) return 'A picture from your NCERT book.';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── figure index, bucketed by book chapter code ──────────────────────────────
const rawIndex = require(path.resolve(__dirname, '..', 'data', 'ncert_figures_index.json'));
const figList = Array.isArray(rawIndex) ? rawIndex : Object.values(rawIndex).flat();
const byCode = new Map();
for (const f of figList) {
  if (!f || !f.url || !f.code) continue;
  // Skip anything too small or too wide/flat to be a real teaching figure — a
  // sliver is almost always a rule line or a page-header remnant.
  if ((f.w || 0) < 120 || (f.h || 0) < 100) continue;
  if ((f.w || 1) / (f.h || 1) > 6) continue;
  if (!byCode.has(f.code)) byCode.set(f.code, []);
  byCode.get(f.code).push(f);
}
for (const arr of byCode.values()) arr.sort((a, b) => (a.page || 0) - (b.page || 0));

(async () => {
  const grade = arg('--grade');
  const subjArg = arg('--subject');
  if (!grade) { console.error('need --grade N'); process.exit(1); }

  const { data: chs } = await sb.from('syllabus_chapters').select('id,subject,title').eq('grade', `Grade ${grade}`);
  let seen = 0, attached = 0, noFig = 0, already = 0;

  for (const ch of chs || []) {
    if (subjArg && ch.subject !== subjArg) continue;
    const { data: tps } = await sb.from('syllabus_topics').select('id,name').eq('chapter_id', ch.id);
    for (const tp of tps || []) {
      const { data: res } = await sb.from('topic_resources')
        .select('id,resource_type,static_payload').eq('topic_id', tp.id).eq('status', 'READY');
      const row = (res || []).find(r => r.resource_type === 'AI_EXPLANATION');
      if (!row || !row.static_payload) continue;
      seen++;
      const L = row.static_payload;

      const existing = (Array.isArray(L.illustrationPrompts) ? L.illustrationPrompts : [])
        .filter(p => p && (p.image || p.image_ref || p.url));
      if (existing.length || L.figureUrl) { already++; continue; }

      // ── Pick pictures by MEANING, not just by chapter ──────────────────────
      // The book's images were ingested as their own chunks, each carrying a
      // Vision-written caption. Searching those captions for the lesson's topic
      // gives a picture about what the lesson actually teaches; a chapter-code
      // match alone would happily hand a poem lesson a picture of a bar chart.
      const query = `${tp.name} ${ch.title} ${ch.subject} grade ${grade}`;
      let prompts = [];
      try {
        const vector = await embed(query);
        const hits = await searchContent({
          vector, curriculum: 'NCERT', grade: +grade, subject: ch.subject,
          contentType: 'image', limit: 8,
        });
        prompts = (hits || [])
          .filter(h => h.score >= MIN_SCORE && h.payload && h.payload.image_url)
          .slice(0, MAX_FIGS)
          .map(h => ({
            image: h.payload.image_url,
            // The Vision caption IS the description of the picture — use it so
            // the caption and the screen-reader label describe the real image.
            altText: cleanCaption(h.payload.topic || h.payload.content),
            source: h.payload.source_reference || '',
            score: +h.score.toFixed(3),
          }));
      } catch (e) { console.log(`  retrieval failed for ${tp.name}: ${e.message}`); }

      // Fallback: no captioned image cleared the bar — use a figure cropped from
      // the chapter this lesson is grounded in, if the extractor found one.
      if (!prompts.length) {
        let codes = [];
        try {
          const vector = await embed(query);
          const { chunks } = await searchGrounding({ vector, curriculum: 'NCERT', grade: +grade, subject: ch.subject, limit: 6 });
          codes = [...new Set((chunks || []).map(c => c?.payload?.topic).filter(c => /^[a-z]{4,6}\d{3}$/i.test(c)))];
        } catch {}
        const figs = [];
        for (const code of codes) for (const f of byCode.get(code) || []) if (figs.length < MAX_FIGS) figs.push(f);
        prompts = figs.map((f, i) => ({
          image: f.url,
          altText: `Picture ${i + 1} from your NCERT book — ${ch.title} (page ${f.page})`,
          source: `${f.code} p${f.page}`,
        }));
      }
      if (!prompts.length) { noFig++; continue; }
      const figs = prompts;

      if (DRY) {
        console.log(`  [dry] ${ch.subject}/${tp.name}`);
        figs.forEach(f => console.log(`         ↳ ${f.score != null ? `score ${f.score} ` : ''}"${f.altText}"`));
        attached++; continue;
      }
      const { error } = await sb.from('topic_resources')
        .update({ static_payload: { ...L, illustrationPrompts: prompts } }).eq('id', row.id);
      if (error) { console.log(`  FAILED ${tp.name}: ${error.message}`); continue; }
      attached++;
      console.log(`  ✓ ${ch.subject}/${tp.name} ← ${figs.length} figs`);
    }
  }
  console.log(`\n=== G${grade}: ${seen} lessons · ${attached} attached · ${already} already had art · ${noFig} no figure in their chapter ===`);
})();
