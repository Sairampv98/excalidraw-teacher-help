import { createOcrService, isOcrEngineName } from "../../bridge/src/ocr";

import {
  canLoadTesseract,
  createTesseractEngine,
  engineSearchPaths,
} from "./ocrEngine";
import { createOcrSidecar, sidecarScriptPath } from "./ocrSidecar";

import type {
  OcrEngine,
  OcrEngineName,
  OcrEngineResult,
  OcrEngineState,
  OcrRequest,
} from "../../bridge/src/ocr";
import type { OcrSidecar } from "./ocrSidecar";

/**
 * The **engine registry** of the extension: which engine reads, and what the
 * panel is told about it (D-90, D-91).
 *
 * There are three engines and they are not alike:
 *
 * - `tesseract` runs **here**, in the extension's Node process. It is the
 *   declared dependency that ships inside the `.vsix` (D-89).
 * - `indra` and `paddle` are **Python**, so they run in a **sidecar**: one
 *   process, spawned once, that the extension talks to over stdio (D-90).
 *
 * A missing engine is a **state**, never a silence: the state carries the
 * reason, and the reason names the command that fixes it (D-91).
 */

/**
 * The sidecar of this extension.
 *
 * There is **one**: a sidecar per read would pay for the interpreter's
 * start-up, and for the model's load, every single time (D-90).
 */
let sidecar: OcrSidecar | null = null;

/**
 * The `tesseract` engine, with its worker already created.
 *
 * It is created **once** and kept: a worker per read would pay for the
 * start-up every time (D-59).
 */
let tesseractEngine: OcrEngine | null = null;

/** The sidecar of this extension, created when it is first needed. */
export const ocrSidecar = (options: {
  pythonPath: string;
  extensionDir: string;
}): OcrSidecar => {
  if (!sidecar) {
    sidecar = createOcrSidecar({
      pythonPath: options.pythonPath,
      scriptPath: sidecarScriptPath(options.extensionDir),
    });
  }
  return sidecar;
};

/** Stops the sidecar, when the extension goes away. */
export const stopOcrSidecar = () => {
  sidecar?.stop();
  sidecar = null;
  tesseractEngine = null;
};

/**
 * The state of an engine: is it there, and if it is not, why not.
 *
 * For `tesseract` it is a **resolution** - the module has to be where the
 * bridge can reach it, and nothing is loaded to find out (D-89). For the
 * Python engines it is the sidecar's **report**: the sidecar says which
 * engines it can reach, and it says it without importing them (D-90).
 */
export const resolveEngineState = async ({
  engine,
  sidecar: theSidecar,
  searchPaths,
}: {
  engine: OcrEngineName;
  sidecar?: OcrSidecar | null;
  searchPaths?: readonly string[];
}): Promise<OcrEngineState> => {
  if (engine === "tesseract") {
    if (canLoadTesseract(searchPaths ?? engineSearchPaths())) {
      return { state: "ready", engine };
    }
    return {
      state: "unavailable",
      engine,
      reason:
        "tesseract.js is not where the bridge can reach it — the extension ships its own copy, so this install is broken; reinstall the extension",
    };
  }

  if (!theSidecar) {
    return {
      state: "unavailable",
      engine,
      reason: `the OCR sidecar is not available, so ${engine} cannot be used`,
    };
  }

  let report;

  try {
    report = await theSidecar.start();
  } catch (error) {
    return {
      state: "unavailable",
      engine,
      reason: (error as Error).message,
    };
  }

  const entry = report.engines[engine];

  if (entry?.available) {
    return { state: "ready", engine };
  }

  return {
    state: "unavailable",
    engine,
    reason:
      entry?.reason ??
      `the OCR sidecar (Python ${report.python}) cannot reach ${engine}`,
  };
};

/**
 * Reads the text out of an image, with the engine that was asked for.
 *
 * The answer carries the **engine** and the **time**: the panel shows both,
 * so a teacher can tell a fast engine from a slow one (D-90).
 */
export const readWithEngine = async ({
  engine,
  request,
  sidecar: theSidecar,
  searchPaths,
}: {
  engine: OcrEngineName;
  request: OcrRequest;
  sidecar?: OcrSidecar | null;
  searchPaths?: readonly string[];
}): Promise<OcrEngineResult> => {
  if (engine === "tesseract") {
    if (!tesseractEngine) {
      tesseractEngine = await createTesseractEngine({
        searchPaths: searchPaths ?? engineSearchPaths(),
      });
    }

    const service = createOcrService(tesseractEngine);
    const result = await service.recognize(request);

    return {
      text: result.text,
      lines: result.lines,
      ...(result.confidence === undefined
        ? {}
        : { confidence: result.confidence }),
      engine: "tesseract",
      ...(result.durationMs === undefined
        ? {}
        : { durationMs: result.durationMs }),
    };
  }

  if (!theSidecar) {
    throw new Error(
      `the OCR sidecar is not available, so ${engine} cannot be used`,
    );
  }

  const answer = await theSidecar.recognize({
    engine,
    imageBase64: request.imageBase64,
    ...(request.region ? { region: request.region } : {}),
  });

  return {
    text: answer.text,
    lines: answer.lines,
    ...(answer.confidence === undefined
      ? {}
      : { confidence: answer.confidence }),
    engine,
    ...(answer.durationMs === undefined
      ? {}
      : { durationMs: answer.durationMs }),
  };
};

/**
 * The engine a request asks for.
 *
 * The request may name one; when it does not, the extension's own setting
 * decides (D-90).
 */
export const engineForRequest = (
  requested: unknown,
  configured: OcrEngineName,
): OcrEngineName => (isOcrEngineName(requested) ? requested : configured);
