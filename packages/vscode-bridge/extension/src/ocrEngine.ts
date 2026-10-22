import { createRequire } from "node:module";
import { join } from "node:path";

import {
  DEFAULT_OCR_ENGINE,
  isOcrEngineName,
  ocrRectangle,
} from "../../bridge/src/ocr";

import type {
  OcrEngine,
  OcrEngineName,
  OcrLine,
  OcrRequest,
} from "../../bridge/src/ocr";

/**
 * The **OCR engine** of the bridge: `tesseract.js`, in the extension's Node
 * process (D-59).
 *
 * ## The engine is a DECLARED dependency (D-89)
 *
 * `tesseract.js` is declared in the extension's own manifest and it **ships
 * inside the `.vsix`**, as files: the engine loads its worker and its core
 * from paths at run time, so bundling the extension's TypeScript is not
 * enough. The teacher installs nothing to get OCR.
 *
 * A teacher who put `tesseract.js` in the project they teach from still gets
 * OCR: that run-time install is the **fallback**, and the **declared copy
 * wins** (D-89).
 *
 * The engine is never in the browser: a WASM OCR engine is a multi-megabyte
 * download, and a classroom connection is slow (D-59). The app's package
 * gains no dependency at all (AC-127).
 *
 * ## The engine's rules
 *
 * - the **worker is created once** and survives every read: a worker per read
 *   would pay for the start-up every time;
 * - the **language data is not uncached** (no `cachePath: ""`), so a read does
 *   not pay for the download again;
 * - the **core is not pinned** to a single `.js` file (no `corePath`), so the
 *   loader can choose between the standard, the SIMD and the LSTM cores — and
 *   the SIMD core is the one it picks where the CPU has one.
 */

/** the module id of the engine */
export const OCR_ENGINE_MODULE_ID = "tesseract.js";

/**
 * The sentence the bridge sends when the engine is not there.
 *
 * It names the thing that is missing, because a teacher who cannot read the
 * reason cannot fix it (D-91).
 */
export const OCR_ENGINE_MISSING =
  "the OCR engine (tesseract.js) is not where the bridge can reach it — the extension ships its own copy, so this .vsix is broken; reinstall the extension";

/**
 * The engine the setting names.
 *
 * The setting is `excalidraw-bridge.ocrEngine` (D-90): `tesseract`, `indra`
 * or `paddle`. A value that is not one of them falls back to the default
 * rather than to a broken engine.
 */
export const resolveOcrEngine = (configured?: string): OcrEngineName => {
  const name = (configured ?? "").trim().toLowerCase();

  return isOcrEngineName(name) ? name : DEFAULT_OCR_ENGINE;
};

type TesseractBox = { x0: number; y0: number; x1: number; y1: number };

type TesseractLine = { text?: string; bbox?: TesseractBox };

type TesseractBlock = {
  paragraphs?: { lines?: TesseractLine[] }[];
};

type TesseractData = {
  text?: string;
  confidence?: number;
  lines?: TesseractLine[];
  blocks?: TesseractBlock[];
};

type TesseractWorker = {
  recognize: (
    image: Buffer,
    options?: unknown,
    output?: unknown,
  ) => Promise<{ data: TesseractData }>;
  terminate?: () => Promise<unknown>;
};

type TesseractModule = {
  createWorker: (
    language: string,
    oem?: number,
    options?: unknown,
  ) => Promise<TesseractWorker>;
};

/**
 * Where the engine is looked for.
 *
 * The extension's **own** folder comes **first**: that is the declared copy
 * that ships inside the `.vsix` (D-89). Then the **workspace** — a teacher
 * who installs the engine in the project they teach from gets it — and then
 * the places Node itself looks.
 */
export const engineSearchPaths = (workspaceRoot?: string): string[] => {
  const paths: string[] = [];

  // the DECLARED copy: the one inside the extension's own installed folder
  paths.push(join(__dirname, "package.json"));

  if (workspaceRoot) {
    paths.push(join(workspaceRoot, "package.json"));
  }

  return paths;
};

/**
 * Where the engine is, when the bridge can reach it.
 *
 * It only **resolves** the module - it does not load it - so the check costs
 * nothing: the engine itself is loaded on the first read, and its worker is
 * created once and kept (D-89).
 */
export const resolveTesseract = (
  searchPaths: readonly string[] = engineSearchPaths(),
): { require: NodeRequire; path: string } => {
  const errors: string[] = [];

  for (const path of searchPaths) {
    try {
      const requireFrom = createRequire(path);
      const resolved = requireFrom.resolve(OCR_ENGINE_MODULE_ID);

      return { require: requireFrom, path: resolved };
    } catch (error) {
      errors.push(`${path}: ${(error as Error).message}`);
    }
  }

  throw new Error(`${OCR_ENGINE_MISSING} (${errors.join("; ")})`);
};

/**
 * Loads the engine module, or throws with the sentence that says why not.
 */
export const loadTesseract = (
  searchPaths: readonly string[] = engineSearchPaths(),
): TesseractModule => {
  const { require: requireFrom, path: resolved } =
    resolveTesseract(searchPaths);

  // the module is required by its resolved path, so it is **not** bundled
  // into the extension: it travels with the extension as files, and the
  // loader picks the copy it finds (D-89)
  return requireFrom(resolved) as TesseractModule;
};

/**
 * Whether the engine is where the bridge can reach it.
 *
 * It resolves the module and stops there: nothing is loaded, and no worker is
 * created, so the answer is cheap (D-89).
 */
export const canLoadTesseract = (
  searchPaths: readonly string[] = engineSearchPaths(),
): boolean => {
  try {
    resolveTesseract(searchPaths);
    return true;
  } catch {
    return false;
  }
};

/**
 * The box of a line, in the engine's own shape.
 */
const lineBox = (
  line: TesseractLine,
): { x: number; y: number; width: number; height: number } | null => {
  const bbox = line.bbox;

  if (!bbox) {
    return null;
  }

  return {
    x: bbox.x0,
    y: bbox.y0,
    width: bbox.x1 - bbox.x0,
    height: bbox.y1 - bbox.y0,
  };
};

/**
 * The lines of a read.
 *
 * The engine's own shape changed once (the flat `lines` became the blocks and
 * paragraphs), so both are read: the answer is the same either way.
 */
export const extractOcrLines = (data: TesseractData): OcrLine[] => {
  const lines: OcrLine[] = [];

  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const box = lineBox(line);
        const text = (line.text ?? "").trim();

        if (box && text) {
          lines.push({ text, ...box });
        }
      }
    }
  }

  if (!lines.length) {
    for (const line of data.lines ?? []) {
      const box = lineBox(line);
      const text = (line.text ?? "").trim();

      if (box && text) {
        lines.push({ text, ...box });
      }
    }
  }

  return lines;
};

/**
 * The engine, with its worker already created.
 *
 * The worker is created **once**, here, and it survives every read.
 */
export const createTesseractEngine = async ({
  language = "eng",
  searchPaths,
}: {
  language?: string;
  searchPaths?: readonly string[];
} = {}): Promise<OcrEngine> => {
  const tesseract = loadTesseract(searchPaths);

  // ONE worker, reused for every read — and no `cachePath: ""`, so the
  // language data is cached, and no `corePath`, so the loader can pick the
  // SIMD core
  const worker = await tesseract.createWorker(language);

  return {
    recognize: async (request: OcrRequest) => {
      const rectangle = ocrRectangle(request.region);
      const startedAt = Date.now();

      const { data } = await worker.recognize(
        Buffer.from(request.imageBase64, "base64"),
        rectangle ? { rectangle } : {},
        { blocks: true, text: true },
      );

      return {
        text: data.text ?? "",
        // the engine's boxes are in the WHOLE image's pixels, even when it
        // read a rectangle of it — so the text goes back where it was
        lines: extractOcrLines(data),
        ...(data.confidence === undefined
          ? {}
          : { confidence: data.confidence }),
        // which engine ran, and how long it took (D-90)
        engine: "tesseract",
        durationMs: Date.now() - startedAt,
      };
    },
  };
};
