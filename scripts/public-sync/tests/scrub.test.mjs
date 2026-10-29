/**
 * AC-292 and AC-293 - the scrub rewrites the wording of the method as ordinary
 * English, leaves no artefact where an id was, stops on what it cannot
 * rewrite, and rewrites the remarks about the owner as feature statements.
 */

import { describe, expect, it } from "vitest";

import { isUntouched } from "../guard.mjs";
import { mapKey, rewriteOwner, scrubFile, scrubMessage } from "../scrub.mjs";

const MAP = {
  sentences: {
    "Wave 7r added the flow tab.": "The flow tab was added.",
  },
};

describe("AC-292 the scrub rewrites, and leaves no artefact", () => {
  it("AC-292 a mapped paragraph is rewritten", () => {
    const source = [
      "/**",
      " * Wave 7r added the flow tab. It lays a chart out from a script.",
      " */",
      "export const flow = 1;",
      "",
    ].join("\n");

    const { text, unmapped } = scrubFile("src/flow.ts", source, { map: MAP });

    expect(unmapped).toEqual([]);
    expect(text).toContain("The flow tab was added.");
    expect(text).toContain("It lays a chart out from a script.");
    expect(text).not.toMatch(/wave/i);
  });

  it("AC-292 ids leave no artefact", () => {
    const source = [
      "// the paste is offered (D-24, D-25), see D-26.",
      "// D-10's rule is kept.",
      'it("AC-8 the panel opens", () => {});',
      "const note = 1; // (AC-3)",
    ].join("\n");

    const { text } = scrubFile("src/a.ts", source, { map: MAP });

    // no id, no empty brackets, no "see" with nothing to see, no empty comment
    expect(text.split("\n")).toEqual([
      "// the paste is offered.",
      "// the rule is kept.",
      'it("the panel opens", () => {});',
      "const note = 1;",
    ]);
  });

  it("AC-292 an unmapped paragraph is reported, and kept unless dropping is allowed", () => {
    const source = "// Wave 9z changed the whole thing.\nexport const a = 1;\n";

    const strict = scrubFile("src/a.ts", source, { map: MAP });

    expect(strict.unmapped).toEqual(["Wave 9z changed the whole thing."]);
    // the sentence stays, so that the guard stops the run on it
    expect(strict.text).toContain("Wave 9z");

    const allowed = scrubFile("src/a.ts", source, {
      map: MAP,
      allowDrop: true,
    });

    expect(allowed.text).not.toMatch(/wave/i);
    expect(allowed.unmapped).toEqual(["Wave 9z changed the whole thing."]);
  });

  it("AC-292 locale files and lock files are not touched", () => {
    const untouched = ["/locales/", "yarn.lock"];

    expect(
      isUntouched("packages/excalidraw/locales/ro-RO.json", untouched),
    ).toBe(true);
    expect(isUntouched("yarn.lock", untouched)).toBe(true);
    expect(isUntouched("packages/excalidraw/index.tsx", untouched)).toBe(false);
  });

  it("AC-292 a commit message is rewritten through the same map", () => {
    const { message, unmapped } = scrubMessage(
      "Wave 7r added the flow tab. (D-229)\n\nCo-Authored-By: Someone <a@b.c>",
      { map: MAP },
    );

    expect(unmapped).toEqual([]);
    expect(message).toBe("The flow tab was added.");
  });

  it("AC-292 a key is one line with the spaces collapsed", () => {
    expect(mapKey("Wave 7r   added\nthe flow tab.")).toBe(
      "Wave 7r added the flow tab.",
    );
  });
});

describe("AC-293 the owner's remarks are feature statements", () => {
  it("AC-293 an owner remark becomes a feature statement", () => {
    expect(
      rewriteOwner("The owner asked for the panel to follow the page."),
    ).toBe("Provides the panel to follow the page.");

    // what is left of the word names the teacher, who uses the feature
    expect(rewriteOwner("The owner's own words: keep it simple.")).not.toMatch(
      /owner/i,
    );
    expect(rewriteOwner("the owner decides")).toBe("the teacher decides");
  });

  it("AC-293 a comment that mentions the owner comes out without the word", () => {
    const source = [
      "/**",
      " * The owner asked for the editor to cover half the canvas.",
      " */",
      "export const size = 0.5;",
    ].join("\n");

    const { text } = scrubFile("src/size.ts", source, { map: MAP });

    expect(text).not.toMatch(/owner/i);
    expect(text).toContain("Provides the editor to cover half the canvas");
  });
});
