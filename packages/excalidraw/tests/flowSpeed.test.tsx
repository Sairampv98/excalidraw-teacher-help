/**
 * AC-244 - the animation speed goes down to 10 (D-218).
 */

import React from "react";

import { afterEach, describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  flowAnimationStateAtom,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "../components/FlowAnimationState";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";
import { readFlowClass } from "../scene/flowClass";
import { FLOW_LOOK_DEFAULTS } from "../scene/flowLook";
import { buildFlowPreset } from "../scene/flowPresets";
import {
  FLOW_SPEED_MAX,
  FLOW_SPEED_MIN,
  clampFlowSpeed,
} from "../scene/flowStyles";

import { API } from "./helpers/api";
import { act, render, screen } from "./test-utils";

const { h } = window;

afterEach(() => {
  stopFlowAnimation();
  updateFlowAnimationSettings({
    ...FLOW_LOOK_DEFAULTS,
    nodeStyle: "focus",
    arrowStyle: "none",
    speed: 240,
    camera: false,
    loop: true,
  });
});

describe("AC-244 the animation speed goes down to 10", () => {
  it("AC-244 the slider starts at 10", async () => {
    const built = buildFlowPreset("process", "Plan\nTeach\nReview", {
      seed: 2,
    });

    if (!built.ok) {
      throw new Error(built.error);
    }

    await render(
      <Excalidraw
        handleKeyboardGlobally={true}
        initialData={{ elements: built.elements as never }}
      />,
    );

    act(() => {
      h.setState({ width: 1400, height: 900 });
    });
    act(() => {
      API.setSelectedElements([
        h.elements.find(
          (e) => e.type !== "text" && e.type !== "arrow",
        ) as ExcalidrawElement,
      ]);
    });

    expect(FLOW_SPEED_MIN).toBe(10);
    expect(
      (screen.getByLabelText("Animation speed") as HTMLInputElement).min,
    ).toBe("10");
  });

  it("AC-244 a speed of 10 is kept and less is brought to 10", () => {
    expect(clampFlowSpeed(10)).toBe(10);
    expect(clampFlowSpeed(5)).toBe(10);
    expect(clampFlowSpeed(0)).toBe(10);
    expect(clampFlowSpeed(-50)).toBe(10);

    // the setting
    act(() => {
      updateFlowAnimationSettings({ speed: 10 });
    });
    expect(editorJotaiStore.get(flowAnimationStateAtom).speed).toBe(10);

    act(() => {
      updateFlowAnimationSettings({ speed: 3 });
    });
    expect(editorJotaiStore.get(flowAnimationStateAtom).speed).toBe(10);

    // the class entry
    const shape = { customData: { flow: { class: { speed: 3 } } } };

    expect(readFlowClass(shape as never)?.speed).toBe(10);
    expect(
      readFlowClass({
        customData: { flow: { class: { speed: 25 } } },
      } as never)?.speed,
    ).toBe(25);
  });

  it("AC-244 the maximum is unchanged", () => {
    expect(FLOW_SPEED_MAX).toBe(600);
    expect(clampFlowSpeed(600)).toBe(600);
    expect(clampFlowSpeed(5000)).toBe(600);
  });
});
