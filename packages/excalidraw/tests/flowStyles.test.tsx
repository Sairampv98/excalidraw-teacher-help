/**
 * AC-199 and AC-200 - the animation styles and the interactive steps (D-166, D-167).
 *
 * Spec-first (wave 7q): the rows are in SPEC.md. Each `it.todo` below is a
 * row's test that is not written yet; it is replaced by a real test as the
 * feature is built.
 */

import { describe, it } from "vitest";

describe("flowStyles", () => {
  it.todo("AC-199 the beam travels the arrow's path");
  it.todo("AC-199 the token travels the arrow's path");
  it.todo("AC-199 the marching dashes follow the arrow");
  it.todo("AC-199 the pulse is on the current step");
  it.todo("AC-199 a curved arrow is followed, and a moved arrow too");
  it.todo("AC-199 no style writes into the document");
  it.todo("AC-200 presenting reveals one step at a time");
  it.todo("AC-200 next and previous stop at the ends");
  it.todo("AC-200 the arrow keys are only claimed while presenting");
  it.todo("AC-200 play from here runs the downstream steps in order");
  it.todo("AC-200 leaving restores the canvas");
});
