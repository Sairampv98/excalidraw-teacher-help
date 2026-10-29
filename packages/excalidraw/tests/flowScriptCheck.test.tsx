/**
 * AC-250 - the script is checked while it is typed (D-224).
 *
 * The check is the parser's own, so the tests do what a person does: write a
 * script, read what is said about it, and build it.
 */

import { describe, expect, it } from "vitest";

import { checkFlowScript } from "../scene/flowCheck";
import { buildFlowPreset } from "../scene/flowPresets";
import { FLOW_PRESET_IDS, MAX_LABEL_CHARS } from "../scene/flowScript";

import { scriptOfSize } from "./helpers/flowLargeHelpers";

import type { FlowPresetId } from "../scene/flowScript";

const lines = (preset: FlowPresetId, script: string) =>
  checkFlowScript(preset, script).problems.map((p) => p.line);

describe("AC-250 the script is checked while it is typed", () => {
  it("AC-250 each problem is reported with its line number", () => {
    // a stray ->
    expect(lines("network", "A -> B\nC ->\n-> D")).toEqual([2, 3]);

    // an empty tier
    expect(lines("tiers", "A | B\n|\nC")).toEqual([2]);

    // a ? with nothing to ask, and a ? with fewer than two lines after it
    expect(lines("decision", "Start\n?\nGo")).toEqual([2]);
    expect(lines("decision", "? Ready?\nYes only")).toEqual([1]);

    // a mark that is not closed
    expect(lines("process", "Plan\n[Teach\nReview")).toEqual([2]);

    // a line too long for any shape
    expect(
      lines("process", `Plan\n${"x".repeat(MAX_LABEL_CHARS + 1)}`),
    ).toEqual([2]);

    // blank lines count: the line is the one in the text
    expect(lines("network", "\n\nA ->")).toEqual([3]);

    // the message says what is wrong, and a clean script says nothing
    const check = checkFlowScript("process", "Plan\n[Teach");

    expect(check.problems[0].message).toMatch(/not closed/);
    expect(checkFlowScript("process", "Plan\nTeach").problems).toEqual([]);
  });

  it("AC-250 the counts and the text size are shown", () => {
    const process = checkFlowScript("process", "Plan\nTeach\nReview\nCheck");

    expect(process).toMatchObject({
      ok: true,
      nodes: 4,
      arrows: 3,
      pages: 1,
      reason: null,
    });
    expect(process.fontSize).toBe(24);

    // a network: the arrows are the lines of A -> B
    expect(checkFlowScript("network", "A -> B -> C\nA -> C")).toMatchObject({
      nodes: 3,
      arrows: 3,
    });

    // a decision: the yes and the no are arrows
    expect(checkFlowScript("decision", "? Ready?\nGo\nWait")).toMatchObject({
      nodes: 3,
      arrows: 2,
    });

    // the size depends on the fit mode
    const big = scriptOfSize("cycle", 100, true);

    expect(checkFlowScript("cycle", big)).toMatchObject({
      ok: false,
      fontSize: null,
    });
    expect(checkFlowScript("cycle", big).reason).toMatch(/spread/i);
    expect(checkFlowScript("cycle", big, { fit: "larger" })).toMatchObject({
      ok: true,
      fontSize: 18,
      pages: 1,
    });
    expect(
      checkFlowScript("cycle", big, { fit: "spread" }).pages,
    ).toBeGreaterThan(1);
  });

  it("AC-250 apply and insert are off while there is a problem", () => {
    const bad = checkFlowScript("process", "Plan\n[Teach");

    // the one thing the buttons read: ok, and why not
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe(`Line 2: ${bad.problems[0].message}`);

    // an empty script builds nothing and says so
    const empty = checkFlowScript("process", "  \n\n ");

    expect(empty.ok).toBe(false);
    expect(empty.reason).toMatch(/Nothing to build/);

    // a script that is too big for the page says what to do
    const tooBig = checkFlowScript("cycle", scriptOfSize("cycle", 100, true));

    expect(tooBig.ok).toBe(false);
    expect(tooBig.reason).toBeTruthy();

    expect(checkFlowScript("process", "Plan\nTeach").ok).toBe(true);
  });

  it("AC-250 what the check accepts always builds", () => {
    // scripts put together from the pieces a teacher types, by a fixed sequence
    let seed = 12345;
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;

      return seed / 2 ** 32;
    };
    const PIECES = [
      "Plan",
      "Teach it",
      "[Box]",
      "(Round)",
      "((Oval))",
      "{Dot}",
      "<Kite>",
      "?",
      "? Ready?",
      "A -> B",
      "-> C",
      "D ->",
      "x | y",
      "|",
      "[open",
      "",
      "  ",
      "Yes",
    ];

    let accepted = 0;

    for (let run = 0; run < 300; run++) {
      const preset =
        FLOW_PRESET_IDS[Math.floor(next() * FLOW_PRESET_IDS.length)];
      const count = 1 + Math.floor(next() * 7);
      const script = Array.from(
        { length: count },
        () => PIECES[Math.floor(next() * PIECES.length)],
      ).join("\n");

      const check = checkFlowScript(preset, script);

      if (check.ok) {
        accepted++;

        expect(check.problems).toEqual([]);
        expect(buildFlowPreset(preset, script).ok, `${preset}: ${script}`).toBe(
          true,
        );
      }
    }

    // the sequence made enough good scripts for this to mean something
    expect(accepted).toBeGreaterThan(30);
  });
});
