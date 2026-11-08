/**
 * AC-564 - the release publisher: what it reads from its arguments and from a list of sums, and what it refuses.
 * AC-565 - everything that makes the setups, the clips, the proofs and the releases is in the repository, and none
 * of it is tied to one machine.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseArgs,
  problemsWith,
  readSums,
  repoFromUrl,
} from "../publish-release.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

describe("AC-564 the release publisher", () => {
  it("AC-564 reads its arguments, and the clone is beside this repository unless it is named", () => {
    const args = parseArgs([
      "--tag",
      "v2.1.1",
      "--notes",
      "n.md",
      "--dir",
      "out",
      "--check",
    ]);

    expect(args.tag).toBe("v2.1.1");
    expect(args.check).toBe(true);
    expect(args.remote).toBe("github-public");
    expect(path.basename(args.clone)).toBe("excalidraw-public");
    expect(parseArgs(["--clone", "x", "--remote", "pub"]).remote).toBe("pub");
  });

  it("AC-564 refuses a tag that is not a version, and a missing notes file or folder", () => {
    expect(problemsWith(parseArgs([]))).toHaveLength(3);
    expect(
      problemsWith(
        parseArgs(["--tag", "latest", "--notes", "n", "--dir", "d"]),
      ),
    ).toHaveLength(1);
    expect(
      problemsWith(
        parseArgs(["--tag", "v2.1.1", "--notes", "n", "--dir", "d"]),
      ),
    ).toEqual([]);
    expect(
      problemsWith(
        parseArgs(["--tag", "v3.0.0-rc.1", "--notes", "n", "--dir", "d"]),
      ),
    ).toEqual([]);
  });

  it("AC-564 finds the repository in a GitHub address, https or ssh, with or without .git", () => {
    expect(repoFromUrl("https://github.com/owner/name.git")).toBe("owner/name");
    expect(repoFromUrl("https://github.com/owner/name")).toBe("owner/name");
    expect(repoFromUrl("git@github.com:owner/name.git")).toBe("owner/name");
    expect(repoFromUrl("https://example.com/owner/name")).toBeNull();
  });

  it("AC-564 reads a list of sums: a hash, a name, a star before the name is allowed, a name may hold a space", () => {
    const sums = readSums(
      "ABC123  setup.exe\n def456 *OfflineSetup.exe\n0a1b  a file.zip\n",
    );

    expect(sums).toEqual({
      "setup.exe": "abc123",
      "OfflineSetup.exe": "def456",
      "a file.zip": "0a1b",
    });
  });
});

/** the files of the repository that make things (the setups, the clips, the proofs, the releases, the machines) */
const MAKERS = [
  "installer",
  "scripts/ui",
  "scripts/clips",
  "scripts/vendor",
  "scripts/release",
  "scripts/env",
];
const TEXT = /\.(mjs|cjs|js|ts|cs|ps1|bat|cmd|xml|md|json|manifest)$/i;
const SKIP =
  /(^|[\\/])(node_modules|payload|dist|\.work|\.build|\.out)([\\/]|$)/;

const walk = (folder) => {
  const found = [];

  if (!fs.existsSync(folder)) {
    return found;
  }

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);

    if (SKIP.test(full)) {
      continue;
    }
    if (entry.isDirectory()) {
      found.push(...walk(full));
    } else if (TEXT.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
};

describe("AC-565 what makes the setups, the clips and the proofs is here, and is not tied to one machine", () => {
  const files = MAKERS.flatMap((folder) => walk(path.join(ROOT, folder)));

  it("AC-565 the builders, the recorder, the gate, the proofs and the release script are in the repository", () => {
    const names = files.map((file) =>
      path.relative(ROOT, file).replaceAll("\\", "/"),
    );

    for (const needed of [
      "installer/gui/build-gui-installer.mjs",
      "installer/gui/tests/e2e-install.ps1",
      "installer/offline/build-payload.mjs",
      "scripts/clips/run.mjs",
      "scripts/ui/run.mjs",
      "scripts/vendor/engines.mjs",
      "scripts/release/publish-release.mjs",
      "scripts/env/build-env.mjs",
      "installer/win7/vm/vm-type.ps1",
      "installer/win7/vm/vm-click.ps1",
      "installer/win7/vm/vm-shot.ps1",
      "installer/win7/vm/Autounattend.xml",
      "installer/win7/portable/start.bat",
      "installer/win7/portable/serve.ps1",
    ]) {
      expect(names, needed).toContain(needed);
    }
  });

  it("AC-565 none of them names a folder of one person's machine", () => {
    const tied = [];

    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");

      if (
        /[A-Za-z]:[\\/](Users|workspace)[\\/]/i.test(text) ||
        /NIT{2}E/.test(text)
      ) {
        tied.push(path.relative(ROOT, file));
      }
    }

    expect(tied).toEqual([]);
  });
});
