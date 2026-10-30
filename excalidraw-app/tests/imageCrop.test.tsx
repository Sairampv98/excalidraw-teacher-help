/**
 * The **crop window of an image** on the canvas (D-348): the arithmetic that
 * puts a crop on the element, and the window a double click opens.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { afterEach, describe, expect, it } from "vitest";

import React from "react";

import { Excalidraw, ExcalidrawAPIProvider } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { FileId } from "@excalidraw/element/types";

import { ImageCropMode } from "../sidebar/ImageCrop";
import { closeImageCrop, openImageCrop } from "../sidebar/imageCropState";
import {
  IMAGE_CROP_MIN,
  clampImagePart,
  imageCropUpdates,
} from "../sidebar/imageCropMath";

const NATURAL = { width: 1000, height: 500 };

const element = (overrides: Record<string, unknown> = {}) =>
  ({
    ...API.createElement({
      type: "image",
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      fileId: "a-picture" as FileId,
      status: "saved",
    }),
    ...overrides,
  } as ReturnType<typeof API.createElement> & {
    type: "image";
    crop: unknown;
  });

afterEach(() => {
  act(() => closeImageCrop());
});

describe("the crop of an image", () => {
  it("AC-404 a part of the picture is put on the element at the scale it had, where it was", () => {
    const image = element() as never;

    // the middle half of the picture, each way: half as wide on the canvas too,
    // and the same part of the picture stands in the same place
    const updates = imageCropUpdates(
      image,
      { x: 250, y: 125, width: 500, height: 250 },
      NATURAL,
    );

    expect(updates.width).toBeCloseTo(100, 5);
    expect(updates.height).toBeCloseTo(50, 5);
    expect(updates.x).toBeCloseTo(10 + 250 * 0.2, 5);
    expect(updates.y).toBeCloseTo(20 + 125 * 0.2, 5);
    expect(updates.crop).toEqual({
      x: 250,
      y: 125,
      width: 500,
      height: 250,
      naturalWidth: 1000,
      naturalHeight: 500,
    });

    // the whole picture is no crop at all, and it is the size it began with
    const whole = imageCropUpdates(
      image,
      { x: 0, y: 0, width: 1000, height: 500 },
      NATURAL,
    );

    expect(whole.crop).toBeNull();
    expect(whole.width).toBeCloseTo(200, 5);
    expect(whole.height).toBeCloseTo(100, 5);
  });

  it("AC-404 a picture that was stretched stays stretched the way it was", () => {
    // 200 by 200 on the canvas for a picture that is 1000 by 500: the scale is
    // not the same each way
    const image = element({ width: 200, height: 200 }) as never;

    const updates = imageCropUpdates(
      image,
      { x: 250, y: 125, width: 500, height: 250 },
      NATURAL,
    );

    expect(updates.width).toBeCloseTo(100, 5);
    expect(updates.height).toBeCloseTo(100, 5);
    expect(updates.x).toBeCloseTo(10 + 250 * 0.2, 5);
    expect(updates.y).toBeCloseTo(20 + 125 * 0.4, 5);
  });

  it("AC-404 a crop of a crop is measured from the part the element shows", () => {
    // the element already shows the right half, 100 by 100 on the canvas
    const image = element({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      crop: {
        x: 500,
        y: 0,
        width: 500,
        height: 500,
        naturalWidth: 1000,
        naturalHeight: 500,
      },
    }) as never;

    // its left half again: a quarter of the picture
    const updates = imageCropUpdates(
      image,
      { x: 500, y: 0, width: 250, height: 500 },
      NATURAL,
    );

    expect(updates.width).toBeCloseTo(50, 5);
    expect(updates.height).toBeCloseTo(100, 5);
    // the part that is kept did not move
    expect(updates.x).toBeCloseTo(0, 5);
    expect(updates.y).toBeCloseTo(0, 5);
  });

  it("AC-404 a picture that is turned is cropped about its own middle", () => {
    const image = element({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      angle: Math.PI / 2,
    }) as never;

    // the right half, a square
    const updates = imageCropUpdates(
      image,
      { x: 500, y: 0, width: 500, height: 500 },
      NATURAL,
    );

    // unturned its middle is at (150, 50) and the picture's is at (100, 50); the
    // turn of a quarter takes that to (100, 100)
    expect(updates.x + updates.width / 2).toBeCloseTo(100, 5);
    expect(updates.y + updates.height / 2).toBeCloseTo(100, 5);
  });

  it("AC-404 a part is held inside the picture, and is never smaller than the least", () => {
    expect(
      clampImagePart({ x: -50, y: -50, width: 5000, height: 5000 }, NATURAL),
    ).toEqual({ x: 0, y: 0, width: 1000, height: 500 });

    expect(
      clampImagePart({ x: 990, y: 495, width: 1, height: 1 }, NATURAL),
    ).toEqual({
      x: 990,
      y: 500 - IMAGE_CROP_MIN,
      width: IMAGE_CROP_MIN,
      height: IMAGE_CROP_MIN,
    });
  });
});

describe("the crop window of an image", () => {
  const mount = async (crop: Record<string, number> | null = null) => {
    const image = element({
      x: 100,
      y: 100,
      crop: crop ?? {
        x: 0,
        y: 0,
        width: 1000,
        height: 500,
        naturalWidth: 1000,
        naturalHeight: 500,
      },
    });

    await render(
      <ExcalidrawAPIProvider>
        <Excalidraw initialData={{ elements: [image as never] }} />
        <ImageCropMode />
      </ExcalidrawAPIProvider>,
    );

    API.setAppState({ width: 1000, height: 1000 });

    // the picture's file is in the editor's store
    act(() => {
      window.h.app.addFiles([
        {
          id: "a-picture" as FileId,
          mimeType: "image/png",
          dataURL: "data:image/png;base64,AAAA" as never,
          created: 1,
        },
      ]);
    });

    return image;
  };

  it("AC-405 a double click on a picture opens the crop window, and Apply crops it", async () => {
    const image = await mount();

    expect(document.querySelector('[data-testid="image-crop"]')).toBeNull();

    // the double click is on the picture, on the canvas
    const canvas = document.querySelector(
      "canvas.excalidraw__canvas.interactive",
    ) as HTMLCanvasElement;

    // jsdom has no layout: the canvas is as big as the window, at its corner
    canvas.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 1000,
        width: 1000,
        height: 1000,
      } as DOMRect);

    fireEvent.doubleClick(canvas, { clientX: 150, clientY: 130 });

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="image-crop"]'),
      ).not.toBeNull(),
    );

    // the whole picture is there with a box on it and a handle on each side
    expect(
      document.querySelector('[data-testid="image-crop-image"]'),
    ).not.toBeNull();
    expect(
      document.querySelectorAll('[data-testid^="image-crop-handle-"]'),
    ).toHaveLength(8);

    // the east handle is dragged in: the box loses the right of the picture
    const handle = document.querySelector(
      '[data-testid="image-crop-handle-e"]',
    )!;
    const stage = document.querySelector(".media-crop__stage")!;

    act(() => {
      handle.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          clientX: 500,
          clientY: 300,
        }),
      );
    });
    act(() => {
      stage.dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          clientX: 300,
          clientY: 300,
        }),
      );
    });
    act(() => {
      stage.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientX: 300 }),
      );
    });

    fireEvent.click(
      document.querySelector('[data-testid="image-crop-apply"]') as HTMLElement,
    );

    // the window is gone and the picture is cropped, narrower than it was and
    // as tall
    expect(document.querySelector('[data-testid="image-crop"]')).toBeNull();

    const cropped = window.h.elements.find(
      (candidate) => candidate.id === image.id,
    ) as unknown as {
      width: number;
      height: number;
      crop: { x: number; width: number } | null;
    };

    expect(cropped.crop).not.toBeNull();
    expect(cropped.crop!.x).toBe(0);
    expect(cropped.crop!.width).toBeLessThan(1000);
    expect(cropped.width).toBeLessThan(200);
    expect(cropped.height).toBeCloseTo(100, 5);
  });

  it("AC-405 Cancel and Esc leave the window and change nothing", async () => {
    const image = await mount();

    act(() => openImageCrop(image.id));

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="image-crop"]'),
      ).not.toBeNull(),
    );

    fireEvent.click(
      document.querySelector(
        '[data-testid="image-crop-cancel"]',
      ) as HTMLElement,
    );

    expect(document.querySelector('[data-testid="image-crop"]')).toBeNull();

    act(() => openImageCrop(image.id));

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="image-crop"]'),
      ).not.toBeNull(),
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(document.querySelector('[data-testid="image-crop"]')).toBeNull();

    const same = window.h.elements.find(
      (candidate) => candidate.id === image.id,
    ) as unknown as { width: number };

    expect(same.width).toBe(200);
  });
});
