/**
 * AC-444 - the drafts of the public README and feature list call the first
 * release's branch `v1`, and tell how the editor's window is handled today:
 * controlled from the canvas, parked, on the virtual display, and never lost
 * (D-381).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { matchesMethod } from "../scrub.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "readmes");

const read = (name) => readFileSync(join(DIR, name), "utf8");

/** the text of one section, up to the next heading of the same level or a rule */
const section = (text, title) => {
  const start = text.indexOf(title);

  if (start < 0) {
    return null;
  }

  const rest = text.slice(start + title.length);
  const end = rest.search(/\n(?:---|## )/);

  return end < 0 ? rest : rest.slice(0, end);
};

describe("AC-444 the drafts of the public texts", () => {
  it("AC-444 the first release's branch is called v1 everywhere, and its draft is named for it", () => {
    const files = readdirSync(DIR);

    expect(files).toContain("README.v1.md");
    expect(files).not.toContain("README.version-1.md");

    for (const name of files) {
      expect(read(name), name).not.toContain("version-1");
    }

    // the branch tables name it
    for (const name of [
      "README.current.md",
      "README.dev.md",
      "README.dev-draft.md",
    ]) {
      expect(read(name), name).toMatch(
        /\| `v1` \| The first release, kept as it was published/,
      );
    }

    // and the draft that is the branch's own README says so about itself
    const own = read("README.v1.md");

    expect(own).toContain("`v1` is the **first public release**");
    expect(own).toContain("`v1` - this branch -");
  });

  it("AC-444 the READMEs of the current line say how the editor's window is handled today", () => {
    for (const name of ["README.current.md", "README.dev.md"]) {
      const text = read(name);
      const body = section(
        text,
        "## The editor's window: control, parking and the virtual display",
      );

      expect(body, name).not.toBeNull();
      expect(text, name).not.toContain(
        "## The virtual display and the input panel",
      );

      // control from the canvas, in three views, without taking the focus
      expect(body).toMatch(/\*\*control\*\* it/);
      expect(body).toMatch(/\*\*whole\*\* window/);
      expect(body).toMatch(/\*\*part\*\* you pick/);
      expect(body).toMatch(/\*\*follows\*\* the pointer/);
      expect(body).toMatch(/without bringing it forward/);

      // parking, the virtual display with its scale, and that a window cannot be lost
      expect(body).toMatch(/\*\*Parking\.\*\*/);
      expect(body).toMatch(/same Windows scale/);
      expect(body).toMatch(/\*\*rescue\*\* script/);
      expect(body).toMatch(/\*\*measured\*\* rectangle/);

      // the table of features names it, and the known limits say the scale too
      expect(text).toContain("**Control, parking and the virtual display**");
      expect(text).toMatch(
        /attached\*\* \(on Windows[^)]*\), and the same Windows scale/,
      );
    }
  });

  it("AC-444 the list of features says the same, and keeps the input panel", () => {
    const text = read("FEATURES.dev.md");
    const body = section(text, "## The editor's window and the input panel");

    expect(body).not.toBeNull();
    expect(text).not.toContain("## The virtual display and the input panel");
    expect(body).toMatch(/can \*\*control\*\* it/);
    expect(body).toMatch(/\*\*parked\*\*/);
    expect(body).toMatch(/same Windows scale/);
    expect(body).toMatch(/\*\*rescue\*\* script/);
    expect(body).toMatch(/\*\*input panel\*\*/);
  });

  it("AC-444 what was written is public text: no word of the method and no decision or row number", () => {
    const written = [
      section(
        read("README.current.md"),
        "## The editor's window: control, parking and the virtual display",
      ),
      section(
        read("README.dev.md"),
        "## The editor's window: control, parking and the virtual display",
      ),
      section(
        read("FEATURES.dev.md"),
        "## The editor's window and the input panel",
      ),
    ];

    for (const body of written) {
      expect(body).not.toBeNull();
      expect(matchesMethod(body)).toBe(false);
      expect(body).not.toMatch(/\b(?:D|AC)-\d+/);
    }
  });

  it("AC-444 the folder of drafts is the one the mirror reads", () => {
    expect(existsSync(join(DIR, "README.current.md"))).toBe(true);
    expect(existsSync(join(DIR, "README.dev.md"))).toBe(true);
    expect(existsSync(join(DIR, "README.dev-draft.md"))).toBe(true);
    expect(existsSync(join(DIR, "FEATURES.dev.md"))).toBe(true);
  });
});
