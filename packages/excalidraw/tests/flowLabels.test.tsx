/**
 * AC-230 and AC-231 - the label's letters are lit as letters, and the labels of
 * arrows are drawn above the animation (D-202, D-203).
 *
 * A label drawn again by the overlay is compared with the label element it
 * copies: its font, its size, its angle and its place, the place through the
 * library's own `sceneCoordsToViewportCoords`.
 */

import React from "react";

import { afterEach, describe, expect, it } from "vitest";

import {
  getFontFamilyString,
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
import { withFlowClass } from "../scene/flowClass";
import { FLOW_LOOK_DEFAULTS } from "../scene/flowLook";
import { buildFlowPreset } from "../scene/flowPresets";
import { flowOfSelection } from "../scene/flowSelection";

import { API } from "./helpers/api";
import { act, render } from "./test-utils";

import type { FlowClassSettings } from "../scene/flowClass";

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

const viewMode = (on: boolean) =>
  act(() => {
    h.setState({ viewModeEnabled: on });
  });

afterEach(() => {
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
    expect(letters()[0].className).toContain("excalidraw__flow-label--letters");

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

    expect(copy.style.fontSize).toBe(`${label.fontSize}px`);
    expect(copy.style.fontFamily).toBe(
      getFontFamilyString({ fontFamily: label.fontFamily }),
    );
    expect(parseFloat(copy.style.width)).toBeCloseTo(label.width);
    expect(parseFloat(copy.style.height)).toBeCloseTo(label.height);
    expect(copy.style.whiteSpace).toBe("pre");

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

    expect(inner.style.fontSize).toBe(`${label.fontSize}px`);
    expect(inner.style.fontFamily).toBe(
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

    // the edit view: nothing animates at all
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

    // and when the animation is gone, so are they
    viewMode(false);
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
