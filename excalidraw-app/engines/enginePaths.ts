/**
 * Where the engines are served from (D-460).
 *
 * The PDF reader, the reader of words in a picture and Python for the browser
 * editor are big programs. The app carries them, in `vendor/` beside its own
 * files, so they work in a classroom with no internet. The address is a whole
 * address (with the origin) because Python runs in a worker made from text,
 * and such a worker cannot make sense of a relative one.
 */

const root = (): string => {
  const path =
    typeof window !== "undefined" &&
    typeof window.EXCALIDRAW_ASSET_PATH === "string"
      ? window.EXCALIDRAW_ASSET_PATH
      : "/";

  return new URL(path, window.location.href).href;
};

/** the whole address of a file (or a folder: end it with a slash) of the engines */
export const engineUrl = (path: string): string =>
  new URL(`vendor/${path}`, root()).href;

/** the files of each engine, in one place */
export const ENGINE_FILES = {
  pdfjs: { module: "pdfjs/pdf.min.mjs", worker: "pdfjs/pdf.worker.min.mjs" },
  tesseract: {
    script: "tesseract/tesseract.min.js",
    worker: "tesseract/worker.min.js",
    core: "tesseract/core/",
    languages: "tesseract/lang/",
  },
  pyodide: { folder: "pyodide/", script: "pyodide/pyodide.js" },
} as const;
