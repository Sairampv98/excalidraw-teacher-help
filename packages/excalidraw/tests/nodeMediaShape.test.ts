/**
 * AC-279 - the media of a node is cut to the node's shape (D-246).
 *
 * The data and the cut are read as data; the canvas is read on a context that
 * records what it is asked to do; the SVG export is read as the elements it
 * makes.
 */

import rough from "roughjs/bin/rough";
import { describe, expect, it, vi } from "vitest";

import { arrayToMap, MIME_TYPES, THEME } from "@excalidraw/common";
import {
  canHoldMedia,
  coverCrop,
  customDataWithMedia,
  mediaClip,
  mediaCssClip,
  mediaOf,
  mediaShapeOfNode,
  renderElement,
} from "@excalidraw/element";

import type { MediaShape, NodeMedia } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { exportToSvg } from "../scene/export";

import { API } from "./helpers/api";

const media = (shape: MediaShape, radius = 0): NodeMedia => ({
  of: "node-1",
  shape,
  radius,
});

describe("AC-279 the media of a node is cut to the node's shape", () => {
  it("AC-279 the media is data that is kept and the shape is the node's own", () => {
    expect(mediaShapeOfNode({ type: "ellipse", roundness: null })).toBe(
      "ellipse",
    );
    expect(mediaShapeOfNode({ type: "diamond", roundness: null })).toBe(
      "diamond",
    );
    expect(mediaShapeOfNode({ type: "rectangle", roundness: null })).toBe(
      "rectangle",
    );
    expect(
      mediaShapeOfNode({
        type: "rectangle",
        roundness: { type: 3 },
      }),
    ).toBe("rounded");

    // only a shape can hold media
    for (const type of ["rectangle", "ellipse", "diamond"]) {
      expect(canHoldMedia({ type })).toBe(true);
    }
    for (const type of ["text", "arrow", "image", "freedraw", "frame"]) {
      expect(canHoldMedia({ type })).toBe(false);
    }

    // kept in customData, and an element without it is not media
    const kept = customDataWithMedia({ other: 1 }, media("ellipse", 4));

    expect(kept).toEqual({
      other: 1,
      media: { of: "node-1", shape: "ellipse", radius: 4 },
    });
    expect(mediaOf({ customData: kept })).toEqual(media("ellipse", 4));
    expect(mediaOf({ customData: undefined })).toBeNull();
    expect(
      mediaOf({ customData: { media: { of: "x", shape: "star" } } }),
    ).toBeNull();

    // taking it away leaves the rest, and nothing when there is nothing else
    expect(customDataWithMedia(kept, null)).toEqual({ other: 1 });
    expect(
      customDataWithMedia(
        customDataWithMedia(undefined, media("diamond")),
        null,
      ),
    ).toBeUndefined();
  });

  it("AC-279 each shape is cut as itself", () => {
    expect(mediaClip(media("rectangle"), 200, 100)).toEqual({ kind: "none" });
    expect(mediaClip(media("ellipse"), 200, 100)).toEqual({ kind: "ellipse" });
    expect(mediaClip(media("diamond"), 200, 100)).toEqual({
      kind: "polygon",
      points: [
        [100, 0],
        [200, 50],
        [100, 100],
        [0, 50],
      ],
    });

    // a rounded cut keeps the node's radius, and never more than half the box
    expect(mediaClip(media("rounded", 12), 200, 100)).toEqual({
      kind: "roundRect",
      radius: 12,
    });
    expect(mediaClip(media("rounded", 500), 200, 100)).toEqual({
      kind: "roundRect",
      radius: 50,
    });

    // and the overlays of a GIF and a video are cut the same way
    expect(mediaCssClip(media("rectangle"))).toBeUndefined();
    expect(mediaCssClip(media("ellipse"))).toBe("ellipse(50% 50% at 50% 50%)");
    expect(mediaCssClip(media("diamond"))).toBe(
      "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
    );
    expect(mediaCssClip(media("rounded", 12))).toBe("inset(0 round 12px)");
  });

  it("AC-279 a picture fills the box: it is cut and not shrunk to fit", () => {
    const box = { width: 200, height: 100 };

    // wider than the box: the sides are cut, the whole height is used
    const wide = coverCrop(box, { width: 800, height: 200 });

    expect(wide).toEqual({
      x: 200,
      y: 0,
      width: 400,
      height: 200,
      naturalWidth: 800,
      naturalHeight: 200,
    });

    // taller than the box: the top and the foot are cut, the whole width is used
    const tall = coverCrop(box, { width: 200, height: 400 });

    expect(tall).toMatchObject({ x: 0, y: 150, width: 200, height: 100 });

    // the same shape as the box: nothing is cut
    expect(coverCrop(box, { width: 400, height: 200 })).toMatchObject({
      x: 0,
      y: 0,
      width: 400,
      height: 200,
    });

    // whatever the picture, the part that is kept has the box's own shape and
    // is centred, so there are no borders to fill
    for (const natural of [
      { width: 1000, height: 100 },
      { width: 100, height: 1000 },
      { width: 333, height: 777 },
    ]) {
      const crop = coverCrop(box, natural);

      expect(crop.width / crop.height).toBeCloseTo(2, 6);
      expect(crop.x + crop.width / 2).toBeCloseTo(natural.width / 2, 6);
      expect(crop.y + crop.height / 2).toBeCloseTo(natural.height / 2, 6);
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.width).toBeLessThanOrEqual(natural.width + 1e-6);
      expect(crop.y + crop.height).toBeLessThanOrEqual(natural.height + 1e-6);
    }
  });

  /** an image element with this media, drawn on a canvas that records what it is asked to do */
  const drawImage = (shape: MediaShape | null, radius = 0) => {
    const base = API.createElement({
      type: "image",
      fileId: "pic1",
      width: 200,
      height: 100,
    });
    const element = {
      ...base,
      ...(shape ? { customData: { media: media(shape, radius) } } : {}),
    } as ExcalidrawElement;
    const canvas = document.createElement("canvas");

    canvas.width = 400;
    canvas.height = 400;

    const context = canvas.getContext("2d") as CanvasRenderingContext2D & {
      __getEvents: () => { type: string; props: Record<string, unknown> }[];
    };
    // jsdom's canvas has no `roundRect`: a recording one stands in for it
    const roundRect = vi.fn();

    if (!context.roundRect) {
      Object.defineProperty(context, "roundRect", {
        configurable: true,
        value: roundRect,
      });
    }

    const image = document.createElement("img");

    Object.defineProperty(image, "naturalWidth", { value: 400 });
    Object.defineProperty(image, "naturalHeight", { value: 200 });

    renderElement(
      element as never,
      arrayToMap([element]) as never,
      arrayToMap([element]) as never,
      rough.canvas(canvas),
      context,
      {
        canvasBackgroundColor: "#ffffff",
        imageCache: new Map([["pic1", { image, mimeType: MIME_TYPES.png }]]),
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

    return Object.assign(context, { roundRectCalls: roundRect.mock.calls });
  };

  const kinds = (context: ReturnType<typeof drawImage>) =>
    context.__getEvents().map((event) => event.type);

  it("AC-279 the canvas cuts the picture to the shape before it draws it", () => {
    for (const [shape, cut] of [
      ["ellipse", "ellipse"],
      ["diamond", "lineTo"],
    ] as const) {
      const events = kinds(drawImage(shape));

      expect(events, shape).toContain(cut);
      expect(events, shape).toContain("clip");
      // the cut is made before the picture is drawn, so it is cut by it
      expect(events.indexOf("clip"), shape).toBeLessThan(
        events.indexOf("drawImage"),
      );
    }

    // a rounded node's picture is cut with its radius
    const rounded = drawImage("rounded", 10);

    expect(rounded.roundRectCalls).toEqual([[0, 0, 200, 100, 10]]);
    expect(kinds(rounded)).toContain("clip");

    // a rectangle is not cut, and an image that is not media is not either
    expect(kinds(drawImage("rectangle"))).not.toContain("clip");
    expect(kinds(drawImage(null))).not.toContain("clip");
    expect(kinds(drawImage(null))).toContain("drawImage");
  });

  it("AC-279 the SVG export cuts the picture to the shape", async () => {
    const svgFor = async (shape: MediaShape | null, radius = 0) => {
      const image = {
        ...API.createElement({
          type: "image",
          fileId: "pic1" as never,
          width: 200,
          height: 100,
        }),
        ...(shape ? { customData: { media: media(shape, radius) } } : {}),
      } as ExcalidrawElement;

      return exportToSvg(
        [image] as never,
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
    };

    const ellipse = await svgFor("ellipse");
    const cutOf = (svg: SVGSVGElement) =>
      svg.querySelector('clipPath[id^="image-media-clipPath-"]');

    expect(cutOf(ellipse)?.querySelector("ellipse")).not.toBeNull();
    expect(ellipse.querySelector("g[clip-path]")).not.toBeNull();

    expect(
      cutOf(await svgFor("diamond"))?.querySelector("polygon"),
    ).not.toBeNull();

    const rounded = cutOf(await svgFor("rounded", 12))?.querySelector("rect");

    expect(rounded?.getAttribute("rx")).toBe("12");

    expect(cutOf(await svgFor("rectangle"))).toBeNull();
    expect(cutOf(await svgFor(null))).toBeNull();
  });
});
