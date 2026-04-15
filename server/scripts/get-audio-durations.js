const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const AUDIO_DIR = path.join(__dirname, '../data/video_packages/ncert-grade-3-science-living-and-non-living-things/audio');

const files = fs.readdirSync(AUDIO_DIR)
  .filter(f => f.startsWith('scene_') && f.endsWith('.mp3'))
  .sort();

console.log('const TIMINGS = [');
for (const file of files) {
  const filePath = path.join(AUDIO_DIR, file);
  const duration = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, { encoding: 'utf8' }).trim();
  console.log(`  ${parseFloat(duration).toFixed(3)}, // ${file}`);
}
console.log('];');
