/**
 * AC-232 - the presenter does the same (D-205).
 *
 * The other window is played by hand over a fake `BroadcastChannel`. What the
 * presenter's canvas is given is read where the renderer hands it over, in the
 * presenter's own render.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import React from "react";

import { ExcalidrawAPIProvider } from "@excalidraw/excalidraw";
import {
  applyFlowAnimationSnapshot,
  stopFlowAnimation,
} from "@excalidraw/excalidraw/components/FlowAnimationState";
import {
  getFlowArrowLooks,
  setFlowArrowLooks,
} from "@excalidraw/excalidraw/components/FlowArrowLooksState";
import { AnimationController } from "@excalidraw/excalidraw/renderer/animation";
import { withFlowClass } from "@excalidraw/excalidraw/scene/flowClass";
import { FLOW_LOOK_DEFAULTS } from "@excalidraw/excalidraw/scene/flowLook";
import { buildFlowPreset } from "@excalidraw/excalidraw/scene/flowPresets";
import { flowOfSelection } from "@excalidraw/excalidraw/scene/flowSelection";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { act, render } from "@excalidraw/excalidraw/tests/test-utils";

import type { FlowAnimationSnapshot } from "@excalidraw/excalidraw/components/FlowAnimationState";
import type { FlowClassSettings } from "@excalidraw/excalidraw/scene/flowClass";
import type { Renderer } from "@excalidraw/excalidraw/scene/Renderer";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { PresenterView } from "../presenter/PresenterView";

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
  ...FLOW_LOOK_DEFAULTS,
  node: "pulse",
  arrow: "token",
  speed: 240,
  stepMs: 100000,
  loop: true,
};

/** a decision chart: its arrows carry labels, the yes and the no */
const chart = (settings: FlowClassSettings | null): ExcalidrawElement[] => {
  const built = buildFlowPreset(
    "decision",
    "Start\n? Ready?\nGo\nWait\nFinish",
    {
      seed: 6,
    },
  );

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

const stepIdsOf = (elements: readonly ExcalidrawElement[]) => {
  const map = new Map(elements.map((element) => [element.id, element]));

  return flowOfSelection(
    Object.fromEntries(elements.map((element) => [element.id, true])),
    elements,
    map,
  )!.steps.map((step) => step.containerId);
};

const arrowIds = (elements: readonly ExcalidrawElement[]) =>
  elements.filter((element) => element.type === "arrow").map((e) => e.id);

beforeEach(() => {
  FakeBroadcastChannel.instances = [];
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});

afterEach(() => {
  vi.restoreAllMocks();
  stopFlowAnimation();
  applyFlowAnimationSnapshot(null, [], new Map());
  setFlowArrowLooks("animation", []);
  setFlowArrowLooks("class", []);

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
  const renderer = (h.app as unknown as { renderer: Renderer }).renderer;
  const spy = vi.spyOn(renderer, "getRenderableElements");

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

  /** what the presenter's canvas was given in its last render */
  const drawn = () =>
    (
      spy.mock.results.at(-1)!.value as {
        elementsMap: Map<string, ExcalidrawElement>;
      }
    ).elementsMap;

  return { channel, sendScene, sendFlow, drawn };
};

describe("AC-232 the presenter does the same", () => {
  it("AC-232 the presenter's canvas hides the arrows of a flow it loops", async () => {
    const elements = chart({ ...SETTINGS, hideArrow: true });
    const { sendScene, drawn } = await presenter();

    await sendScene(elements);

    expect(getFlowArrowLooks().size).toBeGreaterThan(0);

    for (const id of arrowIds(elements)) {
      expect(drawn().has(id)).toBe(false);
    }

    // everything else is drawn, but the labels of the arrows: the overlay
    // draws those above what is animated (D-203, D-213)
    const ids = new Set(arrowIds(elements));

    for (const element of elements.filter(
      (e) =>
        e.type !== "arrow" &&
        !(e.type === "text" && e.containerId && ids.has(e.containerId)),
    )) {
      expect(drawn().has(element.id)).toBe(true);
    }
  });

  it("AC-232 the presenter's canvas hides the arrows of a flow it mirrors", async () => {
    // not marked for class: only what the editor says is animated
    const elements = chart(null);
    const { sendScene, sendFlow, drawn } = await presenter();

    await sendScene(elements);

    for (const id of arrowIds(elements)) {
      expect(drawn().has(id)).toBe(true);
    }

    await sendFlow({
      ...FLOW_LOOK_DEFAULTS,
      hideArrow: true,
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

    for (const id of arrowIds(elements)) {
      expect(drawn().has(id)).toBe(false);
    }

    // the editor stopped: the arrows are back
    await sendFlow(null);

    for (const id of arrowIds(elements)) {
      expect(drawn().has(id)).toBe(true);
    }
  });

  it("AC-232 the presenter draws the letters and the arrow labels", async () => {
    const elements = chart({ ...SETTINGS, nodeTarget: "letters" });
    const { sendScene } = await presenter();

    await sendScene(elements);

    // the letters of the step that is current, lit as letters
    expect(
      document.querySelectorAll(
        ".excalidraw__flow-class [data-flow-label].excalidraw__flow-label--letters",
      ),
    ).toHaveLength(1);

    // and the yes and the no above the animation along the arrows
    expect(
      document.querySelectorAll("[data-flow-arrow-label]").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("AC-232 a presenter with nothing animated draws every arrow", async () => {
    const elements = chart(null);
    const { sendScene, drawn } = await presenter();

    await sendScene(elements);

    expect(getFlowArrowLooks().size).toBe(0);

    for (const element of elements) {
      expect(drawn().get(element.id)).toBe(
        h.app.scene.getNonDeletedElementsMap().get(element.id),
      );
    }

    expect(document.querySelector("[data-flow-arrow-label]")).toBeNull();
  });
});

describe("AC-239 the presenter never sees a label twice", () => {
  it("AC-239 the presenter does the same", async () => {
    const elements = chart(SETTINGS);
    const ids = new Set(arrowIds(elements));
    const labels = elements.filter(
      (e) => e.type === "text" && e.containerId && ids.has(e.containerId),
    );
    const { sendScene, drawn } = await presenter();

    await sendScene(elements);

    // the yes and the no: the overlay's copies are there, the canvas's are not
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(document.querySelectorAll("[data-flow-arrow-label]")).toHaveLength(
      labels.length,
    );

    for (const label of labels) {
      expect(drawn().has(label.id)).toBe(false);
    }
  });
});
