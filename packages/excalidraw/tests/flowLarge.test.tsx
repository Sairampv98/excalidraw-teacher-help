/**
 * AC-252 - a large chart is the teacher's choice (D-226).
 */

import { describe, expect, it } from "vitest";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { MIN_FLOW_FONT_SIZE, buildFlowPreset } from "../scene/flowPresets";
import { PAGE_HEIGHT, PAGE_SPACING, PAGE_WIDTH } from "../types";

import {
  expectArrowsBound,
  expectNoOverlap,
  insideRect,
  nodesOf,
  pageIndexOf,
  scriptOfSize,
} from "./helpers/flowLargeHelpers";

import type { FlowFitMode } from "../scene/flowChart";
import type { FlowPageRect } from "../scene/flowPresets";

const PAGE: FlowPageRect = {
  x: 0,
  y: 0,
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
};

const build = (
  preset: Parameters<typeof scriptOfSize>[0],
  count: number,
  fit?: FlowFitMode,
  wordy = false,
) =>
  buildFlowPreset(preset, scriptOfSize(preset, count, wordy), {
    seed: 5,
    page: PAGE,
    fit,
  });

const texts = (elements: readonly ExcalidrawElement[]) =>
  elements.filter(
    (element): element is ExcalidrawTextElement => element.type === "text",
  );

describe("AC-252 a large chart is the teacher's choice", () => {
  it("AC-252 fit to page is the default and offers the other two", () => {
    const refused = build("cycle", 100);

    expect(refused.ok).toBe(false);

    if (!refused.ok) {
      expect(refused.tooBig).toBe(true);
      // the message says what else can be done
      expect(refused.error).toMatch(/spread/i);
      expect(refused.error).toMatch(/larger/i);
    }

    // saying so is the same as saying nothing
    expect(build("cycle", 100, "page")).toEqual(refused);

    // a chart that fits is built the same way in every mode
    const small = build("process", 5);

    for (const fit of ["page", "spread", "larger"] as const) {
      const other = build("process", 5, fit);

      expect(other.ok && small.ok && other.elements).toEqual(
        small.ok && small.elements,
      );
    }
  });

  it("AC-252 spread over pages puts groups on the following pages", () => {
    const built = build("process", 150, "spread", true);

    expect(built.ok).toBe(true);

    if (!built.ok) {
      return;
    }

    expect(built.pages).toBeGreaterThan(1);

    const nodes = nodesOf(built.elements);

    expect(nodes).toHaveLength(150);

    // each shape is on its page's rect: the current page, then the ones after it
    for (const node of nodes) {
      const rect = {
        ...PAGE,
        x: pageIndexOf(node) * (PAGE.width + PAGE_SPACING),
      };

      expect(
        insideRect(node, rect),
        `${node.id} on page ${pageIndexOf(node)}`,
      ).toBe(true);
    }

    // in the order of the script: a page never holds a node before an earlier page's
    const order = nodes.map((node) => [
      pageIndexOf(node),
      Number(node.customData!.flow.nodeId.slice(1)),
    ]);

    for (let i = 1; i < order.length; i++) {
      expect(order[i][1]).toBeGreaterThan(order[i - 1][1]);
      expect(order[i][0]).toBeGreaterThanOrEqual(order[i - 1][0]);
    }

    // pages that already exist are used, with their ids
    const given = buildFlowPreset(
      "process",
      scriptOfSize("process", 150, true),
      {
        seed: 5,
        page: PAGE,
        fit: "spread",
        // only the current page exists: the others are for the caller to make
        pages: [{ rect: PAGE, pageId: "page-a" }],
      },
    );

    expect(given.ok).toBe(true);

    if (given.ok) {
      const ids = new Set(
        nodesOf(given.elements).map((n) => `${pageIndexOf(n)}:${n.pageId}`),
      );

      expect([...ids]).toContain("0:page-a");
      // the ones beyond are for the caller to make, and it finds them by the
      // page index each element carries
      expect(given.pages).toBeGreaterThan(1);
      expect(nodesOf(given.elements).some((n) => pageIndexOf(n) === 1)).toBe(
        true,
      );
      expect([...ids].some((id) => id.startsWith("1:page-a"))).toBe(false);
    }
  });

  it("AC-252 an arrow that crosses pages has a stub and a label on each side", () => {
    const built = build("process", 150, "spread", true);

    expect(built.ok).toBe(true);

    if (!built.ok) {
      return;
    }

    const stubs = built.elements.filter(
      (element) => element.customData?.flow?.role === "stub",
    );
    const labels = texts(built.elements).filter(
      (text) => text.customData?.flow?.role === "stub-label",
    );

    // one on each side of every crossing
    expect(stubs).toHaveLength((built.pages - 1) * 2);
    expect(labels).toHaveLength(stubs.length);

    // the first page says where it goes on; the next says where it came from
    expect(
      labels.filter((l) => pageIndexOf(l) === 0).map((l) => l.text),
    ).toEqual(["continues on page 2"]);
    expect(
      labels.filter((l) => pageIndexOf(l) === 1).map((l) => l.text),
    ).toContain("from page 1");

    // a stub is joined to its shape at one end and that is all
    for (const stub of stubs) {
      if (stub.type !== "arrow") {
        continue;
      }

      expect(Boolean(stub.startBinding) !== Boolean(stub.endBinding)).toBe(
        true,
      );
    }

    // the numbers follow the number of the page the chart starts on
    const later = buildFlowPreset(
      "process",
      scriptOfSize("process", 150, true),
      {
        seed: 5,
        page: PAGE,
        fit: "spread",
        pageNumber: 4,
      },
    );

    expect(
      later.ok &&
        texts(later.elements)
          .filter((t) => t.customData?.flow?.role === "stub-label")
          .map((t) => t.text)[0],
    ).toBe("continues on page 5");

    // and the shapes' ids never repeat across pages
    const ids = built.elements.map((element) => element.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("AC-252 allow larger than page builds one connected chart", () => {
    const built = build("cycle", 100, "larger");

    expect(built.ok).toBe(true);

    if (!built.ok) {
      return;
    }

    expect(built.pages).toBe(1);
    expect(nodesOf(built.elements)).toHaveLength(100);

    // larger than the page, and centred on it
    expect(built.bounds.width).toBeGreaterThan(PAGE.width);
    expect(built.bounds.x + built.bounds.width / 2).toBeCloseTo(
      PAGE.width / 2,
      0,
    );
    expect(built.bounds.y + built.bounds.height / 2).toBeCloseTo(
      PAGE.height / 2,
      0,
    );

    // one connected chart: a ring of arrows, each bound at both ends
    const arrows = built.elements.filter((e) => e.type === "arrow");

    expect(arrows).toHaveLength(100);
    expectArrowsBound(built.elements);
  });

  it("AC-252 no two shapes overlap and the text is at or above the floor", () => {
    for (const fit of ["spread", "larger"] as const) {
      for (const preset of ["process", "cycle", "network"] as const) {
        const built = build(preset, 100, fit);

        expect(built.ok, `${preset} ${fit}`).toBe(true);

        if (built.ok) {
          expectNoOverlap(built.elements);
          expect(built.fontSize).toBeGreaterThanOrEqual(MIN_FLOW_FONT_SIZE);

          for (const text of texts(built.elements)) {
            if (text.customData?.flow?.role === "label") {
              expect(text.fontSize).toBeGreaterThanOrEqual(MIN_FLOW_FONT_SIZE);
            }
          }
        }
      }
    }
  });
});
