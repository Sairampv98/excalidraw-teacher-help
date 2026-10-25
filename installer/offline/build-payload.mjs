#!/usr/bin/env node
/**
 * Build the offline payload - everything the offline setup carries with it.
 *
 * A classroom machine may have no internet at all: a locked-down lab, a school
 * network, a laptop on a train. So the payload carries the installers, the
 * extension and the app, and the offline setup installs from it without ever
 * reaching the internet.
 *
 *   node installer/offline/build-payload.mjs [--arch x64|arm64] [--out <dir>]
 *
 * It is RE-RUNNABLE: a file that is already in the payload is skipped, so the
 * payload is never downloaded twice.
 *
 * What the payload does NOT carry, and why (this is the finding that makes the
 * offline setup possible):
 *
 *   - the app's npm dependencies. The app is a STATIC bundle - HTML and assets,
 *     served as they are - so it needs no server runtime and no `node_modules`.
 *     The payload carries the BUILT app, and the offline setup never runs
 *     `yarn install`.
 *   - Python. The default OCR engine, tesseract, is WebAssembly INSIDE the
 *     extension and runs in the extension's own process. Python is only for the
 *     optional `indra` and `paddle` engines.
 *
 * The payload is BUILD OUTPUT: it is gitignored, and only this builder is
 * committed.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

/** The bridge URL the app is built with, and the one the setup prints. */
export const DEFAULT_BRIDGE_URL = "ws://127.0.0.1:47511/";

/** The app's build output - the static bundle the payload carries. */
const DEFAULT_APP_DIR = join(ROOT, "excalidraw-app", "build");

/** The extension's package, and the script that builds it. */
const VSIX_SCRIPT = join(
  ROOT,
  "packages",
  "vscode-bridge",
  "scripts",
  "build-vsix.mjs",
);

// ---------------------------------------------------------------------------
// the small parts
// ---------------------------------------------------------------------------

/** The SHA-256 of a file, as the manifest and the setup both read it. */
export const sha256File = (path) => {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
};

/** The machine's own architecture, in the words the installers use. */
export const machineArch = () =>
  process.env.PROCESSOR_ARCHITECTURE === "ARM64" ? "arm64" : "x64";

/** A fetch that says who it is - the GitHub API refuses a request without it. */
const fetchWithAgent = (url, headers = {}) =>
  fetch(url, {
    headers: { "User-Agent": "excalidraw-offline-payload", ...headers },
    redirect: "follow",
  });

/** A JSON GET. */
const fetchJson = async (url) => {
  const response = await fetchWithAgent(url);

  if (!response.ok) {
    throw new Error(
      "could not read " + url + " - the server said " + response.status,
    );
  }

  return response.json();
};

/** A HEAD that answers whether a URL is there. */
const headOk = async (url) => {
  try {
    const response = await fetchWithAgent(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
};

/** The version numbers in a string, compared the way versions are. */
const compareVersions = (a, b) => {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index++) {
    const difference = (left[index] || 0) - (right[index] || 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
};

// ---------------------------------------------------------------------------
// the zip writer (DEFLATE, written here so the project gains no dependency)
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

const dosTimestamp = (date) => ({
  time:
    ((date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1)) &
    0xffff,
  day:
    (((date.getFullYear() - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate()) &
    0xffff,
});

/** Every file under a folder, relative to it, with "/" between the parts. */
const filesUnder = (dir, prefix = "") => {
  const found = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = prefix ? prefix + "/" + entry.name : entry.name;

    if (entry.isDirectory()) {
      found.push(...filesUnder(join(dir, entry.name), name));
    } else if (entry.isFile()) {
      found.push({ name, path: join(dir, entry.name) });
    }
  }

  return found;
};

/**
 * The extensions whose files are ALREADY compressed.
 *
 * Deflating them again is slow and gains nothing, so they are stored as they
 * are - which is also what makes the payload's zip quick to build.
 */
const ALREADY_COMPRESSED = new Set([
  ".exe",
  ".msi",
  ".zip",
  ".vsix",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".wasm",
]);

/**
 * Write a zip of a folder.
 *
 * The app's build output is zipped with this, and the result is what the
 * offline setup carries as a resource.
 */
export const zipFolder = (folder, zipPath) => {
  const { time, day } = dosTimestamp(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  const files = filesUnder(folder);

  for (const file of files) {
    const raw = readFileSync(file.path);
    const name = Buffer.from(file.name, "utf8");
    const stored = ALREADY_COMPRESSED.has(
      file.name.slice(file.name.lastIndexOf(".")).toLowerCase(),
    );
    const data = stored ? raw : deflateRawSync(raw, { level: 9 });
    const method = stored ? 0 : 8;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0014, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
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
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  mkdirSync(dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, Buffer.concat([...locals, centralDirectory, end]));

  return zipPath;
};

// ---------------------------------------------------------------------------
// the manifest
// ---------------------------------------------------------------------------

/**
 * The manifest: what the payload carries, with each file's HASH and VERSION.
 *
 * The hash and the size are read from the file itself, so the manifest cannot
 * drift from what is on the disk.
 *
 * The offline setup reads it and refuses a payload that does not match.
 */
export const buildManifest = ({ arch, bridgeUrl, files }) => ({
  schema: 1,
  generatedAt: new Date().toISOString(),
  arch,
  bridgeUrl,
  files: files
    .map((file) => ({
      role: file.role,
      name: file.name,
      version: file.version,
      sha256: sha256File(file.path),
      size: statSync(file.path).size,
      source: file.source ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
});

/** Where the manifest lives inside a payload folder. */
export const MANIFEST_NAME = "manifest.json";

/** Read the manifest of a payload folder, or null when there is none. */
export const readManifest = (dir) => {
  const path = join(dir, MANIFEST_NAME);

  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(readFileSync(path, "utf8"));
};

/** Write the manifest of a payload folder. */
export const writeManifest = (dir, manifest) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, MANIFEST_NAME),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
};

// ---------------------------------------------------------------------------
// what the payload carries, and where each piece comes from
// ---------------------------------------------------------------------------

/**
 * The Node.js MSI.
 *
 * The index at nodejs.org lists the MSI as "win-x64-msi", but the FILE it names
 * is "node-<version>-x64.msi" - the "win-" is in the index's name, not in the
 * file's. Getting this wrong is a 404.
 */
export const resolveNode = async (arch) => {
  const index = await fetchJson("https://nodejs.org/dist/index.json");
  const release = index.find(
    (entry) =>
      entry.lts &&
      Array.isArray(entry.files) &&
      entry.files.includes("win-" + arch + "-msi"),
  );

  if (!release) {
    throw new Error(
      "nodejs.org lists no LTS release with a win-" + arch + " MSI",
    );
  }

  const version = release.version;

  return {
    role: "node",
    name: "node-" + version + "-" + arch + ".msi",
    version,
    url:
      "https://nodejs.org/dist/" +
      version +
      "/node-" +
      version +
      "-" +
      arch +
      ".msi",
  };
};

/** The VS Code installer - the official one, for the machine's architecture. */
export const resolveVSCode = async (arch) => {
  const releases = await fetchJson(
    "https://update.code.visualstudio.com/api/releases/stable",
  );

  // the API answers with a list of version strings, newest first
  const first = releases[0];
  const version =
    typeof first === "string" ? first : first?.version ?? "unknown";

  return {
    role: "vscode",
    name: "vscode-" + arch + "-setup.exe",
    version,
    url:
      "https://update.code.visualstudio.com/latest/win32-" +
      arch +
      "-user/stable",
  };
};

/**
 * The VSCodium installer.
 *
 * The per-USER installer is the one a classroom machine wants: it installs into
 * the user's own profile and needs no administrator rights. Its name carries
 * the version, so the release has to be read from the API - there is no
 * "latest" URL for it.
 */
export const resolveVSCodium = async (arch) => {
  const release = await fetchJson(
    "https://api.github.com/repos/VSCodium/vscodium/releases/latest",
  );
  const asset = release.assets.find(
    (entry) =>
      entry.name ===
      "VSCodiumUserSetup-" + arch + "-" + release.tag_name + ".exe",
  );

  if (!asset) {
    throw new Error(
      "the VSCodium release " +
        release.tag_name +
        " has no per-user installer for " +
        arch,
    );
  }

  return {
    role: "vscodium",
    name: "vscodium-" + arch + "-setup.exe",
    version: release.tag_name,
    url: asset.browser_download_url,
  };
};

/**
 * Python - the amd64 installer.
 *
 * Python is OPTIONAL: the default OCR engine (tesseract) is WebAssembly inside
 * the extension. Python is only for the `indra` and `paddle` engines.
 */
export const resolvePython = async () => {
  const listing = await fetchWithAgent("https://www.python.org/ftp/python/");
  const html = await listing.text();
  const versions = new Set();

  for (const match of html.matchAll(/href="(3\.1[56]\.\d+)\//g)) {
    versions.add(match[1]);
  }

  const ordered = [...versions].sort(compareVersions).reverse();

  for (const version of ordered) {
    const url =
      "https://www.python.org/ftp/python/" +
      version +
      "/python-" +
      version +
      "-amd64.exe";

    if (await headOk(url)) {
      return {
        role: "python",
        name: "python-" + version + "-amd64.exe",
        version,
        url,
      };
    }
  }

  throw new Error("python.org has no 3.15/3.16 amd64 installer to fetch");
};

/**
 * Java - a Temurin JDK, as a ZIP.
 *
 * A zip and not an installer, because a zip needs no installer: it is unpacked
 * and its `bin` is added to the machine's PATH.
 */
export const resolveJava = async (arch) => {
  const assets = await fetchJson(
    "https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=" +
      arch +
      "&image_type=jdk&os=windows&vendor=eclipse",
  );
  const asset = assets[0];

  if (!asset) {
    throw new Error("Adoptium has no Temurin JDK for " + arch);
  }

  const pkg = asset.binary.package;

  return {
    role: "java",
    name: pkg.name,
    version: asset.version?.semver ?? pkg.name,
    url: pkg.link,
  };
};

/**
 * The virtual display driver.
 *
 * Two packages: the DRIVER-ONLY one for the machine's architecture (about
 * 0.1 MB) and the CONTROL one (about 68 MB), which is what a teacher uses to
 * put the monitor into Extend. The driver needs administrator rights and a
 * reboot, so the setup says both plainly.
 */
export const resolveDisplayDriver = async (arch) => {
  const release = await fetchJson(
    "https://api.github.com/repos/itsmikethetech/Virtual-Display-Driver/releases/latest",
  );
  const driverName =
    arch === "arm64"
      ? "VirtualDisplayDriver-ARM64.Driver.Only.zip"
      : "VirtualDisplayDriver-x86.Driver.Only.zip";
  const driver = release.assets.find((entry) => entry.name === driverName);
  const control = release.assets.find(
    (entry) => entry.name === "VDD.Control." + release.tag_name + ".zip",
  );

  if (!driver) {
    throw new Error("the virtual display driver release has no " + driverName);
  }

  const found = [
    {
      role: "display-driver",
      name: driver.name,
      version: release.tag_name,
      url: driver.browser_download_url,
    },
  ];

  if (control) {
    found.push({
      role: "display-control",
      name: control.name,
      version: release.tag_name,
      url: control.browser_download_url,
    });
  }

  return found;
};

/** The extension - built by the project's own script. */
export const resolveExtension = (outDir) => {
  const manifest = JSON.parse(
    readFileSync(
      join(ROOT, "packages", "vscode-bridge", "extension", "package.json"),
      "utf8",
    ),
  );

  return {
    role: "extension",
    name: manifest.name + "-" + manifest.version + ".vsix",
    version: manifest.version,
    url: null,
    built: true,
    outDir,
  };
};

// ---------------------------------------------------------------------------
// the build
// ---------------------------------------------------------------------------

/** Download a file into the payload, unless it is already there. */
const download = async (artifact, outDir) => {
  const target = join(outDir, artifact.name);

  if (existsSync(target) && statSync(target).size > 0) {
    console.log("   have  " + artifact.name);
    return target;
  }

  console.log("   get   " + artifact.name + "  <- " + artifact.url);

  const response = await fetchWithAgent(artifact.url);

  if (!response.ok) {
    throw new Error(
      "could not download " +
        artifact.url +
        " - the server said " +
        response.status,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(target, buffer);

  return target;
};

/** The arguments this script was given. */
const parseArgs = (argv) => {
  const args = {
    arch: machineArch(),
    out: join(HERE, "payload"),
    appDir: DEFAULT_APP_DIR,
    bridgeUrl: DEFAULT_BRIDGE_URL,
    manifestOnly: false,
    skip: [],
    buildApp: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];

    if (flag === "--arch") {
      args.arch = argv[++index];
    } else if (flag === "--out") {
      args.out = resolve(argv[++index]);
    } else if (flag === "--app") {
      args.appDir = resolve(argv[++index]);
    } else if (flag === "--bridge-url") {
      args.bridgeUrl = argv[++index];
    } else if (flag === "--skip") {
      args.skip = (argv[++index] || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (flag === "--manifest-only") {
      args.manifestOnly = true;
    } else if (flag === "--build-app") {
      args.buildApp = true;
    }
  }

  if (args.arch !== "x64" && args.arch !== "arm64") {
    throw new Error("--arch must be x64 or arm64 (got " + args.arch + ")");
  }

  return args;
};

/**
 * The manifest of a payload that is ALREADY there, with the hashes recomputed.
 *
 * This is what `--manifest-only` does: it never touches the network, and it is
 * how the manifest is refreshed after a file has been replaced.
 */
export const refreshManifest = (outDir, arch, bridgeUrl) => {
  const previous = readManifest(outDir);
  const known = new Map(
    (previous?.files ?? []).map((file) => [file.name, file]),
  );
  const files = [];

  for (const entry of readdirSync(outDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === MANIFEST_NAME) {
      continue;
    }

    const path = join(outDir, entry.name);
    const was = known.get(entry.name);

    files.push({
      role: was?.role ?? "unknown",
      name: entry.name,
      version: was?.version ?? "unknown",
      path,
      source: was?.source ?? null,
    });
  }

  return buildManifest({
    arch,
    bridgeUrl: previous?.bridgeUrl ?? bridgeUrl,
    files,
  });
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.out;

  mkdirSync(outDir, { recursive: true });

  if (args.manifestOnly) {
    const manifest = refreshManifest(outDir, args.arch, args.bridgeUrl);
    writeManifest(outDir, manifest);
    console.log(
      "manifest refreshed: " +
        manifest.files.length +
        " file(s) - nothing was downloaded",
    );
    return;
  }

  console.log("the offline payload");
  console.log("   folder:  " + outDir);
  console.log("   machine: " + args.arch);
  console.log("   bridge:  " + args.bridgeUrl);
  console.log("");

  const wanted = (role) => !args.skip.includes(role);

  if (args.buildApp) {
    console.log("building the app (yarn build:app)");
    execFileSync("yarn", ["build:app"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, VITE_APP_BRIDGE_URL: args.bridgeUrl },
    });
  }

  const artifacts = [];

  if (wanted("node")) {
    artifacts.push(await resolveNode(args.arch));
  }

  if (wanted("vscode")) {
    artifacts.push(await resolveVSCode(args.arch));
  }

  if (wanted("vscodium")) {
    artifacts.push(await resolveVSCodium(args.arch));
  }

  if (wanted("python")) {
    artifacts.push(await resolvePython());
  }

  if (wanted("java")) {
    artifacts.push(await resolveJava(args.arch));
  }

  if (wanted("display-driver")) {
    artifacts.push(...(await resolveDisplayDriver(args.arch)));
  }

  const extension = resolveExtension(outDir);
  const vsixPath = join(outDir, extension.name);

  if (!existsSync(vsixPath) || statSync(vsixPath).size === 0) {
    console.log("building the extension");
    execFileSync(process.execPath, [VSIX_SCRIPT, "--out", vsixPath], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } else {
    console.log("   have  " + extension.name);
  }

  artifacts.push(extension);

  // the app: the prebuilt static bundle, zipped. No node_modules, no npm
  // tarballs - the app is served as files and needs nothing to run it, so
  // this builder never installs npm packages either.
  if (!existsSync(args.appDir)) {
    console.log(
      "   the app is NOT built (" +
        args.appDir +
        ") - run `yarn build:app`, or pass --build-app",
    );
  } else {
    const appZip = join(outDir, "app.zip");

    if (existsSync(appZip) && statSync(appZip).size > 0) {
      console.log("   have  app.zip");
    } else {
      console.log("   zip   the app -> app.zip");
      zipFolder(args.appDir, appZip);
    }

    artifacts.push({
      role: "app",
      name: "app.zip",
      version: "built",
      url: null,
    });
  }

  console.log("");
  console.log("downloading");

  const files = [];

  for (const artifact of artifacts) {
    if (artifact.built) {
      const path = join(outDir, artifact.name);

      files.push({
        role: artifact.role,
        name: artifact.name,
        version: artifact.version,
        path,
        source: artifact.url,
      });
      continue;
    }

    const path = await download(artifact, outDir);

    files.push({
      role: artifact.role,
      name: artifact.name,
      version: artifact.version,
      path,
      source: artifact.url,
    });
  }

  const manifest = buildManifest({
    arch: args.arch,
    bridgeUrl: args.bridgeUrl,
    files,
  });

  writeManifest(outDir, manifest);

  const total = manifest.files.reduce((sum, file) => sum + file.size, 0);

  console.log("");
  console.log(
    "the payload holds " +
      files.length +
      " file(s), " +
      (total / (1024 * 1024)).toFixed(1) +
      " MB",
  );
  console.log("   " + outDir);
};

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error("the payload could not be built: " + error.message);
    process.exit(1);
  });
}
