#!/usr/bin/env node
/**
 * The release of the public artifacts.
 *
 * Three files are published for the teacher to download:
 *
 *   - `excalidraw-bridge-<version>.vsix` - the editor extension;
 *   - `setup.exe` - the setup as one file;
 *   - `excalidraw-mcp-server.mjs` - the assistant's server.
 *
 * They are **built**, then **scrubbed** with the same scrubber the public
 * mirror uses, and then **scanned** with the same guard the mirror uses: an
 * artifact that still carries an id of a decision, a word of the way this
 * repository is developed, a secret or a path of the machine that built it is
 * **not published** - the release stops and says which file and which line.
 *
 * The scrub is what makes the artifact safe to keep for years: the mirror
 * scrubs the *files* it publishes, but an artifact is built from the private
 * tree, so it has to be scrubbed on its own.
 *
 *   node scripts/public-sync/release.mjs [--out <folder>]
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readZip,
  writeZip,
} from "../../packages/vscode-bridge/scripts/zip.mjs";
import { scrubFile } from "./scrub.mjs";
import { scanText, scanTree } from "./guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

/** the map of the sentences that are rewritten into ordinary wording */
const loadMap = (file = join(HERE, "rewrite-map.json")) =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};

/** whether a file holds text (a binary one - a wasm core - is left as it is) */
const isBinary = (content) =>
  typeof content !== "string" && Buffer.from(content).includes(0);

/**
 * The files of an artifact, scrubbed.
 *
 * The text files go through the scrubber; the binary ones are left as they
 * are, because they are the engine's wasm cores and nothing in them is text.
 *
 * A sentence that names the way this repository is developed and that the
 * rewrite map does not hold is **dropped** (it is a comment, and a comment
 * that names the method has no business in a published file) and reported, so
 * that the report says what was taken out.
 *
 * @param {Map<string, Buffer>} files
 * @returns {{files: Map<string, Buffer>, dropped: string[]}}
 */
export const scrubFiles = (files, { map = null } = {}) => {
  const out = new Map();
  const dropped = [];

  for (const [path, content] of files) {
    if (isBinary(content)) {
      out.set(path, content);
      continue;
    }

    const { text, unmapped } = scrubFile(path, String(content), {
      map,
      allowDrop: true,
    });

    out.set(path, Buffer.from(text, "utf8"));
    dropped.push(...unmapped.map((sentence) => `${path}: ${sentence}`));
  }

  return { files: out, dropped };
};

/**
 * The findings of the guard over the files of an artifact.
 *
 * @param {Map<string, Buffer>} files
 */
export const scanFiles = (files) =>
  scanTree(files, { deny: [], untouched: [] });

/**
 * The findings of the guard over a binary artifact, read as bytes.
 *
 * The guard skips a binary file (it cannot be read as text), but an
 * executable holds text inside it - the setup carries its scripts with it -
 * and that text is what the release must check.
 *
 * @param {string} path
 * @param {Buffer} buffer
 */
export const scanBinary = (path, buffer) =>
  scanText(path, buffer.toString("latin1"));

/** the extension's version, which is the number the `.vsix` is named after */
const extensionVersion = () =>
  JSON.parse(
    readFileSync(
      join(ROOT, "packages", "vscode-bridge", "extension", "package.json"),
      "utf8",
    ),
  ).version;

/**
 * Checks that a file is still a JavaScript module.
 *
 * A scrub that broke the code would publish an artifact that cannot run, and
 * the guard would not see it: it looks for leaks, not for syntax.
 */
const checkModule = (file) => {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
};

/** the built extension, scrubbed, as a `.vsix` */
const buildExtension = (outDir, { map }) => {
  const work = mkdtempSync(join(tmpdir(), "excalidraw-release-"));
  const raw = join(work, "extension.vsix");

  execFileSync(
    process.execPath,
    [
      join(ROOT, "packages", "vscode-bridge", "scripts", "build-vsix.mjs"),
      "--out",
      raw,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );

  const entries = readZip(readFileSync(raw));
  const { files, dropped } = scrubFiles(
    new Map(entries.map((entry) => [entry.name, entry.data])),
    { map },
  );

  // the package has to be a package still: the manifest is JSON and the
  // bundle is JavaScript, and a scrub that broke either of them would publish
  // an extension that cannot be installed
  const manifest = files.get("extension/package.json");

  if (!manifest) {
    throw new Error("the built extension has no manifest");
  }

  JSON.parse(manifest.toString("utf8"));

  const bundle = files.get("extension/out/extension.js");

  if (!bundle) {
    throw new Error("the built extension has no bundle");
  }

  const bundleFile = join(work, "extension.js");
  writeFileSync(bundleFile, bundle);
  checkModule(bundleFile);

  const out = join(outDir, `excalidraw-bridge-${extensionVersion()}.vsix`);
  writeFileSync(
    out,
    writeZip([...files].map(([name, data]) => ({ name, data }))),
  );
  rmSync(work, { recursive: true, force: true });

  return { out, files, dropped, findings: scanFiles(files) };
};

/** the setup as one file, built from scrubbed copies of what it carries */
const buildSetup = (outDir, { map }) => {
  const work = mkdtempSync(join(tmpdir(), "excalidraw-release-"));
  const resources = join(work, "resources");

  mkdirSync(join(resources, "lib"), { recursive: true });

  const carried = [
    {
      from: join(ROOT, "installer", "setup.ps1"),
      to: join(resources, "setup.ps1"),
    },
    {
      from: join(ROOT, "installer", "setup.sh"),
      to: join(resources, "setup.sh"),
    },
    {
      from: join(ROOT, "installer", "lib", "check.mjs"),
      to: join(resources, "lib", "check.mjs"),
    },
  ];

  const files = new Map();
  const dropped = [];

  for (const { from, to } of carried) {
    const { text, unmapped } = scrubFile(
      from.replace(/\\/g, "/"),
      readFileSync(from, "utf8"),
      { map, allowDrop: true },
    );

    writeFileSync(to, text, "utf8");
    files.set(to.replace(/\\/g, "/"), Buffer.from(text, "utf8"));
    dropped.push(...unmapped.map((sentence) => `${from}: ${sentence}`));
  }

  // the carried script is JavaScript, and it has to be JavaScript still
  checkModule(join(resources, "lib", "check.mjs"));

  const out = join(outDir, "setup.exe");

  execFileSync(
    process.execPath,
    [
      join(ROOT, "installer", "build-setup-exe.mjs"),
      "--out",
      out,
      "--resources",
      resources,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );

  const buffer = readFileSync(out);
  rmSync(work, { recursive: true, force: true });

  // the executable carries the scripts with it, so the bytes of it are
  // scanned as well as the scripts that were put into it
  return {
    out,
    files,
    dropped,
    findings: [...scanFiles(files), ...scanBinary(out, buffer)],
  };
};

/** the assistant's server, as one file that runs with `node` */
const buildServer = (outDir, { map }) => {
  execFileSync(
    process.execPath,
    [join(ROOT, "scripts", "buildMcpServer.mjs")],
    { cwd: ROOT, stdio: "inherit" },
  );

  const built = join(ROOT, "packages", "mcp-server", "dist", "index.js");
  const { files, dropped } = scrubFiles(
    new Map([["excalidraw-mcp-server.mjs", readFileSync(built)]]),
    { map },
  );

  const out = join(outDir, "excalidraw-mcp-server.mjs");
  writeFileSync(out, files.get("excalidraw-mcp-server.mjs"));

  // the server has to be a server still: the file is a module, and a scrub
  // that broke it would publish a server that cannot start
  checkModule(out);

  return { out, files, dropped, findings: scanFiles(files) };
};

/** the release: the three artifacts, built, scrubbed and scanned */
export const release = (outDir, { map = loadMap() } = {}) => {
  mkdirSync(outDir, { recursive: true });

  const artifacts = [
    buildExtension(outDir, { map }),
    buildSetup(outDir, { map }),
    buildServer(outDir, { map }),
  ];

  const findings = artifacts.flatMap((artifact) => artifact.findings);
  const dropped = artifacts.flatMap((artifact) => artifact.dropped);

  return { artifacts, findings, dropped };
};

const main = () => {
  const flag = process.argv.indexOf("--out");
  const outDir =
    flag !== -1 && process.argv[flag + 1]
      ? resolve(process.argv[flag + 1])
      : join(ROOT, "release");

  const { artifacts, findings, dropped } = release(outDir);

  for (const artifact of artifacts) {
    const size = (statSync(artifact.out).size / 1024).toFixed(1);
    console.log(`  ${artifact.out}  ${size} KB`);
  }

  if (dropped.length) {
    console.log(`  ${dropped.length} sentence(s) of the method were dropped`);
    for (const sentence of dropped) {
      console.log(`    ${sentence}`);
    }
  }

  if (findings.length) {
    console.error("");
    console.error(
      "the release stops: the artifacts still carry something of the method",
    );
    for (const finding of findings) {
      console.error(`  - ${finding.file}:${finding.line}  ${finding.rule}`);
    }
    process.exit(1);
  }

  console.log("  the guard found nothing: the artifacts may be published");
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main();
}
