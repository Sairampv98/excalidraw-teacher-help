/**
 * AC-288 - the arrows of a chart follow its nodes (D-249).
 *
 * A node that something other than the editor changes - the script's Apply, a
 * layout - has the arrows bound to it put where the editor puts them.
 */

import React from "react";
import { describe, expect, it } from "vitest";

import { Excalidraw } from "@excalidraw/excalidraw";
import { buildFlowPreset } from "@excalidraw/excalidraw/scene/flowPresets";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { act, render, waitFor } from "@excalidraw/excalidraw/tests/test-utils";
import { newElementWith } from "@excalidraw/element";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  isChartNode,
  nodeGeometry,
  refreshBoundArrows,
} from "../sidebar/chartArrows";
import { NodeMediaDrop } from "../sidebar/NodeMediaPanel";

let api: ExcalidrawImperativeAPI;

const chart = () => {
  const built = buildFlowPreset(
    "process",
    ["Start", "Work", "Finish"].join(String.fromCharCode(10)),
    { seed: 5 },
  );

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements as ExcalidrawElement[];
};

const live = () => api.getSceneElements();

/** the first node and the arrow that leaves it (the chart runs left to right) */
const firstEdge = () => {
  const nodes = live()
    .filter(isChartNode)
    .sort((x, y) => x.x - y.x);
  const node = nodes[0];
  const arrow = live().find(
    (element) =>
      element.type === "arrow" && element.startBinding?.elementId === node.id,
  ) as ExcalidrawArrowElement;

  return { node, arrow };
};

const mount = async (elements: ExcalidrawElement[], withSync = true) => {
  await render(
    <Excalidraw
      onExcalidrawAPI={(value) => {
        api = value!;
      }}
      initialData={{ elements }}
    >
      {withSync ? <NodeMediaDrop /> : null}
    </Excalidraw>,
  );
  API.setAppState({ width: 1000, height: 1000 });
};

/** a node changed as the script's Apply changes it: in the scene, and not by the editor */
const change = (id: string, updates: Record<string, unknown>) =>
  act(() => {
    api.updateScene({
      elements: api
        .getSceneElementsIncludingDeleted()
        .map((element) =>
          element.id === id
            ? newElementWith(element, updates as never)
            : element,
        ),
    });
  });

describe("AC-288 the arrows of a chart follow its nodes", () => {
  it("AC-288 an arrow leaves the side of a node that has grown", async () => {
    await mount(chart());

    const { node, arrow } = firstEdge();
    const side = node.x + node.width;

    // the arrow leaves the right side of the node, as the builder drew it
    expect(Math.abs(arrow.x - side)).toBeLessThan(20);

    // the node grows wider (not so much that it meets the next one): the arrow follows its side
    change(node.id, { width: node.width * 1.3 });

    await waitFor(() => {
      expect(firstEdge().arrow.x).toBeGreaterThan(side + node.width * 0.2);
    });

    const now = firstEdge();

    expect(Math.abs(now.arrow.x - (now.node.x + now.node.width))).toBeLessThan(
      20,
    );

    // and the other end of the arrow is on the next node, not inside this one
    const end = now.arrow.x + now.arrow.points.at(-1)![0];
    const next = live().find(
      (element) => element.id === now.arrow.endBinding!.elementId,
    )!;

    expect(end).toBeGreaterThan(now.node.x + now.node.width);
    expect(end).toBeLessThanOrEqual(next.x + 20);
  });

  it("AC-288 an arrow follows a node that is moved, and one that changes shape", async () => {
    await mount(chart());

    const { node, arrow } = firstEdge();
    const start = { x: arrow.x, y: arrow.y };

    // moved down: the arrow leaves from the new height
    change(node.id, { y: node.y + 90 });
    await waitFor(() =>
      expect(firstEdge().arrow.y).toBeGreaterThan(start.y + 40),
    );

    // another shape, with another size
    const moved = firstEdge();

    change(node.id, { type: "ellipse", width: 150, height: 110 });
    await waitFor(() => {
      expect(firstEdge().arrow.x).toBeGreaterThan(moved.arrow.x + 15);
    });

    const now = firstEdge();

    expect(Math.abs(now.arrow.x - (now.node.x + now.node.width))).toBeLessThan(
      30,
    );
    // from the middle of the side, as it left the old shape
    expect(
      Math.abs(now.arrow.y - (now.node.y + now.node.height / 2)),
    ).toBeLessThan(30);
  });

  it("AC-288 the arrows as the builder made them are where the editor puts them, and it settles", async () => {
    await mount(chart());

    const elements = api.getSceneElementsIncludingDeleted();
    const nodes = new Set(elements.filter(isChartNode).map((node) => node.id));
    const refreshed = refreshBoundArrows(elements, nodes);

    // at most the gap the editor leaves round a shape is different
    for (const arrow of (refreshed ?? elements).filter(
      (element) => element.type === "arrow",
    )) {
      const original = elements.find((element) => element.id === arrow.id)!;

      expect(Math.abs(arrow.x - original.x)).toBeLessThan(12);
      expect(Math.abs(arrow.y - original.y)).toBeLessThan(12);
    }

    // a change settles: the arrows are put right once, and not again
    const { node } = firstEdge();

    change(node.id, { width: node.width * 1.3 });
    await waitFor(() =>
      expect(firstEdge().arrow.x).toBeGreaterThan(node.x + node.width + 15),
    );

    const version = firstEdge().arrow.version;

    await act(async () => {});
    await act(async () => {});
    expect(firstEdge().arrow.version).toBe(version);

    // the geometry of a node is what its arrows depend on
    expect(nodeGeometry(node)).toBe(nodeGeometry({ ...node }));
    expect(nodeGeometry(node)).not.toBe(nodeGeometry({ ...node, width: 1 }));
    expect(nodeGeometry(node)).not.toBe(
      nodeGeometry({ ...node, type: "ellipse" }),
    );
  });

  it("AC-288 without the sync the arrow is left where it was", async () => {
    // the control: the editor does not put the arrow right by itself when the
    // scene is changed under it, which is why the sync is there
    await mount(chart(), false);

    const { node, arrow } = firstEdge();

    change(node.id, { width: node.width * 2.5 });
    await act(async () => {});

    expect(firstEdge().arrow.x).toBeCloseTo(arrow.x, 3);
  });
});
