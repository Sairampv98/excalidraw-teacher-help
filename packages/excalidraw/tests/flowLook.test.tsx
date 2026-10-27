/**
 * AC-219 to AC-225 - the look of the flow animation (D-189 to D-196).
 *
 * What the overlay draws is read from the DOM it produces, what is saved is
 * read from the elements' own data, and the pure rules (what is a colour, what
 * a node's outline is) are tested as pure functions.
 */

import fs from "node:fs";
import path from "node:path";

import React from "react";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_PROPORTIONAL_RADIUS, ROUNDNESS } from "@excalidraw/common";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import {
  applyFlowAnimationSnapshot,
  flowAnimationStateAtom,
  flowClassPreviewAtom,
  FLOW_SETTINGS_STORAGE_KEY,
  getFlowAnimationSnapshot,
  setFlowClassPreview,
  startFlowAnimation,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "../components/FlowAnimationState";
import { serializeAsJSON } from "../data/json";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";
import { AnimationController } from "../renderer/animation";
import {
  FLOW_CLASS_DEFAULTS,
  classStepAt,
  readFlowClass,
  withFlowClass,
} from "../scene/flowClass";
import { highlightShapeOf } from "../scene/flowHighlight";
import {
  FLOW_ACCENT_COLOR,
  FLOW_LOOK_DEFAULTS,
  FLOW_HIGHLIGHT_TARGETS,
  isFlowColor,
  readFlowLook,
} from "../scene/flowLook";
import { buildFlowPreset } from "../scene/flowPresets";
import { flowOfSelection } from "../scene/flowSelection";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, cleanup, fireEvent, render, screen, waitFor } from "./test-utils";

import type { FlowClassSettings } from "../scene/flowClass";

const { h } = window;

const SETTINGS: FlowClassSettings = {
  ...FLOW_LOOK_DEFAULTS,
  node: "pulse",
  arrow: "token",
  speed: 240,
  stepMs: 150,
  loop: true,
};

const styleSheet = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, relative), "utf8");

/** a preset's elements, its shapes marked for class when settings are given */
const chart = (
  settings: FlowClassSettings | null,
  change: (element: ExcalidrawElement) => ExcalidrawElement = (e) => e,
) => {
  const built = buildFlowPreset("process", "Plan\nTeach\nReview\nPractise", {
    seed: 5,
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements.map((element) => {
    const isShape =
      element.type !== "arrow" &&
      element.type !== "text" &&
      !!element.boundElements?.length;
    const marked =
      isShape && settings
        ? { ...element, customData: withFlowClass(element, settings) }
        : element;

    return isShape ? change(marked as ExcalidrawElement) : marked;
  }) as ExcalidrawElement[];
};

const mount = async (
  elements: ExcalidrawElement[],
  props: Record<string, unknown> = {},
) => {
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

const shapes = () =>
  live().filter(
    (element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      !!element.boundElements?.length,
  );

const classOverlay = () =>
  document.querySelector(".excalidraw__flow-class") as HTMLElement | null;

const select = (elements: ExcalidrawElement[]) =>
  act(() => {
    API.setSelectedElements(elements);
  });

const openLook = () =>
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Look" }));
  });

const tick = () =>
  act(() => {
    fireEvent.click(screen.getByLabelText("Show in class"));
  });

const flowGraphOf = (elements: readonly ExcalidrawElement[]) => {
  const map = new Map(elements.map((element) => [element.id, element]));

  return flowOfSelection(
    Object.fromEntries(elements.map((element) => [element.id, true])),
    elements,
    map,
  )!;
};

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

/* ------------------------------------------------------------------ AC-219 */

describe("AC-219 the highlight colour", () => {
  const nodeVar = () =>
    (
      document.querySelector("[data-flow-class-node]") as HTMLElement
    ).style.getPropertyValue("--flow-node-color");

  it("AC-219 the default is the accent colour", async () => {
    await mount(chart(SETTINGS), { viewModeEnabled: true });

    // nothing is set, so the stylesheet's own default - the accent - applies
    expect(nodeVar()).toBe("");
    expect(FLOW_LOOK_DEFAULTS.nodeColor).toBeNull();
    expect(FLOW_ACCENT_COLOR).toBe("var(--color-primary)");
    expect(styleSheet("../components/FlowAnimationOverlay.scss")).toContain(
      "var(--flow-node-color, var(--color-primary))",
    );
  });

  it("AC-219 the highlight is drawn in the chosen colour", async () => {
    for (const node of ["focus", "pulse"] as const) {
      await mount(chart({ ...SETTINGS, node, nodeColor: "#ff0000" }), {
        viewModeEnabled: true,
      });

      expect(nodeVar()).toBe("#ff0000");
    }

    // and the same colour is what the animation overlay uses while it plays
    act(() => {
      updateFlowAnimationSettings({ nodeColor: "#00ff00" });
    });
    act(() => {
      startFlowAnimation(flowGraphOf(live()).steps, {
        mode: "play",
        graph: flowGraphOf(live()),
      });
    });

    const host = document.querySelector(
      ".excalidraw__flow-animation",
    ) as HTMLElement;

    expect(host.style.getPropertyValue("--flow-node-color")).toBe("#00ff00");
  });

  it("AC-219 a value that is not a colour is the default", () => {
    for (const bad of ["red", "rgb(1,2,3)", "#12", "#ggg", 5, null, {}, ""]) {
      expect(isFlowColor(bad)).toBe(false);
    }

    for (const good of ["#fff", "#ff0000", "#ff000080"]) {
      expect(isFlowColor(good)).toBe(true);
    }

    updateFlowAnimationSettings({ nodeColor: "not-a-colour" });

    expect(editorJotaiStore.get(flowAnimationStateAtom).nodeColor).toBeNull();
    expect(readFlowLook({ nodeColor: "red" }).nodeColor).toBeNull();
    expect(readFlowLook({ nodeColor: "#abcdef" }).nodeColor).toBe("#abcdef");
  });

  it("AC-219 the colour is remembered between sessions", () => {
    updateFlowAnimationSettings({
      nodeColor: "#123456",
      nodeTarget: "letters",
    });

    const stored = JSON.parse(
      window.localStorage.getItem(FLOW_SETTINGS_STORAGE_KEY)!,
    );

    expect(stored).toMatchObject({
      nodeColor: "#123456",
      nodeTarget: "letters",
    });

    // what storage holds is read back defensively
    expect(readFlowLook(stored)).toMatchObject({
      nodeColor: "#123456",
      nodeTarget: "letters",
    });
    expect(
      readFlowLook({ nodeColor: 42, nodeTarget: "elsewhere" }),
    ).toMatchObject({ nodeColor: null, nodeTarget: "shape" });
  });

  it("AC-219 the colour reaches the class entry and the presenter snapshot", async () => {
    await mount(chart(null));

    act(() => {
      updateFlowAnimationSettings({
        nodeColor: "#123456",
        markColor: "#654321",
        arrowColor: "#abcdef",
        hideArrow: true,
        nodeTarget: "letters",
      });
    });
    select([shapes()[1]]);
    tick();

    for (const shape of shapes()) {
      expect(readFlowClass(shape)).toMatchObject({
        nodeColor: "#123456",
        markColor: "#654321",
        arrowColor: "#abcdef",
        hideArrow: true,
        nodeTarget: "letters",
      });
    }

    act(() => {
      startFlowAnimation(flowGraphOf(live()).steps, {
        mode: "present",
        graph: flowGraphOf(live()),
      });
    });

    expect(getFlowAnimationSnapshot()).toMatchObject({
      nodeColor: "#123456",
      markColor: "#654321",
      arrowColor: "#abcdef",
      hideArrow: true,
      nodeTarget: "letters",
    });
  });

  it("AC-219 the look controls are in a section of the bar", async () => {
    await mount(chart(null));
    select([shapes()[0]]);

    // closed until it is opened: the bar is as small as it was
    expect(screen.queryByLabelText("Highlight colour")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Look" })
        .getAttribute("aria-expanded"),
    ).toBe("false");

    openLook();

    expect(
      screen
        .getByRole("button", { name: "Look" })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    for (const label of [
      "Highlight colour",
      "Animation colour",
      "Arrow colour",
      "Highlight target",
    ]) {
      expect(screen.getByLabelText(label)).not.toBeNull();
    }

    expect(screen.getByLabelText("Hide arrow")).not.toBeNull();
    expect(screen.getByLabelText("Preview class loop")).not.toBeNull();

    // and a control there changes the setting
    // a swatch sets the colour
    act(() => {
      fireEvent.click(screen.getByLabelText("Highlight colour: Red"));
    });

    expect(editorJotaiStore.get(flowAnimationStateAtom).nodeColor).toBe(
      "#e03131",
    );
  });
});

/* ------------------------------------------------------------------ AC-221 */

/** a preset's chart with the label taken off every node */
const withoutLabels = (elements: ExcalidrawElement[]) =>
  elements
    .filter((element) => element.type !== "text")
    .map((element) =>
      element.boundElements
        ? {
            ...element,
            boundElements: element.boundElements.filter(
              (bound) => bound.type !== "text",
            ),
          }
        : element,
    ) as ExcalidrawElement[];

/** a class loop that stays on its first step for the whole test */
const STAY: FlowClassSettings = { ...SETTINGS, node: "focus", stepMs: 100000 };

const highlighted = () =>
  [...document.querySelectorAll("[data-flow-class-node]")] as HTMLElement[];

describe("AC-221 the highlight has five targets", () => {
  /** what is drawn for the step: outlines of boxes, and the letters */
  const drawn = () => {
    const wrappers = highlighted();

    return {
      outlines: wrappers
        .filter((wrapper) => wrapper.querySelector("[data-flow-outline]"))
        .map((wrapper) => parseFloat(wrapper.style.width)),
      letters: wrappers.filter((wrapper) =>
        wrapper.querySelector("[data-flow-label]"),
      ).length,
    };
  };

  const label = () =>
    live().find(
      (element): element is ExcalidrawTextElement =>
        element.type === "text" && element.containerId === shapes()[0].id,
    )!;

  it("AC-221 shape highlights the outline only", async () => {
    await mount(chart({ ...STAY, nodeTarget: "shape" }), {
      viewModeEnabled: true,
    });

    expect(drawn().letters).toBe(0);
    expect(drawn().outlines).toHaveLength(1);
    expect(drawn().outlines[0]).toBeCloseTo(shapes()[0].width);
  });

  it("AC-221 shape and text box highlights the outline and the box", async () => {
    await mount(chart({ ...STAY, nodeTarget: "shape-box" }), {
      viewModeEnabled: true,
    });

    expect(drawn().letters).toBe(0);
    expect(drawn().outlines).toHaveLength(2);
    expect(drawn().outlines[0]).toBeCloseTo(shapes()[0].width);
    expect(drawn().outlines[1]).toBeCloseTo(label().width);
  });

  it("AC-221 shape and text highlights the outline and the letters", async () => {
    await mount(chart({ ...STAY, nodeTarget: "shape-text" }), {
      viewModeEnabled: true,
    });

    expect(drawn().outlines).toHaveLength(1);
    expect(drawn().outlines[0]).toBeCloseTo(shapes()[0].width);
    expect(drawn().letters).toBe(1);
  });

  it("AC-221 text box highlights only the box", async () => {
    await mount(chart({ ...STAY, nodeTarget: "box" }), {
      viewModeEnabled: true,
    });

    expect(drawn().letters).toBe(0);
    expect(drawn().outlines).toHaveLength(1);
    expect(drawn().outlines[0]).toBeCloseTo(label().width);
    expect(label().width).toBeLessThan(shapes()[0].width);
  });

  it("AC-221 text highlights only the letters", async () => {
    await mount(chart({ ...STAY, nodeTarget: "letters" }), {
      viewModeEnabled: true,
    });

    // the letters, and nothing round them: no outline, no box
    expect(drawn().outlines).toHaveLength(0);
    expect(drawn().letters).toBe(1);
  });

  it("AC-221 a node without a label takes the shape", async () => {
    for (const nodeTarget of [
      "shape-box",
      "shape-text",
      "box",
      "letters",
    ] as const) {
      await mount(withoutLabels(chart({ ...STAY, nodeTarget })), {
        viewModeEnabled: true,
      });

      expect(drawn().letters).toBe(0);
      expect(drawn().outlines).toHaveLength(1);
      expect(drawn().outlines[0]).toBeCloseTo(shapes()[0].width);

      cleanup();
    }
  });

  it("AC-221 an old stored target is read as what it drew", async () => {
    // wave 7t's "text" drew the rectangle on the label's box
    expect(readFlowLook({ nodeTarget: "text" }).nodeTarget).toBe("box");
    expect(readFlowLook({ nodeTarget: "shape" }).nodeTarget).toBe("shape");
    expect(readFlowLook({ nodeTarget: "elsewhere" }).nodeTarget).toBe("shape");

    for (const target of FLOW_HIGHLIGHT_TARGETS) {
      expect(readFlowLook({ nodeTarget: target.id }).nodeTarget).toBe(
        target.id,
      );
    }

    // and a chart saved with it draws the box, not the letters
    await mount(
      chart(null).map((element) =>
        element.type !== "arrow" &&
        element.type !== "text" &&
        element.boundElements?.length
          ? ({
              ...element,
              customData: {
                flow: {
                  class: {
                    node: "focus",
                    arrow: "none",
                    speed: 240,
                    stepMs: 100000,
                    loop: true,
                    nodeTarget: "text",
                  },
                },
              },
            } as ExcalidrawElement)
          : element,
      ),
      { viewModeEnabled: true },
    );

    expect(drawn().letters).toBe(0);
    expect(drawn().outlines).toHaveLength(1);
    expect(drawn().outlines[0]).toBeCloseTo(label().width);
  });
});

/* ------------------------------------------------------------------ AC-222 */

describe("AC-222 the highlight has the node's own shape", () => {
  const outline = () =>
    document.querySelector(
      "[data-flow-class-node] [data-flow-outline]",
    ) as SVGElement;

  const asType =
    (type: "ellipse" | "diamond") => (element: ExcalidrawElement) =>
      ({ ...element, type } as ExcalidrawElement);

  it("AC-222 a rectangle keeps its corner roundness", async () => {
    const rounded = API.createElement({
      type: "rectangle",
      width: 200,
      height: 100,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
    });
    const square = API.createElement({
      type: "rectangle",
      width: 200,
      height: 100,
      roundness: null,
    });

    expect(highlightShapeOf(rounded)).toMatchObject({
      kind: "rect",
      radius: 100 * DEFAULT_PROPORTIONAL_RADIUS,
    });
    expect(highlightShapeOf(square)).toMatchObject({ kind: "rect", radius: 0 });

    // and what is drawn is what the element says
    await mount(chart(STAY), { viewModeEnabled: true });

    expect(outline().getAttribute("data-flow-outline")).toBe("rect");
    expect(
      Number(outline().getAttribute("data-flow-outline-radius")),
    ).toBeCloseTo(highlightShapeOf(shapes()[0]).radius);
  });

  it("AC-222 an ellipse is highlighted as an ellipse", async () => {
    await mount(chart(STAY, asType("ellipse")), { viewModeEnabled: true });

    expect(outline().getAttribute("data-flow-outline")).toBe("ellipse");
    expect(outline().querySelector("ellipse")).not.toBeNull();
    expect(outline().querySelector("rect")).toBeNull();
  });

  it("AC-222 a diamond is highlighted as a diamond", async () => {
    await mount(chart(STAY, asType("diamond")), { viewModeEnabled: true });

    const { width: w, height: h2 } = shapes()[0];

    expect(outline().getAttribute("data-flow-outline")).toBe("diamond");
    expect(outline().querySelector("polygon")!.getAttribute("points")).toBe(
      `${w / 2},0 ${w},${h2 / 2} ${w / 2},${h2} 0,${h2 / 2}`,
    );
  });

  it("AC-222 a rotated node is highlighted at its angle", async () => {
    await mount(
      chart(STAY, (element) => ({ ...element, angle: 0.6 } as never)),
      { viewModeEnabled: true },
    );

    expect(outline().style.transform).toBe("rotate(0.6rad)");
    expect(highlightShapeOf(shapes()[0]).angle).toBe(0.6);
  });

  it("AC-222 a node with no outline takes its bounds", () => {
    for (const type of ["freedraw", "text", "image"] as const) {
      const element = API.createElement({
        type,
        width: 80,
        height: 40,
      } as never);

      expect(highlightShapeOf(element)).toEqual({
        kind: "rect",
        radius: 0,
        angle: 0,
      });
    }
  });

  it("AC-222 the dimming and the choices have the node's shape", async () => {
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

    await mount(
      built.elements.map((element) =>
        element.type !== "arrow" &&
        element.type !== "text" &&
        element.boundElements?.length
          ? ({ ...element, type: "ellipse" } as ExcalidrawElement)
          : (element as ExcalidrawElement),
      ),
    );

    const graph = flowGraphOf(live());

    act(() => {
      startFlowAnimation(graph.steps, { mode: "present", graph });
    });

    // the steps not reached yet are dimmed in the shape of their node
    const dims = [...document.querySelectorAll("[data-flow-dim]")];

    expect(dims.length).toBeGreaterThan(0);

    for (const dim of dims) {
      expect(dim.querySelector('[data-flow-outline="ellipse"]')).not.toBeNull();
    }

    // at the question the two branches are drawn in the node's shape too
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }),
      );
    });

    const choices = [...document.querySelectorAll("[data-flow-choice]")];

    expect(choices).toHaveLength(2);

    for (const choice of choices) {
      expect(
        choice.querySelector('[data-flow-outline="ellipse"]'),
      ).not.toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ AC-223 */

describe("AC-223 the editor can preview the class loop", () => {
  const markedFromTheEditor = async () => {
    await mount(chart(null));
    select([shapes()[1]]);
    tick();
  };

  it("AC-223 ticking show in class turns the preview on", async () => {
    await mount(chart(null));

    expect(editorJotaiStore.get(flowClassPreviewAtom)).toBe(false);
    expect(classOverlay()).toBeNull();

    select([shapes()[1]]);
    tick();

    expect(editorJotaiStore.get(flowClassPreviewAtom)).toBe(true);
    expect(classOverlay()).not.toBeNull();
  });

  it("AC-223 the preview plays in the edit view with nothing selected", async () => {
    await markedFromTheEditor();

    select([]);

    expect(Object.keys(h.state.selectedElementIds)).toEqual([]);
    expect(screen.queryByTestId("flow-bar")).toBeNull();
    expect(classOverlay()).not.toBeNull();
    expect(AnimationController.running("flow-class")).toBe(true);
  });

  it("AC-223 unticking or undoing takes the animation away", async () => {
    await markedFromTheEditor();

    // unticking takes the mark off, and the animation goes with it
    select([shapes()[1]]);
    tick();

    expect(shapes().every((shape) => readFlowClass(shape) === null)).toBe(true);
    expect(classOverlay()).toBeNull();

    // and so does undoing the tick
    tick();
    expect(classOverlay()).not.toBeNull();

    act(() => {
      Keyboard.undo();
    });

    expect(shapes().every((shape) => readFlowClass(shape) === null)).toBe(true);
    expect(classOverlay()).toBeNull();
  });

  it("AC-223 the preview is not saved or sent to the presenter", async () => {
    await markedFromTheEditor();

    expect(
      serializeAsJSON(h.elements, h.state, {}, "local").toLowerCase(),
    ).not.toContain("preview");

    // nothing is playing, so there is nothing for the presenter, and the
    // preview is no part of the animation's state or of what is remembered
    expect(getFlowAnimationSnapshot()).toBeNull();
    expect(editorJotaiStore.get(flowAnimationStateAtom)).not.toHaveProperty(
      "preview",
    );
    expect(
      (
        window.localStorage.getItem(FLOW_SETTINGS_STORAGE_KEY) ?? ""
      ).toLowerCase(),
    ).not.toContain("preview");
  });

  it("AC-223 the preview has no Steps button and never takes the pointer", async () => {
    await markedFromTheEditor();

    expect(screen.queryAllByRole("button", { name: "Steps" })).toHaveLength(0);
    expect(classOverlay()!.style.pointerEvents).toBe("none");
  });
});

/* ------------------------------------------------------------------ AC-224 */

describe("AC-224 a flow that is done holds its last step", () => {
  const timing = (elapsedMs: number, loop: boolean) =>
    classStepAt({ elapsedMs, stepCount: 4, stepMs: 100, loop });

  const index = () =>
    Number(
      document
        .querySelector("[data-flow-class-flow]")
        ?.getAttribute("data-flow-class-index"),
    );

  it("AC-224 a flow whose loop is off holds its last step once it is done", async () => {
    expect(timing(10_000, false)).toEqual({ index: 3, resting: true });

    await mount(
      chart({ ...SETTINGS, node: "focus", stepMs: 100, loop: false }),
      {
        viewModeEnabled: true,
      },
    );

    await waitFor(() => expect(index()).toBe(3), { timeout: 3000 });

    // and it stays there
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(index()).toBe(3);
  });

  it("AC-224 the last step stays highlighted", async () => {
    await mount(
      chart({ ...SETTINGS, node: "pulse", stepMs: 100, loop: false }),
      {
        viewModeEnabled: true,
      },
    );

    await waitFor(() => expect(index()).toBe(3), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // finished, and still drawn on its last node: it does not rest clean
    expect(highlighted()).toHaveLength(1);
    expect(
      highlighted()[0].querySelector(
        ".excalidraw__flow-animation-focus--pulse",
      ),
    ).not.toBeNull();
  });

  it("AC-224 a looping flow never reaches an end", () => {
    for (const elapsed of [0, 399, 400, 4000, 123456]) {
      expect(timing(elapsed, true).resting).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ AC-225 */

describe("AC-225 the look travels with the flow", () => {
  const LOOK: FlowClassSettings = {
    ...SETTINGS,
    nodeColor: "#111111",
    markColor: "#222222",
    arrowColor: "#333333",
    hideArrow: true,
    nodeTarget: "letters",
  };

  it("AC-225 the class entry carries the look", () => {
    const element = API.createElement({ type: "rectangle" });
    const marked = {
      ...element,
      customData: withFlowClass(element, LOOK),
    } as ExcalidrawElement;

    expect(readFlowClass(marked)).toEqual(LOOK);
    expect(marked.customData!.flow.class).toMatchObject({
      nodeColor: "#111111",
      hideArrow: true,
      nodeTarget: "letters",
    });
  });

  it("AC-225 an entry from before this wave takes the defaults", async () => {
    // an entry made before the look: nothing about colours or targets in it
    const old = {
      node: "pulse",
      arrow: "token",
      speed: 240,
      stepMs: 150,
      loop: true,
    };
    const element = {
      ...API.createElement({ type: "rectangle" }),
      customData: { flow: { class: old } },
    } as ExcalidrawElement;

    expect(readFlowClass(element)).toEqual({
      ...FLOW_CLASS_DEFAULTS,
      ...old,
    });
    expect(readFlowClass(element)).toMatchObject(FLOW_LOOK_DEFAULTS);

    // and it looks exactly as it did: no colour set, nothing covered
    await mount(
      chart(null).map((el) =>
        el.type !== "arrow" && el.type !== "text" && el.boundElements?.length
          ? ({
              ...el,
              customData: { flow: { class: old } },
            } as ExcalidrawElement)
          : el,
      ),
      { viewModeEnabled: true },
    );

    expect(highlighted()[0].style.getPropertyValue("--flow-node-color")).toBe(
      "",
    );
    expect(
      document.querySelectorAll('[data-flow-mark="arrow-cover"]'),
    ).toHaveLength(0);
  });

  it("AC-225 the presenter snapshot carries the look", async () => {
    await mount(chart(null));

    const graph = flowGraphOf(live());

    act(() => {
      updateFlowAnimationSettings({
        nodeColor: "#111111",
        markColor: "#222222",
        arrowColor: "#333333",
        hideArrow: true,
        nodeTarget: "letters",
      });
      startFlowAnimation(graph.steps, { mode: "present", graph });
    });

    const snapshot = getFlowAnimationSnapshot()!;

    expect(snapshot).toMatchObject({
      nodeColor: "#111111",
      markColor: "#222222",
      arrowColor: "#333333",
      hideArrow: true,
      nodeTarget: "letters",
    });

    // the other window puts it on its own state, as a mirror
    act(() => {
      stopFlowAnimation();
      updateFlowAnimationSettings({ ...FLOW_LOOK_DEFAULTS });
    });

    const map = h.app.scene.getNonDeletedElementsMap();

    act(() => {
      applyFlowAnimationSnapshot(snapshot, live(), map);
    });

    expect(editorJotaiStore.get(flowAnimationStateAtom)).toMatchObject({
      mirror: true,
      nodeColor: "#111111",
      markColor: "#222222",
      arrowColor: "#333333",
      hideArrow: true,
      nodeTarget: "letters",
    });
  });

  it("AC-225 a pasted chart keeps its look", async () => {
    await mount(chart(null));

    act(() => {
      updateFlowAnimationSettings({
        nodeColor: "#111111",
        markColor: "#222222",
        arrowColor: "#333333",
        hideArrow: true,
        nodeTarget: "letters",
      });
    });
    select([shapes()[0]]);
    tick();

    const originals = new Set(live().map((element) => element.id));

    act(() => {
      API.setSelectedElements(live());
    });
    act(() => {
      Keyboard.withModifierKeys({ ctrl: true }, () => {
        Keyboard.keyPress("d");
      });
    });

    const copies = shapes().filter((shape) => !originals.has(shape.id));

    expect(copies).toHaveLength(4);

    for (const copy of copies) {
      expect(readFlowClass(copy)).toMatchObject({
        nodeColor: "#111111",
        markColor: "#222222",
        arrowColor: "#333333",
        hideArrow: true,
        nodeTarget: "letters",
      });
    }
  });
});
