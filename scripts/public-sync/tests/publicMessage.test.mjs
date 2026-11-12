/**
 * AC-690 - a task describes itself for the public in a `## Public` section (D-593).
 *
 * The section is the public message of the task's commit. A description with no
 * such section is used whole, as before; the kit's placeholder is none, and the
 * message is then written from the paths.
 */

import { describe, expect, it } from "vitest";

import {
  deriveMessage,
  hasPublicSection,
  publicSection,
  taskBody,
} from "../message.mjs";

const FRONT =
  "---\nid: a-task\npaths: scripts/ui\nbase: main\nstatus: merged\n---\n\n";
const PATHS = ["scripts/ui/lib/app.mjs", "scripts/ui/run.mjs"];

const derive = (body) =>
  deriveMessage({
    message: "tins: merge task a-task\n\nTins-Merge: a-task",
    taskText: `${FRONT}${body}`,
    paths: PATHS,
  });

describe("AC-690 the public section", () => {
  it("is the text under the heading, up to the next heading, and is the message", () => {
    const derived = derive(
      [
        "The kit counts a file here as outside the task, per SPEC.md.",
        "",
        "## Public",
        "The gate keeps its records in the temp folder. Nothing else changes.",
        "",
        "## Notes",
        "More about the kit.",
        "",
      ].join("\n"),
    );

    expect(derived.message).toBe(
      "The gate keeps its records in the temp folder\n\nNothing else changes.\n",
    );
    expect(derived.unmapped).toEqual([]);
  });

  it("is read when the heading is in lowercase, and not when it only starts with the word", () => {
    expect(publicSection("## public\nPlain words.\n")).toBe("Plain words.");
    expect(publicSection("## Publicity\nPlain words.\n")).toBe("");
    expect(publicSection("### Public\nPlain words.\n")).toBe("");
  });

  it("runs to the end of the description when no heading follows", () => {
    expect(publicSection("Private.\n\n## Public\nOne.\n\nTwo.\n")).toBe(
      "One.\n\nTwo.",
    );
  });

  it("an empty section is no section: the whole description is used", () => {
    expect(hasPublicSection(`${FRONT}Words.\n\n## Public\n\n`)).toBe(false);
    expect(taskBody(`${FRONT}Words.\n\n## Public\n\n`)).toContain("Words.");
  });

  it("without a section the description is used whole, as before", () => {
    const derived = derive(
      "The gate drives a Chromium of its own. It closes it.\n",
    );

    expect(
      derived.message.startsWith("The gate drives a Chromium of its own"),
    ).toBe(true);
  });

  it("with the kit's placeholder the message is written from the paths and has no body", () => {
    const derived = derive("(describe the task here)\n");

    expect(derived.message).toBe("Update scripts/ui\n");
  });

  it("a section that names the method is still reported, so the mirror stops on it", () => {
    const derived = derive(
      "## Public\nThe kit counts a file here as outside the task.\n",
    );

    expect(derived.unmapped.length).toBeGreaterThan(0);
  });

  it("knows whether a task file has one", () => {
    expect(hasPublicSection(`${FRONT}## Public\nWords.\n`)).toBe(true);
    expect(hasPublicSection(`${FRONT}Words.\n`)).toBe(false);
    expect(hasPublicSection(`${FRONT}(describe the task here)\n`)).toBe(false);
  });
});
