/**
 * AC-230 and AC-231 - the label's letters are lit as letters, and the labels of
 * arrows are drawn above the animation (D-202, D-203).
 *
 * A label drawn again by the overlay is compared with the label element it
 * copies: its font, its size, its angle and its place, the place through the
 * library's own `sceneCoordsToViewportCoords`.
 */

import React from "react";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getFontFamilyString,
  getVerticalOffset,
  sceneCoordsToViewportCoords,
} from "@excalidraw/common";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import {
  setFlowClassPreview,
  startFlowAnimation,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "../components/FlowAnimationState";
import { Excalidraw } from "../index";
import { AnimationController } from "../renderer/animation";
import { exportToSvg } from "../scene/export";
import { flowFocusTransform } from "../scene/flowAnimation";
import { withFlowClass } from "../scene/flowClass";
import { highlightBoxOf } from "../scene/flowHighlight";
import { FLOW_LOOK_DEFAULTS } from "../scene/flowLook";
import { buildFlowPreset } from "../scene/flowPresets";
import { flowOfSelection } from "../scene/flowSelection";

import { API } from "./helpers/api";
import { act, cleanup, render } from "./test-utils";

import type { FlowClassSettings } from "../scene/flowClass";
import type { Renderer } from "../scene/Renderer";

const { h } = window;

const SETTINGS: FlowClassSettings = {
  ...FLOW_LOOK_DEFAULTS,
  node: "pulse",
  arrow: "token",
  speed: 240,
  // the loop stays on its first step for the whole test
  stepMs: 100000,
  loop: true,
};

/** a decision chart: its arrows carry labels, the yes and the no */
const chart = (
  settings: FlowClassSettings | null,
  change: (element: ExcalidrawElement) => ExcalidrawElement = (e) => e,
) => {
  const built = buildFlowPreset(
    "decision",
    "Start\n? Ready?\nGo\nWait\nFinish",
    {
      seed: 8,
    },
  );

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements.map((element) => {
    const marked =
      settings &&
      element.type !== "arrow" &&
      element.type !== "text" &&
      element.boundElements?.length
        ? { ...element, customData: withFlowClass(element, settings) }
        : element;

    return change(marked as ExcalidrawElement);
  }) as ExcalidrawElement[];
};

const mount = async (elements: ExcalidrawElement[], props = {}) => {
  await render(
    <Excalidraw
      handleKeyboardGlobally={true}
      initialData={{ elements: elements as never }}
      {...props}
    />,
  );

  act(() => {
    h.setState({ width: 1400, height: 900 });
  });
};

const live = () => h.elements.filter((element) => !element.isDeleted);

const arrowIds = () =>
  new Set(
    live()
      .filter((e) => e.type === "arrow")
      .map((e) => e.id),
  );

/** the labels bound to arrows: the yes and the no */
const arrowLabels = () =>
  live().filter(
    (element): element is ExcalidrawTextElement =>
      element.type === "text" &&
      !!element.containerId &&
      arrowIds().has(element.containerId),
  );

/** the label of the first step: the text bound to the first shape */
const firstLabel = () => {
  const shape = live().find(
    (element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      !!element.boundElements?.length,
  )!;

  return live().find(
    (element): element is ExcalidrawTextElement =>
      element.type === "text" && element.containerId === shape.id,
  )!;
};

const letters = () =>
  [
    ...document.querySelectorAll(".excalidraw__flow-class [data-flow-label]"),
  ].filter((node) => !node.closest("[data-flow-arrow-label]")) as HTMLElement[];

const arrowLabelCopies = () =>
  [...document.querySelectorAll("[data-flow-arrow-label]")] as HTMLElement[];

const renderer = () => (h.app as unknown as { renderer: Renderer }).renderer;

const spyOnRenderer = () => vi.spyOn(renderer(), "getRenderableElements");

/** what the canvas was given in the last render the editor made */
const lastDrawn = (spy: ReturnType<typeof spyOnRenderer>) =>
  (
    spy.mock.results.at(-1)?.value as {
      elementsMap: Map<string, ExcalidrawElement>;
    }
  ).elementsMap;

/** the lines of a copy, as the canvas would place them (D-211) */
const baselinesOf = (copy: Element) =>
  [...copy.querySelectorAll("tspan")].map((tspan) => ({
    x: parseFloat(tspan.getAttribute("x")!),
    y: parseFloat(tspan.getAttribute("y")!),
  }));

const viewMode = (on: boolean) =>
  act(() => {
    h.setState({ viewModeEnabled: on });
  });

afterEach(() => {
  vi.restoreAllMocks();
  stopFlowAnimation();
  setFlowClassPreview(false);
  updateFlowAnimationSettings({
    ...FLOW_LOOK_DEFAULTS,
    nodeStyle: "focus",
    arrowStyle: "none",
    speed: 240,
    camera: false,
    loop: true,
  });

  for (const key of [
    "flow-animation",
    "flow-animation-marks",
    "flow-animation-draw-on",
    "flow-animation-camera",
    "flow-class",
  ]) {
    AnimationController.cancel(key);
  }
});

describe("AC-230 the label's letters are highlighted as letters", () => {
  const LETTERS: FlowClassSettings = {
    ...SETTINGS,
    nodeTarget: "letters",
    nodeColor: "#ff0000",
  };

  it("AC-230 the letters are drawn again in the highlight colour", async () => {
    await mount(chart(LETTERS), { viewModeEnabled: true });

    expect(letters()).toHaveLength(1);
    expect(letters()[0].textContent).toBe(firstLabel().text);
    expect(letters()[0].getAttribute("class")).toContain(
      "excalidraw__flow-label--letters",
    );

    // the colour is the look's, set for the stylesheet to draw the letters with
    const shape = letters()[0].closest(
      ".excalidraw__flow-animation-shape",
    ) as HTMLElement;

    expect(shape.style.getPropertyValue("--flow-node-color")).toBe("#ff0000");
  });

  it("AC-230 in the label's own font size and place", async () => {
    await mount(chart(LETTERS), { viewModeEnabled: true });

    const label = firstLabel();
    const copy = letters()[0];

    const text = copy.querySelector("text") as SVGTextElement;

    expect(text.style.fontSize).toBe(`${label.fontSize}px`);
    expect(text.style.fontFamily).toBe(
      getFontFamilyString({ fontFamily: label.fontFamily }),
    );
    expect(parseFloat(copy.getAttribute("width")!)).toBeCloseTo(label.width);
    expect(parseFloat(copy.getAttribute("height")!)).toBeCloseTo(label.height);
    expect(text.style.whiteSpace).toBe("pre");

    // where it is: the oracle's place for the label's own corner
    const { x, y } = sceneCoordsToViewportCoords(
      { sceneX: label.x, sceneY: label.y },
      h.state,
    );
    const placed = (
      copy.closest(".excalidraw__flow-animation-shape") as HTMLElement
    ).style.transform;

    expect(placed).toContain(
      `translate(${x - h.state.offsetLeft}px, ${y - h.state.offsetTop}px)`,
    );
  });

  it("AC-230 at the label's angle", async () => {
    await mount(
      // a node and its label turn together: the label follows its container
      chart(LETTERS, (element) =>
        element.type === "arrow"
          ? element
          : ({ ...element, angle: 0.5 } as never),
      ),
      { viewModeEnabled: true },
    );

    expect(firstLabel().angle).toBe(0.5);
    expect(letters()[0].style.transform).toBe("rotate(0.5rad)");
  });

  it("AC-230 no rectangle is drawn round the letters", async () => {
    await mount(chart(LETTERS), { viewModeEnabled: true });

    expect(
      document.querySelectorAll(".excalidraw__flow-class [data-flow-outline]"),
    ).toHaveLength(0);
    expect(letters()).toHaveLength(1);
  });

  it("AC-230 the label in the document is not changed", async () => {
    await mount(chart(LETTERS));

    const before = JSON.stringify(h.elements);

    viewMode(true);

    expect(letters()).toHaveLength(1);
    expect(JSON.stringify(h.elements)).toBe(before);
    // the canvas's own letters are the label element's, still
    expect(firstLabel().strokeColor).not.toBe("#ff0000");
  });
});

describe("AC-231 the labels of arrows are above the animation", () => {
  it("AC-231 an arrow label is drawn again over the marks", async () => {
    await mount(chart(SETTINGS), { viewModeEnabled: true });

    // the yes and the no
    expect(arrowLabels().length).toBeGreaterThanOrEqual(2);
    expect(arrowLabelCopies()).toHaveLength(arrowLabels().length);
    expect(
      arrowLabelCopies()
        .map((c) => c.textContent)
        .sort(),
    ).toEqual(
      arrowLabels()
        .map((label) => label.text)
        .sort(),
    );

    // and they come after what is animated, so they are above it
    const marks = document.querySelector(
      ".excalidraw__flow-class .excalidraw__flow-marks",
    )!;

    for (const copy of arrowLabelCopies()) {
      expect(
        marks.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("AC-231 in the label's own font and colour", async () => {
    await mount(chart(SETTINGS), { viewModeEnabled: true });

    const label = arrowLabels()[0];
    const copy = arrowLabelCopies().find(
      (c) => c.getAttribute("data-flow-arrow-label") === label.id,
    )!;
    const inner = copy.querySelector("[data-flow-label]") as HTMLElement;

    const text = inner.querySelector("text") as SVGTextElement;

    expect(text.style.fontSize).toBe(`${label.fontSize}px`);
    expect(text.style.fontFamily).toBe(
      getFontFamilyString({ fontFamily: label.fontFamily }),
    );

    // the colour is the label's own, as the browser writes it
    const probe = document.createElement("div");

    probe.style.color = label.strokeColor;

    expect(inner.style.color).toBe(probe.style.color);
  });

  it("AC-231 nothing is drawn when nothing is animated", async () => {
    // marked, but nothing is animated along the arrows
    await mount(chart({ ...SETTINGS, arrow: "none" }));

    // The marked editor also has no arrow animation (AC-583).
    expect(arrowLabelCopies()).toHaveLength(0);

    // the class view: the nodes animate, the arrows do not
    viewMode(true);
    expect(arrowLabelCopies()).toHaveLength(0);

    // the moment something is animated along the arrows, the labels are drawn
    act(() => {
      for (const element of live()) {
        if (element.customData?.flow?.class) {
          API.updateElement(element, {
            customData: withFlowClass(element, { ...SETTINGS, arrow: "token" }),
          });
        }
      }
    });

    expect(arrowLabelCopies().length).toBeGreaterThan(0);

    // Leaving class view keeps a marked chart playing in the editor (AC-583).
    viewMode(false);
    expect(arrowLabelCopies().length).toBeGreaterThan(0);
    act(() => {
      for (const element of live()) {
        if (element.customData?.flow?.class) {
          API.updateElement(element, {
            customData: withFlowClass(element, null),
          });
        }
      }
    });
    // Unmarking stops the overlay and returns its labels to the canvas.
    expect(arrowLabelCopies()).toHaveLength(0);
  });

  it("AC-231 it is drawn in the class view too", async () => {
    await mount(chart(null));

    const map = h.app.scene.getNonDeletedElementsMap();
    const graph = flowOfSelection(
      Object.fromEntries(live().map((element) => [element.id, true])),
      live(),
      map,
    )!;

    // the animation overlay, played from the bar
    act(() => {
      updateFlowAnimationSettings({ arrowStyle: "beam" });
      startFlowAnimation(graph.steps, { mode: "play", graph });
    });

    expect(arrowLabelCopies()).toHaveLength(arrowLabels().length);

    act(() => {
      stopFlowAnimation();
    });

    expect(arrowLabelCopies()).toHaveLength(0);
  });
});

/** the first label gets two lines, so that the second line's place shows too */
const twoLines = (element: ExcalidrawElement) =>
  element.type === "text" && element.text === "Start"
    ? ({ ...element, text: "Go\non", originalText: "Go\non" } as never)
    : element;

describe("AC-237 what the overlay draws lines up with the canvas", () => {
  const LETTERS: FlowClassSettings = {
    ...SETTINGS,
    nodeTarget: "letters",
    nodeColor: "#ff0000",
  };

  it("AC-237 the letters are drawn at the canvas's baselines", async () => {
    await mount(chart(LETTERS, twoLines), { viewModeEnabled: true });

    const label = firstLabel();
    const lineHeightPx = label.fontSize * label.lineHeight;
    const offset = getVerticalOffset(
      label.fontFamily,
      label.fontSize,
      lineHeightPx,
    );
    const lines = baselinesOf(letters()[0]);

    expect(lines).toHaveLength(2);

    lines.forEach((line, index) => {
      // the canvas's rule: the line's index times the line height, and the
      // font's own offset down to the baseline
      expect(line.y).toBeCloseTo(index * lineHeightPx + offset, 5);
      // a centred label is drawn about the middle of its box
      expect(line.x).toBeCloseTo(label.width / 2, 5);
    });
  });

  it("AC-237 arrow labels use the same rule", async () => {
    await mount(chart(SETTINGS), { viewModeEnabled: true });

    for (const label of arrowLabels()) {
      const copy = arrowLabelCopies().find(
        (c) => c.getAttribute("data-flow-arrow-label") === label.id,
      )!;
      const lineHeightPx = label.fontSize * label.lineHeight;
      const offset = getVerticalOffset(
        label.fontFamily,
        label.fontSize,
        lineHeightPx,
      );

      expect(baselinesOf(copy)[0].y).toBeCloseTo(offset, 5);
    }
  });

  it("AC-237 a text highlight lifts about its own centre", async () => {
    await mount(
      // the label is off the node's centre, so its own centre is not the node's
      chart({ ...LETTERS, node: "focus" }, (element) =>
        element.type === "text" && element.text === "Start"
          ? ({ ...element, x: element.x + 20 } as never)
          : element,
      ),
      { viewModeEnabled: true },
    );

    const label = firstLabel();
    const focus = letters()[0].closest(
      ".excalidraw__flow-animation-focus",
    ) as HTMLElement;

    const probe = document.createElement("div");

    probe.style.transform = flowFocusTransform(
      highlightBoxOf(label),
      highlightBoxOf(label),
    );

    expect(focus.style.transform).toBe(probe.style.transform);
  });

  it("AC-237 the outline is inside the node's box", async () => {
    const OUTLINE: FlowClassSettings = { ...SETTINGS, nodeTarget: "shape" };

    for (const kind of ["rectangle", "ellipse", "diamond"] as const) {
      await mount(
        chart(OUTLINE, (element) =>
          element.type !== "arrow" &&
          element.type !== "text" &&
          element.boundElements?.length
            ? ({ ...element, type: kind } as never)
            : element,
        ),
        { viewModeEnabled: true },
      );

      const svg = document.querySelector(
        ".excalidraw__flow-class [data-flow-outline]",
      )!;
      const w = parseFloat(svg.getAttribute("width")!);
      const h2 = parseFloat(svg.getAttribute("height")!);
      const edge = (n: string | null) => parseFloat(n!);

      if (kind === "rectangle") {
        const rect = svg.querySelector("rect")!;

        expect(edge(rect.getAttribute("x"))).toBeGreaterThanOrEqual(1);
        expect(edge(rect.getAttribute("y"))).toBeGreaterThanOrEqual(1);
        expect(
          edge(rect.getAttribute("x")) + edge(rect.getAttribute("width")),
        ).toBeLessThanOrEqual(w - 1);
        expect(
          edge(rect.getAttribute("y")) + edge(rect.getAttribute("height")),
        ).toBeLessThanOrEqual(h2 - 1);
      } else if (kind === "ellipse") {
        const e = svg.querySelector("ellipse")!;

        expect(edge(e.getAttribute("rx"))).toBeLessThanOrEqual(w / 2 - 1);
        expect(edge(e.getAttribute("ry"))).toBeLessThanOrEqual(h2 / 2 - 1);
      } else {
        const points = svg
          .querySelector("polygon")!
          .getAttribute("points")!
          .split(" ")
          .map((p) => p.split(",").map(Number));

        for (const [x, y] of points) {
          expect(x).toBeGreaterThanOrEqual(1);
          expect(x).toBeLessThanOrEqual(w - 1);
          expect(y).toBeGreaterThanOrEqual(1);
          expect(y).toBeLessThanOrEqual(h2 - 1);
        }
      }

      cleanup();
    }
  });
});

describe("AC-239 a label is never seen twice", () => {
  it("AC-239 the canvas does not draw a label the overlay draws again", async () => {
    await mount(chart(SETTINGS));

    const spy = spyOnRenderer();

    viewMode(true);

    const drawn = lastDrawn(spy);

    // the yes and the no are the overlay's: once, above what is animated
    expect(arrowLabels().length).toBeGreaterThanOrEqual(2);

    for (const label of arrowLabels()) {
      expect(drawn.has(label.id)).toBe(false);
    }

    expect(arrowLabelCopies()).toHaveLength(arrowLabels().length);

    // what is not redrawn stays: the node's own label
    expect(drawn.has(firstLabel().id)).toBe(true);
  });

  it("AC-239 lit letters are the overlay's, and the canvas leaves them out", async () => {
    await mount(chart({ ...SETTINGS, nodeTarget: "letters" }));

    const spy = spyOnRenderer();

    viewMode(true);

    expect(lastDrawn(spy).has(firstLabel().id)).toBe(false);
    expect(letters()).toHaveLength(1);
  });

  it("AC-239 the canvas draws it again when the overlay stops", async () => {
    await mount(chart(SETTINGS));

    const spy = spyOnRenderer();

    viewMode(true);
    viewMode(false);

    expect(arrowLabelCopies()).toHaveLength(arrowLabels().length);
    act(() => {
      for (const element of live()) {
        if (element.customData?.flow?.class) {
          API.updateElement(element, {
            customData: withFlowClass(element, null),
          });
        }
      }
    });

    const drawn = lastDrawn(spy);

    for (const label of arrowLabels()) {
      expect(drawn.get(label.id)).toBe(label);
    }

    expect(arrowLabelCopies()).toHaveLength(0);
  });

  it("AC-239 moving the chart keeps one set of labels", async () => {
    await mount(chart(SETTINGS), { viewModeEnabled: true });

    const spy = spyOnRenderer();

    act(() => {
      for (const element of live()) {
        API.updateElement(element, { x: element.x + 150, y: element.y + 40 });
      }
    });

    expect(arrowLabelCopies()).toHaveLength(arrowLabels().length);

    for (const label of arrowLabels()) {
      expect(lastDrawn(spy).has(label.id)).toBe(false);
    }
  });

  it("AC-239 the document and an exported image keep the label", async () => {
    await mount(chart(SETTINGS));

    const exported = async () =>
      (
        await exportToSvg(
          h.app.scene.getNonDeletedElements(),
          {
            exportBackground: true,
            viewBackgroundColor: h.state.viewBackgroundColor,
          },
          {},
        )
      ).outerHTML;

    const before = await exported();
    const document_ = JSON.stringify(h.elements);

    viewMode(true);

    expect(arrowLabelCopies().length).toBeGreaterThan(0);
    expect(JSON.stringify(h.elements)).toBe(document_);
    expect(await exported()).toBe(before);

    for (const label of arrowLabels()) {
      expect(before).toContain(label.text);
    }
  });
});
