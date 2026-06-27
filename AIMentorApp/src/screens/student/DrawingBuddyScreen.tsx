import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Platform, TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import Header from '../../components/common/Header';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius, fonts } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface DrawActivity {
  title:        string;
  instruction:  string;
  targetShape:  string;
  steps:        string[];
  encouragement:string;
  tryThis:      string;
}

interface Feedback {
  praise:       string;
  suggestion:   string;
  encouragement:string;
  score:        number;
  spokenText:   string;
}

type DrawTool = 'pencil' | 'line' | 'rect' | 'circle' | 'triangle' | 'star' | 'fill' | 'eraser';

const COLORS      = ['#ef4444','#f97316','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#f472b6','#000000','#ffffff'];
const BRUSH_SIZES = [2, 4, 8, 14, 20];

const TOOLS: { key: DrawTool; icon: string; label: string }[] = [
  { key: 'pencil',   icon: 'edit-2',    label: 'Pencil'  },
  { key: 'line',     icon: 'minus',     label: 'Line'    },
  { key: 'rect',     icon: 'square',    label: 'Box'     },
  { key: 'circle',   icon: 'circle',    label: 'Circle'  },
  { key: 'triangle', icon: 'triangle',  label: 'Triangle'},
  { key: 'star',     icon: 'star',      label: 'Star'    },
  { key: 'fill',     icon: 'droplet',   label: 'Fill'    },
  { key: 'eraser',   icon: 'delete',    label: 'Eraser'  },
];

// ── Guide renderer — uses guideShapes primitives from server, with fallbacks
type Primitive =
  | { type: 'ellipse'; x: number; y: number; rx: number; ry: number; rot?: number }
  | { type: 'circle';  x: number; y: number; r: number }
  | { type: 'rect';    x: number; y: number; w: number; h: number }
  | { type: 'line';    x1: number; y1: number; x2: number; y2: number }
  | { type: 'triangle'; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number };

function drawPrimitives(ctx: any, shapes: Primitive[], cx: number, cy: number, accent: string) {
  // Parse accent to rgba
  const hex = accent.replace('#', '');
  const r = parseInt(hex.slice(0,2), 16);
  const g = parseInt(hex.slice(2,4), 16);
  const b = parseInt(hex.slice(4,6), 16);
  ctx.save();
  ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`;
  ctx.fillStyle   = `rgba(${r},${g},${b},0.08)`;
  ctx.lineWidth   = 2.5;
  ctx.setLineDash([8, 6]);
  for (const s of shapes) {
    ctx.beginPath();
    switch (s.type) {
      case 'ellipse':
        ctx.ellipse(cx + s.x, cy + s.y, s.rx, s.ry, s.rot || 0, 0, Math.PI * 2);
        ctx.stroke(); ctx.fill(); break;
      case 'circle':
        ctx.arc(cx + s.x, cy + s.y, s.r, 0, Math.PI * 2);
        ctx.stroke(); ctx.fill(); break;
      case 'rect':
        ctx.rect(cx + s.x, cy + s.y, s.w, s.h);
        ctx.stroke(); ctx.fill(); break;
      case 'line':
        ctx.moveTo(cx + s.x1, cy + s.y1); ctx.lineTo(cx + s.x2, cy + s.y2);
        ctx.stroke(); break;
      case 'triangle':
        ctx.moveTo(cx + s.x1, cy + s.y1);
        ctx.lineTo(cx + s.x2, cy + s.y2);
        ctx.lineTo(cx + s.x3, cy + s.y3);
        ctx.closePath(); ctx.stroke(); ctx.fill(); break;
    }
  }
  ctx.restore();
}

// ── Guide templates — dotted outlines for common objects ─────────────────────
function drawGuide(ctx: any, targetShape: string, W: number, H: number, accent = '#BAA467', guideShapes?: Primitive[]) {
  const cx = W / 2, cy = H / 2;

  // Prefer server-provided primitives if available
  if (guideShapes && guideShapes.length > 0) {
    drawPrimitives(ctx, guideShapes, cx, cy, accent);
    const hex = accent.replace('#', '');
    const r = parseInt(hex.slice(0,2), 16);
    const g = parseInt(hex.slice(2,4), 16);
    const b = parseInt(hex.slice(4,6), 16);
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(${r},${g},${b},0.6)`;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Trace over the dotted ${targetShape}!`, cx, 22);
    ctx.restore();
    return;
  }

  const hex = accent.replace('#', '');
  const r = parseInt(hex.slice(0,2), 16);
  const g = parseInt(hex.slice(2,4), 16);
  const b = parseInt(hex.slice(4,6), 16);
  ctx.save();
  ctx.strokeStyle = `rgba(${r},${g},${b},0.55)`;
  ctx.fillStyle   = `rgba(${r},${g},${b},0.08)`;
  ctx.lineWidth   = 2.5;
  ctx.setLineDash([8, 6]);

  const shape = targetShape.toLowerCase();

  if (/bus|car|truck|vehicle/.test(shape)) {
    // Bus body
    ctx.beginPath(); ctx.rect(cx - 200, cy - 60, 400, 120); ctx.stroke(); ctx.fill();
    // Wheels
    ctx.beginPath(); ctx.arc(cx - 130, cy + 60, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 130, cy + 60, 30, 0, Math.PI * 2); ctx.stroke();
    // Windows
    ctx.beginPath(); ctx.rect(cx - 170, cy - 45, 60, 50); ctx.stroke();
    ctx.beginPath(); ctx.rect(cx - 90,  cy - 45, 60, 50); ctx.stroke();
    ctx.beginPath(); ctx.rect(cx - 10,  cy - 45, 60, 50); ctx.stroke();
    ctx.beginPath(); ctx.rect(cx + 70,  cy - 45, 60, 50); ctx.stroke();
  } else if (/bee|honeybee|wasp/.test(shape)) {
    // Body oval
    ctx.beginPath(); ctx.ellipse(cx, cy + 10, 80, 50, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
    // Head
    ctx.beginPath(); ctx.arc(cx, cy - 50, 30, 0, Math.PI * 2); ctx.stroke();
    // Wings
    ctx.beginPath(); ctx.ellipse(cx - 80, cy - 20, 50, 25, -0.4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx + 80, cy - 20, 50, 25, 0.4,  0, Math.PI * 2); ctx.stroke();
  } else if (/mango|fruit|apple|orange/.test(shape)) {
    ctx.beginPath(); ctx.ellipse(cx, cy + 10, 80, 100, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx, cy - 90); ctx.lineTo(cx + 30, cy - 130); ctx.stroke(); // stem
  } else if (/fish/.test(shape)) {
    ctx.beginPath(); ctx.ellipse(cx - 20, cy, 110, 60, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 90, cy - 60); ctx.lineTo(cx + 150, cy); ctx.lineTo(cx + 90, cy + 60);
    ctx.closePath(); ctx.stroke();
  } else if (/house|home|hut/.test(shape)) {
    // Walls
    ctx.beginPath(); ctx.rect(cx - 120, cy, 240, 140); ctx.stroke(); ctx.fill();
    // Roof
    ctx.beginPath(); ctx.moveTo(cx - 140, cy); ctx.lineTo(cx, cy - 120); ctx.lineTo(cx + 140, cy); ctx.closePath(); ctx.stroke();
    // Door
    ctx.beginPath(); ctx.rect(cx - 30, cy + 60, 60, 80); ctx.stroke();
  } else if (/cube|box|cuboid/.test(shape)) {
    // Front face
    ctx.beginPath(); ctx.rect(cx - 80, cy - 40, 140, 120); ctx.stroke(); ctx.fill();
    // Top face
    ctx.beginPath();
    ctx.moveTo(cx - 80, cy - 40); ctx.lineTo(cx - 20, cy - 100);
    ctx.lineTo(cx + 120, cy - 100); ctx.lineTo(cx + 60, cy - 40);
    ctx.closePath(); ctx.stroke();
    // Right side
    ctx.beginPath();
    ctx.moveTo(cx + 60, cy - 40); ctx.lineTo(cx + 120, cy - 100);
    ctx.lineTo(cx + 120, cy + 20); ctx.lineTo(cx + 60, cy + 80);
    ctx.closePath(); ctx.stroke();
  } else if (/tree|plant/.test(shape)) {
    // Trunk
    ctx.beginPath(); ctx.rect(cx - 20, cy + 20, 40, 100); ctx.stroke();
    // Leaves
    ctx.beginPath(); ctx.arc(cx, cy - 40, 90, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
  } else if (/flower/.test(shape)) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * 55, cy + Math.sin(a) * 55, 30, 18, a, 0, Math.PI * 2);
      ctx.stroke(); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, cy, 28, 0, Math.PI * 2); ctx.stroke();
  } else if (/butterfly/.test(shape)) {
    ctx.beginPath(); ctx.ellipse(cx - 80, cy - 30, 70, 50, 0.3, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 80, cy - 30, 70, 50, -0.3, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx - 50, cy + 40, 40, 28, 0.5, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 50, cy + 40, 40, 28, -0.5, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, cy, 12, 60, 0, 0, Math.PI * 2); ctx.stroke();
  } else {
    // Generic: simple oval placeholder
    ctx.beginPath(); ctx.ellipse(cx, cy, 130, 90, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
    // Label
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(99,102,241,0.4)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Trace: ${targetShape}`, cx, cy + 4);
  }

  // "Trace me!" label at top
  ctx.setLineDash([]);
  ctx.fillStyle = `rgba(${r},${g},${b},0.6)`;
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Trace over the dotted ${targetShape}!`, cx, 22);
  ctx.restore();
}

function scoreToStars(score: number): number {
  if (score >= 90) return 3;
  if (score >= 80) return 2;
  if (score >= 70) return 1;
  return 0;
}

function StarsDisplay({ stars, max = 3 }: { stars: number; max?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {Array.from({ length: max }).map((_, i) => (
        <Feather
          key={i}
          name="star"
          size={22}
          color={i < stars ? '#f59e0b' : '#ffffff20'}
          style={i < stars ? { opacity: 1 } : { opacity: 0.4 }}
        />
      ))}
    </View>
  );
}

// Aivorah pastel accents per subject
const SUBJECT_ACCENT: Record<string, string> = {
  Mathematics: '#BAA467',
  Science: '#BAA467',
  English: '#BAA467',
  'Social Studies': '#BAA467',
  Arts: '#BAA467',
  'Physical Education': '#BAA467',
  ICT: '#BAA467',
};

export default function DrawingBuddyScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const { topic, chapterId, unit, subject = 'Science', grade = 'Grade 3', curriculum = 'IB PYP' } = route.params ?? {};
  const isScience = subject === 'Science';
  const accent = SUBJECT_ACCENT[subject] || '#BAA467';

  const [loading,          setLoading]          = useState(false);
  const [activity,         setActivity]         = useState<DrawActivity | null>(null);
  const [error,            setError]            = useState('');
  // All steps shown immediately — no step-by-step tapping
  const currentStep   = 0;
  const allStepsShown = true;
  const [tool,             setTool]             = useState<DrawTool>('pencil');
  const [color,            setColor]            = useState('#3b82f6');
  const [brushSize,        setBrushSize]        = useState(6);
  const [analyzing,        setAnalyzing]        = useState(false);
  const [feedback,         setFeedback]         = useState<Feedback | null>(null);
  const [feedbackError,    setFeedbackError]    = useState('');
  const [speakingFeedback, setSpeakingFeedback] = useState(false);
  const [improving,        setImproving]        = useState(false);
  const [improveFocus,     setImproveFocus]     = useState<string | null>(null);
  const [totalStars,       setTotalStars]       = useState(0);
  const [sessionStars,     setSessionStars]     = useState<number[]>([]);
  const [showGuide,        setShowGuide]        = useState(false);
  const [usedTargets,      setUsedTargets]      = useState<string[]>([]);

  const canvasRef      = useRef<any>(null);
  const isDrawing      = useRef(false);
  const startPos       = useRef<{ x: number; y: number } | null>(null);
  const savedImg       = useRef<ImageData | null>(null);
  const feedbackAudio  = useRef<any>(null);

  // Stop audio when navigating away (drawer keeps screen mounted)
  useEffect(() => {
    const unsubBlur = navigation.addListener('blur', () => {
      if (feedbackAudio.current) {
        try { feedbackAudio.current.pause(); feedbackAudio.current.src = ''; } catch {}
        feedbackAudio.current = null;
      }
      if (Platform.OS === 'web' && (window as any).speechSynthesis) {
        try { (window as any).speechSynthesis.cancel(); } catch {}
      }
      setSpeakingFeedback(false);
    });
    return () => {
      unsubBlur();
      if (feedbackAudio.current) {
        try { feedbackAudio.current.pause(); feedbackAudio.current.src = ''; } catch {}
      }
    };
  }, [navigation]);

  const fetchActivity = useCallback(async (improveNote?: string) => {
    setLoading(true); setActivity(null); setError('');
    setFeedback(null); setFeedbackError('');
    setImproveFocus(null);
    try {
      const res  = await fetch(`${SERVER_URL}/modules/drawing-buddy`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, unit, subject, grade, curriculum, improveNote, usedTargets }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setActivity(data);
      if (data.targetShape) setUsedTargets(prev => [...prev, data.targetShape]);
    } catch {
      setError('Could not load drawing activity. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [topic, unit, subject]);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  // ── Canvas helpers ──────────────────────────────────────────────────────────
  function getPos(e: any) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches?.[0] ?? e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  function getCtx() {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return null;
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.lineWidth   = tool === 'eraser' ? brushSize * 3 : brushSize;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    return ctx;
  }

  function drawShape(ctx: any, sx: number, sy: number, ex: number, ey: number) {
    ctx.beginPath();
    switch (tool) {
      case 'line':
        ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
        ctx.stroke(); break;
      case 'rect':
        ctx.strokeRect(sx, sy, ex - sx, ey - sy); break;
      case 'circle': {
        const rx = Math.abs(ex - sx) / 2;
        const ry = Math.abs(ey - sy) / 2;
        const cx = sx + (ex - sx) / 2;
        const cy = sy + (ey - sy) / 2;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        ctx.stroke(); break;
      }
      case 'triangle':
        ctx.moveTo(sx + (ex - sx) / 2, sy);
        ctx.lineTo(ex, ey);
        ctx.lineTo(sx, ey);
        ctx.closePath();
        ctx.stroke(); break;
      case 'star': {
        const scx = sx + (ex - sx) / 2, scy = sy + (ey - sy) / 2;
        const outerR = Math.max(Math.abs(ex - sx), Math.abs(ey - sy)) / 2;
        const innerR = outerR * 0.4;
        ctx.moveTo(scx, scy - outerR);
        for (let i = 0; i < 10; i++) {
          const a = (i * Math.PI) / 5 - Math.PI / 2;
          const r = i % 2 === 0 ? outerR : innerR;
          ctx.lineTo(scx + r * Math.cos(a), scy + r * Math.sin(a));
        }
        ctx.closePath(); ctx.stroke(); break;
      }
    }
  }

  function onMouseDown(e: any) {
    const pos = getPos(e);
    if (!pos) return;

    // Fill tool — instant action on click
    if (tool === 'fill') {
      floodFill(pos.x, pos.y, color);
      return;
    }

    isDrawing.current = true;
    startPos.current  = pos;

    const ctx = getCtx();
    if (!ctx) return;

    if (tool === 'pencil' || tool === 'eraser') {
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    } else {
      savedImg.current = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }

  function onMouseMove(e: any) {
    if (!isDrawing.current) return;
    const pos = getPos(e);
    if (!pos) return;
    const ctx = getCtx();
    if (!ctx) return;

    if (tool === 'pencil' || tool === 'eraser') {
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (startPos.current && savedImg.current) {
      ctx.putImageData(savedImg.current, 0, 0);
      drawShape(ctx, startPos.current.x, startPos.current.y, pos.x, pos.y);
    }
  }

  function onMouseUp(e: any) {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const pos = getPos(e);
    const ctx = getCtx();
    if (ctx && pos && startPos.current && !['pencil','eraser'].includes(tool)) {
      if (savedImg.current) ctx.putImageData(savedImg.current, 0, 0);
      drawShape(ctx, startPos.current.x, startPos.current.y, pos.x, pos.y);
    }
    startPos.current = null;
    savedImg.current = null;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (showGuide && activity) {
      const shapeKey = (activity as any).guideType || activity.targetShape;
      drawGuide(ctx, shapeKey, canvas.width, canvas.height);
    }
    setFeedback(null);
  }

  function toggleGuide() {
    const canvas = canvasRef.current;
    if (!canvas || !activity) return;
    const ctx = canvas.getContext('2d');
    // Use guideType from server if available, else fall back to targetShape text
    const shapeKey = (activity as any).guideType || activity.targetShape;
    if (!showGuide) {
      drawGuide(ctx, shapeKey, canvas.width, canvas.height);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setShowGuide(g => !g);
    setFeedback(null);
  }

  // ── Flood fill (paint bucket) ─────────────────────────────────────────────
  function floodFill(startX: number, startY: number, fillColorHex: string) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx  = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const imgData = ctx.getImageData(0, 0, W, H);
    const data    = imgData.data;

    // Parse fill colour
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = 1;
    const tc = tmp.getContext('2d')!;
    tc.fillStyle = fillColorHex;
    tc.fillRect(0, 0, 1, 1);
    const [fr, fg, fb, fa] = tc.getImageData(0, 0, 1, 1).data;

    const idx  = (x: number, y: number) => (y * W + x) * 4;
    const si   = idx(Math.floor(startX), Math.floor(startY));
    const [tr, tg, tb, ta] = [data[si], data[si+1], data[si+2], data[si+3]];

    if (tr === fr && tg === fg && tb === fb && ta === fa) return;

    const match = (i: number) => data[i]===tr && data[i+1]===tg && data[i+2]===tb && data[i+3]===ta;
    const paint = (i: number) => { data[i]=fr; data[i+1]=fg; data[i+2]=fb; data[i+3]=255; };

    const stack = [{ x: Math.floor(startX), y: Math.floor(startY) }];
    const seen  = new Uint8Array(W * H);
    while (stack.length) {
      const { x, y } = stack.pop()!;
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const i = idx(x, y);
      if (seen[y * W + x] || !match(i)) continue;
      seen[y * W + x] = 1;
      paint(i);
      stack.push({ x: x+1, y }, { x: x-1, y }, { x, y: y+1 }, { x, y: y-1 });
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // ── AI Feedback ─────────────────────────────────────────────────────────────
  async function getAIFeedback() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx  = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const hasContent = Array.from(data).some((v, i) => i % 4 !== 3 && v !== 255 && v !== 0);
    if (!hasContent) {
      alert('Please draw something first!');
      return;
    }

    setAnalyzing(true); setFeedback(null); setFeedbackError('');
    try {
      const imageBase64 = canvas.toDataURL('image/png').split(',')[1];
      const res  = await fetch(`${SERVER_URL}/modules/drawing-feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          topic, unit,
          task:        activity?.title ?? topic,
          targetShape: activity?.targetShape ?? activity?.title ?? topic,
          improveFocus,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setFeedback(data);

      // Track stars for this session
      const stars = scoreToStars(data.score);
      setSessionStars(prev => [...prev, stars]);
      setTotalStars(prev => prev + stars);

      speakFeedback(data.spokenText);
    } catch {
      setFeedbackError('Ms. Zara could not check your drawing. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleImprove() {
    if (!feedback) return;
    setImproving(true);
    clearCanvas();
    const note = feedback.suggestion;
    setImproveFocus(note);
    await fetchActivity(note);
    setImproving(false);
  }

  async function speakFeedback(text: string) {
    if (Platform.OS !== 'web') return;
    // Stop any currently playing feedback audio
    if (feedbackAudio.current) {
      try { feedbackAudio.current.pause(); feedbackAudio.current.src = ''; } catch {}
      feedbackAudio.current = null;
    }
    setSpeakingFeedback(true);
    try {
      const res  = await fetch(`${SERVER_URL}/lesson/tts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.audioUrl) {
        const audio = new (window as any).Audio(`${SERVER_URL}${data.audioUrl}`);
        feedbackAudio.current = audio;
        audio.onended = () => { feedbackAudio.current = null; setSpeakingFeedback(false); };
        audio.onerror = () => { feedbackAudio.current = null; setSpeakingFeedback(false); };
        audio.play();
        return;
      }
    } catch (_) {}
    setSpeakingFeedback(false);
  }

  const scoreColor = (score: number) =>
    score >= 85 ? '#10b981' : score >= 70 ? '#f59e0b' : '#ef4444';

  const backLabel = `Back to ${subject} Topics`;

  return (
    <ScreenLayout>
      <View style={[s.screen, { backgroundColor: colors.bgDark }]}>
        <Header
          title="Drawing Buddy"
          subtitle={`${curriculum} · ${grade} · ${topic}`}
          showBack={true}
          onMenuPress={() => navigation.openDrawer()}
        />

        {/* Back to Subject Topics */}
        <TouchableOpacity
          style={s.backRow}
          onPress={() => navigation.navigate('SubjectTopics', { subject, grade, curriculum })}
        >
          <Feather name="arrow-left" size={16} color={accent} />
          <Text style={[s.backText, { color: accent }]}>{backLabel}</Text>
        </TouchableOpacity>

        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

          {/* Session stars banner */}
          {sessionStars.length > 0 && (
            <View style={[s.sessionBanner, { backgroundColor: '#f59e0b15', borderColor: '#f59e0b30' }]}>
              <Feather name="award" size={16} color="#f59e0b" />
              <Text style={[s.sessionBannerText, { color: '#f59e0b' }]}>
                Session Stars: {totalStars} / {sessionStars.length * 3}
              </Text>
            </View>
          )}

          {loading && (
            <View style={s.center}>
              <ActivityIndicator size="large" color={accent} />
              <Text style={[s.hint, { color: colors.textMuted, marginTop: 12 }]}>
                {improveFocus ? 'Preparing a focused improvement task…' : 'Preparing your drawing task…'}
              </Text>
            </View>
          )}

          {error ? (
            <View style={s.center}>
              <Feather name="alert-circle" size={28} color={colors.accentRed} />
              <Text style={[s.hint, { color: colors.textMuted, marginTop: 8 }]}>{error}</Text>
              <TouchableOpacity style={[s.btn, { backgroundColor: accent, marginTop: 12 }]} onPress={() => fetchActivity()}>
                <Text style={s.btnText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {activity && !loading && (
            <>
              {/* Improve focus banner */}
              {improveFocus && (
                <View style={[s.improveBanner, { backgroundColor: '#BAA46715', borderColor: '#BAA46730' }]}>
                  <Feather name="target" size={14} color="#BAA467" />
                  <Text style={[s.improveBannerText, { color: '#BAA467' }]}>
                    Focus: {improveFocus}
                  </Text>
                </View>
              )}

              {/* Task card */}
              <View style={[s.taskCard, { backgroundColor: accent + '18', borderColor: accent + '40' }]}>
                <View style={s.taskHeader}>
                  <Feather name="edit-3" size={16} color={accent} />
                  <Text style={[s.taskTitle, { color: accent }]}>{activity.title}</Text>
                </View>
                <Text style={[s.taskDesc, { color: colors.textMain }]}>{activity.instruction}</Text>
              </View>

              {/* All steps shown at once */}
              <View style={[s.card, { backgroundColor: colors.cardDark, borderColor: colors.accentYellow + '30' }]}>
                <View style={s.cardHeader}>
                  <Feather name="list" size={15} color={colors.accentYellow} />
                  <Text style={[s.cardTitle, { color: colors.accentYellow }]}>
                    How to draw it ({activity.steps.length} steps)
                  </Text>
                </View>

                {activity.steps.map((step, i) => (
                  <View key={i} style={s.stepRow}>
                    <View style={[s.stepNum, { backgroundColor: colors.accentYellow }]}>
                      <Text style={s.stepNumText}>{i + 1}</Text>
                    </View>
                    <Text style={[s.stepText, { color: colors.textMain }]}>
                      {step.replace(/^Step \d+:\s*/i, '')}
                    </Text>
                  </View>
                ))}

                <View style={[s.allDoneBanner, { backgroundColor: '#10b98115', borderColor: '#10b98130' }]}>
                  <Feather name="edit-2" size={14} color="#10b981" />
                  <Text style={[s.allDoneText, { color: '#10b981' }]}>
                    Read the steps, then draw below and tap Get Feedback!
                  </Text>
                </View>
              </View>

              {/* Drawing board — web only */}
              {Platform.OS === 'web' && (
                <View style={[s.boardCard, { backgroundColor: colors.cardDark, borderColor: '#BAA46730',
                  opacity: allStepsShown ? 1 : 0.5 }]}>
                  {!allStepsShown && (
                    <View style={[s.canvasOverlay]}>
                      <Feather name="lock" size={24} color={colors.textMuted} />
                      <Text style={[s.hint, { color: colors.textMuted, marginTop: 8 }]}>
                        Complete all steps above first
                      </Text>
                    </View>
                  )}
                  <Text style={[s.boardTitle, { color: colors.textMain }]}>Your Drawing Board</Text>

                  {/* Tool selector */}
                  <View style={s.toolRow}>
                    <Text style={[s.toolLabel, { color: colors.textMuted }]}>Tool:</Text>
                    {TOOLS.map(t => (
                      <TouchableOpacity
                        key={t.key}
                        onPress={() => setTool(t.key)}
                        disabled={!allStepsShown}
                        style={[s.toolBtn, {
                          backgroundColor: tool === t.key ? '#BAA467' + '25' : 'transparent',
                          borderColor:     tool === t.key ? '#BAA467' : colors.borderColor,
                        }]}
                      >
                        <Feather name={t.icon as any} size={13} color={tool === t.key ? '#BAA467' : colors.textMuted} />
                        <Text style={[s.toolBtnText, { color: tool === t.key ? '#BAA467' : colors.textMuted }]}>
                          {t.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Colour picker */}
                  <View style={s.toolRow}>
                    <Text style={[s.toolLabel, { color: colors.textMuted }]}>Colour:</Text>
                    {COLORS.map(c => (
                      <TouchableOpacity
                        key={c}
                        onPress={() => { setColor(c); if (tool === 'eraser') setTool('pencil'); }}
                        disabled={!allStepsShown}
                        style={[s.colorDot, {
                          backgroundColor: c,
                          borderWidth: color === c && tool !== 'eraser' ? 3 : 1,
                          borderColor: color === c && tool !== 'eraser' ? '#fff' : '#ffffff30',
                        }]}
                      />
                    ))}
                  </View>

                  {/* Brush size + clear */}
                  <View style={s.toolRow}>
                    <Text style={[s.toolLabel, { color: colors.textMuted }]}>Size:</Text>
                    {BRUSH_SIZES.map(b => (
                      <TouchableOpacity
                        key={b}
                        onPress={() => setBrushSize(b)}
                        disabled={!allStepsShown}
                        style={[s.sizeBtn, {
                          backgroundColor: brushSize === b ? colors.accentYellow + '25' : 'transparent',
                          borderColor:     brushSize === b ? colors.accentYellow : colors.borderColor,
                        }]}
                      >
                        <View style={{
                          width: b + 2, height: b + 2, borderRadius: (b + 2) / 2,
                          backgroundColor: tool === 'eraser' ? '#ffffff60' : color,
                        }} />
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      onPress={clearCanvas}
                      disabled={!allStepsShown}
                      style={[s.clearBtn, { borderColor: colors.accentRed + '60' }]}
                    >
                      <Feather name="trash-2" size={13} color={colors.accentRed} />
                      <Text style={{ color: colors.accentRed, fontSize: 12, fontWeight: '700' }}>Clear</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Canvas */}
                  <canvas
                    ref={canvasRef}
                    width={720}
                    height={400}
                    style={{
                      background: '#ffffff',
                      borderRadius: 12,
                      cursor: !allStepsShown ? 'not-allowed' : tool === 'eraser' ? 'cell' : tool === 'fill' ? 'cell' : 'crosshair',
                      touchAction: 'none',
                      width: '100%',
                      maxWidth: 720,
                      border: '1px solid #BAA46730',
                      pointerEvents: allStepsShown ? 'auto' : 'none',
                    } as any}
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={onMouseUp}
                    onTouchStart={onMouseDown}
                    onTouchMove={onMouseMove}
                    onTouchEnd={onMouseUp}
                  />

                  {/* Guide toggle button */}
                  <TouchableOpacity
                    onPress={toggleGuide}
                    style={[s.guideBtn, {
                      backgroundColor: showGuide ? '#BAA46725' : '#BAA46710',
                      borderColor: showGuide ? '#BAA467' : '#BAA46740',
                      borderWidth: showGuide ? 2 : 1,
                    }]}
                  >
                    <Feather name="map" size={14} color="#BAA467" />
                    <Text style={{ color: '#BAA467', fontSize: 13, fontWeight: '700' }}>
                      {showGuide ? 'Hide Guide' : 'Show Dotted Guide'}
                    </Text>
                  </TouchableOpacity>

                  {!showGuide && !feedback && (
                    <View style={[s.drawHint, { backgroundColor: '#BAA46710', borderColor: '#BAA46730' }]}>
                      <Feather name="arrow-down" size={13} color="#BAA467" />
                      <Text style={{ color: '#BAA467', fontSize: 12, fontWeight: '600' }}>
                        Draw below, then tap Get Feedback at the bottom!
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Mobile: paper instructions */}
              {Platform.OS !== 'web' && (
                <View style={[s.card, { backgroundColor: '#fef3c715', borderColor: '#f59e0b30' }]}>
                  <Feather name="book-open" size={20} color="#f59e0b" />
                  <Text style={[s.stepText, { color: colors.textMain }]}>
                    Get a pencil and paper. Follow the steps above to draw!
                  </Text>
                </View>
              )}

              {/* AI Feedback error */}
              {feedbackError ? (
                <View style={[s.card, { backgroundColor: colors.cardDark, borderColor: colors.accentRed + '40', flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                  <Feather name="alert-circle" size={18} color={colors.accentRed} />
                  <Text style={[s.stepText, { color: colors.textMuted }]}>{feedbackError}</Text>
                </View>
              ) : null}

              {/* AI Feedback result */}
              {feedback && (
                <View style={[s.feedbackCard, { backgroundColor: colors.cardDark, borderColor: '#BAA46730' }]}>
                  {/* Score + Stars */}
                  <View style={s.scoreRow}>
                    <View style={[s.scoreBadge, { backgroundColor: scoreColor(feedback.score) + '20' }]}>
                      <Text style={[s.scoreText, { color: scoreColor(feedback.score) }]}>
                        {feedback.score}/100
                      </Text>
                    </View>
                    <StarsDisplay stars={scoreToStars(feedback.score)} />
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity
                      onPress={() => speakFeedback(feedback.spokenText)}
                      style={[s.speakBtn, { backgroundColor: '#BAA46720', borderColor: '#BAA46740' }]}
                    >
                      <Feather name={speakingFeedback ? 'volume-2' : 'play'} size={13} color="#BAA467" />
                      <Text style={{ color: '#BAA467', fontSize: 11, fontWeight: '700' }}>
                        {speakingFeedback ? 'Speaking…' : 'Replay'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={[s.feedbackLabel, { color: colors.textMuted, marginBottom: 4 }]}>Ms. Zara's Feedback</Text>

                  <View style={[s.feedbackRow, { borderColor: '#10b98125' }]}>
                    <Feather name="star" size={15} color="#10b981" />
                    <Text style={[s.feedbackText, { color: colors.textMain }]}>{feedback.praise}</Text>
                  </View>
                  <View style={[s.feedbackRow, { borderColor: '#f59e0b25' }]}>
                    <Feather name="arrow-up-circle" size={15} color="#f59e0b" />
                    <Text style={[s.feedbackText, { color: colors.textMain }]}>{feedback.suggestion}</Text>
                  </View>
                  <View style={[s.feedbackRow, { borderColor: '#BAA46725', backgroundColor: '#BAA46708' }]}>
                    <Feather name="award" size={15} color="#BAA467" />
                    <Text style={[s.feedbackText, { color: colors.textMain, fontWeight: '700' }]}>{feedback.encouragement}</Text>
                  </View>

                  {/* Improve button */}
                  {scoreToStars(feedback.score) < 3 && (
                    <TouchableOpacity
                      style={[s.improveBtn, { backgroundColor: '#f59e0b20', borderColor: '#f59e0b50' }]}
                      onPress={handleImprove}
                      disabled={improving}
                    >
                      {improving ? (
                        <ActivityIndicator size="small" color="#f59e0b" />
                      ) : (
                        <Feather name="refresh-cw" size={14} color="#f59e0b" />
                      )}
                      <Text style={[s.improveBtnText, { color: '#f59e0b' }]}>
                        {improving ? 'Getting new task…' : 'Improve My Drawing'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <View style={s.actionRow}>
                <TouchableOpacity
                  style={[s.btn, { backgroundColor: accent, flex: 1 }]}
                  onPress={() => fetchActivity()}
                >
                  <Feather name="refresh-cw" size={14} color="#fff" />
                  <Text style={s.btnText}>New Drawing Task</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.btn, { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: accent, flex: 1 }]}
                  onPress={() => navigation.navigate('SubjectTopics', { subject, grade, curriculum })}
                >
                  <Feather name="arrow-left" size={14} color={accent} />
                  <Text style={[s.btnText, { color: accent }]}>{backLabel}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>

        {/* Sticky feedback bar — always visible once canvas is unlocked */}
        {allStepsShown && Platform.OS === 'web' && (
          <View style={[s.stickyBar, { backgroundColor: colors.bgDark, borderTopColor: accent + '30' }]}>
            <TouchableOpacity
              style={[s.stickyFeedbackBtn, {
                backgroundColor: analyzing ? colors.cardDark : accent,
                borderColor: accent,
                borderWidth: analyzing ? 1 : 0,
                flex: 1,
              }]}
              onPress={getAIFeedback}
              disabled={analyzing}
            >
              {analyzing ? (
                <>
                  <ActivityIndicator size="small" color={accent} />
                  <Text style={[s.feedbackBtnText, { color: accent }]}>
                    Ms. Zara is checking your drawing…
                  </Text>
                </>
              ) : (
                <>
                  <Feather name="eye" size={18} color="#fff" />
                  <Text style={s.feedbackBtnText}>Get Ms. Zara's Feedback</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScreenLayout>
  );
}

const s = StyleSheet.create({
  screen:        { flex: 1 },
  backRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.xl, paddingTop: 12, paddingBottom: 4 },
  backText:      { fontSize: 13, fontWeight: '700' },
  content:       { padding: spacing.xl, paddingBottom: 100, gap: spacing.md },
  center:        { alignItems: 'center', paddingVertical: 48 },
  hint:          { fontSize: 13, textAlign: 'center' },

  sessionBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  sessionBannerText: { fontSize: 13, fontWeight: '700' },

  improveBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  improveBannerText: { fontSize: 12, fontWeight: '600', flex: 1 },

  taskCard:      { borderRadius: radius.lg, borderWidth: 1, padding: 16, gap: 8 },
  taskHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskTitle:     { fontSize: 14, fontWeight: '700', flex: 1 },
  taskDesc:      { fontSize: 14, lineHeight: 22 },

  card:          { borderRadius: radius.lg, borderWidth: 1, padding: 16, gap: 10 },
  cardHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle:     { fontSize: 14, fontWeight: '700', flex: 1 },
  stepRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNum:       { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumText:   { color: '#fff', fontSize: 11, fontWeight: '700' },
  stepText:      { fontSize: 14, lineHeight: 20, flex: 1 },

  nextStepBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                   paddingVertical: 12, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  nextStepText:  { fontSize: 14, fontWeight: '700' },

  allDoneBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10,
                   borderRadius: 10, borderWidth: 1, marginTop: 4 },
  allDoneText:   { fontSize: 13, fontWeight: '600' },

  boardCard:     { borderRadius: radius.lg, borderWidth: 1, padding: 16, gap: 12, position: 'relative' },
  boardTitle:    { fontSize: 15, fontWeight: '700', fontFamily: fonts.serif },
  canvasOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10,
                   alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg,
                   backgroundColor: '#00000040' },

  toolRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  toolLabel:     { fontSize: 12, fontWeight: '600', width: 46 },
  toolBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  toolBtnText:   { fontSize: 11, fontWeight: '600' },
  colorDot:      { width: 26, height: 26, borderRadius: 13 },
  sizeBtn:       { width: 36, height: 36, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  clearBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, marginLeft: 8 },

  stickyBar:     { paddingHorizontal: spacing.xl, paddingVertical: 12, borderTopWidth: 1,
                   flexDirection: 'row', gap: 10 },
  stickyFeedbackBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                       gap: 8, paddingVertical: 16, borderRadius: radius.lg },
  guideBtn:      { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10,
                   borderRadius: 10, marginTop: 4, alignSelf: 'flex-start' },
  drawHint:      { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8,
                   borderRadius: 8, borderWidth: 1, marginTop: 4 },
  feedbackBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: radius.lg, marginTop: 4 },
  feedbackBtnText:{ color: '#fff', fontWeight: '700', fontSize: 15 },

  feedbackCard:  { borderRadius: radius.lg, borderWidth: 1, padding: 16, gap: 10 },
  scoreRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  scoreBadge:    { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  scoreText:     { fontSize: 16, fontWeight: '800', fontFamily: fonts.serif },
  feedbackLabel: { fontSize: 13, fontWeight: '600' },
  speakBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  feedbackRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1 },
  feedbackText:  { fontSize: 14, lineHeight: 20, flex: 1 },

  improveBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                   paddingVertical: 12, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  improveBtnText:{ fontSize: 14, fontWeight: '700' },

  actionRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  btn:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: radius.lg, paddingHorizontal: 14 },
  btnOutline:    { borderWidth: 1, borderColor: '#BAA46740', backgroundColor: '#BAA46712' },
  btnText:       { color: '#fff', fontWeight: '700', fontSize: 14 },
});
