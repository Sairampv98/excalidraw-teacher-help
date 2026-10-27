/**
 * AC-212 - the presenter view draws the flow animation (D-181).
 *
 * The two windows are two Excalidraw instances that talk over a
 * `BroadcastChannel`. The test plays the other window by hand: a fake channel
 * that records what one side posts and lets the test hand a message to the
 * other. The editor and the presenter share one jotai store inside a test, so
 * each side is rendered on its own.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import React from "react";

import { Excalidraw, ExcalidrawAPIProvider } from "@excalidraw/excalidraw";
import {
  applyFlowAnimationSnapshot,
  presentStepForward,
  startFlowAnimation,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "@excalidraw/excalidraw/components/FlowAnimationState";
import { AnimationController } from "@excalidraw/excalidraw/renderer/animation";
import { FLOW_LOOK_DEFAULTS } from "@excalidraw/excalidraw/scene/flowLook";
import { buildFlowPreset } from "@excalidraw/excalidraw/scene/flowPresets";
import { flowOfSelection } from "@excalidraw/excalidraw/scene/flowSelection";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { act, render } from "@excalidraw/excalidraw/tests/test-utils";

import type { FlowAnimationSnapshot } from "@excalidraw/excalidraw/components/FlowAnimationState";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { PresenterView } from "../presenter/PresenterView";
import { usePresenterBroadcaster } from "../presenter/usePresenterBroadcaster";

const { h } = window;

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

  /** the other window sends a message */
  receive(data: unknown) {
    this.onmessage?.({ data });
  }

  flows() {
    return this.posted.filter((message) => message.type === "presenter:flow");
  }
}

/** the editor's side: the app publishes into the presenter */
const Broadcaster = () => {
  usePresenterBroadcaster(true);

  return null;
};

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

const chart = (): ExcalidrawElement[] => {
  const built = buildFlowPreset("process", "Plan\nTeach\nReview", { seed: 3 });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements as ExcalidrawElement[];
};

/** the steps of a chart, found by the library's own flow reading */
const stepIdsOf = (elements: readonly ExcalidrawElement[]) => {
  const map = new Map(elements.map((element) => [element.id, element]));
  const graph = flowOfSelection(
    Object.fromEntries(elements.map((element) => [element.id, true])),
    elements,
    map,
  )!;

  return graph.steps.map((step) => step.containerId);
};

const snapshotOf = (
  elements: readonly ExcalidrawElement[],
  patch: Partial<FlowAnimationSnapshot> = {},
): FlowAnimationSnapshot => ({
  ...FLOW_LOOK_DEFAULTS,
  mode: "play",
  stepIds: stepIdsOf(elements),
  index: 0,
  path: [],
  durationMs: 1200,
  loop: true,
  nodeStyle: "pulse",
  arrowStyle: "token",
  speed: 240,
  ...patch,
});

beforeEach(() => {
  FakeBroadcastChannel.instances = [];
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});

afterEach(() => {
  stopFlowAnimation();
  applyFlowAnimationSnapshot(null, [], new Map());
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

  vi.unstubAllGlobals();
});

/* ----------------------------------------------------------------- the editor */

const editorWithChart = async () => {
  const elements = chart();

  await render(
    <Excalidraw initialData={{ elements: elements as never }}>
      <Broadcaster />
    </Excalidraw>,
  );

  const channel = FakeBroadcastChannel.instances[0];

  const startPlaying = (options: { mode?: "play" | "present" } = {}) => {
    const map = h.app.scene.getNonDeletedElementsMap();
    const graph = flowOfSelection(
      Object.fromEntries(elements.map((element) => [element.id, true])),
      h.elements,
      map,
    )!;

    act(() => {
      startFlowAnimation(graph.steps, {
        mode: options.mode ?? "play",
        graph,
        nodeStyle: "pulse",
        arrowStyle: "token",
      });
    });

    return graph;
  };

  const connect = async (presenterId = "presenter-1") => {
    await act(async () => {
      channel.receive({ type: "presenter:hello", presenterId });
    });
  };

  return { elements, channel, startPlaying, connect };
};

describe("AC-212 the editor sends the animation", () => {
  it("AC-212 the editor publishes the animation when it changes", async () => {
    const { elements, channel, startPlaying, connect } =
      await editorWithChart();

    await connect();

    // what a presenter that has just connected is told
    const baseline = channel.flows().length;

    startPlaying({ mode: "present" });

    expect(channel.flows()).toHaveLength(baseline + 1);

    const started = channel.flows().at(-1)!.flow as FlowAnimationSnapshot;

    expect(started.stepIds).toEqual(stepIdsOf(elements));
    expect(started.mode).toBe("present");
    expect(started.nodeStyle).toBe("pulse");
    expect(started.arrowStyle).toBe("token");
    expect(started.index).toBe(0);

    // a step is a change
    act(() => {
      presentStepForward();
    });

    expect(channel.flows()).toHaveLength(baseline + 2);
    expect((channel.flows().at(-1)!.flow as FlowAnimationSnapshot).index).toBe(
      1,
    );

    // so is the speed
    act(() => {
      updateFlowAnimationSettings({ speed: 500 });
    });

    expect(channel.flows()).toHaveLength(baseline + 3);
    expect((channel.flows().at(-1)!.flow as FlowAnimationSnapshot).speed).toBe(
      500,
    );

    // and stopping says that nothing is playing now
    act(() => {
      stopFlowAnimation();
    });

    expect(channel.flows().at(-1)!.flow).toBeNull();
  });

  it("AC-212 a new presenter gets the current state", async () => {
    const { elements, channel, startPlaying, connect } =
      await editorWithChart();

    // nobody is listening: nothing is sent
    startPlaying();

    expect(channel.flows()).toHaveLength(0);

    // a presenter that connects now is told what is playing
    await connect();

    expect(channel.flows()).toHaveLength(1);
    expect((channel.flows()[0].flow as FlowAnimationSnapshot).stepIds).toEqual(
      stepIdsOf(elements),
    );
  });

  it("AC-212 nothing is sent when nothing changed", async () => {
    const { channel, startPlaying, connect } = await editorWithChart();

    await connect();
    startPlaying();

    const sent = channel.flows().length;

    // the same speed, and a setting the presenter has no use for
    act(() => {
      updateFlowAnimationSettings({ speed: 240 });
      updateFlowAnimationSettings({ camera: true });
    });

    expect(channel.flows()).toHaveLength(sent);
  });
});

/* --------------------------------------------------------------- the presenter */

const presenterWithChart = async () => {
  const elements = chart();

  await render(
    <ExcalidrawAPIProvider>
      <PresenterView />
    </ExcalidrawAPIProvider>,
  );

  const channel = FakeBroadcastChannel.instances[0];

  const sendScene = async (scene: ExcalidrawElement[]) => {
    await act(async () => {
      channel.receive({
        type: "presenter:scene",
        scene: { elements: scene, camera },
      });
    });

    API.setAppState({ width: 1000, height: 800 });
  };

  const sendFlow = async (flow: FlowAnimationSnapshot | null) => {
    await act(async () => {
      channel.receive({ type: "presenter:flow", flow });
    });
  };

  return { elements, channel, sendScene, sendFlow };
};

const overlay = () =>
  document.querySelector(".excalidraw__flow-animation") as HTMLElement | null;

describe("AC-212 the presenter draws the animation", () => {
  it("AC-212 the presenter draws the marks", async () => {
    const { elements, sendScene, sendFlow } = await presenterWithChart();

    await sendScene(elements);
    await sendFlow(snapshotOf(elements));

    expect(overlay()).not.toBeNull();
    expect(overlay()!.getAttribute("data-flow-mirror")).toBe("");
    expect(overlay()!.getAttribute("data-flow-arrow-style")).toBe("token");
    expect(overlay()!.getAttribute("data-flow-node-style")).toBe("pulse");
    expect(overlay()!.querySelector('[data-flow-mark="token"]')).not.toBeNull();
    expect(
      overlay()!.querySelector(".excalidraw__flow-animation-focus--pulse"),
    ).not.toBeNull();

    // the steps are the editor's: the same current step
    await sendFlow(snapshotOf(elements, { index: 1 }));

    expect(
      overlay()!.querySelectorAll("[data-flow-arrow]").length,
    ).toBeGreaterThan(0);
  });

  it("AC-212 the presenter follows a moved shape", async () => {
    const { elements, sendScene, sendFlow } = await presenterWithChart();

    await sendScene(elements);
    await sendFlow(snapshotOf(elements));

    const firstPoint = () =>
      overlay()!
        .querySelector("[data-flow-arrow] polyline")!
        .getAttribute("points")!
        .split(" ")[0]
        .split(",")
        .map(Number);

    const before = firstPoint();

    // the editor moved the chart, and the scene says so
    await sendScene(
      elements.map((element) => ({ ...element, x: element.x + 300 })),
    );

    expect(firstPoint()[0]).toBeCloseTo(before[0] + 300);
  });

  it("AC-212 the presenter never writes back", async () => {
    const { elements, channel, sendScene, sendFlow } =
      await presenterWithChart();

    await sendScene(elements);
    await sendFlow(snapshotOf(elements, { mode: "present", path: [0] }));

    // nothing of the animation is sent on, and it has no control to press
    expect(channel.flows()).toHaveLength(0);
    expect(
      channel.posted.every((message) => message.type === "presenter:hello"),
    ).toBe(true);
    expect(
      overlay()!.querySelector(".excalidraw__flow-animation-close"),
    ).toBeNull();
    expect(
      overlay()!.querySelector(".excalidraw__flow-animation-controls"),
    ).toBeNull();
    expect(overlay()!.style.pointerEvents).toBe("none");
    expect(document.querySelector('[data-testid="flow-bar"]')).toBeNull();
  });

  it("AC-212 an idle presenter draws nothing", async () => {
    const { elements, sendScene, sendFlow } = await presenterWithChart();

    await sendScene(elements);

    expect(overlay()).toBeNull();

    await sendFlow(snapshotOf(elements));
    expect(overlay()).not.toBeNull();

    // the editor stopped: so does the presenter
    await sendFlow(null);
    expect(overlay()).toBeNull();
  });
});
