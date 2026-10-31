/**
 * The crop of an **image on the canvas**, as the crop window makes it (D-348).
 *
 * The window shows the whole picture with a box on it; the box is a part of the
 * picture's own pixels. What the element needs is its `crop` (the part, in
 * those pixels) and the size and place that keep the picture at the scale it
 * had on the canvas: a part that is half as wide is half as wide on the canvas
 * too, and it stays where it was - a crop does not make the picture jump.
 */

import type { ExcalidrawImageElement } from "@excalidraw/element/types";

/** a part of a picture, in the picture's own pixels */
export type ImagePart = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** the smallest part a crop may leave, in the picture's own pixels */
export const IMAGE_CROP_MIN = 8;

/** the part the element shows now: its crop, or the whole picture */
export const currentImagePart = (
  element: ExcalidrawImageElement,
  natural: { width: number; height: number },
): ImagePart =>
  element.crop
    ? {
        x: element.crop.x,
        y: element.crop.y,
        width: element.crop.width,
        height: element.crop.height,
      }
    : { x: 0, y: 0, width: natural.width, height: natural.height };

/** a part, held inside the picture and no smaller than the least a crop may be */
export const clampImagePart = (
  part: ImagePart,
  natural: { width: number; height: number },
): ImagePart => {
  const width = Math.min(Math.max(part.width, IMAGE_CROP_MIN), natural.width);
  const height = Math.min(
    Math.max(part.height, IMAGE_CROP_MIN),
    natural.height,
  );

  return {
    x: Math.min(Math.max(part.x, 0), natural.width - width),
    y: Math.min(Math.max(part.y, 0), natural.height - height),
    width,
    height,
  };
};

/**
 * What the element becomes when it shows `next`.
 *
 * The scale on the canvas stays what it was (the element's size over the part it
 * showed), the part that is shown now is put where it was, and a picture that is
 * turned is turned about its middle as before.
 */
export const imageCropUpdates = (
  element: ExcalidrawImageElement,
  next: ImagePart,
  natural: { width: number; height: number },
): Pick<ExcalidrawImageElement, "x" | "y" | "width" | "height" | "crop"> => {
  const before = currentImagePart(element, natural);
  const part = clampImagePart(next, natural);

  const scaleX = element.width / before.width;
  const scaleY = element.height / before.height;

  const width = part.width * scaleX;
  const height = part.height * scaleY;

  // where the new part's middle is, in the element's own (unturned) frame
  const middle = {
    x: element.x + (part.x - before.x) * scaleX + width / 2,
    y: element.y + (part.y - before.y) * scaleY + height / 2,
  };

  // the element turns about its middle, so the middle of the new part moves
  // with the turn
  const centre = {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };

  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  const dx = middle.x - centre.x;
  const dy = middle.y - centre.y;

  const turned = {
    x: centre.x + dx * cos - dy * sin,
    y: centre.y + dx * sin + dy * cos,
  };

  return {
    x: turned.x - width / 2,
    y: turned.y - height / 2,
    width,
    height,
    // a part that is the whole picture is no crop at all
    crop: isWholeImage(part, natural)
      ? null
      : {
          x: part.x,
          y: part.y,
          width: part.width,
          height: part.height,
          naturalWidth: natural.width,
          naturalHeight: natural.height,
        },
  };
};

/** whether a part is the whole picture */
export const isWholeImage = (
  part: ImagePart,
  natural: { width: number; height: number },
): boolean =>
  part.x <= 0 &&
  part.y <= 0 &&
  part.width >= natural.width &&
  part.height >= natural.height;
