/**
 * What an export needs from the browser (D-377, D-378): a canvas to draw the
 * pictures on, the browser's own WebP writer, and its video encoder. Each is
 * asked whether it can before anything is offered, and none of them reaches for
 * the network or for a library.
 */

import { avcCodecFor, muxMp4 } from "./mp4";
import { FlowExportStopped } from "./runner";
import { drawFlowFrame } from "./compose";

import type { Mp4Sample } from "./mp4";
import type { FlowFrameScene, FlowFrameTransform } from "./compose";
import type { FlowFrameSource, FlowVideoEncoder } from "./runner";

/** whether this browser writes WebP pictures from a canvas */
export const webpSupport = (): Promise<boolean> =>
  new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");

      canvas.width = 2;
      canvas.height = 2;
      canvas.toBlob(
        (blob) => resolve(!!blob && blob.type === "image/webp"),
        "image/webp",
        0.9,
      );
    } catch {
      resolve(false);
    }
  });

/** a bitrate that keeps a flat chart sharp: bits for each pixel of each frame */
export const bitrateFor = (width: number, height: number, fps: number) =>
  Math.min(
    20_000_000,
    Math.max(500_000, Math.round(width * height * fps * 0.08)),
  );

const videoConfigFor = (width: number, height: number, fps: number) => ({
  codec: avcCodecFor(width, height, fps),
  width,
  height,
  bitrate: bitrateFor(width, height, fps),
  framerate: fps,
  latencyMode: "quality" as const,
  // length-prefixed units and a decoder record, which is what the file holds
  avc: { format: "avc" as const },
});

const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** the browser's H.264 encoder, or `null` where there is none at all */
export const createVideoEncoder = (): FlowVideoEncoder | null => {
  if (
    typeof VideoEncoder === "undefined" ||
    typeof VideoFrame === "undefined"
  ) {
    return null;
  }

  return {
    support: async (width, height, fps) => {
      try {
        const result = await VideoEncoder.isConfigSupported(
          videoConfigFor(width, height, fps),
        );

        return result.supported
          ? { supported: true as const }
          : {
              supported: false as const,
              reason: `This browser cannot write H.264 video at ${width}x${height}, ${fps} a second.`,
            };
      } catch {
        return {
          supported: false as const,
          reason: "This browser cannot write H.264 video.",
        };
      }
    },

    encode: async ({
      width,
      height,
      fps,
      count,
      addBytes,
      prepare,
      frameAt,
      onProgress,
      isStopped,
    }) => {
      const samples: Mp4Sample[] = [];
      let description: Uint8Array | null = null;
      let failure: Error | null = null;

      const encoder = new VideoEncoder({
        output: (chunk, meta) => {
          const record = meta?.decoderConfig?.description;

          if (record && !description) {
            // a copy: the encoder may reuse what it gave
            description = ArrayBuffer.isView(record)
              ? new Uint8Array(
                  record.buffer,
                  record.byteOffset,
                  record.byteLength,
                ).slice()
              : new Uint8Array(record).slice();
          }

          const data = new Uint8Array(chunk.byteLength);

          chunk.copyTo(data);
          samples.push({ data, duration: 0, key: chunk.type === "key" });

          // a file that grows past the most it may is stopped (D-387)
          try {
            addBytes(data.length);
          } catch (error) {
            failure = error as Error;
          }
        },
        error: (error) => {
          failure = error;
        },
      });

      encoder.configure(videoConfigFor(width, height, fps));

      for (let i = 0; i < count; i++) {
        if (isStopped()) {
          encoder.close();
          throw new FlowExportStopped();
        }

        if (failure) {
          throw failure;
        }

        // a camera that flies has the page drawn as it sees it from there
        await prepare((i * 1000) / fps);

        const frame = new VideoFrame(frameAt((i * 1000) / fps), {
          timestamp: Math.round((i * 1_000_000) / fps),
          duration: Math.round(1_000_000 / fps),
        });

        // a key picture twice a second, so the file can be played from the middle
        encoder.encode(frame, { keyFrame: i % Math.max(1, fps * 2) === 0 });
        frame.close();
        onProgress();

        // the encoder works behind: wait while it has too many to hold
        while (encoder.encodeQueueSize > 6) {
          await sleep();
        }

        if (i % 3 === 2) {
          await sleep();
        }
      }

      await encoder.flush();
      encoder.close();

      if (failure) {
        throw failure;
      }

      if (!description) {
        throw new Error("The video encoder gave no decoder configuration.");
      }

      // the times of the pictures, in ticks, add up to the run's length exactly
      const timescale = 90_000;

      samples.forEach((sample, i) => {
        sample.duration =
          Math.round(((i + 1) * timescale) / fps) -
          Math.round((i * timescale) / fps);
      });

      if (samples.length !== count) {
        // the encoder dropped or added a picture: say so rather than write a
        // video of the wrong length
        throw new Error(
          `The video encoder wrote ${samples.length} pictures of the ${count} it was given.`,
        );
      }

      return muxMp4({ width, height, timescale, samples, avcC: description });
    },
  };
};

/**
 * The pictures of an animation drawn on one canvas: `base` is the chart's own
 * picture (or none, for a transparent background), and each moment is the
 * marks and the highlight drawn over it.
 *
 * With a `view` the chart is drawn again as a moment needs it: where the camera
 * is (D-385, `transformAt`) and which frame each moving picture shows (D-391,
 * `stateAt`, a word that changes when one of them goes on). A moment whose
 * camera and pictures are what the last one had is not drawn again.
 */
export const createFrameSource = (options: {
  base: CanvasImageSource | null;
  /** the chart without the labels that are lit (see `drawFlowFrame`) */
  bare?: CanvasImageSource | null;
  scene: FlowFrameScene;
  transform: FlowFrameTransform;
  size: { width: number; height: number };
  view?: {
    transformAt?: (timeMs: number) => FlowFrameTransform;
    stateAt?: (timeMs: number) => string;
    renderBase: (
      transform: FlowFrameTransform,
      timeMs: number,
    ) => Promise<CanvasImageSource | null>;
    renderBare?: (
      transform: FlowFrameTransform,
      timeMs: number,
    ) => Promise<CanvasImageSource | null>;
  };
}): FlowFrameSource => {
  const { scene, size, view } = options;
  let base = options.base;
  let bare = options.bare ?? null;
  let transform = options.transform;
  let drawnFor: string | null = null;
  const canvas = document.createElement("canvas");

  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    throw new Error("This browser cannot draw the pictures.");
  }

  const draw = (timeMs: number) => {
    drawFlowFrame(ctx, scene, timeMs, transform, base, size, bare);

    return canvas;
  };

  return {
    size,
    prepare: view
      ? async (timeMs) => {
          const next = view.transformAt?.(timeMs) ?? transform;
          const key = `${next.scale}/${next.offsetX}/${next.offsetY}|${
            view.stateAt?.(timeMs) ?? ""
          }`;

          transform = next;

          if (key !== drawnFor) {
            base = await view.renderBase(transform, timeMs);
            bare = (await view.renderBare?.(transform, timeMs)) ?? null;
            drawnFor = key;
          }
        }
      : undefined,
    canvasAt: draw,
    rgba: (timeMs) => {
      draw(timeMs);

      return ctx.getImageData(0, 0, size.width, size.height).data;
    },
    webp: async (timeMs) => {
      draw(timeMs);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.92),
      );

      return blob && blob.type === "image/webp"
        ? new Uint8Array(await blob.arrayBuffer())
        : null;
    },
  };
};
