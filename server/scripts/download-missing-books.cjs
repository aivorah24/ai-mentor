// download-missing-books.cjs — download the missing NCERT text-based books from
// ncert.nic.in (Hindi, Sanskrit, Psychology) into data/ncert_books/gradeN/<folder>/,
// auto-fetching each book's chapters (<prefix>01, 02 …) until a 404. Skips
// already-downloaded files (resumable). After this, run ingest-all-ncert.js for
// those grades to ground them, then run-batch.cjs to publish.
//
//   node scripts/download-missing-books.cjs
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const BOOKS = path.resolve(__dirname, '..', 'data', 'ncert_books');
const LIST = require('./ncert-missing-books.json').books;

function download(code, dest) {
  // curl handles TLS + the required browser UA reliably here.
  execFileSync('curl', ['-sL', '-A', UA, '-o', dest, `https://ncert.nic.in/textbook/pdf/${code}.pdf`, '--max-time', '40'], { stdio: 'ignore' });
  const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
  // A 404 returns a tiny (~6 byte) body; real chapter PDFs are >100KB.
  if (size < 20000) { try { fs.unlinkSync(dest); } catch {} return false; }
  return true;
}

(async () => {
  let got = 0, skipped = 0;
  for (const b of LIST) {
    const dir = path.join(BOOKS, `grade${b.grade}`, b.folder);
    fs.mkdirSync(dir, { recursive: true });
    for (const prefix of b.prefixes) {
      // chapters: <prefix>01 .. until 3 consecutive misses
      let misses = 0;
      for (let ch = 1; ch <= 30 && misses < 3; ch++) {
        const code = `${prefix}${String(ch).padStart(2, '0')}`;
        const dest = path.join(dir, `${code}.pdf`);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 20000) { skipped++; continue; }
        if (download(code, dest)) { got++; misses = 0; process.stdout.write(`  ✅ G${b.grade} ${b.subject} ${code}\r`); console.log(`  ✅ G${b.grade} ${b.subject} ${code}`); }
        else { misses++; }
      }
    }
  }
  console.log(`\n=== Downloaded ${got} new chapter PDFs (${skipped} already present) ===`);
  console.log('Next: node scripts/ingest-all-ncert.js --grades 5,6,7,8,9,10,11,12');
})();
