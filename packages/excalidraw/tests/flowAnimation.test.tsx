/**
 * The flow animation.
 *
 * Four things are checked here, and each of them is checked against the
 * library's own behaviour rather than against this implementation's own
 * arithmetic:
 *
 * - the step order comes from the **arrows**, with the reading order only
 *   breaking the ties the arrows leave (AC-48, AC-49);
 * - the overlay's screen position is the position the **canvas** would use,
 *   computed through `sceneCoordsToViewportCoords` and through the transform
 *   string the implementation actually produces, parsed and applied with plain
 *   matrix maths (AC-50);
 * - playing the animation changes **nothing** in the document (AC-51).
 */

import React from "react";

import { afterEach, describe, expect, it, vi } from "vitest";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import { getCommonBounds, getTargetElements } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import { actionFlowLayout } from "../actions/actionFlowLayout";
import {
  flowAnimationStateAtom,
  startFlowAnimation,
  stopFlowAnimation,
} from "../components/FlowAnimationState";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";
import { AnimationController } from "../renderer/animation";
import { buildFlowGraph } from "../scene/flowOrder";
import {
  flowBoundsTransform,
  flowFocusTransform,
} from "../scene/flowAnimation";

import { API } from "./helpers/api";
import { act, render } from "./test-utils";

import type { NormalizedZoomValue } from "../types";

const { h } = window;

const ANIMATION_KEY = "flow-animation";

type Point = { x: number; y: number };

type Camera = {
  zoom: { value: NormalizedZoomValue };
  scrollX: number;
  scrollY: number;
  offsetLeft: number;
  offsetTop: number;
};

const map = (elements: ExcalidrawElement[]) =>
  new Map(elements.map((el) => [el.id, el])) as unknown as ElementsMap;

/** the selection, the way `getTargetElements` sees it: bound text folded in */
const targetElementsOf = (
  elements: ExcalidrawElement[],
  ids: string[],
): ExcalidrawElement[] =>
  getTargetElements(map(elements), {
    selectedElementIds: ids.reduce((acc: Record<string, true>, id) => {
      acc[id] = true;
      return acc;
    }, {}),
    editingTextElement: null,
    newElement: null,
  });

/**
 * Applies a CSS transform string to a point.
 *
 * CSS applies the functions left to right, outermost first, so a point is
 * pushed through them back to front. Written out longhand rather than with a
 * matrix so that a wrong argument in the transform string cannot hide inside a
 * shared helper.
 */
const applyTransform = (transform: string, point: Point): Point => {
  const functions = [
    ...transform.matchAll(/(translate|scale|rotate)\(([^)]*)\)/g),
  ].reverse();

  let { x, y } = point;

  for (const [, fn, rawArgs] of functions) {
    const args = rawArgs.split(",").map((arg) => parseFloat(arg));

    if (fn === "translate") {
      x += args[0];
      y += args.length > 1 ? args[1] : 0;
    } else if (fn === "scale") {
      x *= args[0];
      y *= args.length > 1 ? args[1] : args[0];
    } else {
      const cos = Math.cos(args[0]);
      const sin = Math.sin(args[0]);
      [x, y] = [x * cos - y * sin, x * sin + y * cos];
    }
  }

  return { x, y };
};

const box = (overrides: Record<string, unknown> = {}) =>
  API.createElement({
    type: "rectangle",
    width: 100,
    height: 60,
    ...overrides,
  } as never);

const arrowBetween = (
  id: string,
  from: ExcalidrawElement,
  to: ExcalidrawElement,
) =>
  API.createElement({
    type: "arrow",
    id,
    x: from.x,
    y: from.y,
    width: to.x - from.x,
    height: to.y - from.y,
    points: [pointFrom(0, 0), pointFrom(to.x - from.x, to.y - from.y)],
    startBinding: {
      elementId: from.id,
      fixedPoint: [0.5, 0.5],
      mode: "inside",
    },
    endBinding: {
      elementId: to.id,
      fixedPoint: [0.5, 0.5],
      mode: "inside",
    },
  } as never);

describe("the flow animation", () => {
  afterEach(() => {
    act(() => {
      stopFlowAnimation();
    });
    AnimationController.cancel(ANIMATION_KEY);
    vi.restoreAllMocks();
  });

  it("AC-48 the step order follows the arrows", () => {
    // three shapes in a row, so the reading order on its own would be A, B, C
    const a = box({ id: "A", x: 0, y: 0 });
    const b = box({ id: "B", x: 200, y: 0 });
    const c = box({ id: "C", x: 400, y: 0 });

    // ... but the arrow says B comes before A, and A comes before C
    const ba = arrowBetween("ba", b, a);
    const ac = arrowBetween("ac", a, c);

    const elements = [a, b, c, ba, ac];
    const targetElements = targetElementsOf(
      elements,
      elements.map((el) => el.id),
    );

    const graph = buildFlowGraph(targetElements, map(elements));

    // the arrows win over the reading order: B before A, A before C
    expect(graph.steps.map((step) => step.containerId)).toEqual([
      b.id,
      a.id,
      c.id,
    ]);

    // and the edges the arrows gave us are the edges of the graph
    expect(graph.edges).toEqual([
      { from: b.id, to: a.id },
      { from: a.id, to: c.id },
    ]);
  });

  it("AC-48 a labelled shape is one step, not two", () => {
    // D-60: `getTargetElements` folds the bound text into the selection, so a
    // labelled box arrives as two entries and the resolver has to dedupe on the
    // container
    const a = box({ id: "A", x: 0, y: 0 });
    const label = API.createElement({
      type: "text",
      id: "A-label",
      x: 0,
      y: 0,
      text: "A",
      containerId: a.id,
    } as never);

    const b = box({ id: "B", x: 200, y: 0 });

    const elements = [a, label, b];
    const targetElements = targetElementsOf(elements, [a.id, b.id]);

    // the selection really does hold three entries
    expect(targetElements.length).toBe(3);

    const graph = buildFlowGraph(targetElements, map(elements));

    // ... but the flow has two steps, not three
    expect(graph.steps.length).toBe(2);
    expect(graph.steps.map((step) => step.containerId)).toEqual([a.id, b.id]);
    expect(graph.steps[0].elementIds).toEqual([a.id, label.id]);
  });

  it("AC-49 with no arrows the steps are the selected elements in reading order", () => {
    // two shapes in the top row (their vertical spans overlap) and one well
    // below them, so the reading order is: top row left to right, then the
    // lower shape
    const topLeft = box({ id: "TL", x: 0, y: 0 });
    const topRight = box({ id: "TR", x: 200, y: 10 });
    const bottom = box({ id: "B", x: 400, y: 400 });

    // handed over in a scrambled order on purpose: the reading order has to
    // sort them, not inherit the order they came in
    const elements = [bottom, topRight, topLeft];

    const graph = buildFlowGraph(
      targetElementsOf(
        elements,
        elements.map((el) => el.id),
      ),
      map(elements),
    );

    expect(graph.steps.map((step) => step.containerId)).toEqual([
      topLeft.id,
      topRight.id,
      bottom.id,
    ]);
  });

  it("AC-49 a cycle is broken, not refused", () => {
    // D-62: the owner's own words are "this entire thing is in a loop"
    const a = box({ id: "A", x: 0, y: 0 });
    const b = box({ id: "B", x: 200, y: 0 });

    const ab = arrowBetween("ab", a, b);
    const ba = arrowBetween("ba", b, a);

    const elements = [a, b, ab, ba];

    const graph = buildFlowGraph(
      targetElementsOf(
        elements,
        elements.map((el) => el.id),
      ),
      map(elements),
    );

    // every step is still walked, and the loop does not stop the flow
    expect(graph.steps.map((step) => step.containerId).sort()).toEqual(
      [a.id, b.id].sort(),
    );
  });

  it("AC-50 the overlay's screen position for a shape equals the position the canvas would use", () => {
    const element = box({ id: "S", x: 300, y: 200, width: 120, height: 80 });
    const elementsMap = map([element]);

    const camera: Camera = {
      zoom: { value: 1.7 as NormalizedZoomValue },
      scrollX: -1340,
      scrollY: -220,
      offsetLeft: 24,
      offsetTop: 12,
    };

    const [x1, y1, x2, y2] = getCommonBounds([element], elementsMap);

    const transform = flowBoundsTransform(
      { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
      camera,
    );

    // the overlay's box starts exactly where the canvas would put the shape
    const placed = applyTransform(transform, { x: 0, y: 0 });
    const expected = sceneCoordsToViewportCoords(
      { sceneX: x1, sceneY: y1 },
      camera,
    );

    expect(placed.x).toBeCloseTo(expected.x - camera.offsetLeft, 3);
    expect(placed.y).toBeCloseTo(expected.y - camera.offsetTop, 3);

    // ... and it ends where the canvas would end it
    const placedEnd = applyTransform(transform, {
      x: x2 - x1,
      y: y2 - y1,
    });
    const expectedEnd = sceneCoordsToViewportCoords(
      { sceneX: x2, sceneY: y2 },
      camera,
    );

    expect(placedEnd.x).toBeCloseTo(expectedEnd.x - camera.offsetLeft, 3);
    expect(placedEnd.y).toBeCloseTo(expectedEnd.y - camera.offsetTop, 3);
  });

  it("AC-50 the focused step grows about the centre of its own bounds", () => {
    const stepBox = { x: 0, y: 0, width: 100, height: 200 };
    const elementBox = { x: 0, y: 0, width: 100, height: 60 };

    const transform = flowFocusTransform(stepBox, elementBox, 1.5);

    // the step's centre is the fixed point of the transform
    const stepCentre = { x: 50, y: 100 };
    const movedCentre = applyTransform(transform, stepCentre);

    expect(movedCentre.x).toBeCloseTo(stepCentre.x, 3);
    expect(movedCentre.y).toBeCloseTo(stepCentre.y, 3);

    // and the element really did grow
    const movedTop = applyTransform(transform, { x: 0, y: 0 });
    expect(movedTop.y).toBeLessThan(0);
  });

  it("the auto-layout lays the shapes out in layers, and it is undoable", async () => {
    await render(<Excalidraw />);

    const a = box({ id: "A", x: 0, y: 0 });
    const b = box({ id: "B", x: 200, y: 0 });
    const ab = arrowBetween("ab", a, b);

    API.setElements([a, b, ab]);
    API.setSelectedElements([a, b, ab]);

    const undoDepthBefore = API.getUndoStack().length;

    act(() => {
      h.app.actionManager.executeAction(actionFlowLayout, "ui");
    });

    const after = new Map(h.elements.map((el) => [el.id, el]));
    const laidOutA = after.get("A")!;
    const laidOutB = after.get("B")!;

    // the arrow says A comes before B, so the layout puts A in the upper rank
    expect(laidOutA.y).toBeLessThan(laidOutB.y);

    // the layout is a normal scene mutation, so it is undoable
    expect(API.getUndoStack().length).toBeGreaterThan(undoDepthBefore);
  });

  it("AC-51 playing the animation changes nothing in the document", async () => {
    await render(<Excalidraw />);

    const a = box({ id: "A", x: 0, y: 0 });
    const b = box({ id: "B", x: 200, y: 0 });
    const ab = arrowBetween("ab", a, b);
    API.setElements([a, b, ab]);
    API.setSelectedElements([a, b, ab]);

    const elementsMap = h.app.scene.getNonDeletedElementsMap();
    const graph = buildFlowGraph(
      getTargetElements(elementsMap, h.state),
      elementsMap,
    );

    expect(graph.steps.length).toBe(2);

    // the document, as it stands before the animation is played
    const elementsBefore = JSON.stringify(h.elements);
    const appStateBefore = JSON.stringify(h.state);
    const undoDepthBefore = API.getUndoStack().length;

    // the clock the animation runs on. It is driven by the AnimationController,
    // so the only thing the test does is move `performance.now()` forward and
    // let the scheduled frame run.
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    const seen: number[] = [];
    const unsubscribe = editorJotaiStore.sub(flowAnimationStateAtom, () => {
      seen.push(editorJotaiStore.get(flowAnimationStateAtom).index);
    });

    const tick = async (elapsed: number) => {
      now += elapsed;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };

    await act(async () => {
      startFlowAnimation(graph.steps, { durationMs: 100, loop: true });
    });

    // the overlay is up
    expect(
      document.querySelector(".excalidraw__flow-animation"),
    ).not.toBeNull();

    // the first frame establishes the baseline, the second crosses the step
    // duration, so the animation really moved on
    await tick(0);
    await tick(200);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toContain(1);

    // the document is untouched
    expect(JSON.stringify(h.elements)).toBe(elementsBefore);
    expect(JSON.stringify(h.state)).toBe(appStateBefore);
    expect(API.getUndoStack().length).toBe(undoDepthBefore);

    unsubscribe();
  });
});
