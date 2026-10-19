import { describe, expect, it, vi } from "vitest";

import { ctcGreedyDecode } from "./ctc";
import { rasterizeInk } from "./raster";
import { inkFromElements, strokeFromFreedraw } from "./strokes";

import { pickRecognizer } from "./index";

import type { Ink, Recognizer, RecognizerEngine } from "./types";

const freedraw = (
  x: number,
  y: number,
  points: [number, number][],
): { type: string; x: number; y: number; points: [number, number][] } => ({
  type: "freedraw",
  x,
  y,
  points,
});

describe("strokes", () => {
  it("converts freedraw points to absolute scene coords with synthetic time", () => {
    const stroke = strokeFromFreedraw(
      freedraw(10, 20, [
        [0, 0],
        [5, 5],
      ]),
    );
    expect(stroke.points[0]).toMatchObject({ x: 10, y: 20, t: 0 });
    expect(stroke.points[1]).toMatchObject({ x: 15, y: 25 });
    expect(stroke.points[1].t).toBeGreaterThan(stroke.points[0].t);
  });

  it("computes ink bounds across multiple freedraw elements, ignoring others", () => {
    const ink = inkFromElements([
      freedraw(0, 0, [
        [0, 0],
        [10, 0],
      ]),
      freedraw(0, 30, [
        [0, 0],
        [4, 4],
      ]),
      { type: "rectangle" } as any,
    ]);
    expect(ink.strokes).toHaveLength(2);
    expect(ink.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 34 });
  });

  it("returns empty ink when no freedraw elements present", () => {
    const ink = inkFromElements([{ type: "text" } as any]);
    expect(ink.strokes).toHaveLength(0);
  });
});

describe("rasterizeInk", () => {
  it("produces a strip of the requested height with ink marks", () => {
    const ink: Ink = {
      strokes: [
        {
          points: [
            { x: 0, y: 0, t: 0 },
            { x: 20, y: 10, t: 8 },
          ],
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    };
    const r = rasterizeInk(ink, { height: 32, maxWidth: 512, padding: 4 });
    expect(r.height).toBe(32);
    expect(r.width).toBeGreaterThan(0);
    expect(r.data.some((v) => v > 0)).toBe(true);
  });
});

describe("ctcGreedyDecode", () => {
  it("collapses repeats and drops blanks", () => {
    // charset: [blank, 'a', 'b'], V=3
    const charset = ["", "a", "b"];
    // timesteps argmax: a, a, blank, b  => "ab"
    const rows = [
      [0, 5, 0], // a
      [0, 5, 0], // a (repeat -> collapsed)
      [5, 0, 0], // blank
      [0, 0, 5], // b
    ];
    const logits = Float32Array.from(rows.flat());
    const { text } = ctcGreedyDecode(logits, [4, 1, 3], charset);
    expect(text).toBe("ab");
  });
});

describe("pickRecognizer", () => {
  const mk = (engine: RecognizerEngine, available: boolean): Recognizer => ({
    engine,
    kind: "text",
    isAvailable: vi.fn().mockResolvedValue(available),
    recognize: vi.fn(),
    dispose: vi.fn(),
  });

  it("prefers API when preferred, online, and available", async () => {
    const r = await pickRecognizer(
      { primary: "htr", preferApiWhenAvailable: true },
      { htr: () => mk("htr", true), api: () => mk("api", true) },
    );
    expect(r?.engine).toBe("api");
  });

  it("falls back to HTR when API unavailable", async () => {
    const r = await pickRecognizer(
      { primary: "htr", preferApiWhenAvailable: true },
      { htr: () => mk("htr", true), api: () => mk("api", false) },
    );
    expect(r?.engine).toBe("htr");
  });

  it("uses HTR first when API not preferred", async () => {
    const r = await pickRecognizer(
      { primary: "htr", preferApiWhenAvailable: false },
      { htr: () => mk("htr", true), api: () => mk("api", true) },
    );
    expect(r?.engine).toBe("htr");
  });

  it("returns null when neither engine is available", async () => {
    const r = await pickRecognizer(
      { primary: "htr", preferApiWhenAvailable: true },
      { htr: () => mk("htr", false), api: () => mk("api", false) },
    );
    expect(r).toBeNull();
  });
});
