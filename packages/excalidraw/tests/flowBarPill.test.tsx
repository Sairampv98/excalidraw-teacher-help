/**
 * AC-226 to AC-228 - the animation bar is a movable pill (D-197 to D-199).
 *
 * The pointer is played by hand: a press on the grip, moves of the window's
 * pointer and a release, as the browser would send them. What the bar does is
 * read from the DOM it produces and from the place it remembers.
 */

import React from "react";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  flowAnimationStateAtom,
  flowClassPreviewAtom,
  setFlowClassPreview,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "../components/FlowAnimationState";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";
import { AnimationController } from "../renderer/animation";
import { FLOW_BAR_PLACE_KEY } from "../scene/flowBarPlace";
import { FLOW_LOOK_DEFAULTS } from "../scene/flowLook";
import { buildFlowPreset } from "../scene/flowPresets";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen } from "./test-utils";

const { h } = window;

const VIEW = { width: 1400, height: 900 };

const GRIP = "Move the animation bar";

const chart = () => {
  const built = buildFlowPreset("process", "Plan\nTeach\nReview\nPractise", {
    seed: 5,
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements as ExcalidrawElement[];
};

const mount = async () => {
  const result = await render(
    <Excalidraw
      handleKeyboardGlobally={true}
      initialData={{ elements: chart() as never }}
    />,
  );

  act(() => {
    h.setState({ width: VIEW.width, height: VIEW.height });
  });

  return result;
};

const live = () => h.elements.filter((element) => !element.isDeleted);

const shapes = () =>
  live().filter(
    (element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      !!element.boundElements?.length,
  );

const select = (elements: ExcalidrawElement[]) =>
  act(() => {
    API.setSelectedElements(elements);
  });

const bar = () => screen.queryByTestId("flow-bar");
const pill = () => screen.queryByTestId("flow-bar-pill");

/** the bar's own place, as the stylesheet is given it */
const placeOf = (element: HTMLElement | null = bar() ?? pill()) => ({
  left: parseFloat(element!.style.left),
  top: parseFloat(element!.style.top),
});

const isPlaced = () => (bar() ?? pill())!.hasAttribute("data-flow-bar-placed");

/** one pointer event, as the browser would send it */
const pointer = (
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });

  Object.assign(event, { pointerId: 1 });

  act(() => {
    target.dispatchEvent(event);
  });
};

/** press on `target` at (x, y), drag by (dx, dy), and let go */
const drag = (target: Element, dx: number, dy: number, x = 500, y = 400) => {
  pointer(target, "pointerdown", x, y);
  pointer(window, "pointermove", x + dx, y + dy);
  pointer(window, "pointerup", x + dx, y + dy);
};

const grip = () => screen.getByLabelText(GRIP);

beforeEach(() => {
  window.localStorage.removeItem(FLOW_BAR_PLACE_KEY);
});

afterEach(() => {
  window.localStorage.removeItem(FLOW_BAR_PLACE_KEY);
  stopFlowAnimation();
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

/* ------------------------------------------------------------------ AC-226 */

describe("AC-226 the bar is movable, and stays where it is put", () => {
  it("AC-226 dragging the grip moves the bar", async () => {
    await mount();
    select([shapes()[1]]);

    const before = placeOf();

    expect(isPlaced()).toBe(false);

    drag(grip(), 60, 30);

    // by what the pointer moved, and it is a placed bar now
    expect(isPlaced()).toBe(true);
    expect(placeOf().left).toBeCloseTo(before.left + 60);
    expect(placeOf().top).toBeCloseTo(before.top + 30);
  });

  it("AC-226 the bar is kept inside the viewport", async () => {
    await mount();
    select([shapes()[1]]);

    drag(grip(), 9000, 9000);

    expect(placeOf().left).toBeLessThanOrEqual(VIEW.width);
    expect(placeOf().top).toBeLessThanOrEqual(VIEW.height);

    drag(grip(), -20000, -20000);

    expect(placeOf().left).toBeGreaterThanOrEqual(0);
    expect(placeOf().top).toBeGreaterThanOrEqual(0);
  });

  it("AC-226 the bar snaps to a near edge", async () => {
    await mount();
    select([shapes()[1]]);

    // dropped 20px from the left edge: pulled onto it, with the margin
    drag(grip(), 20 - placeOf().left, 0);

    expect(placeOf().left).toBe(8);

    // dropped well away from every edge: left where it was dropped
    const x = placeOf().left;

    drag(grip(), 300, 0);

    expect(placeOf().left).toBeCloseTo(x + 300);
  });

  it("AC-226 a moved bar stays put when the chart or the view moves", async () => {
    await mount();
    select([shapes()[1]]);

    drag(grip(), 40, 20);

    const put = placeOf();

    act(() => {
      for (const element of live()) {
        API.updateElement(element, { x: element.x - 100, y: element.y + 60 });
      }
    });

    expect(placeOf()).toEqual(put);

    act(() => {
      h.setState({ scrollX: h.state.scrollX + 120, scrollY: -80 });
    });
    act(() => {
      h.setState({ zoom: { value: 0.8 as never } });
    });

    expect(placeOf()).toEqual(put);
  });

  it("AC-226 double-clicking the grip follows the chart again", async () => {
    await mount();
    select([shapes()[1]]);

    const following = placeOf();

    drag(grip(), 200, 100);

    expect(isPlaced()).toBe(true);

    act(() => {
      fireEvent.doubleClick(grip());
    });

    expect(isPlaced()).toBe(false);
    expect(placeOf()).toEqual(following);
  });

  it("AC-226 the place is remembered", async () => {
    const first = await mount();

    select([shapes()[1]]);
    drag(grip(), 120, 60);

    const put = placeOf();

    expect(
      JSON.parse(window.localStorage.getItem(FLOW_BAR_PLACE_KEY)!),
    ).toMatchObject({ x: put.left, y: put.top });

    // a new session: the same bar, in the same place
    first.unmount();
    await mount();
    select([shapes()[1]]);

    expect(isPlaced()).toBe(true);
    expect(placeOf()).toEqual(put);
  });

  it("AC-226 an unusable remembered place is ignored", async () => {
    for (const stored of [
      JSON.stringify({ x: 99999, y: 99999, collapsed: false }),
      JSON.stringify({ x: "left", y: null }),
      JSON.stringify({ x: -500, y: 20 }),
      "not json at all",
    ]) {
      window.localStorage.setItem(FLOW_BAR_PLACE_KEY, stored);

      const result = await mount();

      select([shapes()[1]]);

      // the bar follows the chart, as if nothing had been remembered
      expect(bar()).not.toBeNull();
      expect(isPlaced()).toBe(false);

      result.unmount();
    }
  });
});

/* ------------------------------------------------------------------ AC-227 */

describe("AC-227 the bar collapses into a pill", () => {
  const collapse = () =>
    act(() => {
      fireEvent.click(
        screen.getByLabelText("Collapse the animation bar into a pill"),
      );
    });

  it("AC-227 the collapse button leaves a pill", async () => {
    await mount();
    select([shapes()[1]]);

    collapse();

    expect(bar()).toBeNull();
    expect(pill()).not.toBeNull();
    // the controls are gone with the bar
    expect(screen.queryByLabelText("Animation speed")).toBeNull();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  });

  it("AC-227 pressing the pill opens the bar", async () => {
    await mount();
    select([shapes()[1]]);
    collapse();

    // pressed and let go, without moving: that is a click
    pointer(pill()!, "pointerdown", 300, 300);
    pointer(window, "pointerup", 300, 300);

    expect(pill()).toBeNull();
    expect(bar()).not.toBeNull();
  });

  it("AC-227 a playing flow keeps playing while collapsed", async () => {
    await mount();
    select([shapes()[1]]);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
    });

    const settings = { ...editorJotaiStore.get(flowAnimationStateAtom) };

    collapse();

    const after = editorJotaiStore.get(flowAnimationStateAtom);

    expect(after.active).toBe(true);
    expect(after.nodeStyle).toBe(settings.nodeStyle);
    expect(after.arrowStyle).toBe(settings.arrowStyle);
    expect(after.speed).toBe(settings.speed);
    expect(
      document.querySelector(".excalidraw__flow-animation"),
    ).not.toBeNull();
    expect(pill()).not.toBeNull();
  });

  it("AC-227 the collapsed state is remembered", async () => {
    const first = await mount();

    select([shapes()[1]]);
    collapse();

    expect(
      JSON.parse(window.localStorage.getItem(FLOW_BAR_PLACE_KEY)!),
    ).toMatchObject({ collapsed: true });

    first.unmount();
    await mount();
    select([shapes()[1]]);

    expect(pill()).not.toBeNull();
    expect(bar()).toBeNull();
  });
});

/* ------------------------------------------------------------------ AC-228 */

describe("AC-228 moving the bar does not touch the canvas", () => {
  it("AC-228 dragging the grip leaves the selection and the elements alone", async () => {
    await mount();
    select([shapes()[1]]);

    const selection = JSON.stringify(h.state.selectedElementIds);
    const elements = JSON.stringify(h.elements);

    drag(grip(), 80, 40);

    expect(JSON.stringify(h.state.selectedElementIds)).toBe(selection);
    expect(JSON.stringify(h.elements)).toBe(elements);

    // and the same for the pill
    act(() => {
      fireEvent.click(
        screen.getByLabelText("Collapse the animation bar into a pill"),
      );
    });
    drag(pill()!, 50, 20);

    expect(JSON.stringify(h.state.selectedElementIds)).toBe(selection);
    expect(JSON.stringify(h.elements)).toBe(elements);
  });

  it("AC-228 the controls still work after a move", async () => {
    await mount();
    select([shapes()[1]]);

    drag(grip(), 80, 40);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Present steps" }));
    });

    expect(editorJotaiStore.get(flowAnimationStateAtom)).toMatchObject({
      active: true,
      mode: "present",
    });

    act(() => {
      stopFlowAnimation();
    });
    fireEvent.change(screen.getByLabelText("Node animation"), {
      target: { value: "pulse" },
    });

    expect(editorJotaiStore.get(flowAnimationStateAtom).nodeStyle).toBe(
      "pulse",
    );
  });

  it("AC-228 a window resize brings the bar back inside", async () => {
    await mount();
    select([shapes()[1]]);

    // far to the right and low down, as far as the window allows
    drag(grip(), 5000, 5000);

    expect(placeOf().left).toBeGreaterThan(600);

    act(() => {
      h.setState({ width: 600, height: 400 });
    });

    expect(placeOf().left).toBeLessThanOrEqual(600 - 8);
    expect(placeOf().top).toBeLessThanOrEqual(400 - 8);
  });
});

describe("AC-240 it is clear how to exit the animation", () => {
  const collapse = () =>
    act(() => {
      fireEvent.click(
        screen.getByLabelText("Collapse the animation bar into a pill"),
      );
    });

  const play = () =>
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
    });

  const active = () => editorJotaiStore.get(flowAnimationStateAtom).active;

  const escape = (target: Document | Element = document) =>
    act(() => {
      fireEvent.keyDown(target, { key: "Escape" });
    });

  it("AC-240 the pill says what is running and has a Stop button", async () => {
    await mount();
    select([shapes()[1]]);

    // nothing runs: the pill is just the pill
    collapse();
    expect(pill()!.textContent).not.toMatch(/Playing/);
    expect(screen.queryByTestId("flow-bar-pill-stop")).toBeNull();

    // press it open, play, and minimise again
    pointer(pill()!, "pointerdown", 300, 300);
    pointer(window, "pointerup", 300, 300);
    play();
    collapse();

    expect(pill()!.textContent).toMatch(/Playing/);
    expect(screen.getByTestId("flow-bar-pill-stop")).not.toBeNull();
  });

  it("AC-240 the bar says what runs and has a Stop button too", async () => {
    await mount();
    select([shapes()[1]]);

    expect(screen.queryByTestId("flow-bar-stop")).toBeNull();

    play();

    expect(screen.getByTestId("flow-bar-stop")).not.toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId("flow-bar-stop"));
    });

    expect(active()).toBe(false);
    expect(screen.queryByTestId("flow-bar-stop")).toBeNull();
  });

  it("AC-240 Stop on the pill ends the animation", async () => {
    await mount();
    select([shapes()[1]]);
    play();
    collapse();

    expect(active()).toBe(true);

    act(() => {
      fireEvent.click(screen.getByTestId("flow-bar-pill-stop"));
    });

    expect(active()).toBe(false);
    expect(document.querySelector(".excalidraw__flow-animation")).toBeNull();
    // the pill stays, and it says nothing is running
    expect(pill()).not.toBeNull();
    expect(screen.queryByTestId("flow-bar-pill-stop")).toBeNull();
  });

  it("AC-240 Minimise only collapses and the animation goes on", async () => {
    await mount();
    select([shapes()[1]]);
    play();

    expect(
      screen
        .getByLabelText("Collapse the animation bar into a pill")
        .getAttribute("title"),
    ).toMatch(/Minimise/);

    collapse();

    expect(pill()).not.toBeNull();
    expect(active()).toBe(true);
    expect(
      document.querySelector(".excalidraw__flow-animation"),
    ).not.toBeNull();
  });

  it("AC-240 Stop switches the preview off", async () => {
    await mount();
    select([shapes()[1]]);

    act(() => {
      setFlowClassPreview(true);
    });

    expect(editorJotaiStore.get(flowClassPreviewAtom)).toBe(true);

    // the preview is a running thing, and the bar says so
    const stop = screen.getByTestId("flow-bar-stop");

    expect(stop.textContent).toMatch(/preview/i);

    act(() => {
      fireEvent.click(stop);
    });

    expect(editorJotaiStore.get(flowClassPreviewAtom)).toBe(false);
    expect(screen.queryByTestId("flow-bar-stop")).toBeNull();
  });

  it("AC-240 Esc exits whatever is running", async () => {
    await mount();
    select([shapes()[1]]);

    // the animation
    play();
    expect(active()).toBe(true);
    escape();
    expect(active()).toBe(false);

    // and the preview
    act(() => {
      setFlowClassPreview(true);
    });
    escape();
    expect(editorJotaiStore.get(flowClassPreviewAtom)).toBe(false);
  });

  it("AC-240 Esc leaves other modes and text editing alone", async () => {
    await mount();
    select([shapes()[1]]);

    // nothing runs: Esc is the editor's own again, and does what it did
    act(() => {
      h.app.setActiveTool({ type: "rectangle" });
    });
    escape();

    expect(active()).toBe(false);
    expect(h.state.activeTool.type).toBe("selection");

    // typing in a field is not an exit: the animation goes on
    select([shapes()[1]]);
    play();

    const field = document.createElement("input");

    document.body.appendChild(field);
    act(() => {
      fireEvent.keyDown(field, { key: "Escape" });
    });

    expect(active()).toBe(true);

    field.remove();
  });
});

describe("AC-538 the view flying to each step is a switch you can reach", () => {
  const camera = () => editorJotaiStore.get(flowAnimationStateAtom).camera;

  afterEach(() => {
    stopFlowAnimation();
    updateFlowAnimationSettings({ camera: false });
  });

  it("AC-538 the bar's top row has the switch, and it is the same setting as the checkbox below", async () => {
    await mount();
    select([shapes()[1]]);

    const toggle = screen.getByTestId("flow-bar-camera");

    expect(camera()).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.textContent).toBe("Fly: off");

    act(() => {
      fireEvent.click(toggle);
    });

    expect(camera()).toBe(true);
    expect(screen.getByTestId("flow-bar-camera").textContent).toBe("Fly: on");
    expect(
      (screen.getByLabelText("Fly the view to each step") as HTMLInputElement)
        .checked,
    ).toBe(true);

    act(() => {
      fireEvent.click(screen.getByTestId("flow-bar-camera"));
    });

    expect(camera()).toBe(false);
  });

  it("AC-538 while stepping through the chart, the switch is still there and still works", async () => {
    await mount();
    select([shapes()[1]]);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Present steps" }));
    });

    expect(editorJotaiStore.get(flowAnimationStateAtom).mode).toBe("present");

    act(() => {
      fireEvent.click(screen.getByTestId("flow-bar-camera"));
    });

    expect(camera()).toBe(true);
    // turning it on does not end the presentation
    expect(editorJotaiStore.get(flowAnimationStateAtom).active).toBe(true);
  });

  it("AC-538 the collapsed pill has the switch while something runs, and not otherwise", async () => {
    await mount();
    select([shapes()[1]]);
    act(() => {
      fireEvent.click(
        screen.getByLabelText("Collapse the animation bar into a pill"),
      );
    });

    expect(screen.queryByTestId("flow-bar-pill-camera")).toBeNull();

    act(() => {
      pill()!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 1,
          clientY: 1,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 1,
          clientY: 1,
        }),
      );
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Present steps" }));
    });
    act(() => {
      fireEvent.click(
        screen.getByLabelText("Collapse the animation bar into a pill"),
      );
    });

    const toggle = screen.getByTestId("flow-bar-pill-camera");

    expect(toggle.textContent).toBe("Fly: off");

    act(() => {
      fireEvent.click(toggle);
    });

    expect(camera()).toBe(true);
    expect(screen.getByTestId("flow-bar-pill-camera").textContent).toBe(
      "Fly: on",
    );
    expect(editorJotaiStore.get(flowAnimationStateAtom).active).toBe(true);
  });
});
