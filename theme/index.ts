// Central design system — colors, spacing, radii, typography.
// Keep every screen pulling from here so the look stays consistent.

export const colors = {
  // Backgrounds (darkest → elevated)
  bg: "#0A0E17",
  bgGradientTop: "#0D1322",
  bgGradientBottom: "#080B12",
  surface: "#141B2D",
  surfaceAlt: "#1A2236",
  surfaceHi: "#202A42",

  // Borders / dividers
  border: "#232E47",
  borderSoft: "rgba(255,255,255,0.06)",
  hairline: "rgba(255,255,255,0.08)",

  // Brand / accents
  gold: "#F5B841",
  goldSoft: "rgba(245,184,65,0.12)",
  green: "#34D399",
  greenSoft: "rgba(52,211,153,0.12)",
  red: "#F87171",
  redSoft: "rgba(248,113,113,0.12)",
  blue: "#60A5FA",
  blueSoft: "rgba(96,165,250,0.12)",

  // Text
  text: "#F1F5F9",
  textDim: "#9AA7BD",
  textMuted: "#5B6678",
  ink: "#0A0E17", // text on light/gold surfaces
};

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
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

export const font = {
  // Sizes
  caption: 11,
  small: 13,
  body: 15,
  title: 18,
  h2: 22,
  h1: 28,
  display: 40,
  // Weights
  regular: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
  heavy: "800" as const,
};

// Soft elevation shadow used on primary cards (iOS + Android).
export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  soft: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
};

// Per-sport color + icon mapping for quick visual scanning.
export const sportMeta: Record<string, { color: string; icon: string }> = {
  NFL: { color: "#F5B841", icon: "american-football" },
  NBA: { color: "#FB923C", icon: "basketball" },
  MLB: { color: "#60A5FA", icon: "baseball" },
  NHL: { color: "#22D3EE", icon: "snow" },
  Default: { color: "#94A3B8", icon: "trophy" },
};

export const getSportMeta = (sport: string) => sportMeta[sport] ?? sportMeta.Default;
