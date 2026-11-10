/* eslint-disable no-console */
/**
 * Looks in the files of a release for what must not be published (the words and ids of the way this repository is
 * developed, secrets, a person's own folders), with the same rules as the public mirror.
 *
 *   node scripts/release/scan-release.mjs <folder with the release files>
 *
 * It reads the text files inside the zips and the vsix, and the strings of the programs (the first megabytes of a
 * setup are its own code; the rest is the files it carries, which are scanned as the zips they are).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The rules this scan holds the files against are the leak guard's, and the guard is not part of the published tree
// (it lists the words that must not be published). So they are loaded when they are there, and when they are not (a
// copy of the published tree) the scan says so and stops, instead of failing on a missing file.
const guardFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public-sync",
  "guard.mjs",
);
const guard = fs.existsSync(guardFile)
  ? await import(pathToFileURL(guardFile).href)
  : null;

const needGuard = () => {
  if (!guard) {
    throw new Error(
      "the leak rules (scripts/public-sync/guard.mjs) are not in this tree: run this scan from the tree the releases are made in",
    );
  }

  return guard;
};
const scanText = (...args) => needGuard().scanText(...args);
const describeFinding = (...args) => needGuard().describeFinding(...args);

const isText = (buffer) => !buffer.subarray(0, 8000).includes(0);

/** the printable strings of a program, ASCII and UTF-16 (what a C# program keeps its text in) */
export const stringsOf = (buffer) => {
  const out = [];
  const ascii = buffer.toString("latin1");

  for (const m of ascii.matchAll(/[\x20-\x7e]{8,}/g)) {
    out.push(m[0]);
  }

  // UTF-16 text may start on an odd or an even byte: both are read
  for (const start of [0, 1]) {
    const wide = buffer.subarray(start).toString("utf16le");

    for (const m of wide.matchAll(/[ -~]{8,}/g)) {
      out.push(m[0]);
    }
  }

  return out.join("\n");
};

/** the files of a zip, unpacked by the tar that ships with Windows (it reads every zip), and their text scanned */
const scanZip = (file, label, findings) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "scan-release-"));

  try {
    execFileSync(
      path.join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe"),
      ["-x", "-f", file, "-C", folder],
      {
        stdio: "ignore",
      },
    );

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(full);
        } else if (
          !/.(zip|vsix|wasm|png|jpg|gif|webp|mp4|webm|woff2?|ttf|onnx|whl)$/i.test(
            entry.name,
          )
        ) {
          const buffer = fs.readFileSync(full);

          if (isText(buffer)) {
            findings.push(
              ...scanText(
                `${label}!${path.relative(folder, full)}`,
                buffer.toString("utf8"),
              ),
            );
          }
        }
      }
    };

    walk(folder);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
};

export const scanRelease = (folder) => {
  const findings = [];

  for (const name of fs.readdirSync(folder)) {
    const file = path.join(folder, name);

    if (name.startsWith("SHA256SUMS")) {
      continue;
    }
    if (name === "app.zip" || name.endsWith(".vsix")) {
      scanZip(file, name, findings);
    } else if (name.endsWith(".exe")) {
      const head = Buffer.alloc(
        Math.min(fs.statSync(file).size, 3 * 1024 * 1024),
      );
      const fd = fs.openSync(file, "r");

      fs.readSync(fd, head, 0, head.length, 0);
      fs.closeSync(fd);
      findings.push(...scanText(name, stringsOf(head)));
    }
  }

  return findings;
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const folder = process.argv[2];

  if (!folder) {
    console.error("needs the folder of the release files");
    process.exit(2);
  }

  const findings = scanRelease(path.resolve(folder));

  for (const finding of findings.slice(0, 60)) {
    console.log(describeFinding(finding));
  }
  console.log(`${findings.length} finding(s)`);
  process.exit(findings.length ? 1 : 0);
}
