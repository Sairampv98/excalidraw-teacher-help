/**
 * AC-265 - the timeline's line is animated (D-238).
 *
 * The chart is built by the real builder and its animation's graph read where
 * the animation reads it: the flow of the chart and the arrows it draws along.
 */

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { arrowsFor } from "../components/FlowAnimationOverlay";
import { arrowLooksFor } from "../scene/flowArrowLooks";
import { buildFlowPreset } from "../scene/flowPresets";
import { flowOfSelection } from "../scene/flowSelection";

import { nodesOf } from "./helpers/flowLargeHelpers";

import type { FlowPresetId } from "../scene/flowScript";

const PAGE = { x: 0, y: 0, width: 1920, height: 1080 };

const SCRIPT = "1990 Idea\n1995 Launch\n2005 Growth\n2020 Today";

const role = (e: ExcalidrawElement) => e.customData?.flow?.role as string;

const build = (
  preset: FlowPresetId,
  script: string,
  options: Partial<Parameters<typeof buildFlowPreset>[2]> = {},
) => {
  const built = buildFlowPreset(preset, script, {
    seed: 3,
    page: PAGE,
    chartId: "chart-anim",
    ...options,
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements;
};

const graphOf = (elements: readonly ExcalidrawElement[]) => {
  const map = new Map(elements.map((e) => [e.id, e]));
  const graph = flowOfSelection(
    Object.fromEntries(elements.map((e) => [e.id, true])),
    elements,
    map,
  )!;

  return { graph, map };
};

describe("AC-265 the timeline's line is animated", () => {
  it("AC-265 the line is a segment for each gap and a lead at each end", () => {
    const elements = build("timeline", SCRIPT);
    const segments = elements.filter((e) => role(e) === "timeline-segment");
    const leads = elements.filter((e) => role(e) === "timeline-line");
    const dots = elements.filter((e) => role(e) === "timeline-dot");

    expect(segments).toHaveLength(3);
    expect(leads).toHaveLength(2);

    // a segment runs from the dot of one moment to the dot of the next, going
    // the way the script goes
    segments.forEach((segment, i) => {
      if (segment.type !== "arrow") {
        throw new Error("a segment is an arrow");
      }

      const end = segment.points[segment.points.length - 1];

      expect(segment.x).toBeCloseTo(dots[i].x + dots[i].width / 2, 3);
      expect(segment.x + end[0]).toBeCloseTo(
        dots[i + 1].x + dots[i + 1].width / 2,
        3,
      );
      expect(segment.startArrowhead).toBeNull();
      expect(segment.endArrowhead).toBeNull();
    });
  });

  it("AC-265 each segment joins its two boxes", () => {
    const elements = build("timeline", SCRIPT);
    const boxes = nodesOf(elements);
    const segments = elements.filter((e) => role(e) === "timeline-segment");

    segments.forEach((segment, i) => {
      expect(segment.customData?.flow?.joins).toEqual([
        boxes[i].id,
        boxes[i + 1].id,
      ]);
    });

    // and the animation's graph has them as the arrows of its edges
    const { graph } = graphOf(elements);

    expect(graph.edgeArrows.map((e) => e.arrowId)).toEqual(
      segments.map((s) => s.id),
    );
    expect(graph.edgeArrows.map((e) => [e.from, e.to])).toEqual(
      segments.map((_, i) => [boxes[i].id, boxes[i + 1].id]),
    );
  });

  it("AC-265 the steps follow the script", () => {
    const elements = build("timeline", SCRIPT);
    const { graph } = graphOf(elements);

    expect(graph.steps.map((s) => s.containerId)).toEqual(
      nodesOf(elements).map((n) => n.id),
    );
    expect(graph.edges).toHaveLength(3);

    // each step is joined to the next, and only to the next
    graph.edges.forEach((edge, i) => {
      expect(edge.from).toBe(graph.steps[i].containerId);
      expect(edge.to).toBe(graph.steps[i + 1].containerId);
    });
  });

  it("AC-265 the animation and the arrow looks act on the segments", () => {
    const elements = build("timeline", SCRIPT);
    const { graph, map } = graphOf(elements);
    const segments = elements.filter((e) => role(e) === "timeline-segment");

    // the token and the beam travel along the arrows that leave the current step
    for (const style of ["beam", "token"] as const) {
      const first = arrowsFor(style, graph, graph.steps[0], map);

      expect(
        first.map((a) => a.id),
        style,
      ).toEqual([segments[0].id]);
      // along the segment, from this moment's dot toward the next
      expect(first[0].path[0].x).toBeLessThan(
        first[0].path[first[0].path.length - 1].x,
      );
    }

    // the last moment has nothing to travel to
    expect(arrowsFor("token", graph, graph.steps[3], map)).toEqual([]);

    // the marching dashes and the pipe run along every segment
    expect(arrowsFor("marching", graph, graph.steps[0], map)).toHaveLength(3);

    // hiding and recolouring the arrow reach the segments
    const hidden = arrowLooksFor(graph, {
      hideArrow: true,
      arrowColor: null,
      glowArrow: false,
    });

    expect(hidden.map(([id]) => id)).toEqual(segments.map((s) => s.id));
    expect(hidden.every(([, look]) => look.hidden)).toBe(true);

    const coloured = arrowLooksFor(graph, {
      hideArrow: false,
      arrowColor: "#ff00ff",
    });

    expect(coloured.every(([, look]) => look.color === "#ff00ff")).toBe(true);
  });

  it("AC-265 with no arrows the segments join nothing", () => {
    const elements = build("timeline", SCRIPT, { arrows: "none" });
    const segments = elements.filter((e) => role(e) === "timeline-segment");

    // the line is still drawn, whole
    expect(segments).toHaveLength(3);

    for (const segment of segments) {
      expect(segment.customData?.flow?.joins).toBeUndefined();
    }

    const { graph, map } = graphOf(elements);

    expect(graph.edges).toHaveLength(0);
    expect(graph.edgeArrows).toHaveLength(0);
    // the steps are walked in the order of the script all the same, and nothing
    // travels between them
    expect(graph.steps.map((s) => s.containerId)).toEqual(
      nodesOf(elements).map((n) => n.id),
    );
    expect(arrowsFor("token", graph, graph.steps[0], map)).toEqual([]);
  });

  it("AC-265 a hierarchy's connectors are edges", () => {
    const elements = build("hierarchy", "Root\n  A\n    A1\n  B");
    const { graph, map } = graphOf(elements);
    const connectors = elements.filter(
      (e) => e.type === "arrow" && role(e) === "edge",
    );

    expect(connectors).toHaveLength(3);
    expect(graph.edges).toHaveLength(3);
    expect(graph.edgeArrows.map((e) => e.arrowId).sort()).toEqual(
      connectors.map((c) => c.id).sort(),
    );

    // a token runs along the connector from the parent to its child
    const root = graph.steps.find(
      (s) => map.get(s.containerId)!.customData?.flow?.nodeId === "n0",
    )!;
    const leaving = arrowsFor("token", graph, root, map);

    expect(leaving).toHaveLength(2);
  });
});
