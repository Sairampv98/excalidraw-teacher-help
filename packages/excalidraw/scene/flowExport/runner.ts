/**
 * Runs an export (D-374, D-377, D-379): one picture for each moment of the run,
 * written into the file of the format asked for, with progress, and a stop that
 * is honoured between pictures. It knows nothing of a canvas or a browser: the
 * pictures come from a `FlowFrameSource`, and the video encoder from a
 * `FlowVideoEncoder`, so a test gives it fakes and reads what it wrote.
 */

import {
  addTransparentEntry,
  buildPalette,
  createGifEncoder,
  indexPicture,
} from "./gif";
import {
  exportLengthMs,
  exportProblem,
  frameCountOf,
  frameDelaysMs,
  frameTimeMs,
  gifDelays,
} from "./plan";
import { assembleAnimatedWebp } from "./webp";

import type { FlowExportFormat } from "./plan";

/** where the pictures come from */
export type FlowFrameSource = {
  size: { width: number; height: number };
  /** the picture at `timeMs`, drawn, for the video encoder to take */
  canvasAt: (timeMs: number) => CanvasImageSource;
  /** the picture at `timeMs`, as red, green, blue, alpha for each pixel */
  rgba: (timeMs: number) => Uint8ClampedArray;
  /** the picture at `timeMs`, as the browser's own still WebP */
  webp: (timeMs: number) => Promise<Uint8Array | null>;
};

/** the video encoder: asked whether it can, and then asked to do it */
export type FlowVideoEncoder = {
  /** whether this browser can write the video, and if not, why */
  support: (
    width: number,
    height: number,
    fps: number,
  ) => Promise<{ supported: true } | { supported: false; reason: string }>;
  /** the whole file; `frameAt` draws the picture of frame `index` */
  encode: (options: {
    width: number;
    height: number;
    fps: number;
    count: number;
    /** the picture at a moment, for the encoder to take */
    frameAt: (timeMs: number) => CanvasImageSource;
    onProgress: () => void;
    isStopped: () => boolean;
  }) => Promise<Uint8Array>;
};

export type FlowExportRun = {
  format: FlowExportFormat;
  fps: number;
  /** how many steps the animation has, and how long each is held */
  stepCount: number;
  durationMs: number;
  /** whether the picture is on the page's own background, or has none */
  withBackground: boolean;
  source: FlowFrameSource;
  /** the video encoder, for MP4 */
  video: FlowVideoEncoder | null;
  /** how far on it is: pictures made out of the whole */
  onProgress: (done: number, total: number) => void;
  /** whether the person pressed stop */
  isStopped: () => boolean;
};

export class FlowExportStopped extends Error {
  constructor() {
    super("The export was stopped.");
    this.name = "FlowExportStopped";
  }
}

/** lets the page breathe: other work and the progress bar happen between pictures */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** how many pictures of the run are looked at to choose a GIF's colours */
const PALETTE_SAMPLES = 8;

export const runFlowExport = async (
  run: FlowExportRun,
): Promise<Uint8Array> => {
  const problem = exportProblem({
    stepCount: run.stepCount,
    durationMs: run.durationMs,
    fps: run.fps,
  });

  if (problem) {
    throw new Error(problem);
  }

  const lengthMs = exportLengthMs(run.stepCount, run.durationMs);
  const count = frameCountOf(lengthMs, run.fps);
  const { width, height } = run.source.size;

  const check = () => {
    if (run.isStopped()) {
      throw new FlowExportStopped();
    }
  };

  if (run.format === "gif") {
    // the colours come from a few pictures spread over the run
    const samples: Uint8ClampedArray[] = [];

    for (let i = 0; i < PALETTE_SAMPLES; i++) {
      const index = Math.floor((i * count) / PALETTE_SAMPLES);

      samples.push(run.source.rgba(frameTimeMs(index, run.fps)));
    }

    const transparent = !run.withBackground;
    const built = buildPalette(samples, transparent ? 255 : 256);
    const { palette, transparentIndex } = transparent
      ? addTransparentEntry(built)
      : { palette: built, transparentIndex: null };

    const encoder = createGifEncoder({
      width,
      height,
      palette,
      transparentIndex,
    });
    const delays = gifDelays(count, run.fps);

    for (let i = 0; i < count; i++) {
      check();

      const rgba = run.source.rgba(frameTimeMs(i, run.fps));

      encoder.addFrame(
        indexPicture(rgba, palette, transparentIndex),
        delays[i],
      );
      run.onProgress(i + 1, count);

      if (i % 3 === 2) {
        await breathe();
      }
    }

    return encoder.finish();
  }

  if (run.format === "webp") {
    const delays = frameDelaysMs(count, run.fps);
    const frames: { bytes: Uint8Array; durationMs: number }[] = [];

    for (let i = 0; i < count; i++) {
      check();

      const bytes = await run.source.webp(frameTimeMs(i, run.fps));

      if (!bytes) {
        throw new Error("This browser cannot write WebP pictures.");
      }

      frames.push({ bytes, durationMs: delays[i] });
      run.onProgress(i + 1, count);

      if (i % 3 === 2) {
        await breathe();
      }
    }

    return assembleAnimatedWebp(frames, { width, height });
  }

  if (!run.video) {
    throw new Error("This browser cannot write MP4 video.");
  }

  const support = await run.video.support(width, height, run.fps);

  if (!support.supported) {
    throw new Error(support.reason);
  }

  let done = 0;

  return run.video.encode({
    width,
    height,
    fps: run.fps,
    count,
    frameAt: (timeMs) => run.source.canvasAt(timeMs),
    onProgress: () => {
      done += 1;
      run.onProgress(done, count);
    },
    isStopped: run.isStopped,
  });
};
