import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { engineSearchPaths } from "../extension/src/ocrEngine";

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

/** The build, once: the `.vsix` carries the engine's tree, and that is 24 MB. */
let built: { buffer: Buffer; entries: ZipEntry[] } | null = null;

const buildOnce = () => {
  if (!built) {
    const outDir = mkdtempSync(join(tmpdir(), "excalidraw-bridge-"));
    const outPath = join(outDir, "excalidraw-bridge.vsix");
    const buffer = buildVsix(outPath);

    built = { buffer, entries: readZip(buffer) };
  }

  return built;
};

/** The build's own words, when it fails. */
const buildFailure = (args: string[]): string => {
  try {
    execFileSync(process.execPath, [buildScript, ...args], {
      cwd: packageRoot,
      stdio: "pipe",
    });
  } catch (error) {
    const failure = error as { stderr?: Buffer; message: string };

    return `${failure.stderr?.toString("utf8") ?? ""}\n${failure.message}`;
  }

  throw new Error("the build was supposed to fail, and it did not");
};

/**
 * A tree of the engine's packages with ONE of the core's files missing.
 *
 * It is the shape of a broken install: the packages are there, and one of the
 * files the engine loads at run time is not.
 */
const brokenEngineTree = (missing: string) => {
  const root = mkdtempSync(join(tmpdir(), "excalidraw-bridge-deps-"));
  const modules = join(root, "node_modules");

  const write = (path: string, content: string) => {
    const full = join(modules, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  };

  write(
    "tesseract.js/package.json",
    JSON.stringify({
      name: "tesseract.js",
      version: "7.0.0",
      main: "src/index.js",
      dependencies: { "tesseract.js-core": "^7.0.0" },
    }),
  );
  write("tesseract.js/src/index.js", "module.exports = {};\n");
  write("tesseract.js/src/createWorker.js", "module.exports = {};\n");
  write(
    "tesseract.js/src/worker-script/node/index.js",
    "module.exports = {};\n",
  );
  write(
    "tesseract.js/src/worker-script/node/getCore.js",
    "module.exports = {};\n",
  );
  write(
    "tesseract.js/src/worker/node/spawnWorker.js",
    "module.exports = {};\n",
  );

  write(
    "tesseract.js-core/package.json",
    JSON.stringify({ name: "tesseract.js-core", version: "7.0.0" }),
  );
  write("tesseract.js-core/index.js", "module.exports = {};\n");

  for (const core of [
    "tesseract-core.js",
    "tesseract-core.wasm",
    "tesseract-core-lstm.js",
    "tesseract-core-lstm.wasm",
    "tesseract-core-simd.js",
    "tesseract-core-simd.wasm",
    "tesseract-core-simd-lstm.js",
    "tesseract-core-simd-lstm.wasm",
    "tesseract-core-relaxedsimd.js",
    "tesseract-core-relaxedsimd.wasm",
    "tesseract-core-relaxedsimd-lstm.js",
    "tesseract-core-relaxedsimd-lstm.wasm",
  ]) {
    if (core === missing) {
      continue;
    }
    write(`tesseract.js-core/${core}`, "x");
  }

  return root;
};

/**
 * The build copies the engine's runtime tree - 24 MB of it, the wasm cores
 * among them - so it takes longer than vitest's five-second default. The
 * timeout is the build's, not the assertion's: the build is a real build.
 */
const BUILD_TIMEOUT_MS = 120_000;

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
    // and so does the OCR sidecar: the Python engines run in a process of
    // their own, and that process runs this (D-90)
    expect(names).toContain("extension/media/ocr_sidecar.py");

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
    // on the library
    expect(bundle).not.toContain("@excalidraw/element");
  }, BUILD_TIMEOUT_MS);

  it("AC-64 the manifest declares tesseract.js, and nothing else", () => {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "extension", "package.json"), "utf8"),
    );

    // the engine is a DECLARED dependency of the extension (D-89): the
    // teacher installs nothing to get OCR
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(["tesseract.js"]);
    expect(manifest.dependencies["tesseract.js"]).toBeTruthy();

    // and it is the ONLY one: a new dependency needs the owner's approval
    expect(Object.keys(manifest.dependencies ?? {}).length).toBe(1);
  });

  it("AC-121 the extension's manifest declares tesseract.js, and the built .vsix ships it with its wasm core", () => {
    const { entries } = buildOnce();
    const names = entries.map((entry) => entry.name);

    // the engine SHIPS, as FILES: it loads its worker and its core from
    // paths at run time, so bundling the extension's TypeScript is not enough
    // (D-89)
    expect(names).toContain("extension/node_modules/tesseract.js/package.json");
    expect(names).toContain("extension/node_modules/tesseract.js/src/index.js");
    expect(names).toContain(
      "extension/node_modules/tesseract.js/src/worker-script/node/index.js",
    );

    // and the core, with its wasm
    expect(names).toContain(
      "extension/node_modules/tesseract.js-core/package.json",
    );
    for (const core of [
      "tesseract-core.js",
      "tesseract-core.wasm",
      "tesseract-core-lstm.js",
      "tesseract-core-lstm.wasm",
      "tesseract-core-simd.js",
      "tesseract-core-simd.wasm",
      "tesseract-core-simd-lstm.js",
      "tesseract-core-simd-lstm.wasm",
      "tesseract-core-relaxedsimd.js",
      "tesseract-core-relaxedsimd.wasm",
      "tesseract-core-relaxedsimd-lstm.js",
      "tesseract-core-relaxedsimd-lstm.wasm",
    ]) {
      expect(names).toContain(
        `extension/node_modules/tesseract.js-core/${core}`,
      );
    }

    // the wasm files are not empty: a zero-byte core is a core that cannot
    // read
    const wasm = entries.find(
      (entry) =>
        entry.name ===
        "extension/node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm",
    );
    expect(wasm?.data.length).toBeGreaterThan(100000);

    // the rest of the tree travels too: the engine requires them at run time
    for (const dependency of [
      "bmp-js",
      "idb-keyval",
      "is-url",
      "node-fetch",
      "regenerator-runtime",
      "wasm-feature-detect",
      "zlibjs",
    ]) {
      expect(names).toContain(
        `extension/node_modules/${dependency}/package.json`,
      );
    }
  }, BUILD_TIMEOUT_MS);

  it("AC-121 the build fails loudly when a file the engine needs is missing", () => {
    // the tree is not there at all
    const empty = mkdtempSync(join(tmpdir(), "excalidraw-bridge-empty-"));
    const withoutTree = buildFailure([
      "--out",
      join(empty, "x.vsix"),
      "--deps",
      join(empty, "node_modules"),
    ]);

    expect(withoutTree).toContain("tesseract.js");
    expect(withoutTree).toMatch(/cannot read/);

    // and the tree is there, but one of the files the engine loads is not
    const broken = brokenEngineTree("tesseract-core-simd-lstm.wasm");
    const withoutFile = buildFailure([
      "--out",
      join(broken, "x.vsix"),
      "--deps",
      join(broken, "node_modules"),
    ]);

    expect(withoutFile).toContain(
      "tesseract.js-core/tesseract-core-simd-lstm.wasm",
    );
    expect(withoutFile).toMatch(/cannot read without it/);
  });

  it("AC-121 the declared copy is looked for before the run-time install", () => {
    const workspace = join("/some", "workspace");
    const paths = engineSearchPaths(workspace);

    // the DECLARED copy - the one inside the extension's own installed
    // folder - comes FIRST (D-89)
    expect(paths.length).toBe(2);
    expect(paths[0]).not.toContain(workspace);
    expect(paths[0]).toContain(join("extension", "src"));
    expect(paths[1]).toBe(join(workspace, "package.json"));
  });
});
