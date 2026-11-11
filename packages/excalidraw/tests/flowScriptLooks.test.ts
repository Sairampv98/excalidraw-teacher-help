import { describe, expect, it } from "vitest";

import type { ElementsMap } from "@excalidraw/element/types";

import { parseFlowScript, FLOW_SCRIPT_NODE_STYLES } from "../scene/flowScript";
import { buildFlowGraph } from "../scene/flowOrder";
import { applyFlowScript } from "../scene/flowApply";
import { glowingArrowsFor } from "../components/FlowAnimationOverlay";
import { buildFlowPreset } from "../scene/flowPresets";

describe("AC-602 script looks", () => {
  it("applies a header edit in place and keeps the other saved animation choices", () => {
    const made = buildFlowPreset("network", "A -> B", {
      seed: 8,
      chartId: "looks",
    });
    if (!made.ok) {
      throw new Error(made.error);
    }
    const elements = made.elements.map((element) =>
      element.customData?.flow.role === "node"
        ? {
            ...element,
            customData: {
              ...element.customData,
              flowPanelAnimation: { arrowStyle: "token", markColor: "#def" },
              flow: {
                ...element.customData.flow,
                class: { arrow: "beam", markColor: "#def" },
              },
            },
          }
        : element,
    );
    const changed = applyFlowScript({
      elements,
      chartId: "looks",
      preset: "network",
      script: "mark-color: #abc\nanimation: marching-tokens\nA -> B",
      fit: "page",
      shape: "own",
      page: { x: 0, y: 0, width: 1680, height: 1000 },
    });
    if (!changed.ok) {
      throw new Error(changed.error);
    }
    expect(changed.rebuilt).toBe(false);
    const anchor = changed.elements.find(
      (element) =>
        !element.isDeleted && element.customData?.flow.role === "node",
    )!;
    expect(anchor.id).toBe(elements[0].id);
    expect(anchor.customData?.flowPanelAnimation).toMatchObject({
      arrowStyle: "marching-token",
      markColor: "#abc",
    });
    expect(anchor.customData?.flow.class).toMatchObject({
      arrow: "marching-token",
      markColor: "#abc",
    });
  });
  it("layout, shape, backing, order and spacing are applied; arrows can be omitted", () => {
    const script =
      "shape: diamond\nlayout: TB\nfit: larger\nbackground: #abc\norder: reverse\nspacing: 120\nmarching: marching-tokens\nA\nB";
    const made = buildFlowPreset("process", script, { seed: 8 });
    if (!made.ok) {
      throw new Error(made.error);
    }
    const nodes = made.elements.filter(
      (element) => element.customData?.flow.role === "node",
    );
    expect(nodes.every((node) => node.type === "diamond")).toBe(true);
    expect(nodes[1].y).toBeGreaterThan(nodes[0].y);
    expect(
      made.elements.find(
        (element) => element.customData?.flow.role === "background",
      )?.backgroundColor,
    ).toBe("#abc");
    expect(nodes[0].customData?.flowPanelAnimation).toMatchObject({
      spacing: 120,
      marchingStyle: "marching-token",
    });
    const graph = buildFlowGraph(
      made.elements,
      new Map(
        made.elements.map((element) => [element.id, element]),
      ) as ElementsMap,
    );
    expect(graph.steps).toHaveLength(2);
    expect(graph.steps[0].containerId).toBe(nodes[1].id);
    const without = buildFlowPreset("process", "arrows: none\nA\nB", {
      seed: 9,
    });
    expect(
      without.ok &&
        without.elements.some((element) => element.type === "arrow"),
    ).toBe(false);
  });
  it("preserves all D-522 node words for the later animation engines", () => {
    for (const style of FLOW_SCRIPT_NODE_STYLES) {
      const flow = parseFlowScript("network", `A @style:${style}\nA -> B`);
      expect(flow.ok && flow.problems).toEqual([]);
      expect(flow.ok && flow.nodes[0].look?.nodeStyle).toBe(style);
      expect(flow.ok && flow.nodes[0].label).toBe("A");
    }
  });
  it("per-arrow overrides stay on their own script line", () => {
    const flow = parseFlowScript(
      "network",
      "A -> B @fill:#abc\nA -> C @outline:#def",
    );
    expect(flow.ok && flow.edges.map((edge) => edge.look)).toEqual([
      { fill: "#abc" },
      { outline: "#def" },
    ]);
  });
  it("reads and applies node and arrow colours and animation", () => {
    const script =
      "animation: marching-tokens\nspeed: 2\nbackground: #e7f5ff\norder: reverse\nA @fill:#ffe3e3 @outline:#862e9c @glow\nA -> B @style:marching-beam @outline:#1971c2 @glow";
    const flow = parseFlowScript("network", script);
    expect(flow.ok && flow.problems).toEqual([]);
    expect(flow.ok && flow.settings).toMatchObject({
      arrowStyle: "marching-token",
      speed: 480,
      background: "#e7f5ff",
      order: "reverse",
    });
    const made = buildFlowPreset("network", script, { seed: 8 });
    if (!made.ok) {
      throw new Error(made.error);
    }
    const node = made.elements.find(
      (element) =>
        element.customData?.flow.nodeId === "n0" &&
        element.customData.flow.role === "node",
    )!;
    expect(node.backgroundColor).toBe("#ffe3e3");
    expect(node.strokeColor).toBe("#862e9c");
    expect(node.customData?.flow.look.glowShape).toBe(true);
    const arrow = made.elements.find((element) => element.type === "arrow")!;
    expect(arrow.strokeColor).toBe("#1971c2");
    expect(arrow.customData?.flow.look.arrowStyle).toBe("marching-beam");
    expect(arrow.customData?.flow.look.glowMark).toBe(true);
    const map = new Map(
      made.elements.map((element) => [element.id, element]),
    ) as ElementsMap;
    const graph = buildFlowGraph(made.elements, map);
    expect(
      glowingArrowsFor(graph, graph.steps[0], map, false).map(
        (entry) => entry.id,
      ),
    ).toEqual([arrow.id]);
    expect(
      made.elements.find((element) => element.customData?.flowPanelAnimation)
        ?.customData?.flowPanelAnimation.arrowStyle,
    ).toBe("marching-token");
  });

  it.each([
    "A @fill:red",
    "A @style:nonsense",
    "A @oops",
    "speed: fast",
    "background: red",
    "order: random",
  ])("reports invalid %s with its line", (text) => {
    for (const preset of ["network", "process"] as const) {
      const flow = parseFlowScript(preset, `First\n\n${text}`);
      expect(flow.ok && flow.problems).toEqual(
        expect.arrayContaining([expect.objectContaining({ line: 3 })]),
      );
    }
  });

  it("reads every existing highlight colour, glow and target setting", () => {
    const flow = parseFlowScript(
      "process",
      "node-color: #abc\ntext-color: #def\nmark-color: #123\narrow-color: #456\nglow-shape: true\nglow-text: true\nglow-mark: true\nglow-arrow: true\nhide-arrow: true\nhighlight: letters\nnode-animation: pulse\narrow-animation: beam\nstep-ms: 900\nloop: false\nA\nB",
    );
    expect(flow.ok && flow.problems).toEqual([]);
    expect(flow.ok && flow.settings).toMatchObject({
      nodeColor: "#abc",
      textColor: "#def",
      markColor: "#123",
      arrowColor: "#456",
      glowShape: true,
      glowText: true,
      glowMark: true,
      glowArrow: true,
      hideArrow: true,
      nodeTarget: "letters",
      nodeStyle: "pulse",
      arrowStyle: "beam",
      durationMs: 900,
      loop: false,
    });
  });
});
