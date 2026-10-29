/**
 * AC-294 - only the denied paths are removed, and a scrubbed tree that refers to
 * a file it does not hold is refused with that file named.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkClosure } from "../closure.mjs";
import { isDenied } from "../guard.mjs";

const config = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "config.json"),
    "utf8",
  ),
);

const tree = (entries) => new Map(Object.entries(entries));

describe("AC-294 the deny list and the closure", () => {
  it("AC-294 only the denied paths are removed", () => {
    for (const denied of [
      "SPEC.md",
      "tasks/wave1.md",
      "sessions/x.md",
      ".tins/kit/bin/kit.mjs",
      "scripts/public-sync/engine.mjs",
      "docs/tins-tasks/a.md",
    ]) {
      expect(isDenied(denied, config.deny)).toBe(true);
    }

    for (const kept of [
      "README.md",
      "docs/FEATURES.md",
      "docs/OFFLINE.md",
      "packages/excalidraw/index.tsx",
      "scripts/build-node.js",
      "excalidraw-app/App.tsx",
      ".husky/pre-commit",
    ]) {
      expect(isDenied(kept, config.deny)).toBe(false);
    }
  });

  it("AC-294 a missing import fails the closure", () => {
    const missing = checkClosure(
      tree({
        "src/a.ts": 'import { b } from "./b";\nimport { c } from "./gone";\n',
        "src/b.ts": "export const b = 1;",
      }),
    );

    expect(missing).toEqual([{ file: "src/a.ts", needs: "src/gone" }]);
  });

  it("AC-294 an import that is there, as a file, an index or a partial, passes", () => {
    const missing = checkClosure(
      tree({
        "src/a.ts": [
          'import "./style.scss";',
          'import x from "./lib";',
          'import y from "../shared/util";',
          'export * from "./types";',
        ].join("\n"),
        "src/_style.scss": "a {}",
        "src/lib/index.ts": "export default 1;",
        "shared/util.ts": "export default 2;",
        "src/types.d.ts": "export {};",
      }),
    );

    expect(missing).toEqual([]);
  });

  it("AC-294 a missing asset fails the closure", () => {
    const missing = checkClosure(
      tree({
        "src/app.scss": '.a { background: url("./img/logo.png"); }',
      }),
    );

    expect(missing).toEqual([
      { file: "src/app.scss", needs: "src/img/logo.png" },
    ]);
  });

  it("AC-294 a script a package runs must be in the tree", () => {
    const missing = checkClosure(
      tree({
        "packages/a/package.json": JSON.stringify({
          scripts: { build: "node ../../scripts/build-a.js", test: "vitest" },
        }),
      }),
    );

    expect(missing).toEqual([
      { file: "packages/a/package.json", needs: "scripts/build-a.js" },
    ]);

    expect(
      checkClosure(
        tree({
          "packages/a/package.json": JSON.stringify({
            scripts: { build: "node ../../scripts/build-a.js" },
          }),
          "scripts/build-a.js": "",
        }),
      ),
    ).toEqual([]);
  });

  it("AC-294 the files the public repo owns are kept in the list of what it owns", () => {
    expect(config.publicOwned).toEqual(
      expect.arrayContaining(["README.md", "docs/FEATURES.md", "clips/"]),
    );

    // and none of them is denied: they are never overwritten, not removed
    for (const owned of config.publicOwned) {
      expect(isDenied(owned, config.deny)).toBe(false);
    }
  });
});
