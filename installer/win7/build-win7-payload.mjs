/**
 * Makes the payload folder of the Windows 7 setup: the tools of the versions that still run on Windows 7 with Service
 * Pack 1, all 32-bit (they run on 32-bit and 64-bit Windows 7 alike), the board and its extension taken from the
 * payload of the Windows 10/11 setup, and the Windows updates the tools need.
 *
 *   node installer/win7/build-win7-payload.mjs --from <payload of the other setup> --out <folder>
 *        [--cache <folder with files already downloaded>] [--updates <folder with x86 and x64 update files>]
 *
 * A file found by name in the cache folder is used (its size and hash are recorded from the file itself); any other
 * is downloaded from the address written here. The manifest it writes is the one the setup reads.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GITHUB = "https://github.com";

/** the tools: role, the file's name, its version, where it comes from */
export const TOOLS = [
  {
    role: "browser",
    name: "chromium-109-win32.zip",
    version: "109.0.5414 (snapshot 1070081)",
    source:
      "https://commondatastorage.googleapis.com/chromium-browser-snapshots/Win/1070081/chrome-win.zip",
    alias: "chromium-109-snapshot-1070081-win32.zip",
  },
  {
    role: "node",
    name: "node-v12.22.12-win-x86.zip",
    version: "v12.22.12",
    source: "https://nodejs.org/dist/v12.22.12/node-v12.22.12-win-x86.zip",
  },
  {
    role: "java",
    name: "OpenJDK8U-jdk_x86-32_windows_hotspot_8u472b08.zip",
    version: "8u472-b08",
    source: `${GITHUB}/adoptium/temurin8-binaries/releases/download/jdk8u472-b08/OpenJDK8U-jdk_x86-32_windows_hotspot_8u472b08.zip`,
  },
  {
    role: "gcc",
    name: "winlibs-i686-posix-dwarf-gcc-16.2.0-mingw-w64msvcrt-14.0.0-r3.zip",
    version: "16.2.0 (32-bit, msvcrt)",
    source: `${GITHUB}/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-14.0.0-msvcrt-r3/winlibs-i686-posix-dwarf-gcc-16.2.0-mingw-w64msvcrt-14.0.0-r3.zip`,
  },
  {
    role: "python",
    name: "python-3.8.10.exe",
    version: "3.8.10",
    source: "https://www.python.org/ftp/python/3.8.10/python-3.8.10.exe",
  },
  {
    role: "vscode",
    // Microsoft no longer serves 1.70.3 (the last VS Code that runs on Windows 7 32-bit) from its address, so the
    // installer must be in the cache folder, taken from a copy that was kept. It is a system setup: it asks Windows
    // for an administrator once, and the setup says so before it starts it.
    name: "VSCodeSetup-ia32-1.70.3.exe",
    version: "1.70.3",
    source: null,
  },
];

/** carried over from the payload of the Windows 10/11 setup: the board and its connection to the editor */
export const FROM_OTHER = ["app", "extension"];

export const sha256File = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const download = async (url, target) => {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }

  const out = fs.createWriteStream(target);

  for await (const chunk of response.body) {
    out.write(chunk);
  }
  await new Promise((resolve) => out.end(resolve));
};

const parse = (argv) => {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--from") {
      args.from = path.resolve(argv[++i]);
    } else if (argv[i] === "--out") {
      args.out = path.resolve(argv[++i]);
    } else if (argv[i] === "--cache") {
      args.cache = path.resolve(argv[++i]);
    } else if (argv[i] === "--updates") {
      args.updates = path.resolve(argv[++i]);
    }
  }

  return args;
};

/** the update files wanted, by their KB and the architecture: the servicing stack, then the convenience rollup */
export const UPDATES = [
  { kb: "KB3020369", why: "the servicing stack the rollup needs" },
  {
    kb: "KB3125574",
    why: "the convenience rollup: the universal C runtime Python and VS Code ask for",
  },
];

export const main = async (argv) => {
  const args = parse(argv);

  if (!args.from || !args.out) {
    console.error(
      "needs --from <payload of the other setup> and --out <folder>",
    );

    return 2;
  }

  fs.mkdirSync(args.out, { recursive: true });

  const files = [];
  const add = (role, name, version, source, arch) => {
    const target = path.join(args.out, name);

    files.push({
      role,
      name,
      version,
      sha256: sha256File(target),
      size: fs.statSync(target).size,
      source,
      ...(arch ? { arch } : {}),
    });
  };

  for (const tool of TOOLS) {
    const target = path.join(args.out, tool.name);

    if (!fs.existsSync(target)) {
      const cached = [tool.name, tool.alias]
        .filter(Boolean)
        .map((n) => (args.cache ? path.join(args.cache, n) : null))
        .find((p) => p && fs.existsSync(p));

      if (cached) {
        console.log(`   have  ${tool.name} (from the cache)`);
        fs.copyFileSync(cached, target);
      } else if (!tool.source) {
        throw new Error(
          `${tool.name} is not in the cache folder (${
            args.cache ?? "none given"
          }): it can no longer be downloaded`,
        );
      } else {
        console.log(`   fetch ${tool.name}`);
        await download(tool.source, target);
      }
    }
    add(tool.role, tool.name, tool.version, tool.source);
  }

  const other = JSON.parse(
    fs.readFileSync(path.join(args.from, "manifest.json"), "utf8"),
  );

  for (const file of other.files.filter((f) => FROM_OTHER.includes(f.role))) {
    const target = path.join(args.out, file.name);

    if (!fs.existsSync(target)) {
      fs.copyFileSync(path.join(args.from, file.name), target);
    }
    add(file.role, file.name, file.version, file.source ?? null);
  }

  if (args.updates) {
    for (const arch of ["x86", "x64"]) {
      for (const update of UPDATES) {
        const found = fs
          .readdirSync(path.join(args.updates, arch))
          .find((n) => n.toLowerCase().includes(update.kb.toLowerCase()));

        if (!found) {
          throw new Error(`${update.kb} for ${arch} is not in ${args.updates}`);
        }
        fs.copyFileSync(
          path.join(args.updates, arch, found),
          path.join(args.out, found),
        );
        add("update", found, update.kb, "Microsoft Update Catalog", arch);
      }
    }
  }

  fs.writeFileSync(
    path.join(args.out, "manifest.json"),
    `${JSON.stringify(
      { schema: 1, generatedAt: new Date().toISOString(), arch: "x86", files },
      null,
      2,
    )}\n`,
  );
  console.log(`${files.length} files in ${args.out}`);

  return 0;
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(2);
    },
  );
}
