/**
 * AC-445 - an animated WebP animates on the canvas as a GIF does, and is never
 * resized into one picture (D-382).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it } from "vitest";

import { resizeImageFile } from "../data/blob";
import {
  animatedImageFileIds,
  getAnimatedImageElements,
  isAnimatedImageFile,
  isAnimatedWebpBytes,
  isAnimatedWebpDataUrl,
} from "../scene/animatedImages";
import { assembleAnimatedWebp } from "../scene/flowExport/webp";

import { API } from "./helpers/api";

import type { BinaryFiles, DataURL } from "../types";

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const le32 = (n: number) => [
  n & 255,
  (n >> 8) & 255,
  (n >> 16) & 255,
  (n >>> 24) & 255,
];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

const chunk = (name: string, body: number[]) => [
  ...ascii(name),
  ...le32(body.length),
  ...body,
  ...(body.length & 1 ? [0] : []),
];

const riff = (chunks: number[][]) => {
  const body = [...ascii("WEBP"), ...chunks.flat()];

  return Uint8Array.from([...ascii("RIFF"), ...le32(body.length), ...body]);
};

/** a still WebP, lossless, with no extended header */
const still = () =>
  riff([chunk("VP8L", [0x2f, ...le32(7 | (3 << 14)), 1, 2, 3])]);

/** a still WebP with an extended header that says transparency and nothing else */
const stillExtended = () =>
  riff([
    chunk("VP8X", [0x10, 0, 0, 0, ...le24(7), ...le24(3)]),
    chunk("VP8L", [0x2f, ...le32(7 | (3 << 14)), 1, 2, 3]),
  ]);

/** an animated WebP, as the export writes it */
const animated = () =>
  assembleAnimatedWebp(
    [
      { bytes: still(), durationMs: 100 },
      { bytes: still(), durationMs: 100 },
    ],
    { width: 8, height: 4 },
  );

const dataUrl = (bytes: Uint8Array, type = "image/webp") =>
  `data:${type};base64,${btoa(String.fromCharCode(...bytes))}` as DataURL;

const GIF_BYTES = Uint8Array.from([
  ...ascii("GIF89a"),
  8,
  0,
  4,
  0,
  0,
  0,
  0,
  0x3b,
]);

describe("an animated WebP", () => {
  it("AC-445 is known by the flag in its header, and by nothing else", () => {
    expect(isAnimatedWebpBytes(animated())).toBe(true);

    // a still, with and without the extended header, is not
    expect(isAnimatedWebpBytes(still())).toBe(false);
    expect(isAnimatedWebpBytes(stillExtended())).toBe(false);

    // nor is a file of another kind, or one that is too short to say
    expect(isAnimatedWebpBytes(GIF_BYTES)).toBe(false);
    expect(isAnimatedWebpBytes(Uint8Array.from([1, 2, 3]))).toBe(false);
    expect(isAnimatedWebpBytes(animated().slice(0, 20))).toBe(false);
    expect(isAnimatedWebpBytes([])).toBe(false);
  });

  it("AC-445 is read from the start of a data URL, and a data URL that is not one is not animated", () => {
    expect(isAnimatedWebpDataUrl(dataUrl(animated()))).toBe(true);
    expect(isAnimatedWebpDataUrl(dataUrl(still()))).toBe(false);
    expect(isAnimatedWebpDataUrl(dataUrl(stillExtended()))).toBe(false);

    expect(isAnimatedWebpDataUrl(undefined)).toBe(false);
    expect(isAnimatedWebpDataUrl("")).toBe(false);
    expect(isAnimatedWebpDataUrl("data:image/webp,not-base64")).toBe(false);
    expect(isAnimatedWebpDataUrl("data:image/webp;base64,@@@@")).toBe(false);
  });

  it("AC-445 a file is animated when it is a GIF, or a WebP whose header says so", () => {
    expect(isAnimatedImageFile({ mimeType: "image/gif" })).toBe(true);
    expect(
      isAnimatedImageFile({
        mimeType: "image/webp",
        dataURL: dataUrl(animated()),
      }),
    ).toBe(true);

    expect(
      isAnimatedImageFile({
        mimeType: "image/webp",
        dataURL: dataUrl(still()),
      }),
    ).toBe(false);
    expect(isAnimatedImageFile({ mimeType: "image/webp" })).toBe(false);
    // the header is not enough: a PNG that carries those bytes is a PNG
    expect(
      isAnimatedImageFile({
        mimeType: "image/png",
        dataURL: dataUrl(animated(), "image/png"),
      }),
    ).toBe(false);
    expect(isAnimatedImageFile(undefined)).toBe(false);
  });

  it("AC-445 on the canvas it is one of the images that are played, with the GIFs", () => {
    const files = {
      gif: {
        id: "gif",
        mimeType: "image/gif",
        dataURL: dataUrl(GIF_BYTES, "image/gif"),
        created: 1,
      },
      moving: {
        id: "moving",
        mimeType: "image/webp",
        dataURL: dataUrl(animated()),
        created: 1,
      },
      still: {
        id: "still",
        mimeType: "image/webp",
        dataURL: dataUrl(still()),
        created: 1,
      },
    } as unknown as BinaryFiles;

    const elements = [
      API.createElement({ type: "image", id: "a", fileId: "gif" as never }),
      API.createElement({ type: "image", id: "b", fileId: "moving" as never }),
      API.createElement({ type: "image", id: "c", fileId: "still" as never }),
      API.createElement({ type: "rectangle", id: "d" }),
    ];

    expect([...animatedImageFileIds(elements, files)].sort()).toEqual([
      "gif",
      "moving",
    ]);
    expect(getAnimatedImageElements(elements, files).map((e) => e.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("AC-445 is not resized, however large, so it does not become one picture; nor is a GIF", async () => {
    const webp = new File([animated() as BlobPart], "chart.webp", {
      type: "image/webp",
    });
    const gif = new File([GIF_BYTES as BlobPart], "chart.gif", {
      type: "image/gif",
    });

    // a limit of one pixel: any other image would be resized
    expect(await resizeImageFile(webp, { maxWidthOrHeight: 1 })).toBe(webp);
    expect(await resizeImageFile(gif, { maxWidthOrHeight: 1 })).toBe(gif);
  });
});
