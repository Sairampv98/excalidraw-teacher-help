import { newTextElement } from "@excalidraw/element";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import type { OcrLine } from "../../packages/vscode-bridge/bridge/src/ocr";

/**
 * Where an OCR read **lands** on the canvas.
 *
 * The read gives back the lines in the **image's own pixels** — that is the
 * contract (D-59) — and the image is drawn on the canvas at some rect, so the
 * placement is a matter of scale: the image's pixels per canvas unit.
 *
 * The result is one **text element per line**, placed over the picture it was
 * read from. That is what the owner asked for: the text is an ordinary
 * element of the document, so it is moved, restyled and undone like any other,
 * and it is never burnt into the picture.
 */

/** The smallest font size a line may get, in canvas units. */
export const OCR_MIN_FONT_SIZE = 8;

/**
 * The base64 payload of a data URL.
 *
 * The contract carries the image as base64, without the `data:` prefix: the
 * prefix says what the image is, and the engine already knows.
 */
export const dataUrlToBase64 = (dataURL: string): string => {
  const comma = dataURL.indexOf(",");

  return comma === -1 ? dataURL : dataURL.slice(comma + 1);
};

/**
 * The text elements of one OCR read.
 *
 * The lines are in the image's own pixels, and the image is drawn at the given
 * rect — so every line is placed where it was read from.
 */
export const ocrTextElements = ({
  lines,
  x,
  y,
  width,
  height,
  imageWidth,
  imageHeight,
  pageId,
  fontSize,
  strokeColor = "#000000",
}: {
  /** the lines, in the image's own pixels */
  lines: readonly OcrLine[];
  /** where the image is drawn on the canvas */
  x: number;
  y: number;
  /** the size the image is drawn at, on the canvas */
  width: number;
  height: number;
  /** the image's own size, in its pixels */
  imageWidth: number;
  imageHeight: number;
  /** the page the elements go on */
  pageId: string;
  /** the font size. When it is not given, the line's own height decides. */
  fontSize?: number;
  /** the colour of the text */
  strokeColor?: string;
}): ExcalidrawTextElement[] => {
  if (!imageWidth || !imageHeight) {
    return [];
  }

  const scaleX = width / imageWidth;
  const scaleY = height / imageHeight;

  return lines
    .filter((line) => !!line.text?.trim())
    .map((line) => {
      const size =
        fontSize ?? Math.max(OCR_MIN_FONT_SIZE, line.height * scaleY);

      return newTextElement({
        text: line.text,
        x: x + line.x * scaleX,
        y: y + line.y * scaleY,
        fontSize: size,
        strokeColor,
        textAlign: "left",
        verticalAlign: "top",
        autoResize: true,
        pageId,
      });
    });
};
