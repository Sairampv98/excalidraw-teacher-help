/**
 * Cuts the canvas to the shape of a node's media (D-246): what is drawn next is
 * only seen inside the shape, so a picture in an ellipse is a round picture.
 */

import type { MediaClip } from "./media";

/**
 * Sets the clip of the context to the cut, for a box of this size whose
 * top-left corner is at the origin. The caller saves and restores the context.
 */
export const clipToMedia = (
  context: CanvasRenderingContext2D,
  clip: MediaClip,
  width: number,
  height: number,
) => {
  switch (clip.kind) {
    case "ellipse":
      context.beginPath();
      context.ellipse(
        width / 2,
        height / 2,
        width / 2,
        height / 2,
        0,
        0,
        2 * Math.PI,
      );
      context.clip();
      break;
    case "polygon":
      context.beginPath();
      clip.points.forEach(([x, y], i) => {
        if (i === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
      context.closePath();
      context.clip();
      break;
    case "roundRect":
      if (context.roundRect) {
        context.beginPath();
        context.roundRect(0, 0, width, height, clip.radius);
        context.clip();
      }
      break;
    default:
      break;
  }
};
