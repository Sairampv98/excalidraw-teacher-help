/**
 * AC-281 - the media of a node is part of the node's step (D-246).
 *
 * The flow is read as the animation reads it: the steps are the nodes, and the
 * media that lies over a node belongs to that node's step - it is not a step of
 * its own, it makes the step's box, and selecting it selects the flow.
 */

import { describe, expect, it } from "vitest";

import { arrayToMap } from "@excalidraw/common";
import { customDataWithMedia, mediaShapeOfNode } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { buildFlowGraph } from "../scene/flowOrder";
import { buildFlowPreset } from "../scene/flowPresets";
import { allFlows, flowOfSelection } from "../scene/flowSelection";

import { API } from "./helpers/api";

const chart = () => {
  const built = buildFlowPreset("process", "Start\nWork\nFinish", { seed: 3 });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements as ExcalidrawElement[];
};

/** the shapes of the chart, in the order of its steps */
const nodesOf = (elements: ExcalidrawElement[]) =>
  elements.filter(
    (element) => element.type !== "arrow" && element.type !== "text",
  );

/** a picture over a node, as `addMediaToNode` makes it, spilling past the node on the right */
const mediaOver = (node: ExcalidrawElement, spill = 0): ExcalidrawElement =>
  ({
    ...API.createElement({
      type: "image",
      fileId: "pic1" as never,
      x: node.x,
      y: node.y,
      width: node.width + spill,
      height: node.height,
    }),
    customData: customDataWithMedia(undefined, {
      of: node.id,
      shape: mediaShapeOfNode(node),
      radius: 0,
    }),
  } as ExcalidrawElement);

describe("AC-281 the media of a node is part of the node's step", () => {
  it("AC-281 the media is not a step of its own", () => {
    const elements = chart();
    const [first] = nodesOf(elements);
    const picture = mediaOver(first);
    const map = arrayToMap([...elements, picture]);
    const before = buildFlowGraph(elements, arrayToMap(elements));
    const after = buildFlowGraph([...elements, picture], map);

    // the same steps, in the same order, and the arrows still join them
    expect(after.steps.map((step) => step.containerId)).toEqual(
      before.steps.map((step) => step.containerId),
    );
    expect(after.edges).toEqual(before.edges);

    // the media is in the step of the node it is over
    const step = after.steps.find((s) => s.containerId === first.id)!;

    expect(step.elementIds).toContain(picture.id);
    expect(after.steps.some((s) => s.containerId === picture.id)).toBe(false);
  });

  it("AC-281 the step's box holds the media", () => {
    const elements = chart();
    const [first] = nodesOf(elements);
    const picture = mediaOver(first, 80);
    const graph = buildFlowGraph(
      [...elements, picture],
      arrayToMap([...elements, picture]),
    );
    const step = graph.steps.find((s) => s.containerId === first.id)!;

    // the box reaches as far as the media does, so a highlight holds all of it
    expect(step.box.x + step.box.width).toBeGreaterThanOrEqual(
      picture.x + picture.width,
    );

    // a media whose node is not in the flow is no step either
    const stray = mediaOver({ ...first, id: "gone" } as ExcalidrawElement);

    expect(buildFlowGraph([stray], arrayToMap([stray])).steps).toHaveLength(0);
  });

  it("AC-281 selecting the media selects the flow", () => {
    const elements = chart();
    const [first] = nodesOf(elements);
    const picture = mediaOver(first);
    const all = [...elements, picture];
    const map = arrayToMap(all);

    const flow = flowOfSelection({ [picture.id]: true }, all, map);

    expect(flow).not.toBeNull();
    expect(flow!.steps).toHaveLength(3);
    expect(
      flow!.steps.find((s) => s.containerId === first.id)!.elementIds,
    ).toContain(picture.id);

    // the class view's flows have it too
    const flows = allFlows(all, map);

    expect(flows).toHaveLength(1);
    expect(flows[0].steps).toHaveLength(3);
    expect(
      flows[0].steps.find((s) => s.containerId === first.id)!.elementIds,
    ).toContain(picture.id);
  });

  it("AC-281 media that is deleted leaves the flow as it was", () => {
    const elements = chart();
    const [first] = nodesOf(elements);
    const gone = { ...mediaOver(first), isDeleted: true } as ExcalidrawElement;
    const all = [...elements, gone];

    const flow = flowOfSelection({ [first.id]: true }, all, arrayToMap(all));

    expect(flow!.steps).toHaveLength(3);
    expect(
      flow!.steps.find((s) => s.containerId === first.id)!.elementIds,
    ).not.toContain(gone.id);
  });
});
