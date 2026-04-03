/**
 * render-slides-video.js
 * Screenshots each slide once → FFmpeg makes each image show for N seconds → MP4
 * Much faster and more reliable than frame-by-frame capture.
 *
 * Usage: node render-slides-video.js --html=path/to/slides.html --out=color_theory --duration=5
 */

const puppeteer    = require('puppeteer');
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const WIDTH      = 1280;
const HEIGHT     = 720;
const OUT_DIR    = path.join(__dirname, '../data/videos');
const SHOTS_DIR  = path.join(__dirname, '../data/videos/_shots_tmp');

const args = Object.fromEntries(
  process.argv.slice(2).filter(a=>a.startsWith('--'))
    .map(a=>{ const [k,...v]=a.slice(2).split('='); return [k,v.join('=')]; })
);

const htmlFile    = args.html     || path.join(__dirname, '../data/videos/color_theory_slides.html');
const outSlug     = args.out      || 'color_theory';
const secPerSlide = parseFloat(args.duration || '5');
const silentOut   = path.join(OUT_DIR, `${outSlug}_silent.mp4`);

(async () => {
  if (!fs.existsSync(htmlFile)) {
    console.error(`❌ Not found: ${htmlFile}`); process.exit(1);
  }

  console.log(`\n🎬  Rendering: ${path.basename(htmlFile)}`);
  console.log(`    ${secPerSlide}s per slide → ${silentOut}\n`);

  if (fs.existsSync(SHOTS_DIR)) fs.rmSync(SHOTS_DIR, {recursive:true});
  fs.mkdirSync(SHOTS_DIR, {recursive:true});
  fs.mkdirSync(OUT_DIR, {recursive:true});

  // ── Launch Puppeteer ──────────────────────────────────────────────────
  const browser = await puppeteer.launch({
    headless: 'new',
    protocolTimeout: 300000,
    args: ['--no-sandbox','--disable-setuid-sandbox',`--window-size=${WIDTH},${HEIGHT}`],
  });
  const page = await browser.newPage();
  await page.setViewport({width:WIDTH, height:HEIGHT, deviceScaleFactor:1});

  const fileUrl = 'file:///' + htmlFile.replace(/\\/g,'/');
  await page.goto(fileUrl, {waitUntil:'domcontentloaded', timeout:15000});
  await new Promise(r=>setTimeout(r, 2000)); // let CSS settle

  const slideCount = await page.evaluate(() => window.getSlideCount?.() || 6);
  console.log(`📄  ${slideCount} slides\n`);

  const shotPaths = [];

  for (let s = 0; s < slideCount; s++) {
    // Show slide s
    await page.evaluate((idx) => window.goToSlide?.(idx), s);
    await new Promise(r=>setTimeout(r, 1500)); // wait for CSS transition + paint

    const shotFile = path.join(SHOTS_DIR, `slide_${String(s).padStart(3,'0')}.png`);
    await page.screenshot({path: shotFile, type:'png', timeout: 30000});
    shotPaths.push(shotFile);
    console.log(`  ✅ Slide ${s+1}/${slideCount} captured`);
  }

  await browser.close();
  console.log(`\n🎞️  Building video (${secPerSlide}s per slide)...`);

  // ── Build concat list for FFmpeg ──────────────────────────────────────
  // Each image shown for secPerSlide seconds
  const concatFile = path.join(SHOTS_DIR, 'concat.txt');
  const concatContent = shotPaths.map(p =>
    `file '${p}'\nduration ${secPerSlide}`
  ).join('\n') + `\nfile '${shotPaths[shotPaths.length-1]}'`; // last frame required by concat
  fs.writeFileSync(concatFile, concatContent);

  // Encode: concat demuxer → H.264 MP4
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatFile}" ` +
    `-vf "scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,` +
    `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,fps=24" ` +
    `-c:v libx264 -pix_fmt yuv420p -preset fast -crf 20 "${silentOut}"`,
    {stdio:'pipe'}
  );

  fs.rmSync(SHOTS_DIR, {recursive:true});

  const mb = (fs.statSync(silentOut).size/1024/1024).toFixed(1);
  const totalSec = slideCount * secPerSlide;
  console.log(`\n✅  Done! ${totalSec}s video → ${silentOut} (${mb} MB)`);
  console.log(`\n📋  Next steps:`);
  console.log(`    1. Open: ${htmlFile.replace(/\\/g,'/')}`);
  console.log(`       Preview it in browser to review the design`);
  console.log(`    2. Generate ElevenLabs voiceover MP3`);
  console.log(`    3. Run: node merge-video-audio.js --video=${outSlug}_silent.mp4 --audio=voice.mp3`);
})();
