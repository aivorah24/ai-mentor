import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated, Platform, Image, ScrollView, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../context/ThemeContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import { spacing, radius, fonts } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

interface Page { pageNumber: number; text: string; sceneIcon: string; sceneColor: string; sceneLabel: string; imageUrl: string | null; }
interface Story { id: string; title: string; subtitle: string; coverColor: string; collection: string; coverImageUrl?: string | null; pages: Page[]; }
type VoiceOption = 'grandmother' | 'grandfather';

const VOICE_CONFIG: Record<VoiceOption, { label: string; icon: string; color: string }> = {
  grandmother: { label: 'Grandmother', icon: 'heart',  color: '#C08898' },  // Aivorah pastel rose
  grandfather: { label: 'Grandfather', icon: 'anchor', color: '#7EA8C0' },  // Aivorah pastel blue
};

const PASTEL_GOLD = '#C5A56A';  // Aivorah warm pastel gold — Auto toggle + completion badges

// Story-specific ambient music profiles
const STORY_AMBIENT: Record<string, { root: number; style: 'tanpura' | 'flute' | 'tabla' | 'veena' }> = {
  prahlada:             { root: 220,  style: 'tanpura' }, // devotional drone
  hanuman:              { root: 196,  style: 'tabla'   }, // energetic rhythm
  ramayana_rama_sita:   { root: 264,  style: 'flute'   }, // peaceful bansuri
  bhagavad_gita_arjuna: { root: 220,  style: 'veena'   }, // wisdom, meditative
  dhruva:               { root: 247,  style: 'tanpura' }, // determination drone
  ambarisha:            { root: 220,  style: 'veena'   }, // devotion, calm
  bharat:               { root: 264,  style: 'flute'   }, // gentle, lyrical
  // Mahabharata Tales — mood matched to each story
  churning_of_ocean:    { root: 207,  style: 'tabla'   }, // effort & rhythm of the churning
  dashavatara:          { root: 220,  style: 'tanpura' }, // grand, cosmic, divine
  endless_lamp:         { root: 277,  style: 'flute'   }, // warm, gentle light
  dharmakshetra:        { root: 220,  style: 'veena'   }, // inner reflection, wisdom
  actor_on_stage:       { root: 294,  style: 'flute'   }, // light, playful, lyrical
  chariot_of_mind:      { root: 196,  style: 'tabla'   }, // movement, holding the reins
  matsya_fish:          { root: 247,  style: 'flute'   }, // flowing water, gentle
  // Srimad Bhagavatam — Canto 8
  canto8_part1:         { root: 207,  style: 'tabla'   }, // Gajendra's struggle, churning rhythm
  canto8_part2:         { root: 220,  style: 'flute'   }, // Vamana's growth, Matsya's flowing waters
};

// ── Situational (per-page) ambient moods ──────────────────────────────────
// Each scene within a story can feel different — tense, joyful, watery, mysterious —
// so we sniff the page's scene icon + text for mood keywords and pick a matching
// ambient profile. Falls back to the story-wide STORY_AMBIENT profile if nothing matches.
type AmbientProfile = { root: number; style: 'tanpura' | 'flute' | 'tabla' | 'veena'; bpm?: number; intensity?: number };

const MOOD_PROFILES: Record<string, AmbientProfile> = {
  tense:       { root: 175, style: 'tabla',   bpm: 78, intensity: 1.2  }, // danger, storms, fear
  triumphant:  { root: 294, style: 'tanpura', intensity: 1.15 },          // victory, treasure, light
  water:       { root: 247, style: 'flute',   intensity: 0.9  },          // oceans, rivers, rain
  mysterious:  { root: 165, style: 'veena',   intensity: 0.85 },          // secrets, riddles, deep questions
  playful:     { root: 311, style: 'flute',   intensity: 1.0  },          // children, laughter, lightness
  peaceful:    { root: 264, style: 'flute',   intensity: 0.8  },          // calm, prayer, gentle moments
  night:       { root: 196, style: 'veena',   intensity: 0.65 },          // sleepy, ending lullaby pages
};

// Keyword groups checked against the page's scene label/icon/emoji + narration text.
// Order matters — first match wins, so put the more specific moods first.
const MOOD_KEYWORDS: { mood: string; words: RegExp }[] = [
  { mood: 'night',      words: /\b(sleep|sleepy|rest now|good ?night|close your eyes|sweet dreams|curtain falls|bedtime)\b/i },
  { mood: 'tense',      words: /\b(danger|frightened|terrible|fierce|demon|poison|storm|flood|battle|growl|roar|afraid|scary|dark smoke|sink(?:ing)?)\b/i },
  { mood: 'triumphant', words: /\b(nectar|treasure|golden|victory|celebrat|won|glow(?:ing)?|jewels?|lamp|shine|shining|triumph)\b/i },
  { mood: 'water',      words: /\b(ocean|river|sea|water|wave|flood|swam|swim|rain|fish|lake|pond)\b/i },
  { mood: 'mysterious', words: /\b(secret|wonder|mystery|riddle|soul|question|hidden|curious|strange)\b/i },
  { mood: 'playful',    words: /\b(laugh|giggle|child|playful|smiled|fun|game|dance)\b/i },
  { mood: 'peaceful',   words: /\b(pray|calm|gentle|quiet|peaceful|breathe|still)\b/i },
];

function getPageMoodProfile(page: { sceneIcon?: string; sceneLabel?: string; sceneEmoji?: string; text?: string } | null | undefined, storyId: string): AmbientProfile {
  const haystack = `${page?.sceneLabel ?? ''} ${page?.text ?? ''}`;
  for (const { mood, words } of MOOD_KEYWORDS) {
    if (words.test(haystack)) return MOOD_PROFILES[mood];
  }
  return STORY_AMBIENT[storyId] ?? { root: 220, style: 'tanpura' };
}

function getPastelGradient(c: string): [string, string] {
  const map: Record<string, [string, string]> = {
    '#7c3aed': ['#9B8FC0', '#7BA8A4'], '#4f46e5': ['#8FA0C0', '#7BA8A4'],
    '#0ea5e9': ['#7EA8C0', '#82A896'], '#6366f1': ['#9B8FC0', '#7EA8C0'],
    '#ea580c': ['#C0A07E', '#7BA8A4'], '#dc2626': ['#C08898', '#9B8FC0'],
    '#16a34a': ['#82A896', '#7BA8A4'], '#0891b2': ['#7EA8C0', '#82A896'],
    '#10b981': ['#82A896', '#7EA8C0'], '#f59e0b': ['#C0A07E', '#82A896'],
  };
  return map[c] ?? ['#7BA8A4', '#82A896'];
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+[\s]*/g);
  return parts && parts.length > 1 ? parts : [text];
}

// Split text into words, preserving trailing spaces so joined text is identical
function splitWords(text: string): string[] {
  return text.match(/\S+\s*/g) || [text];
}

// Group flat tokens into paragraphs while keeping each word's GLOBAL index (gi),
// so word-by-word highlighting (which uses the flat wordIndex) is unaffected.
function buildParagraphs(text: string): { token: string; gi: number }[][] {
  const groups: { token: string; gi: number }[][] = [];
  let cur: { token: string; gi: number }[] = [];
  splitWords(text).forEach((tok, i) => {
    cur.push({ token: tok, gi: i });
    if (/\n[ \t]*\n/.test(tok)) { groups.push(cur); cur = []; }
  });
  if (cur.length) groups.push(cur);
  return groups;
}

// Common short function words that TTS speaks faster than syllable count suggests
const FUNCTION_WORDS = new Set([
  'a','an','the','of','in','on','at','to','is','was','he','she','it','we',
  'and','but','or','not','no','do','so','be','by','up','as','if','my','me',
  'us','his','her','its','our','had','has','for','are','were','did','can',
  'may','all','one','two','any','out','with','than','that','this','from',
  'into','onto','upon','over','just','even','much','very','also','then',
  'when','what','who','how','why','where','which','they','them','their',
  'would','could','should','have','been','will','more','most','some','such',
  'each','many','only','other','these','those','both','after','about',
  'there','here','now','still','too','yet','ever','once','back','well',
  'got','get','let','put','came','come','went','go','him','did','its',
]);

// Estimate spoken duration weight for a token (word + trailing spaces/punctuation).
// Returns a float: 1.0 ≈ average content word, lower = shorter, higher = longer + pause.
function wordWeight(token: string): number {
  const clean = token.toLowerCase().replace(/[^a-z]/g, '');
  // Count vowel groups as syllable estimate, with silent-e correction
  const vowelGroups = clean.match(/[aeiou]+/g);
  const raw = vowelGroups ? vowelGroups.length : 1;
  const silentE = clean.length > 2 && clean.endsWith('e') && !/[aeiou]/.test(clean[clean.length - 2]) ? 1 : 0;
  let syllables = Math.max(1, raw - silentE);
  // Function words are spoken ~30% faster (but never below 0.4 units)
  if (FUNCTION_WORDS.has(clean)) syllables = Math.max(0.4, syllables * 0.7);
  // Punctuation pauses: sentence-end adds ~1.5 units, comma/dash adds ~0.5
  if (/[.!?]/.test(token)) syllables += 1.5;
  else if (/[,;:\u2014\u2013]/.test(token)) syllables += 0.5;
  return syllables;
}

// Build time-proportion boundaries using the spoken-duration weight model.
// Much more accurate than raw character count for TTS highlight sync.
function buildBoundaries(tokens: string[]): number[] {
  const weights = tokens.map(t => wordWeight(t));
  const total   = weights.reduce((a, b) => a + b, 0) || 1;
  let cum = 0;
  return weights.map(w => { cum += w; return cum / total; });
}

// Page flip sound — served from Express so it works in web builds
let _flipAudio: HTMLAudioElement | null = null;

function playPageFlip() {
  if (Platform.OS !== 'web') return;
  try {
    if (!_flipAudio) {
      _flipAudio = new Audio(`${SERVER_URL}/sounds/page-flip.mp3`);
      _flipAudio.volume = 0.6;
    }
    _flipAudio.currentTime = 0;
    _flipAudio.play().catch(() => {});
  } catch {}
}

// Registry of EVERY ambient source ever created, so a pause can guarantee silence
// even if a wrapper instance leaks (e.g. auto-start race). Safety net.
const _ambientAudios = new Set<HTMLAudioElement>();
const _ambientCtxs   = new Set<AudioContext>();
function silenceAllAmbient() {
  _ambientAudios.forEach(a => { try { a.pause(); } catch {} });
  _ambientCtxs.forEach(c => { try { if (c.state === 'running') c.suspend(); } catch {} });
}

// Indian ambient music via Web Audio API — story-specific instrument styles
function createAmbientMusic(storyId: string, moodProfile?: AmbientProfile) {
  if (Platform.OS !== 'web') return null;
  try {
    const profile = moodProfile ?? STORY_AMBIENT[storyId] ?? { root: 220, style: 'tanpura' };
    const intensity = profile.intensity ?? 1;
    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    _ambientCtxs.add(ctx);
    // Resume in case browser auto-suspended the context
    if (ctx.state === 'suspended') ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // Reverb convolver for warmth
    function makeReverb(duration: number, decay: number) {
      const len = ctx.sampleRate * duration;
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      const conv = ctx.createConvolver();
      conv.buffer = buf;
      return conv;
    }
    const reverb = makeReverb(2.5, 3);
    reverb.connect(master);

    const root = profile.root; // e.g. 220 Hz = A3
    const nodes: any[] = [];

    if (profile.style === 'tanpura') {
      // Tanpura: 4 strings — Pa, Sa (low), Sa (high), Ma plucked in slow cycle
      const strings = [root * 0.75, root, root * 2, root * 4/3];
      strings.forEach((freq, si) => {
        function pluck() {
          try {
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            const filt = ctx.createBiquadFilter();
            filt.type = 'bandpass'; filt.frequency.value = freq; filt.Q.value = 12;
            osc.type = 'sawtooth'; osc.frequency.value = freq;
            osc.connect(filt); filt.connect(env); env.connect(reverb); env.connect(master);
            env.gain.setValueAtTime(0, ctx.currentTime);
            env.gain.linearRampToValueAtTime(0.055, ctx.currentTime + 0.04);
            env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 3.5);
            osc.start(); osc.stop(ctx.currentTime + 3.6);
            const tid = setTimeout(pluck, (si * 1800 + 7200));
            nodes.push(tid);
          } catch {}
        }
        const initDelay = si * 1800;
        const t = setTimeout(pluck, initDelay);
        nodes.push(t);
      });

    } else if (profile.style === 'flute') {
      // Bansuri flute: breathy sine + noise, melodic Sa-Re-Ga phrases
      const scale = [root, root*9/8, root*5/4, root*4/3, root*3/2, root*5/3, root*15/8, root*2];
      const phrases = [[0,2,4,2,0], [4,5,4,2,0], [0,4,7,4,0], [2,4,5,4,2]];
      let phraseIdx = 0;
      function playPhrase() {
        try {
          const phrase = phrases[phraseIdx % phrases.length];
          phraseIdx++;
          phrase.forEach((deg, ni) => {
            const freq = scale[deg % scale.length];
            const t0 = ctx.currentTime + ni * 0.9;
            // Breath noise
            const noiseLen = ctx.sampleRate * 0.7;
            const nbuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
            const nd = nbuf.getChannelData(0);
            for (let i = 0; i < noiseLen; i++) nd[i] = (Math.random() * 2 - 1) * 0.015;
            const nsrc = ctx.createBufferSource(); nsrc.buffer = nbuf;
            const nbpf = ctx.createBiquadFilter(); nbpf.type = 'bandpass'; nbpf.frequency.value = freq * 1.1; nbpf.Q.value = 8;
            const nenv = ctx.createGain(); nenv.gain.value = 0;
            nsrc.connect(nbpf); nbpf.connect(nenv); nenv.connect(master);
            nenv.gain.setValueAtTime(0, t0); nenv.gain.linearRampToValueAtTime(0.04, t0 + 0.08); nenv.gain.linearRampToValueAtTime(0, t0 + 0.65);
            nsrc.start(t0); nsrc.stop(t0 + 0.7);
            // Tone
            const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;
            const vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 5.5;
            const vibG = ctx.createGain(); vibG.gain.value = freq * 0.012;
            vib.connect(vibG); vibG.connect(osc.frequency);
            const env = ctx.createGain(); env.gain.value = 0;
            osc.connect(env); env.connect(reverb); env.connect(master);
            env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(0.06, t0 + 0.12); env.gain.setValueAtTime(0.055, t0 + 0.5); env.gain.linearRampToValueAtTime(0, t0 + 0.75);
            osc.start(t0); vib.start(t0); osc.stop(t0 + 0.8); vib.stop(t0 + 0.8);
          });
          const nextIn = phrase.length * 900 + 1800;
          const t = setTimeout(playPhrase, nextIn);
          nodes.push(t);
        } catch {}
      }
      playPhrase();

    } else if (profile.style === 'tabla') {
      // Tabla: bol pattern — dha dhin dhin dha (16-beat teentaal feel, slow)
      const bpm = profile.bpm ?? 52;
      const beat = 60000 / bpm;
      const pattern = [1,0,0.6,0,1,0,0.6,0.4,1,0,0.6,0,1,0,0.6,0];
      let step = 0;
      function tick() {
        try {
          const vel = pattern[step % pattern.length];
          if (vel > 0) {
            const freq = step % 4 === 0 ? root * 0.5 : root * 0.67;
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            const filt = ctx.createBiquadFilter(); filt.type = 'bandpass'; filt.frequency.value = freq * 2; filt.Q.value = 6;
            osc.type = 'sine'; osc.frequency.setValueAtTime(freq * 3, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(freq, ctx.currentTime + 0.06);
            osc.connect(filt); filt.connect(env); env.connect(reverb); env.connect(master);
            env.gain.setValueAtTime(vel * 0.07, ctx.currentTime);
            env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
            osc.start(); osc.stop(ctx.currentTime + 0.28);
          }
          step++;
          const t = setTimeout(tick, beat / 2);
          nodes.push(t);
        } catch {}
      }
      tick();

    } else if (profile.style === 'veena') {
      // Veena: plucked string — arpeggiated Sa-Ma-Pa-Sa chord, slow and meditative
      const chord = [root, root*5/4, root*3/2, root*2];
      function arpeggio() {
        try {
          chord.forEach((freq, fi) => {
            const t0 = ctx.currentTime + fi * 0.22;
            const osc = ctx.createOscillator();
            const env = ctx.createGain();
            const filt = ctx.createBiquadFilter(); filt.type = 'peaking'; filt.frequency.value = freq; filt.gain.value = 6; filt.Q.value = 2;
            // Pluck: triangle wave (warmer than sawtooth)
            osc.type = 'triangle'; osc.frequency.value = freq;
            // Add slight 2nd harmonic
            const osc2 = ctx.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = freq * 2;
            const g2 = ctx.createGain(); g2.gain.value = 0.18;
            osc2.connect(g2); g2.connect(env);
            osc.connect(filt); filt.connect(env); env.connect(reverb); env.connect(master);
            env.gain.setValueAtTime(0, t0);
            env.gain.linearRampToValueAtTime(0.06, t0 + 0.02);
            env.gain.exponentialRampToValueAtTime(0.001, t0 + 4.0);
            osc.start(t0); osc2.start(t0); osc.stop(t0 + 4.1); osc2.stop(t0 + 4.1);
          });
          const t = setTimeout(arpeggio, 6000);
          nodes.push(t);
        } catch {}
      }
      arpeggio();
    }

    // Sa drone (root + octave) — very soft undertone for all styles
    [root, root * 2].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain(); g.gain.value = [0.018, 0.009][i];
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 600;
      osc.type = 'sine'; osc.frequency.value = freq;
      osc.connect(filt); filt.connect(g); g.connect(master);
      osc.start();
      nodes.push(osc);
    });

    // Fade in gently — keep gain low so it doesn't compete with narration
    const TARGET_GAIN = 0.35 * intensity;
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(TARGET_GAIN, ctx.currentTime + 3);

    return {
      ctx,
      master,
      pause() {
        try {
          const now = ctx.currentTime, v = master.gain.value;
          master.gain.cancelScheduledValues(now);
          master.gain.setValueAtTime(v, now);
          master.gain.linearRampToValueAtTime(0, now + 0.25);
          // Hard-stop the audio clock after the fade — guaranteed silence, can't be undone by stray ramps.
          setTimeout(() => { try { ctx.suspend(); } catch {} }, 280);
        } catch {}
      },
      resume() {
        try {
          if (ctx.state === 'suspended') ctx.resume();   // un-suspend first
          const now = ctx.currentTime, v = master.gain.value;
          master.gain.cancelScheduledValues(now);
          master.gain.setValueAtTime(Math.max(v, 0.0001), now);
          master.gain.linearRampToValueAtTime(TARGET_GAIN, now + 0.9);
        } catch {}
      },
      stop() {
        try {
          const now = ctx.currentTime, v = master.gain.value;
          master.gain.cancelScheduledValues(now);
          master.gain.setValueAtTime(v, now);
          master.gain.linearRampToValueAtTime(0, now + 1.2);
          nodes.forEach(n => { try { if (typeof n === 'number') clearTimeout(n); else n.stop?.(); } catch {} });
          setTimeout(() => { try { ctx.close(); } catch {} _ambientCtxs.delete(ctx); }, 1600);
        } catch {}
      }
    };
  } catch { return null; }
}

// ── Real royalty-free background tracks (preferred over the synth when present) ──
// A small library of mood tracks shared across stories. Drop the mp3 files into
// server/public/sounds/music/ — they are served at /sounds/music/<file>.mp3.
// If a file is missing/unsupported, playback falls back to the synth automatically.
const MOOD_TRACK: Record<string, string> = {
  devotional: '/sounds/music/devotional.mp3', // calm sitar/tanpura — Bhagavatam devotion
  gentle:     '/sounds/music/gentle.mp3',     // soft flute — peaceful tales
  rhythmic:   '/sounds/music/rhythmic.mp3',   // light tabla — energetic / effort
  wisdom:     '/sounds/music/wisdom.mp3',     // meditative veena — Gita / reflection
  water:      '/sounds/music/water.mp3',      // flowing, oceanic — Matsya
  night:      '/sounds/music/night.mp3',      // soft bedtime lullaby
};
const STORY_MOOD: Record<string, keyof typeof MOOD_TRACK> = {
  ramayana_rama_sita: 'gentle',     hanuman: 'rhythmic',        bhagavad_gita_arjuna: 'wisdom',
  ambarisha: 'devotional',          dhruva: 'devotional',       prahlada: 'devotional',
  bharat: 'gentle',                 churning_of_ocean: 'rhythmic', dashavatara: 'devotional',
  endless_lamp: 'gentle',           dharmakshetra: 'wisdom',    actor_on_stage: 'gentle',
  chariot_of_mind: 'rhythmic',      matsya_fish: 'water',
};

// Smoothly ramp an <audio> element's volume.
function rampVolume(audio: HTMLAudioElement, to: number, ms: number) {
  const from = audio.volume; const steps = 24; let i = 0;
  const id = setInterval(() => {
    i++;
    try { audio.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps))); } catch {}
    if (i >= steps) clearInterval(id);
  }, Math.max(10, ms / steps));
  return id;
}

// Looping recorded background track — same pause/resume/stop interface as the synth.
function createAmbientTrack(url: string) {
  try {
    const audio = new (window as any).Audio(url) as HTMLAudioElement;
    _ambientAudios.add(audio);
    audio.loop = true;
    audio.volume = 0;
    const TARGET = 0.28; // soft — must sit under the narration
    const pr = audio.play(); if (pr && (pr as any).catch) (pr as any).catch(() => {});
    rampVolume(audio, TARGET, 2000);
    return {
      _audio: audio,
      pause()  { try { audio.pause(); } catch {} },                          // synchronous, guaranteed stop
      resume() { try { audio.volume = 0; const p = audio.play(); if (p && (p as any).catch) (p as any).catch(() => {}); } catch {} rampVolume(audio, TARGET, 700); },
      stop()   { try { audio.pause(); audio.src = ''; } catch {} _ambientAudios.delete(audio); }, // synchronous, guaranteed stop
    };
  } catch { return null; }
}

// Prefer a real mood track if one is mapped; if the file is missing/errors, seamlessly fall back to the synth.
function createAmbient(storyId: string, page?: { sceneIcon?: string; sceneLabel?: string; sceneEmoji?: string; text?: string } | null) {
  if (Platform.OS !== 'web') return null;
  let inner: any = null;
  let paused = false;
  const moodProfile = getPageMoodProfile(page, storyId);
  const mood = STORY_MOOD[storyId];
  const path = mood ? MOOD_TRACK[mood] : null;
  const useSynth = () => { inner = createAmbientMusic(storyId, moodProfile); if (paused) { try { inner?.pause?.(); } catch {} } };
  if (path) {
    const track = createAmbientTrack(`${SERVER_URL}${path}`);
    if (track) {
      inner = track;
      track._audio?.addEventListener?.('error', () => { try { track.stop(); } catch {} useSynth(); }, { once: true });
    } else { useSynth(); }
  } else { useSynth(); }
  return {
    pause()  { paused = true;  try { inner?.pause?.(); } catch {} },
    resume() { paused = false; try { inner?.resume?.(); } catch {} },
    stop()   { try { inner?.stop?.(); } catch {} inner = null; },
  };
}

export default function StoryReaderScreen({ route, navigation }: any) {
  const { storyId } = route.params ?? {};
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const { width } = useWindowDimensions();
  const isWide = width >= 820;   // desktop / tablet-landscape → image-left, text-right

  const [story,        setStory]        = useState<Story | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [currentPage,  setCurrentPage]  = useState(0);
  const [voice,        setVoice]        = useState<VoiceOption>('grandmother');
  const [isLoading,    setIsLoading]    = useState(false);
  const [playing,      setPlaying]      = useState(false);
  const [autoPlay,     setAutoPlay]     = useState(false);
  const [wordIndex,    setWordIndex]    = useState(0);
  const [donePages,    setDonePages]    = useState<Set<number>>(new Set());
  const [playbackRate, setPlaybackRate] = useState(1);
  const [donePagesLoaded, setDonePagesLoaded] = useState(false);
  const [resumedFrom,  setResumedFrom]  = useState<number | null>(null);  // 1-based page we auto-resumed to
  const didResume      = useRef(false);

  const audioRef   = useRef<any>(null);
  const ambientRef = useRef<any>(null);
  const playGenRef = useRef(0);
  const fadeAnim   = useRef(new Animated.Value(1)).current;
  const slideAnim  = useRef(new Animated.Value(0)).current;
  const rafRef     = useRef<number>(0);
  const audioMeta  = useRef<{ words: string[]; timings: { startTime: number; endTime: number }[] | null; wordBounds: number[] | null; timingProvider: string } | null>(null);

  // Load completed pages from storage
  useEffect(() => {
    AsyncStorage.getItem(`story_done_${storyId}`).then(v => {
      if (v) setDonePages(new Set(JSON.parse(v)));
    }).catch(() => {}).finally(() => setDonePagesLoaded(true));
  }, [storyId]);

  // Resume where the reader left off (YouTube-style): jump to the first page not yet finished.
  // Runs once, after both the story and the saved progress are loaded.
  useEffect(() => {
    if (didResume.current || !story || !donePagesLoaded) return;
    didResume.current = true;
    const idx = story.pages.findIndex(p => !donePages.has(p.pageNumber));
    if (idx > 0) {                 // -1 (all done) or 0 (at start) → no resume needed
      setCurrentPage(idx);
      setResumedFrom(idx + 1);     // 1-based page number for the banner
    }
  }, [story, donePagesLoaded, donePages]);

  // Auto-hide the "resumed" banner after a few seconds (Start-over stays available via top dots).
  useEffect(() => {
    if (resumedFrom == null) return;
    const t = setTimeout(() => setResumedFrom(null), 8000);
    return () => clearTimeout(t);
  }, [resumedFrom]);

  useEffect(() => {
    fetch(`${SERVER_URL}/stories/${storyId}`)
      .then(r => r.json())
      .then((data: Story) => {
        setStory(data);
        setLoading(false);
        // NOTE: ambient music intentionally NOT auto-started here — it starts with the
        // narration (in speakPage) so it shares one lifecycle and always stops on pause.
      })
      .catch(() => setLoading(false));
    return () => { stopAudio(); ambientRef.current?.stop(); ambientRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  useEffect(() => { setWordIndex(0); }, [currentPage]);

  // Apply playback rate change to audio that's already playing
  useEffect(() => {
    if (audioRef.current) {
      try { audioRef.current.playbackRate = playbackRate; } catch {}
    }
  }, [playbackRate]);

  useEffect(() => {
    if (autoPlay && story) {
      const page = story.pages[currentPage];
      if (page) speakPage(page.pageNumber);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, autoPlay]);

  // ── rAF-based highlight loop (60 fps) — speed-aware word sync ──────────────
  function cancelHighlightLoop() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
  }

  function startHighlightLoop(
    audio: any,
    words: string[],
    timings: { startTime: number; endTime: number }[] | null,
    wordBounds: number[] | null,
    timingProvider: string = 'none',
  ) {
    cancelHighlightLoop();
    let lastRendered = -1;
    function tick() {
      if (!audio || audio.paused || audio.ended) return;
      let idx: number;
      if (timings) {
        // ElevenLabs & Whisper = exact timestamps from actual audio → no offset.
        const t = audio.currentTime;
        idx = 0;
        for (let i = 0; i < timings.length; i++) {
          const wordEnd = timings[i + 1]?.startTime ?? (audio.duration + 1);
          if (t >= timings[i].startTime && t < wordEnd) { idx = i; break; }
          if (t >= timings[i].startTime) idx = i;
        }
      } else {
        // Pure proportion fallback (no silence data at all).
        // Apply a small lag so highlight trails audio instead of jumping ahead.
        if (!audio.duration) { rafRef.current = requestAnimationFrame(tick); return; }
        const LAG = 0.18 / (audio.playbackRate || 1);
        const t = Math.max(0, audio.currentTime - LAG);
        const ratio = t / audio.duration;
        const found = wordBounds!.findIndex(b => ratio < b);
        idx = found === -1 ? words.length - 1 : found;
      }
      if (idx !== lastRendered) { lastRendered = idx; setWordIndex(idx); }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function markPageDone(pageNum: number) {
    setDonePages(prev => {
      const next = new Set(prev).add(pageNum);
      AsyncStorage.setItem(`story_done_${storyId}`, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }

  function pauseAudio() {
    cancelHighlightLoop();
    if (audioRef.current) try { audioRef.current.pause(); } catch {}
    // Pause the current ambient, then force-silence ANY stray ambient instance (safety net).
    try { ambientRef.current?.pause(); } catch {}
    silenceAllAmbient();
    setPlaying(false);
  }

  function stopAudio() {
    cancelHighlightLoop();
    audioMeta.current = null;
    playGenRef.current++;
    if (audioRef.current) {
      try { audioRef.current.pause(); audioRef.current.currentTime = 0; } catch {}
      audioRef.current = null;
    }
    ambientRef.current?.stop(); ambientRef.current = null;
    setIsLoading(false); setPlaying(false);
  }

  function resumeAudio() {
    if (!audioRef.current) return;
    try {
      audioRef.current.play();
      // Restart highlight loop from current position
      if (audioMeta.current) {
        const { words, timings, wordBounds, timingProvider } = audioMeta.current;
        startHighlightLoop(audioRef.current, words, timings, wordBounds, timingProvider);
      }
      // Fade ambient back in
      try { ambientRef.current?.resume(); } catch {}
      setPlaying(true);
    } catch {}
  }

  async function speakPage(pageNum: number) {
    if (!story) return;
    // If audio loaded and paused mid-way, resume from same position
    if (audioRef.current && audioRef.current.paused && audioRef.current.currentTime > 0) {
      resumeAudio(); return;
    }
    stopAudio();
    const gen = ++playGenRef.current;
    setIsLoading(true);
    try {
      const res  = await fetch(`${SERVER_URL}/stories/${story.id}/audio/${pageNum}?narrator=${voice}`);
      const data = await res.json();
      if (playGenRef.current !== gen) return;
      if (!data.audioUrl) { setIsLoading(false); return; }

      if (Platform.OS === 'web') {
        const audio = new (window as any).Audio(`${SERVER_URL}${data.audioUrl}`);
        if (playGenRef.current !== gen) return;
        audio.playbackRate = playbackRate;
        audioRef.current = audio;
        setIsLoading(false); setPlaying(true);

        const pageText      = story.pages.find(p => p.pageNumber === pageNum)?.text ?? '';
        const words         = splitWords(pageText);
        const timings: { startTime: number; endTime: number }[] | null = data.wordTimings || null;
        const wordBounds    = timings ? null : buildBoundaries(words);
        const timingProvider: string = data.timingProvider || 'none';

        // Store metadata so resume can restart the loop
        audioMeta.current = { words, timings, wordBounds, timingProvider };

        // Start ambient music matched to this page's scene/mood
        const currentPageObj = story.pages.find(p => p.pageNumber === pageNum);
        ambientRef.current = createAmbient(story.id, currentPageObj);

        audio.onended = () => {
          cancelHighlightLoop();
          setWordIndex(words.length); // past all words → nothing highlighted
          setPlaying(false);
          markPageDone(pageNum);
          ambientRef.current?.stop(); ambientRef.current = null;
          if (autoPlay && story && currentPage < story.pages.length - 1) goToPage(currentPage + 1);
        };
        audio.onerror = () => { cancelHighlightLoop(); setIsLoading(false); setPlaying(false); ambientRef.current?.stop(); ambientRef.current = null; };
        audio.play();
        startHighlightLoop(audio, words, timings, wordBounds, timingProvider);
      } else { setIsLoading(false); }
    } catch { if (playGenRef.current === gen) { setIsLoading(false); setPlaying(false); } }
  }

  function animateTurn(cb: () => void) {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 0,   duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: -16, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      cb(); slideAnim.setValue(16);
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    });
  }

  function goToPage(idx: number) {
    if (!story) return;
    playPageFlip();
    stopAudio();
    animateTurn(() => setCurrentPage(idx));
  }

  if (loading || !story) return (
    <ScreenLayout>
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#7BA8A4" />
        <Text style={[styles.hint, { color: colors.textMuted }]}>Opening story…</Text>
      </View>
    </ScreenLayout>
  );

  const page        = story.pages[currentPage];
  const isFirst     = currentPage === 0;
  const isLast      = currentPage === story.pages.length - 1;
  const progress    = (currentPage + 1) / story.pages.length;
  // Page art: each page shows ITS OWN scene-matched image (no repeated/cover fallback).
  // Resolves local /data/images paths against SERVER_URL; full http URLs pass through.
  const pageImg     = page.imageUrl ? (page.imageUrl.startsWith('http') ? page.imageUrl : `${SERVER_URL}${page.imageUrl}`) : null;
  const pastelGrad  = getPastelGradient(story.coverColor);
  const pastelAccent= pastelGrad[0];
  const words       = splitWords(page.text);
  const paragraphs  = buildParagraphs(page.text);   // plain call (NOT a hook — runs after early return)
  const isBusy      = isLoading || playing;
  const isPaused    = !playing && !isLoading && audioRef.current && audioRef.current.currentTime > 0;
  const totalDone   = donePages.size;

  return (
    <ScreenLayout>
      <View style={styles.screen}>

        <LinearGradient colors={pastelGrad} start={{x:0,y:0}} end={{x:1,y:0}} style={styles.topBar}>
          <TouchableOpacity onPress={() => { stopAudio(); if (navigation.canGoBack()) { navigation.goBack(); } else { navigation.navigate('BhagavathaStories'); } }} style={styles.backBtn} activeOpacity={0.7}>
            <Feather name="arrow-left" size={16} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.topTitle} numberOfLines={1}>{story.title}</Text>
            <Text style={styles.topSub}>{story.collection}</Text>
          </View>
          {/* Progress dots — green=done, white=current, dim=unread */}
          <View style={styles.dotRow}>
            {story.pages.map((p, i) => {
              const done    = donePages.has(p.pageNumber);
              const current = i === currentPage;
              return (
                <TouchableOpacity key={i} onPress={() => goToPage(i)}>
                  <View style={[
                    styles.dot,
                    current ? styles.dotActive :
                    done    ? styles.dotDone   : styles.dotEmpty,
                  ]} />
                </TouchableOpacity>
              );
            })}
          </View>
        </LinearGradient>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` as any, backgroundColor: pastelAccent }]} />
        </View>

        {/* Resumed banner — YouTube-style "continue where you left off" with a Start-over escape hatch */}
        {resumedFrom != null && (
          <View style={[styles.resumeBar, { backgroundColor: pastelAccent + '1A', borderColor: pastelAccent + '40' }]}>
            <Feather name="rotate-ccw" size={13} color={pastelAccent} />
            <Text style={[styles.resumeText, { color: colors.textMain }]} numberOfLines={1}>
              Continuing from page {resumedFrom}
            </Text>
            <TouchableOpacity
              style={[styles.startOverBtn, { borderColor: pastelAccent + '66' }]}
              onPress={() => { setResumedFrom(null); goToPage(0); }}
              activeOpacity={0.8}
            >
              <Text style={[styles.startOverText, { color: pastelAccent }]}>Start over</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setResumedFrom(null)} activeOpacity={0.7} style={styles.resumeClose}>
              <Feather name="x" size={14} color={colors.textDim} />
            </TouchableOpacity>
          </View>
        )}

        {/* Completion badge */}
        {totalDone > 0 && (
          <View style={[styles.completionBar, { backgroundColor: colors.cardDark }]}>
            <Feather name="check-circle" size={12} color={PASTEL_GOLD} />
            <Text style={[styles.completionText, { color: PASTEL_GOLD }]}>
              {totalDone} of {story.pages.length} pages completed
            </Text>
          </View>
        )}

        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <Animated.View style={[{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }, isWide && styles.spreadRow]}>

            <View style={isWide ? styles.imageColWide : undefined}>
            {pageImg ? (
              <View style={[styles.imageContainer, isWide && styles.imageContainerWide]}>
                <Image source={{ uri: pageImg }} style={styles.imageBg} resizeMode="cover" blurRadius={18} />
                <View style={styles.imageBgTint} />
                <Image source={{ uri: pageImg }} style={styles.storyImage} resizeMode="contain" />
                <LinearGradient colors={['transparent','rgba(0,0,0,0.70)']} style={styles.imageOverlay}>
                  <View style={styles.sceneLabelRow}>
                    <Feather name={page.sceneIcon as any} size={13} color="rgba(255,255,255,0.9)" />
                    <Text style={styles.sceneLabelText}>{page.sceneLabel}</Text>
                    {donePages.has(page.pageNumber) && (
                      <View style={styles.doneBadge}>
                        <Feather name="check" size={10} color="#fff" />
                        <Text style={styles.doneBadgeText}>Done</Text>
                      </View>
                    )}
                    <View style={[styles.pageChip, { backgroundColor: pastelAccent + 'AA' }]}>
                      <Text style={styles.pageChipText}>{currentPage + 1} / {story.pages.length}</Text>
                    </View>
                  </View>
                </LinearGradient>
              </View>
            ) : (
              <LinearGradient colors={[pastelGrad[0]+'E0', pastelGrad[1]+'B0']} style={[styles.sceneBanner, isWide && styles.sceneBannerWide]}>
                <View style={styles.sceneIconOuter}>
                  <View style={styles.sceneIconInner}>
                    <Feather name={page.sceneIcon as any} size={36} color="#fff" />
                  </View>
                </View>
                <Text style={styles.sceneLabelFallback}>{page.sceneLabel}</Text>
              </LinearGradient>
            )}
            </View>

            <LinearGradient
              colors={isDark ? [pastelAccent + '1F', colors.cardDark] : [pastelAccent + '14', colors.cardDark]}
              start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
              style={[styles.textCard, isWide && styles.textCardWide, { borderColor: pastelAccent + '2E' }]}
            >
              {/* Panel header — scene icon + label, like a storybook chapter heading */}
              <View style={styles.panelHeader}>
                <View style={[styles.panelHeaderIcon, { backgroundColor: pastelAccent + '26' }]}>
                  <Feather name={page.sceneIcon as any} size={15} color={pastelAccent} />
                </View>
                <Text style={[styles.panelHeaderText, { color: pastelAccent }]} numberOfLines={1}>
                  {page.sceneLabel}
                </Text>
              </View>

              {/* Story text — serif, paragraph blocks with a divider, word-by-word highlight.
                  Each word keeps its GLOBAL index (gi) so highlighting matches the flat wordIndex. */}
              <View style={styles.storyBody}>
                <View style={[styles.storyAccentBar, { backgroundColor: pastelAccent + '88' }]} />
                <View style={{ flex: 1 }}>
                  {paragraphs.map((para, pi) => (
                    <React.Fragment key={pi}>
                      {pi > 0 && (
                        <View style={styles.paraDivider}>
                          <View style={[styles.paraDividerLine, { backgroundColor: pastelAccent + '33' }]} />
                          <Feather name="star" size={11} color={pastelAccent + 'AA'} />
                          <View style={[styles.paraDividerLine, { backgroundColor: pastelAccent + '33' }]} />
                        </View>
                      )}
                      <Text style={styles.storyText}>
                        {para.map(({ token, gi }, li) => {
                          const isCurrent = (playing || isPaused) && gi === wordIndex;
                          const isPast    = gi < wordIndex;
                          const display   = li === para.length - 1 ? token.replace(/\s+$/, '') : token;
                          return (
                            <Text
                              key={gi}
                              style={{
                                color:           isCurrent ? pastelAccent : isPast ? colors.textMuted : colors.textMain,
                                fontWeight:      isCurrent ? '700' : '400',
                                backgroundColor: isCurrent ? pastelAccent + '30' : 'transparent',
                              }}
                            >
                              {display}
                            </Text>
                          );
                        })}
                      </Text>
                    </React.Fragment>
                  ))}
                </View>
              </View>

              {/* Controls — Listen + narrator + Auto on one row, Speed on its own labeled row */}
              <View style={styles.controlsCol}>
                <View style={styles.listenRow}>
                  <TouchableOpacity
                    style={[styles.listenBtn, { backgroundColor: pastelAccent, opacity: isPaused ? 0.85 : 1 }]}
                    onPress={() => playing ? pauseAudio() : speakPage(page.pageNumber)}
                    activeOpacity={0.85}
                  >
                    {isLoading
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Feather name={playing ? 'pause' : isPaused ? 'play' : 'headphones'} size={15} color="#fff" />
                    }
                    <Text style={styles.listenBtnText}>{isLoading ? 'Loading…' : playing ? 'Pause' : isPaused ? 'Resume' : 'Listen'}</Text>
                  </TouchableOpacity>

                  {(Object.keys(VOICE_CONFIG) as VoiceOption[]).map(v => {
                    const cfg = VOICE_CONFIG[v]; const active = voice === v;
                    // All chips share the story's pastel accent — active = filled, inactive = dim.
                    return (
                      <TouchableOpacity key={v}
                        style={[styles.voiceChip, active ? { backgroundColor: pastelAccent + '20', borderColor: pastelAccent } : { backgroundColor: 'transparent', borderColor: colors.borderColor }]}
                        onPress={() => { stopAudio(); setVoice(v); }} activeOpacity={0.8}
                      >
                        <Feather name={cfg.icon as any} size={12} color={active ? pastelAccent : colors.textDim} />
                        <Text style={[styles.voiceChipText, { color: active ? pastelAccent : colors.textDim }]}>{cfg.label}</Text>
                      </TouchableOpacity>
                    );
                  })}

                  <TouchableOpacity
                    style={[styles.voiceChip, autoPlay ? { backgroundColor: pastelAccent + '20', borderColor: pastelAccent } : { backgroundColor: 'transparent', borderColor: colors.borderColor }]}
                    onPress={() => { stopAudio(); setAutoPlay(p => !p); }} activeOpacity={0.8}
                  >
                    <Feather name={autoPlay ? 'pause-circle' : 'play-circle'} size={12} color={autoPlay ? pastelAccent : colors.textDim} />
                    <Text style={[styles.voiceChipText, { color: autoPlay ? pastelAccent : colors.textDim }]}>Auto</Text>
                  </TouchableOpacity>
                </View>

                {/* Playback speed — its own labeled row */}
                <View style={styles.speedRow}>
                  <Text style={[styles.speedLabel, { color: colors.textDim }]}>Speed</Text>
                  {([0.5, 1, 1.5, 2] as const).map(rate => (
                    <TouchableOpacity
                      key={rate}
                      style={[styles.speedChip, playbackRate === rate
                        ? { backgroundColor: pastelAccent + '25', borderColor: pastelAccent }
                        : { backgroundColor: 'transparent', borderColor: colors.borderColor }
                      ]}
                      onPress={() => setPlaybackRate(rate)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.voiceChipText, { color: playbackRate === rate ? pastelAccent : colors.textDim }]}>
                        {rate}x
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </LinearGradient>
          </Animated.View>
        </ScrollView>

        <View style={[styles.bottomNav, { backgroundColor: colors.bgDark, borderTopColor: colors.borderColor }]}>
          <TouchableOpacity
            style={[styles.navArrow, { borderColor: colors.borderColor, backgroundColor: colors.cardDark, opacity: isFirst ? 0.3 : 1 }]}
            onPress={() => !isFirst && goToPage(currentPage - 1)} disabled={isFirst} activeOpacity={0.8}
          >
            <Feather name="chevron-left" size={22} color={colors.textMain} />
          </TouchableOpacity>

          <View style={styles.navCenter}>
            <Text style={[styles.navPageNum, { color: pastelAccent }]}>
              {currentPage + 1} <Text style={[styles.navPageOf, { color: colors.textDim }]}>of {story.pages.length}</Text>
            </Text>
            <Text style={[styles.navSceneLabel, { color: colors.textMuted }]} numberOfLines={1}>{page.sceneLabel}</Text>
          </View>

          {isLast ? (
            <TouchableOpacity
              style={[styles.navFinish, { backgroundColor: pastelAccent }]}
              onPress={() => { stopAudio(); navigation.goBack(); }} activeOpacity={0.85}
            >
              <Feather name="check-circle" size={16} color="#fff" />
              <Text style={styles.navFinishText}>Finished</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.navArrow, { backgroundColor: pastelAccent, borderColor: 'transparent' }]}
              onPress={() => goToPage(currentPage + 1)} activeOpacity={0.85}
            >
              <Feather name="chevron-right" size={22} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </ScreenLayout>
  );
}

const makeStyles = (c: any, isDark: boolean) => StyleSheet.create({
  screen:        { flex: 1, backgroundColor: c.bgDark },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  hint:          { fontSize: 14 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 10, paddingTop: 14 },
  backBtn:   { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  topTitle:  { fontSize: 14, fontWeight: '800', color: '#fff' },
  topSub:    { fontSize: 10, color: 'rgba(255,255,255,0.70)', marginTop: 1 },
  dotRow:    { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot:       { width: 6, height: 6, borderRadius: 3 },
  dotActive: { backgroundColor: '#fff', width: 16, borderRadius: 3 },
  dotDone:   { backgroundColor: '#4ade80', width: 8, height: 8, borderRadius: 4 },
  dotEmpty:  { backgroundColor: 'rgba(255,255,255,0.22)' },
  progressTrack:  { height: 2, backgroundColor: c.borderColor },
  progressFill:   { height: '100%' },
  completionBar:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.lg, paddingVertical: 6 },
  resumeBar:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.md, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.lg, borderWidth: 1 },
  resumeText:     { flex: 1, fontSize: 12.5, fontWeight: '600' },
  startOverBtn:   { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  startOverText:  { fontSize: 11.5, fontWeight: '700' },
  resumeClose:    { padding: 2 },
  completionText: { fontSize: 11, fontWeight: '600' },
  imageContainer: { width: '100%', height: 420, position: 'relative', backgroundColor: '#0a0a0a' },
  imageBg:        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  imageBgTint:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  storyImage:     { width: '100%', height: '100%' },
  imageOverlay:   { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, justifyContent: 'flex-end', paddingHorizontal: spacing.lg, paddingBottom: 12 },
  sceneLabelRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sceneLabelText: { fontSize: 13, fontWeight: '700', color: '#fff', flex: 1 },
  pageChip:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  pageChipText:   { fontSize: 11, fontWeight: '700', color: '#fff' },
  doneBadge:      { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: PASTEL_GOLD, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10 },
  doneBadgeText:  { fontSize: 10, fontWeight: '700', color: '#fff' },
  sceneBanner:    { height: 220, alignItems: 'center', justifyContent: 'center', gap: 16 },
  sceneIconOuter: { width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' },
  sceneIconInner: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(255,255,255,0.20)', alignItems: 'center', justifyContent: 'center' },
  sceneLabelFallback: { fontSize: 15, fontWeight: '700', color: '#fff' },
  // ── Wide-screen (desktop / tablet-landscape) two-column layout: image left, text right ──
  spreadRow:          { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  imageColWide:       { flex: 1, maxWidth: 560, borderRadius: radius.xl, overflow: 'hidden' },
  imageContainerWide: { width: '100%', height: 460 },
  sceneBannerWide:    { height: 460, borderRadius: radius.xl },
  textCardWide:       { flex: 1.15, margin: 0, borderWidth: 1 },
  textCard: { margin: spacing.md, borderRadius: radius.xl, overflow: 'hidden', paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  cardAccentBar:  { height: 3, borderRadius: 2, marginBottom: 4 },
  // Panel header (storybook chapter heading)
  panelHeader:     { flexDirection: 'row', alignItems: 'center', gap: 9 },
  panelHeaderIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  panelHeaderText: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', flex: 1 },
  // Story body: vertical accent bar + serif paragraphs
  storyBody:       { flexDirection: 'row', gap: 14 },
  storyAccentBar:  { width: 3, borderRadius: 2, alignSelf: 'stretch' },
  storyText:      { fontSize: 17, lineHeight: 31, fontWeight: '400', letterSpacing: 0.2, fontFamily: Platform.select({ web: 'Georgia, "Times New Roman", serif', ios: 'Georgia', default: 'serif' }) },
  paraDivider:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 14 },
  paraDividerLine: { flex: 1, height: 1 },
  // Controls
  controlsCol:    { gap: 12, marginTop: 2 },
  listenRow:      { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  listenBtn:      { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 24 },
  listenBtnText:  { fontSize: 14, fontWeight: '700', color: '#fff' },
  voiceChip:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 22, borderWidth: 1 },
  voiceChipText:  { fontSize: 12, fontWeight: '600' },
  speedRow:       { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  speedLabel:     { fontSize: 12, fontWeight: '700', marginRight: 2 },
  speedChip:      { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18, borderWidth: 1, minWidth: 42, alignItems: 'center' },
  bottomNav:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 12, borderTopWidth: 1, gap: spacing.md },
  navArrow:       { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  navCenter:      { flex: 1, alignItems: 'center', gap: 2 },
  navPageNum:     { fontSize: 18, fontWeight: '800', fontFamily: fonts.serif },
  navPageOf:      { fontSize: 13, fontWeight: '400' },
  navSceneLabel:  { fontSize: 11, textAlign: 'center' },
  navFinish:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 24 },
  navFinishText:  { fontSize: 13, fontWeight: '700', color: '#fff' },
});
