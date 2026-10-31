/**
 * Exporting an animation: running an export (D-374, D-377 to D-379). The runner
 * is given a fake source of pictures and a fake video encoder, and the file it
 * writes is read back.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it, vi } from "vitest";

import { startOffsetMs } from "../scene/flowExport/plan";
import { FlowExportStopped, runFlowExport } from "../scene/flowExport/runner";

import { decodeGif } from "./helpers/gifDecode";

import type {
  FlowFrameSource,
  FlowVideoEncoder,
} from "../scene/flowExport/runner";

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const le32 = (n: number) => [
  n & 255,
  (n >> 8) & 255,
  (n >> 16) & 255,
  (n >>> 24) & 255,
];

/** a lossless still WebP, as the browser would write one */
const stillWebp = (fill: number) => {
  const body = [0x2f, ...le32(7 | (3 << 14)), fill, fill, fill];
  const chunk = [...ascii("VP8L"), ...le32(body.length), ...body, 0];
  const inner = [...ascii("WEBP"), ...chunk];

  return Uint8Array.from([...ascii("RIFF"), ...le32(inner.length), ...inner]);
};

const WIDTH = 8;
const HEIGHT = 4;

/** the first picture is taken this far into the run, once the highlight is in (D-384) */
const START = startOffsetMs(500);

/** a source whose picture is a colour that depends on the moment */
const makeSource = (options: { alpha?: number; webp?: boolean } = {}) => {
  const times: number[] = [];
  const log: string[] = [];
  const source: FlowFrameSource = {
    size: { width: WIDTH, height: HEIGHT },
    prepare: async (timeMs) => {
      log.push(`prepare ${timeMs}`);
    },
    canvasAt: vi.fn((timeMs: number) => {
      log.push(`read ${timeMs}`);

      return {} as CanvasImageSource;
    }),
    rgba: (timeMs) => {
      times.push(timeMs);
      log.push(`read ${timeMs}`);

      const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
      const level = Math.floor(timeMs / 50) % 200;

      for (let i = 0; i < WIDTH * HEIGHT; i++) {
        pixels.set([level, 40, 90, options.alpha ?? 255], i * 4);
      }

      return pixels;
    },
    webp: async (timeMs) =>
      options.webp === false ? null : stillWebp(timeMs % 250),
  };

  return { source, times, log };
};

const base = {
  stepCount: 2,
  durationMs: 500,
  withBackground: true,
  video: null,
  isStopped: () => false,
};

describe("running an export", () => {
  it("AC-441 a GIF has a picture for each moment, each for its time, and tells how far it is", async () => {
    const { source } = makeSource();
    const progress: [number, number][] = [];

    const bytes = await runFlowExport({
      ...base,
      format: "gif",
      fps: 10,
      source,
      onProgress: (done, total) => progress.push([done, total]),
    });

    const gif = decodeGif(bytes);

    // two steps of half a second at ten a second: ten pictures, a second long
    expect(gif.frames).toHaveLength(10);
    expect(
      gif.frames.map((frame) => frame.delayCs).reduce((a, b) => a + b, 0),
    ).toBe(100);
    expect(gif.loops).toBe(0);
    expect(gif.frames.every((frame) => frame.transparentIndex === null)).toBe(
      true,
    );

    expect(progress).toHaveLength(10);
    expect(progress[0]).toEqual([1, 10]);
    expect(progress[9]).toEqual([10, 10]);
  });

  it("AC-441 the pictures are of the moments of the run: the colours are looked at over it, and every frame is its own moment", async () => {
    const { source, times } = makeSource();

    await runFlowExport({
      ...base,
      format: "gif",
      fps: 10,
      source,
      onProgress: () => undefined,
    });

    // eight pictures to choose the colours, then the ten of the run
    expect(times).toHaveLength(18);
    // the colours are chosen from pictures spread over the whole run
    expect(times.slice(0, 8)).toEqual(
      [0, 100, 200, 300, 500, 600, 700, 800].map((time) => time + START),
    );
    expect(times.slice(8)).toEqual(
      [0, 100, 200, 300, 400, 500, 600, 700, 800, 900].map(
        (time) => time + START,
      ),
    );
    // one whole round, taken from the start offset on
    expect(times.every((time) => time >= START && time < 1000 + START)).toBe(
      true,
    );
  });

  it("AC-441 a chart of many steps has its colours looked at in every step, two pictures each", async () => {
    const { source, times } = makeSource();

    await runFlowExport({
      ...base,
      stepCount: 6,
      format: "gif",
      fps: 10,
      source,
      onProgress: () => undefined,
    });

    // six steps of half a second: thirty pictures, and twelve to choose the colours
    expect(times).toHaveLength(12 + 30);
    expect(times.slice(0, 12)).toEqual(
      [0, 200, 500, 700, 1000, 1200, 1500, 1700, 2000, 2200, 2500, 2700].map(
        (time) => time + START,
      ),
    );
  });

  it("AC-447 the first picture is taken once the highlight has come in, and the file is still one whole round", async () => {
    // a step of 1.2 s: 0.4 s in, where the highlight is fully there
    expect(startOffsetMs(1200)).toBe(400);

    const { source, times } = makeSource();

    await runFlowExport({
      ...base,
      stepCount: 4,
      durationMs: 1200,
      format: "gif",
      fps: 10,
      source,
      onProgress: () => undefined,
    });

    // four steps of 1.2 s at ten a second: 48 pictures, the first at 0.4 s
    const run = times.slice(times.length - 48);

    expect(run[0]).toBe(400);
    expect(run[47]).toBeCloseTo(400 + 4700, 6);
    // a round is the same wherever it starts: the file ends where it began
    expect(run[47] + 100 - run[0]).toBe(4800);
  });

  it("AC-447 each moment is got ready before it is read, for every format", async () => {
    // a GIF: the colours first, then the run
    const gif = makeSource();

    await runFlowExport({
      ...base,
      format: "gif",
      fps: 10,
      source: gif.source,
      onProgress: () => undefined,
    });

    for (let i = 0; i < gif.log.length; i += 2) {
      const time = gif.log[i].split(" ")[1];

      expect(gif.log[i]).toBe(`prepare ${time}`);
      expect(gif.log[i + 1]).toBe(`read ${time}`);
    }

    // a WebP
    const webp = makeSource();

    await runFlowExport({
      ...base,
      format: "webp",
      fps: 10,
      source: webp.source,
      onProgress: () => undefined,
    });

    expect(
      webp.log.filter((entry) => entry.startsWith("prepare")),
    ).toHaveLength(10);
    expect(webp.log[0]).toBe(`prepare ${START}`);

    // an MP4: the encoder is given the way to get ready, and the start is added
    const mp4 = makeSource();
    const order: string[] = [];

    await runFlowExport({
      ...base,
      format: "mp4",
      fps: 10,
      source: mp4.source,
      video: {
        support: async () => ({ supported: true }),
        encode: async (options) => {
          for (let i = 0; i < options.count; i++) {
            const time = (i * 1000) / options.fps;

            await options.prepare(time);
            order.push(`prepare ${time + START}`);
            options.frameAt(time);
            order.push(`read ${time + START}`);
          }

          return Uint8Array.from([9]);
        },
      },
      onProgress: () => undefined,
    });

    expect(mp4.log.slice(0, 4)).toEqual([
      `prepare ${START}`,
      `read ${START}`,
      `prepare ${START + 100}`,
      `read ${START + 100}`,
    ]);
    expect(order.slice(0, 2)).toEqual([`prepare ${START}`, `read ${START}`]);
  });

  it("AC-449 a file that grows past the most it may is stopped, in every format, and says so", async () => {
    // a GIF: its palette alone is more than this
    await expect(
      runFlowExport({
        ...base,
        format: "gif",
        fps: 10,
        maxBytes: 60,
        source: makeSource().source,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(/grown past/);

    // a WebP: the first picture is more than this
    await expect(
      runFlowExport({
        ...base,
        format: "webp",
        fps: 10,
        maxBytes: 10,
        source: makeSource().source,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(/grown past/);

    // an MP4: the encoder tells what it has made, and the second report is too much
    const reports: number[] = [];

    await expect(
      runFlowExport({
        ...base,
        format: "mp4",
        fps: 10,
        maxBytes: 150,
        source: makeSource().source,
        video: {
          support: async () => ({ supported: true }),
          encode: async (options) => {
            for (let i = 0; i < 5; i++) {
              reports.push(i);
              options.addBytes(100);
            }

            return Uint8Array.from([1]);
          },
        },
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(/grown past/);

    // it stopped at the second report
    expect(reports).toEqual([0, 1]);

    // a file within the limit is made as before
    const bytes = await runFlowExport({
      ...base,
      format: "webp",
      fps: 10,
      maxBytes: 10_000_000,
      source: makeSource().source,
      onProgress: () => undefined,
    });

    expect(bytes.length).toBeGreaterThan(0);
  });

  it("AC-441 without a background the GIF has a transparent index and the pictures use it", async () => {
    const { source } = makeSource({ alpha: 0 });

    const gif = decodeGif(
      await runFlowExport({
        ...base,
        format: "gif",
        fps: 10,
        withBackground: false,
        source,
        onProgress: () => undefined,
      }),
    );

    const index = gif.frames[0].transparentIndex;

    expect(index).not.toBeNull();
    expect(gif.frames.every((frame) => frame.transparentIndex === index)).toBe(
      true,
    );
    expect([...gif.frames[0].pixels].every((pixel) => pixel === index)).toBe(
      true,
    );
  });

  it("AC-441 a WebP is the browser's pictures in one animation, and refused when the browser cannot write them", async () => {
    const { source } = makeSource();
    const bytes = await runFlowExport({
      ...base,
      format: "webp",
      fps: 10,
      source,
      onProgress: () => undefined,
    });

    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WEBP");
    expect(String.fromCharCode(...bytes.slice(12, 16))).toBe("VP8X");

    // ten frames, each an ANMF chunk
    const text = String.fromCharCode(...bytes);

    expect(text.split("ANMF").length - 1).toBe(10);

    await expect(
      runFlowExport({
        ...base,
        format: "webp",
        fps: 10,
        source: makeSource({ webp: false }).source,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(/cannot write WebP/);
  });

  it("AC-441 an MP4 is made by the video encoder when the browser has one, and says why when it has not", async () => {
    const { source } = makeSource();
    const encode = vi.fn(
      async (options: Parameters<FlowVideoEncoder["encode"]>[0]) => {
        for (let i = 0; i < options.count; i++) {
          options.frameAt((i * 1000) / options.fps);
          options.onProgress();
        }

        return Uint8Array.from([1, 2, 3]);
      },
    );
    const video: FlowVideoEncoder = {
      support: async () => ({ supported: true }),
      encode,
    };
    const progress: [number, number][] = [];

    const bytes = await runFlowExport({
      ...base,
      format: "mp4",
      fps: 30,
      source,
      video,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect([...bytes]).toEqual([1, 2, 3]);
    expect(encode.mock.calls[0][0]).toMatchObject({
      width: WIDTH,
      height: HEIGHT,
      fps: 30,
      count: 30,
    });
    expect(source.canvasAt).toHaveBeenCalledTimes(30);
    expect(progress[29]).toEqual([30, 30]);

    // no encoder at all
    await expect(
      runFlowExport({
        ...base,
        format: "mp4",
        fps: 30,
        source,
        video: null,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(/cannot write MP4/);

    // an encoder that cannot do this size and rate says so, and writes nothing
    const refusing = vi.fn();

    await expect(
      runFlowExport({
        ...base,
        format: "mp4",
        fps: 30,
        source,
        video: {
          support: async () => ({
            supported: false,
            reason: "no H.264 at this size",
          }),
          encode: refusing,
        },
        onProgress: () => undefined,
      }),
    ).rejects.toThrow("no H.264 at this size");
    expect(refusing).not.toHaveBeenCalled();
  });

  it("AC-441 a stop is honoured between pictures and writes no file", async () => {
    const { source, times } = makeSource();
    let made = 0;

    await expect(
      runFlowExport({
        ...base,
        format: "gif",
        fps: 10,
        source,
        onProgress: () => {
          made += 1;
        },
        // pressed once three pictures are in
        isStopped: () => made >= 3,
      }),
    ).rejects.toBeInstanceOf(FlowExportStopped);

    // the eight to choose the colours and the three of the run, and no more
    expect(times.length).toBe(8 + 3);
    expect(made).toBe(3);
  });

  it("AC-441 an export that cannot run says why before it draws anything", async () => {
    const { source, times } = makeSource();

    await expect(
      runFlowExport({
        ...base,
        stepCount: 0,
        format: "gif",
        fps: 10,
        source,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(/nothing to animate/);

    await expect(
      runFlowExport({
        ...base,
        stepCount: 50,
        durationMs: 1200,
        format: "mp4",
        fps: 60,
        source,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(/3600 pictures/);

    expect(times).toHaveLength(0);
  });
});
