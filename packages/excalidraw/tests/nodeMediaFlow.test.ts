/**
 * AC-281 - the media of a node is part of the node's step (D-246).
 *
 * The flow is read as the animation reads it: the steps are the nodes, and the
 * media that lies over a node belongs to that node's step - it is not a step of
 * its own, it makes the step's box, and selecting it selects the flow.
 */

import { describe, expect, it } from "vitest";

import { arrayToMap } from "@excalidraw/common";
import {
  customDataWithMedia,
  mediaOf,
  mediaShapeOfNode,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { applyFlowScript } from "../scene/flowApply";
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

  describe("when the script is applied", () => {
    const PAGE = { x: 0, y: 0, width: 1920, height: 1080 };
    const SCRIPT = ["Start", "Work", "Finish"].join(String.fromCharCode(10));

    const built = () => {
      const made = buildFlowPreset("process", SCRIPT, {
        seed: 3,
        chartId: "chart-1",
        page: PAGE,
      });

      if (!made.ok) {
        throw new Error(made.error);
      }

      return made.elements as ExcalidrawElement[];
    };

    const lineOf = (element: ExcalidrawElement) =>
      String(element.customData?.flow?.nodeId);

    /** a chart with a picture in its first node, grouped with it as it is when it is put in */
    const withPicture = () => {
      const elements = built();
      const node = nodesOf(elements).sort((a, b) => a.y - b.y)[0];
      const words = elements.find(
        (element) => element.type === "text" && element.containerId === node.id,
      )!;
      const picture = mediaOver(node);
      const grouped = elements.map((element) =>
        element.id === node.id || element.id === words.id
          ? ({ ...element, groupIds: ["gid"] } as ExcalidrawElement)
          : element,
      );

      return {
        node,
        elements: [
          ...grouped,
          { ...picture, groupIds: ["gid"] } as ExcalidrawElement,
        ],
        pictureId: picture.id,
      };
    };

    const apply = (
      elements: ExcalidrawElement[],
      changes: { script?: string; shape?: "own" | "ellipse" },
    ) => {
      const result = applyFlowScript({
        elements,
        chartId: "chart-1",
        preset: "process",
        script: changes.script ?? SCRIPT,
        fit: "page",
        shape: changes.shape ?? "own",
        page: PAGE,
        seed: 9,
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      return result;
    };

    it("AC-281 the media comes across when the chart is made again", () => {
      const { node, elements, pictureId } = withPicture();
      // the chart's shape is changed: the chart is made again from the script
      const result = apply(elements, { shape: "ellipse" });

      expect(result.rebuilt).toBe(true);

      const live = result.elements.filter((element) => !element.isDeleted);
      const picture = live.find((element) => element.id === pictureId)!;
      const owner = live.find(
        (element) => element.id === mediaOf(picture)?.of,
      )!;

      // the picture is in the page still, and its node is the new one for the same line
      expect(owner).toBeDefined();
      expect(owner.id).not.toBe(node.id);
      expect(lineOf(owner)).toBe(lineOf(node));
      expect(live.some((element) => element.id === node.id)).toBe(false);

      // it needs fitting to the new node: no signature of the old one is kept
      expect(mediaOf(picture)!.sig).toBeUndefined();

      // and it is grouped with the new node and its words, as it was
      const gid = picture.groupIds[0];
      const words = live.find(
        (element) =>
          element.type === "text" && element.containerId === owner.id,
      )!;

      expect(gid).toBe("gid");
      expect(owner.groupIds).toContain(gid);
      expect(words.groupIds).toContain(gid);

      // the other nodes have no picture, and none was added to them
      expect(
        live.filter((element) => mediaOf(element)).map((m) => m.id),
      ).toEqual([pictureId]);
    });

    it("AC-281 the media of a node that has no line any more goes with it", () => {
      const { node, elements, pictureId } = withPicture();
      // the first line is taken out of the script
      const result = apply(elements, {
        script: ["Work", "Finish"].join(String.fromCharCode(10)),
      });

      const picture = result.elements.find(
        (element) => element.id === pictureId,
      )!;

      expect(picture.isDeleted).toBe(true);
      expect(
        result.elements.find((element) => element.id === node.id)!.isDeleted,
      ).toBe(true);

      // the nodes that stay have theirs as they were: none, and the chart is intact
      expect(
        result.elements.filter(
          (element) => !element.isDeleted && mediaOf(element),
        ),
      ).toHaveLength(0);
    });

    it("AC-281 the media of a node that stays is left as it is", () => {
      const { elements, pictureId } = withPicture();
      // a line is added at the end: the chart is changed in place
      const result = apply(elements, {
        script: ["Start", "Work", "Finish", "Check"].join(
          String.fromCharCode(10),
        ),
      });

      expect(result.rebuilt).toBe(false);

      const picture = result.elements.find(
        (element) => element.id === pictureId,
      )!;

      expect(picture.isDeleted).toBe(false);
      expect(
        result.elements.find((element) => element.id === mediaOf(picture)!.of)!
          .isDeleted,
      ).toBe(false);
    });
  });
});
