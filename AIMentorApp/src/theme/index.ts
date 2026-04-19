export const darkColors = {
  // True black — Enchanting Forest accents glow on black
  bgDark: '#0F0F0F',
  cardDark: '#1C1C1C',
  cardHover: '#252525',
  sidebarDark: '#111111',
  borderColor: 'rgba(195, 220, 216, 0.12)',  // subtle teal border

  textMain: '#F0EEEC',    // warm off-white (not harsh pure white)
  textMuted: '#A8B5B3',   // muted sage
  textDim: '#5A6B69',     // dark sage

  // Primary: sage teal — matches light mode, glows on black
  primary: '#93B0AC',
  primaryHover: '#7AADA8',
  primaryGlow: 'rgba(147, 176, 172, 0.18)',

  // Enchanting Forest accents on black
  accentBlue: '#C3DCD8',    // sage mint
  accentPurple: '#EFD1D4',  // dusty rose
  accentGreen: '#93B0AC',   // slate teal
  accentYellow: '#C5BD96',  // khaki gold
  accentRed: '#EFD1D4',     // blush rose
  accentCyan: '#C3DCD8',    // sage
  accentOrange: '#D4A898',  // warm peach
  accentPink: '#EFD1D4',    // dusty rose
};

export const lightColors = {
  // Enchanting Forest — warm blush-tinted white base
  bgDark: '#F9F3F4',        // barely-blush background
  cardDark: '#FFFFFF',
  cardHover: '#FBE8ED',     // blush hover (#FBE8ED)
  sidebarDark: '#FFFFFF',
  borderColor: 'rgba(239,209,212,0.70)',  // dusty rose border (#EFD1D4)

  textMain: '#2C3830',      // deep forest — warm dark green (not pure black)
  textMuted: '#7A8F8A',     // muted slate teal
  textDim: '#B8CAC7',       // light sage

  // Primary: slate teal — readable on white, on-palette
  primary: '#5F8A86',       // darkened #93B0AC
  primaryHover: '#4A706D',
  primaryGlow: 'rgba(147,176,172,0.30)',

  // Enchanting Forest accents
  accentBlue: '#C3DCD8',    // sage mint
  accentPurple: '#EFD1D4',  // dusty rose
  accentGreen: '#93B0AC',   // slate teal
  accentYellow: '#C5BD96',  // khaki gold
  accentRed: '#B8595F',     // muted rose — readable on white
  accentCyan: '#DBD9DA',    // silver
  accentOrange: '#D4A898',  // warm peach (derived)
  accentPink: '#EFD1D4',    // dusty rose
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
