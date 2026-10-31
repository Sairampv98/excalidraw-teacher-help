/**
 * Exporting an animation: the camera that flies to each step (D-385), and the
 * first picture that is taken once the highlight is in (D-384). The camera is a
 * function of the moment alone, so everything here is read off numbers.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it } from "vitest";

import { flightTarget } from "../scene/flowCamera";
import { flightTransformAt, sceneRectOf } from "../scene/flowExport/camera";
import { placeChart, startOffsetMs } from "../scene/flowExport/plan";

const PICTURE = { width: 720, height: 334 };

/** three steps along a wide chart */
const steps = [
  { box: { x: 0, y: 100, width: 140, height: 80 } },
  { box: { x: 400, y: 100, width: 140, height: 80 } },
  { box: { x: 800, y: 100, width: 140, height: 80 } },
];

const chart = { x: 0, y: 100, width: 940, height: 80 };

const at = (timeMs: number, durationMs = 1200) =>
  flightTransformAt({ steps, durationMs, timeMs, picture: PICTURE });

/** where a scene point is in the picture */
const project = (
  camera: ReturnType<typeof at>,
  point: { x: number; y: number },
) => ({
  x: point.x * camera.scale + camera.offsetX,
  y: point.y * camera.scale + camera.offsetY,
});

describe("the first picture", () => {
  it("AC-447 is taken once the highlight has come in, and never past the middle of a short step", () => {
    expect(startOffsetMs(1200)).toBe(400);
    expect(startOffsetMs(3000)).toBe(400);
    // a step shorter than 800 ms: the middle of it
    expect(startOffsetMs(500)).toBe(250);
    expect(startOffsetMs(100)).toBe(50);
    expect(startOffsetMs(0)).toBe(0);
  });
});

describe("the camera that flies to each step", () => {
  it("AC-447 is the same camera for the same moment, and the same again one round later, so the file loops", () => {
    expect(at(700)).toEqual(at(700));

    const round = steps.length * 1200;

    for (const t of [0, 300, 1200, 2500, 3599]) {
      const now = at(t);
      const later = at(t + round);

      expect(later.scale).toBeCloseTo(now.scale, 9);
      expect(later.offsetX).toBeCloseTo(now.offsetX, 6);
      expect(later.offsetY).toBeCloseTo(now.offsetY, 6);
    }
  });

  it("AC-447 flies from the step before to the step that is current, and has arrived by the end of the step", () => {
    // at the start of a step it is where the step before left it
    const arrival = (index: number) => at((index + 1) * 1200 - 0.001);
    const start = (index: number) => at(index * 1200);

    expect(start(1).scale).toBeCloseTo(arrival(0).scale, 3);
    expect(start(1).offsetX).toBeCloseTo(arrival(0).offsetX, 0);
    expect(start(2).offsetX).toBeCloseTo(arrival(1).offsetX, 0);
    // the first step comes from the last
    expect(start(0).offsetX).toBeCloseTo(arrival(2).offsetX, 0);

    // in between, it is on the way: neither where it was nor where it goes
    const middle = at(1200 + 300);

    expect(middle.offsetX).not.toBeCloseTo(start(1).offsetX, 0);
    expect(middle.offsetX).not.toBeCloseTo(arrival(1).offsetX, 0);
  });

  it("AC-447 shows the step that is current whole, inside the picture, and closer than the whole chart is", () => {
    const whole = placeChart(chart, PICTURE);

    steps.forEach((step, index) => {
      const camera = at((index + 1) * 1200 - 0.001);
      const topLeft = project(camera, step.box);
      const bottomRight = project(camera, {
        x: step.box.x + step.box.width,
        y: step.box.y + step.box.height,
      });

      expect(topLeft.x).toBeGreaterThanOrEqual(-0.5);
      expect(topLeft.y).toBeGreaterThanOrEqual(-0.5);
      expect(bottomRight.x).toBeLessThanOrEqual(PICTURE.width + 0.5);
      expect(bottomRight.y).toBeLessThanOrEqual(PICTURE.height + 0.5);

      // the camera is nearer than the one that shows the whole chart
      expect(camera.scale).toBeGreaterThan(whole.scale * 2);
    });

    // the middle step is in the middle of the picture
    const middle = project(at(2 * 1200 - 0.001), { x: 470, y: 140 });

    expect(middle.x).toBeCloseTo(PICTURE.width / 2, 0);
    expect(middle.y).toBeCloseTo(PICTURE.height / 2, 0);
  });

  it("AC-457 every step arrives in the middle of the picture - the first and the last too - as it does in the view", () => {
    steps.forEach((step, index) => {
      const camera = at((index + 1) * 1200 - 0.001);
      const middle = project(camera, {
        x: step.box.x + step.box.width / 2,
        y: step.box.y + step.box.height / 2,
      });

      expect(middle.x).toBeCloseTo(PICTURE.width / 2, 3);
      expect(middle.y).toBeCloseTo(PICTURE.height / 2, 3);
    });
  });

  it("AC-457 the camera is the live camera's: the same zoom and the same view for a step as the flight gives where nothing holds it", () => {
    const viewport = PICTURE;
    const big = { x: -1e8, y: -1e8, width: 2e8, height: 2e8 };

    steps.forEach((step, index) => {
      const live = flightTarget({ box: step.box, viewport, pageRect: big });
      const file = at((index + 1) * 1200 - 0.001);

      expect(file.scale).toBeCloseTo(live.zoom, 9);
      expect(file.offsetX).toBeCloseTo(live.scrollX * live.zoom, 3);
      expect(file.offsetY).toBeCloseTo(live.scrollY * live.zoom, 3);
    });
  });

  it("AC-447 takes the shorter of a second and a half and the step, so it always arrives", () => {
    // a long step: the flight takes its second and a half, and the camera then rests
    const settled = at(3000 + 1500, 3000);
    const later = at(3000 + 2900, 3000);

    expect(later.offsetX).toBeCloseTo(settled.offsetX, 6);
    expect(at(3000 + 700, 3000).offsetX).not.toBeCloseTo(settled.offsetX, 0);

    // a short step: the flight is the step, so the next one starts from the arrival
    const short = (t: number) => at(t, 400);

    expect(short(400).offsetX).toBeCloseTo(short(400 - 0.001).offsetX, 0);
  });

  it("AC-447 a chart of one step has a camera that does not move", () => {
    const one = (t: number) =>
      flightTransformAt({
        steps: [steps[0]],
        durationMs: 1200,
        timeMs: t,
        picture: PICTURE,
      });

    expect(one(0)).toEqual(one(777));
    expect(one(0).scale).toBeGreaterThan(0);
  });

  it("AC-447 the part of the page it looks at is the picture, and the corners of the picture are the corners of that part", () => {
    const camera = at(1500);
    const rect = sceneRectOf(camera, PICTURE);
    const a = project(camera, { x: rect.x, y: rect.y });
    const b = project(camera, {
      x: rect.x + rect.width,
      y: rect.y + rect.height,
    });

    expect(a.x).toBeCloseTo(0, 6);
    expect(a.y).toBeCloseTo(0, 6);
    expect(b.x).toBeCloseTo(PICTURE.width, 6);
    expect(b.y).toBeCloseTo(PICTURE.height, 6);
  });
});
