/**
 * merge-video-audio.js
 * Merges a silent MP4 video with an ElevenLabs MP3 voiceover
 *
 * Usage:
 *   node merge-video-audio.js --topic=magnets
 *   node merge-video-audio.js --video=color_theory_silent.mp4 --audio=color_theory_voice.mp3
 *   node merge-video-audio.js --video=color_theory_silent.mp4 --audio=color_theory_voice.mp3 --out=color_theory_final.mp4
 *
 * Inputs (all from server/data/videos/):
 *   --topic   : shorthand — looks for {topic}_visual.mp4 + {topic}_voice.mp3
 *   --video   : explicit video filename (in server/data/videos/)
 *   --audio   : explicit audio filename (in server/data/videos/)
 *   --out     : output filename (default: {topic}_final.mp4)
 *   --pad     : if audio is shorter than video, pad with silence (default: true)
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const VIDEOS_DIR = path.join(__dirname, '../data/videos');

// Parse CLI args
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);

// Resolve filenames
const topic    = args.topic || null;
const videoArg = args.video || (topic ? `${topic}_visual.mp4` : null);
const audioArg = args.audio || (topic ? `${topic}_voice.mp3`  : null);
const outArg   = args.out   || (topic ? `${topic}_final.mp4`  : 'merged_final.mp4');

if (!videoArg || !audioArg) {
  console.error('Usage:');
  console.error('  node merge-video-audio.js --topic=magnets');
  console.error('  node merge-video-audio.js --video=my_video_silent.mp4 --audio=my_voice.mp3');
  process.exit(1);
}

const videoFile = path.join(VIDEOS_DIR, videoArg);
const audioFile = path.join(VIDEOS_DIR, audioArg);
const outFile   = path.join(VIDEOS_DIR, outArg);

// Validate inputs
if (!fs.existsSync(videoFile)) {
  console.error(`❌ Video not found: ${videoFile}`);
  console.error(`   Make sure the silent video exists. Generate it first with:`);
  console.error(`   node scripts/generate-visual-lesson.js --topic=${topic || 'magnets'}`);
  process.exit(1);
}
if (!fs.existsSync(audioFile)) {
  console.error(`❌ Audio not found: ${audioFile}`);
  console.error(`   Generate ElevenLabs voiceover first, or place MP3 at: ${audioFile}`);
  process.exit(1);
}

console.log(`\n🎬 Merging video + audio`);
console.log(`   Video : ${videoArg}`);
console.log(`   Audio : ${audioArg}`);
console.log(`   Output: ${outArg}\n`);

try {
  // Get video duration
  const videoDuration = parseFloat(
    execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoFile}"`,
      { encoding: 'utf8' }
    ).trim()
  );
  const audioDuration = parseFloat(
    execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioFile}"`,
      { encoding: 'utf8' }
    ).trim()
  );

  console.log(`   Video duration : ${videoDuration.toFixed(1)}s`);
  console.log(`   Audio duration : ${audioDuration.toFixed(1)}s`);

  let ffmpegCmd;

  if (audioDuration > videoDuration) {
    // Audio is longer → loop/extend video to match audio length
    console.log(`   ℹ️  Audio longer than video — extending video to match audio\n`);
    ffmpegCmd =
      `ffmpeg -y ` +
      `-stream_loop -1 -i "${videoFile}" ` +   // loop video
      `-i "${audioFile}" ` +
      `-c:v libx264 -c:a aac -b:a 192k ` +
      `-t ${audioDuration.toFixed(3)} ` +        // cut to audio length
      `-pix_fmt yuv420p "${outFile}"`;
  } else {
    // Video is longer or same → pad audio with silence at the end
    console.log(`   ℹ️  Video longer than audio — padding audio with silence\n`);
    ffmpegCmd =
      `ffmpeg -y ` +
      `-i "${videoFile}" ` +
      `-i "${audioFile}" ` +
      `-filter_complex "[1:a]apad[a]" ` +
      `-map 0:v -map "[a]" ` +
      `-c:v copy -c:a aac -b:a 192k ` +
      `-shortest "${outFile}"`;
  }

  execSync(ffmpegCmd, { stdio: 'inherit' });

  const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
  console.log(`\n✅ Final video saved: ${outFile} (${sizeMB} MB)`);
  console.log(`\n📱 Ready to use in the app!`);
  console.log(`   Place in: server/data/videos/${outArg}`);
  console.log(`   Reference in VideoPlayerScreen as topic slug: "${topic || outArg.replace('_final.mp4', '')}"`);

} catch (err) {
  console.error('\n❌ FFmpeg error:', err.message);
  console.error('   Make sure FFmpeg is installed: https://ffmpeg.org/download.html');
  process.exit(1);
}
