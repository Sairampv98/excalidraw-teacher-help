/**
 * AC-196 - the script becomes nodes by the rules (D-164).
 *
 * Spec-first (wave 7q): the rows are in SPEC.md. Each `it.todo` below is a
 * row's test that is not written yet; it is replaced by a real test as the
 * feature is built.
 */

import { describe, it } from "vitest";

describe("flowScript", () => {
  it.todo("AC-196 blank lines are ignored and labels are trimmed");
  it.todo("AC-196 a tier line splits into its items");
  it.todo("AC-196 the first line of an integration is the hub");
  it.todo("AC-196 a question takes the next two lines as its branches");
  it.todo("AC-196 an edge line creates each node once");
  it.todo("AC-196 an empty script builds nothing and says so");
});
