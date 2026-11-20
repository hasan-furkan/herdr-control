// Mono dark palette, status mappings, font helpers, sizes, and radii.
// No color literals should exist anywhere outside this file.

import { fonts, settings } from "herdr";
import { isDemo } from "./demo-mode.js";

export const PALETTE = {
  bg: "#111111",
  surface: "#181818",
  surfaceDark: "#131313",
  raised: "#202020",
  raisedHover: "#262626",

  line: "#ffffff14",
  lineStrong: "#ffffff24",
  lineHover: "#ffffff47",
  rowBg: "#ffffff06",
  rowHover: "#ffffff0c",
  track: "#ffffff1a",
  transparent: "#00000000",

  text: "#ededed",
  muted: "#a3a3a3",
  mono: "#bdbdbd",

  accent: "#ededed",
  accentHover: "#ffffff",
  accentSoft: "#ededed1a",
  accentBorder: "#ededed3d",
  onAccent: "#111111",
  onAccentSoft: "#1111111f",
  onAccentBorder: "#1111112e",

  heroBg: "#e9e6df",
  heroText: "#151515",
  heroMuted: "#4a4a45",
  heroLine: "#15151524",
  heroGreen: "#1f8a5a",
  heroWarn: "#b37200",

  ok: "#3ecf8e",
  running: "#3ecf8e",
  okSoft: "#3ecf8e21",
  okBorder: "#3ecf8e4d",

  warn: "#f0b429",
  warnSoft: "#f0b42924",
  warnHover: "#f0b42933",
  warnBorder: "#f0b42957",

  danger: "#f25f4c",
  dangerSoft: "#f25f4c24",
  dangerBorder: "#f25f4c61",

  offline: "#808080",
  offlineSoft: "#80808024",
  offlineBorder: "#80808047",

  focus: "#f0b429",
};

export const SIZES = {
  xs: 12,
  sm: 13,
  md: 14,
  title: 15.5,
  lg: 18,
  stat: 32,
  hero: 72,
};

export const RADII = {
  card: 18,
  inner: 11,
  chip: 8,
  pill: 999,
};

export const STATUS_WORDS = {
  working: "Working",
  blocked: "Awaiting approval",
  done: "Done",
  idle: "Idle",
};

export function statusColor(status) {
  switch (status) {
    case "working":
      return PALETTE.ok;
    case "blocked":
      return PALETTE.warn;
    case "done":
      return PALETTE.muted;
    case "idle":
    default:
      return PALETTE.offline;
  }
}

export function statusWord(status) {
  return STATUS_WORDS[status] ?? "—";
}

function hasFont(family) {
  try {
    const list = fonts();
    return Array.isArray(list) && list.includes(family);
  } catch {
    return false;
  }
}

export function textFont() {
  if (isDemo()) return "Geist";
  if (hasFont("Manrope")) return "Manrope";
  try {
    return settings()?.ui_font || "Geist";
  } catch {
    return "Geist";
  }
}

export function monoFont() {
  if (isDemo()) return "JetBrains Mono";
  if (hasFont("JetBrains Mono")) return "JetBrains Mono";
  try {
    return settings()?.font || "JetBrains Mono";
  } catch {
    return "JetBrains Mono";
  }
}

// Compatibility bridge so legacy screen modules render cleanly on Mono palette.
export function monoTheme() {
  return {
    background: PALETTE.bg,
    canvas: PALETTE.bg,
    chrome: PALETTE.surface,
    surface: PALETTE.surface,
    raised: PALETTE.raised,
    hover: PALETTE.raisedHover,
    selected: PALETTE.accentSoft,
    border: PALETTE.line,
    input: PALETTE.lineStrong,
    foreground: PALETTE.text,
    muted: PALETTE.muted,
    dim: PALETTE.muted,
    accent: PALETTE.accent,
    accent_foreground: PALETTE.onAccent,
    solid: PALETTE.accent,
    solid_foreground: PALETTE.onAccent,
    working: PALETTE.ok,
    blocked: PALETTE.warn,
    done: PALETTE.muted,
    idle: PALETTE.offline,
    unknown: PALETTE.offline,
    ansi2: PALETTE.ok,
  };
}
