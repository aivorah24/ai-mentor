require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sb = require('../services/supabase');
const syllabus = require('../services/syllabus-map');

(async () => {
  const grades = Array.from({ length: 12 }, (_, i) => i + 1);
  const out = [];
  for (const g of grades) {
    const { data: chs } = await sb.from('syllabus_chapters').select('id,subject,title,unit_no').eq('grade', `Grade ${g}`);
    for (const c of chs || []) {
      if (!/^chapter\s*\d+$/i.test(String(c.title || '').trim())) continue;
      const recs = syllabus.chaptersFor(g, c.subject) || [];
      const rec = recs.find(r => r.chapter === c.unit_no);
      out.push({
        chapterId: c.id, grade: g, subject: c.subject, unitNo: c.unit_no,
        bookPath: rec?.bookPath || null, pdfFile: rec?.pdfFile || null,
      });
    }
  }
  const outPath = path.resolve(__dirname, '..', 'data', 'curricula', 'ncert_catalog', 'generic-title-worklist.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  const noBook = out.filter(o => !o.bookPath).length;
  console.log(`written: ${outPath}`);
  console.log(`total: ${out.length}  missing bookPath: ${noBook}`);
})();
