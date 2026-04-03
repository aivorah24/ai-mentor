/**
 * Aivorah — Lesson Video Generator (30fps animated)
 * Chapter: Magnets (Grade 3 Science)
 *
 * Pipeline:
 *   HTML scene (CSS animations) → Puppeteer records 30fps frames
 *   → ElevenLabs Charlie voiceover → FFmpeg assembles MP4
 *
 * Usage: node scripts/generate-lesson-video.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const puppeteer    = require('puppeteer');
const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

const OUT_DIR = path.join(__dirname, '../data/videos/magnets');
const FRAMES  = path.join(OUT_DIR, 'frames');
const AUDIO   = path.join(OUT_DIR, 'audio');
const SEGS    = path.join(OUT_DIR, 'segments');
const FINAL   = path.join(__dirname, '../data/videos/magnets_lesson.mp4');

[FRAMES, AUDIO, SEGS].forEach(d => fs.mkdirSync(d, { recursive: true }));

const TIKTOK_API = 'https://tiktok-tts.weilnet.workers.dev/api/generation';
const TIKTOK_VOICE = 'en_us_rocket'; // high-energy kids voice
const FPS          = 24;

// ── Shared CSS injected into every scene ─────────────────────
const BASE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1280px; height:720px; overflow:hidden; font-family:'Inter',sans-serif; }

  .scene {
    width:1280px; height:720px;
    display:flex; flex-direction:column;
    align-items:center; justify-content:center;
    position:relative; overflow:hidden;
    padding: 40px 80px;
  }

  /* ── Continuous background pulse ── */
  @keyframes bgPulse {
    0%,100% { opacity: 0.05; transform: scale(1); }
    50%      { opacity: 0.10; transform: scale(1.08); }
  }
  @keyframes float {
    0%,100% { transform: translateY(0px); }
    50%      { transform: translateY(-18px); }
  }
  @keyframes floatSlow {
    0%,100% { transform: translateY(0px) rotate(0deg); }
    50%      { transform: translateY(-12px) rotate(5deg); }
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes spinSlow {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  /* ── Entrance animations ── */
  @keyframes dropIn {
    0%   { opacity:0; transform: translateY(-60px) scale(0.8); }
    60%  { transform: translateY(8px) scale(1.03); }
    100% { opacity:1; transform: translateY(0) scale(1); }
  }
  @keyframes riseIn {
    0%   { opacity:0; transform: translateY(60px); }
    100% { opacity:1; transform: translateY(0); }
  }
  @keyframes zoomIn {
    0%   { opacity:0; transform: scale(0.4) rotate(-10deg); }
    70%  { transform: scale(1.08) rotate(2deg); }
    100% { opacity:1; transform: scale(1) rotate(0deg); }
  }
  @keyframes slideRight {
    0%   { opacity:0; transform: translateX(-80px); }
    100% { opacity:1; transform: translateX(0); }
  }
  @keyframes slideLeft {
    0%   { opacity:0; transform: translateX(80px); }
    100% { opacity:1; transform: translateX(0); }
  }
  @keyframes fadeIn {
    0%   { opacity:0; }
    100% { opacity:1; }
  }
  @keyframes popIn {
    0%   { opacity:0; transform: scale(0); }
    70%  { transform: scale(1.15); }
    100% { opacity:1; transform: scale(1); }
  }
  @keyframes cardIn {
    0%   { opacity:0; transform: scale(0.7) translateY(30px); }
    100% { opacity:1; transform: scale(1) translateY(0); }
  }

  /* ── Attract / Repel magnet animations ── */
  @keyframes attractLeft {
    0%   { transform: translateX(-160px); opacity:0; }
    40%  { opacity:1; }
    80%  { transform: translateX(10px); }
    100% { transform: translateX(0); }
  }
  @keyframes attractRight {
    0%   { transform: translateX(160px); opacity:0; }
    40%  { opacity:1; }
    80%  { transform: translateX(-10px); }
    100% { transform: translateX(0); }
  }
  @keyframes repelLeft {
    0%   { transform: translateX(0); }
    30%  { transform: translateX(20px); }
    100% { transform: translateX(-120px); opacity:0.6; }
  }
  @keyframes repelRight {
    0%   { transform: translateX(0); }
    30%  { transform: translateX(-20px); }
    100% { transform: translateX(120px); opacity:0.6; }
  }
  @keyframes sparkle {
    0%,100% { transform: scale(0); opacity:0; }
    40%,60% { transform: scale(1.2); opacity:1; }
  }
  @keyframes pulse {
    0%,100% { transform: scale(1); opacity:0.8; }
    50%      { transform: scale(1.15); opacity:1; }
  }

  /* ── Utility classes ── */
  .anim-drop      { animation: dropIn     0.7s 0.1s both cubic-bezier(.34,1.4,.64,1); }
  .anim-drop2     { animation: dropIn     0.7s 0.4s both cubic-bezier(.34,1.4,.64,1); }
  .anim-drop3     { animation: dropIn     0.7s 0.7s both cubic-bezier(.34,1.4,.64,1); }
  .anim-rise      { animation: riseIn     0.6s 0.2s both ease-out; }
  .anim-rise2     { animation: riseIn     0.6s 0.5s both ease-out; }
  .anim-zoom      { animation: zoomIn     0.8s 0.1s both cubic-bezier(.34,1.4,.64,1); }
  .anim-zoom2     { animation: zoomIn     0.8s 0.4s both cubic-bezier(.34,1.4,.64,1); }
  .anim-slide-r   { animation: slideRight 0.6s 0.2s both ease-out; }
  .anim-slide-l   { animation: slideLeft  0.6s 0.2s both ease-out; }
  .anim-fade      { animation: fadeIn     0.5s 0.3s both; }
  .anim-fade2     { animation: fadeIn     0.5s 0.8s both; }
  .anim-fade3     { animation: fadeIn     0.5s 1.2s both; }
  .anim-pop       { animation: popIn      0.5s 0.2s both cubic-bezier(.34,1.6,.64,1); }
  .anim-card0     { animation: cardIn     0.5s 0.1s both ease-out; }
  .anim-card1     { animation: cardIn     0.5s 0.25s both ease-out; }
  .anim-card2     { animation: cardIn     0.5s 0.4s both ease-out; }
  .anim-card3     { animation: cardIn     0.5s 0.55s both ease-out; }
  .anim-card4     { animation: cardIn     0.5s 0.7s both ease-out; }
  .anim-card5     { animation: cardIn     0.5s 0.85s both ease-out; }
  .anim-card6     { animation: cardIn     0.5s 1.0s both ease-out; }
  .anim-card7     { animation: cardIn     0.5s 1.15s both ease-out; }

  .float          { animation: float      3s infinite ease-in-out; }
  .float-slow     { animation: floatSlow  4s infinite ease-in-out; }
  .pulse          { animation: pulse      2s infinite ease-in-out; }

  .big-word {
    font-weight: 900;
    letter-spacing: -2px;
    line-height: 1.0;
    text-align: center;
  }
  .sub {
    font-size: 18px; font-weight: 600;
    color: #475569; letter-spacing: 4px;
    text-transform: uppercase; text-align: center;
    margin-top: 12px;
  }
  .blob {
    position: absolute; border-radius: 50%;
    filter: blur(70px);
    animation: bgPulse 4s infinite ease-in-out;
  }
`;

// ── Scenes ────────────────────────────────────────────────────
const SCENES = [
  {
    id: '01_intro', duration: 5,
    voice: "Whoa — MAGNETS! These tiny objects have an invisible superpower. Today you're going to discover how magnets work, what they attract, and why opposite poles are best friends. Let's go!",
    html: `
    <div class="scene" style="background: radial-gradient(ellipse at 60% 40%, #0c1f3f 0%, #020917 65%);">
      <div class="blob" style="width:500px;height:500px;background:#38bdf8;opacity:0.06;top:-150px;right:-80px;animation-delay:0s;"></div>
      <div class="blob" style="width:350px;height:350px;background:#0ea5e9;opacity:0.05;bottom:-80px;left:-60px;animation-delay:2s;"></div>

      <!-- Floating horseshoe magnet SVG -->
      <div class="anim-zoom float" style="margin-bottom:28px;">
        <svg width="260" height="230" viewBox="0 0 260 230" fill="none">
          <defs>
            <filter id="glow"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <!-- Horseshoe -->
          <path d="M40 200 L40 70 Q40 15 130 15 Q220 15 220 70 L220 200"
                stroke="#38bdf8" stroke-width="42" stroke-linecap="round" fill="none" filter="url(#glow)"/>
          <path d="M40 200 L40 70 Q40 15 130 15 Q220 15 220 70 L220 200"
                stroke="#0ea5e9" stroke-width="30" stroke-linecap="round" fill="none"/>
          <!-- N pole -->
          <rect x="12" y="162" width="56" height="52" rx="8" fill="#ef4444"/>
          <text x="40" y="196" text-anchor="middle" font-family="Inter,sans-serif" font-size="26" font-weight="900" fill="white">N</text>
          <!-- S pole -->
          <rect x="192" y="162" width="56" height="52" rx="8" fill="#22c55e"/>
          <text x="220" y="196" text-anchor="middle" font-family="Inter,sans-serif" font-size="26" font-weight="900" fill="white">S</text>
          <!-- field arcs -->
          <path d="M40 188 Q130 230 220 188" stroke="#38bdf8" stroke-width="2" stroke-dasharray="6 4" opacity="0.35" fill="none"/>
          <path d="M40 175 Q130 240 220 175" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="5 5" opacity="0.2" fill="none"/>
        </svg>
      </div>

      <div class="big-word anim-drop" style="color:#38bdf8; font-size:116px;">MAGNETS!</div>
      <div class="sub anim-rise2">Grade 3 &nbsp;·&nbsp; Science</div>

      <!-- Floating particles -->
      <div style="position:absolute;width:12px;height:12px;border-radius:50%;background:#38bdf8;opacity:0.4;top:15%;left:12%;animation:float 2.5s infinite ease-in-out;"></div>
      <div style="position:absolute;width:8px;height:8px;border-radius:50%;background:#22c55e;opacity:0.4;top:25%;right:15%;animation:float 3s 1s infinite ease-in-out;"></div>
      <div style="position:absolute;width:10px;height:10px;border-radius:50%;background:#f59e0b;opacity:0.4;bottom:20%;left:20%;animation:float 3.5s 0.5s infinite ease-in-out;"></div>
    </div>`
  },

  {
    id: '02_invisible_force', duration: 5,
    voice: "A magnet has an invisible force field around it — called a magnetic field. You can't see it, but you can FEEL it! It reaches out and grabs onto certain objects without even touching them. Magic? Nope — science!",
    html: `
    <div class="scene" style="background: radial-gradient(ellipse at 40% 50%, #0a1f10 0%, #020917 65%);">
      <div class="blob" style="width:450px;height:450px;background:#22c55e;opacity:0.06;top:-100px;right:-100px;animation-delay:1s;"></div>

      <!-- Animated field rings -->
      <div class="anim-zoom" style="position:relative; display:flex; align-items:center; justify-content:center; margin-bottom:24px;">
        <svg width="480" height="280" viewBox="0 0 480 280" fill="none">
          <!-- Pulsing rings -->
          <ellipse cx="240" cy="140" rx="220" ry="120" stroke="#22c55e" stroke-width="1.5" stroke-dasharray="10 6" opacity="0.15" style="animation:pulse 2.5s infinite;"/>
          <ellipse cx="240" cy="140" rx="170" ry="90"  stroke="#22c55e" stroke-width="2"   stroke-dasharray="8 5"  opacity="0.22" style="animation:pulse 2.5s 0.4s infinite;"/>
          <ellipse cx="240" cy="140" rx="115" ry="60"  stroke="#22c55e" stroke-width="2.5" stroke-dasharray="6 4"  opacity="0.3"  style="animation:pulse 2.5s 0.8s infinite;"/>
          <!-- Bar magnet -->
          <rect x="100" y="110" width="130" height="60" rx="10" fill="#ef4444"/>
          <text x="165" y="148" text-anchor="middle" font-family="Inter,sans-serif" font-size="30" font-weight="900" fill="white">N</text>
          <rect x="250" y="110" width="130" height="60" rx="10" fill="#22c55e"/>
          <text x="315" y="148" text-anchor="middle" font-family="Inter,sans-serif" font-size="30" font-weight="900" fill="white">S</text>
          <!-- Flying paper clips -->
          <g style="animation:attractLeft 1.2s 0.8s both ease-out;">
            <path d="M38 120 Q28 138 38 156 Q48 174 58 156 Q68 138 58 120 Q48 108 38 120Z" stroke="#94a3b8" stroke-width="3.5" fill="none"/>
          </g>
          <g style="animation:attractRight 1.2s 0.8s both ease-out;">
            <path d="M442 120 Q432 138 442 156 Q452 174 462 156 Q472 138 462 120 Q452 108 442 120Z" stroke="#94a3b8" stroke-width="3.5" fill="none"/>
          </g>
        </svg>
      </div>

      <div class="big-word anim-drop" style="color:#22c55e; font-size:96px;">INVISIBLE</div>
      <div class="big-word anim-drop2" style="color:#f1f5f9; font-size:96px;">FORCE!</div>
    </div>`
  },

  {
    id: '03_attract', duration: 5,
    voice: "Here's the most important rule — opposites attract! The North pole LOVES the South pole. Put them near each other and — SNAP — they pull together like best friends giving a hug!",
    html: `
    <div class="scene" style="background: radial-gradient(ellipse at 50% 50%, #071828 0%, #020917 65%);">
      <div class="blob" style="width:400px;height:400px;background:#0ea5e9;opacity:0.07;top:-80px;left:-80px;animation-delay:0.5s;"></div>

      <!-- Two magnets attracting -->
      <div style="position:relative; margin-bottom:32px;">
        <svg width="580" height="160" viewBox="0 0 580 160" fill="none">
          <!-- Left magnet slides in from left -->
          <g style="animation: attractLeft 1.0s 0.2s both cubic-bezier(.34,1.4,.64,1);">
            <rect x="20" y="50" width="150" height="65" rx="12" fill="#ef4444"/>
            <text x="95" y="91" text-anchor="middle" font-family="Inter,sans-serif" font-size="36" font-weight="900" fill="white">N</text>
          </g>
          <!-- Snap spark in the middle -->
          <g style="animation: sparkle 0.6s 1.1s both;">
            <circle cx="290" cy="82" r="22" fill="#fbbf24" opacity="0.95"/>
            <circle cx="290" cy="82" r="12" fill="white"/>
            <line x1="268" y1="60" x2="254" y2="46" stroke="#fbbf24" stroke-width="3.5" stroke-linecap="round"/>
            <line x1="312" y1="60" x2="326" y2="46" stroke="#fbbf24" stroke-width="3.5" stroke-linecap="round"/>
            <line x1="268" y1="104" x2="254" y2="118" stroke="#fbbf24" stroke-width="3.5" stroke-linecap="round"/>
            <line x1="312" y1="104" x2="326" y2="118" stroke="#fbbf24" stroke-width="3.5" stroke-linecap="round"/>
          </g>
          <!-- Right magnet slides in from right -->
          <g style="animation: attractRight 1.0s 0.2s both cubic-bezier(.34,1.4,.64,1);">
            <rect x="410" y="50" width="150" height="65" rx="12" fill="#22c55e"/>
            <text x="485" y="91" text-anchor="middle" font-family="Inter,sans-serif" font-size="36" font-weight="900" fill="white">S</text>
          </g>
          <!-- Arrows pointing toward each other -->
          <g style="animation: fadeIn 0.4s 1.5s both;">
            <line x1="215" y1="82" x2="268" y2="82" stroke="#0ea5e9" stroke-width="4" marker-end="url(#a1)" opacity="0.8"/>
            <line x1="365" y1="82" x2="312" y2="82" stroke="#0ea5e9" stroke-width="4" marker-end="url(#a2)" opacity="0.8"/>
            <defs>
              <marker id="a1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3z" fill="#0ea5e9"/></marker>
              <marker id="a2" markerWidth="8" markerHeight="8" refX="2" refY="3" orient="auto"><path d="M8,0 L8,6 L0,3z" fill="#0ea5e9"/></marker>
            </defs>
          </g>
        </svg>
      </div>

      <div class="big-word anim-drop" style="color:#0ea5e9; font-size:96px;">OPPOSITES</div>
      <div class="big-word anim-drop2" style="color:#f1f5f9; font-size:96px;">ATTRACT!</div>
    </div>`
  },

  {
    id: '04_repel', duration: 5,
    voice: "But when you put SAME poles together — North and North, or South and South — they PUSH each other away! It's like trying to push two stubborn cats together. No way, no how!",
    html: `
    <div class="scene" style="background: radial-gradient(ellipse at 50% 50%, #1c0f00 0%, #020917 65%);">
      <div class="blob" style="width:420px;height:420px;background:#f59e0b;opacity:0.06;bottom:-100px;right:-80px;animation-delay:1s;"></div>

      <div style="position:relative; margin-bottom:32px;">
        <svg width="580" height="160" viewBox="0 0 580 160" fill="none">
          <!-- Left N repelling left -->
          <g style="animation: repelLeft 1.2s 0.3s both ease-out;">
            <rect x="20" y="50" width="150" height="65" rx="12" fill="#ef4444"/>
            <text x="95" y="91" text-anchor="middle" font-family="Inter,sans-serif" font-size="36" font-weight="900" fill="white">N</text>
          </g>
          <!-- Shock waves -->
          <g style="animation: fadeIn 0.4s 0.5s both;">
            <path d="M248 82 Q262 60 276 82 Q290 104 304 82 Q318 60 332 82" stroke="#f59e0b" stroke-width="3.5" fill="none" opacity="0.9"/>
            <path d="M238 82 Q257 52 276 82 Q295 112 314 82 Q333 52 332 82" stroke="#f59e0b" stroke-width="2" fill="none" opacity="0.45"/>
          </g>
          <!-- Right N repelling right -->
          <g style="animation: repelRight 1.2s 0.3s both ease-out;">
            <rect x="410" y="50" width="150" height="65" rx="12" fill="#ef4444"/>
            <text x="485" y="91" text-anchor="middle" font-family="Inter,sans-serif" font-size="36" font-weight="900" fill="white">N</text>
          </g>
          <!-- Outward arrows -->
          <g style="animation: fadeIn 0.4s 1.3s both;">
            <line x1="210" y1="82" x2="155" y2="82" stroke="#f59e0b" stroke-width="4" marker-end="url(#r1)" opacity="0.8"/>
            <line x1="370" y1="82" x2="425" y2="82" stroke="#f59e0b" stroke-width="4" marker-end="url(#r2)" opacity="0.8"/>
            <defs>
              <marker id="r1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3z" fill="#f59e0b"/></marker>
              <marker id="r2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3z" fill="#f59e0b"/></marker>
            </defs>
          </g>
        </svg>
      </div>

      <div class="big-word anim-drop" style="color:#f59e0b; font-size:96px;">SAME POLES</div>
      <div class="big-word anim-drop2" style="color:#f1f5f9; font-size:96px;">REPEL!</div>
    </div>`
  },

  {
    id: '05_materials', duration: 6,
    voice: "So what exactly does a magnet attract? Only things made of iron, steel, or nickel. A paper clip — YES! An iron nail — YES! Wood — nope. Plastic — nope. Glass — no chance. Magnets are picky!",
    html: `
    <div class="scene" style="background: radial-gradient(ellipse at 50% 40%, #120a20 0%, #020917 65%);">
      <div class="blob" style="width:400px;height:400px;background:#a855f7;opacity:0.06;top:-80px;right:-60px;animation-delay:1.5s;"></div>

      <div class="big-word anim-drop" style="color:#a855f7; font-size:80px; margin-bottom:36px;">YES or NO?</div>

      <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:18px; width:100%;">
        ${[
          { label:'Paper Clip', icon:'📎', yes:true  },
          { label:'Iron Nail',  icon:'🔩', yes:true  },
          { label:'Steel Key',  icon:'🔑', yes:true  },
          { label:'Coin',       icon:'🪙', yes:true  },
          { label:'Wood',       icon:'🪵', yes:false },
          { label:'Plastic',    icon:'🧴', yes:false },
          { label:'Glass',      icon:'🪟', yes:false },
          { label:'Rubber',     icon:'🔴', yes:false },
        ].map((item, i) => `
          <div class="anim-card${i}" style="
            background:${item.yes ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.08)'};
            border:2px solid ${item.yes ? '#22c55e' : '#ef4444'}40;
            border-radius:16px; padding:16px 8px; text-align:center;">
            <div style="font-size:32px; margin-bottom:8px;">${item.icon}</div>
            <div style="font-size:12px; font-weight:700; color:#94a3b8; margin-bottom:6px;">${item.label}</div>
            <div style="font-size:24px; font-weight:900; color:${item.yes ? '#22c55e' : '#ef4444'};">${item.yes ? '✓' : '✗'}</div>
          </div>`).join('')}
      </div>
    </div>`
  },

  {
    id: '06_quiz', duration: 6,
    voice: "Quick challenge! I'll show you three objects. A steel spoon, a rubber ball, and an iron nail. Which two will the magnet attract? Think... Got it? Steel spoon — YES! Rubber ball — NO! Iron nail — YES! You're incredible!",
    html: `
    <div class="scene" style="background: radial-gradient(ellipse at 50% 40%, #1c1400 0%, #020917 65%);">
      <div class="blob" style="width:380px;height:380px;background:#fbbf24;opacity:0.06;bottom:-80px;left:-60px;animation-delay:0.5s;"></div>

      <!-- Big ? -->
      <div class="anim-zoom float" style="position:absolute; right:120px; top:50%; transform:translateY(-50%);">
        <svg width="200" height="220" viewBox="0 0 200 220" fill="none">
          <text x="100" y="180" text-anchor="middle" font-family="Inter,sans-serif" font-size="200" font-weight="900" fill="#fbbf24" opacity="0.12">?</text>
        </svg>
      </div>

      <div style="align-self:flex-start; width:60%;">
        <div style="display:inline-block; padding:8px 20px; background:rgba(251,191,36,0.15); border:2px solid rgba(251,191,36,0.3); border-radius:20px; margin-bottom:20px;" class="anim-pop">
          <span style="font-size:13px; font-weight:700; color:#fbbf24;">QUICK CHALLENGE</span>
        </div>
        <div class="big-word anim-drop" style="color:#fbbf24; font-size:72px; text-align:left;">YOUR TURN!</div>
        <div class="anim-rise2" style="font-size:22px; color:#94a3b8; margin-top:16px; line-height:1.5;">Which will the magnet attract?</div>
      </div>

      <div style="display:flex; gap:36px; margin-top:32px;">
        ${[
          { icon:'🥄', label:'Steel Spoon', answer:'✓', yes:true,  cls:'anim-card0' },
          { icon:'🏐', label:'Rubber Ball', answer:'✗', yes:false, cls:'anim-card2' },
          { icon:'🔩', label:'Iron Nail',   answer:'✓', yes:true,  cls:'anim-card4' },
        ].map(item => `
          <div class="${item.cls}" style="display:flex;flex-direction:column;align-items:center;gap:12px;">
            <div style="width:110px;height:110px;border-radius:20px;
              background:rgba(251,191,36,0.08);border:2px solid rgba(251,191,36,0.2);
              display:flex;align-items:center;justify-content:center;font-size:52px;">
              ${item.icon}
            </div>
            <div style="font-size:16px;font-weight:700;color:#e2e8f0;">${item.label}</div>
            <div class="anim-card6" style="font-size:32px;font-weight:900;color:${item.yes ? '#22c55e' : '#ef4444'};">${item.answer}</div>
          </div>`).join('')}
      </div>
    </div>`
  },

  {
    id: '07_summary', duration: 6,
    voice: "You did it — you are a Magnet Master! Remember: magnets have an invisible force field. Opposite poles attract. Same poles repel. And magnets only grab iron, steel, and nickel. Incredible work today — see you in the next lesson!",
    html: `
    <div class="scene" style="background: radial-gradient(ellipse at 50% 40%, #051428 0%, #020917 65%);">
      <div class="blob" style="width:500px;height:500px;background:#38bdf8;opacity:0.06;top:-120px;right:-100px;animation-delay:0s;"></div>
      <div class="blob" style="width:300px;height:300px;background:#22c55e;opacity:0.05;bottom:-60px;left:-60px;animation-delay:2s;"></div>

      <!-- Celebration dots -->
      ${Array.from({length:14}, (_,i) => {
        const colors = ['#38bdf8','#22c55e','#fbbf24','#ec4899','#a855f7'];
        const c = colors[i % colors.length];
        const x = 5 + Math.floor((i * 73) % 90);
        const y = 5 + Math.floor((i * 47) % 85);
        const s = 6 + (i % 4) * 4;
        return `<div class="anim-card${Math.min(i,7)}" style="position:absolute;left:${x}%;top:${y}%;width:${s}px;height:${s}px;border-radius:50%;background:${c};opacity:0.5;"></div>`;
      }).join('')}

      <div class="big-word anim-drop"  style="color:#38bdf8; font-size:110px;">MAGNET</div>
      <div class="big-word anim-drop2" style="color:#f1f5f9; font-size:110px;">MASTER!</div>

      <!-- 3 key fact pills -->
      <div style="display:flex; gap:20px; margin-top:40px; flex-wrap:wrap; justify-content:center;">
        ${[
          { text:'Opposites Attract', color:'#22c55e', cls:'anim-card3' },
          { text:'Same Poles Repel',  color:'#f59e0b', cls:'anim-card5' },
          { text:'Iron · Steel · Nickel', color:'#a855f7', cls:'anim-card7' },
        ].map(f => `
          <div class="${f.cls}" style="
            padding:14px 28px; border-radius:40px;
            background:${f.color}18; border:2px solid ${f.color}40;
            font-size:17px; font-weight:700; color:${f.color};">
            ${f.text}
          </div>`).join('')}
      </div>
    </div>`
  },
];

// ── Build full HTML page ──────────────────────────────────────
function buildHtml(scene) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>${BASE_CSS}</style>
</head><body>${scene.html}</body></html>`;
}

// ── Puppeteer: record scene at FPS ────────────────────────────
async function recordScene(scene, framesDir) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-web-security',
           '--disable-features=IsolateOrigins','--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.setContent(buildHtml(scene), { waitUntil: 'networkidle0', timeout: 30000 });

  // Let animations initialise
  await new Promise(r => setTimeout(r, 200));

  const totalFrames = Math.ceil(scene.duration * FPS);
  const interval    = 1000 / FPS;

  for (let f = 0; f < totalFrames; f++) {
    const fPath = path.join(framesDir, `frame_${String(f).padStart(5,'0')}.png`);
    await page.screenshot({ path: fPath, type: 'png' });
    if (f < totalFrames - 1) await new Promise(r => setTimeout(r, interval));
  }

  await browser.close();
  return totalFrames;
}

// ── TikTok TTS (free, high-energy voice) ─────────────────────
function splitText(text, maxLen = 190) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = '';
  for (const s of sentences) {
    const joined = current ? `${current} ${s}` : s;
    if (joined.length <= maxLen) { current = joined; }
    else { if (current) chunks.push(current); current = s.length > maxLen ? s.slice(0, maxLen) : s; }
  }
  if (current) chunks.push(current);
  return chunks.filter(c => c.trim().length > 0);
}

async function tts(text, outFile) {
  const chunks  = splitText(text);
  const buffers = [];
  for (const chunk of chunks) {
    const res  = await fetch(TIKTOK_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: chunk, voice: TIKTOK_VOICE }),
    });
    const data = await res.json();
    if (!data.success || !data.data) throw new Error(`TikTok TTS failed: ${JSON.stringify(data)}`);
    buffers.push(Buffer.from(data.data, 'base64'));
    await new Promise(r => setTimeout(r, 300));
  }
  fs.writeFileSync(outFile, Buffer.concat(buffers));
}

function getAudioDuration(file) {
  try {
    return parseFloat(
      execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${file}"`,
               { encoding:'utf8' }).trim()
    ) || 5;
  } catch { return 5; }
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('\n🎬  Aivorah — Magnets Lesson Video (24fps animated)\n');
  console.log(`   Scenes: ${SCENES.length} | Voice: Charlie | FPS: ${FPS}\n`);

  const segFiles = [];

  for (let i = 0; i < SCENES.length; i++) {
    const scene      = SCENES[i];
    const sceneFrames = path.join(FRAMES, scene.id);
    const mp3File    = path.join(AUDIO, `${scene.id}.mp3`);
    const segFile    = path.join(SEGS,  `${scene.id}.mp4`);

    fs.mkdirSync(sceneFrames, { recursive: true });

    console.log(`\n[${i+1}/${SCENES.length}] 🎨  ${scene.id}`);

    // 1. Record animated frames
    process.stdout.write('   Recording frames... ');
    const nFrames = await recordScene(scene, sceneFrames);
    console.log(`${nFrames} frames`);

    // 2. Generate voiceover
    process.stdout.write('   Generating voice... ');
    await tts(scene.voice, mp3File);
    const audioDur = getAudioDuration(mp3File);
    console.log(`${audioDur.toFixed(1)}s`);

    // 3. Combine: if voice is longer than animation, loop last frame
    const videoDur = Math.max(scene.duration, audioDur + 0.3);
    process.stdout.write('   Encoding segment... ');
    execSync(
      `ffmpeg -y -r ${FPS} -i "${sceneFrames}/frame_%05d.png" ` +
      `-i "${mp3File}" ` +
      `-c:v libx264 -preset fast -crf 20 ` +
      `-c:a aac -b:a 192k ` +
      `-pix_fmt yuv420p ` +
      `-t ${videoDur.toFixed(2)} ` +
      `-shortest -vf scale=1280:720 ` +
      `"${segFile}"`,
      { stdio: 'pipe' }
    );
    console.log('done');
    segFiles.push(segFile);
  }

  // 4. Concat all segments with crossfade transitions
  console.log('\n🎞️   Assembling final video...');
  const concatList = path.join(OUT_DIR, 'concat.txt');
  fs.writeFileSync(concatList,
    segFiles.map(f => `file '${f.replace(/\\/g,'/')}'`).join('\n')
  );
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatList}" -c copy "${FINAL}"`,
    { stdio: 'inherit' }
  );

  console.log(`\n✅  Done!\n   📁 ${FINAL}\n`);
  console.log('   Import into Canva/CapCut to add subtitles if needed.\n');
}

main().catch(err => { console.error('\n❌ Fatal:', err.message); process.exit(1); });
