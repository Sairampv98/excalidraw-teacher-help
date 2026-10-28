/**
 * AC-262 - a timeline has a line and its boxes alternate (D-237).
 */

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { buildFlowPreset } from "../scene/flowPresets";
import { flowOfSelection } from "../scene/flowSelection";

import { expectNoOverlap, nodesOf } from "./helpers/flowLargeHelpers";

const PAGE = { x: 0, y: 0, width: 1920, height: 1080 };

const SCRIPT = "1990 Idea\n1995 Launch\n2005 Growth\n2010 Change\n2020 Today";

const build = (script = SCRIPT) => {
  const built = buildFlowPreset("timeline", script, {
    seed: 3,
    page: PAGE,
    chartId: "chart-timeline",
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements;
};

const role = (e: ExcalidrawElement) => e.customData?.flow?.role as string;

describe("AC-262 a timeline has a line and its boxes alternate", () => {
  it("AC-262 one line crosses the chart with a dot for each part", () => {
    const elements = build();
    // the line is a segment for each gap and a lead at each end (D-238)
    const line = elements.filter(
      (e) => role(e) === "timeline-line" || role(e) === "timeline-segment",
    );
    const dots = elements.filter((e) => role(e) === "timeline-dot");
    const stems = elements.filter((e) => role(e) === "timeline-stem");

    expect(line).toHaveLength(4 + 2);
    expect(dots).toHaveLength(5);
    expect(stems).toHaveLength(5);

    // every piece of it is horizontal, on the one line, and they meet end to end
    const pieces = [...line].sort((a, b) => a.x - b.x);

    for (const piece of pieces) {
      expect(piece.height).toBeCloseTo(0, 5);
      expect(piece.y).toBeCloseTo(pieces[0].y, 5);
    }

    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i].x).toBeCloseTo(pieces[i - 1].x + pieces[i - 1].width, 3);
    }

    // and it crosses every dot
    for (const dot of dots) {
      expect(dot.y + dot.height / 2).toBeCloseTo(pieces[0].y, 3);
      expect(dot.x).toBeGreaterThanOrEqual(pieces[0].x);
      expect(dot.x + dot.width).toBeLessThanOrEqual(
        pieces[pieces.length - 1].x + pieces[pieces.length - 1].width,
      );
    }

    // each box is over its dot
    nodesOf(elements).forEach((box, i) => {
      expect(box.x + box.width / 2).toBeCloseTo(
        dots[i].x + dots[i].width / 2,
        3,
      );
    });
  });

  it("AC-262 the boxes alternate above and below", () => {
    const elements = build();
    const [line] = elements.filter((e) => role(e) === "timeline-line");
    const boxes = nodesOf(elements);

    boxes.forEach((box, i) => {
      const middle = box.y + box.height / 2;

      if (i % 2 === 0) {
        // the first, the third ... are above the line
        expect(box.y + box.height, `box ${i}`).toBeLessThan(line.y);
        expect(middle).toBeLessThan(line.y);
      } else {
        expect(box.y, `box ${i}`).toBeGreaterThan(line.y);
        expect(middle).toBeGreaterThan(line.y);
      }
    });

    // each box is joined to its dot by a stem that ends on the box
    const stems = elements.filter((e) => role(e) === "timeline-stem");

    stems.forEach((stem, i) => {
      const box = boxes[i];
      // where the stem ends: its start and its last point
      const end =
        stem.type === "arrow"
          ? stem.y + stem.points[stem.points.length - 1][1]
          : 0;

      expect(end, `stem ${i}`).toBeCloseTo(
        i % 2 === 0 ? box.y + box.height : box.y,
        3,
      );
    });
  });

  it("AC-262 the boxes do not overlap", () => {
    expectNoOverlap(build());

    // a long timeline with long words
    const many = Array.from(
      { length: 12 },
      (_, i) => `${1900 + i * 10} Something that happened then`,
    ).join("\n");

    expectNoOverlap(build(many));
  });

  it("AC-262 the line joins nothing", () => {
    // what is not a segment between two boxes joins nothing: the lead past the
    // first and the last dot, and the stems (the segments are D-238)
    const elements = build();
    const loose = elements.filter(
      (e) => role(e) === "timeline-line" || role(e) === "timeline-stem",
    );

    expect(loose).toHaveLength(2 + 5);

    for (const piece of loose) {
      expect(piece.type === "arrow" && piece.startBinding).toBeFalsy();
      expect(piece.type === "arrow" && piece.endBinding).toBeFalsy();
      expect(piece.customData?.flow?.joins).toBeUndefined();

      // and no shape names it as bound
      expect(
        nodesOf(elements).every(
          (box) => !(box.boundElements ?? []).some((b) => b.id === piece.id),
        ),
      ).toBe(true);
    }

    // the boxes are the steps, left to right
    const map = new Map(elements.map((e) => [e.id, e]));
    const graph = flowOfSelection(
      Object.fromEntries(elements.map((e) => [e.id, true])),
      elements,
      map,
    )!;

    expect(graph.steps).toHaveLength(5);
    expect(graph.steps.map((s) => s.containerId)).toEqual(
      nodesOf(elements).map((n) => n.id),
    );
  });
});
