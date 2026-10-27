/**
 * The look of the flow animation (D-189 to D-192, D-195): colours, what the
 * highlight is put on, and the shape it takes.
 *
 * Everything here is pure, so what a setting means is tested without a canvas.
 * The look is the overlay's own - nothing here changes an element.
 */

/** what the highlight is drawn on: the whole node, or only the label (D-191) */
export type FlowHighlightTarget = "shape" | "text";

/** the colour the highlight and the marks have always had: the accent colour */
export const FLOW_ACCENT_COLOR = "var(--color-primary)";

/** the accent as a hex value, for a colour input that has to show something */
export const FLOW_ACCENT_HEX = "#6965db";

/** the colour of a hidden arrow's cover when the page has no background */
export const FLOW_FALLBACK_BACKGROUND = "#ffffff";

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

/** the target of the highlight; anything but "text" is the whole shape */
export const readFlowTarget = (value: unknown): FlowHighlightTarget =>
  value === "text" ? "text" : "shape";

/** a colour input needs a value even when the setting is the default */
export const colorInputValue = (color: string | null) =>
  color && /^#[0-9a-f]{6}$/i.test(color) ? color : FLOW_ACCENT_HEX;

/** the page's background as a colour a cover can be painted in (D-190) */
export const coverColor = (viewBackgroundColor?: string | null) =>
  viewBackgroundColor && viewBackgroundColor !== "transparent"
    ? viewBackgroundColor
    : FLOW_FALLBACK_BACKGROUND;

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
