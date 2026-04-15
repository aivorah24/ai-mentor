const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, '../data/images/living_nonliving');
const AUDIO_DIR = path.join(__dirname, '../data/video_packages/ncert-grade-3-science-living-and-non-living-things/audio');
const OUTPUT = path.join(__dirname, '../data/videos/living_nonliving_final.mp4');
const TEMP_DIR = path.join(__dirname, '../data/videos/_tmp_living_nonliving');

const TIMINGS = [
  4.656, // scene_01_excited.mp3
  3.552, // scene_02_happy.mp3
  4.320, // scene_03_thinking.mp3
  4.560, // scene_04_questioning.mp3
  5.160, // scene_05_happy.mp3
  5.424, // scene_06_excited.mp3
  5.040, // scene_07_thinking.mp3
  5.328, // scene_08_questioning.mp3
  6.168, // scene_09_happy.mp3
  5.976, // scene_10_happy.mp3
  5.064, // scene_11_excited.mp3
  7.032, // scene_12_celebrating.mp3
];

fs.mkdirSync(TEMP_DIR, { recursive: true });

async function main() {
  console.log('🎬 Building Living and Non-Living Things Video...');
  
  const segmentFiles = [];

  for (let i = 0; i < 12; i++) {
    const imgNum = String(i + 1).padStart(2, '0');
    const img = path.join(IMAGES_DIR, `slide_${imgNum}.png`);
    const duration = TIMINGS[i];
    const segmentPath = path.join(TEMP_DIR, `seg_${i}.mp4`);
    
    console.log(`  Processing slide ${imgNum} for ${duration}s`);
    
    const cmd = `ffmpeg -y -loop 1 -t ${duration} -i "${img}" -vf "scale=1280:720" -c:v libx264 -pix_fmt yuv420p -r 25 "${segmentPath}"`;
    execSync(cmd, { stdio: 'ignore' });
    segmentFiles.push(segmentPath);
  }

  // Concatenate video segments
  console.log('🎞️ Concatenating video segments...');
  const concatVideoList = path.join(TEMP_DIR, 'video_list.txt');
  fs.writeFileSync(concatVideoList, segmentFiles.map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n'));
  
  const tempVideo = path.join(TEMP_DIR, 'no_audio.mp4');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatVideoList}" -c copy "${tempVideo}"`, { stdio: 'ignore' });

  // Concatenate audio clips
  console.log('🎵 Concatenating audio clips...');
  const audioFiles = fs.readdirSync(AUDIO_DIR)
    .filter(f => f.startsWith('scene_') && f.endsWith('.mp3'))
    .sort();
  
  const concatAudioList = path.join(TEMP_DIR, 'audio_list.txt');
  fs.writeFileSync(concatAudioList, audioFiles.map(f => `file '${path.join(AUDIO_DIR, f).replace(/'/g, "'\\''")}'`).join('\n'));
  
  const tempAudio = path.join(TEMP_DIR, 'full_audio.mp3');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatAudioList}" -c copy "${tempAudio}"`, { stdio: 'ignore' });

  // Merge
  console.log('🔗 Merging video + audio...');
  execSync(`ffmpeg -y -i "${tempVideo}" -i "${tempAudio}" -c:v copy -c:a aac -b:a 192k "${OUTPUT}"`, { stdio: 'ignore' });

  console.log(`\n✅ Final video saved to: ${OUTPUT}`);
}

main().catch(console.error);
