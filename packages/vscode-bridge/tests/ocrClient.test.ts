/**
 * The bridge's half of the **OCR capability**, and the promise the app makes
 * about it.
 *
 * AC-74: with NO bridge, the OCR option says the bridge is needed — it does
 *        not fail silently, and no OCR engine is bundled in the browser.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createOcrClient, OCR_NEEDS_BRIDGE } from "../bridge/src/ocrClient";
import { parseBridgeMessage } from "../bridge/src/protocol";

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

describe("the OCR capability without a bridge", () => {
  it("AC-74 with no bridge the OCR request fails with the sentence that says the bridge is needed", async () => {
    // no bridge: the client cannot send anything
    const client = createOcrClient({ send: () => false });

    await expect(client.recognize({ imageBase64: "SU1BR0U=" })).rejects.toThrow(
      OCR_NEEDS_BRIDGE,
    );

    // and the sentence says what is missing, in words a teacher can act on
    expect(OCR_NEEDS_BRIDGE).toContain("bridge");
    expect(OCR_NEEDS_BRIDGE.trim().length).toBeGreaterThan(0);
  });

  it("AC-74 the answer settles the request that asked for it", async () => {
    const sent: unknown[] = [];

    const client = createOcrClient({
      send: (message) => {
        sent.push(message);
        return true;
      },
    });

    const pending = client.recognize({
      imageBase64: "SU1BR0U=",
      region: { x: 0, y: 900, width: 1920, height: 180 },
    });

    // the request carries the region — the crop is the one lever that costs
    // nothing and buys the most
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "ocr:request",
      region: { x: 0, y: 900, width: 1920, height: 180 },
    });

    const id = (sent[0] as { id: string }).id;

    client.settle({
      id,
      text: "the text",
      lines: [{ text: "the text", x: 1, y: 2, width: 3, height: 4 }],
    });

    await expect(pending).resolves.toMatchObject({
      id,
      text: "the text",
      lines: [{ text: "the text", x: 1, y: 2, width: 3, height: 4 }],
    });
  });

  it("AC-74 no OCR engine is bundled in the browser", () => {
    // the engine is `tesseract.js`, and it lives in the bridge's **Node**
    // process. The browser's half of the conversation must not import it —
    // a mention in a comment is not an import.
    const engineImport =
      /(\bfrom\s*|\brequire\(\s*|\bimport\(\s*)["']tesseract\.js["']/;

    const browserHalf = [
      "packages/vscode-bridge/bridge/src/ocrClient.ts",
      "packages/vscode-bridge/bridge/src/ocr.ts",
      "excalidraw-app/bridge/useOcr.ts",
      "excalidraw-app/bridge/ocrPlacement.ts",
    ];

    for (const file of browserHalf) {
      expect(read(file)).not.toMatch(engineImport);
    }

    // and no package the browser ships declares it: neither the app nor the
    // library gains a dependency (D-59, AC-127)
    const appPackage = JSON.parse(read("excalidraw-app/package.json"));
    const libraryPackage = JSON.parse(read("packages/excalidraw/package.json"));

    for (const shipped of [appPackage, libraryPackage]) {
      expect(Object.keys(shipped.dependencies ?? {})).not.toContain(
        "tesseract.js",
      );
      expect(Object.keys(shipped.devDependencies ?? {})).not.toContain(
        "tesseract.js",
      );
    }

    // The ROOT package carries the engine as the build-time source the .vsix
    // is built from (D-89). It is a dependency of the BUILD, not of the
    // product, and it is not in the browser's half.
    const rootPackage = JSON.parse(read("package.json"));

    expect(Object.keys(rootPackage.dependencies ?? {})).not.toContain(
      "tesseract.js",
    );
    expect(Object.keys(rootPackage.devDependencies ?? {})).toContain(
      "tesseract.js",
    );

    // and the EXTENSION declares it: the declared dependency that ships
    // inside the .vsix, so the teacher installs nothing (D-89)
    const extensionPackage = JSON.parse(
      read("packages/vscode-bridge/extension/package.json"),
    );

    expect(Object.keys(extensionPackage.dependencies ?? {})).toEqual([
      "tesseract.js",
    ]);
  });

  it("AC-125 the result carries the engine that ran and how long it took", async () => {
    const sent: unknown[] = [];

    const client = createOcrClient({
      send: (message) => {
        sent.push(message);
        return true;
      },
    });

    const pending = client.recognize({ imageBase64: "SU1BR0U=" });

    const id = (sent[0] as { id: string }).id;

    client.settle({
      id,
      text: "the text",
      lines: [{ text: "the text", x: 1, y: 2, width: 3, height: 4 }],
      // the engine that ran, and the time it took (D-90)
      engine: "indra",
      durationMs: 228,
    });

    await expect(pending).resolves.toMatchObject({
      engine: "indra",
      durationMs: 228,
    });
  });

  it("AC-125 the request may name an engine, and the runtime guard accepts it", async () => {
    const sent: unknown[] = [];

    const client = createOcrClient({
      send: (message) => {
        sent.push(message);
        return true;
      },
    });

    void client.recognize({ imageBase64: "SU1BR0U=", engine: "paddle" });

    // the request carries the engine the caller asked for
    expect(sent[0]).toMatchObject({ type: "ocr:request", engine: "paddle" });

    // and the runtime guard understands both directions: a request that names
    // an engine, and an answer that says which engine ran (D-90, D-50)
    expect(
      parseBridgeMessage(
        JSON.stringify({
          v: 1,
          type: "ocr:request",
          id: "ocr-1",
          imageBase64: "QUJD",
          engine: "indra",
        }),
      ),
    ).toMatchObject({ type: "ocr:request", engine: "indra" });

    expect(
      parseBridgeMessage(
        JSON.stringify({
          v: 1,
          type: "ocr:result",
          id: "ocr-1",
          text: "hello",
          engine: "indra",
          durationMs: 228,
        }),
      ),
    ).toMatchObject({ type: "ocr:result", engine: "indra", durationMs: 228 });

    // and an engine that is not one of the three is refused
    expect(
      parseBridgeMessage(
        JSON.stringify({
          v: 1,
          type: "ocr:request",
          id: "ocr-1",
          imageBase64: "QUJD",
          engine: "nonsense",
        }),
      ),
    ).toBeNull();
  });
});
