/**
 * video-physical-ed-motor-skills.js
 * IB PYP Grade 3 — Physical Education: Fundamental Motor Skills
 *
 * All-in-one script:
 *   --visual-only  : Generate silent MP4 only (free — Puppeteer + FFmpeg)
 *   --voice-only   : Generate ElevenLabs voiceover MP3 only (costs credits)
 *   --merge-only   : Merge existing silent MP4 + MP3 → final MP4 (free)
 *   (no flag)      : Run all three steps end-to-end
 *
 * Output files (server/data/videos/):
 *   motor_skills_visual.mp4  — silent animated video
 *   motor_skills_voice.mp3   — ElevenLabs voiceover (stored permanently)
 *   motor_skills_final.mp4   — final video with audio
 *
 * Credits strategy: ONE ElevenLabs call, eleven_turbo_v2_5 (cheapest model)
 * Voice ID: vGQNBgLaiM3EdZtxIiuY
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const puppeteer    = require('puppeteer');
const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');

// ── Config ───────────────────────────────────────────────────────────────────
const FPS        = 24;
const WIDTH      = 1280;
const HEIGHT     = 720;
const VOICE_ID   = 'vGQNBgLaiM3EdZtxIiuY';
const TOPIC_SLUG = 'motor_skills';
const VIDEOS_DIR = path.join(__dirname, '../data/videos');
const FRAMES_DIR = path.join(VIDEOS_DIR, '_motor_frames');

const VISUAL_OUT = path.join(VIDEOS_DIR, `${TOPIC_SLUG}_visual.mp4`);
const VOICE_OUT  = path.join(VIDEOS_DIR, `${TOPIC_SLUG}_voice.mp3`);
const FINAL_OUT  = path.join(VIDEOS_DIR, `${TOPIC_SLUG}_final.mp4`);

// ── CLI flags ─────────────────────────────────────────────────────────────────
const VISUAL_ONLY = process.argv.includes('--visual-only');
const VOICE_ONLY  = process.argv.includes('--voice-only');
const MERGE_ONLY  = process.argv.includes('--merge-only');
const RUN_ALL     = !VISUAL_ONLY && !VOICE_ONLY && !MERGE_ONLY;

// ── Voiceover Script (~65 seconds, Grade 3 level, high energy) ───────────────
const VOICEOVER_SCRIPT = `Hey there Grade 3 superstars! Are you ready to MOVE? Today we are exploring one of the coolest subjects ever — Physical Education — and we are going to unlock the secrets of FUNDAMENTAL MOTOR SKILLS!

Your body is an incredible machine. And motor skills are the amazing things it can do. There are THREE types — let's learn them all!

Type ONE — LOCOMOTOR SKILLS! These are movements where YOU travel from one place to another.

Running! Zoom zoom zoom — your fastest speed!
Skipping! Step and HOP, step and HOP — one two three!
Hopping! Jump on ONE foot — can you balance?
And Galloping! Like a horse — clip clop clip clop!

You use locomotor skills every single day — on the playground, in sports, and everywhere you go!

Type TWO — NON-LOCOMOTOR SKILLS! These happen when you STAY in one spot but your body is still moving!

Balancing! Stand tall like a mighty tree — arms wide, one foot up!
Stretching! Reach UP as high as you can — feel that stretch!
And Twisting! Turn your body like a pretzel — left, right, left!

These skills help you stay in control of your body. Yoga, gymnastics, and dance all use non-locomotor skills!

Type THREE — MANIPULATIVE SKILLS! These are when you use your hands and feet to control an OBJECT!

Throwing! Wind up, aim, and RELEASE — great shot!
Catching! Eyes on the ball, hands ready — GOT IT!
And Kicking! One step back, and KICK — goal!

Cricket, football, basketball — all use manipulative skills!

Now remember — when you practise ALL THREE types of motor skills, your brain and body grow stronger together. You become faster, more coordinated, and more confident!

Quiz time! Is BALANCING a locomotor skill or a non-locomotor skill? Think carefully...

It is NON-LOCOMOTOR — because you stay in one place! Brilliant!

Keep moving, keep practising, and remember — every great athlete started exactly where YOU are today. You are amazing — now go out there and MOVE!`;

// ── Scene definitions ─────────────────────────────────────────────────────────
const SCENES = [
  {
    duration: 5,
    html: `
    <!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body {
        width:1280px; height:720px; overflow:hidden;
        background: linear-gradient(135deg, #0a1628 0%, #1a2d4a 50%, #0d2137 100%);
        font-family: 'Arial Black', Arial, sans-serif;
        display:flex; flex-direction:column; align-items:center; justify-content:center;
      }
      .badge { background: rgba(95,138,134,0.2); border: 1px solid #5F8A86; border-radius: 999px;
        padding: 6px 20px; color: #7AADA8; font-size:14px; font-weight:700; letter-spacing:2px;
        text-transform:uppercase; margin-bottom:20px; }
      .title { font-size:72px; font-weight:900; color:white; text-align:center; line-height:1.1;
        text-shadow: 0 0 40px rgba(95,138,134,0.6);
        animation: popIn 0.8s cubic-bezier(0.34,1.56,0.64,1); }
      .subtitle { font-size:26px; color:#7AADA8; margin-top:16px; letter-spacing:2px; text-transform:uppercase;
        animation: slideUp 0.6s ease 0.3s both; }
      .body-icon { width:120px; height:120px; margin-bottom:24px;
        animation: bounce 1.5s ease-in-out infinite; }
      @keyframes popIn { from{transform:scale(0.5);opacity:0} to{transform:scale(1);opacity:1} }
      @keyframes slideUp { from{transform:translateY(30px);opacity:0} to{transform:translateY(0);opacity:1} }
      @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-16px)} }
      .bottom-bar { position:absolute; bottom:0; left:0; right:0; height:6px;
        background: linear-gradient(90deg, #5F8A86, #7AADA8, #5A8A70); }
      .top-logo { position:absolute; top:24px; left:36px; font-size:13px; font-weight:700;
        color:#5F8A86; letter-spacing:2px; opacity:0.8; text-transform:uppercase; }
    </style></head><body>
      <div class="top-logo">AIVORAH · IB PYP · GRADE 3</div>
      <svg class="body-icon" viewBox="0 0 120 120">
        <!-- stick figure running -->
        <circle cx="60" cy="18" r="12" fill="#5F8A86"/>
        <line x1="60" y1="30" x2="60" y2="70" stroke="#5F8A86" stroke-width="5" stroke-linecap="round"/>
        <line x1="60" y1="45" x2="35" y2="60" stroke="#5F8A86" stroke-width="5" stroke-linecap="round"/>
        <line x1="60" y1="45" x2="85" y2="55" stroke="#5F8A86" stroke-width="5" stroke-linecap="round"/>
        <line x1="60" y1="70" x2="40" y2="95" stroke="#5F8A86" stroke-width="5" stroke-linecap="round"/>
        <line x1="60" y1="70" x2="80" y2="100" stroke="#5F8A86" stroke-width="5" stroke-linecap="round"/>
      </svg>
      <div class="badge">Physical Education · 3 Topics</div>
      <div class="title">Fundamental<br/>Motor Skills</div>
      <div class="subtitle">Movement Skills · IB PYP Grade 3</div>
      <div class="bottom-bar"></div>
    </body></html>`,
  },
  {
    duration: 8,
    html: `
    <!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { width:1280px; height:720px; overflow:hidden;
        background: linear-gradient(135deg, #0d2137 0%, #1a3a2a 50%, #0d2a1a 100%);
        font-family:'Arial Black',Arial,sans-serif;
        display:flex; flex-direction:column; align-items:center; justify-content:center; }
      .section-label { font-size:16px; font-weight:700; color:#7AADA8; letter-spacing:4px;
        text-transform:uppercase; margin-bottom:12px; }
      .keyword { font-size:72px; font-weight:900; color:white; text-align:center;
        text-shadow:0 0 40px rgba(90,138,112,0.7);
        animation:popIn 0.7s cubic-bezier(0.34,1.56,0.64,1); }
      .desc { font-size:22px; color:#7AADA8; margin-top:14px; text-align:center; max-width:700px; line-height:1.5; }
      .chips { display:flex; gap:16px; margin-top:28px; }
      .chip { background:rgba(90,138,112,0.15); border:1px solid #5A8A70; border-radius:999px;
        padding:10px 24px; font-size:18px; font-weight:700; color:#5A8A70; letter-spacing:1px;
        animation:fadeChip 0.5s ease both; }
      .chip:nth-child(1){animation-delay:0.2s}
      .chip:nth-child(2){animation-delay:0.4s}
      .chip:nth-child(3){animation-delay:0.6s}
      .chip:nth-child(4){animation-delay:0.8s}
      @keyframes popIn{from{transform:scale(0.5);opacity:0}to{transform:scale(1);opacity:1}}
      @keyframes fadeChip{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
      .runner { margin-bottom:20px; }
      .bottom-bar{position:absolute;bottom:0;left:0;right:0;height:6px;
        background:linear-gradient(90deg,#5A8A70,#7AADA8,#5A8A70);}
      .top-logo{position:absolute;top:24px;left:36px;font-size:13px;font-weight:700;
        color:#5A8A70;letter-spacing:2px;opacity:0.8;text-transform:uppercase;}
    </style></head><body>
      <div class="top-logo">AIVORAH · IB PYP · GRADE 3</div>
      <svg class="runner" width="160" height="100" viewBox="0 0 160 100">
        <!-- animated running stick figure -->
        <g>
          <animateTransform attributeName="transform" type="translate" values="0,0;10,0;0,0" dur="0.5s" repeatCount="indefinite"/>
          <circle cx="80" cy="15" r="12" fill="#5A8A70"/>
          <line x1="80" y1="27" x2="80" y2="60" stroke="#5A8A70" stroke-width="5" stroke-linecap="round"/>
          <!-- arms swing -->
          <line x1="80" y1="38" x2="55" y2="52" stroke="#5A8A70" stroke-width="4" stroke-linecap="round">
            <animateTransform attributeName="transform" type="rotate" values="0,80,38;20,80,38;0,80,38" dur="0.5s" repeatCount="indefinite"/>
          </line>
          <line x1="80" y1="38" x2="105" y2="28" stroke="#5A8A70" stroke-width="4" stroke-linecap="round">
            <animateTransform attributeName="transform" type="rotate" values="0,80,38;-20,80,38;0,80,38" dur="0.5s" repeatCount="indefinite"/>
          </line>
          <!-- legs stride -->
          <line x1="80" y1="60" x2="55" y2="88" stroke="#5A8A70" stroke-width="5" stroke-linecap="round">
            <animateTransform attributeName="transform" type="rotate" values="-20,80,60;20,80,60;-20,80,60" dur="0.5s" repeatCount="indefinite"/>
          </line>
          <line x1="80" y1="60" x2="105" y2="88" stroke="#5A8A70" stroke-width="5" stroke-linecap="round">
            <animateTransform attributeName="transform" type="rotate" values="20,80,60;-20,80,60;20,80,60" dur="0.5s" repeatCount="indefinite"/>
          </line>
        </g>
      </svg>
      <div class="section-label">Type 1</div>
      <div class="keyword">LOCOMOTOR SKILLS</div>
      <div class="desc">You travel from one place to another!</div>
      <div class="chips">
        <div class="chip">Running</div>
        <div class="chip">Skipping</div>
        <div class="chip">Hopping</div>
        <div class="chip">Galloping</div>
      </div>
      <div class="bottom-bar"></div>
    </body></html>`,
  },
  {
    duration: 8,
    html: `
    <!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { width:1280px; height:720px; overflow:hidden;
        background: linear-gradient(135deg, #1a1a2e 0%, #2d1b4e 50%, #1a0a2e 100%);
        font-family:'Arial Black',Arial,sans-serif;
        display:flex; flex-direction:column; align-items:center; justify-content:center; }
      .section-label{font-size:16px;font-weight:700;color:#B8797E;letter-spacing:4px;text-transform:uppercase;margin-bottom:12px;}
      .keyword{font-size:72px;font-weight:900;color:white;text-align:center;
        text-shadow:0 0 40px rgba(184,121,126,0.7);
        animation:popIn 0.7s cubic-bezier(0.34,1.56,0.64,1);}
      .desc{font-size:22px;color:#B8797E;margin-top:14px;text-align:center;max-width:700px;line-height:1.5;}
      .chips{display:flex;gap:16px;margin-top:28px;}
      .chip{background:rgba(184,121,126,0.12);border:1px solid #B8797E;border-radius:999px;
        padding:10px 24px;font-size:18px;font-weight:700;color:#B8797E;letter-spacing:1px;
        animation:fadeChip 0.5s ease both;}
      .chip:nth-child(1){animation-delay:0.2s}
      .chip:nth-child(2){animation-delay:0.4s}
      .chip:nth-child(3){animation-delay:0.6s}
      @keyframes popIn{from{transform:scale(0.5);opacity:0}to{transform:scale(1);opacity:1}}
      @keyframes fadeChip{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
      .bottom-bar{position:absolute;bottom:0;left:0;right:0;height:6px;
        background:linear-gradient(90deg,#B8797E,#8A8358,#B8797E);}
      .top-logo{position:absolute;top:24px;left:36px;font-size:13px;font-weight:700;
        color:#B8797E;letter-spacing:2px;opacity:0.8;text-transform:uppercase;}
    </style></head><body>
      <div class="top-logo">AIVORAH · IB PYP · GRADE 3</div>
      <!-- balance figure -->
      <svg width="120" height="110" viewBox="0 0 120 110" style="margin-bottom:16px">
        <circle cx="60" cy="14" r="12" fill="#B8797E"/>
        <line x1="60" y1="26" x2="60" y2="65" stroke="#B8797E" stroke-width="5" stroke-linecap="round"/>
        <!-- arms wide (T-pose for balance) -->
        <line x1="60" y1="38" x2="20" y2="45" stroke="#B8797E" stroke-width="4" stroke-linecap="round"/>
        <line x1="60" y1="38" x2="100" y2="45" stroke="#B8797E" stroke-width="4" stroke-linecap="round"/>
        <!-- one leg up -->
        <line x1="60" y1="65" x2="42" y2="95" stroke="#B8797E" stroke-width="5" stroke-linecap="round"/>
        <line x1="60" y1="65" x2="78" y2="72" stroke="#B8797E" stroke-width="5" stroke-linecap="round">
          <animateTransform attributeName="transform" type="rotate" values="0,60,65;15,60,65;0,60,65" dur="2s" repeatCount="indefinite"/>
        </line>
      </svg>
      <div class="section-label">Type 2</div>
      <div class="keyword">NON-LOCOMOTOR</div>
      <div class="desc">You stay in one spot — but your body still moves!</div>
      <div class="chips">
        <div class="chip">Balancing</div>
        <div class="chip">Stretching</div>
        <div class="chip">Twisting</div>
      </div>
      <div class="bottom-bar"></div>
    </body></html>`,
  },
  {
    duration: 8,
    html: `
    <!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { width:1280px; height:720px; overflow:hidden;
        background: linear-gradient(135deg, #1a1200 0%, #2d2000 50%, #1a1500 100%);
        font-family:'Arial Black',Arial,sans-serif;
        display:flex; flex-direction:column; align-items:center; justify-content:center; }
      .section-label{font-size:16px;font-weight:700;color:#C4836A;letter-spacing:4px;text-transform:uppercase;margin-bottom:12px;}
      .keyword{font-size:72px;font-weight:900;color:white;text-align:center;
        text-shadow:0 0 40px rgba(196,131,106,0.7);
        animation:popIn 0.7s cubic-bezier(0.34,1.56,0.64,1);}
      .desc{font-size:22px;color:#C4836A;margin-top:14px;text-align:center;max-width:700px;line-height:1.5;}
      .chips{display:flex;gap:16px;margin-top:28px;}
      .chip{background:rgba(196,131,106,0.12);border:1px solid #C4836A;border-radius:999px;
        padding:10px 24px;font-size:18px;font-weight:700;color:#C4836A;letter-spacing:1px;
        animation:fadeChip 0.5s ease both;}
      .chip:nth-child(1){animation-delay:0.2s}
      .chip:nth-child(2){animation-delay:0.4s}
      .chip:nth-child(3){animation-delay:0.6s}
      @keyframes popIn{from{transform:scale(0.5);opacity:0}to{transform:scale(1);opacity:1}}
      @keyframes fadeChip{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
      .bottom-bar{position:absolute;bottom:0;left:0;right:0;height:6px;
        background:linear-gradient(90deg,#C4836A,#8A8358,#C4836A);}
      .top-logo{position:absolute;top:24px;left:36px;font-size:13px;font-weight:700;
        color:#C4836A;letter-spacing:2px;opacity:0.8;text-transform:uppercase;}
    </style></head><body>
      <div class="top-logo">AIVORAH · IB PYP · GRADE 3</div>
      <!-- throw + ball animation -->
      <svg width="200" height="100" viewBox="0 0 200 100" style="margin-bottom:16px">
        <!-- thrower -->
        <circle cx="40" cy="14" r="12" fill="#C4836A"/>
        <line x1="40" y1="26" x2="40" y2="65" stroke="#C4836A" stroke-width="5" stroke-linecap="round"/>
        <line x1="40" y1="38" x2="15" y2="52" stroke="#C4836A" stroke-width="4" stroke-linecap="round"/>
        <!-- throwing arm -->
        <line x1="40" y1="38" x2="75" y2="20" stroke="#C4836A" stroke-width="4" stroke-linecap="round">
          <animateTransform attributeName="transform" type="rotate" values="0,40,38;-40,40,38;0,40,38" dur="1.5s" repeatCount="indefinite"/>
        </line>
        <line x1="40" y1="65" x2="22" y2="92" stroke="#C4836A" stroke-width="5" stroke-linecap="round"/>
        <line x1="40" y1="65" x2="58" y2="92" stroke="#C4836A" stroke-width="5" stroke-linecap="round"/>
        <!-- ball in flight -->
        <circle cx="120" cy="30" r="10" fill="#8A8358">
          <animateMotion dur="1.5s" repeatCount="indefinite"
            path="M-60,10 Q0,-40 60,10"/>
        </circle>
        <!-- catcher -->
        <circle cx="165" cy="14" r="12" fill="#C4836A"/>
        <line x1="165" y1="26" x2="165" y2="65" stroke="#C4836A" stroke-width="5" stroke-linecap="round"/>
        <line x1="165" y1="38" x2="140" y2="25" stroke="#C4836A" stroke-width="4" stroke-linecap="round"/>
        <line x1="165" y1="38" x2="190" y2="52" stroke="#C4836A" stroke-width="4" stroke-linecap="round"/>
        <line x1="165" y1="65" x2="148" y2="92" stroke="#C4836A" stroke-width="5" stroke-linecap="round"/>
        <line x1="165" y1="65" x2="182" y2="92" stroke="#C4836A" stroke-width="5" stroke-linecap="round"/>
      </svg>
      <div class="section-label">Type 3</div>
      <div class="keyword">MANIPULATIVE SKILLS</div>
      <div class="desc">Control objects with your hands and feet!</div>
      <div class="chips">
        <div class="chip">Throwing</div>
        <div class="chip">Catching</div>
        <div class="chip">Kicking</div>
      </div>
      <div class="bottom-bar"></div>
    </body></html>`,
  },
  {
    duration: 6,
    html: `
    <!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { width:1280px; height:720px; overflow:hidden;
        background: linear-gradient(135deg, #0a1f1a 0%, #1a3d2d 50%, #0a2a1a 100%);
        font-family:'Arial Black',Arial,sans-serif;
        display:flex; flex-direction:column; align-items:center; justify-content:center; }
      .quiz-label{font-size:16px;font-weight:700;color:#7AADA8;letter-spacing:4px;text-transform:uppercase;margin-bottom:16px;}
      .question{font-size:36px;font-weight:900;color:white;text-align:center;max-width:900px;line-height:1.4;
        animation:popIn 0.7s cubic-bezier(0.34,1.56,0.64,1);}
      .hint{font-size:22px;color:#7AADA8;margin-top:24px;}
      .answer{font-size:48px;font-weight:900;color:#5A8A70;margin-top:20px;
        animation:popIn 0.7s cubic-bezier(0.34,1.56,0.64,1) 3s both;}
      .q-mark{font-size:120px;color:#8A8358;margin-bottom:16px;
        animation:pulse 1s ease-in-out infinite;}
      @keyframes popIn{from{transform:scale(0.5);opacity:0}to{transform:scale(1);opacity:1}}
      @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}
      .bottom-bar{position:absolute;bottom:0;left:0;right:0;height:6px;
        background:linear-gradient(90deg,#5F8A86,#7AADA8,#5A8A70);}
      .top-logo{position:absolute;top:24px;left:36px;font-size:13px;font-weight:700;
        color:#5F8A86;letter-spacing:2px;opacity:0.8;text-transform:uppercase;}
    </style></head><body>
      <div class="top-logo">AIVORAH · IB PYP · GRADE 3</div>
      <div class="q-mark">?</div>
      <div class="quiz-label">Quiz Time!</div>
      <div class="question">Is BALANCING a locomotor skill<br/>or a non-locomotor skill?</div>
      <div class="hint">Think carefully...</div>
      <div class="answer">NON-LOCOMOTOR!</div>
      <div class="bottom-bar"></div>
    </body></html>`,
  },
  {
    duration: 5,
    html: `
    <!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { width:1280px; height:720px; overflow:hidden;
        background: linear-gradient(135deg, #0a1628 0%, #1a2d4a 50%, #0d2137 100%);
        font-family:'Arial Black',Arial,sans-serif;
        display:flex; flex-direction:column; align-items:center; justify-content:center; }
      .main{font-size:72px;font-weight:900;color:white;text-align:center;
        text-shadow:0 0 40px rgba(95,138,134,0.6);
        animation:popIn 0.8s cubic-bezier(0.34,1.56,0.64,1);}
      .sub{font-size:26px;color:#7AADA8;margin-top:16px;letter-spacing:2px;
        animation:slideUp 0.6s ease 0.3s both;}
      .stars{font-size:48px;margin-bottom:24px;}
      @keyframes popIn{from{transform:scale(0.5);opacity:0}to{transform:scale(1);opacity:1}}
      @keyframes slideUp{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}
      .bottom-bar{position:absolute;bottom:0;left:0;right:0;height:6px;
        background:linear-gradient(90deg,#5F8A86,#7AADA8,#5A8A70);}
      .top-logo{position:absolute;top:24px;left:36px;font-size:13px;font-weight:700;
        color:#5F8A86;letter-spacing:2px;opacity:0.8;text-transform:uppercase;}
    </style></head><body>
      <div class="top-logo">AIVORAH · IB PYP · GRADE 3</div>
      <div class="stars">&#9733; &#9733; &#9733;</div>
      <div class="main">Keep Moving,<br/>Keep Growing!</div>
      <div class="sub">You are AMAZING — Aivorah believes in you!</div>
      <div class="bottom-bar"></div>
    </body></html>`,
  },
];

// ── Step 1: Generate silent visual MP4 ───────────────────────────────────────
async function generateVisual() {
  console.log('\n🎬 Step 1: Generating silent visual video...');
  console.log(`   Scenes : ${SCENES.length}`);
  console.log(`   Output : ${VISUAL_OUT}\n`);

  if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security',
           `--window-size=${WIDTH},${HEIGHT}`],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  const segFiles = [];

  for (let i = 0; i < SCENES.length; i++) {
    const scene    = SCENES[i];
    const sceneDir = path.join(FRAMES_DIR, `scene_${i}`);
    fs.mkdirSync(sceneDir, { recursive: true });

    console.log(`📸 Scene ${i + 1}/${SCENES.length} (${scene.duration}s)`);
    await page.setContent(scene.html, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 500));

    const totalFrames = scene.duration * FPS;
    for (let f = 0; f < totalFrames; f++) {
      await page.screenshot({ path: path.join(sceneDir, `frame_${String(f).padStart(6,'0')}.png`), type: 'png' });
      if (f % FPS === 0) process.stdout.write(`\r   Frame ${f}/${totalFrames}`);
    }
    console.log(`\r   ✅ Scene ${i + 1} captured (${totalFrames} frames)`);

    const segFile = path.join(FRAMES_DIR, `seg_${i}.mp4`);
    execSync(
      `ffmpeg -y -framerate ${FPS} -i "${path.join(sceneDir, 'frame_%06d.png')}" ` +
      `-vf "scale=${WIDTH}:${HEIGHT}" -c:v libx264 -pix_fmt yuv420p -preset fast "${segFile}"`,
      { stdio: 'pipe' }
    );
    segFiles.push(segFile);
  }

  await browser.close();

  // Concatenate segments
  console.log('\n🔗 Concatenating scenes...');
  const listFile = path.join(FRAMES_DIR, 'concat.txt');
  fs.writeFileSync(listFile, segFiles.map(f => `file '${f}'`).join('\n'));
  execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${VISUAL_OUT}"`, { stdio: 'pipe' });
  fs.rmSync(FRAMES_DIR, { recursive: true });

  const mb = (fs.statSync(VISUAL_OUT).size / 1024 / 1024).toFixed(1);
  console.log(`✅ Silent video: ${VISUAL_OUT} (${mb} MB)`);
}

// ── Step 2: Generate ElevenLabs voiceover (ONE API call, stored permanently) ─
async function generateVoice() {
  if (fs.existsSync(VOICE_OUT)) {
    const kb = (fs.statSync(VOICE_OUT).size / 1024).toFixed(0);
    console.log(`\n🎙️  Voice file already exists (${kb} KB) — skipping API call to save credits.`);
    console.log(`   Delete ${VOICE_OUT} to regenerate.`);
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('\n❌ ELEVENLABS_API_KEY not set in server/.env');
    console.error('   Add: ELEVENLABS_API_KEY=your_key_here');
    process.exit(1);
  }

  console.log(`\n🎙️  Step 2: Generating ElevenLabs voiceover (1 API call)...`);
  console.log(`   Voice ID : ${VOICE_ID}`);
  console.log(`   Model    : eleven_turbo_v2_5 (minimum credits)`);
  console.log(`   Output   : ${VOICE_OUT}\n`);

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
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
    const body = await res.text().catch(() => '');
    console.error(`❌ ElevenLabs error ${res.status}: ${body.slice(0, 400)}`);
    process.exit(1);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  fs.writeFileSync(VOICE_OUT, buffer);

  const kb = (buffer.length / 1024).toFixed(1);
  console.log(`✅ Voiceover saved: ${VOICE_OUT} (${kb} KB)`);
  console.log(`   ⚠️  This file is stored permanently — will NOT be regenerated on future runs.`);
}

// ── Step 3: Merge video + audio ───────────────────────────────────────────────
function mergeVideoAudio() {
  if (!fs.existsSync(VISUAL_OUT)) {
    console.error(`❌ Visual video not found: ${VISUAL_OUT}`);
    console.error(`   Run with --visual-only first.`);
    process.exit(1);
  }
  if (!fs.existsSync(VOICE_OUT)) {
    console.error(`❌ Voice file not found: ${VOICE_OUT}`);
    console.error(`   Run with --voice-only first (needs ELEVENLABS_API_KEY).`);
    process.exit(1);
  }

  console.log(`\n🎞️  Step 3: Merging video + audio...`);

  const videoDuration = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${VISUAL_OUT}"`,
      { encoding: 'utf8' }).trim()
  );
  const audioDuration = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${VOICE_OUT}"`,
      { encoding: 'utf8' }).trim()
  );
  console.log(`   Video: ${videoDuration.toFixed(1)}s | Audio: ${audioDuration.toFixed(1)}s`);

  // If audio is longer, loop/extend video to match
  if (audioDuration > videoDuration) {
    console.log(`   Extending video to match audio length...`);
    execSync(
      `ffmpeg -y -stream_loop -1 -i "${VISUAL_OUT}" -i "${VOICE_OUT}" ` +
      `-c:v libx264 -c:a aac -b:a 192k -t ${audioDuration.toFixed(3)} -pix_fmt yuv420p "${FINAL_OUT}"`,
      { stdio: 'pipe' }
    );
  } else {
    execSync(
      `ffmpeg -y -i "${VISUAL_OUT}" -i "${VOICE_OUT}" ` +
      `-filter_complex "[1:a]apad[a]" -map 0:v -map "[a]" ` +
      `-c:v copy -c:a aac -b:a 192k -shortest "${FINAL_OUT}"`,
      { stdio: 'pipe' }
    );
  }

  const mb = (fs.statSync(FINAL_OUT).size / 1024 / 1024).toFixed(1);
  console.log(`✅ Final video: ${FINAL_OUT} (${mb} MB)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  AIVORAH · Physical Education: Fundamental Motor Skills');
  console.log('  IB PYP Grade 3 — Video Pipeline');
  console.log('═══════════════════════════════════════════════════════');

  if (VISUAL_ONLY || RUN_ALL) await generateVisual();
  if (VOICE_ONLY  || RUN_ALL) await generateVoice();
  if (MERGE_ONLY  || RUN_ALL) mergeVideoAudio();

  if (RUN_ALL || MERGE_ONLY) {
    console.log('\n🎉 All done!');
    console.log(`   Final video : ${FINAL_OUT}`);
    console.log(`   Voice file  : ${VOICE_OUT} (reusable forever)`);
    console.log(`\n   Add to VideoPlayerScreen with topic slug: "${TOPIC_SLUG}"`);
  }
})();
