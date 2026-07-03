#!/usr/bin/env node
/**
 * Aivorah course-video builder.
 * Turns a storyboard (slide image + narration) into one polished MP4 using
 * ElevenLabs (narration) + ffmpeg (merge). Optionally uploads to Cloudinary.
 *
 * USAGE:
 *   node scripts/course-videos/build.js scripts/course-videos/sample.json
 *
 * STORYBOARD shape (JSON):
 * {
 *   "name": "chatgpt-worksheets",
 *   "voiceId": "JBFqnCBsd6RMkjVDRZzb",          // optional; defaults below
 *   "scenes": [
 *     { "image": "images/01-title.png", "narration": "Welcome to ..." },
 *     { "image": "images/02-step.png",  "narration": "First, ..." }
 *   ]
 * }
 *
 * Images: 1920x1080 PNG/JPG you generate in ChatGPT (see the prompt guide).
 * Paths in the storyboard are relative to the storyboard file's folder.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_VOICE = process.env.COURSE_VOICE_ID || process.env.EL_VOICE_GRANDFATHER || 'JBFqnCBsd6RMkjVDRZzb';
const MODEL = process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';

async function tts(text, voiceId, outPath) {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY missing in .env');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 160)}`);
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

function ff(args) { execFileSync('ffmpeg', ['-y', ...args], { stdio: 'inherit' }); }

(async () => {
  const sbPath = process.argv[2];
  if (!sbPath) { console.error('Usage: node build.js <storyboard.json>'); process.exit(1); }
  const sb = JSON.parse(fs.readFileSync(sbPath, 'utf8'));
  const baseDir = path.dirname(path.resolve(sbPath));
  const voiceId = sb.voiceId || DEFAULT_VOICE;
  const tmp = path.join(baseDir, 'out', `_tmp_${sb.name || 'course'}`);
  fs.mkdirSync(tmp, { recursive: true });

  const sceneFiles = [];
  for (let i = 0; i < sb.scenes.length; i++) {
    const s = sb.scenes[i];
    const n = String(i + 1).padStart(2, '0');
    const img = path.resolve(baseDir, s.image);
    if (!fs.existsSync(img)) throw new Error(`Missing image: ${img}`);
    const audio = path.join(tmp, `${n}.mp3`);
    const clip = path.join(tmp, `${n}.mp4`);

    console.log(`\n[scene ${n}] narration -> ElevenLabs`);
    await tts(s.narration, voiceId, audio);

    console.log(`[scene ${n}] merging image + audio`);
    // Scale/pad to 1080p, gentle slow zoom (Ken Burns), end when narration ends.
    ff([
      '-loop', '1', '-i', img,
      '-i', audio,
      '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-vf', "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fade=t=in:st=0:d=0.4",
      '-shortest', clip,
    ]);
    sceneFiles.push(clip);
  }

  // Concatenate all scene clips into the final video.
  const listFile = path.join(tmp, 'list.txt');
  fs.writeFileSync(listFile, sceneFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
  const outFile = path.join(baseDir, 'out', `${sb.name || 'course'}.mp4`);
  console.log(`\n[concat] -> ${outFile}`);
  ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outFile]);

  console.log(`\n✅ Done: ${outFile}`);

  // Optional Cloudinary upload — prints the hosted URL to paste into teacherCourses.ts
  if (process.env.CLOUDINARY_CLOUD_NAME && process.argv.includes('--upload')) {
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    console.log('\n[upload] Cloudinary…');
    const up = await cloudinary.uploader.upload(outFile, {
      resource_type: 'video', folder: 'aivorah/teacher-courses', public_id: sb.name,
    });
    console.log(`\n🎬 Hosted video URL (put this in teacherCourses.ts videoUrl):\n${up.secure_url}`);
  }
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });
