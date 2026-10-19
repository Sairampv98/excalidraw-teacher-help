import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

/**
 * The markdown viewer's containment is pure CSS, and jsdom does no layout — so
 * there is nothing to assert about rendered geometry here. What *can* be
 * asserted is that the declarations which fix the bug are still in the
 * stylesheet. They are load-bearing, and every one of them was added because
 * the viewer had visibly broken without it, so losing one silently would put
 * the same bug back.
 */
const scss = fs.readFileSync(
  path.join(__dirname, "..", "sidebar", "sidebar.scss"),
  "utf8",
);

/**
 * Every top-level rule in the stylesheet whose selector list mentions
 * `.app-doc-markdown`, concatenated.
 *
 * Splitting by top level rather than string-matching one block matters: the
 * file has both a shared `.app-doc-code, .app-doc-markdown { … }` rule and a
 * standalone `.app-doc-markdown { … }` one, and the containment declarations are
 * load-bearing wherever they sit.
 */
const markdownRules = () => {
  const rules: string[] = [];

  let depth = 0;
  let start = 0;

  for (let i = 0; i < scss.length; i++) {
    if (scss[i] === "{") {
      if (depth === 0) {
        start = i;
      }
      depth++;
    } else if (scss[i] === "}") {
      depth--;

      if (depth === 0) {
        const rule = scss.slice(start, i + 1);
        const selector = scss.slice(0, start).split("\n").pop();

        if (selector?.includes(".app-doc-markdown")) {
          rules.push(rule);
        }
      }
    }
  }

  expect(rules.length).toBeGreaterThan(0);

  return rules.join("\n");
};

describe("markdown viewer containment (stylesheet)", () => {
  it("never lets the body scroll sideways", () => {
    const block = markdownRules();

    // The reported symptom was the panel scrolling on its own after any click.
    // A body that can scroll horizontally is a body the browser will scroll
    // horizontally by itself — focusing the copy button after a click drags
    // the whole document elsewhere. Wide content wraps instead (see below), so
    // the body has nowhere sideways to go.
    expect(block).toMatch(/overflow-x:\s*hidden/);
    expect(block).toMatch(/overflow-y:\s*auto/);
  });

  it("clips a code block instead of letting it escape the panel", () => {
    const block = markdownRules();

    // `overflow: visible` here is what let a long line (and the copy button
    // anchored to it) spill outside the sidebar
    expect(block).toMatch(/pre\s*\{[^}]*overflow:\s*hidden/);
    expect(block).not.toMatch(/overflow:\s*visible/);
  });

  it("keeps the body itself inside the panel", () => {
    const block = markdownRules();

    expect(block).toMatch(/max-width:\s*100%/);
    expect(block).toMatch(/box-sizing:\s*border-box/);
  });

  it("wraps a long code line instead of scrolling it out of sight", () => {
    const block = markdownRules();

    // The reported symptom was code and tables ending at the panel edge with
    // no way to reach the rest: the inner boxes scrolled sideways, but behind a
    // Chromium overlay scrollbar nobody can see or find. `pre-wrap` keeps the
    // code's own line breaks *and* folds a too-long line onto the next one, so
    // there is nothing left to scroll.
    expect(block).toMatch(/white-space:\s*pre-wrap/);
    expect(block).not.toMatch(/white-space:\s*pre\s*;/);
    // and nothing inside a code block may scroll sideways any more
    expect(block).not.toMatch(/pre\s*\{[^}]*overflow-x:\s*auto/);
  });

  it("lays a wide table out to the panel instead of scrolling it", () => {
    const block = markdownRules();

    // `table-layout: fixed` with `width: 100%` makes the table obey the panel,
    // and the cells wrap. The old `display: block` + `overflow-x: auto` scrolled
    // sideways behind that same invisible scrollbar.
    expect(block).toMatch(/table\s*\{[^}]*table-layout:\s*fixed/);
    expect(block).toMatch(/table\s*\{[^}]*width:\s*100%/);
    expect(block).not.toMatch(/table\s*\{[^}]*overflow-x:\s*auto/);
    // the old rule put `white-space: pre` on the table, which is what made a
    // wide table impossible to fit and forced the panel to grow
    expect(block).not.toMatch(/table\s*\{[^}]*white-space:\s*pre/);
  });

  it("wraps long unbroken runs instead of overflowing", () => {
    const block = markdownRules();

    expect(block).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("caps media to the panel width", () => {
    const block = markdownRules();

    expect(block).toMatch(/img,\s*video\s*\{[^}]*max-width:\s*100%/);
  });

  it("stops a wheel gesture inside the viewer chaining to the page", () => {
    expect(markdownRules()).toMatch(/overscroll-behavior:\s*contain/);
  });
});
