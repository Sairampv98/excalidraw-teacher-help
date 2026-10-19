/**
 * Handwriting recognition – shared types.
 *
 * The recognition layer is engine-agnostic. A `Recognizer` takes a set of
 * ink strokes and returns recognized text (plus alternatives). Two engines
 * implement this interface:
 *   - `apiRecognizer`  – browser-native Handwriting Recognition API (Chromium)
 *   - `htrRecognizer`  – local ONNX model via onnxruntime-web (all browsers)
 *
 * Shape and table recognition reuse the same module but produce structured
 * results instead of plain text (see `ShapeRecognizer` / `TableRecognizer`).
 */

/** A single ink point. `t` is milliseconds relative to stroke start. */
export type InkPoint = {
  x: number;
  y: number;
  /** Timestamp (ms). Synthesized from point index when not captured live. */
  t: number;
  /** Optional pen pressure in [0, 1]. */
  pressure?: number;
};

/** One pen-down → pen-up trajectory. */
export type Stroke = {
  points: InkPoint[];
};

/** A set of strokes to be recognized together, in absolute scene coords. */
export type Ink = {
  strokes: Stroke[];
  /** Bounding box of the ink in scene coordinates. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

export type RecognitionResult = {
  /** Best guess. */
  text: string;
  /** Ranked alternatives (best first), including `text`. */
  alternatives: string[];
  /** 0..1 confidence for the best guess, when the engine reports it. */
  confidence?: number;
  /** Which engine produced the result. */
  engine: RecognizerEngine;
};

export type RecognizerEngine = "api" | "htr";

export type RecognizerKind = "text" | "shape" | "table";

/** Common contract every text recognizer satisfies. */
export interface Recognizer {
  readonly engine: RecognizerEngine;
  readonly kind: RecognizerKind;
  /** Resolves false if this engine can't run in the current environment. */
  isAvailable(): Promise<boolean>;
  recognize(ink: Ink, opts?: RecognizeOptions): Promise<RecognitionResult>;
  /** Release any loaded model / native recognizer. */
  dispose?(): void;
}

export type RecognizeOptions = {
  /** BCP-47 language hint, e.g. "en". */
  language?: string;
  /** Hint that input is a single line / word vs multi-line. */
  layout?: "auto" | "line" | "paragraph";
  signal?: AbortSignal;
};

/** User/engine selection preferences. */
export type RecognizerPreferences = {
  /**
   * Primary engine. Per product decision the default is the local HTR model
   * for consistent cross-browser, offline, private behavior; the browser API
   * is used as an optional accuracy upgrade when available.
   */
  primary: RecognizerEngine; // default: "htr"
  /** When true, prefer the browser API if it's available and we're online. */
  preferApiWhenAvailable: boolean;
  /** Path/URL the HTR engine loads its ONNX model from. */
  htrModelUrl?: string;
  language?: string;
};

export const DEFAULT_RECOGNIZER_PREFERENCES: RecognizerPreferences = {
  primary: "htr",
  preferApiWhenAvailable: true,
  htrModelUrl: undefined,
  language: "en",
};
