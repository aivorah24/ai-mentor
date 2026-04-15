/**
 * rebuild-all-videos-synced.js
 * Rebuilds Computer Basics, Internet Safety, Nutrition, Motor Skills
 * with per-scene ElevenLabs audio (Jessica voice) for perfect sync.
 * Run from repo root: node server/scripts/rebuild-all-videos-synced.js
 */

require('dotenv').config({ path: 'server/.env' });
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const https = require('https');

const VOICE_ID = 'cgSgspJ2msm6clMCkdW9'; // Jessica - Playful, Bright, Warm
const API_KEY  = process.env.ELEVENLABS_AIVORAH_KEY || process.env.ELEVENLABS_API_KEY;

// ── Video definitions ─────────────────────────────────────────────────────────
const VIDEOS = [
  {
    id: 'computer_basics',
    output: 'server/data/videos/computer_basics_final.mp4',
    tempDir: 'server/data/videos/_tmp_cb_rebuild',
    audioDir: 'server/data/videos/_tmp_cb_audio',
    images: [
      'server/data/images/image_01.png',
      'server/data/images/image_02.png',
      'server/data/images/image_03.png',
      'server/data/images/image_04.png',
      'server/data/images/image_05.png',
      'server/data/images/image_06.png',
      'server/data/images/image_07.png',
    ],
    scenes: [
      { id: 'slide_01', text: "Hi everyone! Welcome to our digital world adventure! Today we are going to learn all about computers and what makes them tick. Let's go!" },
      { id: 'slide_02', text: "First, let's talk about the Monitor. It is like a magic window into the computer! This is where everything you do shows up. Without the monitor, you would not see anything at all." },
      { id: 'slide_03', text: "Now meet the CPU — the brain of the computer! CPU stands for Central Processing Unit. It does all the thinking and makes everything happen super fast. Cool right?" },
      { id: 'slide_04', text: "To talk to our computer, we use the Keyboard and the Mouse. We type our words and ideas on the keyboard, and we use the mouse to point and click. They are how we tell the computer what to do!" },
      { id: 'slide_05', text: "Did you know computers have two kinds of parts? Hardware is everything you can touch — like the keyboard, monitor, and mouse. Software is the programmes and apps that run inside. You cannot touch software but you can use it!" },
      { id: 'slide_06', text: "Computers are smart but also very delicate. Always handle them gently, keep food and drinks away, and never drop them. Taking care of your computer means it will work well for a long time." },
      { id: 'slide_07', text: "Amazing work today! You now know all about the main parts of a computer. Remember — monitor, CPU, keyboard, mouse, hardware and software. You are a computer expert! See you next time!" },
    ],
  },
  {
    id: 'internet_safety',
    output: 'server/data/videos/internet_safety_final.mp4',
    tempDir: 'server/data/videos/_tmp_is_rebuild',
    audioDir: 'server/data/videos/_tmp_is_audio',
    images: [
      'server/data/images/image_01.png',
      'server/data/images/image_02.png',
      'server/data/images/image_03.png',
      'server/data/images/image_04.png',
      'server/data/images/image_05.png',
      'server/data/images/image_06.png',
      'server/data/images/image_07.png',
    ],
    scenes: [
      { id: 'slide_01', text: "Hey explorers! Welcome to our internet safety adventure! The internet is amazing and fun, but just like crossing the road, we need to follow some important rules to stay safe. Let's learn them together!" },
      { id: 'slide_02', text: "First — passwords are your secret key! Just like you would not give your house key to a stranger, never share your password with anyone except your parents. Make it long, mix letters and numbers, and keep it a secret!" },
      { id: 'slide_03', text: "When you are online, be careful about who you talk to. Never share your full name, address, phone number, or school name with strangers online. If someone asks for this information, tell a trusted adult right away!" },
      { id: 'slide_04', text: "Cyberbullying means being mean to someone online — sending hurtful messages or leaving people out on purpose. It is never okay. If this happens to you or a friend, always tell a parent or teacher. You do not have to face it alone!" },
      { id: 'slide_05', text: "Screen time can be fun but too much is not good for your eyes or brain. Balance your time — play outside, read books, and spend time with family. A healthy mix makes you happier and smarter!" },
      { id: 'slide_06', text: "If you ever see something online that makes you feel uncomfortable or scared, do not click on it. Close the screen and tell a grown-up you trust straight away. You did the right thing by telling someone!" },
      { id: 'slide_07', text: "Superstar work today! You have learnt the golden rules of internet safety. Use strong passwords, stay safe with strangers, be kind online, and always tell a trusted adult if something feels wrong. Stay safe and happy online!" },
    ],
  },
  {
    id: 'nutrition',
    output: 'server/data/videos/nutrition_lesson_final.mp4',
    tempDir: 'server/data/videos/_tmp_nu_rebuild',
    audioDir: 'server/data/videos/_tmp_nu_audio',
    images: [
      'server/data/images/image_01.png',
      'server/data/images/image_02.png',
      'server/data/images/image_03.png',
      'server/data/images/image_04.png',
      'server/data/images/image_05.png',
      'server/data/images/image_06.png',
      'server/data/images/image_07.png',
    ],
    scenes: [
      { id: 'slide_01', text: "Hey kids! Today we are going on a fun adventure to learn about what makes us strong, healthy, and full of energy! Let's explore nutrition and healthy living together!" },
      { id: 'slide_02', text: "Did you know there are five main food groups? Fruits, vegetables, grains, protein, and dairy! Each group gives your body something special. Fruits and vegetables give you vitamins. Grains give you energy. Protein builds strong muscles. Dairy makes your bones strong!" },
      { id: 'slide_03', text: "A balanced diet means eating a little bit from each food group every day. Think of your plate like a rainbow — the more colours you eat, the more nutrients you get! Try to fill half your plate with fruits and vegetables." },
      { id: 'slide_04', text: "Exercise is super important too! When you run, jump, dance, or play sport, you make your heart stronger, your muscles bigger, and your mind sharper. Try to be active for at least thirty minutes every day. It is so much fun!" },
      { id: 'slide_05', text: "Hygiene is also a big part of being healthy. Always wash your hands before eating and after using the toilet. Brush your teeth twice a day. These simple habits keep germs away and keep you feeling great!" },
      { id: 'slide_06', text: "Water is your body's best friend! Drink plenty of water every day — at least six to eight glasses. Water keeps your brain working well, your skin glowing, and your body energised. Ditch sugary drinks and choose water instead!" },
      { id: 'slide_07', text: "Fantastic job today! You have learnt so much about nutrition and healthy living. Remember — eat a balanced diet, stay active, drink water, and keep clean. These superhero habits will keep you strong and happy every single day!" },
    ],
  },
  {
    id: 'motor_skills',
    output: 'server/data/videos/motor_skills_locomotor.mp4',
    tempDir: 'server/data/videos/_tmp_ms_rebuild',
    audioDir: 'server/data/videos/_tmp_ms_audio',
    images: [
      'server/data/images/image_01.png',
      'server/data/images/image_02.png',
      'server/data/images/image_03.png',
      'server/data/images/image_04.png',
      'server/data/images/image_05.png',
      'server/data/images/image_06.png',
      'server/data/images/image_07.png',
    ],
    scenes: [
      { id: 'slide_01', text: "Hey athletes! Welcome to our physical education adventure! Today we are going to learn about fundamental motor skills — the amazing movements our bodies can do. Get ready to move and have fun!" },
      { id: 'slide_02', text: "First up — locomotor skills! These are movements that take you from one place to another. Walking, running, skipping, hopping, jumping, and galloping are all locomotor skills. Try them right now — can you skip across the room?" },
      { id: 'slide_03', text: "Next are non-locomotor skills — movements you do while staying in one spot. Bending, twisting, stretching, balancing, and swinging are non-locomotor skills. Stand up and try to balance on one foot — how long can you hold it?" },
      { id: 'slide_04', text: "Now let's talk about manipulative skills — using your hands and feet to control objects! Throwing, catching, kicking, and hitting a ball are all manipulative skills. These help you play sports and work as a team!" },
      { id: 'slide_05', text: "Balance is really important in everything we do. Good balance helps us run without falling, throw accurately, and even sit properly at our desk. Practice balancing every day and you will get better and better!" },
      { id: 'slide_06', text: "Coordination means making your body parts work together smoothly. When you catch a ball, your eyes, hands, and brain all work together in perfect timing. The more you practise, the better your coordination becomes!" },
      { id: 'slide_07', text: "You are a movement superstar! Today you learnt about locomotor, non-locomotor, and manipulative skills. Remember — practice every day, stay active, and your body will grow stronger and more skilful. Keep moving and keep shining!" },
    ],
  },
];

// ── ElevenLabs TTS ────────────────────────────────────────────────────────────
function generateAudio(text, outPath) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(outPath)) {
      process.stdout.write(`    ↩  skip (exists)\n`);
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
      headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    }, (res) => {
      if (res.statusCode !== 200) {
        let err = '';
        res.on('data', d => err += d);
        res.on('end', () => reject(new Error(`ElevenLabs ${res.statusCode}: ${err.slice(0,200)}`)));
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
  return parseFloat(execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`).toString().trim());
}

async function buildVideo(v) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎬  Building: ${v.id}`);
  console.log('='.repeat(60));

  fs.mkdirSync(v.audioDir, { recursive: true });
  fs.mkdirSync(v.tempDir,  { recursive: true });

  // Step 1: Generate per-scene audio
  console.log('🎙️  Generating per-scene audio...');
  const audioPaths = [];
  for (const scene of v.scenes) {
    const outPath = path.join(v.audioDir, `${scene.id}.mp3`);
    process.stdout.write(`  ${scene.id}... `);
    await generateAudio(scene.text, outPath);
    process.stdout.write('done\n');
    audioPaths.push(outPath);
  }

  // Step 2: Get exact durations
  console.log('⏱️  Measuring durations...');
  const durations = audioPaths.map(p => {
    const d = getAudioDuration(p);
    console.log(`  ${path.basename(p)}: ${d.toFixed(3)}s`);
    return d;
  });
  console.log(`  Total: ${durations.reduce((a,b)=>a+b,0).toFixed(2)}s`);

  // Step 3: Build video segments
  console.log('🎞️  Building segments...');
  const segFiles = [];
  for (let i = 0; i < v.images.length; i++) {
    const seg = path.join(v.tempDir, `seg_${i}.mp4`);
    const cmd = `ffmpeg -y -loop 1 -t ${durations[i]} -i "${v.images[i]}" -vf "scale=1024:-2,pad=1024:560:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -pix_fmt yuv420p -r 25 "${seg}"`;
    execSync(cmd, { stdio: 'ignore' });
    segFiles.push(seg);
  }

  // Step 4: Concat video
  console.log('🔗  Concatenating video...');
  const videoList = path.join(v.tempDir, 'video_list.txt');
  fs.writeFileSync(videoList, segFiles.map(f => `file '${path.resolve(f).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const noAudio = path.join(v.tempDir, 'no_audio.mp4');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${videoList}" -c copy "${noAudio}"`, { stdio: 'ignore' });

  // Step 5: Concat audio
  console.log('🎵  Concatenating audio...');
  const audioList = path.join(v.tempDir, 'audio_list.txt');
  fs.writeFileSync(audioList, audioPaths.map(f => `file '${path.resolve(f).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const fullAudio = path.join(v.tempDir, 'full_audio.mp3');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${audioList}" -c copy "${fullAudio}"`, { stdio: 'ignore' });

  // Step 6: Merge
  console.log('🎬  Merging...');
  execSync(`ffmpeg -y -i "${noAudio}" -i "${fullAudio}" -c:v copy -c:a aac -b:a 192k "${v.output}"`, { stdio: 'ignore' });

  const dur = getAudioDuration(v.output);
  console.log(`✅  ${v.id} done → ${dur.toFixed(1)}s`);
}

async function main() {
  if (!API_KEY) { console.error('❌ ELEVENLABS_API_KEY missing'); process.exit(1); }
  console.log('🚀  Rebuilding 4 videos with per-scene audio sync...\n');
  for (const v of VIDEOS) {
    await buildVideo(v);
  }
  console.log('\n\n🎉  All 4 videos rebuilt with perfect sync!');
  console.log('📤  Run upload-new-videos.js to push to Cloudinary.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
