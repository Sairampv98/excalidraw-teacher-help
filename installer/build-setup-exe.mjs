/**
 * Build `setup.exe` - the setup as one file a teacher can double-click.
 *
 * The executable is compiled by the C# compiler that ships with Windows
 * (`csc.exe` in the .NET Framework folder), so the project gains NO
 * dependency: nothing is downloaded, nothing is installed.
 *
 *   node installer/build-setup-exe.mjs [--out <file.exe>] [--resources <dir>]
 *
 * The result is `installer/setup.exe` and `setup.exe` beside it.
 *
 * `--out` says where the executable is written, and `--resources` says where
 * the three files it carries with it come from: the release compiles the
 * executable from **scrubbed** copies of them, so the published file holds
 * nothing of the way this repository is developed.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** where the executable is written */
const outFlag = process.argv.indexOf("--out");
const OUT =
  outFlag !== -1 && process.argv[outFlag + 1]
    ? resolve(process.argv[outFlag + 1])
    : join(HERE, "setup.exe");

/** where the files the executable carries come from */
const resourcesFlag = process.argv.indexOf("--resources");
const SOURCES =
  resourcesFlag !== -1 && process.argv[resourcesFlag + 1]
    ? resolve(process.argv[resourcesFlag + 1])
    : HERE;

/** the compiler that ships with Windows */
const CSC_CANDIDATES = [
  "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe",
  "C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe",
];

const csc = CSC_CANDIDATES.find((p) => existsSync(p));

if (!csc) {
  console.error(
    "no C# compiler found - this build needs the one that ships with Windows\n" +
      "looked for:\n  " +
      CSC_CANDIDATES.join("\n  "),
  );
  process.exit(1);
}

/** the files the executable carries with it */
const RESOURCES = [
  { file: join(SOURCES, "setup.ps1"), name: "setup.ps1" },
  { file: join(SOURCES, "setup.sh"), name: "setup.sh" },
  { file: join(SOURCES, "lib", "check.mjs"), name: "lib/check.mjs" },
];

for (const r of RESOURCES) {
  if (!existsSync(r.file)) {
    console.error(`missing: ${r.file}`);
    process.exit(1);
  }
}

const args = [
  "/nologo",
  "/target:exe",
  // AnyCPU, so the executable runs on x64 AND on ARM64 Windows (where the
  // .NET Framework runs emulated). /platform:x64 here would be a real limit.
  "/platform:anycpu",
  "/optimize+",
  "/warnaserror-",
  "/out:" + OUT,
  join(HERE, "launcher", "SetupLauncher.cs"),
];

for (const r of RESOURCES) {
  args.push("/resource:" + r.file + "," + r.name);
}

console.log("compiling with " + csc);
mkdirSync(dirname(OUT), { recursive: true });
execFileSync(csc, args, { stdio: "inherit", cwd: ROOT });

if (!existsSync(OUT)) {
  console.error("the compiler produced nothing");
  process.exit(1);
}

console.log(`  ${OUT}  ${(statSync(OUT).size / 1024).toFixed(1)} KB`);

// and a copy at the repository root, so it can be found - only for the
// ordinary build: a build that was told where to write leaves the root alone
if (OUT === join(HERE, "setup.exe")) {
  const rootCopy = join(ROOT, "setup.exe");
  copyFileSync(OUT, rootCopy);
  console.log(`  ${rootCopy}`);
}
