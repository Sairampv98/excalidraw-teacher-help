/**
 * How the media of a node sits in the node's shape (D-247).
 *
 * The part of the picture that is shown is its **view**: a rectangle of the
 * picture, in the picture's own pixels, that is mapped onto the node's box. It
 * has the box's shape (so nothing is stretched) and it may reach past the edges
 * of the picture, which then shows the node under it. The four **fits** are four
 * ways of choosing it:
 *
 * - **auto**: the picture fills the shape, centred, and is cut to it;
 * - **crop**: the teacher's own choice of the part to keep;
 * - **best**: the whole picture, as large as the box lets it be, and the node's
 *   outline trims what lies beyond the shape;
 * - **inside**: the whole picture, as large as the *shape* lets it be, so that it
 *   is wholly inside the outline.
 *
 * What is here is pure: the fits as data, and the placement of the picture that a
 * view makes, which the canvas, the SVG export and the overlays of a GIF and a
 * video each draw their own way.
 */

import { coverCrop } from "./media";

import type { MediaShape } from "./media";

export const MEDIA_FITS = ["auto", "crop", "best", "inside"] as const;

export type MediaFit = typeof MEDIA_FITS[number];

export type Size = { width: number; height: number };

/** a part of the picture, in the picture's own pixels; it may reach past the picture */
export type MediaView = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const isMediaFit = (value: unknown): value is MediaFit =>
  typeof value === "string" &&
  (MEDIA_FITS as readonly string[]).includes(value);

/** the view as it is stored: numbers only, and a width and height that are real */
export const readMediaView = (value: unknown): MediaView | null => {
  const view = value as Partial<MediaView> | null | undefined;

  if (
    !view ||
    ![view.x, view.y, view.width, view.height].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    ) ||
    view.width! <= 0 ||
    view.height! <= 0
  ) {
    return null;
  }

  return {
    x: view.x!,
    y: view.y!,
    width: view.width!,
    height: view.height!,
  };
};

/** a view of this width that has the box's shape, centred where `view` was */
export const viewWithBoxShape = (view: MediaView, box: Size): MediaView => {
  const width = Math.max(1, view.width);
  const height = (width * box.height) / Math.max(1, box.width);

  return {
    x: view.x + view.width / 2 - width / 2,
    y: view.y + view.height / 2 - height / 2,
    width,
    height,
  };
};

/** the view that makes the picture as large as it can be while all of it is in the box */
const containView = (box: Size, natural: Size): MediaView => {
  const aspect = box.width / Math.max(1, box.height);
  const width = Math.max(natural.width, natural.height * aspect);
  const height = width / aspect;

  return {
    x: (natural.width - width) / 2,
    y: (natural.height - height) / 2,
    width,
    height,
  };
};

/**
 * The view that makes the picture as large as it can be while all of it is
 * inside the shape: its four corners touch the outline.
 */
const insideView = (box: Size, natural: Size, shape: MediaShape): MediaView => {
  if (shape !== "ellipse" && shape !== "diamond") {
    // a rectangle is as large as the box
    return containView(box, natural);
  }

  const w = natural.width / Math.max(1, box.width);
  const h = natural.height / Math.max(1, box.height);
  // box units per pixel of the picture, so that the corners reach the outline:
  // (w s)^2 + (h s)^2 = 1 for an ellipse, w s + h s = 1 for a diamond
  const scale =
    shape === "ellipse" ? 1 / Math.sqrt(w * w + h * h) : 1 / (w + h);
  // the box, in the picture's pixels
  const width = box.width / scale;
  const height = box.height / scale;

  return {
    x: (natural.width - width) / 2,
    y: (natural.height - height) / 2,
    width,
    height,
  };
};

/**
 * The view of a fit. `current` is the view the teacher chose, which a `crop` fit
 * keeps (given the shape of the box it is now in); the other fits are worked out
 * from the picture and the box alone.
 */
export const viewForFit = (
  fit: MediaFit,
  box: Size,
  natural: Size,
  shape: MediaShape,
  current?: MediaView | null,
): MediaView => {
  switch (fit) {
    case "crop":
      return current
        ? viewWithBoxShape(current, box)
        : viewForFit("auto", box, natural, shape);
    case "best":
      return containView(box, natural);
    case "inside":
      return insideView(box, natural, shape);
    default: {
      const crop = coverCrop(box, natural);

      return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
    }
  }
};

/**
 * Where the whole picture lands on the box (both in the box's own units, with
 * the box's top-left corner at the origin) when `view` is what is shown.
 */
export const viewPlacement = (view: MediaView, box: Size, natural: Size) => {
  const scale = box.width / Math.max(1e-6, view.width);

  return {
    scale,
    x: -view.x * scale,
    y: -view.y * scale,
    width: natural.width * scale,
    height: natural.height * scale,
  };
};

/**
 * The part of the picture that is in the picture's own bounds, for the
 * renderers that can only draw a part of a picture (the crop of an image
 * element). It is null when the view reaches past the picture.
 */
export const viewAsCrop = (view: MediaView, natural: Size) =>
  view.x >= -1e-6 &&
  view.y >= -1e-6 &&
  view.x + view.width <= natural.width + 1e-6 &&
  view.y + view.height <= natural.height + 1e-6
    ? {
        x: Math.max(0, view.x),
        y: Math.max(0, view.y),
        width: view.width,
        height: view.height,
        naturalWidth: natural.width,
        naturalHeight: natural.height,
      }
    : null;

/** a view moved and scaled by the teacher's drag, kept sane: not smaller than a few pixels and not enormous */
export const clampView = (view: MediaView, box: Size, natural: Size) => {
  const aspect = box.height / Math.max(1, box.width);
  const min = Math.max(4, Math.min(natural.width, natural.height) / 50);
  const max =
    Math.max(natural.width, natural.height * (box.width / box.height)) * 4;
  const width = Math.min(Math.max(view.width, min), max);

  return {
    x: view.x + view.width / 2 - width / 2,
    y: view.y + view.height / 2 - (width * aspect) / 2,
    width,
    height: width * aspect,
  };
};

/* ------------------------------------------------------------ the crop box */

export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** the view moved by this much of the picture's pixels */
export const moveView = (
  view: MediaView,
  dx: number,
  dy: number,
): MediaView => ({
  ...view,
  x: view.x + dx,
  y: view.y + dy,
});

/**
 * The view after a handle of the crop box is dragged to a point (in the
 * picture's pixels). The box keeps the shape of the node's box, so a corner and
 * a side both change its size and nothing is stretched; the corner or side
 * across from the handle stays where it is.
 */
export const resizeView = (
  view: MediaView,
  handle: CropHandle,
  point: { x: number; y: number },
  box: Size,
): MediaView => {
  const ratio = box.width / Math.max(1, box.height);
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  // the point that stays: the opposite corner, or the middle of the opposite side
  const anchor = {
    x: west ? view.x + view.width : east ? view.x : view.x + view.width / 2,
    y: north ? view.y + view.height : south ? view.y : view.y + view.height / 2,
  };
  const byWidth = Math.abs(point.x - anchor.x);
  const byHeight = Math.abs(point.y - anchor.y) * ratio;
  const horizontal = west || east;
  const vertical = north || south;
  const width = Math.max(
    1,
    horizontal && vertical
      ? Math.max(byWidth, byHeight)
      : horizontal
      ? byWidth
      : byHeight,
  );
  const height = width / ratio;

  return {
    width,
    height,
    x: west ? anchor.x - width : east ? anchor.x : anchor.x - width / 2,
    y: north ? anchor.y - height : south ? anchor.y : anchor.y - height / 2,
  };
};

/** the smallest rectangle that holds the picture and every view given */
export const extentOf = (natural: Size, views: readonly MediaView[]) => {
  let left = 0;
  let top = 0;
  let right = natural.width;
  let bottom = natural.height;

  for (const view of views) {
    left = Math.min(left, view.x);
    top = Math.min(top, view.y);
    right = Math.max(right, view.x + view.width);
    bottom = Math.max(bottom, view.y + view.height);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
};
