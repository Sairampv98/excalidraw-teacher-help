/**
 * Exporting an animation as a GIF (D-377): the file the encoder writes is read
 * back by a small decoder of the GIF format, written here as the oracle, and
 * must give the same pictures, the same delays and the same loop.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it } from "vitest";

import {
  addTransparentEntry,
  buildPalette,
  createGifEncoder,
  indexPicture,
} from "../scene/flowExport/gif";

import { decodeGif } from "./helpers/gifDecode";

/** a repeatable run of numbers, so a test never depends on chance */
const sequence = (seed: number) => {
  let state = seed;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;

    return state / 0x100000000;
  };
};

/* --------------------------------------------------------------- the tests */

describe("the GIF encoder", () => {
  it("AC-438 what is written is what is read back: every picture, every delay, the loop for ever", () => {
    const random = sequence(7);
    const width = 40;
    const height = 30;
    const palette = new Uint8Array(200 * 3);

    for (let i = 0; i < palette.length; i++) {
      palette[i] = Math.floor(random() * 256);
    }

    const encoder = createGifEncoder({
      width,
      height,
      palette,
      transparentIndex: null,
    });

    const pictures: Uint8Array[] = [];

    for (let frame = 0; frame < 4; frame++) {
      const pixels = new Uint8Array(width * height);

      for (let i = 0; i < pixels.length; i++) {
        pixels[i] = Math.floor(random() * 200);
      }

      pictures.push(pixels);
      encoder.addFrame(pixels, [7, 6, 7, 2][frame]);
    }

    const decoded = decodeGif(encoder.finish());

    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(decoded.loops).toBe(0);
    expect(decoded.frames.map((frame) => frame.delayCs)).toEqual([7, 6, 7, 2]);
    expect(decoded.frames).toHaveLength(4);

    decoded.frames.forEach((frame, i) => {
      expect([...frame.pixels]).toEqual([...pictures[i]]);
      expect(frame.transparentIndex).toBeNull();
    });

    // the colours are the palette's, in the same order
    expect([...decoded.palette.slice(0, palette.length)]).toEqual([...palette]);
  });

  it("AC-438 a picture that fills the code table is still read back whole", () => {
    // noise over 256 colours makes more than 4096 codes, so the table is reset
    const random = sequence(99);
    const width = 120;
    const height = 120;
    const palette = new Uint8Array(256 * 3);

    for (let i = 0; i < palette.length; i++) {
      palette[i] = i % 251;
    }

    const encoder = createGifEncoder({
      width,
      height,
      palette,
      transparentIndex: null,
    });
    const pixels = new Uint8Array(width * height);

    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = Math.floor(random() * 256);
    }

    encoder.addFrame(pixels, 5);

    const decoded = decodeGif(encoder.finish());

    expect([...decoded.frames[0].pixels]).toEqual([...pixels]);
  });

  it("AC-438 a transparent GIF marks its index and clears each frame before the next", () => {
    const base = new Uint8Array([10, 20, 30, 200, 100, 50]);
    const { palette, transparentIndex } = addTransparentEntry(base);

    expect(transparentIndex).toBe(2);
    expect(palette.length).toBe(9);

    const encoder = createGifEncoder({
      width: 2,
      height: 2,
      palette,
      transparentIndex,
    });

    encoder.addFrame(new Uint8Array([0, 2, 2, 1]), 6);

    const decoded = decodeGif(encoder.finish());

    expect(decoded.frames[0].transparentIndex).toBe(2);
    // disposal 2: the area is cleared to the background before the next frame
    expect(decoded.frames[0].disposal).toBe(2);
    expect([...decoded.frames[0].pixels]).toEqual([0, 2, 2, 1]);
  });

  it("AC-438 a frame of the wrong size is refused and not written crooked", () => {
    const encoder = createGifEncoder({
      width: 4,
      height: 4,
      palette: new Uint8Array([0, 0, 0, 255, 255, 255]),
      transparentIndex: null,
    });

    expect(() => encoder.addFrame(new Uint8Array(15), 5)).toThrow(/15 pixels/);
  });
});

describe("the GIF's palette", () => {
  const rgba = (colors: number[][]) =>
    Uint8ClampedArray.from(
      colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]),
    );

  it("AC-438 a chart of few colours keeps exactly those colours", () => {
    const picture = rgba([
      [255, 255, 255],
      [255, 255, 255],
      [105, 101, 219],
      [30, 30, 30],
      [105, 101, 219],
    ]);
    const palette = buildPalette([picture], 255);
    const colors = new Set<string>();

    for (let i = 0; i < palette.length; i += 3) {
      colors.add(`${palette[i]},${palette[i + 1]},${palette[i + 2]}`);
    }

    expect(colors).toEqual(new Set(["255,255,255", "105,101,219", "30,30,30"]));
  });

  it("AC-438 many colours are cut down to the most that is asked for, and transparent pixels have none", () => {
    const random = sequence(3);
    const many: number[][] = [];

    for (let i = 0; i < 3000; i++) {
      many.push([
        Math.floor(random() * 256),
        Math.floor(random() * 256),
        Math.floor(random() * 256),
      ]);
    }

    const palette = buildPalette([rgba(many)], 64);

    expect(palette.length / 3).toBeLessThanOrEqual(64);
    expect(palette.length / 3).toBeGreaterThan(32);

    // a picture with nothing opaque still gives a valid palette
    expect(buildPalette([rgba([[9, 9, 9, 0]])], 255).length).toBe(3);

    // transparent pixels add no colour
    const mixed = buildPalette(
      [
        rgba([
          [200, 0, 0],
          [1, 2, 3, 0],
          [1, 2, 3, 10],
        ]),
      ],
      255,
    );

    expect(mixed.length / 3).toBe(1);
  });

  it("AC-438 a picture is written as the nearest colours, and a mostly transparent pixel as the transparent index", () => {
    const { palette, transparentIndex } = addTransparentEntry(
      new Uint8Array([255, 255, 255, 0, 0, 0]),
    );
    const picture = rgba([
      [250, 250, 250],
      [10, 5, 5],
      [123, 123, 123, 0],
      [127, 127, 127, 127],
    ]);

    expect([...indexPicture(picture, palette, transparentIndex)]).toEqual([
      0,
      1,
      transparentIndex,
      transparentIndex,
    ]);
  });
});
