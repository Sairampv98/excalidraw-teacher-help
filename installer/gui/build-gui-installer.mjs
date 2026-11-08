#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Builds the click-through installer: ONE file, ClassroomSetup.exe, that carries everything.
 *
 *   node installer/gui/build-gui-installer.mjs [--payload <dir>] [--out <folder>] [--version 2.1.1] [--no-payload]
 *
 * Three programs come out of the C# that ships with Windows (csc.exe - nothing to install):
 *   - ExcalidrawClassroom.exe   the launcher: serves the app, opens a window, a tray icon, no console
 *   - Uninstall.exe             the uninstaller (the same program as the setup, without the payload)
 *   - ClassroomSetup.exe        the wizard, with the launcher, the uninstaller and the payload inside it
 *
 * The payload is the folder `installer/offline/build-payload.mjs` makes: the app, the tools, the extension.
 * It is cut in pieces (so no piece has to be held whole in memory), as the first offline setup did.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
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

import { sha256File } from "../offline/build-payload.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

const CSC_CANDIDATES = [
  "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  "C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe",
];
const PIECE_SIZE = 16 * 1024 * 1024;

const SOURCES = {
  launcher: [
    "Common.cs",
    "Server.cs",
    "Download.cs",
    "ZipLite.cs",
    "Launcher.cs",
  ],
  setup: [
    "Common.cs",
    "Server.cs",
    "Download.cs",
    "ZipLite.cs",
    "Engine.cs",
    "Wizard.cs",
    "SelfTest.cs",
    "Program.cs",
  ],
};
const REFERENCES = [
  "System.Web.Extensions.dll",
  "System.IO.Compression.dll",
  "System.IO.Compression.FileSystem.dll",
  "System.Windows.Forms.dll",
  "System.Drawing.dll",
];

export const findCsc = () => CSC_CANDIDATES.find((p) => existsSync(p)) ?? null;

/**
 * The Windows 7 build: the .NET 3.5 compiler (C# 3), which is what Windows 7 with Service Pack 1 has, and the symbol
 * NET35, which switches the few places that need .NET 4 (zip files, Path.Combine of many parts...) to their own code.
 */
const CSC35_CANDIDATES = [
  "C:/Windows/Microsoft.NET/Framework64/v3.5/csc.exe",
  "C:/Windows/Microsoft.NET/Framework/v3.5/csc.exe",
];

export const findCsc35 = () =>
  CSC35_CANDIDATES.find((p) => existsSync(p)) ?? null;
const REFERENCES35 = [
  "System.Web.Extensions.dll",
  "System.Core.dll",
  "System.Windows.Forms.dll",
  "System.Drawing.dll",
];

/** the version of the program: three numbers, in an attribute the compiler reads */
const versionSource = (version) =>
  `using System.Reflection;\n[assembly: AssemblyVersion("${version}.0")]\n[assembly: AssemblyTitle("Excalidraw Classroom")]\n[assembly: AssemblyProduct("Excalidraw Classroom")]\n`;

/** compiles one program; `resources` are [file, name] pairs carried inside it */
export const compile = ({
  csc,
  out,
  target,
  sources,
  version,
  resources = [],
  net35 = false,
}) => {
  mkdirSync(dirname(out), { recursive: true });

  const versionFile = join(dirname(out), `.version-${version}.cs`);

  writeFileSync(versionFile, versionSource(version), "utf8");

  const args = [
    "/nologo",
    `/target:${target}`,
    "/platform:anycpu",
    "/optimize+",
    "/warnaserror-",
    `/out:${out}`,
    `/win32icon:${join(ROOT, "public", "favicon.ico")}`,
    `/win32manifest:${join(HERE, "app.manifest")}`,
    ...(net35 ? ["/define:NET35"] : []),
    ...(net35 ? REFERENCES35 : REFERENCES).map((r) => `/reference:${r}`),
    ...resources.map(([file, name]) => `/resource:${file},${name}`),
    versionFile,
    ...sources.map((s) => join(HERE, s)),
  ];

  try {
    execFileSync(csc, args, { stdio: "inherit", cwd: ROOT });
  } finally {
    rmSync(versionFile, { force: true });
  }
};

const copyBytes = (from, to, offset, length) =>
  pipeline(
    createReadStream(from, { start: offset, end: offset + length - 1 }),
    createWriteStream(to),
  );

const parseArgs = (argv) => {
  const args = {
    payload: join(ROOT, "installer", "offline", "payload"),
    out: join(HERE, "dist"),
    version: "2.1.1",
    withPayload: true,
    online: null,
    win7: false,
    folder: false,
    edition: "classroom",
    name: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--payload") {
      args.payload = resolve(argv[++i]);
    } else if (argv[i] === "--out") {
      args.out = resolve(argv[++i]);
    } else if (argv[i] === "--version") {
      args.version = argv[++i];
    } else if (argv[i] === "--no-payload") {
      args.withPayload = false;
    } else if (argv[i] === "--folder") {
      args.folder = true;
    } else if (argv[i] === "--win7") {
      args.win7 = true;
    } else if (argv[i] === "--online") {
      args.online = resolve(argv[++i]);
      args.withPayload = false;
    } else if (argv[i] === "--edition") {
      args.edition = argv[++i];
    } else if (argv[i] === "--name") {
      args.name = argv[++i];
    }
  }

  return args;
};

export const main = async (argv) => {
  const args = parseArgs(argv);
  const csc = args.win7 ? findCsc35() : findCsc();

  if (!csc) {
    console.error(
      "no C# compiler found: this build needs the one that ships with Windows",
    );

    return 2;
  }

  const work = join(args.out, ".work");

  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  // the student setup carries the tools alone: no board, so no launcher; and a resource that says so
  const student = args.edition === "student";
  const editionFile = join(work, "edition.json");

  writeFileSync(editionFile, JSON.stringify({ edition: args.edition }), "utf8");

  const launcher = join(work, "ExcalidrawClassroom.exe");

  if (!student) {
    console.log("1. the launcher");
    compile({
      csc,
      out: launcher,
      net35: args.win7,
      target: "winexe",
      sources: SOURCES.launcher,
      version: args.version,
    });
  }

  console.log("2. the uninstaller");

  const uninstall = join(work, "Uninstall.exe");

  compile({
    csc,
    out: uninstall,
    net35: args.win7,
    target: "winexe",
    sources: SOURCES.setup,
    version: args.version,
    resources: student ? [[editionFile, "edition.json"]] : [],
  });

  console.log("3. the setup");

  const resources = [[uninstall, "uninstall.exe"]];

  if (student) {
    resources.push([editionFile, "edition.json"]);
  } else {
    resources.push([launcher, "launcher.exe"]);
  }
  const pieces = [];

  if (args.withPayload && !args.folder) {
    if (!existsSync(args.payload)) {
      console.error(
        `there is no payload at ${args.payload}\nbuild it first: node installer/offline/build-payload.mjs`,
      );

      return 2;
    }

    const names = readdirSync(args.payload)
      .filter((name) => !name.startsWith("."))
      .sort((a, b) =>
        a === "manifest.json"
          ? -1
          : b === "manifest.json"
          ? 1
          : a.localeCompare(b),
      );
    const files = [];
    let number = 0;

    for (const name of names) {
      const path = join(args.payload, name);
      const size = statSync(path).size;
      const chunks = [];
      let offset = 0;

      do {
        const pieceName = `payload.${String(number++).padStart(4, "0")}`;
        const piece = join(work, `${pieceName}.part`);
        const length = Math.min(PIECE_SIZE, size - offset);

        await copyBytes(path, piece, offset, length);
        resources.push([piece, pieceName]);
        pieces.push(piece);
        chunks.push(pieceName);
        offset += length;
      } while (offset < size);

      files.push({ name, size, sha256: sha256File(path), chunks });
    }

    const index = join(work, "payload.index.json");

    writeFileSync(
      index,
      JSON.stringify({ schema: 1, pieceSize: PIECE_SIZE, files }, null, 2),
      "utf8",
    );
    resources.push([index, "payload.index.json"]);
    console.log(
      `   the payload is ${files.length} file(s) in ${pieces.length} piece(s)`,
    );
  } else if (args.folder) {
    // the payload stays as files beside the setup (copied after the compile): the setup is small
    if (!existsSync(join(args.payload, "manifest.json"))) {
      console.error(`there is no payload at ${args.payload}`);

      return 2;
    }
    console.log("   the payload stays as files in a folder beside the setup");
  } else if (args.online) {
    // the online setup carries a list of addresses with a size and a hash for each file, and no file
    resources.push([args.online, "online.json"]);
    console.log(`   the online list: ${args.online}`);
  } else {
    console.log("   WITHOUT a payload (it says so when it runs)");
  }

  const setup = join(
    args.out,
    args.name ??
      (args.win7
        ? student
          ? "ClassTools-Win7.exe"
          : "ClassroomSetup-Win7.exe"
        : student
        ? args.online
          ? "ClassTools-Online.exe"
          : "ClassTools-Setup.exe"
        : args.online
        ? "ClassroomSetup-Online.exe"
        : "ClassroomSetup.exe"),
  );

  compile({
    csc,
    out: setup,
    net35: args.win7,
    target: "winexe",
    sources: SOURCES.setup,
    version: args.version,
    resources,
  });
  if (args.folder) {
    const target = join(args.out, "payload");

    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(args.payload).filter(
      (n) => !n.startsWith("."),
    )) {
      copyFileSync(join(args.payload, name), join(target, name));
    }
    console.log(`   the payload is in ${target}`);
  }
  rmSync(work, { recursive: true, force: true });

  console.log(
    `\n${setup}  ${(statSync(setup).size / 1024 / 1024).toFixed(1)} MB`,
  );

  return 0;
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(2);
    },
  );
}
