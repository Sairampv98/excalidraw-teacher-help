import { describe, expect, it, vi } from "vitest";

import { newPanelElement } from "@excalidraw/element";

import type { FileId } from "@excalidraw/element/types";

import { cropPosterToImageElement } from "../components/cropModal";
import { createOcrClient, OcrError } from "../ocrClient";

const POSTER_FILE_ID = "poster-file-1" as FileId;

const posterPanel = (overrides: Record<string, unknown> = {}) =>
  newPanelElement({
    type: "panel",
    x: 100,
    y: 200,
    width: 400,
    height: 300,
    panelKind: "video",
    panel: {
      source: { type: "file", fileId: POSTER_FILE_ID, mimeType: "image/png" },
      options: {
        // the poster is 1920×1080; the panel shows it at 400×300
        naturalWidth: 1920,
        naturalHeight: 1080,
        captions: null,
      },
    },
    posterMode: true,
    posterFileId: POSTER_FILE_ID,
    ...overrides,
  });

describe("cropping a poster panel", () => {
  it("AC-56 cropping a poster yields a new image element on the current page", () => {
    const panel = posterPanel();

    const cropped = cropPosterToImageElement({
      panel,
      crop: { x: 100, y: 200, width: 960, height: 540 },
      pageId: "page-2",
    });

    expect(cropped.type).toBe("image");
    // the new element is on the **current** page
    expect(cropped.pageId).toBe("page-2");
    // and it points at the very same poster file
    expect(cropped.fileId).toBe(POSTER_FILE_ID);
    // it is a new element, not the panel
    expect(cropped.id).not.toBe(panel.id);
  });

  it("AC-56 cropping a poster leaves the panel untouched", () => {
    const panel = posterPanel();

    const before = { ...panel };

    cropPosterToImageElement({
      panel,
      crop: { x: 100, y: 200, width: 960, height: 540 },
      pageId: "page-1",
    });

    expect(panel).toEqual(before);
    expect(panel.type).toBe("panel");
    expect(panel.posterMode).toBe(true);
    expect(panel.posterFileId).toBe(POSTER_FILE_ID);
    expect(panel.width).toBe(400);
    expect(panel.height).toBe(300);
  });

  it("AC-56 the crop rectangle is in the poster's own pixels, not in the panel's size", () => {
    const panel = posterPanel();

    const cropped = cropPosterToImageElement({
      panel,
      crop: { x: 100, y: 200, width: 960, height: 540 },
      pageId: "page-1",
    });

    expect(cropped.crop).toMatchObject({
      x: 100,
      y: 200,
      width: 960,
      height: 540,
      naturalWidth: 1920,
      naturalHeight: 1080,
    });

    // the element is drawn at the panel's scale: the panel shows 1920 px of
    // poster in 400 px of canvas, so half the poster is 200 px wide
    expect(cropped.width).toBe(200);
    expect(cropped.height).toBe(300 * (540 / 1080));
  });

  it("AC-56 a live panel cannot be cropped", () => {
    const live = posterPanel({ posterMode: false, posterFileId: null });

    expect(() =>
      cropPosterToImageElement({
        panel: live,
        crop: { x: 0, y: 0, width: 10, height: 10 },
        pageId: "page-1",
      }),
    ).toThrow();
  });
});

describe("the OCR hook", () => {
  it("carries the image to the service and returns the text", async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          text: "hello",
          blocks: [{ text: "hello", x: 1, y: 2, width: 3, height: 4 }],
        }),
      } as unknown as Response),
    );

    const client = createOcrClient({
      endpoint: "https://ocr.example/recognize",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.recognize({
      dataURL: "data:image/png;base64,POSTER",
      mimeType: "image/png",
    });

    expect(result.text).toBe("hello");
    expect(result.blocks).toHaveLength(1);

    // the request carries the **poster** — an ordinary PNG — and not a
    // panel's own bytes (D-65)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];

    expect(url).toBe("https://ocr.example/recognize");
    expect(JSON.parse(init.body as string)).toMatchObject({
      image: "data:image/png;base64,POSTER",
      mimeType: "image/png",
    });
  });

  it("refuses a malformed answer rather than pretending to have read it", async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ blocks: [] }),
      } as unknown as Response),
    );

    const client = createOcrClient({
      endpoint: "https://ocr.example/recognize",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      client.recognize({
        dataURL: "data:image/png;base64,POSTER",
        mimeType: "image/png",
      }),
    ).rejects.toThrow(OcrError);
  });
});
