/**
 * Browser-native Handwriting Recognition API engine (Chromium 99+).
 *
 * Uses the live-ink OS recognizer when present. Not available on Firefox /
 * Safari, so callers must treat `isAvailable()` as authoritative and fall back
 * to the local HTR engine. The API types are not in lib.dom for all TS
 * versions, so we declare the slice we use locally.
 */

import type {
  Ink,
  RecognitionResult,
  RecognizeOptions,
  Recognizer,
} from "./types";

type HandwritingPoint = { x: number; y: number; t?: number };
type HandwritingStroke = {
  addPoint: (p: HandwritingPoint) => void;
};
type HandwritingDrawing = {
  addStroke: (s: HandwritingStroke) => void;
  getPrediction: () => Promise<{ text: string }[]>;
};
type HandwritingRecognizer = {
  startDrawing: (hints?: Record<string, unknown>) => HandwritingDrawing;
  finish?: () => void;
};
type HandwritingNavigator = Navigator & {
  createHandwritingRecognizer?: (c: {
    languages: string[];
  }) => Promise<HandwritingRecognizer>;
  queryHandwritingRecognizerSupport?: (
    c: Record<string, unknown>,
  ) => Promise<Record<string, boolean> | null>;
};

const getNavigator = (): HandwritingNavigator | null =>
  typeof navigator === "undefined" ? null : (navigator as HandwritingNavigator);

export class ApiRecognizer implements Recognizer {
  readonly engine = "api" as const;
  readonly kind = "text" as const;

  private recognizer: HandwritingRecognizer | null = null;
  private language: string;

  constructor(language = "en") {
    this.language = language;
  }

  async isAvailable(): Promise<boolean> {
    const nav = getNavigator();
    if (!nav?.createHandwritingRecognizer) {
      return false;
    }
    try {
      if (nav.queryHandwritingRecognizerSupport) {
        const support = await nav.queryHandwritingRecognizerSupport({
          languages: [this.language],
        });
        // null means the constraints can't be satisfied.
        if (support === null) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  private async ensureRecognizer(): Promise<HandwritingRecognizer> {
    if (this.recognizer) {
      return this.recognizer;
    }
    const nav = getNavigator();
    if (!nav?.createHandwritingRecognizer) {
      throw new Error("Handwriting Recognition API unavailable");
    }
    this.recognizer = await nav.createHandwritingRecognizer({
      languages: [this.language],
    });
    return this.recognizer;
  }

  async recognize(
    ink: Ink,
    opts: RecognizeOptions = {},
  ): Promise<RecognitionResult> {
    const recognizer = await this.ensureRecognizer();
    const drawing = recognizer.startDrawing({
      languages: [opts.language ?? this.language],
      recognitionType: opts.layout === "paragraph" ? "text" : "text",
    });

    for (const stroke of ink.strokes) {
      const apiStroke: HandwritingStroke = (() => {
        // The constructor is HandwritingStroke; create via the live API shape.
        const s = {
          points: [] as HandwritingPoint[],
        } as unknown as HandwritingStroke & { points: HandwritingPoint[] };
        s.addPoint = (p: HandwritingPoint) => s.points.push(p);
        return s;
      })();
      for (const p of stroke.points) {
        apiStroke.addPoint({ x: p.x, y: p.y, t: p.t });
      }
      drawing.addStroke(apiStroke);
    }

    const predictions = await drawing.getPrediction();
    recognizer.finish?.();

    const alternatives = predictions.map((p) => p.text).filter(Boolean);
    return {
      text: alternatives[0] ?? "",
      alternatives,
      engine: "api",
    };
  }

  dispose() {
    this.recognizer?.finish?.();
    this.recognizer = null;
  }
}
