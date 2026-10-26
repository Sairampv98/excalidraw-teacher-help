/**
 * AC-195 and AC-197 - the flow presets build bound charts that fit the page (D-162, D-163, D-165).
 *
 * Spec-first (wave 7q): the rows are in SPEC.md. Each `it.todo` below is a
 * row's test that is not written yet; it is replaced by a real test as the
 * feature is built.
 */

import { describe, it } from "vitest";

describe("flowPresets", () => {
  it.todo("AC-195 every preset builds bound arrows with both sides agreeing");
  it.todo("AC-195 every shape carries its label as bound text");
  it.todo("AC-195 ids are unique and the seed makes the chart repeatable");
  it.todo("AC-195 a loop returns to its first step");
  it.todo("AC-195 the decision rejoins");
  it.todo("AC-195 the tiers stack and the hub is in the middle");
  it.todo("AC-197 every shape is inside the page");
  it.todo("AC-197 no two shapes overlap");
  it.todo("AC-197 the text never goes below the floor");
  it.todo("AC-197 a script too big for the floor is reported");
});
