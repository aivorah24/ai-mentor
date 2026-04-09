const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const IMAGES = [
  'server/data/images/image_01.png',
  'server/data/images/image_02.png',
  'server/data/images/image_03.png',
  'server/data/images/image_04.png',
  'server/data/images/image_05.png',
  'server/data/images/image_06.png',
  'server/data/images/image_07.png'
];

const AUDIO = 'server/data/images/ElevenLabs_2026-04-08T07_45_00_Lulu Lolipop - High-Pitched and Bubbly_pvc_sp100_s50_sb75_v3.mp3';
const OUTPUT = 'server/data/videos/internet_safety_final.mp4';
const TEMP_DIR = 'server/data/videos/_tmp_safety';

// Updated timing for 7 images (Total ~89s based on script)
const TIMINGS = [
  15,    // 01 Intro
  15,    // 02 Monitor
  15,    // 03 CPU
  15,    // 04 Keyboard/Mouse
  15,    // 05 Hardware/Software
  10,    // 06 Caring for Tools
  4      // 07 Outro (Total sum should match audio duration)
];

fs.mkdirSync(TEMP_DIR, { recursive: true });

async function main() {
  console.log('🎬 Building Internet Safety Video with 7 images...');
  
  const segmentFiles = [];

  for (let i = 0; i < IMAGES.length; i++) {
    const img = IMAGES[i];
    const duration = TIMINGS[i];
    const segmentPath = path.join(TEMP_DIR, `seg_${i}.mp4`);
    
    console.log(`  Processing image ${i+1}: ${img} for ${duration}s`);
    
    // Scale and pad to ensure even dimensions (1024x560)
    const cmd = `ffmpeg -y -loop 1 -t ${duration} -i "${img}" -vf "scale=1024:-2,pad=1024:560:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -pix_fmt yuv420p -r 25 "${segmentPath}"`;
    execSync(cmd, { stdio: 'ignore' });
    segmentFiles.push(segmentPath);
  }

  // Concatenate video segments
  console.log('🎞️ Concatenating segments...');
  const concatList = path.join(TEMP_DIR, 'list.txt');
  fs.writeFileSync(concatList, segmentFiles.map(f => `file '${path.resolve(f).replace(/'/g, "'\\''")}'`).join('\n'));
  
  const tempVideo = path.join(TEMP_DIR, 'no_audio.mp4');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatList}" -c copy "${tempVideo}"`, { stdio: 'ignore' });

  // Add audio
  console.log('🎵 Adding audio...');
  execSync(`ffmpeg -y -i "${tempVideo}" -i "${AUDIO}" -c:v copy -c:a aac -b:a 192k -shortest "${OUTPUT}"`, { stdio: 'ignore' });

  console.log(`\n✅ Final video saved to: ${OUTPUT}`);
}

main().catch(console.error);
