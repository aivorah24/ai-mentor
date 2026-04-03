/**
 * generate-visual-lesson.js
 * Creates a Canva-quality animated visual video (silent MP4)
 * Ready to merge with ElevenLabs voiceover via FFmpeg
 *
 * Usage: node generate-visual-lesson.js --topic magnets
 */

const puppeteer = require('puppeteer');
const { execSync, spawn }  = require('child_process');
const fs   = require('fs');
const path = require('path');

const OUT_DIR    = path.join(__dirname, '../data/videos');
const FRAMES_DIR = path.join(__dirname, '../data/videos/_frames');
const FPS        = 30;

// ─── Scene definitions for each topic ─────────────────────────────────────────
const TOPICS = {

  magnets: {
    title: 'Magnets',
    accent: '#e74c3c',
    scenes: [
      {
        bg: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        duration: 5,
        keyword: 'MAGNETS!',
        subtext: 'A Secret Superpower',
        illustration: `
          <g transform="translate(320,200)">
            <!-- Horseshoe magnet -->
            <path d="M-80,80 L-80,-60 Q-80,-120 0,-120 Q80,-120 80,-60 L80,80 L50,80 L50,-55 Q50,-90 0,-90 Q-50,-90 -50,-55 L-50,80 Z"
              fill="none" stroke="#e74c3c" stroke-width="28" stroke-linecap="round"/>
            <rect x="-95" y="60" width="45" height="40" rx="6" fill="#e74c3c"/>
            <rect x="50" y="60" width="45" height="40" rx="6" fill="#3498db"/>
            <text x="-72" y="88" fill="white" font-size="14" font-weight="bold" text-anchor="middle">N</text>
            <text x="72" y="88" fill="white" font-size="14" font-weight="bold" text-anchor="middle">S</text>
            <!-- Sparkles -->
            <circle cx="-120" cy="-80" r="6" fill="#f1c40f" opacity="0.9">
              <animate attributeName="r" values="6;12;6" dur="1.2s" repeatCount="indefinite"/>
              <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.2s" repeatCount="indefinite"/>
            </circle>
            <circle cx="130" cy="-100" r="8" fill="#f1c40f" opacity="0.8">
              <animate attributeName="r" values="8;14;8" dur="0.9s" repeatCount="indefinite"/>
              <animate attributeName="opacity" values="0.8;0.2;0.8" dur="0.9s" repeatCount="indefinite"/>
            </circle>
            <circle cx="0" cy="-160" r="5" fill="#2ecc71" opacity="0.9">
              <animate attributeName="r" values="5;10;5" dur="1.4s" repeatCount="indefinite"/>
            </circle>
            <circle cx="-150" cy="20" r="7" fill="#9b59b6" opacity="0.7">
              <animate attributeName="r" values="7;13;7" dur="1.1s" repeatCount="indefinite"/>
            </circle>
            <!-- Magnet pulse ring -->
            <circle cx="0" cy="-30" r="50" fill="none" stroke="#e74c3c" stroke-width="2" opacity="0.6">
              <animate attributeName="r" values="50;130;50" dur="2s" repeatCount="indefinite"/>
              <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite"/>
            </circle>
          </g>`,
      },
      {
        bg: 'linear-gradient(135deg, #0d0d1a 0%, #1a0533 50%, #2d1b69 100%)',
        duration: 6,
        keyword: 'INVISIBLE FORCE',
        subtext: 'Magnetic Field',
        illustration: `
          <g transform="translate(320,210)">
            <!-- Central magnet bar -->
            <rect x="-15" y="-100" width="30" height="200" rx="8" fill="#6c3483"/>
            <rect x="-15" y="-100" width="30" height="100" rx="8" fill="#e74c3c"/>
            <text x="0" y="-55" fill="white" font-size="16" font-weight="bold" text-anchor="middle">N</text>
            <text x="0" y="88" fill="white" font-size="16" font-weight="bold" text-anchor="middle">S</text>
            <!-- Field lines emanating -->
            ${[0,40,80,120,160,200,240,300].map((angle, i) => `
              <path d="M0,-105 Q${120*Math.cos(angle*Math.PI/180-Math.PI/2)},${120*Math.sin(angle*Math.PI/180-Math.PI/2)} ${180*Math.cos(angle*Math.PI/180-Math.PI/2+0.3)},${180*Math.sin(angle*Math.PI/180-Math.PI/2+0.3)}"
                fill="none" stroke="#8e44ad" stroke-width="2" opacity="0.7" stroke-dasharray="8,4">
                <animate attributeName="opacity" values="0.2;0.9;0.2" dur="${1.5+i*0.2}s" repeatCount="indefinite"/>
              </path>`).join('')}
            <!-- Glowing dots on field lines -->
            ${[60,120,180,240].map((r, i) => `
              <circle cx="${r*0.4}" cy="${-r*0.7}" r="5" fill="#a855f7" opacity="0.8">
                <animateMotion dur="${2+i*0.3}s" repeatCount="indefinite"
                  path="M0,0 Q${r*0.5},${-r*0.3} ${r},0 Q${r*0.5},${r*0.3} 0,0"/>
              </circle>`).join('')}
          </g>`,
      },
      {
        bg: 'linear-gradient(135deg, #1a2a1a 0%, #0d3b0d 50%, #145214 100%)',
        duration: 6,
        keyword: 'NORTH + SOUTH',
        subtext: 'Opposites Attract!',
        illustration: `
          <g>
            <!-- Left magnet (North) moving right -->
            <g>
              <animateTransform attributeName="transform" type="translate"
                values="-50,0; 30,0; 30,0" dur="3s" repeatCount="indefinite" calcMode="spline"
                keySplines="0.4 0 0.2 1; 0 0 0 0"/>
              <rect x="60" y="185" width="120" height="50" rx="12" fill="#e74c3c"/>
              <text x="120" y="218" fill="white" font-size="22" font-weight="900" text-anchor="middle">N</text>
              <text x="140" y="190" fill="#ff6b6b" font-size="11" font-weight="600">NORTH</text>
            </g>
            <!-- Right magnet (South) moving left -->
            <g>
              <animateTransform attributeName="transform" type="translate"
                values="50,0; -30,0; -30,0" dur="3s" repeatCount="indefinite" calcMode="spline"
                keySplines="0.4 0 0.2 1; 0 0 0 0"/>
              <rect x="460" y="185" width="120" height="50" rx="12" fill="#3498db"/>
              <text x="520" y="218" fill="white" font-size="22" font-weight="900" text-anchor="middle">S</text>
              <text x="470" y="190" fill="#74b9ff" font-size="11" font-weight="600">SOUTH</text>
            </g>
            <!-- Attraction sparks in middle -->
            <circle cx="320" cy="210" r="8" fill="#f1c40f">
              <animate attributeName="r" values="4;18;4" dur="0.6s" repeatCount="indefinite"/>
              <animate attributeName="opacity" values="0;1;0" dur="0.6s" repeatCount="indefinite"/>
            </circle>
            <text x="320" y="155" fill="#2ecc71" font-size="36" text-anchor="middle" font-weight="900">
              SNAP!
              <animate attributeName="opacity" values="0;0;1;1;0" dur="3s" repeatCount="indefinite"/>
            </text>
          </g>`,
      },
      {
        bg: 'linear-gradient(135deg, #1a1500 0%, #3d3000 50%, #5c4700 100%)',
        duration: 6,
        keyword: 'SAME POLES',
        subtext: 'They Push Away!',
        illustration: `
          <g>
            <!-- Left magnet (North) bouncing away -->
            <g>
              <animateTransform attributeName="transform" type="translate"
                values="0,0; -60,0; 0,0" dur="2s" repeatCount="indefinite" calcMode="spline"
                keySplines="0.4 0 0.6 1; 0.4 0 0.6 1"/>
              <rect x="80" y="185" width="120" height="50" rx="12" fill="#e74c3c"/>
              <text x="140" y="218" fill="white" font-size="22" font-weight="900" text-anchor="middle">N</text>
            </g>
            <!-- Right magnet (North) bouncing away -->
            <g>
              <animateTransform attributeName="transform" type="translate"
                values="0,0; 60,0; 0,0" dur="2s" repeatCount="indefinite" calcMode="spline"
                keySplines="0.4 0 0.6 1; 0.4 0 0.6 1"/>
              <rect x="440" y="185" width="120" height="50" rx="12" fill="#e74c3c"/>
              <text x="500" y="218" fill="white" font-size="22" font-weight="900" text-anchor="middle">N</text>
            </g>
            <!-- Repulsion force lines -->
            ${[-30,-15,0,15,30].map((y,i) => `
              <line x1="220" y1="${210+y}" x2="420" y2="${210+y}"
                stroke="#f39c12" stroke-width="3" stroke-dasharray="10,6" opacity="0.8">
                <animate attributeName="stroke-dashoffset" values="0;-32" dur="0.6s" repeatCount="indefinite"/>
              </line>`).join('')}
            <text x="320" y="155" fill="#f39c12" font-size="30" text-anchor="middle" font-weight="900">NO NO NO!</text>
          </g>`,
      },
      {
        bg: 'linear-gradient(135deg, #001a2e 0%, #003366 50%, #004d99 100%)',
        duration: 6,
        keyword: 'WHAT STICKS?',
        subtext: 'Iron & Steel = YES!',
        illustration: `
          <g transform="translate(320,200)">
            <!-- Central magnet -->
            <rect x="-15" y="-30" width="30" height="80" rx="8" fill="#c0392b"/>
            <text x="0" y="0" fill="white" font-size="14" font-weight="bold" text-anchor="middle">N</text>
            <text x="0" y="42" fill="white" font-size="14" font-weight="bold" text-anchor="middle">S</text>
            <!-- Paper clips flying in -->
            ${[[-160,-60],[-140,40],[-170,130]].map(([x,y],i) => `
              <g>
                <animateTransform attributeName="transform" type="translate"
                  values="${x},${y}; -20,20; -20,20" dur="${2+i*0.4}s" repeatCount="indefinite"
                  calcMode="spline" keySplines="0.4 0 0.2 1; 0 0 0 0"/>
                <ellipse cx="0" cy="0" rx="18" ry="8" fill="none" stroke="#bdc3c7" stroke-width="3"/>
                <ellipse cx="0" cy="-6" rx="12" ry="5" fill="none" stroke="#bdc3c7" stroke-width="3"/>
              </g>`).join('')}
            <!-- Plastic bottle staying away -->
            <g transform="translate(160,30)">
              <rect x="-15" y="-40" width="30" height="70" rx="10" fill="#74b9ff" opacity="0.8"/>
              <rect x="-10" y="-55" width="20" height="18" rx="5" fill="#0984e3"/>
              <text x="0" y="60" fill="#74b9ff" font-size="11" text-anchor="middle">PLASTIC</text>
              <text x="0" y="75" fill="#e74c3c" font-size="18" text-anchor="middle" font-weight="900">✗</text>
            </g>
            <!-- YES label -->
            <text x="-80" y="-80" fill="#2ecc71" font-size="28" font-weight="900">✓ YES!</text>
          </g>`,
      },
      {
        bg: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #2d2d6b 100%)',
        duration: 6,
        keyword: 'IN REAL LIFE',
        subtext: 'Magnets Everywhere!',
        illustration: `
          <g>
            <!-- Fridge -->
            <rect x="60" y="130" width="100" height="150" rx="10" fill="#ecf0f1" stroke="#bdc3c7" stroke-width="3"/>
            <rect x="65" y="135" width="90" height="65" rx="6" fill="#dfe6e9"/>
            <rect x="65" y="207" width="90" height="66" rx="6" fill="#b2bec3"/>
            <circle cx="148" cy="173" r="5" fill="#7f8c8d"/>
            <circle cx="148" cy="240" r="5" fill="#7f8c8d"/>
            <text x="110" y="290" fill="#95a5a6" font-size="11" text-anchor="middle">FRIDGE</text>
            <!-- Speaker -->
            <circle cx="320" cy="210" r="65" fill="#2c3e50" stroke="#34495e" stroke-width="4"/>
            <circle cx="320" cy="210" r="45" fill="#34495e"/>
            <circle cx="320" cy="210" r="20" fill="#2c3e50"/>
            <circle cx="320" cy="210" r="8" fill="#7f8c8d"/>
            <text x="320" y="290" fill="#95a5a6" font-size="11" text-anchor="middle">SPEAKER</text>
            <!-- Compass -->
            <circle cx="530" cy="210" r="60" fill="#ecf0f1" stroke="#bdc3c7" stroke-width="4"/>
            <circle cx="530" cy="210" r="50" fill="#dfe6e9"/>
            <polygon points="530,160 520,210 530,215 540,210" fill="#e74c3c">
              <animateTransform attributeName="transform" type="rotate"
                values="0,530,210; 20,530,210; -10,530,210; 0,530,210" dur="3s" repeatCount="indefinite"/>
            </polygon>
            <polygon points="530,260 520,210 530,205 540,210" fill="#2c3e50">
              <animateTransform attributeName="transform" type="rotate"
                values="0,530,210; 20,530,210; -10,530,210; 0,530,210" dur="3s" repeatCount="indefinite"/>
            </polygon>
            <text x="530" y="290" fill="#95a5a6" font-size="11" text-anchor="middle">COMPASS</text>
            <!-- Glow dots -->
            <circle cx="110" cy="175" r="5" fill="#f1c40f">
              <animate attributeName="opacity" values="1;0.2;1" dur="1.5s" repeatCount="indefinite"/>
            </circle>
            <circle cx="320" cy="210" r="6" fill="#3498db">
              <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite"/>
            </circle>
          </g>`,
      },
      {
        bg: 'linear-gradient(135deg, #0d1f0d 0%, #1a3d1a 50%, #2d6b2d 100%)',
        duration: 6,
        keyword: 'QUIZ TIME!',
        subtext: 'Are you a Magnet Master?',
        illustration: `
          <g transform="translate(320,200)">
            <!-- Big question mark -->
            <text x="0" y="40" fill="#f1c40f" font-size="140" text-anchor="middle" font-weight="900"
              font-family="Arial Black">?
              <animate attributeName="font-size" values="140;160;140" dur="1s" repeatCount="indefinite"/>
              <animate attributeName="fill" values="#f1c40f;#e67e22;#f1c40f" dur="1s" repeatCount="indefinite"/>
            </text>
            <!-- Stars -->
            ${[[-180,-60],[180,-80],[-160,80],[160,60],[-40,-120],[40,-100]].map(([x,y],i) => `
              <text x="${x}" y="${y}" fill="#f1c40f" font-size="${18+i*3}" text-anchor="middle"
                opacity="0.9">★
                <animate attributeName="opacity" values="0.9;0.2;0.9" dur="${0.8+i*0.2}s" repeatCount="indefinite"/>
                <animate attributeName="font-size" values="${18+i*3};${26+i*3};${18+i*3}" dur="${0.8+i*0.2}s" repeatCount="indefinite"/>
              </text>`).join('')}
          </g>`,
      },
    ],
  },

  addition: {
    title: 'Addition & Subtraction',
    accent: '#3498db',
    scenes: [
      {
        bg: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        duration: 5,
        keyword: 'ADDITION!',
        subtext: 'Putting Numbers Together',
        illustration: `
          <g transform="translate(320,200)">
            <text x="-100" y="30" fill="#3498db" font-size="90" text-anchor="middle" font-weight="900">3</text>
            <text x="0" y="30" fill="#f1c40f" font-size="70" text-anchor="middle" font-weight="900">+</text>
            <text x="100" y="30" fill="#2ecc71" font-size="90" text-anchor="middle" font-weight="900">4</text>
            <text x="0" y="100" fill="white" font-size="50" text-anchor="middle" font-weight="900">= 7</text>
            ${[-2,-1,0,1,2,3,4].map((n,i) => `
              <circle cx="${-160+i*50}" cy="160" r="18" fill="#3498db" opacity="0.8">
                <animate attributeName="r" values="18;24;18" dur="${0.8+i*0.1}s" repeatCount="indefinite"/>
              </circle>`).join('')}
          </g>`,
      },
      {
        bg: 'linear-gradient(135deg, #0d1f0d 0%, #1a3d1a 50%, #2d6b2d 100%)',
        duration: 6,
        keyword: 'CARRYING OVER',
        subtext: 'When digits overflow!',
        illustration: `
          <g transform="translate(320,180)">
            <text x="60" y="-20" fill="#f1c40f" font-size="32" text-anchor="middle" font-weight="900">1</text>
            <text x="-60" y="40" fill="white" font-size="72" text-anchor="right" font-weight="900">8</text>
            <text x="60" y="40" fill="white" font-size="72" text-anchor="middle" font-weight="900">7</text>
            <text x="-10" y="90" fill="#f1c40f" font-size="40" text-anchor="middle">+</text>
            <text x="-60" y="130" fill="white" font-size="72" text-anchor="right" font-weight="900">4</text>
            <text x="60" y="130" fill="white" font-size="72" text-anchor="middle" font-weight="900">5</text>
            <line x1="-120" y1="148" x2="130" y2="148" stroke="white" stroke-width="3"/>
            <text x="-60" y="195" fill="#2ecc71" font-size="72" text-anchor="right" font-weight="900">1</text>
            <text x="60" y="195" fill="#2ecc71" font-size="72" text-anchor="middle" font-weight="900">3 2</text>
          </g>`,
      },
    ],
  },
};

// ─── HTML template for a scene ────────────────────────────────────────────────
function buildSceneHTML(scene, accent) {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1280px; height:720px; overflow:hidden;
    background: ${scene.bg};
    font-family: 'Arial Black', 'Arial', sans-serif;
    display:flex; flex-direction:column;
    align-items:center; justify-content:center;
    animation: fadeIn 0.5s ease;
  }
  @keyframes fadeIn { from {opacity:0; transform:scale(0.97)} to {opacity:1; transform:scale(1)} }

  .visual-area {
    width:640px; height:440px;
    display:flex; align-items:center; justify-content:center;
    position:relative;
  }
  svg.main-svg {
    width:640px; height:440px;
    overflow:visible;
  }
  .keyword {
    font-size:68px; font-weight:900;
    color:white;
    text-align:center;
    letter-spacing:3px;
    text-shadow: 0 0 30px ${accent}aa, 0 4px 12px rgba(0,0,0,0.6);
    animation: popIn 0.6s cubic-bezier(0.34,1.56,0.64,1);
    line-height:1;
  }
  .subtext {
    font-size:24px; font-weight:700;
    color:${accent};
    text-align:center;
    letter-spacing:1px;
    margin-top:8px;
    animation: slideUp 0.6s ease 0.2s both;
    text-transform:uppercase;
  }
  @keyframes popIn {
    from { transform:scale(0.5); opacity:0; }
    to   { transform:scale(1);   opacity:1; }
  }
  @keyframes slideUp {
    from { transform:translateY(20px); opacity:0; }
    to   { transform:translateY(0);    opacity:1; }
  }
  .bottom-bar {
    position:absolute; bottom:0; left:0; right:0;
    height:6px;
    background: linear-gradient(90deg, transparent, ${accent}, transparent);
    animation: barGrow 1s ease;
  }
  @keyframes barGrow { from{transform:scaleX(0)} to{transform:scaleX(1)} }
  .top-logo {
    position:absolute; top:24px; left:36px;
    font-size:14px; font-weight:700; color:${accent};
    letter-spacing:2px; opacity:0.7; text-transform:uppercase;
  }
</style>
</head>
<body>
  <div class="top-logo">AIVORAH · GRADE 3</div>

  <div class="visual-area">
    <svg class="main-svg" viewBox="0 0 640 440">
      ${scene.illustration}
    </svg>
  </div>

  <div class="keyword">${scene.keyword}</div>
  <div class="subtext">${scene.subtext}</div>

  <div class="bottom-bar"></div>
</body>
</html>`;
}

// ─── Record a single scene ────────────────────────────────────────────────────
async function recordScene(page, html, duration, sceneDir) {
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 300));

  const totalFrames = duration * FPS;
  for (let f = 0; f < totalFrames; f++) {
    const padded = String(f).padStart(6, '0');
    await page.screenshot({ path: path.join(sceneDir, `frame_${padded}.png`), type: 'png' });
    // Advance time by 1 frame
    await page.evaluate(ms => { /* time passes */ }, 1000 / FPS);
    if (f % 30 === 0) process.stdout.write(`\r  Frame ${f}/${totalFrames}`);
  }
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const topicArg = process.argv.find(a => a.startsWith('--topic='))?.split('=')[1] || 'magnets';
  const config   = TOPICS[topicArg];
  if (!config) {
    console.error(`Unknown topic: ${topicArg}. Available: ${Object.keys(TOPICS).join(', ')}`);
    process.exit(1);
  }

  const outFile = path.join(OUT_DIR, `${topicArg}_visual.mp4`);
  console.log(`\n🎬 Generating visual video: ${config.title}`);
  console.log(`   Scenes: ${config.scenes.length} | Output: ${outFile}\n`);

  // Clean frames dir
  if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

  const segmentFiles = [];

  for (let i = 0; i < config.scenes.length; i++) {
    const scene = config.scenes[i];
    console.log(`📸 Scene ${i + 1}/${config.scenes.length}: "${scene.keyword}" (${scene.duration}s)`);

    const sceneDir = path.join(FRAMES_DIR, `scene_${i}`);
    fs.mkdirSync(sceneDir, { recursive: true });

    const html = buildSceneHTML(scene, config.accent);
    await recordScene(page, html, scene.duration, sceneDir);

    // Encode scene to mp4
    const segFile = path.join(FRAMES_DIR, `seg_${i}.mp4`);
    execSync(
      `ffmpeg -y -framerate ${FPS} -i "${path.join(sceneDir, 'frame_%06d.png')}" ` +
      `-vf "scale=1280:720" -c:v libx264 -pix_fmt yuv420p -preset fast "${segFile}"`,
      { stdio: 'pipe' }
    );
    segmentFiles.push(segFile);
    console.log(`  ✅ Scene ${i + 1} encoded`);
  }

  await browser.close();

  // Concatenate all segments
  console.log('\n🔗 Concatenating scenes...');
  const listFile = path.join(FRAMES_DIR, 'concat.txt');
  fs.writeFileSync(listFile, segmentFiles.map(f => `file '${f}'`).join('\n'));
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${outFile}"`,
    { stdio: 'pipe' }
  );

  // Cleanup frames
  fs.rmSync(FRAMES_DIR, { recursive: true });

  const size = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
  console.log(`\n✅ Done! Visual video saved: ${outFile} (${size} MB)`);
  console.log(`\nNext step:`);
  console.log(`  1. Generate voiceover MP3 from ElevenLabs`);
  console.log(`  2. Place it at: server/data/videos/${topicArg}_voice.mp3`);
  console.log(`  3. Run: node merge-audio-video.js --topic=${topicArg}`);
})();
