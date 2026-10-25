/**
 * Build `setup.exe` - the setup as one file a teacher can double-click.
 *
 * The executable is compiled by the C# compiler that ships with Windows
 * (`csc.exe` in the .NET Framework folder), so the project gains NO
 * dependency: nothing is downloaded, nothing is installed.
 *
 *   node installer/build-setup-exe.mjs
 *
 * The result is `installer/setup.exe` and `setup.exe` beside it.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = join(HERE, "setup.exe");

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
  { file: join(HERE, "setup.ps1"), name: "setup.ps1" },
  { file: join(HERE, "setup.sh"), name: "setup.sh" },
  { file: join(HERE, "lib", "check.mjs"), name: "lib/check.mjs" },
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
execFileSync(csc, args, { stdio: "inherit", cwd: ROOT });

if (!existsSync(OUT)) {
  console.error("the compiler produced nothing");
  process.exit(1);
}

console.log(
  `  ${OUT}  ${(statSync(OUT).size / 1024).toFixed(1)} KB`,
);

// and a copy at the repository root, so it can be found
const rootCopy = join(ROOT, "setup.exe");
copyFileSync(OUT, rootCopy);
console.log(`  ${rootCopy}`);
