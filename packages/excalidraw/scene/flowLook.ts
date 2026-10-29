/**
 * The look of the flow animation (D-189 to D-192, D-195, D-208 to D-210):
 * colours, the glow, what the highlight is put on, and the shape it takes.
 *
 * Everything here is pure, so what a setting means is tested without a canvas.
 * The look is the overlay's own - nothing here changes an element.
 */

/**
 * What the highlight is put on (D-201): the node's outline, the rectangle on
 * the label's box, the label's letters, or an outline with one of the two.
 */
export type FlowHighlightTarget =
  | "shape"
  | "shape-box"
  | "shape-text"
  | "box"
  | "letters";

/** the choices, in the order the bar offers them, with the names it gives them */
export const FLOW_HIGHLIGHT_TARGETS: readonly {
  id: FlowHighlightTarget;
  label: string;
}[] = [
  { id: "shape", label: "Shape" },
  { id: "shape-box", label: "Shape + text box" },
  { id: "shape-text", label: "Shape + text" },
  { id: "box", label: "Text box" },
  { id: "letters", label: "Text" },
];

/** the colour the highlight and the marks have always had: the accent colour */
export const FLOW_ACCENT_COLOR = "var(--color-primary)";

/** the accent as a hex value, for a colour input that has to show something */
export const FLOW_ACCENT_HEX = "#6965db";

/**
 * Whether a value is a colour the look accepts: a hex value, which is what a
 * colour input gives. Anything else (a name, a function, junk, a number) is not
 * a colour, and is read as the default (D-189).
 */
export const isFlowColor = (value: unknown): value is string =>
  typeof value === "string" &&
  /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);

/** a colour, or `null` for "the default" */
export const readFlowColor = (value: unknown): string | null =>
  isFlowColor(value) ? value : null;

/**
 * The target of the highlight, read defensively. A value stored before wave 7u
 * is read as what it drew: "shape" stays, and the old "text" - which drew the
 * rectangle on the label's box - is the text box. Anything else is the shape.
 */
export const readFlowTarget = (value: unknown): FlowHighlightTarget => {
  if (FLOW_HIGHLIGHT_TARGETS.some((target) => target.id === value)) {
    return value as FlowHighlightTarget;
  }

  return value === "text" ? "box" : "shape";
};

/** a colour input needs a value even when the setting is the default */
export const colorInputValue = (color: string | null) =>
  color && /^#[0-9a-f]{6}$/i.test(color) ? color : FLOW_ACCENT_HEX;

/* ------------------------------------------------------------------ colour mixing */

/** red, green and blue, 0 to 255, of a hex colour; alpha is ignored */
const channelsOf = (hex: string): [number, number, number] | null => {
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

/**
 * `a` mixed with `b`: `t` is how much of `b` there is, 0 to 1. The result is a
 * hex colour; a value that is not a colour is returned as it is.
 */
export const mixHex = (a: string, b: string, t: number) => {
  const from = channelsOf(a);
  const to = channelsOf(b);

  if (!from || !to) {
    return a;
  }

  const clamped = Math.min(Math.max(t, 0), 1);

  const hex = from
    .map((channel, i) =>
      Math.round(channel * (1 - clamped) + to[i] * clamped)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

  return `#${hex}`;
};

/** how far toward white the core of a neon tube is lightened (D-208) */
export const NEON_CORE_TOWARD_WHITE = 0.75;

/** the bright core of a neon tube in this colour: the colour lightened (D-208) */
export const neonCore = (color: string) =>
  mixHex(color, "#ffffff", NEON_CORE_TOWARD_WHITE);

/**
 * The three strokes of the pipe made from the animation colour (D-210): the
 * outer stroke a darker shade, the body the colour itself, and the highlight
 * that runs along it a lighter tint.
 */
export const pipeColorsFor = (color: string) => ({
  dark: mixHex(color, "#000000", 0.6),
  body: color,
  flow: mixHex(color, "#ffffff", 0.8),
});

/* ------------------------------------------------------------------------- the look */

/** what the look is made of: the part of the animation that is only colour */
export type FlowLook = {
  /** the colour of the shape's highlight; `null` is the accent colour */
  nodeColor: string | null;
  /**
   * the colour of the text's highlight - the box and the letters (D-209); `null`
   * follows the shape colour
   */
  textColor: string | null;
  /** the colour of what travels along the arrows; `null` is the accent colour */
  markColor: string | null;
  /** the colour the arrow is drawn in while it plays; `null` leaves it alone */
  arrowColor: string | null;
  /** the canvas does not draw the arrow while it plays (D-204) */
  hideArrow: boolean;
  /** the shape's highlight is a neon tube (D-208, D-217) */
  glowShape: boolean;
  /** the text's highlight - box and letters - is a neon tube */
  glowText: boolean;
  /** what travels along the arrows is a neon tube */
  glowMark: boolean;
  /** the arrows themselves are drawn as neon tubes while it plays */
  glowArrow: boolean;
  nodeTarget: FlowHighlightTarget;
};

export const FLOW_LOOK_DEFAULTS: FlowLook = {
  nodeColor: null,
  textColor: null,
  markColor: null,
  arrowColor: null,
  hideArrow: false,
  glowShape: false,
  glowText: false,
  glowMark: false,
  glowArrow: false,
  nodeTarget: "shape",
};

const glowOf = (own: unknown, legacy: unknown) =>
  typeof own === "boolean" ? own : legacy === true;

/** a look read defensively from whatever a document or a store holds (D-188) */
export const readFlowLook = (source: unknown): FlowLook => {
  const entry =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)
      : {};

  return {
    nodeColor: readFlowColor(entry.nodeColor),
    textColor: readFlowColor(entry.textColor),
    markColor: readFlowColor(entry.markColor),
    arrowColor: readFlowColor(entry.arrowColor),
    hideArrow: typeof entry.hideArrow === "boolean" ? entry.hideArrow : false,
    // an entry from before the four switches had one glow for the shape, the
    // text and what travels (D-217)
    glowShape: glowOf(entry.glowShape, entry.glow),
    glowText: glowOf(entry.glowText, entry.glow),
    glowMark: glowOf(entry.glowMark, entry.glow),
    glowArrow: typeof entry.glowArrow === "boolean" ? entry.glowArrow : false,
    nodeTarget: readFlowTarget(entry.nodeTarget),
  };
};

/**
 * The look as CSS variables, for the stylesheet to draw with (D-189, D-208,
 * D-210). A variable that is not set means the stylesheet's own default - the
 * accent colour - and the cores and the pipe's shades are only set when there is
 * a colour to make them from.
 */
export const flowLookVars = (
  look: Pick<FlowLook, "nodeColor" | "textColor" | "markColor"> &
    Partial<Pick<FlowLook, "arrowColor">>,
): Record<string, string | undefined> => {
  const arrow = look.arrowColor ?? look.markColor;
  const text = look.textColor ?? look.nodeColor;
  const pipe = look.markColor ? pipeColorsFor(look.markColor) : null;

  return {
    "--flow-node-color": look.nodeColor ?? undefined,
    "--flow-text-color": look.textColor ?? undefined,
    "--flow-mark-color": look.markColor ?? undefined,
    "--flow-node-core": look.nodeColor ? neonCore(look.nodeColor) : undefined,
    "--flow-text-core": text ? neonCore(text) : undefined,
    "--flow-mark-core": look.markColor ? neonCore(look.markColor) : undefined,
    "--flow-arrow-color": arrow ?? undefined,
    "--flow-arrow-core": arrow ? neonCore(arrow) : undefined,
    "--flow-pipe-dark": pipe?.dark,
    "--flow-pipe-light": pipe?.body,
    "--flow-pipe-flow": pipe?.flow,
  };
};
