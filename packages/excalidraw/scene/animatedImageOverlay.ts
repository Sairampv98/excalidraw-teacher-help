/**
 * Where an animated image's DOM `<img>` goes.
 *
 * ## Why this file exists
 *
 * A GIF painted onto the canvas with `context.drawImage` is frozen, and no amount
 * of repainting fixes it. `drawImage` bakes in whichever frame the underlying
 * `<img>` is showing at that instant, and Chromium only advances a GIF's frame
 * clock while that image is **genuinely visible on screen**. This was measured
 * against the running app — a 2x2 fully opaque `<img>` in the document does not
 * animate, and neither does a 200x200 one at `opacity: 0.02`, or one hidden
 * behind the canvas. Only a visible one animates. So the animation has to come
 * from a real element on screen, not from the canvas at all.
 *
 * The renderer therefore skips animated images entirely (see
 * `packages/element/src/renderElement.ts`) and this module places a visible
 * `<img>` over the canvas instead. The browser then animates it natively.
 *
 * ## The transform
 *
 * `renderElement` composes an element into the scene like this:
 *
 * ```
 * translate(cx, cy) → rotate(angle) → scale(scale) → translate(-shiftX, -shiftY)
 * ```
 *
 * where `cx`/`cy` are the centre of the element's *unrotated* bounds and
 * `shiftX`/`shiftY` move that centre onto the element's own origin. The canvas
 * then applies `(scene + scroll) * zoom` on top.
 *
 * `animatedImageTransform` reproduces that exact chain as a CSS transform, with
 * `scale(zoom)` standing in for the canvas's own zoom. Because the element box
 * the browser lays out is `element.width × element.height` — the same box
 * `drawElementOnCanvas` draws into — applying the chain to a wrapper div lands
 * the image on the same pixels the canvas would have used.
 *
 * Note `getElementAbsoluteCoords` returns the *unrotated* box: the renderer
 * rotates on top of it rather than folding the rotation in, so the overlay has
 * to do the same. `getElementBounds` is the rotating variant, and is what the
 * clip below needs.
 */

import { getContainingFrame, getElementBounds } from "@excalidraw/element";
import { getElementAbsoluteCoords } from "@excalidraw/element";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import type { NormalizedZoomValue } from "../types";

export type AnimatedImageCamera = {
  zoom: { value: NormalizedZoomValue };
  scrollX: number;
  scrollY: number;
};

/**
 * Returned by {@link animatedImageClipPath} for an image that lies wholly
 * outside its frame. Distinct from `null` (no frame, nothing to clip), because
 * the caller must not render this one at all.
 */
export const OUTSIDE_FRAME = Symbol("outside-frame");

/**
 * The scene-space centre and the shift back to the element's own origin — the
 * two quantities `renderElement` derives from the element's bounds.
 */
const getElementTransformOrigin = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
) => {
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);

  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;

  return {
    centerX,
    centerY,
    shiftX: (x2 - x1) / 2 - (element.x - x1),
    shiftY: (y2 - y1) / 2 - (element.y - y1),
  };
};

/**
 * The CSS transform placing an element-sized box at `element.x/y` on screen.
 *
 * Coordinates are relative to the overlay host, which is laid over the editor
 * container, so `offsetLeft`/`offsetTop` (the container's position in the
 * viewport) cancel out and are deliberately absent — the scroll and zoom are all
 * that remain.
 */
export const animatedImageTransform = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
  { zoom, scrollX, scrollY }: AnimatedImageCamera,
) => {
  const { centerX, centerY, shiftX, shiftY } = getElementTransformOrigin(
    element,
    elementsMap,
  );

  // `sceneCoordsToViewportCoords` is `(scene + scroll) * zoom + offset`, and the
  // offset is the host's own origin, so only the first half is left here.
  const translateX = (centerX + scrollX) * zoom.value;
  const translateY = (centerY + scrollY) * zoom.value;

  const [scaleX, scaleY] = "scale" in element ? element.scale : [1, 1];

  return [
    `translate(${translateX}px, ${translateY}px)`,
    // the canvas scales the whole scene; this is that, folded in here
    `scale(${zoom.value})`,
    `rotate(${element.angle}rad)`,
    // note: scale must be applied *after* rotating, same as the canvas
    `scale(${scaleX}, ${scaleY})`,
    `translate(${-shiftX}px, ${-shiftY}px)`,
  ].join(" ");
};

/**
 * The element's on-screen bounding box, in overlay-host coordinates.
 *
 * Used for frame clipping. Unlike the transform above this *does* account for
 * rotation (`getElementBounds`, not `getElementAbsoluteCoords`), because a clip
 * built from the unrotated box would cut the corners off a rotated image.
 */
export const animatedImageViewportRect = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
  { zoom, scrollX, scrollY }: AnimatedImageCamera,
) => {
  const [x1, y1, x2, y2] = getElementBounds(element, elementsMap);

  return {
    left: (x1 + scrollX) * zoom.value,
    top: (y1 + scrollY) * zoom.value,
    width: (x2 - x1) * zoom.value,
    height: (y2 - y1) * zoom.value,
  };
};

/**
 * The clip an animated image needs so it does not spill out of the frame
 * holding it, as a `clip-path: inset(...)` over the whole overlay host.
 *
 * The canvas clips frame members with `context.clip()` before drawing, so an
 * image that ignores its frame would visibly overflow it. The host's own box is
 * the viewport and it already has `overflow: hidden`, so an element with no
 * frame needs no clip at all — `null` here means "nothing to clip to".
 *
 * `OUTSIDE_FRAME` means the image lies wholly outside its frame and none of it
 * can ever be seen, which is the caller's cue to drop it rather than to draw it
 * clipped away.
 */
export const animatedImageClipPath = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
  camera: AnimatedImageCamera,
  viewport: { width: number; height: number },
): string | null | typeof OUTSIDE_FRAME => {
  const frame = getContainingFrame(element, elementsMap);

  if (!frame) {
    return null;
  }

  const image = animatedImageViewportRect(element, elementsMap, camera);
  const frameRect = animatedImageViewportRect(frame, elementsMap, camera);

  const left = Math.max(image.left, frameRect.left);
  const top = Math.max(image.top, frameRect.top);
  const right = Math.min(
    image.left + image.width,
    frameRect.left + frameRect.width,
  );
  const bottom = Math.min(
    image.top + image.height,
    frameRect.top + frameRect.height,
  );

  if (right <= left || bottom <= top) {
    return OUTSIDE_FRAME;
  }

  return `inset(${top}px ${viewport.width - right}px ${
    viewport.height - bottom
  }px ${left}px)`;
};
