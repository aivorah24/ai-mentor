require('dotenv').config();
const sb = require('../services/supabase');

(async () => {
  const grades = Array.from({ length: 12 }, (_, i) => i + 1);
  const worklist = [];
  for (const g of grades) {
    const { data: chs } = await sb.from('syllabus_chapters').select('id,subject,title,unit_no').eq('grade', `Grade ${g}`);
    const bySubj = new Map();
    for (const c of chs || []) {
      if (!/^chapter\s*\d+$/i.test(String(c.title || '').trim())) continue;
      if (!bySubj.has(c.subject)) bySubj.set(c.subject, []);
      bySubj.get(c.subject).push(c.unit_no);
    }
    for (const [subj, units] of bySubj) {
      worklist.push({ grade: g, subject: subj, count: units.length, units: units.sort((a, b) => a - b) });
    }
  }
  worklist.sort((a, b) => a.grade - b.grade || b.count - a.count);
  for (const w of worklist) console.log(`G${w.grade}`, w.subject, '->', w.count, 'generic:', w.units.join(','));
  console.log('\ntotal generic chapters:', worklist.reduce((a, w) => a + w.count, 0));
})();
