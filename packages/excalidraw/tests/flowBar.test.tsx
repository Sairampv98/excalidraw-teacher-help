/**
 * AC-208, AC-209 and AC-211 - the floating animation bar, the two animations
 * and the flow a selection belongs to (D-177, D-178, D-180).
 *
 * The bar's position is compared with the library's own
 * `sceneCoordsToViewportCoords`, and not with a formula written out again here;
 * what the overlay draws is read from the DOM it produces.
 */

import fs from "node:fs";
import path from "node:path";

import React from "react";

import { afterEach, describe, expect, it } from "vitest";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
} from "@excalidraw/element/types";

import {
  flowAnimationStateAtom,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "../components/FlowAnimationState";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";
import { AnimationController } from "../renderer/animation";
import {
  FLOW_BAR_GAP,
  FLOW_BAR_HEIGHT,
  FLOW_BAR_MARGIN,
  FLOW_BAR_WIDTH,
} from "../scene/flowBar";
import { buildFlowPreset } from "../scene/flowPresets";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen } from "./test-utils";

import type { NormalizedZoomValue } from "../types";

const { h } = window;

const VIEW = { width: 1400, height: 900 };

/** the library's own preset, on the canvas, nothing selected yet */
const chartOnCanvas = async () => {
  await render(<Excalidraw handleKeyboardGlobally={true} />);

  act(() => {
    h.setState({ width: VIEW.width, height: VIEW.height });
  });

  const built = buildFlowPreset("process", "Plan\nTeach\nReview\nPractise", {
    seed: 7,
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  API.setElements(built.elements);

  return built.elements;
};

const live = () => h.elements.filter((element) => !element.isDeleted);

const shapes = () =>
  live().filter(
    (element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      !!element.boundElements?.length,
  );

const arrows = () =>
  live().filter(
    (element): element is ExcalidrawArrowElement => element.type === "arrow",
  );

const select = (elements: ExcalidrawElement[]) =>
  act(() => {
    API.setSelectedElements(elements);
  });

const bar = () => screen.queryByTestId("flow-bar");

const barBox = () => {
  const element = bar()!;

  return {
    left: parseFloat(element.style.left),
    top: parseFloat(element.style.top),
  };
};

/** where the bottom-centre of the chart is on screen, by the library's oracle */
const chartBottom = () => {
  const boxes = shapes();
  const minX = Math.min(...boxes.map((s) => s.x));
  const maxX = Math.max(...boxes.map((s) => s.x + s.width));
  const maxY = Math.max(...boxes.map((s) => s.y + s.height));

  const { x, y } = sceneCoordsToViewportCoords(
    { sceneX: (minX + maxX) / 2, sceneY: maxY },
    h.state,
  );

  return { x: x - h.state.offsetLeft, y: y - h.state.offsetTop };
};

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
  ]) {
    AnimationController.cancel(key);
  }
});

describe("AC-208 the animation controls are a floating bar", () => {
  it("AC-208 the panel no longer holds the animation section", async () => {
    const elements = await chartOnCanvas();

    select(elements);

    // the old section was a fieldset with this legend
    expect(screen.queryByText("Flow animation")).toBeNull();
    expect(
      screen.getByRole("toolbar", { name: "Flow animation" }),
    ).not.toBeNull();
  });

  it("AC-208 the bar sits below the selected chart", async () => {
    await chartOnCanvas();
    select(shapes());

    const { x, y } = chartBottom();

    expect(barBox().top).toBeCloseTo(y + FLOW_BAR_GAP);
    expect(barBox().left).toBeCloseTo(x);
  });

  it("AC-208 the bar follows a moved chart", async () => {
    await chartOnCanvas();
    select(shapes());

    const before = barBox();

    act(() => {
      for (const element of live()) {
        API.updateElement(element, {
          x: element.x - 100,
          y: element.y + 60,
        });
      }
    });

    expect(barBox().top).toBeCloseTo(before.top + 60);
    expect(barBox().left).toBeCloseTo(before.left - 100);
  });

  it("AC-208 the bar follows scroll and zoom", async () => {
    await chartOnCanvas();
    select(shapes());

    act(() => {
      h.setState({ scrollY: h.state.scrollY - 80 });
    });

    expect(barBox().top).toBeCloseTo(chartBottom().y + FLOW_BAR_GAP);

    act(() => {
      h.setState({ zoom: { value: 0.8 as NormalizedZoomValue } });
    });

    expect(barBox().top).toBeCloseTo(chartBottom().y + FLOW_BAR_GAP);
    expect(barBox().left).toBeCloseTo(chartBottom().x);
  });

  it("AC-208 the bar stays inside the viewport", async () => {
    await chartOnCanvas();
    select(shapes());

    const half = FLOW_BAR_WIDTH / 2;

    for (const [scrollX, scrollY] of [
      [-6000, -6000],
      [6000, 6000],
      [-6000, 6000],
    ]) {
      act(() => {
        h.setState({ scrollX, scrollY });
      });

      const { left, top } = barBox();

      expect(left).toBeGreaterThanOrEqual(FLOW_BAR_MARGIN + half);
      expect(left).toBeLessThanOrEqual(VIEW.width - FLOW_BAR_MARGIN - half);
      expect(top).toBeGreaterThanOrEqual(FLOW_BAR_MARGIN);
      expect(top).toBeLessThanOrEqual(
        VIEW.height - FLOW_BAR_HEIGHT - FLOW_BAR_MARGIN,
      );
    }
  });

  it("AC-208 the bar has every control", async () => {
    await chartOnCanvas();
    select(shapes());

    for (const name of ["Play", "Present steps", "Lay this out"]) {
      expect(screen.getByRole("button", { name })).not.toBeNull();
    }

    expect(screen.getByLabelText("Node animation")).not.toBeNull();
    expect(screen.getByLabelText("Arrow animation")).not.toBeNull();
    expect(screen.getByLabelText("Animation speed")).not.toBeNull();
    expect(screen.getByLabelText("Fly the view to each step")).not.toBeNull();
    expect(screen.getByLabelText("Loop")).not.toBeNull();
  });

  it("AC-208 the bar is above the editor chrome that would hide it", () => {
    const styles = fs.readFileSync(
      path.resolve(__dirname, "../css/styles.scss"),
      "utf8",
    );
    const zIndex = (name: string) =>
      Number(
        new RegExp(`--zIndex-${name}: *([0-9]+)`).exec(styles)?.[1] ?? NaN,
      );

    // above the overlay it controls, below the menus and the dialogs
    expect(zIndex("flowBar")).toBeGreaterThan(zIndex("flowAnimation"));
    expect(zIndex("flowBar")).toBeGreaterThan(zIndex("ui-bottom"));
    expect(zIndex("flowBar")).toBeLessThan(zIndex("ui-context-menu"));
    expect(zIndex("flowBar")).toBeLessThan(zIndex("modal"));

    // and above every bar the app itself puts at the bottom of the window,
    // read from their own stylesheets
    for (const file of ["emoji/StickerBar.scss", "components/PageBar.scss"]) {
      const appStyles = fs.readFileSync(
        path.resolve(__dirname, "../../../excalidraw-app", file),
        "utf8",
      );
      const declared = [...appStyles.matchAll(/z-index: *([0-9]+);/g)].map(
        (match) => Number(match[1]),
      );

      expect(declared.length).toBeGreaterThan(0);
      expect(zIndex("flowBar")).toBeGreaterThan(Math.max(...declared));
    }

    // and the bar's own stylesheet uses it
    const own = fs.readFileSync(
      path.resolve(__dirname, "../components/FlowAnimationBar.scss"),
      "utf8",
    );

    expect(own).toMatch(/z-index: var\(--zIndex-flowBar\)/);
  });

  it("AC-208 no flow selected and nothing playing shows no bar", async () => {
    await chartOnCanvas();

    select([]);
    expect(bar()).toBeNull();

    select(shapes());
    expect(bar()).not.toBeNull();

    select([]);
    expect(bar()).toBeNull();
  });
});

describe("AC-209 the node and arrow animations are combined", () => {
  const optionsOf = (label: string) =>
    [...(screen.getByLabelText(label) as HTMLSelectElement).options].map(
      (option) => option.value,
    );

  const host = () =>
    document.querySelector(".excalidraw__flow-animation") as HTMLElement | null;

  const play = () =>
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
    });

  it("AC-209 there are two animation choices", async () => {
    await chartOnCanvas();
    select(shapes());

    expect(optionsOf("Node animation")).toEqual(["none", "focus", "pulse"]);
    expect(optionsOf("Arrow animation")).toEqual([
      "none",
      "beam",
      "marching",
      "pipe",
      "token",
    ]);
    expect(document.querySelector('[aria-label="Animation style"]')).toBeNull();
  });

  it("AC-209 a node animation and an arrow animation play together", async () => {
    await chartOnCanvas();
    select(shapes());

    fireEvent.change(screen.getByLabelText("Node animation"), {
      target: { value: "pulse" },
    });
    fireEvent.change(screen.getByLabelText("Arrow animation"), {
      target: { value: "token" },
    });

    play();

    expect(host()!.getAttribute("data-flow-node-style")).toBe("pulse");
    expect(host()!.getAttribute("data-flow-arrow-style")).toBe("token");
    expect(
      host()!.querySelector(".excalidraw__flow-animation-focus--pulse"),
    ).not.toBeNull();
    expect(host()!.querySelector('[data-flow-mark="token"]')).not.toBeNull();
  });

  it("AC-209 none for one leaves the other", async () => {
    await chartOnCanvas();
    select(shapes());

    fireEvent.change(screen.getByLabelText("Node animation"), {
      target: { value: "none" },
    });
    fireEvent.change(screen.getByLabelText("Arrow animation"), {
      target: { value: "token" },
    });

    play();

    expect(
      host()!.querySelector(".excalidraw__flow-animation-focus"),
    ).toBeNull();
    expect(host()!.querySelector('[data-flow-mark="token"]')).not.toBeNull();

    act(() => {
      stopFlowAnimation();
    });
    fireEvent.change(screen.getByLabelText("Node animation"), {
      target: { value: "focus" },
    });
    fireEvent.change(screen.getByLabelText("Arrow animation"), {
      target: { value: "none" },
    });

    play();

    expect(
      host()!.querySelector(".excalidraw__flow-animation-focus"),
    ).not.toBeNull();
    expect(host()!.querySelector("[data-flow-mark]")).toBeNull();
  });

  it("AC-209 an old single style is read as a pair", () => {
    const expected = {
      focus: ["focus", "none"],
      pulse: ["pulse", "none"],
      beam: ["none", "beam"],
      marching: ["none", "marching"],
      pipe: ["none", "pipe"],
      token: ["none", "token"],
    } as const;

    for (const [style, [node, arrow]] of Object.entries(expected)) {
      updateFlowAnimationSettings({ style: style as keyof typeof expected });

      const state = editorJotaiStore.get(flowAnimationStateAtom);

      expect([style, state.nodeStyle, state.arrowStyle]).toEqual([
        style,
        node,
        arrow,
      ]);
    }
  });

  it("AC-209 the choice writes nothing into the document", async () => {
    await chartOnCanvas();
    select(shapes());

    const before = JSON.stringify(h.elements);
    const view = [h.state.scrollX, h.state.scrollY, h.state.zoom.value];

    fireEvent.change(screen.getByLabelText("Node animation"), {
      target: { value: "pulse" },
    });
    fireEvent.change(screen.getByLabelText("Arrow animation"), {
      target: { value: "pipe" },
    });
    play();
    act(() => {
      stopFlowAnimation();
    });

    expect(JSON.stringify(h.elements)).toBe(before);
    expect([h.state.scrollX, h.state.scrollY, h.state.zoom.value]).toEqual(
      view,
    );
  });
});

describe("AC-211 the animation does not need the whole chart selected", () => {
  const stepsPlaying = () =>
    editorJotaiStore.get(flowAnimationStateAtom).steps.length;

  it("AC-211 one shape of a flow is enough", async () => {
    await chartOnCanvas();
    select([shapes()[1]]);

    expect(bar()).not.toBeNull();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
    });

    // the whole flow, not the one shape
    expect(stepsPlaying()).toBe(shapes().length);
  });

  it("AC-211 one arrow of a flow is enough", async () => {
    await chartOnCanvas();
    select([arrows()[0]]);

    expect(bar()).not.toBeNull();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
    });

    expect(stepsPlaying()).toBe(shapes().length);
  });

  it("AC-211 a shape outside any flow shows no bar", async () => {
    await chartOnCanvas();

    const lonely = API.createElement({
      type: "rectangle",
      x: 3000,
      y: 3000,
      width: 100,
      height: 60,
    });

    API.setElements([...h.elements, lonely]);
    select([lonely]);

    expect(bar()).toBeNull();
  });

  it("AC-211 a playing flow keeps playing when the selection changes", async () => {
    await chartOnCanvas();
    select([shapes()[0]]);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
    });

    select([]);

    expect(editorJotaiStore.get(flowAnimationStateAtom).active).toBe(true);
    expect(
      document.querySelector(".excalidraw__flow-animation"),
    ).not.toBeNull();
    expect(bar()).not.toBeNull();
  });

  it("AC-211 stop ends it", async () => {
    await chartOnCanvas();
    select([shapes()[0]]);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
    });
    select([]);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });

    expect(editorJotaiStore.get(flowAnimationStateAtom).active).toBe(false);
    expect(document.querySelector(".excalidraw__flow-animation")).toBeNull();
    expect(bar()).toBeNull();
  });
});
