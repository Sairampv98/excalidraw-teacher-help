#!/usr/bin/env node
/**
 * Build the offline setup - the setup as ONE file that carries its payload.
 *
 * The executable is compiled by the C# compiler that ships with Windows
 * (`csc.exe` in the .NET Framework folder), so the project gains NO
 * dependency: nothing is downloaded, nothing is installed.
 *
 *   node installer/offline/build-offline-setup.mjs [--payload <dir>] [--out <file>]
 *
 * The payload is CARRIED IN PIECES, and the pieces are resources of the
 * executable: `payload.NNNN`, each one a few megabytes, with an index
 * (`payload.index.json`) saying which pieces make up which file.
 *
 * Why pieces and not one big zip: the payload is about 780 MB. A single
 * resource that size has to be held in memory by the runtime, and the disk
 * would have to hold it twice - once as the resource, once unpacked. On a
 * small machine (a Sandbox with 2 GB of RAM and a small disk) that fails. In
 * pieces, the program writes each file out ONCE, straight to the payload
 * folder, and checks its SHA-256 as it goes.
 *
 * The payload is BUILD OUTPUT. It is not in the repository - it is built by
 * `installer/offline/build-payload.mjs`.
 */
import { execFileSync } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { sha256File } from "./build-payload.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

/** the compiler that ships with Windows */
const CSC_CANDIDATES = [
  "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  "C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe",
];

/** how big one piece is. Small enough to be held in memory on any machine. */
const PIECE_SIZE = 16 * 1024 * 1024;

const SOURCE = join(HERE, "OfflineSetup.cs");
const DEFAULT_OUT = join(HERE, "OfflineSetup.exe");
const DEFAULT_PAYLOAD = join(HERE, "payload");

/** the arguments this script was given */
const parseArgs = (argv) => {
  const args = {
    payload: DEFAULT_PAYLOAD,
    out: DEFAULT_OUT,
    withPayload: true,
  };

  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--payload") {
      args.payload = resolve(argv[++index]);
    } else if (argv[index] === "--out") {
      args.out = resolve(argv[++index]);
    } else if (argv[index] === "--no-payload") {
      args.withPayload = false;
    }
  }

  return args;
};

/** Copy a part of a file into another file. */
const copyBytes = async (from, to, offset, length) =>
  pipeline(
    createReadStream(from, { start: offset, end: offset + length - 1 }),
    createWriteStream(to),
  );

const args = parseArgs(process.argv.slice(2));

if (!existsSync(SOURCE)) {
  console.error("missing: " + SOURCE);
  process.exit(1);
}

const csc = CSC_CANDIDATES.find((p) => existsSync(p));

if (!csc) {
  console.error(
    "no C# compiler found - this build needs the one that ships with Windows\n" +
      "looked for:\n  " +
      CSC_CANDIDATES.join("\n  "),
  );
  process.exit(1);
}

const cscArgs = [
  "/nologo",
  "/target:exe",
  // AnyCPU, so the executable runs on x64 AND on ARM64 Windows (where the
  // .NET Framework runs emulated). /platform:x64 here would be a real limit.
  "/platform:anycpu",
  "/optimize+",
  "/warnaserror-",
  "/out:" + args.out,
  SOURCE,
];

// the two framework assemblies the program uses: the JSON reader and the zip
// reader. Both ship with Windows, so the project still gains no dependency.
cscArgs.push("/reference:System.Web.Extensions.dll");
cscArgs.push("/reference:System.IO.Compression.dll");
cscArgs.push("/reference:System.IO.Compression.FileSystem.dll");

const pieceFiles = [];

if (args.withPayload) {
  if (!existsSync(args.payload)) {
    console.error(
      "there is no payload at " +
        args.payload +
        "\nbuild it first:\n  node installer/offline/build-payload.mjs",
    );
    process.exit(1);
  }

  const names = readdirSync(args.payload)
    .filter((name) => !name.startsWith("."))
    .sort();

  // the manifest comes first: it is what the other files are checked against
  names.sort((a, b) =>
    a === "manifest.json" ? -1 : b === "manifest.json" ? 1 : a.localeCompare(b),
  );

  const files = [];
  let pieceNumber = 0;

  for (const name of names) {
    const path = join(args.payload, name);
    const size = statSync(path).size;
    const chunks = [];
    let offset = 0;

    do {
      const pieceName = "payload." + String(pieceNumber++).padStart(4, "0");
      const piecePath = join(dirname(args.out), pieceName + ".part");
      const length = Math.min(PIECE_SIZE, size - offset);

      await copyBytes(path, piecePath, offset, length);

      cscArgs.push("/resource:" + piecePath + "," + pieceName);
      pieceFiles.push(piecePath);
      chunks.push(pieceName);
      offset += length;
    } while (offset < size);

    files.push({ name, size, sha256: sha256File(path), chunks });
  }

  // the index: which pieces make up which file
  const index = { schema: 1, pieceSize: PIECE_SIZE, files };
  const indexPath = join(dirname(args.out), "payload.index.json");

  mkdirSync(dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
  cscArgs.push("/resource:" + indexPath + ",payload.index.json");

  console.log(
    "the payload is " +
      files.length +
      " file(s) in " +
      pieceFiles.length +
      " piece(s)",
  );
} else {
  console.log("building WITHOUT a payload (it will say so when it runs)");
}

mkdirSync(dirname(args.out), { recursive: true });

console.log("compiling with " + csc);

try {
  execFileSync(csc, cscArgs, { stdio: "inherit", cwd: ROOT });
} finally {
  // the pieces have done their work: they are inside the executable now
  for (const piece of pieceFiles) {
    rmSync(piece, { force: true });
  }
}

if (!existsSync(args.out)) {
  console.error("the compiler produced nothing");
  process.exit(1);
}

console.log(
  `  ${args.out}  ${(statSync(args.out).size / 1024 / 1024).toFixed(1)} MB`,
);
