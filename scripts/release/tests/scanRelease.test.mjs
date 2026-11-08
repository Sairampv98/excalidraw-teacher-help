/**
 * AC-574 - the files of a release are looked through before they are published, with the rules of the public mirror.
 */

import { describe, expect, it } from "vitest";

import { stringsOf } from "../scan-release.mjs";

describe("AC-574 the scan of the files of a release", () => {
  it("AC-574 reads the text of a program in ASCII and in UTF-16, which is how a .NET program keeps its text", () => {
    const ascii = Buffer.from("\u0000\u0000a plain sentence\u0000", "latin1");
    const wide = Buffer.from("\u0000\u0000a wide sentence\u0000", "utf16le");
    const text = stringsOf(Buffer.concat([ascii, Buffer.alloc(4), wide]));

    expect(text).toContain("a plain sentence");
    expect(text).toContain("a wide sentence");
  });

  it("AC-574 leaves out what is too short to be a sentence", () => {
    expect(stringsOf(Buffer.from("ab\u0000cd\u0000", "latin1"))).toBe("");
  });
});
