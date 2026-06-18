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

// Light mode derived from the same forest/gold identity (warm cream + deep green).
export const lightColors = {
  bgDark: '#F6F8F2',        // warm cream-green
  cardDark: '#FFFFFF',
  cardHover: '#EEF4EA',     // pale sage hover
  sidebarDark: '#F6F8F2',   // same as bg (unified)
  borderColor: 'rgba(95,138,134,0.22)',  // sage border

  textMain: '#16241B',      // deep forest green-black
  textMuted: '#5C6F62',     // muted forest
  textDim: '#9FB0A4',       // light sage

  // Primary: deep sage-green — readable on cream, same family as dark
  primary: '#3F7A5E',
  primaryHover: '#2F6149',
  primaryGlow: 'rgba(63,122,94,0.16)',

  // Accents — gold + green lead, tuned for contrast on light
  accentBlue: '#3F7A5E',    // forest green
  accentPurple: '#9A7B2E',  // deep gold
  accentGreen: '#3F7A5E',   // forest green
  accentYellow: '#9A7B2E',  // deep gold (readable on cream)
  accentRed: '#B8595F',     // muted rose
  accentCyan: '#3F7A5E',    // forest green
  accentOrange: '#B07A1E',  // amber-gold
  accentPink: '#9A7B2E',    // gold
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

// Landing fonts. On web these resolve to the loaded Google fonts; native falls back.
import { Platform } from 'react-native';
export const fonts = {
  serif: Platform.OS === 'web' ? 'Fraunces, Georgia, "Times New Roman", serif' : 'serif',
  sans: Platform.OS === 'web' ? 'Inter, system-ui, sans-serif' : undefined,
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
