import { describe, expect, it } from "vitest";

import {
  codeCardColumns,
  highlightCode,
  layoutCode,
  normalizeLanguage,
} from "../sidebar/codeCard";

/**
 * A code card is laid out on the canvas as many small text elements, one per
 * run of same-coloured characters. jsdom does no layout, so what can be checked
 * is the part that decides whether the card lines up: which language shiki is
 * asked for, that the colours survive, and above all the column arithmetic that
 * positions each run beside the previous one.
 */
describe("normalizeLanguage", () => {
  it("passes a plain shiki id straight through", () => {
    expect(normalizeLanguage("python")).toBe("python");
    expect(normalizeLanguage("typescript")).toBe("typescript");
  });

  it("strips the class prefix marked puts on the <code>", () => {
    expect(normalizeLanguage("language-python")).toBe("python");
    expect(normalizeLanguage("lang-rust")).toBe("rust");
  });

  it("maps the shorthands people actually write on a fence", () => {
    expect(normalizeLanguage("py")).toBe("python");
    expect(normalizeLanguage("js")).toBe("javascript");
    expect(normalizeLanguage("ts")).toBe("typescript");
    expect(normalizeLanguage("sh")).toBe("bash");
    expect(normalizeLanguage("yml")).toBe("yaml");
    expect(normalizeLanguage("md")).toBe("markdown");
    expect(normalizeLanguage("c#")).toBe("csharp");
    expect(normalizeLanguage("c++")).toBe("cpp");
  });

  it("ignores case, surrounding space and trailing decorations", () => {
    expect(normalizeLanguage("  Python  ")).toBe("python");
    expect(normalizeLanguage("PY")).toBe("python");
    expect(normalizeLanguage("python {1,3}")).toBe("python");
  });

  it("has nothing to work with when the fence had no language", () => {
    expect(normalizeLanguage(undefined)).toBeNull();
    expect(normalizeLanguage("")).toBeNull();
    expect(normalizeLanguage("   ")).toBeNull();
  });
});

describe("highlightCode", () => {
  const PYTHON = "def second_largest(nums):\n    return sorted(nums)[-2]";

  it("returns one entry per line, split into coloured runs", async () => {
    const lines = await highlightCode(PYTHON, "python");

    expect(lines).not.toBeNull();
    expect(lines).toHaveLength(2);

    for (const line of lines!) {
      expect(line.length).toBeGreaterThan(0);

      for (const span of line) {
        expect(span.text.length).toBeGreaterThan(0);
        expect(span.color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }

    // the runs must reconstruct the source exactly, or the card would show
    // different code than the clipboard holds
    expect(
      lines!.map((line) => line.map((span) => span.text).join("")).join("\n"),
    ).toBe(PYTHON);
  });

  it("uses more than one colour on real source", async () => {
    const lines = await highlightCode(PYTHON, "python");
    const colors = new Set(lines!.flat().map((span) => span.color));

    // a keyword, a name and a builtin literal must not all land on one colour
    expect(colors.size).toBeGreaterThan(1);
  });

  it("reports nothing rather than throwing for an unknown language", async () => {
    // the caller falls back to a plain text card, so this has to be a clean
    // miss and not an exception out of a paste handler
    await expect(
      highlightCode(PYTHON, "definitely-not-a-language"),
    ).resolves.toBeNull();
  });

  it("reports nothing when no language was given at all", async () => {
    await expect(highlightCode(PYTHON, undefined)).resolves.toBeNull();
  });

  it("refuses a snippet too large to be worth highlighting", async () => {
    await expect(
      highlightCode("x = 1\n".repeat(120_000), "python"),
    ).resolves.toBeNull();
  });
});

describe("layoutCode", () => {
  const line = (text: string, color = "#d4d4d4") => [{ text, color }];

  it("gives every run the column it belongs at", () => {
    const rows = layoutCode([
      [
        { text: "def", color: "#569cd6" },
        { text: " ", color: "#d4d4d4" },
        { text: "f", color: "#dcdcaa" },
      ],
    ]);

    expect(rows).toHaveLength(1);

    let expectedColumn = 0;

    for (const run of rows[0]) {
      // this is the whole basis of the card lining up: each run starts exactly
      // where the text before it ended
      expect(run.column).toBe(expectedColumn);
      expectedColumn += run.text.length;
    }
  });

  it("keeps indentation inside the first run", () => {
    const rows = layoutCode([line("    return x")]);

    // leading spaces are not their own element, they ride along in the first
    // run — so the run still starts at column zero and the indent still shows
    expect(rows[0]).toHaveLength(1);
    expect(rows[0][0].column).toBe(0);
    expect(rows[0][0].text).toBe("    return x");
  });

  it("merges neighbouring runs of the same colour", () => {
    // otherwise a line is half a dozen elements and nobody can select it
    const rows = layoutCode([
      [line("abc", "#569cd6")[0], line("def", "#569cd6")[0]],
    ]);

    expect(rows[0]).toHaveLength(1);
    expect(rows[0][0].text).toBe("abcdef");
    expect(rows[0][0].column).toBe(0);
  });

  it("keeps runs of different colours apart", () => {
    const rows = layoutCode([
      [
        { text: "def", color: "#569cd6" },
        { text: " ", color: "#d4d4d4" },
        { text: "f", color: "#dcdcaa" },
      ],
    ]);

    expect(rows[0].map((run) => run.color)).toEqual(["#569cd6", "#dcdcaa"]);
  });

  it("wraps a long line instead of making the card unbounded", () => {
    const rows = layoutCode([line("x".repeat(200))], { maxColumns: 20 });

    expect(rows.length).toBeGreaterThan(1);

    for (const row of rows) {
      expect(
        row.reduce((sum, run) => sum + run.text.length, 0),
      ).toBeLessThanOrEqual(20);
    }

    // and nothing is lost in the wrapping
    expect(
      rows.map((row) => row.map((run) => run.text).join("")).join(""),
    ).toBe("x".repeat(200));
  });

  it("wraps on a space when there is one to break on", () => {
    const rows = layoutCode(
      [
        [
          { text: "a".repeat(8), color: "#569cd6" },
          { text: " ", color: "#d4d4d4" },
          { text: "b".repeat(8), color: "#569cd6" },
        ],
      ],
      { maxColumns: 10 },
    );

    expect(rows).toHaveLength(2);
    expect(rows[0][0].text).toBe("a".repeat(8));
    expect(rows[1][0].text).toBe("b".repeat(8));
  });

  it("never lets indentation blow a row past the card width", () => {
    const rows = layoutCode([line(`${" ".repeat(70)}value`)], {
      maxColumns: 20,
    });

    for (const row of rows) {
      // a blank row carries the vertical rhythm of a blank line, and has no
      // first run to speak of
      if (!row.length) {
        continue;
      }

      expect(
        row.reduce((sum, run) => sum + run.text.length, 0),
      ).toBeLessThanOrEqual(20);
      expect(row[0].text.trim().length).toBeGreaterThan(0);
    }
  });

  it("survives an empty document", () => {
    expect(layoutCode([])).toEqual([]);
  });
});

describe("codeCardColumns", () => {
  const line = (text: string, color = "#d4d4d4") => [{ text, color }];

  it("measures the widest row, in characters", () => {
    const rows = layoutCode([line("short"), line("a much longer line")]);

    expect(codeCardColumns(rows)).toBe("a much longer line".length);
  });

  it("is zero for nothing", () => {
    expect(codeCardColumns([])).toBe(0);
  });
});
