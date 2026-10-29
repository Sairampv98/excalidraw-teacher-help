/**
 * AC-286 - the fits are drawn: the canvas, the SVG export and the overlays of a
 * GIF and a video all place the picture where its view says (D-247).
 */

import React from "react";
import rough from "roughjs/bin/rough";
import { describe, expect, it, vi } from "vitest";

import { arrayToMap, MIME_TYPES, THEME } from "@excalidraw/common";
import {
  customDataWithMedia,
  renderElement,
  viewForFit,
  viewPlacement,
} from "@excalidraw/element";

import type { MediaFit, MediaShape } from "@excalidraw/element";
import type {
  ExcalidrawElement,
  ExcalidrawPanelElement,
  FileId,
} from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { Excalidraw, videoPanelContent } from "../index";
import { exportToSvg } from "../scene/export";

import { API } from "./helpers/api";
import { render, waitFor } from "./test-utils";

import type { BinaryFileData } from "../types";

const NATURAL = { width: 400, height: 200 };
const BOX = { width: 200, height: 160 };

const GIF_ID = "gif-1" as FileId;
const VIDEO_ID = "video-1" as FileId;

const mediaData = (fit: MediaFit, shape: MediaShape) => ({
  of: "node",
  shape,
  radius: 0,
  fit,
  natural: NATURAL,
  view: viewForFit(fit, BOX, NATURAL, shape),
});

const image = (
  fit: MediaFit | null,
  shape: MediaShape = "ellipse",
  fileId = "pic1",
) =>
  ({
    ...API.createElement({
      type: "image",
      fileId: fileId as never,
      width: BOX.width,
      height: BOX.height,
    }),
    ...(fit
      ? { customData: customDataWithMedia(undefined, mediaData(fit, shape)) }
      : {}),
  } as ExcalidrawElement);

const draw = (element: ExcalidrawElement) => {
  const canvas = document.createElement("canvas");

  canvas.width = 400;
  canvas.height = 400;

  const context = canvas.getContext("2d")!;
  const img = document.createElement("img");

  Object.defineProperty(img, "naturalWidth", { value: NATURAL.width });
  Object.defineProperty(img, "naturalHeight", { value: NATURAL.height });

  renderElement(
    element as never,
    arrayToMap([element]) as never,
    arrayToMap([element]) as never,
    rough.canvas(canvas),
    context,
    {
      canvasBackgroundColor: "#ffffff",
      imageCache: new Map([["pic1", { image: img, mimeType: MIME_TYPES.png }]]),
      renderGrid: false,
      isExporting: true,
      embedsValidationStatus: { element: new Map(), frame: new Map() },
      elementsPendingErasure: new Map(),
      pendingFlowchartNodes: null,
      theme: THEME.LIGHT,
    } as never,
    {
      ...getDefaultAppState(),
      width: 400,
      height: 400,
      zoom: { value: 1 },
      scrollX: 0,
      scrollY: 0,
    } as never,
  );

  return context;
};

/** the arguments of the one picture that was drawn */
const drawn = (context: CanvasRenderingContext2D) => {
  const calls = (
    context.drawImage as unknown as { mock: { calls: number[][] } }
  ).mock.calls;

  expect(calls).toHaveLength(1);

  return calls[0].slice(1);
};

describe("AC-286 the fits are drawn", () => {
  it("AC-286 the canvas places the whole picture by its view", () => {
    for (const fit of ["best", "inside"] as MediaFit[]) {
      const element = image(fit);
      const placed = viewPlacement(
        viewForFit(fit, BOX, NATURAL, "ellipse"),
        BOX,
        NATURAL,
      );

      // the whole picture, on the place its view gives it
      expect(drawn(draw(element)), fit).toEqual([
        0,
        0,
        NATURAL.width,
        NATURAL.height,
        placed.x,
        placed.y,
        placed.width,
        placed.height,
      ]);
    }

    // best fit is all of the picture in the box, with room at the sides or the
    // foot; fit into the shape is smaller
    const best = drawn(draw(image("best")));
    const inside = drawn(draw(image("inside")));

    expect(best[6]).toBeLessThanOrEqual(BOX.width + 1e-6);
    expect(best[7]).toBeLessThanOrEqual(BOX.height + 1e-6);
    expect(inside[6]).toBeLessThan(best[6]);

    // the auto crop fills the box: its picture is larger than the box
    const auto = drawn(draw(image("auto")));

    expect(auto[6]).toBeGreaterThanOrEqual(BOX.width - 1e-6);
    expect(auto[7]).toBeGreaterThanOrEqual(BOX.height - 1e-6);
  });

  it("AC-286 media from before has no view and is drawn by its crop as it was", () => {
    const plain = {
      ...image(null),
      crop: {
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        ...{ naturalWidth: 400, naturalHeight: 200 },
      },
      customData: {
        media: { of: "node", shape: "ellipse", radius: 0 },
      },
    } as unknown as ExcalidrawElement;

    expect(drawn(draw(plain))).toEqual([
      10,
      20,
      100,
      80,
      0,
      0,
      BOX.width,
      BOX.height,
    ]);
  });

  it("AC-286 the SVG export places the whole picture by its view", async () => {
    const svgFor = async (fit: MediaFit) =>
      exportToSvg(
        [image(fit)] as never,
        { exportBackground: false, viewBackgroundColor: "#ffffff" },
        {
          pic1: {
            id: "pic1",
            mimeType: MIME_TYPES.png,
            dataURL: "data:image/png;base64,iVBORw0KGgo=",
            created: 1,
            lastRetrieved: 1,
          },
        } as never,
        { skipInliningFonts: true },
      );

    for (const fit of ["best", "inside"] as MediaFit[]) {
      const svg = await svgFor(fit);
      const picture = svg.querySelector("g[clip-path] > image")!;
      const placed = viewPlacement(
        viewForFit(fit, BOX, NATURAL, "ellipse"),
        BOX,
        NATURAL,
      );

      expect(picture, fit).not.toBeNull();
      expect(Number(picture.getAttribute("x"))).toBeCloseTo(placed.x, 6);
      expect(Number(picture.getAttribute("y"))).toBeCloseTo(placed.y, 6);
      expect(Number(picture.getAttribute("width"))).toBeCloseTo(
        placed.width,
        6,
      );
      expect(Number(picture.getAttribute("height"))).toBeCloseTo(
        placed.height,
        6,
      );
      // and it is cut to the node's shape
      expect(
        svg.querySelector('clipPath[id^="image-media-clipPath-"] ellipse'),
      ).not.toBeNull();
    }
  });

  it("AC-286 the GIF and the video of a node are placed by the view too", async () => {
    const files = {
      [GIF_ID]: {
        id: GIF_ID,
        mimeType: MIME_TYPES.gif,
        dataURL:
          "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        created: 1,
        lastRetrieved: 1,
      },
      [VIDEO_ID]: {
        id: VIDEO_ID,
        mimeType: "video/mp4" as unknown as BinaryFileData["mimeType"],
        dataURL: "data:video/mp4;base64,AAAA",
        created: 1,
        lastRetrieved: 1,
      },
    } as unknown as Record<string, BinaryFileData>;
    const gif = {
      ...API.createElement({
        type: "image",
        fileId: GIF_ID,
        x: 100,
        y: 100,
        width: BOX.width,
        height: BOX.height,
      }),
      customData: customDataWithMedia(undefined, mediaData("best", "ellipse")),
    } as ExcalidrawElement;
    const video = {
      ...API.createElement({
        type: "panel",
        x: 100,
        y: 400,
        width: BOX.width,
        height: BOX.height,
        panelKind: "video",
        panel: videoPanelContent({
          source: { type: "file", fileId: VIDEO_ID, mimeType: "video/mp4" },
          tracks: [],
          language: "en",
          naturalWidth: NATURAL.width,
          naturalHeight: NATURAL.height,
        }),
        posterMode: false,
        posterFileId: null,
      }),
      customData: customDataWithMedia(
        undefined,
        mediaData("inside", "ellipse"),
      ),
    } as unknown as ExcalidrawPanelElement;

    await render(
      <Excalidraw
        initialData={{
          elements: [gif, video as never] as never,
          files,
        }}
      />,
    );
    API.setAppState({ width: 1000, height: 1000 });

    const near = (value: string, expected: number) =>
      expect(parseFloat(value)).toBeCloseTo(expected, 4);

    // the GIF: its own `<img>`, placed by the view
    const gifImage = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        ".excalidraw__animated-image img",
      );

      expect(found).not.toBeNull();

      return found!;
    });
    const bestPlacement = viewPlacement(
      viewForFit("best", BOX, NATURAL, "ellipse"),
      BOX,
      NATURAL,
    );

    near(gifImage.style.left, bestPlacement.x);
    near(gifImage.style.top, bestPlacement.y);
    near(gifImage.style.width, bestPlacement.width);
    near(gifImage.style.height, bestPlacement.height);

    // the video: placed the same way, from the video's own size
    const player = await waitFor(() => {
      const found = document.querySelector<HTMLVideoElement>(
        '[data-testid="panel-video"]',
      );

      expect(found).not.toBeNull();

      return found!;
    });
    const insidePlacement = viewPlacement(
      viewForFit("inside", BOX, NATURAL, "ellipse"),
      BOX,
      NATURAL,
    );

    near(player.style.left, insidePlacement.x);
    near(player.style.top, insidePlacement.y);
    near(player.style.width, insidePlacement.width);
    near(player.style.height, insidePlacement.height);

    vi.restoreAllMocks();
  });
});
