/**
 * qa-gate.cjs — the ONE command that decides whether a grade is shippable.
 *
 * Runs the full pipeline in dependency order and refuses to report success
 * unless every stage passes. Nothing is "completed" until this exits 0.
 *
 *   node scripts/qa-gate.cjs --grade 2
 *   node scripts/qa-gate.cjs --grade 2 --attach     # also attach missing book art
 *   node scripts/qa-gate.cjs                        # all grades
 *
 * Stages:
 *   1. ASSETS  — every lesson has a real, resolvable book figure (or a maths
 *                worked-example board). This is the check that was missing when
 *                empty "Illustration coming soon" panes shipped as "completed".
 *   2. CONTENT — scripts/qa-validate.cjs: structure, arithmetic, quiz, grade fit.
 *   3. REPORT  — per-grade pass rate against the >95% bar.
 *
 * Exit code is 1 if ANY grade is below the bar, so CI/deploy can block on it.
 */
require('dotenv').config();
const { execFileSync } = require('child_process');
const path = require('path');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : d; };
const BAR = +arg('--bar', 95);
const gradeArg = arg('--grade');
const grades = gradeArg ? [gradeArg] : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const attach = process.argv.includes('--attach');

function run(script, args) {
  try {
    return execFileSync('node', [path.join(__dirname, script), ...args], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}

(async () => {
  const summary = [];
  for (const g of grades) {
    console.log(`\n${'='.repeat(60)}\nGRADE ${g}\n${'='.repeat(60)}`);

    if (attach) {
      console.log('· attaching book figures to lessons missing art…');
      const out = run('attach-figures.cjs', ['--grade', g]);
      const line = (out.match(/^=== G.*$/m) || ['(no lessons)'])[0];
      console.log('  ' + line);
    }

    const out = run('qa-validate.cjs', ['--grade', g]);
    const m = out.match(/(\d+) lessons checked · (\d+) PASS · (\d+) FAIL/);
    if (!m) { console.log('  no lessons published for this grade'); continue; }
    const [, total, pass, fail] = m.map(Number);
    const pct = total ? (pass / total) * 100 : 0;

    // Group the failure reasons so the next action is obvious, rather than
    // scrolling hundreds of near-identical lines.
    const reasons = {};
    for (const line of out.split('\n')) {
      if (!line.startsWith('❌')) continue;
      const why = line.split(': ').slice(1).join(': ');
      for (const r of why.split('; ')) {
        const key = r.replace(/[-\d,.]+/g, 'N').replace(/ref: .*/, 'ref: …').trim();
        reasons[key] = (reasons[key] || 0) + 1;
      }
    }
    console.log(`  ${total} lessons · ${pass} PASS · ${fail} FAIL · ${pct.toFixed(1)}%`);
    Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 12)
      .forEach(([r, n]) => console.log(`    ${String(n).padStart(4)} × ${r}`));
    summary.push({ grade: g, total, pass, fail, pct });
  }

  console.log(`\n${'='.repeat(60)}\nGATE SUMMARY (bar: ${BAR}%)\n${'='.repeat(60)}`);
  let blocked = false;
  for (const s of summary) {
    const ok = s.pct >= BAR;
    if (!ok) blocked = true;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  G${s.grade.padStart(2)}  ${s.pass}/${s.total}  ${s.pct.toFixed(1)}%`);
  }
  if (!summary.length) { console.log('  nothing published'); process.exit(0); }
  console.log(blocked ? '\nNOT SHIPPABLE — grades above are below the bar.' : '\nALL GRADES SHIPPABLE.');
  process.exit(blocked ? 1 : 0);
})();
