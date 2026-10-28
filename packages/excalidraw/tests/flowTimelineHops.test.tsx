/**
 * AC-267 - on a timeline the beam and the token run from box to box (D-240).
 *
 * The chart is built by the real builder; the path of a hop is read where the
 * animation reads it, from `arrowsFor`.
 */

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { arrowsFor } from "../components/FlowAnimationOverlay";
import { buildFlowPreset } from "../scene/flowPresets";
import { flowOfSelection } from "../scene/flowSelection";

import { nodesOf } from "./helpers/flowLargeHelpers";

const SCRIPT = "1990 Idea\n1995 Launch\n2005 Growth\n2020 Today";

const role = (e: ExcalidrawElement) => e.customData?.flow?.role as string;

const setup = () => {
  const built = buildFlowPreset("timeline", SCRIPT, {
    seed: 3,
    page: { x: 0, y: 0, width: 1920, height: 1080 },
    chartId: "chart-hops",
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  const elements = built.elements;
  const map = new Map(elements.map((e) => [e.id, e]));
  const graph = flowOfSelection(
    Object.fromEntries(elements.map((e) => [e.id, true])),
    elements,
    map,
  )!;

  return { elements, map, graph, boxes: nodesOf(elements) };
};

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

describe("AC-267 the beam and the token run from box to box on a timeline", () => {
  it("AC-267 a hop runs from the box through the dots to the next box", () => {
    const { elements, map, graph, boxes } = setup();
    const stems = elements.filter((e) => role(e) === "timeline-stem");

    // each stem says which box it belongs to
    expect(stems.map((s) => s.customData?.flow?.box)).toEqual(
      boxes.map((b) => b.id),
    );

    for (const style of ["beam", "token"] as const) {
      const [hop] = arrowsFor(style, graph, graph.steps[0], map);

      // a stem down to the dot, the line, a stem up to the next box
      expect(hop.path).toHaveLength(4);

      const [start, dot, nextDot, end] = hop.path;
      const first = boxes[0];
      const next = boxes[1];

      // it starts at the edge of the first box and ends at the edge of the next
      expect(near(start.x, first.x + first.width / 2), style).toBe(true);
      expect(near(end.x, next.x + next.width / 2), style).toBe(true);
      expect(
        near(start.y, first.y) || near(start.y, first.y + first.height),
        style,
      ).toBe(true);
      expect(
        near(end.y, next.y) || near(end.y, next.y + next.height),
        style,
      ).toBe(true);

      // and goes through the two dots, which are on the line
      expect(near(dot.y, nextDot.y), style).toBe(true);
      expect(dot.x).toBeLessThan(nextDot.x);
      expect(near(dot.x, start.x), style).toBe(true);
      expect(near(nextDot.x, end.x), style).toBe(true);
    }

    // and it starts again from the next box
    const [again] = arrowsFor("token", graph, graph.steps[1], map);

    expect(near(again.path[0].x, boxes[1].x + boxes[1].width / 2)).toBe(true);
    expect(near(again.path[3].x, boxes[2].x + boxes[2].width / 2)).toBe(true);

    // the last moment has nothing to run to
    expect(arrowsFor("token", graph, graph.steps[3], map)).toEqual([]);
  });

  it("AC-267 boxes above and below the line both work", () => {
    const { map, graph, boxes } = setup();

    // the boxes alternate, so one hop goes from below up and the next the
    // other way, and in both the ends are on opposite sides of the line
    const hops = [0, 1, 2].map(
      (i) => arrowsFor("beam", graph, graph.steps[i], map)[0].path,
    );

    expect(boxes[0].y).not.toBe(boxes[1].y);

    hops.forEach((path) => {
      const axis = path[1].y;

      expect(near(path[2].y, axis)).toBe(true);
      expect(near(path[0].y, axis)).toBe(false);
      expect(near(path[3].y, axis)).toBe(false);
    });

    // the first and the second hop leave from opposite sides of the line
    expect(Math.sign(hops[0][0].y - hops[0][1].y)).toBe(
      -Math.sign(hops[1][0].y - hops[1][1].y),
    );
  });

  it("AC-267 marching and pipe stay on the line", () => {
    const { elements, map, graph } = setup();
    const segments = elements.filter((e) => role(e) === "timeline-segment");

    for (const style of ["marching", "pipe"] as const) {
      const marked = arrowsFor(style, graph, graph.steps[0], map);

      expect(marked.map((m) => m.id)).toEqual(segments.map((s) => s.id));
      // the line piece alone: two points
      expect(marked.every((m) => m.path.length === 2)).toBe(true);
    }
  });
});
