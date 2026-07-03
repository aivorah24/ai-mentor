// QA sweep: run EVERY PDF worksheet in a folder through /quiz/generate and report
// layout-type coverage + flags (under-extraction / low quality) so a human reviews
// only the outliers instead of all worksheets.
const fs = require('fs');
const path = require('path');
const quizRoute = require('../routes/quiz');

const DIR = process.argv[2] || 'C:/Users/Asus/Desktop/Aivorah Documents/Assignment Picture';
const SERVER = 'http://localhost:3006';
const OUT = path.join(__dirname, '../data/ws-tests');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

async function run() {
  const files = fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  console.log(`Found ${files.length} PDFs in ${DIR}\n`);
  const report = [];

  for (const file of files) {
    const buf = fs.readFileSync(path.join(DIR, file));
    const short = file.replace(/^Toddle-[0-9a-f-]+-/, '').replace(/\.pdf$/i, '').slice(0, 42);
    if (buf.length > 4 * 1024 * 1024) { console.log(`SKIP >4MB: ${short}`); report.push({ short, flag: 'too-big' }); continue; }
    process.stdout.write(`>> ${short} ... `);
    try {
      const form = new FormData();
      form.set('pdf', new Blob([buf], { type: 'application/pdf' }), file);
      form.set('grade', 'PYP 4');
      const res = await fetch(`${SERVER}/quiz/generate`, { method: 'POST', body: form });
      if (!res.ok) { console.log('HTTP ' + res.status); report.push({ short, flag: 'http-' + res.status }); continue; }
      const data = await res.json();
      const quiz = data.quiz;

      const types = {};
      let qTotal = 0, charts = 0, tables = 0, venns = 0;
      for (const t of (quiz.tasks || [])) {
        if (t.chart) charts++;
        if (t.table) tables++;
        for (const q of (t.questions || [])) {
          types[q.type || 'text'] = (types[q.type || 'text'] || 0) + 1;
          if (q.type === 'venn') venns++;
          qTotal++;
        }
      }
      // Render to catch normalizer-derived charts/tables too
      const html = quizRoute.renderQuizHTML(JSON.parse(JSON.stringify(quiz)));
      fs.writeFileSync(path.join(OUT, short.replace(/[^\w]+/g, '_') + '.html'), html);
      const rects = (html.match(/<rect /g) || []).length;
      const ellipses = (html.match(/<ellipse/g) || []).length;
      const htmlTables = (html.match(/<table/g) || []).length;

      // Flags: likely under-extraction
      const flags = [];
      if (qTotal <= 1 && !charts && !tables) flags.push('under-extracted?');
      if (data.validation?.grade && ['C', 'D', 'F'].includes(data.validation.grade)) flags.push('low-quality:' + data.validation.grade);
      const typeStr = Object.entries(types).map(([k, v]) => `${k}:${v}`).join(' ');
      console.log(`tasks=${(quiz.tasks || []).length} q=${qTotal} [${typeStr}] chart=${charts} table=${tables} | render(bars=${rects},venncircles=${ellipses},tables=${htmlTables}) ${flags.length ? '⚠ ' + flags.join(',') : 'OK'}`);
      report.push({ short, tasks: (quiz.tasks || []).length, q: qTotal, types: typeStr, charts, tables, venns, grade: data.validation?.grade, flags });
    } catch (e) {
      console.log('ERR ' + e.message);
      report.push({ short, flag: 'err:' + e.message });
    }
  }

  console.log('\n================ FLAGGED FOR REVIEW ================');
  const flagged = report.filter(r => (r.flags && r.flags.length) || r.flag);
  if (!flagged.length) console.log('None — all worksheets rendered with content.');
  for (const r of flagged) console.log(`⚠ ${r.short} — ${(r.flags || []).join(',') || r.flag}`);

  console.log('\n================ TYPE COVERAGE ================');
  for (const r of report.filter(r => r.types)) console.log(`  ${r.short}: ${r.types}${r.charts ? ' +chart' : ''}${r.tables ? ' +table' : ''}`);
  fs.writeFileSync(path.join(OUT, '_qa-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nHTML + report in: ${OUT}`);
}
run().catch(e => { console.error(e); process.exit(1); });
