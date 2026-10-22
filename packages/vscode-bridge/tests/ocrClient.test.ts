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

    // and no package the browser ships declares it
    const appPackage = JSON.parse(read("excalidraw-app/package.json"));
    const rootPackage = JSON.parse(read("package.json"));

    expect(Object.keys(appPackage.dependencies ?? {})).not.toContain(
      "tesseract.js",
    );
    expect(Object.keys(appPackage.devDependencies ?? {})).not.toContain(
      "tesseract.js",
    );
    expect(Object.keys(rootPackage.dependencies ?? {})).not.toContain(
      "tesseract.js",
    );
    expect(Object.keys(rootPackage.devDependencies ?? {})).not.toContain(
      "tesseract.js",
    );

    // the extension has no runtime dependency of its own either (AC-64): the
    // engine is loaded at RUN time, from wherever it is installed
    const extensionPackage = JSON.parse(
      read("packages/vscode-bridge/extension/package.json"),
    );

    expect(extensionPackage.dependencies).toBeUndefined();
  });
});
