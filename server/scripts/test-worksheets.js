// Batch-test real worksheets through the live /quiz/generate endpoint.
// Summarizes detected question types per worksheet + renders HTML for review.
const fs = require('fs');
const path = require('path');
const quizRoute = require('../routes/quiz');

const DIR = 'C:/Users/Asus/Desktop/Aivorah Documents/Assignment Picture';
const SERVER = 'http://localhost:3006';
const OUT = path.join(__dirname, '../data/ws-tests');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// Diverse subset (different layouts/subjects). PDFs only (endpoint is PDF/image).
const SAMPLES = [
  ['MHLE-32 (Area/Perimeter ref)', 'Toddle-8d6af58a-a488-46a7-93fb-f0a5ec0611cc-PYP4 -MHLE-32.pdf'],
  ['MHLE-29 (Revised PYP4)',       'Toddle-18d1b2d2-239c-414a-8d82-142053d025d3-Revised PYP4 -MHLE-29.pdf'],
  ['MHLE-31 (PYP4)',               'Toddle-37228a95-e9c6-4551-9292-5a910e1e053f-PYP4 -MHLE-31.pdf'],
  ['MHLE-12 (PYP4)',               'Toddle-1da50398-6c5e-4957-a81b-0f042c95930f-PYP4 MHLE-12.pdf'],
  ['Supply & Demand (graphs)',     'Toddle-ff3b8e1c-46f2-45f3-aa0f-25ba65150446-raz_lv29_supplyanddemand_clr 4.pdf'],
  ["Charlotte's Web Choiceboard",  "Toddle-c0b2c531-b382-4272-90ac-77df87287b76-Charlotte's Web - Choiceboard.pdf"],
  ['PYP2 MHLE-34',                 'Toddle-1f4fc44c-becf-489c-8afb-5501efc8ed7e-PYP 2 - MHLE 34.pdf'],
];

async function run() {
  const rows = [];
  for (const [label, file] of SAMPLES) {
    const full = path.join(DIR, file);
    if (!fs.existsSync(full)) { console.log(`SKIP (missing): ${label}`); continue; }
    const buf = fs.readFileSync(full);
    if (buf.length > 4 * 1024 * 1024) { console.log(`SKIP (>4MB): ${label}`); continue; }

    process.stdout.write(`\n>> ${label} ... `);
    const t0 = Date.now();
    try {
      const form = new FormData();
      form.set('pdf', new Blob([buf], { type: 'application/pdf' }), file);
      form.set('grade', 'PYP 4'); form.set('subject', ''); form.set('school', '');
      const res = await fetch(`${SERVER}/quiz/generate`, { method: 'POST', body: form });
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      if (!res.ok) { console.log(`HTTP ${res.status}`); rows.push({ label, err: 'HTTP ' + res.status }); continue; }
      const data = await res.json();
      const quiz = data.quiz;

      // Type distribution
      const types = {};
      let qTotal = 0, imgs = 0;
      for (const t of (quiz.tasks || [])) {
        for (const q of (t.questions || [])) {
          types[q.type || 'text'] = (types[q.type || 'text'] || 0) + 1;
          qTotal++;
          if (q.imageUrl || q.hasImage) imgs++;
        }
      }
      const html = quizRoute.renderQuizHTML(JSON.parse(JSON.stringify(quiz)));
      const outFile = path.join(OUT, label.replace(/[^\w]+/g, '_') + '.html');
      fs.writeFileSync(outFile, html);

      const typeStr = Object.entries(types).map(([k, v]) => `${k}:${v}`).join(' ');
      console.log(`${secs}s | engine=${quiz.engine} | tasks=${(quiz.tasks || []).length} q=${qTotal} | ${typeStr} | imgs=${imgs} | grade=${data.validation?.grade || '?'}`);
      rows.push({ label, engine: quiz.engine, tasks: (quiz.tasks || []).length, q: qTotal, types: typeStr, imgs, quality: data.validation?.grade, out: outFile });
    } catch (e) {
      console.log('ERROR:', e.message);
      rows.push({ label, err: e.message });
    }
  }

  console.log('\n\n================ SUMMARY ================');
  for (const r of rows) {
    if (r.err) { console.log(`✗ ${r.label} — ${r.err}`); continue; }
    console.log(`✓ ${r.label}\n    engine=${r.engine} tasks=${r.tasks} q=${r.q} quality=${r.quality}\n    types: ${r.types}\n    html: ${r.out}`);
  }
  console.log(`\nHTML output dir: ${OUT}`);
}
run().catch(e => { console.error(e); process.exit(1); });
