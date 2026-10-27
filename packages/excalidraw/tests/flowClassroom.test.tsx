/**
 * AC-213 to AC-216 and AC-218 - the class view, show in class, the class loop,
 * the Steps button and old documents (D-182 to D-188).
 *
 * What is marked is read back from the elements' own data, and what the class
 * loop draws is read from the DOM it produces.
 */

import React from "react";

import { afterEach, describe, expect, it } from "vitest";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import {
  flowAnimationStateAtom,
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
import { buildFlowPreset } from "../scene/flowPresets";
import { FLOW_TOKEN_RADIUS } from "../scene/flowStyles";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, fireEvent, render, screen, waitFor } from "./test-utils";

import type { FlowClassSettings } from "../scene/flowClass";

const { h } = window;

const PAGES = [
  { id: "page-1", name: "Page 1" },
  { id: "page-2", name: "Page 2" },
];

const SETTINGS: FlowClassSettings = {
  node: "pulse",
  arrow: "token",
  speed: 240,
  stepMs: 150,
  loop: true,
};

/** a preset's elements, with its shapes marked for class if asked to */
const chart = (
  settings: FlowClassSettings | null,
  options: { seed?: number; pageId?: string; dx?: number } = {},
) => {
  const built = buildFlowPreset("process", "Plan\nTeach\nReview\nPractise", {
    seed: options.seed ?? 5,
    pageId: options.pageId,
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements.map((element) => {
    const moved = options.dx
      ? { ...element, x: element.x + options.dx }
      : element;
    const isShape =
      element.type !== "arrow" &&
      element.type !== "text" &&
      !!element.boundElements?.length;

    return isShape && settings
      ? { ...moved, customData: withFlowClass(moved, settings) }
      : moved;
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

const animationOverlay = () =>
  document.querySelector(".excalidraw__flow-animation") as HTMLElement | null;

const viewMode = (on: boolean) =>
  act(() => {
    h.setState({ viewModeEnabled: on });
  });

const stepsButtons = () => screen.queryAllByRole("button", { name: "Steps" });

afterEach(() => {
  stopFlowAnimation();
  updateFlowAnimationSettings({
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

/* ------------------------------------------------------------------ AC-213 */

describe("AC-213 the edit view and the class view differ", () => {
  it("AC-213 in the edit view a marked chart does not animate by itself", async () => {
    await mount(chart(SETTINGS));

    expect(classOverlay()).toBeNull();
    expect(animationOverlay()).toBeNull();
    expect(AnimationController.running("flow-class")).toBe(false);
  });

  it("AC-213 in view mode it loops with nothing selected and no bar", async () => {
    await mount(chart(SETTINGS));

    expect(Object.keys(h.state.selectedElementIds)).toEqual([]);

    viewMode(true);

    expect(classOverlay()).not.toBeNull();
    expect(screen.queryByTestId("flow-bar")).toBeNull();
    expect(
      classOverlay()!.querySelector('[data-flow-mark="token"]'),
    ).not.toBeNull();
    expect(AnimationController.running("flow-class")).toBe(true);
  });

  it("AC-213 leaving view mode stops it", async () => {
    await mount(chart(SETTINGS), { viewModeEnabled: true });

    expect(classOverlay()).not.toBeNull();

    viewMode(false);

    expect(classOverlay()).toBeNull();
    expect(AnimationController.running("flow-class")).toBe(false);
  });

  it("AC-213 playing from the bar still writes nothing into the document", async () => {
    await mount(chart(null));

    const before = JSON.stringify(h.elements);

    act(() => {
      API.setSelectedElements([shapes()[0]]);
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
    });
    act(() => {
      stopFlowAnimation();
    });

    expect(JSON.stringify(h.elements)).toBe(before);
  });
});

/* ------------------------------------------------------------------ AC-214 */

describe("AC-214 show in class writes the animation into the chart", () => {
  const toggle = () =>
    act(() => {
      fireEvent.click(screen.getByLabelText("Show in class"));
    });

  const mountUnmarked = async () => {
    await mount(chart(null));

    act(() => {
      // one shape is enough: the whole connected flow is marked (D-180)
      API.setSelectedElements([shapes()[1]]);
    });
  };

  it("AC-214 switching it on marks every step of the flow, from one selected shape", async () => {
    await mountUnmarked();

    act(() => {
      updateFlowAnimationSettings({ arrowStyle: "pipe", nodeStyle: "pulse" });
    });

    toggle();

    expect(shapes().length).toBe(4);

    for (const shape of shapes()) {
      expect(readFlowClass(shape)).toEqual({
        node: "pulse",
        arrow: "pipe",
        speed: 240,
        stepMs: 1200,
        loop: true,
      });
    }
  });

  it("AC-214 it is one undo step", async () => {
    await mountUnmarked();

    toggle();

    expect(shapes().every((shape) => readFlowClass(shape))).toBe(true);

    act(() => {
      Keyboard.undo();
    });

    // one undo takes the mark off every step together
    expect(shapes().every((shape) => readFlowClass(shape) === null)).toBe(true);

    act(() => {
      Keyboard.redo();
    });

    expect(shapes().every((shape) => readFlowClass(shape))).toBe(true);
  });

  it("AC-214 the entry is ordinary saved data", async () => {
    await mountUnmarked();

    toggle();

    const saved = JSON.parse(
      serializeAsJSON(h.elements, h.state, {}, "local"),
    ) as { elements: ExcalidrawElement[] };

    const marked = saved.elements.filter(
      (element) => element.customData?.flow?.class,
    );

    expect(marked).toHaveLength(4);
    expect(marked[0].customData!.flow.class.arrow).toBe("none");
  });

  it("AC-214 a pasted chart is still marked", async () => {
    await mountUnmarked();

    toggle();

    const originals = new Set(live().map((element) => element.id));

    // the chart is copied the way the editor copies it: duplicated
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
    expect(copies.every((shape) => readFlowClass(shape))).toBe(true);
  });

  it("AC-214 changing a bar setting writes through while it is on", async () => {
    await mountUnmarked();

    toggle();

    fireEvent.change(screen.getByLabelText("Arrow animation"), {
      target: { value: "beam" },
    });
    fireEvent.change(screen.getByLabelText("Animation speed"), {
      target: { value: "480" },
    });

    for (const shape of shapes()) {
      expect(readFlowClass(shape)).toMatchObject({ arrow: "beam", speed: 480 });
    }
  });

  it("AC-214 switching it off removes the entry", async () => {
    await mountUnmarked();

    const roleBefore = shapes().map((shape) => shape.customData?.flow?.role);

    toggle();
    toggle();

    for (const shape of shapes()) {
      expect(shape.customData?.flow?.class).toBeUndefined();
    }

    // and what else was in the data is still there
    expect(shapes().map((shape) => shape.customData?.flow?.role)).toEqual(
      roleBefore,
    );
  });
});

/* ------------------------------------------------------------------ AC-215 */

describe("AC-215 the class loop", () => {
  const timing = (elapsedMs: number, loop = true, stepCount = 4) =>
    classStepAt({ elapsedMs, stepCount, stepMs: 1000, loop });

  it("AC-215 the steps follow each other every stepMs", () => {
    expect(timing(0).index).toBe(0);
    expect(timing(999).index).toBe(0);
    expect(timing(1000).index).toBe(1);
    expect(timing(2500).index).toBe(2);
    expect(timing(3999).index).toBe(3);
  });

  it("AC-215 the loop wraps and a flow with loop off rests on its last step", () => {
    expect(timing(4000).index).toBe(0);
    expect(timing(9000).index).toBe(1);

    expect(timing(2000, false)).toEqual({ index: 2, resting: false });
    expect(timing(3000, false)).toEqual({ index: 3, resting: true });
    expect(timing(99999, false)).toEqual({ index: 3, resting: true });
  });

  it("AC-215 two flows have independent clocks", async () => {
    const fast = chart({ ...SETTINGS, stepMs: 120 }, { seed: 1 });
    const slow = chart({ ...SETTINGS, stepMs: 100000 }, { seed: 2, dx: 1500 });

    await mount([...fast, ...slow], { viewModeEnabled: true });

    await waitFor(() =>
      expect(document.querySelectorAll("[data-flow-class-flow]")).toHaveLength(
        2,
      ),
    );

    // the fast one moves on, the slow one does not
    await waitFor(
      () => {
        const indices = [
          ...document.querySelectorAll("[data-flow-class-flow]"),
        ].map((flow) => Number(flow.getAttribute("data-flow-class-index")));

        expect(Math.max(...indices)).toBeGreaterThan(0);
        expect(Math.min(...indices)).toBe(0);
      },
      { timeout: 3000 },
    );
  });

  it("AC-215 only the shown page's flows are drawn", async () => {
    const onPage2 = chart(SETTINGS, { pageId: "page-2" });

    await mount(onPage2, { viewModeEnabled: true, pagesEnabled: true });

    act(() => {
      h.setState({ pages: PAGES, currentPageId: "page-1" });
    });

    expect(classOverlay()).toBeNull();
    expect(AnimationController.running("flow-class")).toBe(false);

    act(() => {
      h.setState({ currentPageId: "page-2" });
    });

    expect(classOverlay()).not.toBeNull();
  });

  it("AC-215 the marks follow a moved arrow and the chart scale", async () => {
    await mount(chart({ ...SETTINGS, node: "none", arrow: "marching" }), {
      viewModeEnabled: true,
    });

    const firstPoint = () =>
      classOverlay()!
        .querySelector("[data-flow-class-arrow] polyline")!
        .getAttribute("points")!
        .split(" ")[0]
        .split(",")
        .map(Number);

    const before = firstPoint();

    act(() => {
      for (const element of live()) {
        API.updateElement(element, { x: element.x + 300 });
      }
    });

    expect(firstPoint()[0]).toBeCloseTo(before[0] + 300);

    // and the marks are drawn at the chart's own size (D-175): a token on a
    // chart of twice the text size is twice as big
    act(() => {
      for (const element of live()) {
        if (element.type === "text") {
          API.updateElement(element, {
            fontSize: (element as ExcalidrawTextElement).fontSize * 2,
          });
        } else if (element.customData?.flow?.class) {
          API.updateElement(element, {
            customData: withFlowClass(element, {
              ...SETTINGS,
              node: "none",
              arrow: "token",
            }),
          });
        }
      }
    });

    const radius = Number(
      classOverlay()!
        .querySelector('[data-flow-mark="token"]')!
        .getAttribute("r"),
    );

    expect(radius).toBeCloseTo(FLOW_TOKEN_RADIUS * 2);
  });

  it("AC-215 nothing runs when no flow is marked", async () => {
    await mount(chart(null), { viewModeEnabled: true });

    expect(classOverlay()).toBeNull();
    expect(AnimationController.running("flow-class")).toBe(false);
    expect(document.querySelector("[data-flow-class-flow]")).toBeNull();
  });
});

/* ------------------------------------------------------------------ AC-216 */

describe("AC-216 the Steps button turns a chart into keyboard steps", () => {
  const animationState = () => editorJotaiStore.get(flowAnimationStateAtom);

  const press = (key: string) => {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(event);
    });

    return event;
  };

  it("AC-216 a marked chart has a Steps button in view mode", async () => {
    await mount(chart(SETTINGS), { viewModeEnabled: true });

    expect(stepsButtons()).toHaveLength(1);
  });

  it("AC-216 there is none in the edit view or in a display-only window", async () => {
    await mount(chart(SETTINGS));

    expect(stepsButtons()).toHaveLength(0);

    viewMode(true);
    expect(stepsButtons()).toHaveLength(1);
  });

  it("AC-216 a display-only window has no Steps button", async () => {
    await mount(chart(SETTINGS), {
      viewModeEnabled: true,
      flowDisplayOnly: true,
    });

    // it plays the loop, and it is not operated
    expect(classOverlay()).not.toBeNull();
    expect(stepsButtons()).toHaveLength(0);
  });

  it("AC-216 pressing it steps that chart with the arrow keys", async () => {
    await mount(chart(SETTINGS), { viewModeEnabled: true });

    act(() => {
      fireEvent.click(stepsButtons()[0]);
    });

    expect(animationState()).toMatchObject({
      active: true,
      mode: "present",
      mirror: false,
      index: 0,
    });
    expect(animationOverlay()).not.toBeNull();
    // the chart is stepped by the animation overlay, and no longer looped
    expect(document.querySelector("[data-flow-class-flow]")).toBeNull();

    press("ArrowRight");
    expect(animationState().index).toBe(1);

    press("ArrowRight");
    expect(animationState().index).toBe(2);

    press("ArrowLeft");
    expect(animationState().index).toBe(1);
  });

  it("AC-216 Esc returns it to looping", async () => {
    await mount(chart(SETTINGS), { viewModeEnabled: true });

    act(() => {
      fireEvent.click(stepsButtons()[0]);
    });
    press("Escape");

    expect(animationState().active).toBe(false);
    expect(animationOverlay()).toBeNull();
    expect(document.querySelector("[data-flow-class-flow]")).not.toBeNull();
    expect(stepsButtons()).toHaveLength(1);
  });

  it("AC-216 the other charts keep looping", async () => {
    const first = chart(SETTINGS, { seed: 1 });
    // the second plays once and rests on its last step, so where it is can be
    // told from where it would be if its clock had started again
    const second = chart(
      { ...SETTINGS, stepMs: 120, loop: false },
      { seed: 2, dx: 1500 },
    );

    await mount([...first, ...second], { viewModeEnabled: true });

    expect(stepsButtons()).toHaveLength(2);

    const indices = () =>
      [...document.querySelectorAll("[data-flow-class-flow]")].map((flow) =>
        Number(flow.getAttribute("data-flow-class-index")),
      );

    await waitFor(() => expect(indices()).toContain(3), { timeout: 3000 });

    act(() => {
      fireEvent.click(stepsButtons()[0]);
    });

    // one chart is being stepped, the other still loops, and has its button
    expect(document.querySelectorAll("[data-flow-class-flow]")).toHaveLength(1);
    expect(stepsButtons()).toHaveLength(1);
    expect(AnimationController.running("flow-class")).toBe(true);

    // and the other chart is where it was: stepping one chart does not send
    // the rest of the board back to their first step
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(indices()).toEqual([3]);
  });

  it("AC-216 the arrow keys are free when nothing is stepped", async () => {
    await mount(chart(SETTINGS), { viewModeEnabled: true });

    // looping: the keys are nobody's
    expect(press("ArrowRight").defaultPrevented).toBe(false);
    expect(press("ArrowLeft").defaultPrevented).toBe(false);

    act(() => {
      fireEvent.click(stepsButtons()[0]);
    });

    // stepping: they are the overlay's
    expect(press("ArrowRight").defaultPrevented).toBe(true);

    press("Escape");

    // and free again
    expect(press("ArrowRight").defaultPrevented).toBe(false);
  });
});

/* ------------------------------------------------------------------ AC-218 */

describe("AC-218 old documents and unmarked charts are untouched", () => {
  const withEntry = (entry: unknown) =>
    chart(null).map((element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      element.boundElements?.length
        ? {
            ...element,
            customData: {
              ...element.customData,
              flow: { ...element.customData?.flow, class: entry },
            },
          }
        : element,
    ) as ExcalidrawElement[];

  it("AC-218 an unmarked chart never loops in any view", async () => {
    await mount(chart(null));

    expect(classOverlay()).toBeNull();

    viewMode(true);

    expect(classOverlay()).toBeNull();
    expect(stepsButtons()).toHaveLength(0);
    expect(AnimationController.running("flow-class")).toBe(false);
  });

  it("AC-218 a partial entry gets defaults", () => {
    const shape = withEntry({ arrow: "beam" }).find(
      (e) => e.boundElements?.length,
    )!;

    expect(readFlowClass(shape)).toEqual({
      ...FLOW_CLASS_DEFAULTS,
      arrow: "beam",
    });

    // an entry with nothing in it is a marked flow with every default
    expect(
      readFlowClass(withEntry({}).find((e) => e.boundElements?.length)!),
    ).toEqual(FLOW_CLASS_DEFAULTS);

    // and a value of the wrong kind inside it is a default, not a crash
    expect(
      readFlowClass(
        withEntry({ node: "spin", speed: "fast", stepMs: 5, loop: "yes" }).find(
          (e) => e.boundElements?.length,
        )!,
      ),
    ).toEqual(FLOW_CLASS_DEFAULTS);
  });

  it("AC-218 a wrong-typed entry is not a marked flow", async () => {
    for (const entry of ["yes", 5, true, [], null]) {
      const shape = withEntry(entry).find((e) => e.boundElements?.length)!;

      expect(readFlowClass(shape)).toBeNull();
    }

    await mount(withEntry("yes"), { viewModeEnabled: true });

    expect(classOverlay()).toBeNull();
  });

  it("AC-218 marking a chart changes nothing else about its elements", async () => {
    await mount(chart(null));

    act(() => {
      API.setSelectedElements([shapes()[0]]);
    });

    const strip = (elements: readonly ExcalidrawElement[]) =>
      elements.map((element) => {
        const { customData, version, versionNonce, updated, ...rest } = element;

        return { ...rest, role: customData?.flow?.role };
      });

    const before = strip(live());

    act(() => {
      fireEvent.click(screen.getByLabelText("Show in class"));
    });

    expect(strip(live())).toEqual(before);
  });
});
