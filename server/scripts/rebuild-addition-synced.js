/**
 * rebuild-addition-synced.js
 * Rebuilds the Addition video with per-scene ElevenLabs audio for perfect sync.
 * Uses Cherry Twinkle voice (same as original).
 * Run from repo root: node server/scripts/rebuild-addition-synced.js
 */

require('dotenv').config({ path: 'server/.env' });
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const https = require('https');

const VOICE_ID = 'cgSgspJ2msm6clMCkdW9'; // Jessica - Playful, Bright, Warm (free premade)
const API_KEY  = process.env.ELEVENLABS_AIVORAH_KEY || process.env.ELEVENLABS_API_KEY;

const IMAGES = [
  'server/data/images/image_01.png',
  'server/data/images/image_02.png',
  'server/data/images/image_03.png',
  'server/data/images/image_04.png',
  'server/data/images/image_05.png',
  'server/data/images/image_06.png',
  'server/data/images/image_07.png',
  'server/data/images/image_08.png',
];

// Narration per slide — matches the 8 addition scene images
const SCENES = [
  {
    id: 'slide_01',
    text: "Hey there, math explorers! Today we are going to learn addition with regrouping! Get ready — this is going to be super fun!",
  },
  {
    id: 'slide_02',
    text: "Here's our problem: 18 plus 24. Step one — line them up! Write the numbers in columns. Ones on the right, tens on the left. Nice and neat!",
  },
  {
    id: 'slide_03',
    text: "Step two — add the ones! Eight plus four equals twelve. Twelve is two digits, so we write the 2 in the ones column and carry the 1 up to the tens.",
  },
  {
    id: 'slide_04',
    text: "We carry the one! See that little 1 written above the tens column? That is called regrouping! We are moving ten ones into the tens place. Brilliant!",
  },
  {
    id: 'slide_05',
    text: "Step three — add the tens! We have 1 plus 1 plus 2. That gives us 4! So we write 4 in the tens column.",
  },
  {
    id: 'slide_06',
    text: "The answer is 42! Eighteen plus twenty-four equals forty-two. Amazing work! You just did regrouping addition!",
  },
  {
    id: 'slide_07',
    text: "Remember the golden rules. Line up your numbers. Add the ones first. Carry over when you get ten or more. Then add the tens. Easy!",
  },
  {
    id: 'slide_08',
    text: "Fantastic job today! You are an addition superstar! Keep practising and you will be amazing at maths. See you next time!",
  },
];

const AUDIO_DIR = 'server/data/videos/_tmp_addition_audio';
const TEMP_DIR  = 'server/data/videos/_tmp_addition_rebuild';
const OUTPUT    = 'server/data/videos/addition_final.mp4';

fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.mkdirSync(TEMP_DIR,  { recursive: true });

// ── ElevenLabs TTS ────────────────────────────────────────────────────────────
function generateAudio(text, outPath) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(outPath)) {
      console.log(`  ↩  Skipping (already exists): ${path.basename(outPath)}`);
      return resolve();
    }
    const body = JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 1.0, use_speaker_boost: true },
    });
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${VOICE_ID}`,
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        let err = '';
        res.on('data', d => err += d);
        res.on('end', () => reject(new Error(`ElevenLabs error ${res.statusCode}: ${err}`)));
        return;
      }
      const file = fs.createWriteStream(outPath);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getAudioDuration(filePath) {
  const out = execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`).toString().trim();
  return parseFloat(out);
}

async function main() {
  if (!API_KEY) { console.error('❌ ELEVENLABS_API_KEY missing'); process.exit(1); }

  console.log('🎙️  Step 1: Generating per-scene audio via ElevenLabs...');
  const audioPaths = [];
  for (const scene of SCENES) {
    const outPath = path.join(AUDIO_DIR, `${scene.id}.mp3`);
    console.log(`  Generating: ${scene.id}`);
    await generateAudio(scene.text, outPath);
    audioPaths.push(outPath);
  }

  console.log('\n⏱️  Step 2: Measuring exact audio durations...');
  const durations = [];
  for (const p of audioPaths) {
    const d = getAudioDuration(p);
    durations.push(d);
    console.log(`  ${path.basename(p)}: ${d.toFixed(3)}s`);
  }
  console.log(`  Total: ${durations.reduce((a, b) => a + b, 0).toFixed(3)}s`);

  console.log('\n🎞️  Step 3: Building video segments (image × exact audio duration)...');
  const segFiles = [];
  for (let i = 0; i < IMAGES.length; i++) {
    const img = IMAGES[i];
    const dur = durations[i];
    const seg = path.join(TEMP_DIR, `seg_${i}.mp4`);
    const cmd = `ffmpeg -y -loop 1 -t ${dur} -i "${img}" -vf "scale=1024:-2,pad=1024:560:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -pix_fmt yuv420p -r 25 "${seg}"`;
    execSync(cmd, { stdio: 'ignore' });
    segFiles.push(seg);
    console.log(`  Segment ${i + 1}: ${dur.toFixed(3)}s`);
  }

  console.log('\n🔗  Step 4: Concatenating video segments...');
  const videoList = path.join(TEMP_DIR, 'video_list.txt');
  fs.writeFileSync(videoList, segFiles.map(f => `file '${path.resolve(f).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const noAudio = path.join(TEMP_DIR, 'no_audio.mp4');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${videoList}" -c copy "${noAudio}"`, { stdio: 'ignore' });

  console.log('\n🎵  Step 5: Concatenating audio clips...');
  const audioList = path.join(TEMP_DIR, 'audio_list.txt');
  fs.writeFileSync(audioList, audioPaths.map(f => `file '${path.resolve(f).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const fullAudio = path.join(TEMP_DIR, 'full_audio.mp3');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${audioList}" -c copy "${fullAudio}"`, { stdio: 'ignore' });

  console.log('\n🎬  Step 6: Merging video + audio...');
  execSync(`ffmpeg -y -i "${noAudio}" -i "${fullAudio}" -c:v copy -c:a aac -b:a 192k "${OUTPUT}"`, { stdio: 'ignore' });

  const finalDur = getAudioDuration(OUTPUT);
  console.log(`\n✅  Done! addition_final.mp4 → ${finalDur.toFixed(1)}s`);
  console.log(`    Saved to: ${OUTPUT}`);
  console.log('\n📤  Next: run upload-to-cloudinary.js to push the new video.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
