/**
 * OCR in the browser (D-288).
 *
 * With no bridge there was no engine that could read a picture. This one is
 * tesseract.js, fetched the first time a read is asked for, from a pinned
 * version: it is not an npm dependency, and a teacher who never reads a picture
 * never pays for it - the same way as the in-browser Python runtime (D-268).
 * The first read downloads the engine and the English language data (some
 * megabytes, once); the browser keeps them for the next.
 *
 * What it says while it works is `OcrProgress`: what it is doing and how far it
 * is, so a read that takes a while is never a button that seems to do nothing.
 */

import { ENGINE_FILES, engineUrl } from "../engines/enginePaths";

import type {
  OcrLine,
  OcrRegion,
  OcrResult,
} from "../../packages/vscode-bridge/bridge/src/ocr";

export const TESSERACT_VERSION = "5.1.1";

/** the reader is carried by the app (D-460), so it works with no internet */
const tesseractUrl = () => engineUrl(ENGINE_FILES.tesseract.script);

/** what a read is doing, and how far it is (`null`: it cannot tell) */
export type OcrProgress = { label: string; fraction: number | null };

type TesseractLogger = (message: { status: string; progress: number }) => void;

type TesseractWorker = {
  recognize: (image: string) => Promise<{
    data: {
      text: string;
      confidence?: number;
      lines: Array<{
        text: string;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
    };
  }>;
  terminate: () => Promise<unknown>;
};

export type TesseractApi = {
  createWorker: (
    language: string,
    engineMode?: number,
    options?: {
      logger?: TesseractLogger;
      workerPath?: string;
      corePath?: string;
      langPath?: string;
    },
  ) => Promise<TesseractWorker>;
};

let loading: Promise<TesseractApi> | null = null;

/** fetches tesseract.js once; a failed fetch is tried again the next time */
export const loadTesseract = (): Promise<TesseractApi> => {
  const existing = (window as unknown as { Tesseract?: TesseractApi })
    .Tesseract;

  if (existing) {
    return Promise.resolve(existing);
  }

  loading ??= new Promise<TesseractApi>((resolve, reject) => {
    const script = document.createElement("script");

    script.src = tesseractUrl();
    script.async = true;
    script.onload = () => {
      const api = (window as unknown as { Tesseract?: TesseractApi }).Tesseract;

      if (api) {
        resolve(api);
      } else {
        reject(new Error("the OCR engine did not start"));
      }
    };
    script.onerror = () => {
      loading = null;
      reject(
        new Error(
          "the OCR engine could not be loaded: it is missing from the app",
        ),
      );
    };
    document.head.append(script);
  });

  return loading;
};

/** the words a progress report of tesseract.js is shown as */
const LABELS: Record<string, string> = {
  "loading tesseract core": "Loading the reader",
  "initializing tesseract": "Starting the reader",
  "loading language traineddata": "Loading the language (the first read only)",
  "initializing api": "Starting the reader",
  "recognizing text": "Reading the text",
};

/** cuts a region out of a picture, as a new picture */
const cropPicture = (dataURL: string, region: OcrRegion) =>
  new Promise<string>((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement("canvas");

      canvas.width = Math.max(1, Math.round(region.width));
      canvas.height = Math.max(1, Math.round(region.height));
      canvas
        .getContext("2d")
        ?.drawImage(
          image,
          region.x,
          region.y,
          region.width,
          region.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("the picture could not be read"));
    image.src = dataURL;
  });

/**
 * The engine of the page: one worker, kept between reads so the language data
 * is loaded once.
 */
export const createBrowserOcr = ({
  load = loadTesseract,
  crop = cropPicture,
}: {
  load?: () => Promise<TesseractApi>;
  crop?: (dataURL: string, region: OcrRegion) => Promise<string>;
} = {}) => {
  let worker: Promise<TesseractWorker> | null = null;
  let report: (progress: OcrProgress) => void = () => {};

  const start = async () => {
    report({
      label: "Downloading the reader (the first read only)",
      fraction: null,
    });

    const tesseract = await load();

    return tesseract.createWorker("eng", 1, {
      workerPath: engineUrl(ENGINE_FILES.tesseract.worker),
      corePath: engineUrl(ENGINE_FILES.tesseract.core),
      langPath: engineUrl(ENGINE_FILES.tesseract.languages),
      logger: ({ status, progress }) =>
        report({
          label: LABELS[status] ?? "Working",
          fraction: Number.isFinite(progress) ? progress : null,
        }),
    });
  };

  const read = async (
    dataURL: string,
    {
      region,
      onProgress,
    }: {
      region?: OcrRegion;
      onProgress?: (progress: OcrProgress) => void;
    } = {},
  ): Promise<OcrResult> => {
    const began = Date.now();

    report = onProgress ?? (() => {});

    try {
      worker ??= start().catch((error) => {
        worker = null;
        throw error;
      });

      const engine = await worker;
      const source = region ? await crop(dataURL, region) : dataURL;
      const { data } = await engine.recognize(source);

      const lines: OcrLine[] = data.lines
        .filter((line) => line.text.trim().length > 0)
        .map((line) => ({
          text: line.text.replace(/\s+$/, ""),
          x: line.bbox.x0 + (region?.x ?? 0),
          y: line.bbox.y0 + (region?.y ?? 0),
          width: line.bbox.x1 - line.bbox.x0,
          height: line.bbox.y1 - line.bbox.y0,
        }));

      return {
        id: `browser-ocr-${began}`,
        text: data.text,
        lines,
        confidence: data.confidence,
        engine: "tesseract",
        durationMs: Date.now() - began,
      };
    } finally {
      report = () => {};
    }
  };

  /** ends the worker: its memory is the browser's again */
  const stop = async () => {
    const current = worker;

    worker = null;
    await (await current)?.terminate();
  };

  return { read, stop };
};

/** the one engine of the page */
export const browserOcr = createBrowserOcr();
