/**
 * The ink look of a drawn element (D-241).
 *
 * An element's ink is how what it draws is painted: as it always was (Normal),
 * as a neon tube, as chalk, as marker or as pencil. The look and its amount are
 * kept on the element in `customData.ink`, so they are saved, copied and undone
 * with it, and an element without them is Normal.
 *
 * What is here is pure: the data, and the *plan* of a look - the steps the
 * canvas and the SVG export follow to paint it - so that both are made from one
 * place and can be read without a canvas.
 */

import type { ExcalidrawElement } from "./types";

export const INK_LOOKS = [
  "normal",
  "neon",
  "chalk",
  "marker",
  "pencil",
] as const;

export type InkLookName = typeof INK_LOOKS[number];

export type Ink = {
  look: InkLookName;
  /** 1 to 100: the glow of neon, the dust of chalk, the weight of marker, the grain of pencil */
  amount: number;
};

export const DEFAULT_INK_AMOUNT = 50;

export const NORMAL_INK: Ink = { look: "normal", amount: DEFAULT_INK_AMOUNT };

/** the named colours each look offers, which set the ink colour */
export const INK_COLORS: Record<
  Exclude<InkLookName, "normal">,
  readonly { name: string; color: string }[]
> = {
  neon: [
    { name: "Pink", color: "#ff2bd6" },
    { name: "Cyan", color: "#00f0ff" },
    { name: "Lime", color: "#b6ff00" },
    { name: "Yellow", color: "#fff200" },
    { name: "Orange", color: "#ff9100" },
    { name: "Violet", color: "#a855ff" },
    { name: "White", color: "#ffffff" },
  ],
  chalk: [
    { name: "White", color: "#f5f5f0" },
    { name: "Yellow", color: "#f7e26b" },
    { name: "Pink", color: "#f4a6c0" },
    { name: "Blue", color: "#8ecbf5" },
    { name: "Green", color: "#a8e6a1" },
    { name: "Orange", color: "#f7b267" },
  ],
  marker: [
    { name: "Yellow", color: "#ffe500" },
    { name: "Pink", color: "#ff5fa2" },
    { name: "Green", color: "#3ddc84" },
    { name: "Blue", color: "#2f9bff" },
    { name: "Orange", color: "#ff8a1f" },
    { name: "Purple", color: "#9b5de5" },
  ],
  pencil: [
    { name: "Graphite", color: "#4a4a4a" },
    { name: "Blue", color: "#3b6fb6" },
    { name: "Red", color: "#c0392b" },
    { name: "Green", color: "#3a7d44" },
    { name: "Brown", color: "#7a5230" },
  ],
};

/** the elements that are drawn with ink: not an image, a frame or an embedded page */
const INKED_TYPES = new Set<string>([
  "text",
  "freedraw",
  "rectangle",
  "diamond",
  "ellipse",
  "line",
  "arrow",
]);

export const canHaveInk = (element: { type: string }) =>
  INKED_TYPES.has(element.type);

export const clampInkAmount = (amount: unknown) => {
  const n = typeof amount === "number" && Number.isFinite(amount) ? amount : 50;

  return Math.min(100, Math.max(1, Math.round(n)));
};

export const isInkLook = (value: unknown): value is InkLookName =>
  typeof value === "string" && (INK_LOOKS as readonly string[]).includes(value);

/** the ink of an element: Normal when it has none, or when it cannot have one */
export const inkOf = (
  element: Pick<ExcalidrawElement, "type" | "customData">,
): Ink => {
  const stored = element.customData?.ink;

  if (!canHaveInk(element) || !stored || !isInkLook(stored.look)) {
    return NORMAL_INK;
  }

  return { look: stored.look, amount: clampInkAmount(stored.amount) };
};

/**
 * The `customData` of an element with this ink. Normal takes the ink away, so
 * that an element that is Normal is the same as one that never had a look.
 */
export const customDataWithInk = (
  customData: ExcalidrawElement["customData"],
  ink: Ink,
): ExcalidrawElement["customData"] => {
  const { ink: _previous, ...rest } = customData ?? {};

  if (ink.look === "normal") {
    return Object.keys(rest).length ? rest : undefined;
  }

  return {
    ...rest,
    ink: { look: ink.look, amount: clampInkAmount(ink.amount) },
  };
};

/* ------------------------------------------------------------------ the plan */

export type InkStep =
  /** a coloured shadow of this reach (in scene units) around the ink */
  | { op: "halo"; blur: number; color: string; alpha: number }
  /** the ink painted again in this colour, on top: the bright core of a tube */
  | { op: "core"; color: string }
  /** fine gaps in the ink; `cell` is the size of a grain in scene units */
  | { op: "holes"; density: number; cell: number; seed: number }
  /** the ink is spread this far (scene units): a broader nib */
  | { op: "thicken"; radius: number }
  /** the ink lets the paper through */
  | { op: "alpha"; value: number };

const NEON_HALO = [2, 6, 14, 28] as const;
/** how far the core of a neon tube is lightened toward white */
const NEON_CORE_PERCENT_OF_COLOR = 25;

const hex = (color: string) => {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());

  if (!match) {
    return null;
  }

  const digits =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((c) => c + c)
          .join("")
      : match[1];

  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
};

/** the colour with `percent` of it mixed with white (what `color-mix` does) */
export const lightenInkColor = (color: string, percent: number) => {
  const rgb = hex(color);

  if (!rgb) {
    return color;
  }

  return `#${rgb
    .map((c) =>
      Math.round(c * (percent / 100) + 255 * (1 - percent / 100))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
};

/** how strong a look is: 0.4 at the lowest amount, 1 at 50 and 1.6 at the top */
const strengthOf = (amount: number) =>
  0.4 + (clampInkAmount(amount) / 100) * 1.2;

/**
 * The steps that paint a look, in order. `color` is the ink colour of the
 * element and `seed` is its own seed, so that the gaps and the grain are the
 * same every time it is drawn.
 */
export const inkPlan = (ink: Ink, color: string, seed: number): InkStep[] => {
  const amount = clampInkAmount(ink.amount);
  const share = amount / 100;

  switch (ink.look) {
    case "neon": {
      const k = strengthOf(amount);

      return [
        ...NEON_HALO.map(
          (blur): InkStep => ({
            op: "halo",
            blur: Math.round(blur * k * 100) / 100,
            color,
            alpha: 1,
          }),
        ),
        {
          op: "core",
          color: lightenInkColor(color, NEON_CORE_PERCENT_OF_COLOR),
        },
      ];
    }
    case "chalk":
      return [
        { op: "halo", blur: 3, color, alpha: 0.35 },
        {
          op: "holes",
          density: Math.round((0.08 + 0.4 * share) * 1000) / 1000,
          cell: 1.5,
          seed,
        },
      ];
    case "marker":
      return [
        { op: "thicken", radius: Math.round((0.4 + 1.4 * share) * 100) / 100 },
        { op: "alpha", value: Math.round((0.9 - 0.3 * share) * 100) / 100 },
      ];
    case "pencil":
      return [
        {
          op: "holes",
          density: Math.round((0.1 + 0.35 * share) * 1000) / 1000,
          cell: 0.6,
          seed,
        },
        { op: "alpha", value: 0.85 },
      ];
    default:
      return [];
  }
};

/**
 * How far past its own bounds a look paints, in scene units: the canvas of the
 * element and the edge of an export have to leave this much room.
 */
export const inkPadding = (ink: Ink): number => {
  switch (ink.look) {
    case "neon":
      return Math.ceil(28 * strengthOf(ink.amount)) + 2;
    case "chalk":
      return 6;
    case "marker":
      return Math.ceil(0.4 + 1.4 * (clampInkAmount(ink.amount) / 100)) + 2;
    case "pencil":
      return 2;
    default:
      return 0;
  }
};

/** the room an export makes around its contents for the looks of its elements */
export const inkExportMargin = (
  elements: readonly Pick<ExcalidrawElement, "type" | "customData">[],
) =>
  elements.reduce((margin, el) => Math.max(margin, inkPadding(inkOf(el))), 0);

/* ------------------------------------------------------------- the SVG filter */

export type InkSvgPrimitive = {
  tag: string;
  attrs: Record<string, string>;
  children?: InkSvgPrimitive[];
};

/**
 * The SVG filter of a look, as data: the primitives to put in a `<filter>`. It
 * paints what `inkPlan` paints, with the primitives SVG has for it.
 */
export const inkSvgPrimitives = (
  ink: Ink,
  color: string,
  seed: number,
): InkSvgPrimitive[] => {
  const steps = inkPlan(ink, color, seed);
  const out: InkSvgPrimitive[] = [];
  const merge: string[] = [];
  let source = "SourceGraphic";
  let alpha = 1;

  steps.forEach((step, i) => {
    switch (step.op) {
      case "halo": {
        out.push(
          {
            tag: "feGaussianBlur",
            attrs: {
              in: "SourceAlpha",
              stdDeviation: String(step.blur / 2),
              result: `b${i}`,
            },
          },
          {
            tag: "feFlood",
            attrs: {
              "flood-color": step.color,
              "flood-opacity": String(step.alpha),
              result: `f${i}`,
            },
          },
          {
            tag: "feComposite",
            attrs: {
              in: `f${i}`,
              in2: `b${i}`,
              operator: "in",
              result: `h${i}`,
            },
          },
        );
        merge.push(`h${i}`);
        break;
      }
      case "holes": {
        // the grain is noise; where it is bright the ink has a gap in it
        const threshold = Math.min(
          0.95,
          Math.max(0.3, 0.75 - step.density * 0.8),
        );

        out.push(
          {
            tag: "feTurbulence",
            attrs: {
              type: "fractalNoise",
              baseFrequency: String(
                Math.round((1 / step.cell) * 0.9 * 100) / 100,
              ),
              numOctaves: "2",
              seed: String(Math.abs(Math.trunc(step.seed)) % 10000),
              result: `n${i}`,
            },
          },
          {
            tag: "feColorMatrix",
            attrs: {
              in: `n${i}`,
              type: "matrix",
              values: `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -12 0 0 0 ${
                Math.round((12 * threshold + 1) * 100) / 100
              }`,
              result: `m${i}`,
            },
          },
          {
            tag: "feComposite",
            attrs: {
              in: source,
              in2: `m${i}`,
              operator: "in",
              result: `k${i}`,
            },
          },
        );
        source = `k${i}`;
        break;
      }
      case "thicken":
        out.push({
          tag: "feMorphology",
          attrs: {
            in: source,
            operator: "dilate",
            radius: String(step.radius),
            result: `t${i}`,
          },
        });
        source = `t${i}`;
        break;
      case "alpha":
        alpha = step.value;
        break;
      case "core": {
        out.push(
          {
            tag: "feFlood",
            attrs: { "flood-color": step.color, result: `c${i}` },
          },
          {
            tag: "feComposite",
            attrs: {
              in: `c${i}`,
              in2: "SourceAlpha",
              operator: "in",
              result: `core${i}`,
            },
          },
        );
        break;
      }
    }
  });

  const core = out.find((p) => p.attrs.result?.startsWith("core"))?.attrs
    .result;

  if (alpha !== 1) {
    out.push({
      tag: "feComponentTransfer",
      attrs: { in: source, result: "faded" },
      children: [
        { tag: "feFuncA", attrs: { type: "linear", slope: String(alpha) } },
      ],
    });
    source = "faded";
  }

  out.push({
    tag: "feMerge",
    attrs: {},
    children: [...merge, source, ...(core ? [core] : [])].map((node) => ({
      tag: "feMergeNode",
      attrs: { in: node },
    })),
  });

  return out;
};
