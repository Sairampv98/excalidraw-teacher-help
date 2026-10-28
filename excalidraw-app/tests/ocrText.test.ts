/**
 * AC-315 - the text an engine read is shown as it was on the picture: in
 * order, with the indent of each line and the gaps between blocks.
 */

import { ocrLinesToText } from "../ocr/ocrText";

const line = (text: string, x: number, y: number) => ({
  text,
  x,
  y,
  // a character is 10 px wide and a line 20 px tall
  width: text.length * 10,
  height: 20,
});

describe("AC-315 the read text keeps its shape", () => {
  it("AC-315 the lines come in reading order whatever order they were read in", () => {
    const text = ocrLinesToText([
      line("second", 0, 25),
      line("first", 0, 0),
      line("third", 0, 50),
    ]);

    expect(text).toBe("first\nsecond\nthird");
  });

  it("AC-315 a python block keeps its indentation", () => {
    const text = ocrLinesToText([
      line("def hello(name):", 40, 0),
      line("if name:", 80, 25),
      line("print(name)", 120, 50),
      line("return 1", 80, 75),
    ]);

    expect(text).toBe(
      [
        "def hello(name):",
        "    if name:",
        "        print(name)",
        "    return 1",
      ].join("\n"),
    );
  });

  it("AC-315 a gap between two blocks is a blank line", () => {
    const text = ocrLinesToText([
      line("import os", 0, 0),
      line("import sys", 0, 25),
      line("print(1)", 0, 100),
    ]);

    expect(text).toBe("import os\nimport sys\n\nprint(1)");
  });

  it("AC-315 nothing read is no text", () => {
    expect(ocrLinesToText([])).toBe("");
    expect(ocrLinesToText([line("   ", 0, 0)])).toBe("");
  });
});
