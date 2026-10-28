/**
 * The media of a node (D-246).
 *
 * A node - a shape of a chart - can hold a picture, a GIF or a video. The media
 * is an element of its own that lies over the node, cut to the node's **shape**
 * and filling it, so an ellipse holds a round picture and a diamond a diamond
 * one, with no borders to fit it in. What ties it to its node, and which shape
 * it is cut to, is kept on the element in `customData.media`, so it is saved,
 * copied and undone with it.
 *
 * What is here is pure: the data, the shape of the cut as data (which the
 * canvas, the SVG export and the overlays of a GIF and a video each draw their
 * own way) and the crop that fills a box.
 */

import { isMediaFit, readMediaView } from "./mediaFit";

import type { MediaFit, MediaView } from "./mediaFit";
import type { ExcalidrawElement, ImageCrop } from "./types";

export const MEDIA_SHAPES = [
  "rectangle",
  "rounded",
  "ellipse",
  "diamond",
] as const;

export type MediaShape = typeof MEDIA_SHAPES[number];

export type NodeMedia = {
  /** the id of the node the media is in */
  of: string;
  /** the shape the media is cut to: the node's own */
  shape: MediaShape;
  /** the radius of a rounded cut, in scene units */
  radius: number;
  /**
   * What the node looked like when the media was fitted to it (`nodeSignature`):
   * when the node's shape or size is changed later, the media is fitted again.
   */
  sig?: string;
  /** how the picture sits in the shape (D-247); `auto` when it is not given */
  fit?: MediaFit;
  /** the part of the picture that is shown, in the picture's pixels (D-247) */
  view?: MediaView;
  /** the picture's own size, which the view is measured in (D-247) */
  natural?: { width: number; height: number };
  /** what the node's words are while it holds media (D-248); a caption when it is not given */
  words?: WordsMode;
};

/** a caption below the node, or hidden and locked under the media */
export const WORDS_MODES = ["caption", "hidden"] as const;

export type WordsMode = typeof WORDS_MODES[number];

export const isWordsMode = (value: unknown): value is WordsMode =>
  typeof value === "string" &&
  (WORDS_MODES as readonly string[]).includes(value);

export const isMediaShape = (value: unknown): value is MediaShape =>
  typeof value === "string" &&
  (MEDIA_SHAPES as readonly string[]).includes(value);

/** the media data of an element, or null when it is not the media of a node */
export const mediaOf = (
  element: Pick<ExcalidrawElement, "customData">,
): NodeMedia | null => {
  const stored = element.customData?.media;

  if (!stored || typeof stored.of !== "string" || !isMediaShape(stored.shape)) {
    return null;
  }

  return {
    of: stored.of,
    shape: stored.shape,
    radius:
      typeof stored.radius === "number" && Number.isFinite(stored.radius)
        ? Math.max(0, stored.radius)
        : 0,
    ...(typeof stored.sig === "string" ? { sig: stored.sig } : {}),
    ...(isMediaFit(stored.fit) ? { fit: stored.fit } : {}),
    ...(isWordsMode(stored.words) ? { words: stored.words } : {}),
    ...(readMediaView(stored.view)
      ? { view: readMediaView(stored.view)! }
      : {}),
    ...(typeof stored.natural?.width === "number" &&
    typeof stored.natural?.height === "number" &&
    stored.natural.width > 0 &&
    stored.natural.height > 0
      ? {
          natural: {
            width: stored.natural.width,
            height: stored.natural.height,
          },
        }
      : {}),
  };
};

/**
 * The `customData` of an element with this media data; null takes it away, so
 * that an element that is not media is the same as one that never was.
 */
export const customDataWithMedia = (
  customData: ExcalidrawElement["customData"],
  media: NodeMedia | null,
): ExcalidrawElement["customData"] => {
  const { media: _previous, ...rest } = customData ?? {};

  if (!media) {
    return Object.keys(rest).length ? rest : undefined;
  }

  return { ...rest, media: { ...media } };
};

/** the shapes that can hold media: the ones a node is drawn as */
export const canHoldMedia = (element: { type: string }) =>
  element.type === "rectangle" ||
  element.type === "ellipse" ||
  element.type === "diamond";

/** the shape a node's media is cut to: the node's own */
export const mediaShapeOfNode = (
  node: Pick<ExcalidrawElement, "type" | "roundness">,
): MediaShape => {
  switch (node.type) {
    case "ellipse":
      return "ellipse";
    case "diamond":
      return "diamond";
    default:
      return node.roundness ? "rounded" : "rectangle";
  }
};

/**
 * What fits media to a node: the node's shape and size, not its place (a node
 * that is moved takes its media with it and needs nothing refitted).
 */
export const nodeSignature = (
  node: Pick<ExcalidrawElement, "type" | "width" | "height" | "angle">,
  shape: MediaShape,
  radius: number,
) =>
  [
    shape,
    Math.round(node.width * 100) / 100,
    Math.round(node.height * 100) / 100,
    Math.round(node.angle * 1000) / 1000,
    Math.round(radius * 100) / 100,
  ].join("|");

/* ------------------------------------------------------------------- the cut */

export type MediaClip =
  | { kind: "none" }
  | { kind: "roundRect"; radius: number }
  | { kind: "ellipse" }
  | { kind: "polygon"; points: readonly (readonly [number, number])[] };

/** the cut of a shape on a box of this size, as data */
export const mediaClip = (
  media: Pick<NodeMedia, "shape" | "radius">,
  width: number,
  height: number,
): MediaClip => {
  switch (media.shape) {
    case "ellipse":
      return { kind: "ellipse" };
    case "diamond":
      return {
        kind: "polygon",
        points: [
          [width / 2, 0],
          [width, height / 2],
          [width / 2, height],
          [0, height / 2],
        ],
      };
    case "rounded":
      return media.radius > 0
        ? {
            kind: "roundRect",
            radius: Math.min(media.radius, width / 2, height / 2),
          }
        : { kind: "none" };
    default:
      return { kind: "none" };
  }
};

/** the cut as a CSS `clip-path`, for the overlays of a GIF and a video; undefined when there is none */
export const mediaCssClip = (
  media: Pick<NodeMedia, "shape" | "radius">,
): string | undefined => {
  switch (media.shape) {
    case "ellipse":
      return "ellipse(50% 50% at 50% 50%)";
    case "diamond":
      return "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)";
    case "rounded":
      return media.radius > 0 ? `inset(0 round ${media.radius}px)` : undefined;
    default:
      return undefined;
  }
};

/* ------------------------------------------------------------------ the crop */

/**
 * The crop of a picture that **fills** a box: the part of the picture, centred,
 * that has the box's shape. The picture is cut and not shrunk to fit, so there
 * are no borders round it.
 */
export const coverCrop = (
  box: { width: number; height: number },
  natural: { width: number; height: number },
): ImageCrop => {
  const boxRatio = box.width / Math.max(1, box.height);
  const ratio = natural.width / Math.max(1, natural.height);

  let width = natural.width;
  let height = natural.height;

  if (ratio > boxRatio) {
    // wider than the box: the sides are cut
    width = natural.height * boxRatio;
  } else {
    // taller than the box: the top and the foot are cut
    height = natural.width / boxRatio;
  }

  return {
    x: (natural.width - width) / 2,
    y: (natural.height - height) / 2,
    width,
    height,
    naturalWidth: natural.width,
    naturalHeight: natural.height,
  };
};

/**
 * The node a text is the caption of (D-248): while a node holds media its words
 * are a free text under it, tied to it by `customData.caption`.
 */
export type NodeCaption = {
  /** the id of the node */
  of: string;
  /**
   * Where the node and the caption were when the caption was last put in its
   * place: a node that is moved by itself takes its caption with it, and a
   * caption that is moved by the teacher is left where it is put.
   */
  at?: { nx: number; ny: number; cx: number; cy: number };
};

export const captionOf = (
  element: Pick<ExcalidrawElement, "customData">,
): NodeCaption | null => {
  const stored = element.customData?.caption;

  if (!stored || typeof stored.of !== "string") {
    return null;
  }

  const at = stored.at;

  return {
    of: stored.of,
    ...(at &&
    [at.nx, at.ny, at.cx, at.cy].every(
      (n: unknown) => typeof n === "number" && Number.isFinite(n),
    )
      ? { at: { nx: at.nx, ny: at.ny, cx: at.cx, cy: at.cy } }
      : {}),
  };
};

/** the `customData` with this caption data; null takes it away */
export const customDataWithCaption = (
  customData: ExcalidrawElement["customData"],
  caption: NodeCaption | null,
): ExcalidrawElement["customData"] => {
  const { caption: _previous, ...rest } = customData ?? {};

  if (!caption) {
    return Object.keys(rest).length ? rest : undefined;
  }

  return { ...rest, caption: { ...caption } };
};
