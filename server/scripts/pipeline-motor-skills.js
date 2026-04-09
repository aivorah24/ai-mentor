/**
 * pipeline-motor-skills.js
 * Complete pipeline for Fundamental Motor Skills video:
 *   1. Generate ElevenLabs voiceover (saved permanently — never regenerated)
 *   2. Strip audio from InVideo source video
 *   3. Merge with ElevenLabs voice
 *   4. Upload final video to Cloudinary
 *   5. Register in videos.json (served by /videos route)
 *
 * Usage:
 *   node scripts/pipeline-motor-skills.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');
const https        = require('https');

// ── Config ────────────────────────────────────────────────────────────────────
const VIDEOS_DIR   = path.join(__dirname, '../data/videos');
const DB_PATH      = path.join(__dirname, '../data/videos.json');

const SOURCE_VIDEO = path.join(VIDEOS_DIR, 'invideo-ai-1080 Kids Level Up Fast_ Locomotor Skills in  2026-04-06.mp4');
const VOICE_FILE   = path.join(VIDEOS_DIR, 'motor_skills_voice.mp3');
const SILENT_FILE  = path.join(VIDEOS_DIR, 'motor_skills_silent.mp4');
const FINAL_FILE   = path.join(VIDEOS_DIR, 'motor_skills_final.mp4');

const VOICE_ID     = 'vGQNBgLaiM3EdZtxIiuY';
const API_KEY      = process.env.ELEVENLABS_AIVORAH_KEY;

// Cloudinary
const CLOUD_NAME   = process.env.CLOUDINARY_CLOUD_NAME;
const CLD_API_KEY  = process.env.CLOUDINARY_API_KEY;
const CLD_SECRET   = process.env.CLOUDINARY_API_SECRET;

// ── Voiceover script (Locomotor Skills focus — matches InVideo video content) ─
const VOICEOVER_SCRIPT = `Hey there Grade 3 superstars! Are you ready to MOVE?

Today we are learning about LOCOMOTOR SKILLS — one of the three types of fundamental motor skills!

So what are locomotor skills? These are movements where YOU travel from one place to another!

RUNNING! Pump those arms, lift those knees — zoom zoom zoom!

SKIPPING! Step and hop, step and hop — feel the rhythm!

HOPPING! Jump on ONE foot — can you keep your balance?

And GALLOPING! Lead with one foot and follow — just like a horse — clip clop clip clop!

Here is something important to remember — every time you run to the playground, skip down the hallway, or race with your friends — you are using LOCOMOTOR SKILLS!

These skills make you faster, stronger, and more coordinated every single day!

Quiz time! Which of these is a LOCOMOTOR skill — running or balancing?

That's right — RUNNING! Because you move from one place to another!

Balancing is non-locomotor — you stay in one spot!

Brilliant work today Grade 3! Keep moving, keep growing — you are absolutely AMAZING!`;

// ── Helper: read/write videos DB ──────────────────────────────────────────────
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return []; }
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}
function makeId() {
  return 'vid_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── Step 1: Generate ElevenLabs voiceover ─────────────────────────────────────
async function generateVoice() {
  if (fs.existsSync(VOICE_FILE)) {
    const kb = (fs.statSync(VOICE_FILE).size / 1024).toFixed(0);
    console.log(`\n🎙️  Voice already exists (${kb} KB) — skipping to save credits.`);
    console.log(`   Delete ${VOICE_FILE} to regenerate.`);
    return;
  }

  if (!API_KEY) {
    console.error('❌ ELEVENLABS_AIVORAH_KEY not set in .env');
    process.exit(1);
  }

  console.log('\n🎙️  Step 1: Generating ElevenLabs voiceover...');
  console.log(`   Voice   : ${VOICE_ID}`);
  console.log(`   Model   : eleven_turbo_v2_5 (minimum credits)`);
  console.log(`   Credits : ~${Math.ceil(VOICEOVER_SCRIPT.length / 4)} estimated\n`);

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': API_KEY,
    },
    body: JSON.stringify({
      text: VOICEOVER_SCRIPT,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability: 0.25,
        similarity_boost: 0.80,
        style: 0.85,
        use_speaker_boost: true,
        speed: 1.05,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`❌ ElevenLabs error ${res.status}: ${err.slice(0, 300)}`);
    process.exit(1);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  fs.writeFileSync(VOICE_FILE, buffer);

  const kb = (buffer.length / 1024).toFixed(1);
  console.log(`✅ Voice saved permanently: ${VOICE_FILE} (${kb} KB)`);
  console.log(`   Will NOT be regenerated on future runs — credits saved.`);
}

// ── Step 2: Strip audio from source video ─────────────────────────────────────
function stripAudio() {
  console.log('\n✂️  Step 2: Stripping audio from source video...');

  if (!fs.existsSync(SOURCE_VIDEO)) {
    console.error(`❌ Source video not found: ${SOURCE_VIDEO}`);
    process.exit(1);
  }

  execSync(
    `ffmpeg -y -i "${SOURCE_VIDEO}" -c:v copy -an "${SILENT_FILE}"`,
    { stdio: 'pipe' }
  );

  const mb = (fs.statSync(SILENT_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`✅ Silent video: ${SILENT_FILE} (${mb} MB)`);
}

// ── Step 3: Merge silent video + ElevenLabs voice ─────────────────────────────
function mergeAudio() {
  console.log('\n🎞️  Step 3: Merging video + ElevenLabs voice...');

  const videoDur = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${SILENT_FILE}"`,
      { encoding: 'utf8' }).trim()
  );
  const audioDur = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${VOICE_FILE}"`,
      { encoding: 'utf8' }).trim()
  );

  console.log(`   Video: ${videoDur.toFixed(1)}s | Audio: ${audioDur.toFixed(1)}s`);

  if (audioDur > videoDur) {
    // Loop video to match audio length
    console.log(`   Extending video to match voice length...`);
    execSync(
      `ffmpeg -y -stream_loop -1 -i "${SILENT_FILE}" -i "${VOICE_FILE}" ` +
      `-c:v libx264 -c:a aac -b:a 192k -t ${audioDur.toFixed(3)} -pix_fmt yuv420p "${FINAL_FILE}"`,
      { stdio: 'pipe' }
    );
  } else {
    // Pad audio with silence to match video
    execSync(
      `ffmpeg -y -i "${SILENT_FILE}" -i "${VOICE_FILE}" ` +
      `-filter_complex "[1:a]apad[a]" -map 0:v -map "[a]" ` +
      `-c:v copy -c:a aac -b:a 192k -shortest "${FINAL_FILE}"`,
      { stdio: 'pipe' }
    );
  }

  const mb = (fs.statSync(FINAL_FILE).size / 1024 / 1024).toFixed(1);
  console.log(`✅ Final video: ${FINAL_FILE} (${mb} MB)`);
}

// ── Step 4: Upload to Cloudinary ──────────────────────────────────────────────
async function uploadToCloudinary() {
  console.log('\n☁️  Step 4: Uploading to Cloudinary...');

  let cloudinary;
  try {
    cloudinary = require('cloudinary').v2;
  } catch {
    console.log('   Installing cloudinary package...');
    execSync('npm install cloudinary', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
    cloudinary = require('cloudinary').v2;
  }

  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key:    CLD_API_KEY,
    api_secret: CLD_SECRET,
  });

  const result = await cloudinary.uploader.upload(FINAL_FILE, {
    resource_type : 'video',
    public_id     : 'aivorah/grade3/physical_ed/motor_skills_final',
    overwrite     : true,
    folder        : 'aivorah/grade3/physical_ed',
    transformation: [
      { quality: 'auto', fetch_format: 'mp4' },
    ],
  });

  console.log(`✅ Uploaded to Cloudinary:`);
  console.log(`   URL     : ${result.secure_url}`);
  console.log(`   Public ID: ${result.public_id}`);
  console.log(`   Size    : ${(result.bytes / 1024 / 1024).toFixed(1)} MB`);

  return result.secure_url;
}

// ── Step 5: Register in videos.json ──────────────────────────────────────────
function registerVideo(cloudinaryUrl) {
  console.log('\n📋  Step 5: Registering in videos.json...');

  const all = readDB();

  // Remove existing entry for this topic if any
  const filtered = all.filter(v =>
    !(v.topic === 'Fundamental Motor Skills' && v.grade === 'Grade 3')
  );

  const video = {
    id          : makeId(),
    title       : 'Fundamental Motor Skills',
    topic       : 'Fundamental Motor Skills',
    subject     : 'Physical Education',
    curriculum  : 'IB PYP',
    grade       : 'Grade 3',
    url         : cloudinaryUrl,
    embedUrl    : cloudinaryUrl,
    description : 'Learn about Locomotor, Non-Locomotor and Manipulative Skills. IB PYP Grade 3 Physical Education.',
    source      : 'cloudinary',
    voiceId     : VOICE_ID,
    createdAt   : new Date().toISOString(),
  };

  filtered.push(video);
  writeDB(filtered);

  console.log(`✅ Registered in videos.json`);
  console.log(`   ID    : ${video.id}`);
  console.log(`   Topic : ${video.topic}`);
  console.log(`   Grade : ${video.grade}`);

  return video;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  AIVORAH · Fundamental Motor Skills · Complete Pipeline');
  console.log('═══════════════════════════════════════════════════════════');

  await generateVoice();
  stripAudio();
  mergeAudio();
  const cloudinaryUrl = await uploadToCloudinary();
  const video = registerVideo(cloudinaryUrl);

  // Cleanup temp files
  if (fs.existsSync(SILENT_FILE)) fs.unlinkSync(SILENT_FILE);

  console.log('\n🎉 Pipeline complete!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   Cloudinary URL : ${cloudinaryUrl}`);
  console.log(`   Video ID       : ${video.id}`);
  console.log(`   Voice MP3      : ${VOICE_FILE} (stored permanently)`);
  console.log('\n   In the app: VideoLessonScreen → Physical Education');
  console.log('   → Fundamental Motor Skills → Play video');
  console.log('═══════════════════════════════════════════════════════════');
})();
