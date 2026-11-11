/**
 * AC-234, AC-235 and AC-236 - the neon tube, the text colour apart from the
 * shape colour, and the pipe made from the animation colour (D-208, D-209,
 * D-210).
 *
 * What is drawn is read where the editor really draws it: the overlay's own
 * elements and the variables the stylesheet draws with. The stylesheet itself
 * is read as text for the rules that only it can state.
 */

import fs from "node:fs";
import path from "node:path";

import React from "react";

import { afterEach, describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  FLOW_SETTINGS_STORAGE_KEY,
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
import {
  FLOW_LOOK_DEFAULTS,
  flowLookVars,
  mixHex,
  neonCore,
  pipeColorsFor,
} from "../scene/flowLook";
import { buildFlowPreset } from "../scene/flowPresets";
import { flowOfSelection } from "../scene/flowSelection";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen } from "./test-utils";

import type { FlowClassSettings } from "../scene/flowClass";

const { h } = window;

const SETTINGS: FlowClassSettings = {
  ...FLOW_LOOK_DEFAULTS,
  node: "pulse",
  arrow: "token",
  speed: 240,
  // the loop stays on its first step for the whole test
  stepMs: 100000,
  loop: true,
};

const sheet = fs.readFileSync(
  path.resolve(__dirname, "../components/FlowAnimationOverlay.scss"),
  "utf8",
);

/** the stylesheet's block for what is drawn with the glow on */
const glowBlock = () => {
  const start = sheet.indexOf("The neon tube (D-208, D-217)");

  if (start < 0) {
    throw new Error("no glow block in the stylesheet");
  }

  return sheet.slice(start);
};

/** the rule for `selector` inside the glow block, as written */
const glowRule = (selector: string) => {
  const block = glowBlock();
  const at = block.indexOf(`${selector} {`);

  if (at < 0) {
    throw new Error(`no glow rule for ${selector}`);
  }

  return block.slice(at, block.indexOf("}", at));
};

const chart = (settings: FlowClassSettings | null) => {
  const built = buildFlowPreset("process", "Plan\nTeach\nReview", { seed: 2 });

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

const state = () => editorJotaiStore.get(flowAnimationStateAtom);

const wholeFlow = () =>
  flowOfSelection(
    Object.fromEntries(live().map((element) => [element.id, true])),
    live(),
    h.app.scene.getNonDeletedElementsMap(),
  )!;

/** the bar of a selected chart, with its Look section open */
const lookOpen = async () => {
  await mount(chart(null));

  act(() => {
    API.setSelectedElements([shapes()[0]]);
  });
  act(() => {
    fireEvent.click(screen.getByRole("tab", { name: "Look" }));
  });
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

describe("AC-234 the glow is a neon tube", () => {
  it("AC-234 glow is off by default", async () => {
    expect(FLOW_LOOK_DEFAULTS.glowShape).toBe(false);
    expect(state().glowShape).toBe(false);

    await mount(chart(SETTINGS), { viewModeEnabled: true });

    expect(document.querySelector(".excalidraw__flow-class")).not.toBeNull();
    expect(document.querySelector("[data-flow-glow-shape]")).toBeNull();
  });

  it("AC-234 the switch turns it on", async () => {
    await lookOpen();

    const glow = screen.getByLabelText("Neon shape") as HTMLInputElement;

    expect(glow.checked).toBe(false);

    act(() => {
      fireEvent.click(glow);
    });

    expect(state().glowShape).toBe(true);
    expect(
      (screen.getByLabelText("Neon shape") as HTMLInputElement).checked,
    ).toBe(true);

    // and it is on what is drawn: the animation, played from the bar
    const graph = wholeFlow();

    act(() => {
      startFlowAnimation(graph.steps, { mode: "play", graph });
    });

    expect(document.querySelector("[data-flow-glow-shape]")).not.toBeNull();

    act(() => {
      fireEvent.click(screen.getByLabelText("Neon shape"));
    });

    expect(document.querySelector("[data-flow-glow-shape]")).toBeNull();
  });

  it("AC-234 the class loop carries it on a marked chart", async () => {
    await mount(chart({ ...SETTINGS, glowShape: true }), {
      viewModeEnabled: true,
    });

    expect(
      document.querySelector(".excalidraw__flow-class [data-flow-glow-shape]"),
    ).not.toBeNull();

    for (const shape of shapes()) {
      expect(readFlowClass(shape)?.glowShape).toBe(true);
    }
  });

  it("AC-234 a glowing highlight has a bright core and a halo and no fill", () => {
    const outline = glowRule(".excalidraw__flow-node-outline");

    // no fill: the outline is a tube, not a patch
    expect(outline).toMatch(/fill:\s*none/);
    // the core is the colour lightened, and the colour is the halo's
    expect(outline).toMatch(/stroke:\s*var\(\s*--flow-node-core/);

    // layered shadows of growing reach, so that it blooms
    const reaches = [...outline.matchAll(/drop-shadow\(\s*0 0 (\d+)px/g)].map(
      (match) => Number(match[1]),
    );

    expect(reaches.length).toBeGreaterThanOrEqual(3);
    expect([...reaches].sort((a, b) => a - b)).toEqual(reaches);

    // the core is a lightened colour: no channel darker than the colour's own
    const channels = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

    for (const color of ["#ff3131", "#39ff14", "#00f0ff", "#3d7bff"]) {
      const core = neonCore(color);

      channels(core).forEach((channel, i) =>
        expect(channel).toBeGreaterThanOrEqual(channels(color)[i]),
      );
      expect(core).toBe(mixHex(color, "#ffffff", 0.75));
    }

    expect(neonCore("#ff0000")).not.toBe("#ff0000");
  });

  it("AC-234 the glow is in the colour of what it surrounds", () => {
    // the shape's tube is drawn with the shape colour, the text's with the
    // text colour, what travels with the animation colour
    expect(glowRule(".excalidraw__flow-node-outline")).toMatch(
      /--flow-node-color/,
    );
    expect(glowRule(".excalidraw__flow-label--letters")).toMatch(
      /--flow-text-core/,
    );
    expect(glowRule(".excalidraw__flow-label--letters")).toMatch(
      /text-shadow:[\s\S]*--flow-text-color/,
    );
    expect(glowBlock()).toMatch(
      /flow-mark--token \{\s*fill: var\(\s*--flow-mark-core/,
    );

    // and the cores the stylesheet reads are made from those colours
    const vars = flowLookVars({
      nodeColor: "#ff0000",
      textColor: "#00ff00",
      markColor: "#0000ff",
    });

    expect(vars["--flow-node-core"]).toBe(neonCore("#ff0000"));
    expect(vars["--flow-text-core"]).toBe(neonCore("#00ff00"));
    expect(vars["--flow-mark-core"]).toBe(neonCore("#0000ff"));
  });

  it("AC-234 glow reaches the class entry and the presenter snapshot", async () => {
    await lookOpen();

    act(() => {
      fireEvent.click(screen.getByLabelText("Show in class"));
    });
    act(() => {
      fireEvent.click(screen.getByLabelText("Neon shape"));
    });

    // a marked chart is written through
    for (const shape of shapes()) {
      expect(readFlowClass(shape)?.glowShape).toBe(true);
    }

    // and what plays is described with it, for the projector
    const graph = wholeFlow();

    act(() => {
      startFlowAnimation(graph.steps, { mode: "present", graph });
    });

    expect(getFlowAnimationSnapshot()?.glowShape).toBe(true);
  });

  it("AC-234 an entry from before has no glow", async () => {
    await mount(chart(SETTINGS));

    const old = {
      ...shapes()[0],
      customData: { flow: { class: { node: "pulse", arrow: "token" } } },
    } as ExcalidrawElement;

    expect(readFlowClass(old)).toMatchObject({
      glowShape: false,
      textColor: null,
    });
  });
});

describe("AC-235 the text colour is set apart from the shape colour", () => {
  it("AC-235 the text colour is set apart from the shape colour", () => {
    act(() => {
      updateFlowAnimationSettings({
        nodeColor: "#ff0000",
        textColor: "#00ff00",
      });
    });

    expect(state().nodeColor).toBe("#ff0000");
    expect(state().textColor).toBe("#00ff00");

    // changing one leaves the other
    act(() => {
      updateFlowAnimationSettings({ nodeColor: "#0000ff" });
    });

    expect(state().textColor).toBe("#00ff00");
  });

  it("AC-235 the shape takes the shape colour", async () => {
    await mount(
      chart({
        ...SETTINGS,
        nodeTarget: "shape-text",
        nodeColor: "#ff0000",
        textColor: "#00ff00",
      }),
      { viewModeEnabled: true },
    );

    const outline = document.querySelector(
      '.excalidraw__flow-class [data-flow-part="shape"]',
    ) as HTMLElement;
    const wrapper = outline.closest(
      ".excalidraw__flow-animation-shape",
    ) as HTMLElement;

    expect(wrapper.style.getPropertyValue("--flow-node-color")).toBe("#ff0000");
    // the outline of a shape is drawn with the shape colour, not the text's
    expect(sheet).not.toMatch(
      /\[data-flow-part="shape"\][^{]*\{[^}]*--flow-text-color/,
    );
  });

  it("AC-235 the box and the letters take the text colour", async () => {
    // the box
    expect(sheet).toMatch(
      /\[data-flow-part="box"\] \.excalidraw__flow-node-outline \{\s*fill: var\(\s*--flow-text-color/,
    );
    // the letters, with the glow off and on
    expect(sheet).toMatch(
      /\.excalidraw__flow-label--letters \{\s*color: var\(\s*--flow-text-color/,
    );
    expect(glowRule(".excalidraw__flow-label--letters")).toMatch(
      /--flow-text-core/,
    );

    await mount(
      chart({
        ...SETTINGS,
        nodeTarget: "shape-box",
        nodeColor: "#ff0000",
        textColor: "#00ff00",
      }),
      { viewModeEnabled: true },
    );

    const box = document.querySelector(
      '.excalidraw__flow-class [data-flow-part="box"]',
    ) as HTMLElement;

    expect(
      (
        box.closest(".excalidraw__flow-animation-shape") as HTMLElement
      ).style.getPropertyValue("--flow-text-color"),
    ).toBe("#00ff00");
  });

  it("AC-235 the text colour follows the shape colour until it is set", () => {
    const followed = flowLookVars({
      nodeColor: "#ff0000",
      textColor: null,
      markColor: null,
    });

    // nothing is set for the text, and the core it glows with is the shape's
    expect(followed["--flow-text-color"]).toBeUndefined();
    expect(followed["--flow-text-core"]).toBe(neonCore("#ff0000"));

    // the stylesheet falls back from the text colour to the shape colour
    expect(sheet).toMatch(
      /var\(\s*--flow-text-color,\s*var\(\s*--flow-node-color/,
    );

    const set = flowLookVars({
      nodeColor: "#ff0000",
      textColor: "#00ff00",
      markColor: null,
    });

    expect(set["--flow-text-color"]).toBe("#00ff00");
    expect(set["--flow-text-core"]).toBe(neonCore("#00ff00"));
  });

  it("AC-235 it is remembered, saved and sent", async () => {
    act(() => {
      updateFlowAnimationSettings({ textColor: "#00ff00" });
    });

    // remembered between sessions
    expect(
      JSON.parse(window.localStorage.getItem(FLOW_SETTINGS_STORAGE_KEY)!),
    ).toMatchObject({ textColor: "#00ff00" });

    // saved in the chart, when it is marked
    await lookOpen();

    act(() => {
      fireEvent.click(screen.getByLabelText("Show in class"));
    });

    for (const shape of shapes()) {
      expect(readFlowClass(shape)?.textColor).toBe("#00ff00");
    }

    // sent to the projector
    const graph = wholeFlow();

    act(() => {
      startFlowAnimation(graph.steps, { mode: "present", graph });
    });

    expect(getFlowAnimationSnapshot()?.textColor).toBe("#00ff00");
  });

  it("AC-235 an entry from before follows the shape", async () => {
    await mount(chart(SETTINGS));

    const old = {
      ...shapes()[0],
      customData: {
        flow: { class: { node: "pulse", nodeColor: "#ff0000" } },
      },
    } as ExcalidrawElement;

    const read = readFlowClass(old)!;

    expect(read.nodeColor).toBe("#ff0000");
    expect(read.textColor).toBeNull();
  });
});

describe("AC-236 the pipe is made from the animation colour", () => {
  const PIPE: FlowClassSettings = {
    ...SETTINGS,
    node: "none",
    arrow: "pipe",
    markColor: "#00aa00",
  };

  it("AC-236 the pipe is made from the animation colour", async () => {
    await mount(chart(PIPE), { viewModeEnabled: true });

    expect(
      document.querySelectorAll('[data-flow-mark="pipe-dark"]').length,
    ).toBeGreaterThan(0);

    const group = document.querySelector(
      ".excalidraw__flow-class [style*='--flow-pipe-dark']",
    ) as HTMLElement;

    expect(group).not.toBeNull();
    expect(group.style.getPropertyValue("--flow-pipe-light")).toBe("#00aa00");
    expect(group.style.getPropertyValue("--flow-pipe-dark")).not.toBe(
      "#1e1e1e",
    );

    // the strokes are drawn from those variables
    expect(sheet).toMatch(
      /flow-mark--pipe-dark \{\s*stroke: var\(--flow-pipe-dark/,
    );
    expect(sheet).toMatch(
      /flow-mark--pipe-light \{\s*stroke: var\(--flow-pipe-light/,
    );
    expect(sheet).toMatch(
      /flow-mark--pipe-flow \{\s*stroke: var\(--flow-pipe-flow/,
    );
  });

  it("AC-236 the shades are computed from the colour", () => {
    expect(pipeColorsFor("#00aa00")).toEqual({
      // the outer stroke: 60% toward black
      dark: "#004400",
      // the body: the colour itself
      body: "#00aa00",
      // the highlight along it: 80% toward white
      flow: "#cceecc",
    });

    const vars = flowLookVars({
      nodeColor: null,
      textColor: null,
      markColor: "#00aa00",
    });

    expect(vars["--flow-pipe-dark"]).toBe("#004400");
    expect(vars["--flow-pipe-light"]).toBe("#00aa00");
    expect(vars["--flow-pipe-flow"]).toBe("#cceecc");
  });

  it("AC-236 with no colour the pipe is as it was", () => {
    const vars = flowLookVars({
      nodeColor: null,
      textColor: null,
      markColor: null,
    });

    expect(vars["--flow-pipe-dark"]).toBeUndefined();
    expect(vars["--flow-pipe-light"]).toBeUndefined();
    expect(vars["--flow-pipe-flow"]).toBeUndefined();

    // the defaults in the stylesheet are the strokes it always had
    expect(sheet).toMatch(/var\(--flow-pipe-dark, #1e1e1e\)/);
    expect(sheet).toMatch(/var\(--flow-pipe-light, #868e96\)/);
    expect(sheet).toMatch(/var\(--flow-pipe-flow, #ffffff\)/);
  });

  it("AC-236 the pipe glows when glow is on", () => {
    expect(glowRule(".excalidraw__flow-mark--pipe-light")).toMatch(
      /drop-shadow\(0 0 \d+px var\(--flow-mark-color/,
    );
  });
});
