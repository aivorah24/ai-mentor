/**
 * download-cbse-books.js
 * Downloads official CBSE Student Handbooks (2026-27) for Grade 3-6
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'cbse_books');

const BOOKS = [
  {
    grade: 'Grade 3',
    file: path.join(DATA_DIR, 'cbse_grade3.pdf'),
    url: 'https://cbseacademic.nic.in/web_material/CurriculumMain25/Syl_SH_2026-27/Grade-III_SH_2026-27.pdf',
  },
  {
    grade: 'Grade 4',
    file: path.join(DATA_DIR, 'cbse_grade4.pdf'),
    url: 'https://cbseacademic.nic.in/web_material/CurriculumMain25/Syl_SH_2026-27/Grade-IV_SH_2026-27.pdf',
  },
  {
    grade: 'Grade 5',
    file: path.join(DATA_DIR, 'cbse_grade5.pdf'),
    url: 'https://cbseacademic.nic.in/web_material/CurriculumMain25/Syl_SH_2026-27/Grade-V_SH_2026-27.pdf',
  },
  {
    grade: 'Grade 6',
    file: path.join(DATA_DIR, 'cbse_grade6.pdf'),
    url: 'https://cbseacademic.nic.in/web_material/CurriculumMain25/Syl_SH_2026-27/Grade-VI_SH_2026-27.pdf',
  },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;

    function doRequest(url) {
      protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          doRequest(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    }

    doRequest(url);
  });
}

async function run() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('Created directory:', DATA_DIR);
  }

  for (const book of BOOKS) {
    if (fs.existsSync(book.file)) {
      const size = fs.statSync(book.file).size;
      console.log(`  Already exists: ${path.basename(book.file)} (${Math.round(size/1024)} KB)`);
      continue;
    }
    console.log(`Downloading ${book.grade}...`);
    try {
      await download(book.url, book.file);
      const size = fs.statSync(book.file).size;
      console.log(`  Saved: ${path.basename(book.file)} (${Math.round(size/1024)} KB)`);
    } catch (err) {
      console.error(`  Failed: ${err.message}`);
    }
  }
  console.log('Done.');
}

run().catch(console.error);
