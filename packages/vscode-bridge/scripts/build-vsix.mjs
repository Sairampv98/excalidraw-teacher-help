#!/usr/bin/env node
/**
 * Build the `.vsix`.
 *
 * A `.vsix` is a zip: the `extension/` folder at the root, plus
 * `[Content_Types].xml` and `extension.vsixmanifest`. This script writes that
 * zip ITSELF - the STORE method (no compression) is a few dozen lines and
 * works on every platform - so the extension needs no packaging dependency,
 * and neither does the repository.
 *
 * The extension's TypeScript is bundled with esbuild, which the repository
 * already has. `vscode` is external: the editor provides it at run time.
 *
 *   node packages/vscode-bridge/scripts/build-vsix.mjs [--out <file.vsix>]
 */
import { build } from "esbuild";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const extensionDir = join(packageRoot, "extension");
const stageDir = join(packageRoot, "build", "vsix");
const manifest = JSON.parse(
  readFileSync(join(extensionDir, "package.json"), "utf8"),
);

// ---------------------------------------------------------------------------
// the zip writer (STORE, no compression)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = -1;
  for (let index = 0; index < buffer.length; index++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
};

const dosTimestamp = (date) => {
  const time =
    ((date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1)) &
    0xffff;
  const day =
    (((date.getFullYear() - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate()) &
    0xffff;
  return { time, day };
};

/**
 * @param {{name: string, data: Buffer}[]} entries
 * @returns {Buffer}
 */
const writeZip = (entries) => {
  const { time, day } = dosTimestamp(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: the name is utf-8
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0014, 4); // made by: MS-DOS, zip 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
};

// ---------------------------------------------------------------------------
// the engine's runtime tree (D-89)
// ---------------------------------------------------------------------------

/**
 * The package whose runtime tree the `.vsix` carries.
 *
 * `tesseract.js` loads its worker and its core from PATHS at run time, so
 * bundling the extension's TypeScript with esbuild is **not enough**: the
 * files have to travel with the extension.
 */
const ENGINE_PACKAGE = "tesseract.js";

/**
 * What each package of the tree contributes.
 *
 * `include` is the list of things to take (null means the whole package), and
 * `exclude` is the list of file names to leave out. The core's `.wasm.js`
 * files are the single-file builds of the wasm, and the loader never asks for
 * them, so they would be 24 MB of nothing.
 */
const PACKAGE_CONTENTS = {
  "tesseract.js": {
    include: ["package.json", "LICENSE.md", "src"],
    exclude: [],
  },
  "tesseract.js-core": {
    include: null,
    exclude: ["*.wasm.js", "README.md"],
  },
};

/**
 * What no package of the tree needs: the tests, the manual, the editor's
 * droppings.
 */
const DEFAULT_EXCLUDES = [
  "test",
  "tests",
  "docs",
  "examples",
  "coverage",
  "*.iml",
  ".npmignore",
  ".DS_Store",
];

/**
 * The files the engine needs, whatever else is copied.
 *
 * The build FAILS when one of them is missing: a `.vsix` that installs but
 * cannot read is worse than one that does not install (D-89).
 */
const REQUIRED_ENGINE_FILES = [
  "tesseract.js/package.json",
  "tesseract.js/src/index.js",
  "tesseract.js/src/createWorker.js",
  "tesseract.js/src/worker-script/node/index.js",
  "tesseract.js/src/worker-script/node/getCore.js",
  "tesseract.js/src/worker/node/spawnWorker.js",
  "tesseract.js-core/package.json",
  "tesseract.js-core/index.js",
  "tesseract.js-core/tesseract-core.js",
  "tesseract.js-core/tesseract-core.wasm",
  "tesseract.js-core/tesseract-core-lstm.js",
  "tesseract.js-core/tesseract-core-lstm.wasm",
  "tesseract.js-core/tesseract-core-simd.js",
  "tesseract.js-core/tesseract-core-simd.wasm",
  "tesseract.js-core/tesseract-core-simd-lstm.js",
  "tesseract.js-core/tesseract-core-simd-lstm.wasm",
  "tesseract.js-core/tesseract-core-relaxedsimd.js",
  "tesseract.js-core/tesseract-core-relaxedsimd.wasm",
  "tesseract.js-core/tesseract-core-relaxedsimd-lstm.js",
  "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm",
];

/** The node_modules directory the engine's tree is taken from. */
const depsFlagIndex = process.argv.indexOf("--deps");
const depsRoot =
  depsFlagIndex !== -1 && process.argv[depsFlagIndex + 1]
    ? resolve(process.argv[depsFlagIndex + 1])
    : join(resolve(packageRoot, "..", ".."), "node_modules");

/**
 * Where a package is, when Node would find it there.
 *
 * It is Node's own algorithm: the package's own `node_modules` first, then the
 * one above it, and so on.
 */
const resolvePackageDir = (name, fromDir) => {
  let dir = fromDir;

  for (;;) {
    const candidate = join(dir, "node_modules", name);

    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }

    const parent = dirname(dir);

    if (parent === dir) {
      return null;
    }

    dir = parent;
  }
};

/**
 * The engine's runtime tree: every package it needs at run time.
 *
 * It is walked the way Node walks it, so the tree that ships is the tree the
 * engine would have found on this machine.
 */
const collectEngineTree = () => {
  const packages = new Map();

  const visit = (dir) => {
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    );
    const existing = packages.get(manifest.name);

    if (existing) {
      if (existing.version !== manifest.version) {
        throw new Error(
          `the engine's runtime tree needs two versions of ${manifest.name} (${existing.version} and ${manifest.version}); the .vsix carries one`,
        );
      }
      return;
    }

    packages.set(manifest.name, { dir, version: manifest.version });

    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      const dependencyDir = resolvePackageDir(dependency, dir);

      if (!dependencyDir) {
        throw new Error(
          `the engine's runtime tree is incomplete: ${dependency} is not installed next to ${manifest.name} (looked in ${dir}) - the .vsix would ship an extension that cannot read`,
        );
      }

      visit(dependencyDir);
    }
  };

  const root = join(depsRoot, ENGINE_PACKAGE);

  if (!existsSync(join(root, "package.json"))) {
    throw new Error(
      `the engine (${ENGINE_PACKAGE}) is not installed in ${depsRoot} - the .vsix would ship an extension that cannot read`,
    );
  }

  visit(root);

  return packages;
};

/** The files of a package, relative to it. */
const packageFiles = (dir) => {
  const files = [];

  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules") {
        // the nested ones are packages of their own: they are copied on their own
        continue;
      }

      const path = join(current, entry.name);

      if (entry.isDirectory()) {
        walk(path);
      } else {
        files.push(relative(dir, path).split(sep).join("/"));
      }
    }
  };

  walk(dir);

  return files;
};

/** Whether a file name matches a pattern like `*.wasm.js`. */
const matches = (name, pattern) =>
  pattern.startsWith("*.") ? name.endsWith(pattern.slice(1)) : name === pattern;

/** Whether a file is one of the package's `include` list. */
const isIncluded = (relativePath, include) => {
  if (!include) {
    return true;
  }

  return include.some(
    (entry) => relativePath === entry || relativePath.startsWith(`${entry}/`),
  );
};

/**
 * Whether a file is one of the package's `exclude` list.
 *
 * A plain name excludes a whole folder of that name, and a pattern like
 * `*.wasm.js` excludes the files whose name it matches.
 */
const isExcluded = (relativePath, patterns) => {
  const segments = relativePath.split("/");

  return patterns.some((pattern) =>
    segments.some((segment, index) =>
      pattern.startsWith("*.")
        ? index === segments.length - 1 && matches(segment, pattern)
        : segment === pattern,
    ),
  );
};

/**
 * Copies the engine's runtime tree into the staged extension.
 *
 * It is copied as FILES: the engine loads its worker and its core from paths
 * at run time, so a bundled extension would have nothing to load (D-89).
 */
const shipEngineTree = () => {
  const tree = collectEngineTree();
  const target = join(stageDir, "extension", "node_modules");

  for (const [name, entry] of tree) {
    const contents = PACKAGE_CONTENTS[name] ?? { include: null, exclude: [] };
    const excludes = [...DEFAULT_EXCLUDES, ...contents.exclude];

    for (const relativePath of packageFiles(entry.dir)) {
      if (!isIncluded(relativePath, contents.include)) {
        continue;
      }

      if (isExcluded(relativePath, excludes)) {
        continue;
      }

      const from = join(entry.dir, relativePath);
      const to = join(target, name, relativePath);

      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }

  // The files the engine needs are CHECKED, not hoped for: a `.vsix` that
  // installs but cannot read is worse than one that does not install.
  for (const required of REQUIRED_ENGINE_FILES) {
    if (!existsSync(join(target, required.split("/").join(sep)))) {
      throw new Error(
        `the .vsix would ship without ${required} - the engine cannot read without it`,
      );
    }
  }

  return tree;
};

// ---------------------------------------------------------------------------
// the manifest files the installer needs
// ---------------------------------------------------------------------------
const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
`;

const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${manifest.name}" Version="${
  manifest.version
}" Publisher="${manifest.publisher}" />
    <DisplayName>${manifest.displayName}</DisplayName>
    <Description xml:space="preserve">${manifest.description}</Description>
    <Tags>${(manifest.keywords ?? []).join(",")}</Tags>
    <Categories>${(manifest.categories ?? ["Other"]).join(",")}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${
        manifest.engines.vscode
      }" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="${(
        manifest.extensionKind ?? ["workspace"]
      ).join(",")}" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
`;

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------
const outFlagIndex = process.argv.indexOf("--out");
const outPath =
  outFlagIndex !== -1 && process.argv[outFlagIndex + 1]
    ? resolve(process.argv[outFlagIndex + 1])
    : join(packageRoot, `${manifest.name}-${manifest.version}.vsix`);

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, "extension", "out"), { recursive: true });
mkdirSync(join(stageDir, "extension", "media"), { recursive: true });

await build({
  entryPoints: [join(extensionDir, "src", "extension.ts")],
  outfile: join(stageDir, "extension", "out", "extension.js"),
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  external: ["vscode"],
  sourcemap: false,
  minify: false,
  legalComments: "none",
  logLevel: "warning",
});

copyFileSync(
  join(extensionDir, "package.json"),
  join(stageDir, "extension", "package.json"),
);

// The capture helper SHIPS with the extension: the panel's live view of the
// editor's own window is drawn by it, and the extension finds it relative to
// its own installed path. Without it the extension would have nothing to run.
copyFileSync(
  join(extensionDir, "media", "capture.ps1"),
  join(stageDir, "extension", "media", "capture.ps1"),
);

// The OCR sidecar SHIPS with the extension too: the Python engines are Python,
// so they run in a process of their own, and that process runs THIS (D-90).
copyFileSync(
  join(extensionDir, "media", "ocr_sidecar.py"),
  join(stageDir, "extension", "media", "ocr_sidecar.py"),
);

// The OCR engine SHIPS with the extension as FILES: it loads its worker and
// its core from paths at run time, so bundling the extension's TypeScript is
// not enough (D-89).
const engineTree = shipEngineTree();

const readme = join(packageRoot, "README.md");
if (existsSync(readme)) {
  copyFileSync(readme, join(stageDir, "extension", "README.md"));
}

const entries = [
  {
    name: "extension/package.json",
    data: readFileSync(join(stageDir, "extension", "package.json")),
  },
  {
    name: "extension/out/extension.js",
    data: readFileSync(join(stageDir, "extension", "out", "extension.js")),
  },
  {
    name: "extension/media/capture.ps1",
    data: readFileSync(join(stageDir, "extension", "media", "capture.ps1")),
  },
  {
    name: "extension/media/ocr_sidecar.py",
    data: readFileSync(join(stageDir, "extension", "media", "ocr_sidecar.py")),
  },
];
if (existsSync(join(stageDir, "extension", "README.md"))) {
  entries.push({
    name: "extension/README.md",
    data: readFileSync(join(stageDir, "extension", "README.md")),
  });
}

// the engine's runtime tree, file by file
for (const relativePath of packageFiles(
  join(stageDir, "extension", "node_modules"),
)) {
  entries.push({
    name: `extension/node_modules/${relativePath}`,
    data: readFileSync(
      join(
        stageDir,
        "extension",
        "node_modules",
        relativePath.split("/").join(sep),
      ),
    ),
  });
}
entries.push({
  name: "extension.vsixmanifest",
  data: Buffer.from(vsixManifest, "utf8"),
});
entries.push({
  name: "[Content_Types].xml",
  data: Buffer.from(contentTypes, "utf8"),
});

const zip = writeZip(entries);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, zip);

// read the file back and check it is a zip with the entries we meant to write
const written = readFileSync(outPath);
if (written.readUInt32LE(0) !== 0x04034b50) {
  throw new Error("the vsix does not start with a zip local file header");
}
for (const entry of entries) {
  if (!written.includes(Buffer.from(entry.name, "utf8"))) {
    throw new Error(`the vsix is missing ${entry.name}`);
  }
}

const size = statSync(outPath).size;
process.stdout.write(`vsix: ${outPath}\n`);
process.stdout.write(`size: ${size} bytes\n`);
process.stdout.write(`engine tree: ${[...engineTree.keys()].join(", ")}\n`);
process.stdout.write("entries:\n");
for (const entry of entries) {
  process.stdout.write(`  ${entry.name} (${entry.data.length} bytes)\n`);
}
