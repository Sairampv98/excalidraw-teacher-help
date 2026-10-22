/**
 * Where the OCR engines are allowed to live (D-89, D-59, AC-127).
 *
 * The engines belong to the **extension**: the app talks to the extension over
 * the bridge, and the browser never loads an OCR engine — a WASM OCR engine is
 * a multi-megabyte download, and a classroom connection is slow.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The repository root, found by walking up from the working directory. */
const findRepoRoot = (): string => {
  let current = process.cwd();
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, "excalidraw-app", "App.tsx");
    if (existsSync(candidate)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error("the repository root was not found");
};

const repoRoot = findRepoRoot();

const read = (relative: string) =>
  readFileSync(join(repoRoot, relative), "utf8");

/** The engines, and the modules they are made of. */
const ENGINE_MODULES = ["tesseract.js", "indra_ocr", "paddleocr", "paddle"];

describe("where the OCR engines live", () => {
  it("AC-127 neither the library nor the app gains a dependency", () => {
    // neither the library nor the app declares an engine: the engine is the
    // extension's, and the app reaches it over the bridge (D-89)
    for (const shipped of [
      "packages/excalidraw/package.json",
      "excalidraw-app/package.json",
    ]) {
      const manifest = JSON.parse(read(shipped));
      const declared = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ];

      for (const engine of ENGINE_MODULES) {
        expect(declared).not.toContain(engine);
      }
    }

    // the EXTENSION declares one, and it is tesseract.js: the engine ships
    // inside the .vsix, so the teacher installs nothing (D-89)
    const extension = JSON.parse(
      read("packages/vscode-bridge/extension/package.json"),
    );

    expect(Object.keys(extension.dependencies ?? {})).toEqual(["tesseract.js"]);

    // and the ROOT package carries it as the build-time source the .vsix is
    // built from - not as a dependency of the product
    const root = JSON.parse(read("package.json"));

    expect(Object.keys(root.dependencies ?? {})).not.toContain("tesseract.js");
    expect(Object.keys(root.devDependencies ?? {})).toContain("tesseract.js");
  });

  it("AC-127 the browser's half of the conversation never imports an engine", () => {
    // the browser's half: the app, the library, and the bridge's own half
    // that the app talks to. None of them may import an engine - a mention in
    // a comment is not an import, but an import is an import.
    const engineImport =
      /(\bfrom\s*|\brequire\(\s*|\bimport\(\s*)["']([^"']+)["']/g;

    const browserHalf = [
      "packages/vscode-bridge/bridge/src/ocr.ts",
      "packages/vscode-bridge/bridge/src/ocrClient.ts",
      "packages/vscode-bridge/bridge/src/protocol.ts",
      "excalidraw-app/bridge/useOcr.ts",
      "excalidraw-app/bridge/ocrPlacement.ts",
      "excalidraw-app/bridge/bridgeSession.ts",
    ];

    for (const file of browserHalf) {
      const source = read(file);
      const imported = [...source.matchAll(engineImport)].map(
        (match) => match[2],
      );

      for (const module of imported) {
        expect(ENGINE_MODULES).not.toContain(module);
      }
    }
  });
});
