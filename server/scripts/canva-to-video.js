/**
 * canva-to-video.js
 * Converts a Canva HTML export into a silent MP4 video
 * Then merges with ElevenLabs voiceover MP3
 *
 * Usage:
 *   node canva-to-video.js --html "C:/path/to/canva_export.html" --out magnets --duration 5
 *
 * Steps:
 *   1. You export Canva design as "HTML" (Share → Download → HTML)
 *   2. Place the HTML file anywhere
 *   3. Run this script → produces silent MP4
 *   4. Add ElevenLabs MP3 → run with --merge flag
 */

const puppeteer  = require('puppeteer');
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const FPS        = 24;
const WIDTH      = 1280;
const HEIGHT     = 720;
const OUT_DIR    = path.join(__dirname, '../data/videos');
const FRAMES_DIR = path.join(__dirname, '../data/videos/_canva_frames');

// Parse CLI args
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);

const htmlFile      = args.html      || path.join(__dirname, '../../canva_living_nonliving.html');
const topicSlug     = args.out       || 'canva_video';
const secPerSlide   = parseFloat(args.duration || '5');   // seconds per slide
const voiceFile     = args.voice     || null;              // MP3 path for merge
const mergeOnly     = args.merge     === 'true';

// ── Helper: encode frames folder → mp4 segment ────────────────────────────────
function encodeFrames(framesDir, outFile) {
  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${path.join(framesDir, 'frame_%06d.png')}" ` +
    `-vf "scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black" ` +
    `-c:v libx264 -pix_fmt yuv420p -preset fast -crf 20 "${outFile}"`,
    { stdio: 'pipe' }
  );
}

// ── Merge silent video + audio ────────────────────────────────────────────────
function mergeAudio(videoFile, audioFile, outFile) {
  console.log(`\n🔊 Merging audio + video...`);
  // -shortest: stop when the shorter stream ends (in case audio is longer/shorter)
  execSync(
    `ffmpeg -y -i "${videoFile}" -i "${audioFile}" ` +
    `-c:v copy -c:a aac -b:a 192k -shortest "${outFile}"`,
    { stdio: 'pipe' }
  );
  console.log(`✅ Final video saved: ${outFile}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {

  const silentOut = path.join(OUT_DIR, `${topicSlug}_silent.mp4`);
  const finalOut  = path.join(OUT_DIR, `${topicSlug}_final.mp4`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // If --merge flag: just merge existing silent video with new audio
  if (mergeOnly && voiceFile) {
    mergeAudio(silentOut, voiceFile, finalOut);
    console.log(`\n📱 Video ready to use: ${finalOut}`);
    return;
  }

  // ── PHASE 1: Launch browser, load Canva HTML ──────────────────────────────
  if (!fs.existsSync(htmlFile)) {
    console.error(`❌ HTML file not found: ${htmlFile}`);
    console.error(`   Export your Canva design as HTML and place it at that path.`);
    process.exit(1);
  }

  console.log(`\n🎬 Converting Canva HTML → Video`);
  console.log(`   Source : ${htmlFile}`);
  console.log(`   Output : ${silentOut}`);
  console.log(`   ${secPerSlide}s per slide @ ${FPS}fps\n`);

  if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--allow-file-access-from-files',
      `--window-size=${WIDTH},${HEIGHT}`,
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  // Load the HTML file
  const fileUrl = `file:///${htmlFile.replace(/\\/g, '/')}`;
  console.log(`🌐 Loading: ${fileUrl}`);
  await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for Canva viewer to fully initialise (fonts, images, animations)
  await new Promise(r => setTimeout(r, 5000));

  // ── PHASE 2: Detect slide count ────────────────────────────────────────────
  // Canva HTML viewer uses arrow navigation or a slide counter
  let slideCount = 1;
  try {
    slideCount = await page.evaluate(() => {
      // Try common Canva viewer selectors for page count
      const counter = document.querySelector('[data-testid="page-count"]') ||
                      document.querySelector('.page-count') ||
                      document.querySelector('[aria-label*="of"]');
      if (counter) {
        const m = counter.textContent?.match(/(\d+)/g);
        if (m && m.length >= 2) return parseInt(m[1]);
      }
      // Fallback: count slide elements
      const slides = document.querySelectorAll(
        '[data-testid="page"], .page, [class*="Page_"], [class*="slide"]'
      );
      return slides.length || 1;
    });
  } catch {}

  console.log(`📄 Detected ${slideCount} slide(s)`);

  // ── PHASE 3: Capture each slide ────────────────────────────────────────────
  let globalFrame = 0;
  const framesPerSlide = Math.round(secPerSlide * FPS);

  for (let s = 0; s < slideCount; s++) {
    console.log(`\n📸 Slide ${s + 1}/${slideCount}`);

    // Navigate to this slide (press ArrowRight after first slide)
    if (s > 0) {
      await page.keyboard.press('ArrowRight');
      await new Promise(r => setTimeout(r, 600)); // wait for transition
    }

    // Capture frames for this slide
    for (let f = 0; f < framesPerSlide; f++) {
      const padded = String(globalFrame).padStart(6, '0');
      await page.screenshot({
        path: path.join(FRAMES_DIR, `frame_${padded}.png`),
        type: 'png',
      });
      globalFrame++;
      if (f % FPS === 0) process.stdout.write(`\r  Frame ${f}/${framesPerSlide}`);
    }
    console.log(`  ✅ Slide ${s + 1} captured (${framesPerSlide} frames)`);
  }

  await browser.close();

  // ── PHASE 4: Encode all frames → MP4 ──────────────────────────────────────
  console.log(`\n🎞️  Encoding ${globalFrame} frames → MP4...`);
  encodeFrames(FRAMES_DIR, silentOut);

  // Cleanup frames
  fs.rmSync(FRAMES_DIR, { recursive: true });

  const sizeMB = (fs.statSync(silentOut).size / 1024 / 1024).toFixed(1);
  console.log(`✅ Silent video ready: ${silentOut} (${sizeMB} MB)`);

  // ── PHASE 5: Merge with audio if provided ─────────────────────────────────
  if (voiceFile && fs.existsSync(voiceFile)) {
    mergeAudio(silentOut, voiceFile, finalOut);
    const finalMB = (fs.statSync(finalOut).size / 1024 / 1024).toFixed(1);
    console.log(`\n🎬 Final video: ${finalOut} (${finalMB} MB)`);
  } else {
    console.log(`\n📋 Next steps:`);
    console.log(`   1. Generate voiceover on ElevenLabs → download MP3`);
    console.log(`   2. Save MP3 as: server/data/videos/${topicSlug}_voice.mp3`);
    console.log(`   3. Run: node canva-to-video.js --out=${topicSlug} --merge=true --voice=server/data/videos/${topicSlug}_voice.mp3`);
  }
})();
