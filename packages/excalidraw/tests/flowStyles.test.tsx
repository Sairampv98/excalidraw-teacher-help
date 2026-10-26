/**
 * AC-199 to AC-203 - the animation styles, the pipe, the camera and the interactive steps (D-166, D-167, D-170, D-171, D-172).
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
  it.todo("AC-201 the pipe is three strokes on the arrow's path");
  it.todo("AC-201 the dash runs toward the arrow's end");
  it.todo("AC-201 the speed does not depend on the frame rate");
  it.todo("AC-201 the arrow in the document is not changed");
  it.todo(
    "AC-202 the step and its padding are in view at the end of the flight",
  );
  it.todo("AC-202 the flight eases between the start and the target");
  it.todo("AC-202 the camera stays on the page");
  it.todo("AC-202 with the switch off the view does not move");
  it.todo("AC-202 leaving restores the view exactly");
  it.todo("AC-203 only the current question's branches are clickable");
  it.todo("AC-203 the choice decides the next step");
  it.todo("AC-203 next with no choice follows the step order");
  it.todo("AC-203 an end is drawn on and then filled");
  it.todo("AC-203 the end shape in the document is unchanged");
});
