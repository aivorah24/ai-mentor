// Triggers the REAL local pipeline on the Desktop/Demo files for the 3 scenarios
// and prints a comparison of where the system struggles.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API = 'http://localhost:3006';
const DIR = 'C:/Users/Asus/Desktop/Demo';
const IMGS = ['Screenshot 2026-07-10 111925.png','Screenshot 2026-07-10 111936.png','Screenshot 2026-07-10 111948.png','Screenshot 2026-07-10 111956.png'];
const PDF = 'Toddle-1da50398-6c5e-4957-a81b-0f042c95930f-PYP4 MHLE-12.pdf';
const DOCX = 'Toddle-79c9cf94-b904-4f95-b7f9-e28bfa64ce3b-Vocabulary Building 28 - PYP 4 (1).docx';
const PDF2 = 'Toddle-0005707c-9d35-4c61-aea0-3a43d671b0f1-PYP 2 - MHLE 22 1.pdf';

function summarize(quiz) {
  if (!quiz) return { error: true };
  const tasks = quiz.tasks || [];
  const emptyTasks = tasks.filter(t => !(t.questions?.length) && !t.chart && !t.tables?.length && !t.table?.rows?.length && !t.pyramids?.length && !t.diagramFillBlanks?.length && !t._matchTask && !t.sharedImage && !t.passage);
  let imgs = 0, base64 = 0, relPath = 0;
  for (const t of tasks) {
    for (const u of [t.pageImageUrl, t.diagramFillImageUrl, ...(t.questions||[]).map(q=>q.imageUrl)].filter(Boolean)) {
      imgs++; if (String(u).startsWith('data:')) base64++; else relPath++;
    }
  }
  return {
    engine: quiz.engine, tasks: tasks.length,
    questions: tasks.reduce((s,t)=>s+(t.questions?.length||0),0),
    emptyTasks: emptyTasks.length, emptyTitles: emptyTasks.map(t=>(t.title||'').slice(0,40)),
    images: imgs, base64Images: base64, relPathImages: relPath,
  };
}

async function postFile(endpoint, field, filename, buffer, mime, extra={}) {
  const form = new FormData();
  form.set(field, new Blob([buffer], { type: mime }), filename);
  for (const [k,v] of Object.entries({ grade:'PYP 4', subject:'Mathematics', school:'TSRA', ...extra })) form.set(k, v);
  const t0 = Date.now();
  const res = await fetch(`${API}${endpoint}`, { method:'POST', body: form });
  const secs = ((Date.now()-t0)/1000).toFixed(0);
  let body; try { body = await res.json(); } catch { body = { error: 'non-json' }; }
  return { status: res.status, secs, quiz: body.quiz, err: body.error };
}

(async () => {
  const results = {};

  // Scenario 1 — 4 images stitched into ONE tall image → /quiz/generate-image
  try {
    const bufs = IMGS.map(f => fs.readFileSync(path.join(DIR, f)));
    const metas = await Promise.all(bufs.map(b => sharp(b).metadata()));
    const width = Math.max(...metas.map(m => m.width));
    const resized = await Promise.all(bufs.map(b => sharp(b).resize({ width }).png().toBuffer()));
    const heights = await Promise.all(resized.map(async b => (await sharp(b).metadata()).height));
    const combined = await sharp({ create:{ width, height: heights.reduce((a,b)=>a+b,0), channels:4, background:'#fff' }})
      .composite(resized.map((input,i)=>({ input, top: heights.slice(0,i).reduce((a,b)=>a+b,0), left:0 }))).png().toBuffer();
    console.log('[1] 4 images stitched → generate-image...');
    results.s1_4images = await postFile('/quiz/generate-image', 'image', 'worksheet.png', combined, 'image/png');
  } catch (e) { results.s1_4images = { error: e.message }; }

  // Scenario 2 — single PDF → /quiz/generate
  console.log('[2] single PDF → generate...');
  results.s2_pdf = await postFile('/quiz/generate', 'pdf', PDF, fs.readFileSync(path.join(DIR, PDF)), 'application/pdf');

  // Scenario 3 — bulk: PDF + DOCX (each via /quiz/generate; docx auto-converts)
  console.log('[3a] bulk PDF → generate...');
  results.s3_pdf = await postFile('/quiz/generate', 'pdf', PDF2, fs.readFileSync(path.join(DIR, PDF2)), 'application/pdf');
  console.log('[3b] bulk DOCX → generate...');
  results.s3_docx = await postFile('/quiz/generate', 'pdf', DOCX, fs.readFileSync(path.join(DIR, DOCX)), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  console.log('\n================ COMPARISON ================');
  for (const [k,v] of Object.entries(results)) {
    console.log(`\n### ${k}  (HTTP ${v.status||'-'}, ${v.secs||'?'}s)`);
    if (v.err) console.log('   ERROR:', v.err);
    else console.log('  ', JSON.stringify(summarize(v.quiz)));
  }
  fs.writeFileSync(path.join(__dirname,'demo-pipeline-results.json'), JSON.stringify(results,(k,val)=>k==='quiz'?summarize(val):val,2));
  console.log('\nSaved → scripts/demo-pipeline-results.json');
  process.exit(0);
})().catch(e => { console.error('runner failed:', e); process.exit(1); });
