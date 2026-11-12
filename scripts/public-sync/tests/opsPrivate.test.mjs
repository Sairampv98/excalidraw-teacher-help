/**
 * AC-688 - the tools of the gate and the watcher stay private (D-591).
 *
 * `scripts/ops/` is the workflow of the project: it talks about gates, sessions
 * and the kit, so the mirror does not publish it (the leak guard refuses it
 * otherwise), just as it does not publish `scripts/tins-gate.mjs` that uses it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isDenied } from "../guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const config = JSON.parse(
  readFileSync(join(root, "scripts/public-sync/config.json"), "utf8"),
);

const filesUnder = (dir) =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(`${dir}/${entry.name}`)
      : [`${dir}/${entry.name}`],
  );

describe("AC-688 the gate's tools are not mirrored", () => {
  it("the deny list names the folder, and every file in it is denied", () => {
    expect(config.deny).toContain("scripts/ops/");

    const files = filesUnder("scripts/ops");

    expect(files.length).toBeGreaterThan(5);

    for (const file of files) {
      expect(isDenied(file, config.deny)).toBe(true);
    }
  });

  it("the gate that uses them is denied too, so nothing published refers to them", () => {
    expect(isDenied("scripts/tins-gate.mjs", config.deny)).toBe(true);
    expect(isDenied("scripts/ui/run.mjs", config.deny)).toBe(false);
  });
});
