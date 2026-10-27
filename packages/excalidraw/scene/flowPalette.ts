/**
 * The colours the animation's look is chosen from (D-207, D-206).
 *
 * The **swatches** are the pad each colour is picked from, and they are **neon**:
 * saturated, bright colours that read as light and not as paint. The **presets**
 * set the colours of the whole animation together - the shape, the text and
 * what travels - and turn the glow on, and they are held to two rules that are
 * computed and not believed:
 *
 *  - every colour reaches at least **3 : 1 contrast against the page** it is
 *    for, the WCAG 2.1 bound for graphics (SC 1.4.11);
 *  - the shape colour and the colour of what travels differ in **hue** by at
 *    least 60 degrees, so the two never blur into one.
 *
 * A neon yellow or green cannot be seen on a white page at any glow, so every
 * preset has two variants: the **pure neon** for a dark page and a **deep neon**
 * - the most vivid colour that still reaches 3 : 1 against white - for a light
 * one.
 *
 * Everything is pure, so the rules above are checked by tests and not by eye.
 */

import { isFlowColor } from "./flowLook";

import type { FlowLook } from "./flowLook";

export type FlowSwatch = {
  id: string;
  name: string;
  /** a hex colour; `null` is "the default" (the accent colour, D-189) */
  color: string | null;
};

/** the pad: the default first, then the colours, then black, white and grey */
export const FLOW_SWATCHES: readonly FlowSwatch[] = [
  { id: "default", name: "Default", color: null },
  { id: "red", name: "Red", color: "#ff3131" },
  { id: "orange", name: "Orange", color: "#ff9100" },
  { id: "yellow", name: "Yellow", color: "#fff01f" },
  { id: "green", name: "Green", color: "#39ff14" },
  { id: "cyan", name: "Cyan", color: "#00f0ff" },
  { id: "blue", name: "Blue", color: "#3d7bff" },
  { id: "purple", name: "Purple", color: "#bc13fe" },
  { id: "pink", name: "Pink", color: "#ff2bd6" },
  { id: "white", name: "White", color: "#ffffff" },
  { id: "black", name: "Black", color: "#1e1e1e" },
  { id: "grey", name: "Grey", color: "#868e96" },
];

/** the swatch a colour is, if it is one; `null` for the default is the first */
export const swatchOf = (color: string | null): FlowSwatch | null =>
  FLOW_SWATCHES.find(
    (swatch) =>
      swatch.color === color ||
      (swatch.color &&
        color &&
        swatch.color.toLowerCase() === color.toLowerCase()),
  ) ?? null;

/* ----------------------------------------------------------------- colour maths */

/** red, green and blue, 0 to 255, from a hex colour; alpha is ignored */
const rgbOf = (hex: string): [number, number, number] | null => {
  if (!isFlowColor(hex)) {
    return null;
  }

  let value = hex.slice(1);

  if (value.length === 3) {
    value = value
      .split("")
      .map((char) => char + char)
      .join("");
  }

  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
};

/** the relative luminance of the WCAG definition, 0 (black) to 1 (white) */
export const relativeLuminance = (hex: string) => {
  const rgb = rgbOf(hex);

  if (!rgb) {
    return 1;
  }

  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;

    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** the WCAG contrast ratio of two colours, 1 to 21 */
export const contrastRatio = (a: string, b: string) => {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );

  return (high + 0.05) / (low + 0.05);
};

/** the hue of a colour, in degrees; a grey has none and is 0 */
export const hueOf = (hex: string) => {
  const rgb = rgbOf(hex);

  if (!rgb) {
    return 0;
  }

  const [r, g, b] = rgb.map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);

  if (!delta) {
    return 0;
  }

  const sector =
    max === r
      ? ((g - b) / delta) % 6
      : max === g
      ? (b - r) / delta + 2
      : (r - g) / delta + 4;

  return (sector * 60 + 360) % 360;
};

/** how far apart two hues are, 0 to 180 degrees */
export const hueDistance = (a: string, b: string) => {
  const d = Math.abs(hueOf(a) - hueOf(b));

  return d > 180 ? 360 - d : d;
};

/** the page colours the presets are for */
export const LIGHT_PAGE = "#ffffff";
export const DARK_PAGE = "#1e1e1e";

/**
 * Whether a page is dark: white reads on it better than black does. A page
 * with no colour, or one that is not a hex colour, is a light page.
 */
export const isDarkPage = (background: string | null | undefined) =>
  !!background &&
  isFlowColor(background) &&
  contrastRatio(background, "#ffffff") > contrastRatio(background, "#000000");

/* ---------------------------------------------------------------------- presets */

export type FlowPresetColors = {
  /** the shape's colour; `null` is the accent colour */
  nodeColor: string | null;
  /** the text's colour; `null` follows the shape (D-209) */
  textColor: string | null;
  /** the colour of what travels; `null` is the accent colour */
  markColor: string | null;
  /** the neon glow (D-208) */
  glow: boolean;
};

export type FlowColorPreset = {
  id: string;
  name: string;
  /** the colours are meant to be alike (a family), so they need not differ in hue */
  alike?: boolean;
  /** the deep neon, for a light page */
  light: FlowPresetColors;
  /** the pure neon, for a dark page */
  dark: FlowPresetColors;
};

const neon = (
  nodeColor: string,
  markColor: string,
  textColor: string | null = null,
): FlowPresetColors => ({ nodeColor, textColor, markColor, glow: true });

export const FLOW_COLOR_PRESETS: readonly FlowColorPreset[] = [
  {
    id: "classic",
    name: "Classic",
    light: { nodeColor: null, textColor: null, markColor: null, glow: false },
    dark: { nodeColor: null, textColor: null, markColor: null, glow: false },
  },
  {
    id: "cyan-pink",
    name: "Cyan and pink",
    light: neon("#008ba3", "#e0007a"),
    dark: neon("#00f0ff", "#ff2bd6"),
  },
  {
    id: "green-purple",
    name: "Green and purple",
    light: neon("#00a35a", "#9d00ff"),
    dark: neon("#39ff14", "#bc13fe"),
  },
  {
    id: "yellow-blue",
    name: "Yellow and blue",
    light: neon("#b38f00", "#1f51ff"),
    dark: neon("#fff01f", "#3d7bff"),
  },
  {
    id: "orange-cyan",
    name: "Orange and cyan",
    light: neon("#e65c00", "#008ba3"),
    dark: neon("#ff9100", "#00f0ff"),
  },
  {
    id: "pink-lime",
    name: "Pink and lime",
    light: neon("#d400b3", "#4c9a00"),
    dark: neon("#ff2bd6", "#b6ff00"),
  },
  {
    id: "fire-ice",
    name: "Fire and ice",
    light: neon("#e60023", "#1f51ff", "#1e1e1e"),
    dark: neon("#ff3131", "#00f0ff", "#ffffff"),
  },
  {
    id: "high-contrast",
    name: "High contrast",
    light: neon("#000000", "#1f51ff", "#e65c00"),
    dark: neon("#ffffff", "#00f0ff", "#fff01f"),
  },
];

/** the colours of a preset that read on this page: its light or its dark variant */
export const presetColorsFor = (
  preset: FlowColorPreset,
  background: string | null | undefined,
): FlowPresetColors => (isDarkPage(background) ? preset.dark : preset.light);

const same = (a: string | null, b: string | null) =>
  (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

/** what a preset sets of a look: its colours, and the glow of the three it covers (D-217) */
export const presetLook = (colors: FlowPresetColors) => ({
  nodeColor: colors.nodeColor,
  textColor: colors.textColor,
  markColor: colors.markColor,
  glowShape: colors.glow,
  glowText: colors.glow,
  glowMark: colors.glow,
  // a preset that turns the glow off turns every glow off; one that turns it
  // on leaves the arrows as they are
  ...(colors.glow ? {} : { glowArrow: false }),
});

/** the part of a look a preset sets */
export type FlowPresetLook = Pick<
  FlowLook,
  | "nodeColor"
  | "textColor"
  | "markColor"
  | "glowShape"
  | "glowText"
  | "glowMark"
>;

/** whether the look's colours and glow are the preset's own, on this page */
export const presetIsChosen = (
  preset: FlowColorPreset,
  look: FlowPresetLook,
  background: string | null | undefined,
) => {
  const colors = presetColorsFor(preset, background);

  return (
    same(look.nodeColor, colors.nodeColor) &&
    same(look.textColor, colors.textColor) &&
    same(look.markColor, colors.markColor) &&
    look.glowShape === colors.glow &&
    look.glowText === colors.glow &&
    look.glowMark === colors.glow
  );
};
