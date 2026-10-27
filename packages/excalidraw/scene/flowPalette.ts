/**
 * The colours the animation's look is chosen from (D-200, D-206).
 *
 * The **swatches** are the pad each colour is picked from. The **presets** set
 * the highlight and what travels together, and they are chosen by what is known
 * about colours that read on a projected board:
 *
 *  - the pairs come from the **Okabe-Ito** palette (Okabe and Ito; the
 *    colour-blind-safe set that Nature Methods recommends), so the highlight and
 *    what travels differ in more than their lightness;
 *  - every colour is held to at least **3 : 1 contrast against the page** it is
 *    for, the WCAG 2.1 bound for graphics (SC 1.4.11), because pale colours wash
 *    out on a projector;
 *  - the Okabe-Ito colours that read on a light page do not read on a dark one
 *    (the yellow and the sky blue are nearly white), so every preset has a
 *    **light-page** and a **dark-page** variant.
 *
 * Everything is pure, so the rules above are checked by tests and not by eye.
 */

import { isFlowColor } from "./flowLook";

export type FlowSwatch = {
  id: string;
  name: string;
  /** a hex colour; `null` is "the default" (the accent colour, D-189) */
  color: string | null;
};

/** the pad: the default first, then the colours, then black, white and grey */
export const FLOW_SWATCHES: readonly FlowSwatch[] = [
  { id: "default", name: "Default", color: null },
  { id: "red", name: "Red", color: "#e03131" },
  { id: "orange", name: "Orange", color: "#e8590c" },
  { id: "yellow", name: "Yellow", color: "#f59f00" },
  { id: "green", name: "Green", color: "#2f9e44" },
  { id: "teal", name: "Teal", color: "#0c8599" },
  { id: "blue", name: "Blue", color: "#1971c2" },
  { id: "purple", name: "Purple", color: "#6741d9" },
  { id: "pink", name: "Pink", color: "#c2255c" },
  { id: "black", name: "Black", color: "#1e1e1e" },
  { id: "white", name: "White", color: "#ffffff" },
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
  /** the highlight colour; `null` is the accent colour */
  nodeColor: string | null;
  /** the colour of what travels; `null` is the accent colour */
  markColor: string | null;
};

export type FlowColorPreset = {
  id: string;
  name: string;
  /** the colours are meant to be alike (a family), so they need not differ in hue */
  alike?: boolean;
  light: FlowPresetColors;
  dark: FlowPresetColors;
};

export const FLOW_COLOR_PRESETS: readonly FlowColorPreset[] = [
  {
    id: "classic",
    name: "Classic",
    light: { nodeColor: null, markColor: null },
    dark: { nodeColor: null, markColor: null },
  },
  {
    id: "blue-orange",
    name: "Blue and orange",
    light: { nodeColor: "#0072B2", markColor: "#B36B00" },
    dark: { nodeColor: "#56B4E9", markColor: "#E69F00" },
  },
  {
    id: "blue-vermillion",
    name: "Blue and vermillion",
    light: { nodeColor: "#0072B2", markColor: "#D55E00" },
    dark: { nodeColor: "#56B4E9", markColor: "#D55E00" },
  },
  {
    id: "green-purple",
    name: "Green and purple",
    light: { nodeColor: "#008060", markColor: "#7A3E9D" },
    dark: { nodeColor: "#009E73", markColor: "#CC79A7" },
  },
  {
    id: "cool",
    name: "Cool",
    alike: true,
    light: { nodeColor: "#0072B2", markColor: "#008060" },
    dark: { nodeColor: "#56B4E9", markColor: "#009E73" },
  },
  {
    id: "warm",
    name: "Warm",
    alike: true,
    light: { nodeColor: "#C25400", markColor: "#B36B00" },
    dark: { nodeColor: "#D55E00", markColor: "#F0E442" },
  },
  {
    id: "high-contrast",
    name: "High contrast",
    alike: true,
    light: { nodeColor: "#000000", markColor: "#D55E00" },
    dark: { nodeColor: "#FFFFFF", markColor: "#F0E442" },
  },
];

/** the colours of a preset that read on this page: its light or its dark variant */
export const presetColorsFor = (
  preset: FlowColorPreset,
  background: string | null | undefined,
): FlowPresetColors => (isDarkPage(background) ? preset.dark : preset.light);

const same = (a: string | null, b: string | null) =>
  (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

/** whether the look's two colours are the preset's own, on this page */
export const presetIsChosen = (
  preset: FlowColorPreset,
  look: FlowPresetColors,
  background: string | null | undefined,
) => {
  const colors = presetColorsFor(preset, background);

  return (
    same(look.nodeColor, colors.nodeColor) &&
    same(look.markColor, colors.markColor)
  );
};
