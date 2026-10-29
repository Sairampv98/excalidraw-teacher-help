/**
 * AC-220 - the arrow is hidden and recoloured by the canvas, and what travels
 * has a colour (D-204).
 *
 * What the canvas is given is read where it is handed over: the renderer's own
 * answer, spied on, in the render the editor really makes. Nothing is checked
 * by looking for something painted on top.
 */

import fs from "node:fs";
import path from "node:path";

import React from "react";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
} from "@excalidraw/element/types";

import {
  setFlowArrowLooks,
  getFlowArrowLooks,
} from "../components/FlowArrowLooksState";
import {
  setFlowClassPreview,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "../components/FlowAnimationState";
import { Excalidraw } from "../index";
import { AnimationController } from "../renderer/animation";
import {
  NO_ARROW_LOOKS,
  arrowLooksFor,
  elementForCanvas,
  recoloured,
} from "../scene/flowArrowLooks";
import { withFlowClass } from "../scene/flowClass";
import { FLOW_LOOK_DEFAULTS } from "../scene/flowLook";
import { exportToSvg } from "../scene/export";
import { buildFlowPreset } from "../scene/flowPresets";
import { flowOfSelection } from "../scene/flowSelection";

import { API } from "./helpers/api";
import { act, render } from "./test-utils";

import type { FlowClassSettings } from "../scene/flowClass";
import type { Renderer } from "../scene/Renderer";

const { h } = window;

const SETTINGS: FlowClassSettings = {
  ...FLOW_LOOK_DEFAULTS,
  node: "focus",
  arrow: "token",
  speed: 240,
  stepMs: 100000,
  loop: true,
};

/** a decision chart: its arrows carry labels, the yes and the no */
const chart = (settings: FlowClassSettings | null) => {
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

const arrows = () =>
  live().filter(
    (element): element is ExcalidrawArrowElement => element.type === "arrow",
  );

const renderer = () => (h.app as unknown as { renderer: Renderer }).renderer;

/** what the canvas was given in the last render the editor made */
const lastDrawn = (spy: ReturnType<typeof spyOnRenderer>) => {
  const last = spy.mock.results.at(-1)?.value as
    | { elementsMap: Map<string, ExcalidrawElement> }
    | undefined;

  return last!.elementsMap;
};

const spyOnRenderer = () => vi.spyOn(renderer(), "getRenderableElements");

const viewMode = (on: boolean) =>
  act(() => {
    h.setState({ viewModeEnabled: on });
  });

const styleSheet = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, relative), "utf8");

afterEach(() => {
  vi.restoreAllMocks();
  stopFlowAnimation();
  setFlowClassPreview(false);
  setFlowArrowLooks("animation", []);
  setFlowArrowLooks("class", []);
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

describe("AC-220 the arrow is hidden and recoloured by the canvas", () => {
  it("AC-220 what travels along an arrow is drawn in the mark colour", async () => {
    await mount(
      chart({
        ...SETTINGS,
        node: "none",
        arrow: "marching",
        markColor: "#00aa00",
      }),
      { viewModeEnabled: true },
    );

    const group = document.querySelector(
      "[data-flow-class-flow]",
    ) as SVGGElement;

    expect(group.style.getPropertyValue("--flow-mark-color")).toBe("#00aa00");

    // the stylesheet draws the marks with it
    const scss = styleSheet("../components/FlowAnimationOverlay.scss");

    for (const mark of ["dash", "beam", "token", "base"]) {
      expect(scss).toMatch(
        new RegExp(
          `flow-mark--${mark} \\{[^}]*var\\(--flow-mark-color, var\\(--color-primary\\)\\)`,
        ),
      );
    }
  });

  it("AC-220 the canvas draws a recoloured arrow in its colour", async () => {
    await mount(chart({ ...SETTINGS, arrowColor: "#ff00ff" }));

    const spy = spyOnRenderer();

    viewMode(true);

    const drawn = lastDrawn(spy);

    expect(arrows().length).toBeGreaterThan(0);

    for (const arrow of arrows()) {
      const given = drawn.get(arrow.id) as ExcalidrawArrowElement;

      expect(given.strokeColor).toBe("#ff00ff");
      // a copy: the same arrow, in another colour
      expect(given).not.toBe(arrow);
      expect(given.id).toBe(arrow.id);
      expect(given.points).toEqual(arrow.points);
    }
  });

  it("AC-220 the canvas does not draw a hidden arrow", async () => {
    await mount(chart({ ...SETTINGS, hideArrow: true }));

    const spy = spyOnRenderer();

    viewMode(true);

    const drawn = lastDrawn(spy);

    for (const arrow of arrows()) {
      expect(drawn.has(arrow.id)).toBe(false);
    }

    // and nothing else is missing, but the labels of the arrows, which the
    // overlay draws above what is animated (D-203, D-213)
    const arrowIds = new Set(arrows().map((arrow) => arrow.id));

    for (const element of live().filter(
      (e) =>
        e.type !== "arrow" &&
        !(e.type === "text" && e.containerId && arrowIds.has(e.containerId)),
    )) {
      expect(drawn.has(element.id)).toBe(true);
    }
  });

  it("AC-220 nothing is painted over the arrow", async () => {
    await mount(
      chart({ ...SETTINGS, hideArrow: true, arrowColor: "#ff00ff" }),
      {
        viewModeEnabled: true,
      },
    );

    expect(document.querySelector('[data-flow-mark="arrow-cover"]')).toBeNull();
    expect(
      document.querySelector('[data-flow-mark="arrow-cover-head"]'),
    ).toBeNull();
    expect(document.querySelector("[data-flow-covers]")).toBeNull();
  });

  it("AC-220 the elements and the document are not changed", async () => {
    await mount(chart({ ...SETTINGS, hideArrow: true, arrowColor: "#ff00ff" }));

    const before = JSON.stringify(h.elements);
    const colours = arrows().map((arrow) => arrow.strokeColor);

    viewMode(true);

    // the editor still holds every arrow, as it was
    expect(arrows()).toHaveLength(colours.length);
    expect(arrows().map((arrow) => arrow.strokeColor)).toEqual(colours);
    expect(JSON.stringify(h.elements)).toBe(before);
    expect(
      h.app.scene.getNonDeletedElements().filter((e) => e.type === "arrow"),
    ).toHaveLength(colours.length);
  });

  it("AC-220 the copies are kept between frames", async () => {
    await mount(chart({ ...SETTINGS, arrowColor: "#ff00ff" }));

    const spy = spyOnRenderer();

    viewMode(true);

    const first = lastDrawn(spy).get(arrows()[0].id);

    // another render of the editor: the very same copy is handed over again
    act(() => {
      h.setState({ scrollX: h.state.scrollX + 30 });
    });

    expect(lastDrawn(spy).get(arrows()[0].id)).toBe(first);

    // the pure rule: the same element in the same colour is the same copy ...
    const element = arrows()[0];

    expect(recoloured(element, "#123456")).toBe(recoloured(element, "#123456"));
    expect(recoloured(element, "#123456")).not.toBe(
      recoloured(element, "#654321"),
    );

    // ... and it is made again when the element changes
    const before = recoloured(element, "#123456");

    act(() => {
      API.updateElement(element, { strokeWidth: element.strokeWidth + 1 });
    });

    const after = recoloured(arrows()[0], "#123456");

    expect(after).not.toBe(before);
    expect(after.strokeWidth).toBe(arrows()[0].strokeWidth);
  });

  it("AC-220 the arrow is drawn again when the animation stops", async () => {
    await mount(chart({ ...SETTINGS, hideArrow: true }));

    const spy = spyOnRenderer();

    viewMode(true);

    expect(lastDrawn(spy).has(arrows()[0].id)).toBe(false);

    viewMode(false);

    // every arrow is back, and it is the arrow itself
    for (const arrow of arrows()) {
      expect(lastDrawn(spy).get(arrow.id)).toBe(arrow);
    }

    expect(getFlowArrowLooks()).toBe(NO_ARROW_LOOKS);
  });

  it("AC-220 an exported image shows the arrow", async () => {
    await mount(chart({ ...SETTINGS, hideArrow: true }));

    const exported = async () =>
      (
        await exportToSvg(
          h.app.scene.getNonDeletedElements(),
          {
            exportBackground: true,
            viewBackgroundColor: h.state.viewBackgroundColor,
          },
          {},
        )
      ).outerHTML;

    const before = await exported();

    viewMode(true);

    // while the arrows are hidden on the canvas, the export is the same
    expect(getFlowArrowLooks().size).toBeGreaterThan(0);
    expect(await exported()).toBe(before);
  });
});

describe("AC-220 the pure rules", () => {
  it("a flow gives its arrows the look it is asked for", () => {
    const elements = chart(null);
    const map = new Map(elements.map((element) => [element.id, element]));
    const graph = flowOfSelection(
      Object.fromEntries(elements.map((element) => [element.id, true])),
      elements,
      map,
    )!;

    expect(
      arrowLooksFor(graph, { hideArrow: false, arrowColor: null }),
    ).toEqual([]);

    const hidden = arrowLooksFor(graph, {
      hideArrow: true,
      arrowColor: "#fff",
    });

    expect(hidden).toHaveLength(graph.edgeArrows.length);
    expect(hidden.every(([, look]) => look.hidden && look.color === null)).toBe(
      true,
    );

    const coloured = arrowLooksFor(graph, {
      hideArrow: false,
      arrowColor: "#abc",
    });

    expect(
      coloured.every(([, look]) => !look.hidden && look.color === "#abc"),
    ).toBe(true);

    // what the canvas is given, for each look
    const arrow = elements.find((e) => e.type === "arrow")!;

    expect(elementForCanvas(arrow, undefined)).toBe(arrow);
    expect(elementForCanvas(arrow, new Map())).toBe(arrow);
    expect(
      elementForCanvas(
        arrow,
        new Map([[arrow.id, { hidden: true, color: null }]]),
      ),
    ).toBeNull();
    expect(
      elementForCanvas(
        arrow,
        new Map([[arrow.id, { hidden: false, color: "#abc" }]]),
      )?.strokeColor,
    ).toBe("#abc");
  });
});
