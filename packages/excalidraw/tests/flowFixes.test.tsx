/**
 * AC-204 to AC-206 and AC-210 - the flow studio's fixes (D-173 to D-175,
 * D-179).
 *
 * A chart is made by the library's own presets and then handled by the editor's
 * own resize path, and every expectation is read back from the elements: the
 * bindings, the arrow ends, the text. Nothing here re-derives the code's own
 * formulas.
 */

import React from "react";

import { afterEach, describe, expect, it } from "vitest";

import { pointFrom } from "@excalidraw/math";

import { distanceToElement } from "@excalidraw/element";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import {
  actionFlowLayout,
  actionFlowResetLayout,
  flowResetLayoutPredicate,
  readFlowHome,
} from "../actions/actionFlowLayout";
import {
  FLOW_SETTINGS_STORAGE_KEY,
  flowAnimationStateAtom,
  startFlowAnimation,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "../components/FlowAnimationState";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";
import { RANK_SEPARATION } from "../scene/flowLayout";
import {
  BASE_FLOW_FONT_SIZE,
  MIN_FLOW_FONT_SIZE,
  buildFlowPreset,
} from "../scene/flowPresets";
import {
  FLOW_SCALE_MAX,
  FLOW_SCALE_MIN,
  chartScaleFromFontSizes,
  chartScaleOf,
} from "../scene/flowScale";
import { flowOfSelection } from "../scene/flowSelection";
import {
  FLOW_BEAM_LENGTH,
  FLOW_DASH,
  FLOW_SPEED,
  FLOW_SPEED_MAX,
  FLOW_SPEED_MIN,
  FLOW_TOKEN_RADIUS,
  clampFlowSpeed,
  flowMarksFor,
  pathLength,
} from "../scene/flowStyles";

import { API } from "./helpers/api";
import { Keyboard, UI } from "./helpers/ui";
import { act, fireEvent, render, screen } from "./test-utils";

import type { NormalizedZoomValue } from "../types";
import type { FlowPresetId } from "../scene/flowPresets";

const { h } = window;

const SCRIPTS: Record<string, [FlowPresetId, string]> = {
  process: ["process", "Plan\nTeach\nReview\nPractise"],
  decision: ["decision", "Start\n? Ready?\nGo\nWait\nFinish"],
  network: ["network", "A -> B\nB -> C\nA -> C\nC -> D"],
};

/** a preset on the canvas, all of it selected, the way the user resizes it */
const chartOnCanvas = async (name: keyof typeof SCRIPTS) => {
  await render(<Excalidraw handleKeyboardGlobally={true} />);

  act(() => {
    h.setState({ width: 1400, height: 900 });
  });

  const [preset, script] = SCRIPTS[name];
  const built = buildFlowPreset(preset, script, { seed: 7 });

  if (!built.ok) {
    throw new Error(built.error);
  }

  API.setElements(built.elements);
  API.setSelectedElements(built.elements);

  return built.elements;
};

const live = () => h.elements.filter((element) => !element.isDeleted);

const arrowsOf = () =>
  live().filter(
    (element): element is ExcalidrawArrowElement => element.type === "arrow",
  );

const shapesOf = () =>
  live().filter(
    (element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      !!element.boundElements?.length,
  );

/** how far each arrow end is from the shape it says it is bound to */
const endDistances = () => {
  const map = h.app.scene.getNonDeletedElementsMap();
  const distances: number[] = [];

  for (const arrow of arrowsOf()) {
    const ends = [
      [arrow.startBinding, arrow.points[0]],
      [arrow.endBinding, arrow.points[arrow.points.length - 1]],
    ] as const;

    for (const [binding, point] of ends) {
      const shape = binding && map.get(binding.elementId);

      if (shape) {
        distances.push(
          distanceToElement(
            shape,
            map,
            pointFrom(arrow.x + point[0], arrow.y + point[1]),
          ),
        );
      }
    }
  }

  return distances;
};

const resizeAll = (factor: number) => {
  const [minX, minY, maxX, maxY] = (() => {
    const boxes = live().map((element) => [
      element.x,
      element.y,
      element.x + element.width,
      element.y + element.height,
    ]);

    return [
      Math.min(...boxes.map((b) => b[0])),
      Math.min(...boxes.map((b) => b[1])),
      Math.max(...boxes.map((b) => b[2])),
      Math.max(...boxes.map((b) => b[3])),
    ];
  })();

  UI.resize(live(), "se", [
    (maxX - minX) * (factor - 1),
    (maxY - minY) * (factor - 1),
  ]);
};

describe("AC-204 resizing a chart keeps its arrows on its shapes", () => {
  for (const factor of [0.5, 2]) {
    it(`AC-204 a resized chart keeps both sides of every binding (x${factor})`, async () => {
      for (const name of Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[]) {
        await chartOnCanvas(name);
        resizeAll(factor);

        const ids = new Set(live().map((element) => element.id));

        for (const arrow of arrowsOf()) {
          for (const binding of [arrow.startBinding, arrow.endBinding]) {
            expect(binding, `${name}: ${arrow.id} unbound`).not.toBeNull();
            expect(ids.has(binding!.elementId)).toBe(true);

            const shape = live().find((e) => e.id === binding!.elementId)!;

            expect(
              shape.boundElements?.some((bound) => bound.id === arrow.id),
              `${name}: ${shape.id} does not name ${arrow.id}`,
            ).toBe(true);
          }
        }
      }
    });
  }

  it("AC-204 every arrow end is on its shape after a resize", async () => {
    for (const factor of [0.5, 2]) {
      await chartOnCanvas("process");

      const before = Math.max(...endDistances());

      resizeAll(factor);

      // an end that was on its shape stays as near as it was
      expect(Math.max(...endDistances())).toBeLessThanOrEqual(before + 2);
    }
  });

  it("AC-204 the text scales with its shape", async () => {
    await chartOnCanvas("process");

    const fontBefore = (
      live().find((e) => e.type === "text") as ExcalidrawTextElement
    ).fontSize;

    resizeAll(2);

    const texts = live().filter(
      (e): e is ExcalidrawTextElement => e.type === "text" && !!e.containerId,
    );

    expect(texts.length).toBeGreaterThan(0);

    for (const text of texts) {
      expect(text.fontSize).toBeGreaterThan(fontBefore * 1.5);

      const container = live().find(
        (e) => e.id === text.containerId,
      ) as ExcalidrawElement;

      expect(text.x).toBeGreaterThanOrEqual(container.x - 1);
      expect(text.x + text.width).toBeLessThanOrEqual(
        container.x + container.width + 1,
      );
      expect(text.y).toBeGreaterThanOrEqual(container.y - 1);
      expect(text.y + text.height).toBeLessThanOrEqual(
        container.y + container.height + 1,
      );
    }
  });

  it("AC-204 a decision chart survives being doubled", async () => {
    await chartOnCanvas("decision");

    const before = Math.max(...endDistances());

    resizeAll(2);

    expect(shapesOf().length).toBeGreaterThan(2);
    expect(Math.max(...endDistances())).toBeLessThanOrEqual(before + 2);
  });
});

/* ------------------------------------------------------------------ AC-205 */

/** a chart, doubled, with its shapes pushed about by hand so a layout has work */
const scrambledChart = async () => {
  await chartOnCanvas("process");
  resizeAll(2);

  shapesOf().forEach((shape, index) => {
    API.updateElement(shape, {
      x: shape.x + (index % 2 ? 160 : -90),
      y: shape.y + 55 * index,
    });
  });

  API.setSelectedElements(live());
};

const layout = () =>
  act(() => {
    h.app.actionManager.executeAction(actionFlowLayout, "ui");
  });

const resetLayout = () =>
  act(() => {
    h.app.actionManager.executeAction(actionFlowResetLayout, "ui");
  });

const sizes = () =>
  live()
    .filter((e) => e.type !== "arrow")
    .map((e) => [
      e.id,
      e.width,
      e.height,
      (e as ExcalidrawTextElement).fontSize,
    ]);

const positionsOfShapes = () =>
  new Map(shapesOf().map((shape) => [shape.id, [shape.x, shape.y]]));

describe("AC-205 lay this out keeps the scale and can be reset", () => {
  it("AC-205 layout does not change the size of the shapes", async () => {
    await scrambledChart();

    const before = sizes();

    layout();

    expect(sizes()).toEqual(before);

    // and the gaps follow the chart: it is twice the base size, so the gap
    // between two layers is twice the base gap, and nothing overlaps
    const ordered = [...shapesOf()].sort((a, b) => a.y - b.y);

    for (let i = 1; i < ordered.length; i++) {
      const gap = ordered[i].y - (ordered[i - 1].y + ordered[i - 1].height);

      expect(gap).toBeGreaterThanOrEqual(RANK_SEPARATION * 2 - 1);
    }
  });

  it("AC-205 layout remembers the first position only", async () => {
    await scrambledChart();

    const first = positionsOfShapes();

    layout();

    for (const shape of shapesOf()) {
      expect(readFlowHome(shape)).toEqual({
        x: first.get(shape.id)![0],
        y: first.get(shape.id)![1],
      });
    }

    // moved by hand, then laid out again: the home is still the first one
    API.updateElement(shapesOf()[0], { x: shapesOf()[0].x + 300 });
    API.setSelectedElements(live());
    layout();

    for (const shape of shapesOf()) {
      expect(readFlowHome(shape)).toEqual({
        x: first.get(shape.id)![0],
        y: first.get(shape.id)![1],
      });
    }
  });

  it("AC-205 reset puts the shapes back and the arrows follow", async () => {
    await scrambledChart();

    const first = positionsOfShapes();
    const distances = Math.max(...endDistances());

    layout();
    resetLayout();

    for (const shape of shapesOf()) {
      expect([shape.x, shape.y]).toEqual(first.get(shape.id));
    }

    expect(Math.max(...endDistances())).toBeLessThanOrEqual(
      Math.max(distances, 1) + 2,
    );
  });

  it("AC-205 reset is one undo step", async () => {
    await scrambledChart();

    layout();

    const laidOut = positionsOfShapes();

    resetLayout();
    act(() => {
      Keyboard.undo();
    });

    expect(positionsOfShapes()).toEqual(laidOut);
  });

  it("AC-205 reset is offered only after a layout", async () => {
    await scrambledChart();

    expect(flowResetLayoutPredicate(h.state, h.app)).toBe(false);

    layout();

    expect(flowResetLayoutPredicate(h.state, h.app)).toBe(true);
  });

  it("AC-205 a hand-moved shape is reset too", async () => {
    await scrambledChart();

    const first = positionsOfShapes();

    layout();

    const moved = shapesOf()[1];

    API.updateElement(moved, { x: moved.x + 500, y: moved.y - 200 });
    API.setSelectedElements(live());
    resetLayout();

    for (const shape of shapesOf()) {
      expect([shape.x, shape.y]).toEqual(first.get(shape.id));
    }
  });
});

/* ------------------------------------------------------- AC-206 and AC-210 */

const LONG_PATH = [
  { x: 0, y: 0 },
  { x: 5000, y: 0 },
];

describe("AC-206 the marks size follows the chart", () => {
  it("AC-206 the scale is the median font size over the base", () => {
    const base = BASE_FLOW_FONT_SIZE;

    expect(chartScaleFromFontSizes([base, base, base])).toBe(1);
    expect(chartScaleFromFontSizes([base * 2, base * 2, base])).toBe(2);
    // an even count takes the middle of the two in the middle
    expect(chartScaleFromFontSizes([base - 4, base + 4])).toBe(1);
    expect(chartScaleFromFontSizes([])).toBe(1);
  });

  it("AC-206 the scale is clamped", () => {
    expect(chartScaleFromFontSizes([1])).toBe(FLOW_SCALE_MIN);
    expect(chartScaleFromFontSizes([9999])).toBe(FLOW_SCALE_MAX);
    expect(FLOW_SCALE_MIN).toBe(0.5);
    expect(FLOW_SCALE_MAX).toBe(4);
  });

  const marks = (
    style: Parameters<typeof flowMarksFor>[0],
    scale: number,
    elapsed = 2000,
  ) => flowMarksFor(style, LONG_PATH, elapsed, { scale });

  it("AC-206 a smaller chart gets smaller marks", () => {
    const small = MIN_FLOW_FONT_SIZE / BASE_FLOW_FONT_SIZE;

    expect(marks("marching", small).strokes[0].dash![0]).toBeLessThan(
      marks("marching", 1).strokes[0].dash![0],
    );
    expect(marks("token", small).dots[0].radius).toBeLessThan(
      marks("token", 1).dots[0].radius,
    );
    expect(pathLength(marks("beam", small).strokes[1].points)).toBeLessThan(
      pathLength(marks("beam", 1).strokes[1].points),
    );
    expect(marks("pipe", small).strokes[0].width).toBeLessThan(
      marks("pipe", 1).strokes[0].width,
    );
  });

  it("AC-206 a larger chart gets larger marks", () => {
    expect(marks("marching", 2).strokes[0].dash).toEqual([
      FLOW_DASH[0] * 2,
      FLOW_DASH[1] * 2,
    ]);
    expect(marks("token", 2).dots[0].radius).toBe(FLOW_TOKEN_RADIUS * 2);
    expect(pathLength(marks("beam", 2).strokes[1].points)).toBeCloseTo(
      FLOW_BEAM_LENGTH * 2,
    );
  });

  it("AC-206 the numbers are proportional to the scale", () => {
    for (const scale of [0.5, 1.5, 3]) {
      expect(marks("token", scale).dots[0].radius).toBeCloseTo(
        FLOW_TOKEN_RADIUS * scale,
      );
      expect(marks("pipe", scale).strokes.map((s) => s.width)).toEqual(
        marks("pipe", 1).strokes.map((s) => s.width * scale),
      );
    }
  });

  it("AC-206 the zoom does not change the scale", async () => {
    await chartOnCanvas("process");

    const map = h.app.scene.getNonDeletedElementsMap();
    const graph = flowOfSelection(h.state.selectedElementIds, h.elements, map)!;
    const before = chartScaleOf(graph, map);

    act(() => {
      h.setState({ zoom: { value: 0.4 as NormalizedZoomValue } });
    });

    expect(chartScaleOf(graph, map)).toBe(before);
  });

  it("AC-206 a resize changes the marks at once", async () => {
    await chartOnCanvas("process");

    const scaleNow = () => {
      const map = h.app.scene.getNonDeletedElementsMap();

      return chartScaleOf(
        flowOfSelection(h.state.selectedElementIds, h.elements, map)!,
        map,
      );
    };

    const before = scaleNow();

    resizeAll(2);

    expect(scaleNow()).toBeGreaterThanOrEqual(Math.min(before * 1.5, 4));
  });
});

describe("AC-210 the speed is tunable, and time-based", () => {
  afterEach(() => {
    stopFlowAnimation();
    updateFlowAnimationSettings({ speed: FLOW_SPEED });
  });

  const tokenAt = (elapsed: number, speed?: number) =>
    flowMarksFor("token", LONG_PATH, elapsed, { speed }).dots[0].x;

  it("AC-210 the speed has a range and a default", () => {
    expect(FLOW_SPEED_MIN).toBe(10);
    expect(FLOW_SPEED_MAX).toBe(600);
    expect(FLOW_SPEED).toBe(240);
    expect(clampFlowSpeed(5)).toBe(10);
    expect(clampFlowSpeed(99999)).toBe(600);
    expect(clampFlowSpeed(NaN)).toBe(240);
    // nothing said is the default
    expect(tokenAt(1000)).toBe(tokenAt(1000, FLOW_SPEED));
  });

  it("AC-210 double the speed covers double the distance", () => {
    expect(tokenAt(1000, 200)).toBeCloseTo(tokenAt(1000, 100) * 2);
    expect(tokenAt(2500, 400)).toBeCloseTo(tokenAt(2500, 200) * 2);
  });

  it("AC-210 changing the speed does not restart the animation", async () => {
    await chartOnCanvas("process");

    const map = h.app.scene.getNonDeletedElementsMap();
    const graph = flowOfSelection(h.state.selectedElementIds, h.elements, map)!;

    startFlowAnimation(graph.steps, { mode: "play", graph });

    const before = editorJotaiStore.get(flowAnimationStateAtom);

    updateFlowAnimationSettings({ speed: 500 });

    const after = editorJotaiStore.get(flowAnimationStateAtom);

    expect(after.speed).toBe(500);
    expect(after.active).toBe(true);
    expect(after.steps).toBe(before.steps);
    expect(after.index).toBe(before.index);
    // and it is the teachers own setting, so it is there next session
    expect(
      JSON.parse(window.localStorage.getItem(FLOW_SETTINGS_STORAGE_KEY)!).speed,
    ).toBe(500);
  });

  it("AC-210 the distance does not depend on the frame rate", () => {
    // the same second, seen as 20 frames and as 4 frames
    const frames = (count: number) => {
      let elapsed = 0;

      for (let i = 0; i < count; i++) {
        elapsed += 1000 / count;
      }

      return elapsed;
    };

    expect(tokenAt(frames(20), 300)).toBeCloseTo(tokenAt(frames(4), 300));
    expect(tokenAt(frames(20), 300)).toBeCloseTo(300);
  });

  it("AC-210 the slider shows its value", async () => {
    await chartOnCanvas("process");

    const slider = screen.getByLabelText("Animation speed") as HTMLInputElement;
    const shown = () => screen.getByLabelText("Animation speed value");

    expect(slider.min).toBe("10");
    expect(slider.max).toBe("600");
    expect(slider.value).toBe("240");
    expect(shown().textContent).toBe("240");

    fireEvent.change(slider, { target: { value: "400" } });

    expect(shown().textContent).toBe("400");
    expect(
      (screen.getByLabelText("Animation speed") as HTMLInputElement).value,
    ).toBe("400");
  });
});
