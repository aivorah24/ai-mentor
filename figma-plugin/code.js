// Aivorah — Lesson Slide Generator (Figma Plugin)
// Generates design-heavy, minimal-text slides for kids (Grade 3-5)

figma.showUI(__html__, { width: 340, height: 620 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'generate') {
    try {
      await generateAllSlides(msg);
    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: e.message });
    }
  }
  if (msg.type === 'template') {
    try {
      await generateAllSlides({
        title: 'New Lesson',
        grade: 'Grade 3',
        subject: 'Science',
        slides: [
          { type: 'intro',    title: 'Lesson Title', body: 'Subject · Grade', accent: '#0ea5e9' },
          { type: 'concept',  title: 'Concept',      body: 'Explain here.',   accent: '#22c55e' },
          { type: 'quiz',     title: 'Quick Check!', body: 'Question here.',  accent: '#a855f7' },
          { type: 'summary',  title: "Let's Review!", body: 'Summary here.',  accent: '#0ea5e9' },
        ],
      });
    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: e.message });
    }
  }
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

function rect(parent, x, y, w, h, color, opacity = 1, radius = 0) {
  const n = figma.createRectangle();
  n.x = x; n.y = y;
  n.resize(w, h);
  n.fills = [{ type: 'SOLID', color: hexToRgb(color), opacity }];
  if (radius) n.cornerRadius = radius;
  parent.appendChild(n);
  return n;
}

function ellipse(parent, x, y, w, h, color, opacity = 1) {
  const n = figma.createEllipse();
  n.x = x; n.y = y;
  n.resize(w, h);
  n.fills = [{ type: 'SOLID', color: hexToRgb(color), opacity }];
  parent.appendChild(n);
  return n;
}

async function text(parent, content, x, y, size, style, color, maxW = 0, opacity = 1, align = 'LEFT') {
  await figma.loadFontAsync({ family: 'Inter', style });
  const n = figma.createText();
  n.fontName = { family: 'Inter', style };
  n.fontSize = size;
  n.fills = [{ type: 'SOLID', color: hexToRgb(color), opacity }];
  n.textAlignHorizontal = align;
  if (maxW > 0) {
    n.textAutoResize = 'HEIGHT';
    n.resize(maxW, 100);
  }
  n.characters = content;
  n.x = x; n.y = y;
  parent.appendChild(n);
  return n;
}

// ─── Shared chrome ───────────────────────────────────────────────────────────

async function addChrome(frame, slide, idx, total, W, H, accent, grade, subject) {
  // Background
  frame.fills = [{ type: 'SOLID', color: hexToRgb('#0a0f1e') }];

  // Decorative blobs
  ellipse(frame, W - 320, -180, 480, 480, accent, 0.055);
  ellipse(frame, -120, H - 240, 340, 340, accent, 0.04);

  // Left accent bar
  const bar = rect(frame, 0, 0, 6, H, accent);

  // Bottom progress bar track
  rect(frame, 0, H - 4, W, 4, '#1e293b');
  rect(frame, 0, H - 4, Math.round((idx / total) * W), 4, accent);

  // Slide counter
  await text(frame, `${String(idx).padStart(2,'0')} / ${String(total).padStart(2,'0')}`,
    60, 30, 12, 'Bold', accent, 0, 0.55);

  // Grade · Subject pill
  const pill = rect(frame, W - 200, 22, 160, 30, accent, 0.12, 15);
  await text(frame, `${grade}  ·  ${subject}`, W - 190, 30, 11, 'Semi Bold', accent);

  // Aivorah wordmark (bottom left)
  await text(frame, 'AIVORAH', 60, H - 30, 10, 'Bold', '#334155', 0, 1);
}

// ─── Slide types ─────────────────────────────────────────────────────────────

async function drawIntro(frame, slide, W, H, accent) {
  // Big geometric shape right side
  const shapeX = W * 0.55;
  ellipse(frame, shapeX, H / 2 - 220, 440, 440, accent, 0.12);
  ellipse(frame, shapeX + 60, H / 2 - 160, 320, 320, accent, 0.1);
  ellipse(frame, shapeX + 140, H / 2 - 80, 160, 160, accent, 0.18);

  // Extra ring
  const ring = figma.createEllipse();
  ring.x = shapeX + 20; ring.y = H / 2 - 180;
  ring.resize(400, 400);
  ring.fills = [];
  ring.strokes = [{ type: 'SOLID', color: hexToRgb(accent), opacity: 0.2 }];
  ring.strokeWeight = 2;
  frame.appendChild(ring);

  // Eyebrow
  rect(frame, 60, H / 2 - 120, 60, 4, accent, 1, 2);
  await text(frame, 'TODAY\'S LESSON', 60, H / 2 - 105, 11, 'Bold', accent, 0, 0.6);

  // Title
  await text(frame, slide.title, 60, H / 2 - 60, 64, 'Bold', '#f1f5f9', W * 0.48);

  // Subtitle / body
  await text(frame, slide.body, 60, H / 2 + 80, 20, 'Regular', '#64748b', W * 0.45);

  // "Start Learning" pill at bottom
  rect(frame, 60, H / 2 + 140, 200, 48, accent, 1, 24);
  await text(frame, 'Start Learning', 108, H / 2 + 155, 16, 'Bold', '#ffffff');
}

async function drawObjective(frame, slide, W, H, accent) {
  // Header band
  rect(frame, 0, 0, W, 110, accent, 0.08);
  await text(frame, 'LEARNING OBJECTIVES', 60, 38, 11, 'Bold', accent, 0, 0.7);
  await text(frame, slide.title, 60, 58, 36, 'Bold', '#f1f5f9', W - 120);

  // Objective line(s)
  const items = slide.body.split('\n').filter(Boolean);
  let yy = 160;
  for (const item of items) {
    ellipse(frame, 60, yy + 6, 12, 12, accent);
    await text(frame, item.replace(/^[•·\-]\s*/, ''), 88, yy, 22, 'Regular', '#cbd5e1', W - 180);
    yy += 64;
  }
}

async function drawConcept(frame, slide, W, H, accent) {
  // Left half — text content
  const MID = W * 0.5;

  // Label
  rect(frame, 60, 60, 100, 4, accent, 1, 2);
  await text(frame, 'CONCEPT', 60, 72, 10, 'Bold', accent, 0, 0.55);

  // Title — big
  await text(frame, slide.title, 60, 108, 52, 'Bold', '#f1f5f9', MID - 80);

  // Accent underline
  rect(frame, 60, 175, 80, 5, accent, 1, 3);

  // Body
  await text(frame, slide.body, 60, 210, 22, 'Regular', '#94a3b8', MID - 80);

  // Character quote (if present)
  if (slide.character) {
    rect(frame, 60, H - 160, MID - 80, 80, accent, 0.1, 12);
    rect(frame, 60, H - 160, 4, 80, accent, 1, 2);
    await text(frame, slide.character, 80, H - 140, 17, 'Semi Bold', '#e2e8f0', MID - 120);
  }

  // Right half — abstract illustration
  const RX = MID + 40;
  const CY = H / 2;

  // Main circle
  ellipse(frame, RX + 60, CY - 160, 320, 320, accent, 0.15);
  ellipse(frame, RX + 120, CY - 100, 200, 200, accent, 0.12);

  // Small decorative dots
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const r = 180;
    const ex = RX + 220 + Math.cos(angle) * r - 8;
    const ey = CY + Math.sin(angle) * r - 8;
    ellipse(frame, ex, ey, 16, 16, accent, 0.3 + i * 0.1);
  }

  // Big number / icon representation
  await text(frame, String(slide.title[0] || '?'), RX + 130, CY - 100, 160, 'Bold', accent, 0, 0.08);
}

async function drawList(frame, slide, W, H, accent) {
  // Header
  rect(frame, 0, 0, W, 120, accent, 0.07);
  await text(frame, slide.title, 60, 36, 40, 'Bold', '#f1f5f9', W - 120);

  const items = slide.body.split(/[·\n]/).map(s => s.trim()).filter(Boolean);
  const columns = items.length > 4 ? 2 : 1;
  const colW = columns === 2 ? (W - 160) / 2 : W - 160;
  let startY = 160;

  for (let i = 0; i < items.length; i++) {
    const col = columns === 2 ? i % 2 : 0;
    const row = columns === 2 ? Math.floor(i / 2) : i;
    const xx = 60 + col * (colW + 40);
    const yy = startY + row * 72;

    // Card background
    rect(frame, xx, yy, colW, 56, accent, 0.07, 12);
    rect(frame, xx, yy, 4, 56, accent, 1, 2);

    // Number badge
    const badge = rect(frame, xx + 12, yy + 14, 28, 28, accent, 0.2, 8);
    await text(frame, String(i + 1), xx + 18, yy + 18, 14, 'Bold', accent);

    // Item text
    await text(frame, items[i], xx + 52, yy + 16, 16, 'Semi Bold', '#e2e8f0', colW - 70);
  }
}

async function drawQuiz(frame, slide, W, H, accent) {
  // Top strip
  rect(frame, 0, 0, W, 8, accent);

  // Big "?" illustration
  ellipse(frame, W - 360, H / 2 - 200, 400, 400, accent, 0.08);
  await text(frame, '?', W - 240, H / 2 - 150, 200, 'Bold', accent, 0, 0.12, 'CENTER');

  // Label
  rect(frame, 60, 60, 130, 32, accent, 0.15, 16);
  await text(frame, 'QUICK CHECK', 76, 68, 12, 'Bold', accent);

  // Question title
  await text(frame, slide.title, 60, 120, 48, 'Bold', '#f1f5f9', W * 0.55);

  // Question body
  await text(frame, slide.body, 60, 210, 22, 'Regular', '#94a3b8', W * 0.52);

  // Answer space lines
  for (let i = 0; i < 3; i++) {
    rect(frame, 60, 340 + i * 60, W * 0.5, 2, '#1e293b');
    await text(frame, String(i + 1) + '.', 60, 316 + i * 60, 14, 'Bold', '#334155');
  }
}

async function drawSummary(frame, slide, W, H, accent) {
  // Background sweep
  ellipse(frame, W * 0.3, -100, 700, 700, accent, 0.05);

  // Star / celebration shapes
  for (let i = 0; i < 6; i++) {
    const sz = 8 + (i % 3) * 8;
    const angle = (i / 6) * Math.PI * 2;
    ellipse(frame, 900 + Math.cos(angle) * 200 - sz/2,
                   H * 0.35 + Math.sin(angle) * 200 - sz/2, sz, sz, accent, 0.25 + i * 0.1);
  }

  // Label
  await text(frame, 'SUMMARY', 60, 60, 11, 'Bold', accent, 0, 0.6);
  await text(frame, slide.title, 60, 88, 52, 'Bold', '#f1f5f9', W * 0.55);
  rect(frame, 60, 152, 100, 5, accent, 1, 3);

  // Body split into bullet points
  const lines = slide.body.split(/\n\n?/).filter(Boolean);
  let yy = 185;
  for (const line of lines) {
    rect(frame, 60, yy + 8, 5, 5, accent, 1, 3);
    await text(frame, line.replace(/^[•\-]\s*/, ''), 82, yy, 21, 'Regular', '#cbd5e1', W * 0.52);
    yy += 72;
  }

  // Well done badge
  rect(frame, 60, H - 130, 260, 64, accent, 1, 32);
  await text(frame, 'Well Done!', 114, H - 112, 20, 'Bold', '#ffffff');
  await text(frame, 'You mastered this lesson', 60, H - 80, 13, 'Regular', '#ffffff', 0, 0.75);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function generateAllSlides({ title, grade, subject, slides }) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

  const W = 1280, H = 720;
  const page = figma.currentPage;
  const total = slides.length;
  const created = [];

  for (let i = 0; i < total; i++) {
    const slide = slides[i];
    const accent = slide.accent || '#0ea5e9';

    const frame = figma.createFrame();
    frame.name = `${String(i + 1).padStart(2, '0')} — ${slide.title}`;
    frame.resize(W, H);
    frame.x = i * (W + 80);
    frame.y = 0;
    frame.clipsContent = true;

    await addChrome(frame, slide, i + 1, total, W, H, accent, grade, subject);

    switch (slide.type) {
      case 'intro':      await drawIntro(frame, slide, W, H, accent);     break;
      case 'objective':  await drawObjective(frame, slide, W, H, accent);  break;
      case 'concept':    await drawConcept(frame, slide, W, H, accent);    break;
      case 'list':       await drawList(frame, slide, W, H, accent);       break;
      case 'quiz':       await drawQuiz(frame, slide, W, H, accent);       break;
      case 'summary':    await drawSummary(frame, slide, W, H, accent);    break;
      default:           await drawConcept(frame, slide, W, H, accent);    break;
    }

    page.appendChild(frame);
    created.push(frame);
  }

  figma.viewport.scrollAndZoomIntoView(created);
  figma.ui.postMessage({ type: 'done', count: total });
}

async function generateTemplate() {
  await generateAllSlides({
    title: 'New Lesson',
    grade: 'Grade 3',
    subject: 'Science',
    slides: [
      { type: 'intro',     title: 'Lesson Title',    body: 'Subject · Grade',          accent: '#0ea5e9' },
      { type: 'objective', title: 'What We\'ll Learn', body: 'Students will be able to...', accent: '#f59e0b' },
      { type: 'concept',   title: 'Concept Name',    body: 'Explain the key idea.',    accent: '#22c55e' },
      { type: 'list',      title: 'Key Points',      body: 'Point 1 · Point 2 · Point 3', accent: '#a855f7' },
      { type: 'quiz',      title: 'Quick Check!',    body: 'Ask a question here.',     accent: '#ec4899' },
      { type: 'summary',   title: "Let's Review!",   body: 'Summary point one.\n\nSummary point two.', accent: '#0ea5e9' },
    ],
  });
}
