import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { readZip, type ZipEntry } from "./helpers/zip";

/** The package root, found by walking up from the working directory. */
const findPackageRoot = (): string => {
  let current = process.cwd();
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, "packages", "vscode-bridge");
    if (existsSync(join(candidate, "scripts", "build-vsix.mjs"))) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error("the vscode-bridge package was not found");
};

const packageRoot = findPackageRoot();
const buildScript = join(packageRoot, "scripts", "build-vsix.mjs");

const buildVsix = (outPath: string) => {
  execFileSync(process.execPath, [buildScript, "--out", outPath], {
    cwd: packageRoot,
    stdio: "pipe",
  });
  return readFileSync(outPath);
};

describe("the .vsix", () => {
  it("AC-64 the .vsix builds and is a valid zip with extension/ at its root, [Content_Types].xml and extension.vsixmanifest", () => {
    const outDir = mkdtempSync(join(tmpdir(), "excalidraw-bridge-"));
    const outPath = join(outDir, "excalidraw-bridge.vsix");

    // the build really runs
    const buffer = buildVsix(outPath);
    expect(buffer.length).toBeGreaterThan(0);

    // and the file it wrote is a zip an independent reader can walk
    const entries = readZip(buffer);
    const names = entries.map((entry) => entry.name);
    const byName = (name: string): ZipEntry => {
      const entry = entries.find((candidate) => candidate.name === name);
      if (!entry) {
        throw new Error(`the vsix has no ${name}`);
      }
      return entry;
    };

    expect(names).toContain("[Content_Types].xml");
    expect(names).toContain("extension.vsixmanifest");
    expect(names).toContain("extension/package.json");
    expect(names).toContain("extension/out/extension.js");
    // the capture helper SHIPS with the extension: the panel's live view of
    // the editor's own window is drawn by it (D-82)
    expect(names).toContain("extension/media/capture.ps1");

    // everything that belongs to the extension is under extension/ at the root
    for (const name of names) {
      const whereItBelongs =
        name === "extension" ||
        name.startsWith("extension/") ||
        name === "[Content_Types].xml" ||
        name === "extension.vsixmanifest";
      expect({ name, whereItBelongs }).toEqual({ name, whereItBelongs: true });
    }

    // the entries are stored, not compressed - the method the build script
    // writes, and a method every unzip tool understands
    for (const entry of entries) {
      expect(entry.method).toBe(0);
    }

    const manifest = JSON.parse(
      byName("extension/package.json").data.toString("utf8"),
    );
    expect(manifest.name).toBe("excalidraw-bridge");
    expect(manifest.publisher).toBeTruthy();
    expect(manifest.engines.vscode).toBeTruthy();
    expect(manifest.main).toBe("./out/extension.js");
    expect(manifest.contributes.taskDefinitions[0].type).toBe(
      "excalidraw-bridge.run",
    );
    // the extension has no runtime dependency of its own
    expect(manifest.dependencies).toBeUndefined();

    // the vsix manifest names the same identity, and points at the manifest
    const vsix = byName("extension.vsixmanifest").data.toString("utf8");
    expect(vsix).toContain(`Id="${manifest.name}"`);
    expect(vsix).toContain(`Version="${manifest.version}"`);
    expect(vsix).toContain(`Publisher="${manifest.publisher}"`);
    expect(vsix).toContain('Path="extension/package.json"');
    expect(vsix).toContain(
      `Id="Microsoft.VisualStudio.Code.Engine" Value="${manifest.engines.vscode}"`,
    );

    // the content types cover what the payload holds
    const contentTypes = byName("[Content_Types].xml").data.toString("utf8");
    expect(contentTypes).toContain('Extension=".json"');
    expect(contentTypes).toContain('Extension=".js"');
    expect(contentTypes).toContain('Extension=".vsixmanifest"');

    // the bundle is the extension, and `vscode` stays external
    const bundle = byName("extension/out/extension.js").data.toString("utf8");
    expect(bundle).toMatch(/require\("vscode"\)/);
    // the app's type-only import is gone - the extension has no dependency
    expect(bundle).not.toContain("@excalidraw/element");
  });
});
