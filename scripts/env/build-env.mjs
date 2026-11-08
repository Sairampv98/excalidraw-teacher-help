#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * The build environment: what the computer that builds this project has, written down, so that the same
 * environment can be made again on another computer.
 *
 *   node scripts/env/build-env.mjs                 print what this computer has
 *   node scripts/env/build-env.mjs --write         write it to docs/build-env.json (done at each release)
 *   node scripts/env/build-env.mjs --check         compare this computer with docs/build-env.json: exit 1 on a difference that matters
 *
 * "A difference that matters" is a tool that is missing, or a different major version (the Node and the .NET
 * compiler decide what can be built); a different patch version is only said.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
export const RECORD = path.join(ROOT, "docs", "build-env.json");

/** the tools the builds need, and how each says its version */
export const TOOLS = [
  {
    id: "node",
    why: "everything: the app, the builders, the gate",
    cmd: "node",
    args: ["--version"],
  },
  {
    id: "yarn",
    why: "installs the packages, runs the app and the tests",
    cmd: "yarn",
    args: ["--version"],
    alt: ["%APPDATA%\\npm\\yarn.cmd"],
  },
  {
    id: "git",
    why: "the repository, the sessions, the public mirror",
    cmd: "git",
    args: ["--version"],
  },
  {
    id: "ffmpeg",
    why: "the clips and the GIF",
    cmd: "ffmpeg",
    args: ["-version"],
    alt: ["C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe"],
  },
  {
    id: "python",
    why: "downloads the wheels of the Indra reader (pip download)",
    cmd: "python",
    args: ["--version"],
  },
  {
    id: "powershell",
    why: "the proofs of the installers and the control of the virtual machines",
    cmd: "powershell",
    args: ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
  },
  {
    id: "csc",
    why: "compiles the installers (the C# compiler that ships with Windows)",
    cmd: "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
    args: ["/version"],
    anyStatus: true,
  },
];

/** the first thing that looks like a version in a line of text */
export const parseVersion = (text) => {
  const match = String(text).match(/(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?/);

  return match ? match.slice(1).filter(Boolean).join(".") : null;
};

export const major = (version) =>
  version ? Number(String(version).split(".")[0]) : null;

/**
 * What differs between the recorded environment and this one: a list of
 * { id, kind: "missing" | "major" | "version", recorded, found }.
 * `missing` and `major` matter; `version` is only said.
 */
export const compareEnv = (recorded, found) => {
  const differences = [];

  for (const [id, was] of Object.entries(recorded.tools ?? {})) {
    const now = found.tools?.[id];

    if (!now || !now.version) {
      differences.push({
        id,
        kind: "missing",
        recorded: was.version,
        found: null,
      });
    } else if (major(was.version) !== major(now.version)) {
      differences.push({
        id,
        kind: "major",
        recorded: was.version,
        found: now.version,
      });
    } else if (was.version !== now.version) {
      differences.push({
        id,
        kind: "version",
        recorded: was.version,
        found: now.version,
      });
    }
  }

  return differences;
};

export const matters = (difference) => difference.kind !== "version";

const run = (cmd, args, anyStatus = false) => {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: false,
    timeout: 30_000,
  });

  // a compiler may answer `/version` with a code that is not 0 and still say its version
  if (result.error || (result.status !== 0 && !anyStatus)) {
    return null;
  }

  return (
    `${result.stdout}${result.stderr}`
      .split(/\r?\n/)
      .find((line) => line.trim()) ?? null
  );
};

const probe = (tool) => {
  const candidates = [
    tool.cmd,
    ...(tool.alt ?? []).map((a) =>
      a.replace("%APPDATA%", process.env.APPDATA ?? ""),
    ),
  ];

  for (const candidate of candidates) {
    // yarn is a .cmd on Windows
    const line =
      run(candidate, tool.args, tool.anyStatus) ??
      (process.platform === "win32"
        ? run("cmd", ["/c", candidate, ...tool.args], tool.anyStatus)
        : null);

    if (line) {
      return {
        version: parseVersion(line),
        says: line.trim().slice(0, 120),
        at: candidate,
      };
    }
  }

  return { version: null, says: null, at: null };
};

const fileSha = (file) =>
  fs.existsSync(file)
    ? createHash("sha256").update(fs.readFileSync(file)).digest("hex")
    : null;

const browser = () => {
  const names = [
    process.env.UI_BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  const found = names.find((n) => fs.existsSync(n));

  if (!found) {
    return { version: null, at: null };
  }

  const line = run("powershell", [
    "-NoProfile",
    "-Command",
    `(Get-Item '${found}').VersionInfo.ProductVersion`,
  ]);

  return { version: parseVersion(line), at: found };
};

/** the release number of the .NET Framework 4 (528040 and above is 4.8) */
const dotNetRelease = () => {
  const result = spawnSync(
    "reg",
    [
      "query",
      "HKLM\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full",
      "/v",
      "Release",
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  const match = String(result.stdout).match(
    /Release\s+REG_DWORD\s+0x([0-9a-fA-F]+)/,
  );

  return match ? parseInt(match[1], 16) : null;
};

const packageVersion = (name) => {
  const file = path.join(ROOT, "node_modules", name, "package.json");

  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8")).version
    : null;
};

export const capture = () => {
  const tools = Object.fromEntries(
    TOOLS.map((tool) => [tool.id, { ...probe(tool), why: tool.why }]),
  );

  tools.node = {
    ...tools.node,
    version: parseVersion(process.version),
    at: process.execPath,
    why: TOOLS[0].why,
  };
  tools.browser = {
    ...browser(),
    why: "the UI gate and the clips drive the real browser of the computer (nothing is downloaded)",
  };

  let head = null;

  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    // not a checkout
  }

  return {
    capturedAt: new Date().toISOString(),
    machine: {
      os: `${os.type()} ${os.release()}`,
      windowsVersion: run("cmd", ["/c", "ver"]),
      arch: os.arch(),
      cpus: os.cpus().length,
      memoryGB: Math.round(os.totalmem() / 1024 ** 3),
      dotNetFrameworkRelease: dotNetRelease(),
    },
    tools,
    packages: {
      "playwright-core": packageVersion("playwright-core"),
      vite: packageVersion("vite"),
      vitest: packageVersion("vitest"),
      typescript: packageVersion("typescript"),
    },
    lockfileSha256: fileSha(path.join(ROOT, "yarn.lock")),
    repositoryHead: head,
  };
};

export const main = (argv) => {
  const now = capture();

  if (argv.includes("--write")) {
    fs.writeFileSync(RECORD, `${JSON.stringify(now, null, 2)}\n`);
    console.log(`written: ${path.relative(ROOT, RECORD)}`);

    return 0;
  }

  if (argv.includes("--check")) {
    if (!fs.existsSync(RECORD)) {
      console.log("there is no record yet: run with --write");

      return 1;
    }

    const differences = compareEnv(
      JSON.parse(fs.readFileSync(RECORD, "utf8")),
      now,
    );

    for (const d of differences) {
      console.log(
        `${matters(d) ? "DIFFERENT" : "note     "}  ${d.id}: recorded ${
          d.recorded ?? "-"
        }, here ${d.found ?? "missing"} (${d.kind})`,
      );
    }
    console.log(
      differences.some(matters)
        ? "this computer is not the recorded build environment"
        : "this computer matches the recorded build environment",
    );

    return differences.some(matters) ? 1 : 0;
  }

  console.log(JSON.stringify(now, null, 2));

  return 0;
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main(process.argv.slice(2)));
}
