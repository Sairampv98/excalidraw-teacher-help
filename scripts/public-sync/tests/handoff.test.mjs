/**
 * AC-436 - the handoff file exists in the shape the next session needs, is
 * never mirrored, and is pointed at by the two files every session reads.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isDenied } from "../guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

const read = (relative) => readFileSync(join(root, relative), "utf8");

const config = JSON.parse(read("scripts/public-sync/config.json"));

const next = read("docs/next.md");

/** the text of one `##` section, up to the next `##` heading */
const section = (title) => {
  const lines = next.split("\n");
  const start = lines.findIndex((line) => line === `## ${title}`);

  if (start < 0) {
    return null;
  }

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));

  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
};

describe("AC-436 the handoff file", () => {
  it("AC-436 has its sections in order and says how to resume", () => {
    const headings = next
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).replace(/\(\d{4}-\d{2}-\d{2}\)/, "(DATE)"));

    expect(headings).toEqual([
      "How to resume",
      "Where things stand (DATE)",
      "Work queue",
      "Ideas inbox",
      "Rules that always apply",
    ]);

    // the words a person pastes to a new session, and the state it starts from
    expect(section("How to resume")).toContain("Continue: read docs/next.md.");
    expect(next).toMatch(/Private `main`: `[0-9a-f]{7,40}`/);
  });

  it("AC-436 every item of the work queue has a status, and one is next", () => {
    const queue = section("Work queue");

    expect(queue).not.toBeNull();

    const items = queue
      .split("\n")
      .filter((line) => line.startsWith("### "))
      .map((line) => line.slice(4));

    expect(items.length).toBeGreaterThanOrEqual(3);

    for (const item of items) {
      expect(item).toMatch(/ - (DONE|NEXT|HELD|DROPPED)(?: \(.*\))?$/);
    }

    expect(items.some((item) => / - NEXT\b/.test(item))).toBe(true);
  });

  it("AC-436 is never mirrored to the public repository", () => {
    expect(config.deny).toContain("docs/next.md");
    expect(isDenied("docs/next.md", config.deny)).toBe(true);

    // and it does not drag the public docs folder down with it
    expect(isDenied("docs/FEATURES.md", config.deny)).toBe(false);
  });

  it("AC-436 CLAUDE.md and AGENTS.md send a session to it first", () => {
    for (const file of ["CLAUDE.md", "AGENTS.md"]) {
      const text = read(file);

      // before anything else: the first line after the title
      const title = text.split("\n")[0];
      const afterTitle = text
        .slice(title.length)
        .split("\n")
        .find((line) => line.trim() !== "");

      expect(afterTitle).toContain("docs/next.md");
    }
  });
});
