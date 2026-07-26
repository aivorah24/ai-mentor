const fs = require('fs');
const path = require('path');

let FIGURES_INDEX = null;
function getFiguresIndex() {
  if (!FIGURES_INDEX) {
    try {
      FIGURES_INDEX = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/ncert_figures_index.json'), 'utf8'));
    } catch (_) {
      FIGURES_INDEX = [];
    }
  }
  return FIGURES_INDEX;
}

// Generic lookup: grade + subject (+ optional code), sorted by page.
function findFigures({ grade, subject, code }) {
  const gradeNum = parseInt((String(grade).match(/\d+/) || [''])[0], 10);
  let candidates = getFiguresIndex().filter(f => f.grade === gradeNum);
  if (subject) candidates = candidates.filter(f => f.subject.toLowerCase() === String(subject).toLowerCase());
  if (code) {
    const byCode = candidates.filter(f => f.code === code);
    if (byCode.length) candidates = byCode;
  }
  return [...candidates].sort((a, b) => a.page - b.page);
}

module.exports = { getFiguresIndex, findFigures };
