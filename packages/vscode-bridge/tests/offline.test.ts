/**
 * The offline setup: one file, no internet, nothing to install (D-154, AC-188).
 *
 * The setup of the online wave DOWNLOADS what it installs. A classroom machine
 * may have no internet at all, so this wave ships a setup that CARRIES its
 * payload and installs from it - and that runs the app with nothing installed.
 *
 * This test proves the SHAPE, by reading the FILES:
 *
 *   - the C# program (`installer/offline/OfflineSetup.cs`),
 *   - the payload builder (`installer/offline/build-payload.mjs`),
 *   - the build script (`installer/offline/build-offline-setup.mjs`),
 *   - the manifest the builder writes.
 *
 * It downloads NOTHING and does not run the payload. The real run - a Windows
 * Sandbox with no networking - proves the thing itself.
 *
 * The findings that shape all of it are read from the code, not guessed: the
 * app is a STATIC bundle (so the payload carries no npm tarballs and the setup
 * never runs `yarn install`), and the default OCR engine is WebAssembly inside
 * the extension (so Python is only for the optional engines).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  buildManifest,
  readManifest,
  refreshManifest,
} from "../../../installer/offline/build-payload.mjs";

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

/**
 * The code of a file, without its comments.
 *
 * A comment that TALKS about a command is not the same as the program RUNNING
 * it, and the assertions below are about what runs.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SOURCE = "installer/offline/OfflineSetup.cs";
const BUILDER = "installer/offline/build-payload.mjs";
const BUILD = "installer/offline/build-offline-setup.mjs";

describe("the offline setup: one file, no internet, nothing to install", () => {
  it("AC-188 the offline setup carries its payload with it", () => {
    const source = read(SOURCE);
    const build = read(BUILD);

    // the payload is CARRIED in the executable, as resources, so the
    // executable is one file that needs nothing beside it
    expect(source).toContain("GetManifestResourceStream");
    expect(source).toContain("payload.index.json");
    expect(build).toContain("/resource:");
    expect(build).toContain("payload.index.json");

    // and it is unpacked to the user's own application data
    expect(source).toContain("ExcalidrawClassroom");
    expect(source).toContain("LocalApplicationData");
    expect(source).toContain("WritePayloadFile");

    // the payload is about 780 MB, so it is carried in PIECES and written out
    // one piece at a time: the disk holds it once, and the memory holds one
    // piece - never the whole thing, and never a copy of it
    expect(source).toContain("Path.Combine(payloadDir, name)");
    expect(source).toContain("TransformBlock");
    expect(source).not.toContain("payload.zip");
    expect(build).toContain("PIECE_SIZE");
    expect(build).toContain("payload.");

    // the build itself needs no dependency: the compiler that ships with
    // Windows, and AnyCPU so the executable runs on ARM64 Windows too
    expect(build).toContain(
      "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe",
    );
    expect(build).toContain("/platform:anycpu");
    expect(build).not.toContain("npm install");
    expect(build).not.toContain("yarn add");

    // and the payload is checked BEFORE anything is installed
    expect(source.indexOf("PreparePayload(payloadDir)")).toBeGreaterThan(-1);
    expect(source.indexOf("PreparePayload(payloadDir)")).toBeLessThan(
      source.indexOf("InstallEverything("),
    );
  });

  it("AC-188 the offline setup checks the payload's hashes and refuses a payload that does not match", () => {
    const source = read(SOURCE);

    // the hash of every file is read and compared with the manifest's
    expect(source).toContain("SHA256");
    expect(source).toContain("ComputeHash");
    expect(source).toContain("TransformBlock");
    expect(source).toContain("sha256");
    expect(source).toContain("StringComparison.OrdinalIgnoreCase");

    // and a payload that does not match is REFUSED - nothing is installed and
    // nothing is served
    expect(source).toContain("does NOT match its manifest");
    expect(source).toContain("Nothing was installed and nothing was served");

    // a piece that is not there is REPORTED, never fetched
    expect(source).toContain("the payload is missing a piece of");

    // the manifest itself is the JSON the builder writes
    expect(source).toContain("manifest.json");
    expect(source).toContain("JavaScriptSerializer");
  });

  it("AC-188 a dry run installs nothing at all", () => {
    const source = read(SOURCE);

    // the switch is there, and it is parsed
    expect(source).toContain("-DryRun");
    expect(source).toContain("dryRun = true");

    // the guard is the line that stops a dry run, and EVERY install command
    // has to be behind it
    const guard = source.indexOf("if (dryRun)");

    expect(guard).toBeGreaterThan(-1);

    const installs = [
      "msiexec.exe",
      "/VERYSILENT",
      "/quiet InstallAllUsers=0",
      "--install-extension",
    ];

    for (const install of installs) {
      expect(source).toContain(install);
      expect(source.indexOf(install)).toBeGreaterThan(guard);
    }
  });

  it("AC-188 the offline setup runs the app with nothing installed", () => {
    const source = read(SOURCE);

    // the app is a static bundle out of the payload, and the program itself
    // is the server
    expect(source).toContain("HttpListener");
    expect(source).toContain("http://127.0.0.1:");
    expect(source).toContain("index.html");
    expect(source).toContain("app.zip");

    // and the browser is opened on it
    expect(source).toContain("OpenBrowser");

    // nothing has to be installed for that: the program says so
    expect(source).toContain("Nothing is installed");
  });

  it("AC-188 the offline setup never reaches the internet", () => {
    const source = read(SOURCE);

    // there is no download code in it at all - a file that is missing from
    // the payload is REPORTED, never fetched
    for (const forbidden of [
      "WebClient",
      "HttpWebRequest",
      "WebRequest",
      "DownloadFile",
      "DownloadString",
      "HttpClient",
      "https://",
    ]) {
      expect(source).not.toContain(forbidden);
    }

    // and the one URL in it is the loopback address it serves the app on
    expect(source).toContain("http://127.0.0.1:");
  });

  it("AC-188 the payload builder downloads what the setup needs and is re-runnable", () => {
    const builder = read(BUILDER);

    // the sources the payload is built from
    expect(builder).toContain("https://nodejs.org/dist/index.json");
    expect(builder).toContain(
      "https://update.code.visualstudio.com/latest/win32-",
    );
    expect(builder).toContain(
      "https://api.github.com/repos/VSCodium/vscodium/releases/latest",
    );
    expect(builder).toContain("https://www.python.org/ftp/python/");

    // and not the virtual display driver: nothing needs it any more (D-329)
    expect(builder).not.toContain("Virtual-Display-Driver");

    // the MSI's NAME has no "win-" in it - the index calls it that, the file
    // does not, and getting it wrong is a 404
    expect(builder).toContain('"node-" + version + "-" + arch + ".msi"');
    expect(builder).not.toContain('"node-" + version + "-win-"');

    // the per-user VSCodium installer, which is the one a classroom machine
    // wants: it needs no administrator rights
    expect(builder).toContain("VSCodiumUserSetup-");

    // no driver package and no control app for a second screen
    expect(builder).not.toContain("VirtualDisplayDriver");
    expect(builder).not.toContain("VDD.Control");
    expect(builder).not.toContain("display-driver");

    // the architecture is an argument, not a guess
    expect(builder).toContain("--arch");
    expect(builder).toContain("x64");
    expect(builder).toContain("arm64");

    // it is RE-RUNNABLE: a file that is already there is skipped
    expect(builder).toContain("existsSync(target)");

    // and it never installs npm packages: the app is a static bundle, so the
    // payload carries no npm tarballs at all
    expect(code(builder)).not.toContain("yarn install");
    expect(code(builder)).not.toMatch(
      /execFileSync\(\s*["']yarn["']\s*,\s*\[\s*["']install/,
    );
    expect(code(builder)).not.toContain("node_modules");
  });

  it("AC-188 the manifest carries the hash and the version of every file", () => {
    // the manifest is built from the files themselves, so the hash cannot
    // drift from what is on the disk
    const folder = mkdtempSync(join(tmpdir(), "excalidraw-offline-"));
    const path = join(folder, "node-v1.2.3-x64.msi");
    const content = "not really an MSI, but the hash is the same for any bytes";
    writeFileSync(path, content);

    const manifest = buildManifest({
      arch: "x64",
      bridgeUrl: "ws://127.0.0.1:47511/",
      files: [
        { role: "node", name: "node-v1.2.3-x64.msi", version: "v1.2.3", path },
      ],
    });

    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0].version).toBe("v1.2.3");
    expect(manifest.files[0].role).toBe("node");
    expect(manifest.arch).toBe("x64");
    expect(manifest.bridgeUrl).toBe("ws://127.0.0.1:47511/");

    // the hash is the file's OWN hash - the oracle here is node's crypto, not
    // the builder's own arithmetic
    expect(manifest.files[0].sha256).toBe(
      createHash("sha256").update(content).digest("hex"),
    );
    expect(manifest.files[0].size).toBe(content.length);

    // and the manifest can be read back
    writeFileSync(
      join(folder, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
    const readBack = readManifest(folder);
    expect(readBack?.files[0].sha256).toBe(manifest.files[0].sha256);

    // the manifest can also be refreshed without touching the network
    const refreshed = refreshManifest(folder, "x64", "ws://127.0.0.1:47511/");
    expect(
      refreshed.files.map((file: { name: string }) => file.name),
    ).toContain("node-v1.2.3-x64.msi");
  });

  it("AC-188 the offline setup is C# 5 and needs no dependency of its own", () => {
    const source = read(SOURCE);

    // C# 5: the compiler that ships with Windows understands nothing newer
    expect(source).not.toContain('$"');
    expect(source).not.toContain("=>");
    expect(source).not.toContain("nameof(");
    expect(source).not.toContain("?.");

    // and the only assemblies it uses are the ones Windows ships
    const build = read(BUILD);
    expect(build).toContain("/reference:System.Web.Extensions.dll");
    expect(build).toContain("/reference:System.IO.Compression.FileSystem.dll");
    expect(build).not.toContain("nuget");
    expect(build).not.toContain("packages.config");

    // the parts that need administrator rights say so, and elevate themselves
    expect(source).toContain("runas");
    expect(source).toContain("administrator rights");

    // nothing the program installs needs a reboot, and it installs no driver
    expect(source).not.toContain("REBOOT");
    expect(source).not.toMatch(/pnputil|IddCx|InstallDisplayDriver/);
  });
});
