/**
 * AC-199 to AC-203 - the animation styles, the pipe, the camera and the
 * interactive steps (D-166, D-167, D-170, D-171, D-172).
 *
 * The geometry is pure, so it is tested as pure: where a mark is at a given
 * time, what a flight ends on, what `next` and a choice do. Where a position is
 * compared with the canvas it goes through the library's own
 * `sceneCoordsToViewportCoords`, and not a formula written out again here.
 *
 * Spec-first (wave 7q): each `it.todo` at the bottom is a row's overlay-level
 * test that is not written yet.
 */

import fs from "node:fs";
import path from "node:path";

import React from "react";

import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_ZOOM, sceneCoordsToViewportCoords } from "@excalidraw/common";
import { pointFrom } from "@excalidraw/math";

import { getTargetElements } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
} from "@excalidraw/element/types";

import {
  FLOW_CAMERA_PADDING,
  cameraAt,
  easeOutCirc,
  flightTarget,
} from "../scene/flowCamera";
import {
  FLOW_BEAM_LENGTH,
  FLOW_DASH,
  FLOW_SPEED,
  flowMarksFor,
  getArrowPath,
  pathLength,
  pointAtDistance,
} from "../scene/flowStyles";
import {
  FLOW_DRAW_ON_MS,
  choicesAt,
  currentIndex,
  downstreamSteps,
  drawOnProgress,
  isEndStep,
  presentChoose,
  presentNext,
  presentPrevious,
  reachedIndices,
  startPath,
} from "../scene/flowPresent";

import {
  flowAnimationStateAtom,
  isFlowAnimationActive,
  presentStepBack,
  presentStepForward,
  startFlowAnimation,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "../components/FlowAnimationState";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";
import { AnimationController } from "../renderer/animation";
import { buildFlowGraph } from "../scene/flowOrder";
import { FLOW_STYLES } from "../scene/flowStyles";

import { API } from "./helpers/api";
import { act, render } from "./test-utils";

import type { PathPoint } from "../scene/flowStyles";
import type { FlowGraph } from "../scene/flowOrder";
import type { NormalizedZoomValue, PageRect } from "../types";

/* ------------------------------------------------------------------- helpers */

/** an arrow, as the document stores it: points relative to its position */
const arrow = (
  x: number,
  y: number,
  points: [number, number][],
  extra: Record<string, unknown> = {},
) =>
  API.createElement({
    type: "arrow",
    x,
    y,
    points: points.map(([px, py]) => pointFrom(px, py)),
    width:
      Math.max(...points.map((p) => p[0])) -
      Math.min(...points.map((p) => p[0])),
    height:
      Math.max(...points.map((p) => p[1])) -
      Math.min(...points.map((p) => p[1])),
    ...extra,
  } as never) as unknown as ExcalidrawLinearElement;

/** a straight path from (100, 50) to (500, 50) - 400 units long */
const STRAIGHT = getArrowPath(
  arrow(100, 50, [
    [0, 0],
    [400, 0],
  ]),
);

/** a bent path: right, then down, then right again - 600 units long */
const BENT = getArrowPath(
  arrow(0, 0, [
    [0, 0],
    [300, 0],
    [300, 200],
    [500, 200],
  ]),
);

/** how far a point is from a polyline */
const distanceToPath = (path: readonly PathPoint[], p: PathPoint) => {
  let best = Infinity;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2),
          );

    best = Math.min(
      best,
      Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)),
    );
  }

  return best;
};

/** how far along the path a point on it is */
const distanceAlong = (path: readonly PathPoint[], p: PathPoint) => {
  let travelled = 0;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segment = Math.hypot(b.x - a.x, b.y - a.y);

    if (distanceToPath([a, b], p) < 1e-6) {
      return travelled + Math.hypot(p.x - a.x, p.y - a.y);
    }

    travelled += segment;
  }

  return NaN;
};

const EPS = 1e-6;

/** a hand-written flow: ids and the arrows between them */
const graphOf = (ids: string[], edges: [string, string][]): FlowGraph => ({
  steps: ids.map((id, i) => ({
    containerId: id,
    elementIds: [id],
    box: { x: i * 200, y: 0, width: 100, height: 60 },
  })),
  edges: edges.map(([from, to]) => ({ from, to })),
  edgeArrows: edges.map(([from, to], i) => ({
    from,
    to,
    arrowId: `arrow${i}`,
  })),
});

/* ---------------------------------------------------------------- the styles */

describe("the animation styles (AC-199)", () => {
  it("AC-199 the beam travels the arrow's path", () => {
    let lastHead = -1;

    // the streak enters at the start and crosses; sampled across one crossing
    for (const elapsed of [200, 400, 700, 1000, 1200]) {
      const marks = flowMarksFor("beam", STRAIGHT, elapsed);
      const beam = marks.strokes.find((s) => s.role === "beam")!;

      expect(beam.points.length).toBeGreaterThanOrEqual(2);

      // every point of the streak is on the arrow
      for (const point of beam.points) {
        expect(distanceToPath(STRAIGHT, point)).toBeLessThan(EPS);
      }

      // and the streak is ahead of where it was: it travels toward the end
      const head = distanceAlong(STRAIGHT, beam.points[beam.points.length - 1]);

      expect(head).toBeGreaterThan(lastHead);
      lastHead = head;

      // the arrow itself is drawn faintly under it
      expect(marks.strokes.find((s) => s.role === "base")!.points).toEqual(
        STRAIGHT,
      );
    }

    // a streak is never longer than it is meant to be
    const beam = flowMarksFor("beam", STRAIGHT, 600).strokes.find(
      (s) => s.role === "beam",
    )!;

    expect(pathLength(beam.points)).toBeLessThanOrEqual(FLOW_BEAM_LENGTH + EPS);
  });

  it("AC-199 the token travels the arrow's path", () => {
    let last = -1;

    for (const elapsed of [0, 250, 500, 1000, 1500]) {
      const [dot] = flowMarksFor("token", STRAIGHT, elapsed).dots;

      expect(distanceToPath(STRAIGHT, dot)).toBeLessThan(EPS);

      const along = distanceAlong(STRAIGHT, dot);

      expect(along).toBeGreaterThan(last);
      last = along;
    }

    // it starts at the arrow's start, and starts again when it arrives
    expect(flowMarksFor("token", STRAIGHT, 0).dots[0]).toMatchObject({
      x: 100,
      y: 50,
    });

    const crossing = (pathLength(STRAIGHT) / FLOW_SPEED) * 1000;
    const again = flowMarksFor("token", STRAIGHT, crossing + 100).dots[0];

    expect(distanceAlong(STRAIGHT, again)).toBeCloseTo(
      (FLOW_SPEED * 100) / 1000,
      6,
    );
  });

  it("AC-199 the marching dashes follow the arrow", () => {
    const stroke = (elapsed: number) =>
      flowMarksFor("marching", BENT, elapsed).strokes[0];

    // the dashed stroke is laid along the whole arrow, bends and all
    expect(stroke(0).points).toEqual(BENT);
    expect(stroke(0).dash).toEqual(FLOW_DASH);

    // and its pattern runs toward the arrow's end: the offset only decreases
    // within a period, which moves the dashes in the direction the path is drawn
    expect(stroke(100).dashOffset!).toBeLessThan(stroke(0).dashOffset!);
    expect(stroke(200).dashOffset!).toBeLessThan(stroke(100).dashOffset!);

    // the pattern repeats: after one period it is where it started
    const period = ((FLOW_DASH[0] + FLOW_DASH[1]) / FLOW_SPEED) * 1000;

    expect(stroke(period).dashOffset!).toBeCloseTo(stroke(0).dashOffset!, 6);
  });

  it("AC-199 a curved arrow is followed, and a moved arrow too", () => {
    // a bent arrow is followed round its corners: the token is on the path at
    // every time, including after the first bend
    for (const elapsed of [100, 900, 1300, 2000, 2400]) {
      const [dot] = flowMarksFor("token", BENT, elapsed).dots;

      expect(distanceToPath(BENT, dot)).toBeLessThan(EPS);
    }

    expect(pathLength(BENT)).toBeCloseTo(300 + 200 + 200, 6);

    // after the first bend the point is on the second leg
    const afterBend = pointAtDistance(BENT, 400);

    expect(afterBend.x).toBeCloseTo(300, 6);
    expect(afterBend.y).toBeCloseTo(100, 6);

    // moving the arrow moves the path - the marks are drawn from the element
    const moved = getArrowPath(
      arrow(40, 30, [
        [0, 0],
        [300, 0],
        [300, 200],
        [500, 200],
      ]),
    );

    expect(moved[0]).toEqual({ x: 40, y: 30 });
    expect(moved[3]).toEqual({ x: 540, y: 230 });
    expect(flowMarksFor("token", moved, 0).dots[0]).toMatchObject({
      x: 40,
      y: 30,
    });

    // a rotated arrow is followed where it is drawn, about the centre of its bounds
    const turned = getArrowPath(
      arrow(
        0,
        0,
        [
          [0, 0],
          [200, 0],
        ],
        { angle: Math.PI / 2 },
      ),
    );

    expect(turned[0].x).toBeCloseTo(100, 6);
    expect(turned[0].y).toBeCloseTo(-100, 6);
    expect(turned[1].x).toBeCloseTo(100, 6);
    expect(turned[1].y).toBeCloseTo(100, 6);
  });
});

describe("the pipe (AC-201)", () => {
  it("AC-201 the pipe is three strokes on the arrow's path", () => {
    const { strokes, dots } = flowMarksFor("pipe", BENT, 300);

    expect(dots).toEqual([]);
    expect(strokes.map((s) => s.role)).toEqual([
      "pipe-dark",
      "pipe-light",
      "pipe-flow",
    ]);

    // all three are laid on the arrow's own path, bends and all
    for (const stroke of strokes) {
      expect(stroke.points).toEqual(BENT);
    }

    // the outer stroke is the widest and the highlight the thinnest, so they
    // read as a pipe with a light inside it
    const [dark, light, flow] = strokes;

    expect(dark.width).toBeGreaterThan(light.width);
    expect(light.width).toBeGreaterThan(flow.width);

    // only the highlight is dashed
    expect(dark.dash).toBeUndefined();
    expect(light.dash).toBeUndefined();
    expect(flow.dash).toEqual(FLOW_DASH);
  });

  it("AC-201 the dash runs toward the arrow's end", () => {
    const offset = (elapsed: number) =>
      flowMarksFor("pipe", STRAIGHT, elapsed).strokes[2].dashOffset!;

    // the offset falls as time passes, which moves the dashes the way the path
    // runs. The pattern repeats every 20 units (about 83 ms at this
    // speed), so the samples are taken inside one period
    expect(offset(20)).toBeLessThan(offset(0));
    expect(offset(40)).toBeLessThan(offset(20));

    // and by exactly the distance the flow travels in that time
    expect(offset(0) - offset(20)).toBeCloseTo((FLOW_SPEED * 20) / 1000, 6);
    expect(offset(20) - offset(40)).toBeCloseTo((FLOW_SPEED * 20) / 1000, 6);
  });

  it("AC-201 the speed does not depend on the frame rate", () => {
    // the marks are a function of the time elapsed, not of how many frames it
    // took to get there: sixty frames of 16 ms and thirty of 33 ms are the same
    // moment, and give the same picture
    const after = (frameMs: number) => {
      let elapsed = 0;

      while (elapsed + frameMs <= 990) {
        elapsed += frameMs;
      }

      return elapsed;
    };

    const slow = flowMarksFor("pipe", STRAIGHT, 990);
    const steady = flowMarksFor(
      "pipe",
      STRAIGHT,
      after(33) + (990 - after(33)),
    );

    expect(steady).toEqual(slow);

    // a second of flow is the same distance however it is sampled
    const token = (elapsed: number) =>
      distanceAlong(STRAIGHT, flowMarksFor("token", STRAIGHT, elapsed).dots[0]);

    expect(token(1000) - token(0)).toBeCloseTo(FLOW_SPEED, 6);
    expect(token(600) - token(200)).toBeCloseTo((FLOW_SPEED * 400) / 1000, 6);
  });
});

/* ------------------------------------------------------------------ the camera */

describe("the camera flight (AC-202)", () => {
  const VIEWPORT = { width: 1200, height: 800 };
  const PAGE: PageRect = { x: 0, y: 0, width: 1920, height: 1080 };

  const toViewport = (
    camera: { scrollX: number; scrollY: number; zoom: number },
    p: PathPoint,
  ) =>
    sceneCoordsToViewportCoords(
      { sceneX: p.x, sceneY: p.y },
      {
        zoom: { value: camera.zoom as NormalizedZoomValue },
        scrollX: camera.scrollX,
        scrollY: camera.scrollY,
        offsetLeft: 0,
        offsetTop: 0,
      },
    );

  it("AC-202 the step and its padding are in view at the end of the flight", () => {
    const box = { x: 800, y: 400, width: 240, height: 100 };
    const target = flightTarget({ box, viewport: VIEWPORT, pageRect: PAGE });

    // the corners of the step, pushed out by the padding, taken to the screen
    // through the library's own conversion, are inside the viewport
    for (const [x, y] of [
      [box.x - FLOW_CAMERA_PADDING, box.y - FLOW_CAMERA_PADDING],
      [
        box.x + box.width + FLOW_CAMERA_PADDING,
        box.y + box.height + FLOW_CAMERA_PADDING,
      ],
    ]) {
      const screen = toViewport(target, { x, y });

      expect(screen.x).toBeGreaterThanOrEqual(-0.5);
      expect(screen.y).toBeGreaterThanOrEqual(-0.5);
      expect(screen.x).toBeLessThanOrEqual(VIEWPORT.width + 0.5);
      expect(screen.y).toBeLessThanOrEqual(VIEWPORT.height + 0.5);
    }

    // it is as large as the viewport allows: one of the two sides is filled
    const a = toViewport(target, {
      x: box.x - FLOW_CAMERA_PADDING,
      y: box.y - FLOW_CAMERA_PADDING,
    });
    const b = toViewport(target, {
      x: box.x + box.width + FLOW_CAMERA_PADDING,
      y: box.y + box.height + FLOW_CAMERA_PADDING,
    });

    expect(
      Math.max(
        Math.abs(b.x - a.x) - VIEWPORT.width,
        Math.abs(b.y - a.y) - VIEWPORT.height,
      ),
    ).toBeGreaterThan(-1);

    // and the step is in the middle of what it shows
    const centre = toViewport(target, {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });

    expect(centre.x).toBeCloseTo(VIEWPORT.width / 2, 3);
    expect(centre.y).toBeCloseTo(VIEWPORT.height / 2, 3);
  });

  it("AC-202 the flight eases between the start and the target", () => {
    const from = { scrollX: 0, scrollY: 0, zoom: 0.5 };
    const to = flightTarget({
      box: { x: 800, y: 400, width: 240, height: 100 },
      viewport: VIEWPORT,
      pageRect: PAGE,
    });

    // exactly where it started, and exactly on the target at the end
    expect(cameraAt(from, to, 0, VIEWPORT)).toEqual(from);
    expect(cameraAt(from, to, 1, VIEWPORT)).toEqual(to);
    expect(cameraAt(from, to, 1.7, VIEWPORT)).toEqual(to);

    // in between it is between: the zoom neither under- nor overshoots
    const mid = cameraAt(from, to, 0.4, VIEWPORT);

    expect(mid.zoom).toBeGreaterThan(Math.min(from.zoom, to.zoom));
    expect(mid.zoom).toBeLessThan(Math.max(from.zoom, to.zoom));

    // the ease goes quickly first and arrives slowly: more than the straight-line
    // share of the way is covered in the first part
    const share = (mid.zoom - from.zoom) / (to.zoom - from.zoom);

    expect(share).toBeGreaterThan(0.4);
    expect(easeOutCirc(0.4)).toBeGreaterThan(0.4);
    expect(easeOutCirc(0)).toBe(0);
    expect(easeOutCirc(1)).toBe(1);

    // it never goes backwards
    let last = -1;

    for (let t = 0; t <= 1.0001; t += 0.05) {
      const zoom = cameraAt(from, to, t, VIEWPORT).zoom;

      expect(zoom).toBeGreaterThanOrEqual(last - 1e-9);
      last = zoom;
    }
  });

  it("AC-202 the camera stays on the page", () => {
    // a step in the far corner: the view is pulled back onto the page
    const corner = flightTarget({
      box: { x: 1820, y: 1000, width: 100, height: 60 },
      viewport: VIEWPORT,
      pageRect: PAGE,
    });

    const topLeft = toViewport(corner, { x: PAGE.x, y: PAGE.y });
    const bottomRight = toViewport(corner, {
      x: PAGE.x + PAGE.width,
      y: PAGE.y + PAGE.height,
    });

    // the page is never scrolled further than its own edge: no gap opens up
    // between the page and the viewport on the side the camera has not reached
    expect(topLeft.x).toBeLessThanOrEqual(VIEWPORT.width);
    expect(topLeft.y).toBeLessThanOrEqual(VIEWPORT.height);
    expect(bottomRight.x).toBeGreaterThanOrEqual(0);
    expect(bottomRight.y).toBeGreaterThanOrEqual(0);

    // a tiny step does not zoom in past the maximum, and a huge one does not
    // zoom out past the floor
    const tiny = flightTarget({
      box: { x: 500, y: 500, width: 4, height: 4 },
      viewport: VIEWPORT,
      pageRect: PAGE,
    });
    const huge = flightTarget({
      box: { x: -50000, y: -50000, width: 100000, height: 100000 },
      viewport: VIEWPORT,
      pageRect: PAGE,
    });

    expect(tiny.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    expect(huge.zoom).toBeGreaterThan(0);
    expect(Number.isFinite(huge.scrollX) && Number.isFinite(huge.scrollY)).toBe(
      true,
    );
  });
});

/* ---------------------------------------------------------- present, and choose */

describe("presenting step by step (AC-200, AC-203)", () => {
  it("AC-200 presenting reveals one step at a time", () => {
    let path = startPath();

    // the first step only
    expect([...reachedIndices(path)]).toEqual([0]);

    // each next reveals one more
    path = presentNext(path, 4);
    expect([...reachedIndices(path)]).toEqual([0, 1]);
    path = presentNext(path, 4);
    expect([...reachedIndices(path)]).toEqual([0, 1, 2]);
    expect(currentIndex(path)).toBe(2);

    // going back un-reveals the step it leaves, and shows no more than that
    path = presentPrevious(path);
    expect([...reachedIndices(path)]).toEqual([0, 1]);
    expect(currentIndex(path)).toBe(1);
  });

  it("AC-200 next and previous stop at the ends", () => {
    let path = startPath();

    // previous at the start stays at the start
    expect(presentPrevious(path)).toEqual([0]);

    for (let i = 0; i < 10; i++) {
      path = presentNext(path, 3);
    }

    // next at the end stays at the end: it does not loop and it does not pass it
    expect(currentIndex(path)).toBe(2);
    expect(path).toEqual([0, 1, 2]);
    expect(presentNext(path, 3)).toEqual(path);
  });

  it("AC-200 play from here runs the downstream steps in order", () => {
    //   A -> B -> D
    //   A -> C -> D        E stands alone
    const graph = graphOf(
      ["A", "B", "C", "D", "E"],
      [
        ["A", "B"],
        ["A", "C"],
        ["B", "D"],
        ["C", "D"],
      ],
    );
    const from = (id: string) =>
      downstreamSteps(
        graph,
        graph.steps.findIndex((s) => s.containerId === id),
      ).map((s) => s.containerId);

    expect(from("A")).toEqual(["A", "B", "C", "D"]);
    expect(from("B")).toEqual(["B", "D"]);
    expect(from("D")).toEqual(["D"]);
    expect(from("E")).toEqual(["E"]);

    // a loop is followed once: a step is never listed twice
    const loop = graphOf(
      ["X", "Y", "Z"],
      [
        ["X", "Y"],
        ["Y", "Z"],
        ["Z", "X"],
      ],
    );

    expect(downstreamSteps(loop, 1).map((s) => s.containerId)).toEqual([
      "X",
      "Y",
      "Z",
    ]);
    expect(downstreamSteps(graph, 99)).toEqual([]);
  });

  // A question has two ways on; every other step has one, or none
  const QUESTION = graphOf(
    ["Start", "Ask", "Yes", "No", "End"],
    [
      ["Start", "Ask"],
      ["Ask", "Yes"],
      ["Ask", "No"],
      ["Yes", "End"],
      ["No", "End"],
    ],
  );

  it("AC-203 only the current question's branches are clickable", () => {
    // the question offers its two branches ...
    expect(choicesAt(QUESTION, 1)).toEqual([2, 3]);

    // ... and nothing else offers anything
    for (const index of [0, 2, 3, 4]) {
      expect(choicesAt(QUESTION, index), `step ${index}`).toEqual([]);
    }

    // a step no arrow leaves is an end
    expect(isEndStep(QUESTION, 4)).toBe(true);
    expect(isEndStep(QUESTION, 0)).toBe(false);
    expect(isEndStep(QUESTION, 1)).toBe(false);
  });

  it("AC-203 the choice decides the next step", () => {
    const atQuestion = presentNext(startPath(), QUESTION.steps.length);

    expect(currentIndex(atQuestion)).toBe(1);

    // choosing "no" goes to the no branch, not to the step that follows in the order
    const no = presentChoose(atQuestion, choicesAt(QUESTION, 1)[1]);

    expect(currentIndex(no)).toBe(3);
    expect([...reachedIndices(no)]).toEqual([0, 1, 3]);

    // the branch that was not taken has not been reached
    expect(reachedIndices(no).has(2)).toBe(false);

    // and back returns to the question, where the other branch can be chosen
    const back = presentPrevious(no);

    expect(currentIndex(back)).toBe(1);
    expect(currentIndex(presentChoose(back, choicesAt(QUESTION, 1)[0]))).toBe(
      2,
    );
  });

  it("AC-203 next with no choice follows the step order", () => {
    const atQuestion = presentNext(startPath(), QUESTION.steps.length);
    const next = presentNext(atQuestion, QUESTION.steps.length);

    // nobody chose, so it is the step after the question in the order
    expect(currentIndex(next)).toBe(2);
  });

  it("AC-203 an end is drawn on and then filled", () => {
    const at = (ms: number) => drawOnProgress(ms);

    // at first all of the outline is still to be drawn, and nothing is filled
    expect(at(0)).toEqual({ remaining: 1, fill: 0 });

    // the outline is drawn on, steadily, and the fill waits for it
    expect(at(FLOW_DRAW_ON_MS / 2).remaining).toBeCloseTo(0.5, 6);
    expect(at(FLOW_DRAW_ON_MS / 2).fill).toBe(0);
    expect(at(FLOW_DRAW_ON_MS - 1).fill).toBe(0);

    // only when it is whole does the fill come in, and then it completes
    expect(at(FLOW_DRAW_ON_MS).remaining).toBe(0);
    expect(at(FLOW_DRAW_ON_MS + 300).fill).toBeGreaterThan(0);
    expect(at(FLOW_DRAW_ON_MS + 300).fill).toBeLessThan(1);
    expect(at(FLOW_DRAW_ON_MS + 5000)).toEqual({ remaining: 0, fill: 1 });

    // it never goes backwards or past its ends
    expect(at(-10)).toEqual({ remaining: 1, fill: 0 });
  });
});

/* --------------------------------------------------------------- the overlay */

const { h } = window;

type Camera = {
  zoom: { value: NormalizedZoomValue };
  scrollX: number;
  scrollY: number;
  offsetLeft: number;
  offsetTop: number;
};

const shape = (id: string, x: number, y: number) =>
  API.createElement({
    type: "rectangle",
    id,
    x,
    y,
    width: 120,
    height: 60,
  } as never);

const connect = (
  id: string,
  from: ExcalidrawElement,
  to: ExcalidrawElement,
) => {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height;
  const x2 = to.x + to.width / 2;
  const y2 = to.y;

  return API.createElement({
    type: "arrow",
    id,
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    points: [pointFrom(0, 0), pointFrom(x2 - x1, y2 - y1)],
    startBinding: { elementId: from.id, fixedPoint: [0.5, 1], mode: "orbit" },
    endBinding: { elementId: to.id, fixedPoint: [0.5, 0], mode: "orbit" },
  } as never);
};

/** a flow in the editor, selected: the way the section sees it */
const flowOnCanvas = async (kind: "line" | "question") => {
  await render(<Excalidraw handleKeyboardGlobally={true} />);

  // jsdom gives the editor no size; the camera flight needs one to fit a step into
  act(() => {
    h.setState({ width: 1200, height: 800 });
  });

  let elements: ExcalidrawElement[];

  if (kind === "line") {
    const a = shape("A", 0, 0);
    const b = shape("B", 0, 200);
    const c = shape("C", 0, 400);

    elements = [a, b, c, connect("ab", a, b), connect("bc", b, c)];
  } else {
    const start = shape("Start", 0, 0);
    const ask = shape("Ask", 0, 150);
    const yes = shape("Yes", -200, 300);
    const no = shape("No", 200, 300);
    const end = shape("End", 0, 450);

    elements = [
      start,
      ask,
      yes,
      no,
      end,
      connect("s-a", start, ask),
      connect("a-y", ask, yes),
      connect("a-n", ask, no),
      connect("y-e", yes, end),
      connect("n-e", no, end),
    ];
  }

  API.setElements(elements);
  API.setSelectedElements(elements);

  const map = h.app.scene.getNonDeletedElementsMap();

  return buildFlowGraph(getTargetElements(map, h.state), map);
};

/** the clock the animation runs on: move `performance.now()` and let the frame run */
const makeClock = () => {
  let now = 1000;

  vi.spyOn(performance, "now").mockImplementation(() => now);

  return async (elapsed: number) => {
    now += elapsed;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
};

const documentSnapshot = () => ({
  elements: JSON.stringify(h.elements),
  appState: JSON.stringify(h.state),
  undoDepth: API.getUndoStack().length,
});

/** `translate(x, y) scale(s)`, read back from a style or an attribute value */
const readSceneTransform = (transform: string) => {
  const match = transform.match(
    /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/,
  );

  if (!match) {
    throw new Error(`not a scene transform: ${transform}`);
  }

  return {
    tx: Number(match[1]),
    ty: Number(match[2]),
    scale: Number(match[3]),
  };
};

const cameraOf = (): Camera => ({
  zoom: h.state.zoom,
  scrollX: h.state.scrollX,
  scrollY: h.state.scrollY,
  offsetLeft: h.state.offsetLeft,
  offsetTop: h.state.offsetTop,
});

describe("the flow overlay (AC-199 to AC-203)", () => {
  afterEach(() => {
    act(() => {
      stopFlowAnimation();
      // the settings are the user's and outlive a flow: a test must not inherit them
      updateFlowAnimationSettings({
        camera: false,
        style: "focus",
        loop: true,
      });
    });
    AnimationController.cancel("flow-animation");
    AnimationController.cancel("flow-animation-marks");
    AnimationController.cancel("flow-animation-draw-on");
    AnimationController.cancel("flow-animation-camera");
    vi.restoreAllMocks();
  });

  it("AC-199 the pulse is on the current step", async () => {
    const graph = await flowOnCanvas("line");

    await act(async () => {
      startFlowAnimation(graph.steps, {
        mode: "present",
        graph,
        style: "pulse",
      });
    });

    const boxes = () =>
      [
        ...document.querySelectorAll(".excalidraw__flow-animation-shape"),
      ] as HTMLElement[];

    // the glow is on the step's own box
    expect(
      document.querySelectorAll(".excalidraw__flow-animation-focus--pulse"),
    ).toHaveLength(boxes().length);

    // ... which is on the pixels the canvas would use for that step: the
    // library's own conversion, and not a formula written out again here
    const expectOn = (id: string) => {
      const target = h.elements.find((el) => el.id === id)!;
      const expected = sceneCoordsToViewportCoords(
        { sceneX: target.x, sceneY: target.y },
        cameraOf(),
      );
      const { tx, ty } = readSceneTransform(boxes()[0].style.transform);

      expect(tx).toBeCloseTo(expected.x - h.state.offsetLeft, 3);
      expect(ty).toBeCloseTo(expected.y - h.state.offsetTop, 3);
    };

    expectOn("A");

    // and it moves on with the presentation
    await act(async () => {
      presentStepForward();
    });

    expectOn("B");
  });

  it("AC-199 no style writes into the document", async () => {
    const graph = await flowOnCanvas("line");
    const tick = makeClock();
    const before = documentSnapshot();

    for (const { id } of FLOW_STYLES) {
      await act(async () => {
        startFlowAnimation(graph.steps, {
          mode: "play",
          graph,
          style: id,
          durationMs: 100,
        });
      });

      await tick(0);
      await tick(60);
      await tick(60);

      // the overlay is up, whatever the style
      expect(
        document.querySelector(".excalidraw__flow-animation"),
      ).not.toBeNull();

      await act(async () => {
        stopFlowAnimation();
      });

      // and the document is exactly as it was: no element, no app state, no
      // undo step
      expect(documentSnapshot(), id).toEqual(before);
    }

    expect(isFlowAnimationActive()).toBe(false);
  });

  it("AC-199 the overlay is above the canvases it draws on", async () => {
    const graph = await flowOnCanvas("line");

    await act(async () => {
      startFlowAnimation(graph.steps, { mode: "present", graph });
    });

    // jsdom does not lay out, so the stacking is read where it is decided: the
    // host asks for the flow-animation layer, and that layer is above both
    // canvases and the animated images, and below the editor's own chrome
    const host = document.querySelector(
      ".excalidraw__flow-animation",
    ) as HTMLElement;

    expect(host.style.zIndex).toBe("var(--zIndex-flowAnimation)");

    const layers = fs.readFileSync(
      path.resolve(__dirname, "../css/styles.scss"),
      "utf8",
    );
    const layer = (name: string) =>
      Number(layers.match(new RegExp(`--zIndex-${name}: *([0-9]+)`))?.[1]);

    expect(layer("flowAnimation")).toBeGreaterThan(layer("canvas"));
    expect(layer("flowAnimation")).toBeGreaterThan(layer("interactiveCanvas"));
    expect(layer("flowAnimation")).toBeGreaterThan(layer("animatedImages"));
    expect(layer("flowAnimation")).toBeLessThan(layer("layerUI"));
  });

  it("AC-199 the marks are where the arrows are, on the canvas's own pixels", async () => {
    const graph = await flowOnCanvas("line");

    await act(async () => {
      startFlowAnimation(graph.steps, {
        mode: "play",
        graph,
        style: "token",
        durationMs: 100000,
      });
    });

    // the token travels the arrow that leaves the current step: A -> B
    const dot = document.querySelector('[data-flow-mark="token"]')!;
    const scene = document.querySelector("[data-flow-scene]")!;

    expect(dot).not.toBeNull();

    const { tx, ty, scale } = readSceneTransform(
      (scene as SVGGElement).style.transform,
    );
    const arrowAB = h.elements.find(
      (el) => el.id === "ab",
    ) as ExcalidrawLinearElement;
    const start = getArrowPath(arrowAB)[0];

    // the dot starts at the arrow's start, taken to the screen by the library
    const expected = sceneCoordsToViewportCoords(
      { sceneX: start.x, sceneY: start.y },
      cameraOf(),
    );

    expect(tx + scale * Number(dot.getAttribute("cx"))).toBeCloseTo(
      expected.x - h.state.offsetLeft,
      3,
    );
    expect(ty + scale * Number(dot.getAttribute("cy"))).toBeCloseTo(
      expected.y - h.state.offsetTop,
      3,
    );

    // beam and token draw on the arrows leaving the step; the pipe on every arrow
    expect(document.querySelectorAll("[data-flow-arrow]")).toHaveLength(1);

    await act(async () => {
      startFlowAnimation(graph.steps, {
        mode: "play",
        graph,
        style: "pipe",
        durationMs: 100000,
      });
    });

    expect(document.querySelectorAll("[data-flow-arrow]")).toHaveLength(2);
    // three strokes on each
    expect(document.querySelectorAll('[data-flow-mark^="pipe-"]')).toHaveLength(
      6,
    );

    // the focus style draws nothing on an arrow
    await act(async () => {
      startFlowAnimation(graph.steps, {
        mode: "play",
        graph,
        style: "focus",
        durationMs: 100000,
      });
    });

    expect(document.querySelectorAll("[data-flow-arrow]")).toHaveLength(0);
  });

  it("AC-200 the arrow keys are only claimed while presenting", async () => {
    const graph = await flowOnCanvas("line");

    /** an arrow key, and whether the overlay took it (it prevents the default) */
    const press = (key: "ArrowRight" | "ArrowLeft") => {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });

      window.dispatchEvent(event);

      return event.defaultPrevented;
    };

    // before anything plays, the keys are the editor's
    expect(press("ArrowRight")).toBe(false);

    // while it plays on its clock, they still are
    await act(async () => {
      startFlowAnimation(graph.steps, {
        mode: "play",
        graph,
        durationMs: 100000,
      });
    });

    expect(press("ArrowRight")).toBe(false);
    expect(editorJotaiStore.get(flowAnimationStateAtom).index).toBe(0);

    // while presenting, they are the overlay's, and they move one step
    await act(async () => {
      startFlowAnimation(graph.steps, { mode: "present", graph });
    });

    await act(async () => {
      expect(press("ArrowRight")).toBe(true);
    });
    expect(editorJotaiStore.get(flowAnimationStateAtom).index).toBe(1);

    await act(async () => {
      expect(press("ArrowLeft")).toBe(true);
    });
    expect(editorJotaiStore.get(flowAnimationStateAtom).index).toBe(0);

    // and they are the editor's again the moment it is over
    await act(async () => {
      stopFlowAnimation();
    });

    expect(press("ArrowRight")).toBe(false);
    expect(press("ArrowLeft")).toBe(false);
  });

  it("AC-200 leaving restores the canvas", async () => {
    const graph = await flowOnCanvas("line");
    const before = documentSnapshot();

    await act(async () => {
      startFlowAnimation(graph.steps, { mode: "present", graph });
    });
    await act(async () => {
      presentStepForward();
      presentStepForward();
    });

    // every step has been reached, so none is dimmed
    expect(document.querySelectorAll("[data-flow-dim]")).toHaveLength(0);

    await act(async () => {
      presentStepBack();
    });

    // one step back: the last is not reached any more, so it is dimmed
    expect(document.querySelectorAll("[data-flow-dim]")).toHaveLength(1);
    expect(document.querySelector('[data-flow-dim="C"]')).not.toBeNull();

    // leaving takes the overlay away and leaves the document as it was
    await act(async () => {
      stopFlowAnimation();
    });

    expect(document.querySelector(".excalidraw__flow-animation")).toBeNull();
    expect(document.querySelectorAll("[data-flow-dim]")).toHaveLength(0);
    expect(documentSnapshot()).toEqual(before);
  });

  it("AC-201 the arrow in the document is not changed", async () => {
    const graph = await flowOnCanvas("line");
    const tick = makeClock();
    const arrowsBefore = JSON.stringify(
      h.elements.filter((el) => el.type === "arrow"),
    );

    await act(async () => {
      startFlowAnimation(graph.steps, {
        mode: "play",
        graph,
        style: "pipe",
        durationMs: 100000,
      });
    });

    await tick(0);
    await tick(300);
    await tick(300);

    // the pipe is drawn over the arrows, and the arrows keep their own stroke
    expect(
      document.querySelectorAll('[data-flow-mark="pipe-dark"]'),
    ).toHaveLength(2);
    expect(JSON.stringify(h.elements.filter((el) => el.type === "arrow"))).toBe(
      arrowsBefore,
    );
  });

  it("AC-202 with the switch off the view does not move", async () => {
    const graph = await flowOnCanvas("line");
    const tick = makeClock();
    const view = () => [h.state.scrollX, h.state.scrollY, h.state.zoom.value];
    const before = view();

    // the camera is off unless it is asked for
    expect(editorJotaiStore.get(flowAnimationStateAtom).camera).toBe(false);

    await act(async () => {
      startFlowAnimation(graph.steps, { mode: "present", graph });
    });
    await act(async () => {
      presentStepForward();
    });

    await tick(0);
    await tick(800);
    await tick(800);

    expect(view()).toEqual(before);
  });

  it("AC-202 leaving restores the view exactly", async () => {
    const graph = await flowOnCanvas("line");
    const tick = makeClock();
    const view = () => [h.state.scrollX, h.state.scrollY, h.state.zoom.value];
    const before = view();

    await act(async () => {
      startFlowAnimation(graph.steps, {
        mode: "present",
        graph,
        camera: true,
      });
    });
    await act(async () => {
      presentStepForward();
    });

    // the flight: a baseline frame, then enough time to arrive
    await tick(0);
    await tick(800);
    await tick(800);

    // the view went to the step ...
    expect(view()).not.toEqual(before);

    // ... and leaving puts it back exactly where it was, not near it
    await act(async () => {
      stopFlowAnimation();
    });

    expect(view()).toEqual(before);
  });

  it("AC-203 the choice decides the next step, in the overlay", async () => {
    const graph = await flowOnCanvas("question");
    const index = (id: string) =>
      graph.steps.findIndex((s) => s.containerId === id);

    await act(async () => {
      startFlowAnimation(graph.steps, { mode: "present", graph });
    });

    const choices = () =>
      document.querySelectorAll(".excalidraw__flow-animation-choice");

    // at the start there is nothing to choose
    expect(choices()).toHaveLength(0);

    // at the question, its two branches - and only those - can be clicked
    await act(async () => {
      presentStepForward();
    });

    expect(editorJotaiStore.get(flowAnimationStateAtom).index).toBe(
      index("Ask"),
    );
    expect(choices()).toHaveLength(2);
    expect(
      [...choices()].map((c) => c.getAttribute("data-flow-choice")).sort(),
    ).toEqual(["No", "Yes"]);

    // clicking "No" makes No the next step
    await act(async () => {
      (
        document.querySelector('[data-flow-choice="No"]') as HTMLElement
      ).click();
    });

    expect(editorJotaiStore.get(flowAnimationStateAtom).index).toBe(
      index("No"),
    );
    expect(editorJotaiStore.get(flowAnimationStateAtom).path).toEqual([
      0,
      index("Ask"),
      index("No"),
    ]);

    // the branch that was not taken has not been reached, so it is dimmed
    expect(document.querySelector('[data-flow-dim="Yes"]')).not.toBeNull();
    expect(document.querySelector('[data-flow-dim="No"]')).toBeNull();

    // and with nothing left to choose, nothing can be clicked
    expect(choices()).toHaveLength(0);
  });

  it("AC-203 the end shape in the document is unchanged", async () => {
    const graph = await flowOnCanvas("question");
    const tick = makeClock();
    const before = documentSnapshot();

    await act(async () => {
      startFlowAnimation(graph.steps, { mode: "present", graph });
    });

    // walk to the end
    for (let i = 0; i < graph.steps.length - 1; i++) {
      await act(async () => {
        presentStepForward();
      });
    }

    expect(editorJotaiStore.get(flowAnimationStateAtom).index).toBe(
      graph.steps.length - 1,
    );

    // the end's outline is there to be drawn on, and starts undrawn
    const outline = document.querySelector('[data-flow-mark="draw-on"]')!;

    expect(outline).not.toBeNull();
    expect(outline.getAttribute("fill-opacity")).toBe("0");

    // as the clock runs, the outline is drawn on and then filled
    await tick(0);
    await tick(700);

    expect(Number(outline.getAttribute("stroke-dashoffset"))).toBeLessThan(1);

    await tick(1500);

    expect(Number(outline.getAttribute("stroke-dashoffset"))).toBe(0);
    expect(Number(outline.getAttribute("fill-opacity"))).toBeGreaterThan(0);

    // none of it is in the document
    expect(documentSnapshot()).toEqual(before);
  });
});
