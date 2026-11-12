/**
 * AC-689 - a comment that names the method has a public partner (D-592).
 *
 * The author writes the private comment and, right under it, a line that starts
 * with `public:` in public wording. The public text holds the partner in place
 * of what is above it; the private source keeps both lines.
 */

import { describe, expect, it } from "vitest";

import { scrubFile } from "../scrub.mjs";

const lines = (...rows) => `${rows.join("\n")}\n`;

describe("AC-689 the public partner replaces the private comment", () => {
  it("in a run of // comments", () => {
    const result = scrubFile(
      "a.mjs",
      lines(
        "const a = 1;",
        "// The record is kept outside the checkout: the kit counted a file there.",
        "// public: The record of a run is kept in the temp folder.",
        "const b = 2;",
      ),
    );

    expect(result.text).toBe(
      lines(
        "const a = 1;",
        "// The record of a run is kept in the temp folder.",
        "const b = 2;",
      ),
    );
    expect(result.unmapped).toEqual([]);
  });

  it("in a block comment, which keeps its shape", () => {
    const result = scrubFile(
      "a.ts",
      lines(
        "/**",
        " * The state of one scrub, as the kit and SPEC.md describe it.",
        " * public: The state of one scrub.",
        " */",
        "export const x = 1;",
      ),
    );

    expect(result.text).toBe(
      lines("/**", " * The state of one scrub.", " */", "export const x = 1;"),
    );
  });

  it("in a # comment", () => {
    const result = scrubFile(
      "a.yml",
      lines(
        "name: x",
        "# Run by the kit at close.",
        "# public: Run at the end of a task.",
        "run: y",
      ),
    );

    expect(result.text).toBe(
      lines("name: x", "# Run at the end of a task.", "run: y"),
    );
  });

  it("in a paragraph of a document", () => {
    const result = scrubFile(
      "a.md",
      lines(
        "# Title",
        "",
        "This is written for the kit and its spec lint.",
        "public: This is written for the maintainers.",
        "",
        "A safe paragraph.",
      ),
    );

    expect(result.text).toBe(
      lines(
        "# Title",
        "",
        "This is written for the maintainers.",
        "",
        "A safe paragraph.",
      ),
    );
  });

  it("a partner also stands for several lines of the private comment above it, and may take several of its own", () => {
    const result = scrubFile(
      "a.mjs",
      lines(
        "// The kit counts",
        "// a file in the checkout",
        "// as outside the task.",
        "// public: The record is kept",
        "// in the temp folder.",
        "const b = 2;",
      ),
    );

    expect(result.text).toBe(
      lines("// The record is kept", "// in the temp folder.", "const b = 2;"),
    );
  });

  it("only the text directly above it goes: a paragraph after a blank line stays", () => {
    const result = scrubFile(
      "a.ts",
      lines(
        "/**",
        " * A safe paragraph about the colours.",
        " *",
        " * The kit decides this.",
        " * public: The maintainers decide this.",
        " */",
        "export const x = 1;",
      ),
    );

    expect(result.text).toBe(
      lines(
        "/**",
        " * A safe paragraph about the colours.",
        " *",
        " * The maintainers decide this.",
        " */",
        "export const x = 1;",
      ),
    );
  });

  it("two pairs in one comment are two replacements, with a blank comment line between them", () => {
    const result = scrubFile(
      "a.mjs",
      lines(
        "// First: see the kit.",
        "// public: First.",
        "//",
        "// Second: see SPEC.md.",
        "// public: Second.",
      ),
    );

    expect(result.text).toBe(lines("// First.", "//", "// Second."));
  });

  it("the public wording runs on until a blank comment line: a private line right after it is part of it", () => {
    const result = scrubFile(
      "a.mjs",
      lines("// First: see the kit.", "// public: First.", "// More of it."),
    );

    expect(result.text).toBe(lines("// First.", "// More of it."));
  });
});

describe("AC-689 what is not a partner", () => {
  it("a comment with no partner is treated as before: reported, and dropped only when that is allowed", () => {
    const text = lines("// Run by the kit at close.", "const a = 1;");

    expect(scrubFile("a.mjs", text).unmapped).toEqual([
      "Run by the kit at close.",
    ]);
    expect(scrubFile("a.mjs", text, { allowDrop: true }).text).toBe(
      lines("const a = 1;"),
    );
  });

  it("a wrong marker under a private comment does not replace it: the comment above is treated as before", () => {
    for (const marker of ["Public: A plain note.", "public:A plain note."]) {
      const result = scrubFile(
        "a.mjs",
        lines("// Private note about the kit.", `// ${marker}`),
      );

      // the sentence that names the method is still reported: it was not replaced
      expect(result.unmapped).toHaveLength(1);
      expect(result.unmapped[0].startsWith("Private note about the kit.")).toBe(
        true,
      );
    }
  });

  it("the marker must start the line, in lowercase, with a space after it", () => {
    for (const comment of [
      "// The api has public: the visibility of a member.",
      "// Public: not a marker.",
      "// public:no space",
      "// publicly: no",
    ]) {
      const result = scrubFile("a.mjs", lines(comment, "const a = 1;"));

      expect(result.text).toBe(lines(comment, "const a = 1;"));
    }
  });

  it("a partner with nothing above it keeps its text and loses its marker", () => {
    const result = scrubFile(
      "a.mjs",
      lines("// public: Run at the end of a task.", "const a = 1;"),
    );

    expect(result.text).toBe(
      lines("// Run at the end of a task.", "const a = 1;"),
    );
  });

  it("a public wording that names the method is still reported, so the guard can stop it", () => {
    const result = scrubFile(
      "a.mjs",
      lines("// Private note about the kit.", "// public: See the kit rules."),
    );

    expect(result.unmapped).toEqual(["See the kit rules."]);
  });

  it("the private text of a pair is never reported or mapped: it is not published", () => {
    const result = scrubFile(
      "a.mjs",
      lines(
        "// Private note about the kit and SPEC.md.",
        "// public: A plain note.",
      ),
    );

    expect(result.unmapped).toEqual([]);
    expect(result.text).not.toContain("kit");
  });
});
