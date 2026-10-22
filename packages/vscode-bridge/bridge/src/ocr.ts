/**
 * The **OCR contract** — the ONE definition, shared by the app and the bridge.
 *
 * The app asks, the bridge answers, and both sides speak these types (D-59).
 *
 * ## Where the engine runs
 *
 * The engine is `tesseract.js` (WASM) in the **bridge's Node process** — the
 * VS Code extension's process — and never in the browser. A WASM OCR engine is
 * a multi-megabyte download, and a classroom connection is slow; the browser
 * is not where it belongs (D-59).
 *
 * ## The ROI crop is the big lever, and it is free
 *
 * A subtitle band is a small fraction of a 1080p frame, so reading only that
 * band turns a full-frame pass into a pass that is an order of magnitude
 * faster. The region travels **in the request**, in the image's **own pixels**,
 * and the engine reads only that part of the image.
 *
 * The lines that come back are in the **whole image's** pixels, not in the
 * crop's: the caller places them over the image it asked about, and it must
 * not have to know that the engine worked on a crop.
 */

/**
 * The part of the image to read, in the image's **own pixels**.
 */
export type OcrRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * A request to read the text out of an image.
 */
export type OcrRequest = {
  /** the request's id — the answer carries it back */
  id: string;
  /** the image to read, base64 */
  imageBase64: string;
  /** the region of interest — only these pixels are processed */
  region?: OcrRegion;
  /** the language to read, when the caller knows it */
  language?: string;
};

/**
 * One line of text, and where it is in the image.
 *
 * The box is in the **whole image's** pixels, so a caller can put the text
 * back where it was read from.
 */
export type OcrLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * The answer: the text that was read, and where each line is.
 */
export type OcrResult = {
  /** the request's id */
  id: string;
  /** all the text, as one string */
  text: string;
  /** the per-line boxes, so the text can be placed as individual elements */
  lines: OcrLine[];
  /** the engine's confidence, when it gives one */
  confidence?: number;
};

/**
 * What the engine gives back, before the service puts the id on it.
 */
export type OcrEngineResult = {
  text: string;
  lines: OcrLine[];
  confidence?: number;
};

/**
 * The engine the service drives.
 *
 * The engine is a **sidecar** to the contract: the service does not know how
 * the text is read, only that it is.
 */
export interface OcrEngine {
  recognize: (request: OcrRequest) => Promise<OcrEngineResult>;
}

/**
 * The OCR **service**: the request goes in, the result comes out.
 *
 * It is thin on purpose. The rules that matter — the crop, the worker, the
 * core — live in the engine, and the service is what both sides agree on.
 */
export const createOcrService = (
  engine: OcrEngine,
): { recognize: (request: OcrRequest) => Promise<OcrResult> } => ({
  recognize: async (request: OcrRequest): Promise<OcrResult> => {
    const result = await engine.recognize(request);

    return {
      id: request.id,
      text: result.text ?? "",
      lines: result.lines ?? [],
      ...(result.confidence === undefined
        ? {}
        : { confidence: result.confidence }),
    };
  },
});

/**
 * The rectangle the engine reads, in the engine's own shape.
 *
 * The engine's rectangle is measured from the **top left**, like every
 * rectangle in a raster, and the region's `x`/`y` are too.
 */
export const ocrRectangle = (
  region: OcrRegion | undefined,
): { left: number; top: number; width: number; height: number } | undefined =>
  region
    ? {
        left: region.x,
        top: region.y,
        width: region.width,
        height: region.height,
      }
    : undefined;

/**
 * The lines of a read.
 *
 * They are in the **whole image's** pixels, not in the crop's: the engine
 * crops the image itself (the region is its own rectangle option) and it
 * still reports the boxes where the text really is in the image. So the
 * caller can put the text back where it was read from without knowing that
 * the engine worked on a crop.
 */
export type OcrLines = readonly OcrLine[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a value is a region of interest. */
export const isOcrRegion = (value: unknown): value is OcrRegion =>
  isRecord(value) &&
  typeof value.x === "number" &&
  typeof value.y === "number" &&
  typeof value.width === "number" &&
  typeof value.height === "number";

/** Whether a value is a line of text with its box. */
export const isOcrLine = (value: unknown): value is OcrLine =>
  isRecord(value) &&
  typeof value.text === "string" &&
  typeof value.x === "number" &&
  typeof value.y === "number" &&
  typeof value.width === "number" &&
  typeof value.height === "number";
