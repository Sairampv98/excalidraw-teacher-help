/**
 * AC-217 - the presenter window plays the class loop by itself, and mirrors a
 * chart the editor is stepping (D-186, D-187).
 *
 * The other window is played by hand over a fake `BroadcastChannel`: the test
 * hands the presenter the messages the editor would send, and records what the
 * presenter posts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import React from "react";

import { ExcalidrawAPIProvider } from "@excalidraw/excalidraw";
import {
  applyFlowAnimationSnapshot,
  stopFlowAnimation,
} from "@excalidraw/excalidraw/components/FlowAnimationState";
import { AnimationController } from "@excalidraw/excalidraw/renderer/animation";
import { withFlowClass } from "@excalidraw/excalidraw/scene/flowClass";
import { buildFlowPreset } from "@excalidraw/excalidraw/scene/flowPresets";
import { flowOfSelection } from "@excalidraw/excalidraw/scene/flowSelection";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { act, render } from "@excalidraw/excalidraw/tests/test-utils";

import type { FlowAnimationSnapshot } from "@excalidraw/excalidraw/components/FlowAnimationState";
import type { FlowClassSettings } from "@excalidraw/excalidraw/scene/flowClass";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { PresenterView } from "../presenter/PresenterView";

/** a stand-in for the browser's `BroadcastChannel`, played by hand */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];

  onmessage: ((event: { data: unknown }) => void) | null = null;

  posted: { type: string; [key: string]: unknown }[] = [];

  constructor(public name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: { type: string }) {
    this.posted.push(data);
  }

  close() {}

  receive(data: unknown) {
    this.onmessage?.({ data });
  }
}

const camera = {
  scrollX: 0,
  scrollY: 0,
  zoomValue: 1,
  viewBackgroundColor: "#ffffff",
  gridModeEnabled: false,
  gridSize: null,
  pagesEnabled: false,
  pages: null,
  currentPageId: "page-1",
  pageOffsetX: 0,
  pageOffsetY: 0,
  editorWidth: 1200,
  editorHeight: 800,
} as const;

const SETTINGS: FlowClassSettings = {
  node: "pulse",
  arrow: "token",
  speed: 240,
  stepMs: 150,
  loop: true,
};

const chart = (settings: FlowClassSettings | null): ExcalidrawElement[] => {
  const built = buildFlowPreset("process", "Plan\nTeach\nReview", { seed: 4 });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements.map((element) => {
    const isShape =
      element.type !== "arrow" &&
      element.type !== "text" &&
      !!element.boundElements?.length;

    return isShape && settings
      ? { ...element, customData: withFlowClass(element, settings) }
      : element;
  }) as ExcalidrawElement[];
};

const stepIdsOf = (elements: readonly ExcalidrawElement[]) => {
  const map = new Map(elements.map((element) => [element.id, element]));

  return flowOfSelection(
    Object.fromEntries(elements.map((element) => [element.id, true])),
    elements,
    map,
  )!.steps.map((step) => step.containerId);
};

beforeEach(() => {
  FakeBroadcastChannel.instances = [];
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});

afterEach(() => {
  stopFlowAnimation();
  applyFlowAnimationSnapshot(null, [], new Map());

  for (const key of ["flow-animation", "flow-animation-marks", "flow-class"]) {
    AnimationController.cancel(key);
  }

  vi.unstubAllGlobals();
});

const presenter = async () => {
  await render(
    <ExcalidrawAPIProvider>
      <PresenterView />
    </ExcalidrawAPIProvider>,
  );

  const channel = FakeBroadcastChannel.instances[0];

  const sendScene = async (elements: ExcalidrawElement[]) => {
    await act(async () => {
      channel.receive({
        type: "presenter:scene",
        scene: { elements, camera },
      });
    });

    API.setAppState({ width: 1000, height: 800 });
  };

  const sendFlow = async (flow: FlowAnimationSnapshot | null) => {
    await act(async () => {
      channel.receive({ type: "presenter:flow", flow });
    });
  };

  return { channel, sendScene, sendFlow };
};

const classFlows = () => document.querySelectorAll("[data-flow-class-flow]");

const classOverlay = () => document.querySelector(".excalidraw__flow-class");

const mirror = () =>
  document.querySelector(".excalidraw__flow-animation[data-flow-mirror]");

const snapshotOf = (elements: ExcalidrawElement[]): FlowAnimationSnapshot => ({
  mode: "present",
  stepIds: stepIdsOf(elements),
  index: 1,
  path: [0, 1],
  durationMs: 150,
  loop: false,
  nodeStyle: "pulse",
  arrowStyle: "token",
  speed: 240,
});

describe("AC-217 the presenter window plays the class loop", () => {
  it("AC-217 the presenter loops a marked chart from the scene alone", async () => {
    const { channel, sendScene } = await presenter();

    await sendScene(chart(SETTINGS));

    // no animation message came, and the editor is not playing anything
    expect(classOverlay()).not.toBeNull();
    expect(classFlows()).toHaveLength(1);
    expect(
      classOverlay()!.querySelector('[data-flow-mark="token"]'),
    ).not.toBeNull();
    expect(AnimationController.running("flow-class")).toBe(true);
    expect(channel.posted.some((m) => m.type === "presenter:flow")).toBe(false);

    // and it is displayed, not operated: no Steps button
    expect(document.querySelector("[data-flow-class-steps]")).toBeNull();
  });

  it("AC-217 an unmarked chart is not animated", async () => {
    const { sendScene } = await presenter();

    await sendScene(chart(null));

    expect(classOverlay()).toBeNull();
    expect(AnimationController.running("flow-class")).toBe(false);
  });

  it("AC-217 a stepped chart is mirrored and not looped as well", async () => {
    const elements = chart(SETTINGS);
    const { sendScene, sendFlow } = await presenter();

    await sendScene(elements);

    expect(classFlows()).toHaveLength(1);

    await sendFlow(snapshotOf(elements));

    // the mirror is drawn, and the loop of that chart is not
    expect(mirror()).not.toBeNull();
    expect(classFlows()).toHaveLength(0);
  });

  it("AC-217 the loop resumes when stepping ends", async () => {
    const elements = chart(SETTINGS);
    const { sendScene, sendFlow } = await presenter();

    await sendScene(elements);
    await sendFlow(snapshotOf(elements));

    expect(classFlows()).toHaveLength(0);

    await sendFlow(null);

    expect(mirror()).toBeNull();
    expect(classFlows()).toHaveLength(1);
  });

  it("AC-217 the presenter sends nothing back", async () => {
    const elements = chart(SETTINGS);
    const { channel, sendScene, sendFlow } = await presenter();

    await sendScene(elements);
    await sendFlow(snapshotOf(elements));
    await sendFlow(null);

    expect(channel.posted.every((m) => m.type === "presenter:hello")).toBe(
      true,
    );
  });
});
