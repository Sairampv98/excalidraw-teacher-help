/**
 * The look of the flow animation (D-189 to D-192, D-195): colours, what the
 * highlight is put on, and the shape it takes.
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

/** what the look is made of: the part of the animation that is only colour */
export type FlowLook = {
  /** the colour of the highlight; `null` is the accent colour */
  nodeColor: string | null;
  /** the colour of what travels along the arrows; `null` is the accent colour */
  markColor: string | null;
  /** the colour the arrow is drawn in while it plays; `null` leaves it alone */
  arrowColor: string | null;
  /** paint the arrow in the page's background, so only the marks show */
  hideArrow: boolean;
  nodeTarget: FlowHighlightTarget;
};

export const FLOW_LOOK_DEFAULTS: FlowLook = {
  nodeColor: null,
  markColor: null,
  arrowColor: null,
  hideArrow: false,
  nodeTarget: "shape",
};

/** a look read defensively from whatever a document or a store holds (D-188) */
export const readFlowLook = (source: unknown): FlowLook => {
  const entry =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)
      : {};

  return {
    nodeColor: readFlowColor(entry.nodeColor),
    markColor: readFlowColor(entry.markColor),
    arrowColor: readFlowColor(entry.arrowColor),
    hideArrow: typeof entry.hideArrow === "boolean" ? entry.hideArrow : false,
    nodeTarget: readFlowTarget(entry.nodeTarget),
  };
};
