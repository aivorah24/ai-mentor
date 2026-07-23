// Counts pending core books (grades 7-12). When zero, deletes the Windows
// scheduled task so the pipeline self-terminates, and writes a DONE marker.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const LIST = path.resolve(__dirname, '..', 'data/curricula/ncert_catalog/english_medium.txt');
const CKPT = path.resolve(__dirname, '..', 'data/curricula/ncert_catalog/orchestrator_checkpoint.json');
const DONE = path.resolve(__dirname, '..', 'data/curricula/ncert_catalog/PIPELINE_DONE.txt');
const gmap = { g: 7, h: 8, i: 9, j: 10, k: 11, l: 12 };
const term = ['done', 'skipped-subject', 'no-chapters'];
let c = {}; try { c = JSON.parse(fs.readFileSync(CKPT, 'utf8')); } catch (e) {}
const lines = fs.readFileSync(LIST, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
let pending = 0, done = 0;
for (const ln of lines) {
  const m = ln.match(/^([a-z]+\d+)=/); if (!m) continue;
  const code = m[1]; const g = gmap[code[0]]; if (!g) continue;
  const st = c[code] && c[code].status;
  if (term.includes(st)) { if (st === 'done') done++; } else pending++;
}
console.log(`[check] done=${done} pending=${pending}`);
if (pending === 0) {
  fs.writeFileSync(DONE, `Pipeline complete: ${done} core books done at ${new Date().toISOString()}\n`);
  try { execSync('schtasks /delete /tn "AivorahNCERTPipeline" /f', { stdio: 'ignore' }); console.log('[check] ALL DONE — scheduled task deleted.'); } catch (e) { console.log('[check] all done; task delete failed:', e.message); }
}
