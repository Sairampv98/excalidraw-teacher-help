/**
 * AC-556 - the engines are served from the app itself: whole addresses on its
 * own origin, and no engine is named at a CDN.
 */

import fs from "node:fs";
import path from "node:path";

import { pyodideIndexUrl, workerSource } from "../bridge/pythonRunner";
import { ENGINE_FILES, engineUrl } from "../engines/enginePaths";

const read = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("AC-556 the engines are served from the app itself", () => {
  // the test environment names the folder the app is served from (a file address)
  const base = String(window.EXCALIDRAW_ASSET_PATH);

  it("AC-556 an engine address is a whole address, in the folder the app is served from", () => {
    expect(engineUrl(ENGINE_FILES.pdfjs.module)).toMatch(
      /\/vendor\/pdfjs\/pdf\.min\.mjs$/,
    );
    expect(engineUrl(ENGINE_FILES.tesseract.core)).toMatch(
      /\/vendor\/tesseract\/core\/$/,
    );
    expect(
      engineUrl(ENGINE_FILES.pdfjs.module).startsWith(base.slice(0, 7)),
    ).toBe(true);
    expect(engineUrl(ENGINE_FILES.pdfjs.module)).toMatch(/^[a-z]+:\/\//);
  });

  it("AC-556 Python's worker, built from text, is given a whole address", () => {
    expect(pyodideIndexUrl()).toMatch(/\/vendor\/pyodide\/$/);

    const source = workerSource(pyodideIndexUrl());

    expect(source).toContain(`${pyodideIndexUrl()}pyodide.js`);
    expect(source).not.toMatch(/https?:\/\/cdn\./);
  });

  it("AC-556 none of the three loaders names a CDN", () => {
    for (const file of [
      "sidebar/PdfViewer.tsx",
      "ocr/browserOcr.ts",
      "bridge/pythonRunner.ts",
    ]) {
      expect(read(file)).not.toMatch(/cdn\.jsdelivr|unpkg|cdnjs/);
    }
  });

  it("AC-556 the reader of pictures is told where its worker, core and language are", () => {
    const source = read("ocr/browserOcr.ts");

    for (const option of ["workerPath", "corePath", "langPath"]) {
      expect(source).toContain(option);
    }
  });
});
