import React from "react";

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import type { ElementsMap } from "@excalidraw/element/types";

import { FlowClassOverlay } from "../components/FlowClassOverlay";
import { buildFlowGraph } from "../scene/flowOrder";
import { buildFlowPreset } from "../scene/flowPresets";
import { staticNodeParts } from "../scene/flowHighlight";
import { FLOW_CLASS_DEFAULTS, withFlowClass } from "../scene/flowClass";

import { EditorJotaiProvider, editorJotaiStore } from "../editor-jotai";

const mounted = (settings: Record<string, unknown>) => {
  const built = buildFlowPreset("process", "A\nB\nC", { seed: 5 });
  if (!built.ok) {
    throw new Error(built.error);
  }
  const elements = built.elements.map((element) =>
    element.customData?.flow.role === "node"
      ? {
          ...element,
          customData: withFlowClass(element, {
            ...FLOW_CLASS_DEFAULTS,
            node: "none",
            arrow: "none",
            ...settings,
          } as never),
        }
      : element,
  );
  const map = new Map(
    elements.map((element) => [element.id, element]),
  ) as ElementsMap;
  const view = render(
    <FlowClassOverlay
      elements={elements}
      elementsMap={map}
      camera={{ scrollX: 0, scrollY: 0, zoom: { value: 1 } } as never}
      active
      displayOnly={false}
    />,
    {
      wrapper: ({ children }) => (
        <EditorJotaiProvider store={editorJotaiStore}>
          {children}
        </EditorJotaiProvider>
      ),
    },
  );
  return { view, elements, map };
};

describe("a colour or a glow shows with the node animation none", () => {
  it("lists every node of the chart once", () => {
    const { elements, map } = mounted({});
    const graph = buildFlowGraph(elements, map)!;
    const parts = staticNodeParts(graph.steps, map, "shape");
    expect(parts).toHaveLength(3);
    expect(new Set(parts.map((part) => part.element.id)).size).toBe(3);
  });

  it("lights all the nodes at once when a shape colour is chosen", () => {
    const { view } = mounted({ nodeColor: "#ff0000" });
    expect(
      view.container.querySelectorAll('[data-flow-class-node="none"]'),
    ).toHaveLength(3);
  });

  it("lights the nodes when only a glow is chosen", () => {
    const { view } = mounted({ glowShape: true });
    expect(
      view.container.querySelectorAll('[data-flow-class-node="none"]'),
    ).toHaveLength(3);
  });

  it("draws nothing with no colour and no glow, as before", () => {
    const { view } = mounted({});
    expect(
      view.container.querySelectorAll('[data-flow-class-node="none"]'),
    ).toHaveLength(0);
  });
});

describe("the neon core on a light page", () => {
  it("is the colour itself, not near-white, so the label does not vanish", async () => {
    const { drawFlowFrame } = await import("../scene/flowExport/compose");
    const { elements, map } = mounted({});
    const graph = buildFlowGraph(elements, map)!;
    const fills: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_target, name) =>
          name === "measureText" ? () => ({ width: 10 }) : () => undefined,
        set: (_target, name, value) => {
          if (name === "strokeStyle") {
            fills.push(String(value));
          }
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    const scene = (lightPage: boolean) => ({
      steps: graph.steps,
      graph,
      elementsMap: map,
      arrowStyle: "none" as const,
      nodeStyle: "pulse" as const,
      look: {
        ...FLOW_CLASS_DEFAULTS,
        nodeColor: "#ff0000",
        glowShape: true,
      } as never,
      speed: 240,
      durationMs: 1000,
      chartScale: 1,
      lightPage,
    });
    const size = { width: 100, height: 100 };
    const transform = { scale: 1, offsetX: 0, offsetY: 0 };
    drawFlowFrame(ctx, scene(true), 100, transform, null, size);
    expect(fills).toContain("#ff0000");
    fills.length = 0;
    drawFlowFrame(ctx, scene(false), 100, transform, null, size);
    expect(fills).not.toContain("#ff0000");
  });
});

describe("a lit label is not seen twice in the export", () => {
  it("clears its place and fills it from the chart without the label before drawing its letters", async () => {
    const { drawFlowFrame } = await import("../scene/flowExport/compose");
    const { elements, map } = mounted({});
    const graph = buildFlowGraph(elements, map)!;
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_target, name) =>
          name === "measureText"
            ? () => ({ width: 10 })
            : (...args: unknown[]) => {
                calls.push(
                  `${String(name)}${
                    name === "drawImage"
                      ? `:${(args[0] as { tag?: string }).tag}`
                      : ""
                  }`,
                );
              },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    const scene = {
      steps: graph.steps,
      graph,
      elementsMap: map,
      arrowStyle: "none" as const,
      nodeStyle: "pulse" as const,
      look: {
        ...FLOW_CLASS_DEFAULTS,
        nodeTarget: "shape-text",
        nodeColor: "#ff0000",
      } as never,
      speed: 240,
      durationMs: 1000,
      chartScale: 1,
    };
    const size = { width: 100, height: 100 };
    const transform = { scale: 1, offsetX: 0, offsetY: 0 };
    const full = { tag: "full" } as unknown as CanvasImageSource;
    const bare = { tag: "bare" } as unknown as CanvasImageSource;
    drawFlowFrame(ctx, scene, 100, transform, full, size, bare);
    const cleared = calls.indexOf("clearRect", 1);
    expect(calls).toContain("drawImage:bare");
    expect(calls.indexOf("drawImage:bare")).toBeGreaterThan(cleared);
    // the place is taken off before the neon is drawn, so the glow lies over it
    expect(calls.indexOf("stroke")).toBeGreaterThan(
      calls.indexOf("drawImage:bare"),
    );
    expect(calls.indexOf("fillText")).toBeGreaterThan(
      calls.indexOf("drawImage:bare"),
    );
    calls.length = 0;
    drawFlowFrame(ctx, scene, 100, transform, full, size, null);
    expect(calls).not.toContain("drawImage:bare");
  });
});

describe("the highlight can be the shape, the text box and the text together", () => {
  it('"all" lights the outline, the label box and the letters', async () => {
    const { nodeHighlightParts } = await import("../scene/flowHighlight");
    const { elements, map } = mounted({});
    const graph = buildFlowGraph(elements, map)!;
    const parts = nodeHighlightParts(graph.steps[0], map, "all");
    expect(parts.outline).not.toBeNull();
    expect(parts.box).not.toBeNull();
    expect(parts.letters).not.toBeNull();
    const { FLOW_HIGHLIGHT_TARGETS, readFlowTarget } = await import(
      "../scene/flowLook"
    );
    expect(FLOW_HIGHLIGHT_TARGETS.map((target) => target.id)).toContain("all");
    expect(readFlowTarget("all")).toBe("all");
  });
});

describe('the node and arrow animation "off" keeps the old nothing', () => {
  it('"off" draws nothing for a colour or a glow; "none" lights every node', () => {
    const none = mounted({ nodeColor: "#ff0000", node: "none" });
    expect(
      none.view.container.querySelectorAll('[data-flow-class-node="none"]'),
    ).toHaveLength(3);
    none.view.unmount();
    const off = mounted({ nodeColor: "#ff0000", node: "off" });
    expect(
      off.view.container.querySelectorAll("[data-flow-class-node]"),
    ).toHaveLength(0);
  });

  it('"off" for the arrows is no neon tube and no marks', async () => {
    const { glowingArrowsFor } = await import(
      "../components/FlowAnimationOverlay"
    );
    const { elements, map } = mounted({});
    const graph = buildFlowGraph(elements, map)!;
    expect(
      glowingArrowsFor(graph, graph.steps[0], map, true, "none").length,
    ).toBeGreaterThan(0);
    expect(glowingArrowsFor(graph, graph.steps[0], map, true, "off")).toEqual(
      [],
    );
  });
});
