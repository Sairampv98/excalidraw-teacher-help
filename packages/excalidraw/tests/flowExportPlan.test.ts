/**
 * Exporting an animation: what a run is made of (D-374 to D-376, D-379).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it } from "vitest";

import {
  FLOW_EXPORT_DEFAULT_FPS,
  FLOW_EXPORT_FPS,
  FLOW_EXPORT_MAX_FRAMES,
  FLOW_EXPORT_MAX_MS,
  backgroundChoicesOf,
  clampFps,
  exportLengthMs,
  exportProblem,
  exportSizeOf,
  fpsChoicesOf,
  frameCountOf,
  frameDelaysMs,
  frameTimeMs,
  gifDelays,
  placeChart,
  stepAt,
} from "../scene/flowExport/plan";

describe("the timeline of an exported animation", () => {
  it("AC-437 a run is every step held for its time, never more than a minute", () => {
    expect(exportLengthMs(4, 1200)).toBe(4800);
    expect(exportLengthMs(0, 1200)).toBe(0);
    expect(exportLengthMs(5, 0)).toBe(0);
    expect(exportLengthMs(100, 1200)).toBe(FLOW_EXPORT_MAX_MS);
  });

  it("AC-437 the pictures are as many as the rate asks, and each shows its own moment", () => {
    expect(frameCountOf(4800, 15)).toBe(72);
    expect(frameCountOf(4800, 30)).toBe(144);
    // a run is never empty
    expect(frameCountOf(10, 5)).toBe(1);

    expect(frameTimeMs(0, 15)).toBe(0);
    expect(frameTimeMs(15, 15)).toBe(1000);
    expect(frameTimeMs(3, 24)).toBeCloseTo(125, 6);
  });

  it("AC-437 the step at a moment, and how long it has been current, follow the animation's own clock", () => {
    // four steps of 1200 ms each
    expect(stepAt(0, 4, 1200)).toEqual({ stepIndex: 0, sinceStepMs: 0 });
    expect(stepAt(1199, 4, 1200)).toEqual({ stepIndex: 0, sinceStepMs: 1199 });
    expect(stepAt(1200, 4, 1200)).toEqual({ stepIndex: 1, sinceStepMs: 0 });
    expect(stepAt(3700, 4, 1200)).toEqual({ stepIndex: 3, sinceStepMs: 100 });

    // the steps loop, as the animation does
    expect(stepAt(4800, 4, 1200)).toEqual({ stepIndex: 0, sinceStepMs: 0 });
    expect(stepAt(5000, 4, 1200)).toEqual({ stepIndex: 0, sinceStepMs: 200 });

    // the same moment is always the same picture
    expect(stepAt(2345, 4, 1200)).toEqual(stepAt(2345, 4, 1200));
  });

  it("AC-437 the delays of a GIF add up to the run's length, with none under two hundredths", () => {
    for (const fps of [5, 10, 15, 24, 30]) {
      const count = frameCountOf(4800, fps);
      const delays = gifDelays(count, fps);

      expect(delays).toHaveLength(count);
      expect(delays.every((delay) => delay >= 2)).toBe(true);
      expect(delays.reduce((a, b) => a + b, 0)).toBe(
        Math.round((count * 100) / fps),
      );
    }

    // a rate faster than a GIF can show is held at the least it can: two hundredths
    expect(gifDelays(4, 100)).toEqual([2, 2, 2, 2]);

    // 15 a second is 6.67 hundredths: the delays alternate and the total is exact
    expect(gifDelays(3, 15)).toEqual([7, 6, 7]);

    // the same for milliseconds
    const ms = frameDelaysMs(72, 24);

    expect(ms.reduce((a, b) => a + b, 0)).toBe(3000);
    expect(ms.every((delay) => delay >= 1)).toBe(true);
  });
});

describe("the picture of an exported animation", () => {
  it("AC-437 the size has the longest side asked for, the shape asked for, and even sides", () => {
    const chart = { width: 800, height: 400 };

    expect(exportSizeOf(chart, "chart", 720)).toEqual({
      width: 720,
      height: 360,
    });
    expect(exportSizeOf(chart, "landscape", 1080)).toEqual({
      width: 1080,
      height: 608,
    });
    expect(exportSizeOf(chart, "square", 480)).toEqual({
      width: 480,
      height: 480,
    });
    expect(exportSizeOf(chart, "portrait", 1920)).toEqual({
      width: 1080,
      height: 1920,
    });

    // a tall chart keeps its own shape, longest side the height
    expect(exportSizeOf({ width: 300, height: 900 }, "chart", 480)).toEqual({
      width: 160,
      height: 480,
    });

    // every side is even, whatever the chart
    for (const [w, h] of [
      [333, 777],
      [1, 1],
      [901, 13],
    ]) {
      const size = exportSizeOf({ width: w, height: h }, "chart", 721);

      expect(size.width % 2).toBe(0);
      expect(size.height % 2).toBe(0);
    }
  });

  it("AC-437 the chart is placed whole, centred, with a margin", () => {
    const chart = { x: 100, y: 50, width: 400, height: 200 };
    const size = { width: 800, height: 600 };
    const place = placeChart(chart, size);

    // the chart's corners land inside the picture, with the margin to spare
    const left = chart.x * place.scale + place.offsetX;
    const right = (chart.x + chart.width) * place.scale + place.offsetX;
    const top = chart.y * place.scale + place.offsetY;
    const bottom = (chart.y + chart.height) * place.scale + place.offsetY;

    expect(left).toBeGreaterThanOrEqual(size.width * 0.04 - 1e-6);
    expect(right).toBeLessThanOrEqual(size.width * 0.96 + 1e-6);
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeLessThan(size.height);

    // and centred
    expect(left + right).toBeCloseTo(size.width, 6);
    expect(top + bottom).toBeCloseTo(size.height, 6);
  });
});

describe("the options of an export", () => {
  it("AC-441 the frame rates offered are the selector's, and a GIF has no 60", () => {
    expect(FLOW_EXPORT_FPS).toEqual([5, 10, 15, 24, 30, 60]);
    expect(fpsChoicesOf("gif")).toEqual([5, 10, 15, 24, 30]);
    expect(fpsChoicesOf("webp")).toEqual([5, 10, 15, 24, 30, 60]);
    expect(fpsChoicesOf("mp4")).toEqual([5, 10, 15, 24, 30, 60]);

    expect(FLOW_EXPORT_DEFAULT_FPS).toEqual({ gif: 15, webp: 15, mp4: 30 });

    // a rate a format does not offer becomes the nearest it does
    expect(clampFps("gif", 60)).toBe(30);
    expect(clampFps("mp4", 60)).toBe(60);
    expect(clampFps("webp", 12)).toBe(10);
    expect(clampFps("webp", Number.NaN)).toBe(15);
  });

  it("AC-441 only MP4 is without a transparent background, and says why", () => {
    expect(backgroundChoicesOf("gif").transparent).toBe(true);
    expect(backgroundChoicesOf("webp").transparent).toBe(true);
    expect(backgroundChoicesOf("mp4")).toEqual({
      transparent: false,
      reason: "MP4 cannot be transparent",
    });
  });

  it("AC-441 an export that cannot run says why, and one that can says nothing", () => {
    expect(exportProblem({ stepCount: 0, durationMs: 1200, fps: 15 })).toMatch(
      /nothing to animate/,
    );
    expect(exportProblem({ stepCount: 3, durationMs: 0, fps: 15 })).toMatch(
      /no length/,
    );

    // a minute at 60 a second is 3600 pictures: too many
    const tooMany = exportProblem({
      stepCount: 50,
      durationMs: 1200,
      fps: 60,
    });

    expect(tooMany).toContain(String(3600));
    expect(tooMany).toContain(String(FLOW_EXPORT_MAX_FRAMES));

    expect(exportProblem({ stepCount: 4, durationMs: 1200, fps: 30 })).toBe(
      null,
    );

    // a minute at thirty a second is exactly the most, and is allowed
    expect(
      exportProblem({ stepCount: 50, durationMs: 1200, fps: 30 }),
    ).toBeNull();
  });
});
