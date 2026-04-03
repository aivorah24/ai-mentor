/**
 * generate-color-theory-voice.js
 * Generates voiceover for color_theory_slides using ElevenLabs voice vGQNBgLaiM3EdZtxIiuY
 * Output: server/data/videos/color_theory_voice.mp3
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs   = require('fs');
const path = require('path');

const VOICE_ID = 'vGQNBgLaiM3EdZtxIiuY';
const OUT_FILE = path.join(__dirname, '../data/videos/color_theory_voice.mp3');

const SCRIPT = `Hey artists! Get ready — because today, we are diving into the MAGICAL world of COLOR THEORY!

First up — the PRIMARY colors! Red! Yellow! Blue! These three superstars make EVERY color in the universe!

Watch what happens when we MIX them! Red plus Yellow makes ORANGE! Blue plus Yellow makes GREEN! And Red plus Blue makes PURPLE! Woahhh!

Colors have feelings too! WARM colors like red, orange, and yellow feel energetic and happy! COOL colors like blue, green, and purple feel calm and peaceful!

All these colors live together on the COLOR WHEEL — spinning round and round in perfect harmony! Isn't that amazing?!

Quiz time! What do you get when you mix RED and BLUE? Think think think... It's PURPLE! Woohoo — you are a color genius! Great job today!`;

(async () => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('❌ ELEVENLABS_API_KEY not found in .env');
    process.exit(1);
  }

  console.log(`\n🎙️  Generating voiceover...`);
  console.log(`    Voice ID : ${VOICE_ID}`);
  console.log(`    Output   : ${OUT_FILE}\n`);

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: SCRIPT,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability: 0.22,
        similarity_boost: 0.80,
        style: 0.88,
        use_speaker_boost: true,
        speed: 1.05,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`❌ ElevenLabs error ${res.status}: ${body.slice(0, 300)}`);
    process.exit(1);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, buffer);

  const kb = (buffer.length / 1024).toFixed(1);
  console.log(`✅  Saved: ${OUT_FILE} (${kb} KB)`);
  console.log(`\n📋  Next step:`);
  console.log(`    node scripts/merge-video-audio.js --video=color_theory_silent.mp4 --audio=color_theory_voice.mp3`);
})();
