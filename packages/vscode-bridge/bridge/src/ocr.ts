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
 * The engines the bridge can read with (D-90).
 *
 * - `tesseract` runs **in this process** - it is `tesseract.js`, and it is
 *   declared and shipped inside the `.vsix` (D-89);
 * - `indra` and `paddle` are **Python**, so they run in a sidecar the
 *   extension spawns (D-90).
 *
 * The name is the same on both sides of the wire: the app asks for one, the
 * extension says which one ran.
 */
export type OcrEngineName = "tesseract" | "indra" | "paddle";

/** Every engine name, in the order they are offered. */
export const OCR_ENGINE_NAMES: readonly OcrEngineName[] = [
  "tesseract",
  "indra",
  "paddle",
];

/**
 * The engine the bridge uses when nothing says otherwise.
 *
 * It is `tesseract`: it is the one that is **shipped** (D-89), so it works
 * without anything installed.
 */
export const DEFAULT_OCR_ENGINE: OcrEngineName = "tesseract";

/** Whether a value is one of the engine names. */
export const isOcrEngineName = (value: unknown): value is OcrEngineName =>
  typeof value === "string" &&
  (OCR_ENGINE_NAMES as readonly string[]).includes(value);

/**
 * The state of the OCR engine (D-90, D-91).
 *
 * It is a **state**, not a silence: the panel has to be able to say which
 * engine is in use, and - when the engine is not there - **why** it is not
 * there and what to install (D-75, D-91).
 */
export type OcrEngineState = {
  /** "ready" - the engine can read. "unavailable" - it cannot. */
  state: "ready" | "unavailable";
  /** the engine that is in use */
  engine?: OcrEngineName;
  /** why the engine is not there. Never empty when the state is "unavailable". */
  reason?: string;
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
  /**
   * The engine the caller wants.
   *
   * It is **optional**: when it is absent the extension falls back to its own
   * setting (`excalidraw-bridge.ocrEngine`, D-90).
   */
  engine?: OcrEngineName;
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
  /**
   * Which engine **actually** read the text (D-90).
   *
   * It is optional, so an extension that predates it still connects (D-50).
   */
  engine?: OcrEngineName;
  /** how long the read took, in milliseconds */
  durationMs?: number;
};

/**
 * What the engine gives back, before the service puts the id on it.
 */
export type OcrEngineResult = {
  text: string;
  lines: OcrLine[];
  confidence?: number;
  /** which engine read it */
  engine?: OcrEngineName;
  /** how long the read took, in milliseconds */
  durationMs?: number;
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
      // the engine that ran, and the time it took: the panel shows both (D-90)
      ...(result.engine === undefined ? {} : { engine: result.engine }),
      ...(result.durationMs === undefined
        ? {}
        : { durationMs: result.durationMs }),
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
