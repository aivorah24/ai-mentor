// ── Exact landing.html palette (the marketing site = the design reference) ──
// #0B0B0B base, warm off-white text, muted SAGE + GOLD accents, Fraunces serif.
export const darkColors = {
  bgDark: '#0B0B0B',        // landing --bg
  cardDark: '#141414',      // dark card surface
  cardHover: '#1C1C1C',
  sidebarDark: '#0B0B0B',   // same as bg (unified)
  borderColor: 'rgba(245,243,238,0.14)',  // landing --line-strong

  textMain: '#F5F3EE',      // landing --text
  textMuted: '#A9B0AC',     // landing --muted
  textDim: '#6E736B',

  // Primary: sage (landing --sage)
  primary: '#9FB2A4',
  primaryHover: '#B2C2B7',
  primaryGlow: 'rgba(159,178,164,0.14)',   // landing --sage-soft

  // Landing accents — sage + gold lead
  accentBlue: '#9FB2A4',    // sage
  accentPurple: '#BAA467',  // gold (landing --gold)
  accentGreen: '#9FB2A4',   // sage
  accentYellow: '#BAA467',  // gold
  accentRed: '#C98A8A',     // muted rose
  accentCyan: '#9FB2A4',    // sage
  accentOrange: '#C9A24E',  // deep gold
  accentPink: '#BAA467',    // gold
};

// Light mode: Aivorah brand on warm cream — same gold/sage accents, inverted bg/text.
export const lightColors = {
  bgDark: '#F5F3EE',        // landing --text (warm cream) used as light bg
  cardDark: '#FFFFFF',
  cardHover: '#EDE8E2',     // slightly warmer card hover
  sidebarDark: '#F5F3EE',
  borderColor: 'rgba(11,11,11,0.10)',  // subtle dark border on cream

  textMain: '#0B0B0B',      // landing --bg as text (full contrast on cream)
  textMuted: '#4A4A48',     // dark muted
  textDim: '#8A8A86',       // dimmed

  // Primary: sage — same role as dark mode (text/borders only, no fills)
  primary: '#9FB2A4',
  primaryHover: '#8AA396',
  primaryGlow: 'rgba(159,178,164,0.18)',

  // Accents — same gold/sage identity, slightly deeper for cream readability
  accentBlue: '#9FB2A4',    // sage
  accentPurple: '#BAA467',  // gold
  accentGreen: '#9FB2A4',   // sage
  accentYellow: '#9A7B2E',  // deep gold (readable on cream)
  accentRed: '#B8595F',     // muted rose
  accentCyan: '#9FB2A4',    // sage
  accentOrange: '#B07A1E',  // amber-gold
  accentPink: '#BAA467',    // gold
};

// Default export keeps backward compat — ThemeContext overrides at runtime
export const colors = darkColors;
export type AppColors = typeof darkColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 36,
};

import { Platform } from 'react-native';
const INTER = Platform.OS === 'web' ? 'Inter, system-ui, sans-serif' : 'system';
export const fonts = {
  serif: INTER,
  sans:  INTER,
  brand: INTER,
};

export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 14, fontWeight: '400' as const },
  bodyBold: { fontSize: 14, fontWeight: '600' as const },
  small: { fontSize: 12, fontWeight: '400' as const },
  smallBold: { fontSize: 12, fontWeight: '600' as const },
  label: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.8 },
};
