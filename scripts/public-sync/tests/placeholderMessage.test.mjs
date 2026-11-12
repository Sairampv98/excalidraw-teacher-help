/**
 * AC-687 - a public commit never says the kit's placeholder (D-590).
 *
 * A task made without a description has the body "(describe the task here)" in
 * its file. That used to become the public message of the commit; now it counts
 * as no description and the message is written from the paths that changed.
 */

import { describe, expect, it } from "vitest";

import { deriveMessage, taskBody } from "../message.mjs";

const FRONT =
  "---\nid: a-task\npaths: scripts/ui\nbase: main\nstatus: merged\n---\n\n";

describe("AC-687 the placeholder is no description", () => {
  it("the body of a task that was never described is empty", () => {
    expect(taskBody(`${FRONT}(describe the task here)\n`)).toBe("");
    expect(taskBody(`${FRONT}  (describe the task here)  \n\n`)).toBe("");
  });

  it("a real description is kept", () => {
    expect(taskBody(`${FRONT}The gate drives a Chromium of its own.\n`)).toBe(
      "The gate drives a Chromium of its own.",
    );
  });

  it("the public message is written from the paths, and does not say the placeholder", () => {
    const derived = deriveMessage({
      message: "tins: merge task a-task\n\nTins-Merge: a-task",
      taskText: `${FRONT}(describe the task here)\n`,
      paths: ["scripts/ui/lib/app.mjs", "scripts/ui/run.mjs"],
    });

    expect(derived.message).toBe("Update scripts/ui\n");
    expect(derived.message).not.toContain("describe the task");
  });

  it("a description of the task still becomes the message", () => {
    const derived = deriveMessage({
      message: "tins: merge task a-task",
      taskText: `${FRONT}The gate drives a Chromium of its own. It closes it.\n`,
      paths: ["scripts/ui/lib/app.mjs"],
    });

    expect(
      derived.message.startsWith("The gate drives a Chromium of its own"),
    ).toBe(true);
  });
});
