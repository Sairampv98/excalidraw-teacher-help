/**
 * Local HTR engine — the default recognizer.
 *
 * Runs a small ONNX handwriting model entirely on the CPU via onnxruntime-web
 * (WASM/SIMD), so it works in every browser, offline, and keeps ink on-device.
 * Strokes are rasterized to a fixed-height grayscale strip and fed to a
 * CRNN-style model whose logits are CTC-greedy-decoded into text.
 *
 * onnxruntime-web is loaded lazily via dynamic import and typed as `any` so the
 * package builds without the dependency installed. To enable at runtime:
 *   1. `yarn add onnxruntime-web`
 *   2. ship an ONNX model + its character set, pass the URL via `htrModelUrl`.
 * Until then `isAvailable()` resolves false and selection falls back to the API.
 */

import { ctcGreedyDecode } from "./ctc";
import { rasterizeInk } from "./raster";

import type {
  Ink,
  RecognitionResult,
  RecognizeOptions,
  Recognizer,
} from "./types";

/** Input strip geometry the bundled model expects. */
const INPUT_HEIGHT = 32;
const MAX_WIDTH = 512;

type OrtModule = any;
type OrtSession = any;

let ortModulePromise: Promise<OrtModule | null> | null = null;

const loadOrt = (): Promise<OrtModule | null> => {
  if (!ortModulePromise) {
    // Indirect specifier (variable, not a string literal) so the bundler does
    // NOT try to statically resolve an optional dependency that may not be
    // installed. Until `onnxruntime-web` is added, this import simply rejects
    // and the engine reports itself unavailable.
    const moduleName = ["onnxruntime", "web"].join("-");
    ortModulePromise = import(/* @vite-ignore */ moduleName).then(
      (m) => (m?.default ?? m) as OrtModule,
      () => null,
    );
  }
  return ortModulePromise;
};

export type HtrRecognizerConfig = {
  modelUrl?: string;
  /** Ordered character vocabulary; index 0 is the CTC blank. */
  charset?: string[];
  language?: string;
};

/** Default vocabulary: blank + printable ASCII (override per model). */
const DEFAULT_CHARSET = [
  "", // CTC blank at index 0
  ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
];

export class HtrRecognizer implements Recognizer {
  readonly engine = "htr" as const;
  readonly kind = "text" as const;

  private modelUrl?: string;
  private charset: string[];
  private session: OrtSession | null = null;
  private sessionPromise: Promise<OrtSession | null> | null = null;

  constructor(config: HtrRecognizerConfig = {}) {
    this.modelUrl = config.modelUrl;
    this.charset = config.charset ?? DEFAULT_CHARSET;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.modelUrl) {
      return false;
    }
    const ort = await loadOrt();
    return ort != null;
  }

  private async ensureSession(): Promise<OrtSession | null> {
    if (this.session) {
      return this.session;
    }
    if (!this.modelUrl) {
      return null;
    }
    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        const ort = await loadOrt();
        if (!ort) {
          return null;
        }
        this.session = await ort.InferenceSession.create(this.modelUrl, {
          executionProviders: ["wasm"],
        });
        return this.session;
      })();
    }
    return this.sessionPromise;
  }

  async recognize(
    ink: Ink,
    _opts: RecognizeOptions = {},
  ): Promise<RecognitionResult> {
    const session = await this.ensureSession();
    const ort = await loadOrt();
    if (!session || !ort) {
      throw new Error("HTR model not loaded");
    }

    const { data, width, height } = rasterizeInk(ink, {
      height: INPUT_HEIGHT,
      maxWidth: MAX_WIDTH,
      padding: 4,
    });

    // NCHW float tensor, single grayscale channel, values in [0, 1].
    const tensor = new ort.Tensor("float32", Float32Array.from(data), [
      1,
      1,
      height,
      width,
    ]);

    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    const outputs = await session.run({ [inputName]: tensor });
    const logits = outputs[outputName];

    // Expected logits shape: [timesteps, 1, vocab] or [1, timesteps, vocab].
    const { text } = ctcGreedyDecode(
      logits.data as Float32Array,
      logits.dims as number[],
      this.charset,
    );

    return {
      text,
      alternatives: [text],
      engine: "htr",
    };
  }

  dispose() {
    this.session = null;
    this.sessionPromise = null;
  }
}
