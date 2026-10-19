import { afterEach, describe, expect, it } from "vitest";

import { loadHTMLImageElement, updateImageCache } from "@excalidraw/element";

import type { DataURL } from "@excalidraw/excalidraw/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

/**
 * The render cache deliberately loads every image *detached*.
 *
 * A GIF loaded here stays frozen on frame one, which used to look like a bug in
 * this file and led to a hidden `<img>` being parked in the document for the
 * compositor. That was measured against the running app and never worked — see
 * the table on `loadHTMLImageElement`. The animation comes from a real, visible
 * element instead, in `components/AnimatedImageOverlay.tsx`; the copy kept here
 * exists for exports and for still images.
 */

const dataUrl = (mimeType: string) =>
  `data:${mimeType};base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7` as DataURL;

const files = (mimeType: string) =>
  ({
    f1: {
      id: "f1",
      mimeType,
      dataURL: dataUrl(mimeType),
      created: 1,
      lastRetrieved: 1,
    },
  } as unknown as BinaryFiles);

/** every element currently in the document, whatever its container */
const domImageCount = () => document.querySelectorAll("img").length;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("loadHTMLImageElement", () => {
  it("loads without attaching the image to the document", () => {
    const before = domImageCount();

    void loadHTMLImageElement(dataUrl("image/gif"));

    // the teeth of this file: re-introducing a hidden host — however small,
    // however opaque, however high its z-index — fails here
    expect(domImageCount()).toBe(before);
  });

  it("leaves nothing behind for a still image either", () => {
    const before = domImageCount();

    void loadHTMLImageElement(dataUrl("image/png"));

    expect(domImageCount()).toBe(before);
  });
});

describe("updateImageCache", () => {
  it("caches a GIF exactly as it caches any other image", () => {
    // the mime type no longer changes anything on this path; the split between
    // animated and still images happens at render time, not at load time
    const imageCache = new Map();

    void updateImageCache({
      fileIds: ["f1" as never],
      files: files("image/gif"),
      imageCache,
    });

    expect(imageCache.size).toBe(1);
    expect(imageCache.get("f1" as never)).toMatchObject({
      mimeType: "image/gif",
    });
  });

  it("does not attach a GIF while caching it", () => {
    const before = domImageCount();

    void updateImageCache({
      fileIds: ["f1" as never],
      files: files("image/gif"),
      imageCache: new Map(),
    });

    expect(domImageCount()).toBe(before);
  });

  it("ignores a file id with nothing behind it", () => {
    const imageCache = new Map();

    void updateImageCache({
      fileIds: ["missing" as never],
      files: files("image/gif"),
      imageCache,
    });

    expect(imageCache.size).toBe(0);
  });
});
