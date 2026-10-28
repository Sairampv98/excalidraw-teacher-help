/**
 * AC-249 - Apply keeps the nodes that match (D-223).
 *
 * A chart is built by the real builder, changed by hand the way a teacher would
 * change it (moved, recoloured, marked for class), and an edited script is
 * applied to it. What is read is what is in the scene afterwards.
 */

import React from "react";

import { describe, expect, it } from "vitest";

import { CaptureUpdateAction } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { applyFlowScript } from "../scene/flowApply";
import { readChartRecord } from "../scene/flowChart";
import { buildFlowPreset } from "../scene/flowPresets";
import { PAGE_HEIGHT, PAGE_WIDTH } from "../types";

import { Keyboard } from "./helpers/ui";
import { act, render } from "./test-utils";

import type { FlowChartShape, FlowPageRect } from "../scene/flowPresets";
import type { FlowFitMode } from "../scene/flowChart";
import type { FlowPresetId } from "../scene/flowScript";

const { h } = window;

const PAGE: FlowPageRect = {
  x: 0,
  y: 0,
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
};
const CHART = "chart-apply";
const CLASS = { node: "pulse", arrow: "token" };

const build = (
  preset: FlowPresetId,
  script: string,
  shape: FlowChartShape = "own",
  fit: FlowFitMode = "page",
) => {
  const built = buildFlowPreset(preset, script, {
    seed: 2,
    page: PAGE,
    chartId: CHART,
    shape,
    fit,
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements;
};

const apply = (
  elements: readonly ExcalidrawElement[],
  preset: FlowPresetId,
  script: string,
  shape: FlowChartShape = "own",
  fit: FlowFitMode = "page",
) => {
  const result = applyFlowScript({
    elements,
    chartId: CHART,
    preset,
    script,
    fit,
    shape,
    page: PAGE,
    seed: 9,
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return result;
};

const live = (elements: readonly ExcalidrawElement[]) =>
  elements.filter((element) => !element.isDeleted);

const shapesOf = (elements: readonly ExcalidrawElement[]) =>
  live(elements).filter(
    (element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      element.customData?.flow?.role === "node",
  );

const labelOf = (
  elements: readonly ExcalidrawElement[],
  shape: ExcalidrawElement,
) =>
  (
    elements.find(
      (element): element is ExcalidrawTextElement =>
        element.type === "text" && element.containerId === shape.id,
    ) as ExcalidrawTextElement
  ).originalText;

const byLabel = (elements: readonly ExcalidrawElement[], label: string) =>
  shapesOf(elements).find((shape) => labelOf(elements, shape) === label)!;

const arrowsOf = (elements: readonly ExcalidrawElement[]) =>
  live(elements).filter(
    (element) =>
      element.type === "arrow" && element.customData?.flow?.role === "edge",
  );

/** what a teacher does to a chart by hand */
const edited = (elements: readonly ExcalidrawElement[]) =>
  elements.map((element) => {
    if (element.customData?.flow?.role !== "node" || element.type === "text") {
      return element;
    }

    const label = labelOf(elements, element);

    if (label === "Teach") {
      return {
        ...element,
        x: element.x + 140,
        y: element.y + 90,
        backgroundColor: "#ff6b6b",
        width: element.width + 20,
        customData: {
          ...element.customData,
          flow: { ...element.customData.flow, class: CLASS },
        },
      } as ExcalidrawElement;
    }

    return element;
  });

const SCRIPT = "Plan\nTeach\nReview";

describe("AC-249 apply keeps the nodes that match", () => {
  it("AC-249 apply is one undo step", async () => {
    const before = build("process", SCRIPT);

    await render(
      <Excalidraw
        handleKeyboardGlobally={true}
        initialData={{ elements: before as never }}
      />,
    );

    const snapshot = JSON.stringify(
      live(h.elements).map((e) => [
        e.id,
        e.type === "arrow" ? 0 : e.x,
        e.type === "arrow" ? 0 : e.y,
        e.isDeleted,
      ]),
    );
    const result = apply(
      h.elements,
      "process",
      "Plan\nTeach\nReview\nPractise",
    );

    act(() => {
      h.app.updateScene({
        elements: result.elements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });

    expect(shapesOf(h.elements)).toHaveLength(4);

    // one undo takes the whole change back: the node, its label and its arrow
    Keyboard.undo();

    expect(
      JSON.stringify(
        live(h.elements).map((e) => [
          e.id,
          e.type === "arrow" ? 0 : e.x,
          e.type === "arrow" ? 0 : e.y,
          e.isDeleted,
        ]),
      ),
    ).toBe(snapshot);
  });

  it("AC-249 matched nodes keep what the teacher did to them", () => {
    const chart = edited(build("process", SCRIPT));
    const teach = byLabel(chart, "Teach");
    const result = apply(chart, "process", "Plan\nTeach\nReview\nPractise");
    const after = byLabel(result.elements, "Teach");

    // the same element: id, place, size, colour and the class mark
    expect(after.id).toBe(teach.id);
    expect(after.x).toBe(teach.x);
    expect(after.y).toBe(teach.y);
    expect(after.width).toBe(teach.width);
    expect(after.backgroundColor).toBe("#ff6b6b");
    expect(after.customData?.flow?.class).toEqual(CLASS);

    // and so are the ones that were not touched
    for (const label of ["Plan", "Review"]) {
      expect(byLabel(result.elements, label).id).toBe(byLabel(chart, label).id);
    }

    // a node that is new has the class mark too, so the chart plays as one
    expect(
      byLabel(result.elements, "Practise").customData?.flow?.class,
    ).toEqual(CLASS);
    expect(result.kept).toBe(3);
    expect(result.added).toBe(1);
  });

  it("AC-249 a new line adds a node and a removed line removes it", () => {
    const chart = build("process", SCRIPT);
    const teach = byLabel(chart, "Teach");
    const teachText = chart.find(
      (e) => e.type === "text" && e.containerId === teach.id,
    )!;

    const result = apply(chart, "process", "Plan\nReview\nPractise");

    expect(
      shapesOf(result.elements).map((s) => labelOf(result.elements, s)),
    ).toEqual(["Plan", "Review", "Practise"]);

    // the node and its label are gone, not hidden: they are deleted
    const gone = result.elements.filter(
      (e) => e.id === teach.id || e.id === teachText.id,
    );

    expect(gone).toHaveLength(2);
    expect(gone.every((e) => e.isDeleted)).toBe(true);
    expect(result).toMatchObject({ kept: 2, added: 1, removed: 1 });
  });

  it("AC-249 the arrows follow", () => {
    const chart = build("process", SCRIPT);
    const planToTeach = arrowsOf(chart).find(
      (a) => a.customData!.flow.from === "n0" && a.customData!.flow.to === "n1",
    )!;

    // an arrow that still joins the same two nodes stays - the same arrow
    const longer = apply(chart, "process", `${SCRIPT}\nPractise`);

    expect(arrowsOf(longer.elements).map((a) => a.id)).toContain(
      planToTeach.id,
    );
    expect(arrowsOf(longer.elements)).toHaveLength(3);

    // the arrows that touched a removed node are deleted, and the line that
    // joins its neighbours has an arrow of its own
    const shorter = apply(chart, "process", "Plan\nReview");

    const arrows = arrowsOf(shorter.elements);

    expect(arrows).toHaveLength(1);

    const ids = new Map(shapesOf(shorter.elements).map((s) => [s.id, s]));
    const [arrow] = arrows;

    if (arrow.type === "arrow") {
      // bound at both ends, to the shapes that are there
      expect(ids.has(arrow.startBinding!.elementId)).toBe(true);
      expect(ids.has(arrow.endBinding!.elementId)).toBe(true);
      expect(
        labelOf(shorter.elements, ids.get(arrow.startBinding!.elementId)!),
      ).toBe("Plan");
      expect(
        labelOf(shorter.elements, ids.get(arrow.endBinding!.elementId)!),
      ).toBe("Review");
    }

    // and the shapes name the arrow back, and no arrow that has gone
    for (const shape of shapesOf(shorter.elements)) {
      for (const bound of shape.boundElements ?? []) {
        if (bound.type === "arrow") {
          expect(arrows.some((a) => a.id === bound.id)).toBe(true);
        }
      }
    }
  });

  it("AC-249 a hand layout is kept", () => {
    const chart = edited(build("process", SCRIPT));
    const result = apply(chart, "process", `${SCRIPT}\nPractise`);

    // every node that was there is exactly where the teacher left it
    for (const label of ["Plan", "Teach", "Review"]) {
      const was = byLabel(chart, label);
      const is = byLabel(result.elements, label);

      expect([is.x, is.y, is.width, is.height]).toEqual([
        was.x,
        was.y,
        was.width,
        was.height,
      ]);
    }

    // the new one is put by the layout, and not on top of anything
    const added = byLabel(result.elements, "Practise");

    for (const other of shapesOf(result.elements)) {
      if (other.id === added.id) {
        continue;
      }

      const apart =
        added.x + added.width <= other.x ||
        other.x + other.width <= added.x ||
        added.y + added.height <= other.y ||
        other.y + other.height <= added.y;

      expect(apart).toBe(true);
    }
  });

  it("AC-249 a change of preset or fit mode rebuilds in place", () => {
    const chart = edited(build("process", SCRIPT));
    const centre = (elements: readonly ExcalidrawElement[]) => {
      const shapes = shapesOf(elements);
      const left = Math.min(...shapes.map((s) => s.x));
      const right = Math.max(...shapes.map((s) => s.x + s.width));
      const top = Math.min(...shapes.map((s) => s.y));
      const bottom = Math.max(...shapes.map((s) => s.y + s.height));

      return [(left + right) / 2, (top + bottom) / 2];
    };

    for (const [preset, shape, fit] of [
      ["cycle", "own", "page"],
      ["process", "circle", "page"],
      ["process", "own", "larger"],
    ] as const) {
      const result = apply(chart, preset, SCRIPT, shape, fit);

      expect(result.rebuilt).toBe(true);

      // the old chart is deleted, a new one stands in its place
      expect(
        live(result.elements).every(
          (e) => !live(chart).some((c) => c.id === e.id),
        ),
      ).toBe(true);
      expect(shapesOf(result.elements)).toHaveLength(3);

      const [x, y] = centre(result.elements);
      const [ox, oy] = centre(chart);

      expect(x).toBeCloseTo(ox, 0);
      expect(y).toBeCloseTo(oy, 0);
    }
  });

  it("AC-249 the chart's id and animation settings are kept", () => {
    const chart = edited(build("process", SCRIPT));

    for (const result of [
      apply(chart, "process", `${SCRIPT}\nPractise`),
      apply(chart, "cycle", SCRIPT),
    ]) {
      const shapes = shapesOf(result.elements);

      // every element is still the same chart's
      for (const element of live(result.elements)) {
        expect(element.customData?.flow?.chartId).toBe(CHART);
      }

      // the animation's settings stay on the node that had them; a rebuild
      // puts them on every node of the new chart
      expect(byLabel(result.elements, "Teach").customData?.flow?.class).toEqual(
        CLASS,
      );

      if (result.rebuilt) {
        for (const shape of shapes) {
          expect(shape.customData?.flow?.class).toEqual(CLASS);
        }
      }

      // and exactly one shape holds the record, with the new script
      const records = live(result.elements)
        .map((element) => readChartRecord(element))
        .filter(Boolean);

      expect(records).toHaveLength(1);
      expect(records[0]!.script).toContain("Review");
    }
  });
});
