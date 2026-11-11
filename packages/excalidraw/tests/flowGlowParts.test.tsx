/**
 * AC-243 - the neon glow is per part (D-217): shape, text, animation, arrows.
 *
 * What is drawn is read where the editor really draws it - the overlay's own
 * elements and attributes, and what the canvas is handed - and the stylesheet
 * is read as text for the rules only it can state.
 */

import fs from "node:fs";
import path from "node:path";

import React from "react";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  flowAnimationStateAtom,
  getFlowAnimationSnapshot,
  setFlowClassPreview,
  startFlowAnimation,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "../components/FlowAnimationState";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";
import { AnimationController } from "../renderer/animation";
import { readFlowClass, withFlowClass } from "../scene/flowClass";
import { FLOW_LOOK_DEFAULTS, neonCore, readFlowLook } from "../scene/flowLook";
import { buildFlowPreset } from "../scene/flowPresets";
import { flowOfSelection } from "../scene/flowSelection";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen } from "./test-utils";

import type { FlowClassSettings } from "../scene/flowClass";
import type { Renderer } from "../scene/Renderer";

const { h } = window;

const SETTINGS: FlowClassSettings = {
  ...FLOW_LOOK_DEFAULTS,
  node: "pulse",
  arrow: "token",
  speed: 240,
  stepMs: 100000,
  loop: true,
};

const SWITCHES = [
  ["glowShape", "Neon shape"],
  ["glowText", "Neon text"],
  ["glowMark", "Neon animation"],
  ["glowArrow", "Neon arrows"],
] as const;

const sheet = fs.readFileSync(
  path.resolve(__dirname, "../components/FlowAnimationOverlay.scss"),
  "utf8",
);

const chart = (settings: FlowClassSettings | null) => {
  const built = buildFlowPreset("decision", "Start\n? Ready?\nGo\nWait\nEnd", {
    seed: 8,
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements.map((element) =>
    settings &&
    element.type !== "arrow" &&
    element.type !== "text" &&
    element.boundElements?.length
      ? { ...element, customData: withFlowClass(element, settings) }
      : element,
  ) as ExcalidrawElement[];
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

const shapes = () =>
  live().filter(
    (element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      !!element.boundElements?.length,
  );

const arrows = () => live().filter((element) => element.type === "arrow");

const state = () => editorJotaiStore.get(flowAnimationStateAtom);

const wholeFlow = () =>
  flowOfSelection(
    Object.fromEntries(live().map((element) => [element.id, true])),
    live(),
    h.app.scene.getNonDeletedElementsMap(),
  )!;

const lookOpen = async () => {
  await mount(chart(null));

  act(() => {
    API.setSelectedElements([shapes()[0]]);
  });
  act(() => {
    fireEvent.click(screen.getByRole("tab", { name: "Look" }));
  });
};

const renderer = () => (h.app as unknown as { renderer: Renderer }).renderer;

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

describe("AC-243 the neon glow is per part", () => {
  it("AC-243 each switch is off by default", async () => {
    for (const [key] of SWITCHES) {
      expect(FLOW_LOOK_DEFAULTS[key], key).toBe(false);
      expect(state()[key], key).toBe(false);
    }

    await lookOpen();

    for (const [, label] of SWITCHES) {
      expect(
        (screen.getByLabelText(label) as HTMLInputElement).checked,
        label,
      ).toBe(false);
    }
  });

  it("AC-243 each switch lights its own part only", async () => {
    const ATTRS = {
      glowShape: "data-flow-glow-shape",
      glowText: "data-flow-glow-text",
      glowMark: "data-flow-glow-mark",
      glowArrow: "data-flow-glow-arrow",
    } as const;

    for (const [key] of SWITCHES) {
      await mount(
        chart({ ...SETTINGS, nodeTarget: "shape-box", [key]: true }),
        {
          viewModeEnabled: true,
        },
      );

      for (const [other, attr] of Object.entries(ATTRS)) {
        const found = document.querySelector(
          `.excalidraw__flow-class [${attr}]`,
        );

        expect(found !== null, `${key} on, ${other}`).toBe(other === key);
      }

      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        document.body.innerHTML = "";
      });
    }

    // and the stylesheet keeps them apart: the shape's rule is for the shape's
    // outline, and the text's for the label's box
    expect(sheet).toMatch(
      /\[data-flow-glow-shape\]\s+\[data-flow-part="shape"\]\s+\.excalidraw__flow-node-outline/,
    );
    expect(sheet).toMatch(
      /\[data-flow-glow-text\] \[data-flow-part="box"\] \.excalidraw__flow-node-outline/,
    );
    expect(sheet).toMatch(
      /\[data-flow-glow-text\] \.excalidraw__flow-label--letters/,
    );
    expect(sheet).toMatch(/\[data-flow-glow-mark\] \{/);
  });

  it("AC-243 the arrows are drawn as tubes by the overlay", async () => {
    await mount(chart({ ...SETTINGS, glowArrow: true }));

    const spy = vi.spyOn(renderer(), "getRenderableElements");

    act(() => {
      h.setState({ viewModeEnabled: true });
    });

    // one tube for every arrow of the flow
    expect(document.querySelectorAll("[data-flow-arrow-tube]")).toHaveLength(
      arrows().length,
    );

    // and the canvas does not draw the arrows the overlay draws
    const drawn = (
      spy.mock.results.at(-1)!.value as {
        elementsMap: Map<string, ExcalidrawElement>;
      }
    ).elementsMap;

    for (const arrow of arrows()) {
      expect(drawn.has(arrow.id)).toBe(false);
    }

    // the labels of those arrows are the overlay's, above them
    expect(
      document.querySelectorAll("[data-flow-arrow-label]").length,
    ).toBeGreaterThan(0);

    // with the switch off there are none
    await mount(chart({ ...SETTINGS }), { viewModeEnabled: true });
    expect(
      document.querySelectorAll(
        ".excalidraw__flow-class [data-flow-arrow-tube]",
      ).length,
    ).toBe(document.querySelectorAll("[data-flow-arrow-tube]").length);
  });

  it("AC-243 the arrow tube is in the arrow colour", async () => {
    await mount(
      chart({ ...SETTINGS, glowArrow: true, arrowColor: "#ff00ff" }),
      { viewModeEnabled: true },
    );

    const group = document.querySelector(
      ".excalidraw__flow-class [data-flow-class-flow]",
    ) as HTMLElement;

    expect(group.style.getPropertyValue("--flow-arrow-color")).toBe("#ff00ff");
    expect(group.style.getPropertyValue("--flow-arrow-core")).toBe(
      neonCore("#ff00ff"),
    );

    // with no arrow colour, the animation colour; the stylesheet falls back
    expect(sheet).toMatch(
      /--flow-arrow-color, var\(--flow-mark-color, var\(--color-primary\)\)/,
    );
    expect(sheet).toMatch(/flow-arrow-tube \{[^}]*stroke-width: 3/);
  });

  it("AC-243 a preset and Classic set the switches", async () => {
    await lookOpen();

    act(() => {
      fireEvent.click(screen.getByLabelText("Neon arrows"));
    });
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Colour preset: Cyan and pink" }),
      );
    });

    // shape, text and animation on; the arrows as they were
    expect(state()).toMatchObject({
      glowShape: true,
      glowText: true,
      glowMark: true,
      glowArrow: true,
    });

    // Classic clears all four
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Colour preset: Classic" }),
      );
    });

    expect(state()).toMatchObject({
      glowShape: false,
      glowText: false,
      glowMark: false,
      glowArrow: false,
    });
  });

  it("AC-243 the switches reach the class entry and the snapshot", async () => {
    await lookOpen();

    act(() => {
      fireEvent.click(screen.getByLabelText("Show in class"));
    });
    act(() => {
      fireEvent.click(screen.getByLabelText("Neon text"));
    });
    act(() => {
      fireEvent.click(screen.getByLabelText("Neon arrows"));
    });

    for (const shape of shapes()) {
      expect(readFlowClass(shape)).toMatchObject({
        glowText: true,
        glowArrow: true,
        glowShape: false,
        glowMark: false,
      });
    }

    const graph = wholeFlow();

    act(() => {
      startFlowAnimation(graph.steps, { mode: "present", graph });
    });

    expect(getFlowAnimationSnapshot()).toMatchObject({
      glowText: true,
      glowArrow: true,
      glowShape: false,
    });
  });

  it("AC-243 an entry from before reads as three on", () => {
    // the one glow of before: shape, text and animation, not the arrows
    expect(readFlowLook({ glow: true })).toMatchObject({
      glowShape: true,
      glowText: true,
      glowMark: true,
      glowArrow: false,
    });

    // none: none
    expect(readFlowLook({})).toMatchObject({
      glowShape: false,
      glowText: false,
      glowMark: false,
      glowArrow: false,
    });

    // a switch of its own wins over the old one
    expect(readFlowLook({ glow: true, glowText: false })).toMatchObject({
      glowShape: true,
      glowText: false,
    });
  });
});
