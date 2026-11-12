/**
 * AC-691 - the pre-gate warns where the public wording is missing or stale (D-594).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  missingPublicSection,
  pairsOf,
  stalePartners,
  unpairedComments,
  warningsForFile,
} from "../lib/publicLingo.mjs";

const lines = (...rows) => `${rows.join("\n")}\n`;
const here = path.dirname(fileURLToPath(import.meta.url));

describe("AC-691 the pairs of a file", () => {
  it("are found in // runs, # runs and block comments, with the private text above each", () => {
    expect(
      pairsOf(
        "a.mjs",
        lines(
          "const a = 1;",
          "// Private note about the kit.",
          "// public: A plain note.",
        ),
      ),
    ).toEqual([
      { private: "Private note about the kit.", public: "A plain note." },
    ]);

    expect(
      pairsOf("a.yml", lines("# Run by the kit.", "# public: Run at the end.")),
    ).toEqual([{ private: "Run by the kit.", public: "Run at the end." }]);

    expect(
      pairsOf(
        "a.ts",
        lines(
          "/**",
          " * Kept by the kit",
          " * and its rows.",
          " * public: Kept for later.",
          " */",
        ),
      ),
    ).toEqual([
      { private: "Kept by the kit and its rows.", public: "Kept for later." },
    ]);
  });

  it("have nothing above a partner that starts a comment, and none are made up", () => {
    expect(pairsOf("a.mjs", lines("// public: Alone."))).toEqual([]);
    expect(pairsOf("a.mjs", lines("// Just a comment."))).toEqual([]);
  });

  it("stop at a blank comment line", () => {
    expect(
      pairsOf(
        "a.mjs",
        lines("// Safe.", "//", "// The kit.", "// public: The tool."),
      ),
    ).toEqual([{ private: "The kit.", public: "The tool." }]);
  });
});

describe("AC-691 a comment that names the method and has no public wording", () => {
  const params = (oldText, newText) => ({
    path: "a.mjs",
    oldText,
    newText,
  });

  it("is reported when this change added it", () => {
    expect(
      unpairedComments(
        params(
          lines("const a = 1;"),
          lines("const a = 1;", "// Run by the kit at close."),
        ),
      ),
    ).toEqual(["Run by the kit at close."]);
  });

  it("is not reported when it has a partner", () => {
    expect(
      unpairedComments(
        params(
          "",
          lines("// Run by the kit at close.", "// public: Run at the end."),
        ),
      ),
    ).toEqual([]);
  });

  it("is not reported when it was there before: old debt is not this change's", () => {
    const text = lines("// Run by the kit at close.", "const a = 1;");

    expect(unpairedComments(params(text, `${text}const b = 2;\n`))).toEqual([]);
  });

  it("is not reported when the map already holds it", () => {
    expect(
      unpairedComments({
        path: "a.mjs",
        oldText: "",
        newText: lines("// Run by the kit at close."),
        map: { sentences: { "Run by the kit at close.": "Run at the end." } },
      }),
    ).toEqual([]);
  });

  it("a new file with nothing to say gives nothing", () => {
    expect(unpairedComments(params(undefined, lines("const a = 1;")))).toEqual(
      [],
    );
  });
});

describe("AC-691 a partner that went stale", () => {
  it("is found when the private comment changed and the public line did not", () => {
    const oldText = lines(
      "// Run by the kit at close.",
      "// public: Run at the end.",
    );
    const newText = lines(
      "// Run by the kit before the merge.",
      "// public: Run at the end.",
    );

    expect(stalePartners({ path: "a.mjs", oldText, newText })).toEqual([
      {
        private: "Run by the kit before the merge.",
        public: "Run at the end.",
      },
    ]);
  });

  it("is not found when both changed, or when neither did", () => {
    const base = lines("// Run by the kit.", "// public: Run at the end.");

    expect(
      stalePartners({
        path: "a.mjs",
        oldText: base,
        newText: lines("// Run by the kit twice.", "// public: Run twice."),
      }),
    ).toEqual([]);
    expect(
      stalePartners({ path: "a.mjs", oldText: base, newText: base }),
    ).toEqual([]);
  });

  it("the file's warnings tell the author what to do", () => {
    const warnings = warningsForFile({
      path: "scripts/x.mjs",
      oldText: lines("// Old by the kit.", "// public: Old."),
      newText: lines(
        "// New by the kit.",
        "// public: Old.",
        "",
        "// Another note about SPEC.md.",
      ),
    });

    expect(warnings).toHaveLength(2);
    expect(warnings.join("\n")).toContain(
      'Add a line under it that starts with "public:"',
    );
    expect(warnings.join("\n")).toContain(
      'was changed but its "public:" line was not',
    );
  });
});

describe("AC-691 a task with no public message", () => {
  const FRONT = "---\nid: t\npaths: a\nbase: main\nstatus: open\n---\n\n";

  it("is warned about when it publishes files and has no ## Public section", () => {
    expect(
      missingPublicSection({
        taskText: `${FRONT}Some words.\n`,
        publishedFiles: ["a.ts"],
      }),
    ).toHaveLength(1);
    expect(
      missingPublicSection({
        taskText: `${FRONT}(describe the task here)\n`,
        publishedFiles: ["a.ts", "b.ts"],
      })[0],
    ).toContain("2 file(s)");
  });

  it("is not warned about when it has the section, or when it publishes nothing", () => {
    expect(
      missingPublicSection({
        taskText: `${FRONT}## Public\nWords.\n`,
        publishedFiles: ["a.ts"],
      }),
    ).toEqual([]);
    expect(
      missingPublicSection({ taskText: FRONT, publishedFiles: [] }),
    ).toEqual([]);
  });
});

describe("AC-691 the pre-gate prints them", () => {
  it("the pre-gate script asks for the warnings and never fails on them", () => {
    const source = fs.readFileSync(
      path.join(here, "..", "pregate.mjs"),
      "utf8",
    );

    expect(source).toMatch(/warningsForFile/);
    expect(source).toMatch(/missingPublicSection/);
    expect(source).toMatch(/pregate: WARN/);
  });
});
