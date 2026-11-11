/**
 * The app learns that the picture is a screen copy (Windows 7, D-493, AC-591):
 * the bridge's capture message becomes the panel's capture, flag included.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it } from "vitest";

import { toPanelCapture } from "../bridge/codePanel";

const STREAM = "http://127.0.0.1:47511/s/a-capability/frame";

describe("the screen copy flag", () => {
  it("AC-591 a capture that says screenCopy reaches the panel, and one that does not says nothing", () => {
    const copy = toPanelCapture(
      { v: 1, type: "editor:capture", state: "live", seq: 3, screenCopy: true },
      STREAM,
    );

    expect(copy).toMatchObject({ status: "live", screenCopy: true });

    const plain = toPanelCapture(
      { v: 1, type: "editor:capture", state: "live", seq: 4 },
      STREAM,
    );

    expect(plain.status).toBe("live");
    expect("screenCopy" in plain).toBe(false);
  });
});
