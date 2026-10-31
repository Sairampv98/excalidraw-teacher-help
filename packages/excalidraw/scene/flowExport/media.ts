/**
 * The GIFs and animated WebPs that are in a chart (D-391).
 *
 * A picture in a node that moves - an emoji GIF, a clip - is drawn by the canvas
 * as whichever frame the browser happens to hold, so in an exported file it was
 * stuck on one frame (without the camera) or showed frames at random (with it).
 * A file has to show the frame that belongs to each moment of it, so each such
 * file is read frame by frame - with the browser's own `ImageDecoder` - and the
 * frame for a moment is chosen from the moment alone: the file loops by its own
 * length, as it does on the page.
 *
 * The frame is a still picture (a PNG) that stands in for the file for that one
 * picture of the export; the canvas export never learns it was a GIF.
 */

import { isImageElement } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { isAnimatedImageFile } from "../animatedImages";

import type { BinaryFiles } from "../../types";

export type AnimatedMedia = {
  fileId: string;
  /** how long each frame of the file is shown, in ms */
  durations: number[];
  /** the whole file's length, in ms */
  total: number;
  /** the picture of frame `index`, as a data URL; made once */
  frameUrl: (index: number) => Promise<string>;
};

/**
 * How long a frame is shown, from what the decoder says (in microseconds). A
 * frame that says next to nothing is shown for a tenth of a second: that is what
 * browsers do with a GIF, and what the page shows.
 */
export const frameDurationMs = (microseconds: number | null | undefined) => {
  const ms = (microseconds ?? 0) / 1000;

  return ms >= 20 ? ms : 100;
};

/** which frame is shown `timeMs` into a file that loops by its own length */
export const frameIndexAt = (
  durations: readonly number[],
  timeMs: number,
): number => {
  const total = durations.reduce((sum, each) => sum + each, 0);

  if (!durations.length || total <= 0) {
    return 0;
  }

  let left = ((timeMs % total) + total) % total;

  for (let i = 0; i < durations.length; i++) {
    if (left < durations[i]) {
      return i;
    }

    left -= durations[i];
  }

  return durations.length - 1;
};

/** a word that changes exactly when one of the files has gone on to another frame */
export const mediaStateAt = (
  media: readonly AnimatedMedia[],
  timeMs: number,
): string => media.map((m) => frameIndexAt(m.durations, timeMs)).join(",");

/** the files in the chart's elements that move: the ids of GIFs and animated WebPs */
export const animatedFileIdsOf = (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): string[] => {
  const ids = new Set<string>();

  for (const element of elements) {
    if (
      isImageElement(element) &&
      element.fileId != null &&
      !element.isDeleted &&
      isAnimatedImageFile(files[element.fileId])
    ) {
      ids.add(element.fileId);
    }
  }

  return [...ids];
};

/** the browser's decoder of pictures, as far as this module uses it */
export type DecoderLike = {
  tracks: {
    ready: Promise<unknown>;
    selectedTrack?: { frameCount: number } | null;
  };
  decode: (options: {
    frameIndex: number;
  }) => Promise<{ image: { duration: number | null; close: () => void } }>;
  close: () => void;
};

export type MediaDeps = {
  /** a decoder for the bytes of a file, or null where the browser has none */
  createDecoder: (data: Uint8Array, type: string) => DecoderLike | null;
  /** a still picture of a decoded frame, as a data URL */
  toDataUrl: (image: unknown) => string;
};

/** whether this browser can read the frames of a GIF at all */
export const canReadFrames = () => typeof ImageDecoder !== "undefined";

const bytesOfDataUrl = (dataURL: string): Uint8Array | null => {
  const comma = dataURL.indexOf(",");

  if (comma < 0 || !dataURL.slice(0, comma).endsWith(";base64")) {
    return null;
  }

  const raw = atob(dataURL.slice(comma + 1));
  const bytes = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }

  return bytes;
};

const realDeps: MediaDeps = {
  createDecoder: (data, type) =>
    typeof ImageDecoder === "undefined"
      ? null
      : (new ImageDecoder({ data, type }) as unknown as DecoderLike),
  toDataUrl: (image) => {
    const frame = image as VideoFrame;
    const canvas = document.createElement("canvas");

    canvas.width = frame.displayWidth;
    canvas.height = frame.displayHeight;
    canvas.getContext("2d")!.drawImage(frame, 0, 0);

    return canvas.toDataURL("image/png");
  },
};

/**
 * Reads the frames of each of the files. A file that cannot be read - no decoder
 * in this browser, bytes that are not a picture, a file of one frame - is left
 * out, and stays one picture in the export as before.
 */
export const loadAnimatedMedia = async (
  fileIds: readonly string[],
  files: BinaryFiles,
  deps: MediaDeps = realDeps,
): Promise<AnimatedMedia[]> => {
  const media: AnimatedMedia[] = [];

  for (const fileId of fileIds) {
    const file = files[fileId];

    try {
      const data = file ? bytesOfDataUrl(file.dataURL) : null;
      const decoder = data ? deps.createDecoder(data, file.mimeType) : null;

      if (!decoder) {
        continue;
      }

      await decoder.tracks.ready;

      const count = decoder.tracks.selectedTrack?.frameCount ?? 0;

      if (count < 2) {
        decoder.close();
        continue;
      }

      const durations: number[] = [];

      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i });

        durations.push(frameDurationMs(image.duration));
        image.close();
      }

      const urls = new Map<number, string>();

      media.push({
        fileId,
        durations,
        total: durations.reduce((sum, each) => sum + each, 0),
        frameUrl: async (index) => {
          const kept = urls.get(index);

          if (kept) {
            return kept;
          }

          const { image } = await decoder.decode({ frameIndex: index });
          const url = deps.toDataUrl(image);

          image.close();
          urls.set(index, url);

          return url;
        },
      });
    } catch {
      // this one stays a single picture
    }
  }

  return media;
};

/**
 * The elements and the files of a chart as they are at a moment: each element
 * that shows a moving file shows the frame that belongs to the moment, as a file
 * of its own (`<id>@<frame>`), so the canvas export draws that frame and keeps
 * the pictures it has already loaded.
 */
export const atMoment = async (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
  media: readonly AnimatedMedia[],
  timeMs: number,
): Promise<{ elements: ExcalidrawElement[]; files: BinaryFiles }> => {
  if (!media.length) {
    return { elements: [...elements], files };
  }

  const byId = new Map(media.map((m) => [m.fileId, m]));
  const extra: BinaryFiles = {};
  const made: ExcalidrawElement[] = [];

  for (const element of elements) {
    const moving =
      isImageElement(element) && element.fileId != null
        ? byId.get(element.fileId)
        : undefined;

    if (!moving || !isImageElement(element)) {
      made.push(element);
      continue;
    }

    const index = frameIndexAt(moving.durations, timeMs);
    const id = `${moving.fileId}@${index}`;

    if (!extra[id]) {
      extra[id] = {
        ...files[moving.fileId],
        id: id as never,
        mimeType: "image/png",
        dataURL: (await moving.frameUrl(index)) as never,
      };
    }

    made.push({ ...element, fileId: id as never });
  }

  return { elements: made, files: { ...files, ...extra } };
};
