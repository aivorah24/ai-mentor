// One-off script: generates a small bulk-import test sample so you can
// verify the create + email-sending flow end to end. Run: node scripts/gen-test-import-sample.js
const ExcelJS = require('exceljs');
const path = require('path');

const HEADER = ['Student Name', 'Student Email', 'Admission No', 'Grade', 'Section', 'Parent Name', 'Parent Email', 'Parent Phone'];

// Row 1: student has a REAL email -> student should get the login email directly.
// Row 2: student has NO email -> parent should get the student's login+password instead.
// Replace the placeholder addresses below with a real inbox you can check before uploading.
const ROWS = [
  ['Test Student One (real email)', 'YOUR_REAL_EMAIL_HERE+student1@gmail.com', '', 'Grade 3', 'A', 'Test Parent One', 'YOUR_REAL_EMAIL_HERE+parent1@gmail.com', '+91 90000 11111'],
  ['Test Student Two (no email)', '', '', 'Grade 4', 'B', 'Test Parent Two', 'YOUR_REAL_EMAIL_HERE+parent2@gmail.com', '+91 90000 22222'],
];

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Students', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = HEADER.map((h, i) => ({ header: h, key: `c${i}`, width: [30, 34, 16, 12, 12, 24, 34, 18][i] }));

  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5C4A1E' } };
  });
  headerRow.height = 22;

  ROWS.forEach((r) => ws.addRow(r));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADER.length } };

  const outPath = path.join(__dirname, '..', '..', 'bulk_import_test_sample.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log('Wrote:', outPath);
}

main().catch((e) => { console.error(e); process.exit(1); });
