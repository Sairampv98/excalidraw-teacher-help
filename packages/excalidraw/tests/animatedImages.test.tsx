import React from "react";
import rough from "roughjs/bin/rough";
import { arrayToMap, MIME_TYPES, THEME } from "@excalidraw/common";
import { elementWithCanvasCache, renderElement } from "@excalidraw/element";

import { Excalidraw } from "../index";

import { getDefaultAppState } from "../appState";
import {
  animatedImageFileIds,
  getAnimatedImageElements,
  isAnimatedImageMimeType,
  sceneHasAnimatedImage,
} from "../scene/animatedImages";

import { API } from "./helpers/api";
import { render } from "./test-utils";

import type { BinaryFiles } from "../types";

const GIF_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

const binaryFile = (mimeType: string) =>
  ({
    id: "gif1",
    mimeType,
    dataURL: mimeType === MIME_TYPES.gif ? GIF_DATA_URL : PNG_DATA_URL,
    created: 1,
    lastRetrieved: 1,
  } as unknown as BinaryFiles[string]);

const imageElement = (fileId: string | null) =>
  ({
    id: "img",
    type: "image",
    fileId,
    isDeleted: false,
  } as never);

describe("isAnimatedImageMimeType", () => {
  it("treats only GIF as animated", () => {
    expect(isAnimatedImageMimeType(MIME_TYPES.gif)).toBe(true);
  });

  it("does not pay for a DOM layer on still formats", () => {
    // an animated WebP would animate the same way, but a *still* WebP is
    // common enough that a DOM copy for every one would cost more than it is
    // worth
    for (const mimeType of [
      MIME_TYPES.png,
      MIME_TYPES.jpg,
      MIME_TYPES.webp,
      MIME_TYPES.svg,
      MIME_TYPES.bmp,
    ]) {
      expect(isAnimatedImageMimeType(mimeType)).toBe(false);
    }
  });

  it("does not treat a missing mime type as animated", () => {
    expect(isAnimatedImageMimeType(undefined)).toBe(false);
  });
});

describe("sceneHasAnimatedImage", () => {
  const files = (mimeType: string) =>
    ({ gif1: binaryFile(mimeType) } as unknown as BinaryFiles);

  it("is true for a GIF in the scene", () => {
    expect(
      sceneHasAnimatedImage([imageElement("gif1")], files(MIME_TYPES.gif)),
    ).toBe(true);
  });

  it("is false for a PNG in the scene", () => {
    expect(
      sceneHasAnimatedImage([imageElement("gif1")], files(MIME_TYPES.png)),
    ).toBe(false);
  });

  it("is false when the file backing the image is gone", () => {
    // a broken image must not add a DOM layer forever
    expect(sceneHasAnimatedImage([imageElement("missing")], {} as never)).toBe(
      false,
    );
  });

  it("ignores an image that has no file yet", () => {
    expect(
      sceneHasAnimatedImage([imageElement(null)], files(MIME_TYPES.gif)),
    ).toBe(false);
  });

  it("is false for a scene with no images at all", () => {
    expect(
      sceneHasAnimatedImage(
        [{ id: "r", type: "rectangle", isDeleted: false } as never],
        files(MIME_TYPES.gif),
      ),
    ).toBe(false);
  });

  it("finds a GIF that is not the first element", () => {
    expect(
      sceneHasAnimatedImage(
        [
          { id: "r", type: "rectangle", isDeleted: false } as never,
          { id: "t", type: "text", isDeleted: false } as never,
          imageElement("gif1"),
        ],
        files(MIME_TYPES.gif),
      ),
    ).toBe(true);
  });
});

/**
 * The renderer needs to know *which* images are animated, not just that some
 * are, so that it can leave exactly those to the overlay.
 */
describe("animatedImageFileIds", () => {
  // first argument is `gif1`'s mime, second is `pic2`'s
  const files = (gif1: string, pic2: string = MIME_TYPES.gif) =>
    ({
      gif1: binaryFile(gif1),
      pic2: binaryFile(pic2),
    } as unknown as BinaryFiles);

  it("names the GIF and leaves the still image out", () => {
    expect([
      ...animatedImageFileIds(
        [imageElement("gif1"), imageElement("pic2")],
        files(MIME_TYPES.gif, MIME_TYPES.png),
      ),
    ]).toEqual(["gif1"]);
  });

  it("finds the GIF wherever it sits in the scene", () => {
    expect([
      ...animatedImageFileIds(
        [imageElement("pic2"), imageElement("gif1")],
        files(MIME_TYPES.png, MIME_TYPES.gif),
      ),
    ]).toEqual(["pic2"]);
  });

  it("names every GIF in the scene", () => {
    expect([
      ...animatedImageFileIds(
        [imageElement("gif1"), imageElement("pic2")],
        files(MIME_TYPES.gif, MIME_TYPES.gif),
      ),
    ]).toEqual(["gif1", "pic2"]);
  });

  it("is empty for a scene with nothing animated", () => {
    expect(
      animatedImageFileIds(
        [imageElement("pic2")],
        files(MIME_TYPES.png, MIME_TYPES.png),
      ).size,
    ).toBe(0);
  });

  it("agrees with sceneHasAnimatedImage", () => {
    const elements = [imageElement("gif1")];

    expect(animatedImageFileIds(elements, files(MIME_TYPES.gif)).size > 0).toBe(
      sceneHasAnimatedImage(elements, files(MIME_TYPES.gif)),
    );
    expect(animatedImageFileIds(elements, files(MIME_TYPES.png)).size > 0).toBe(
      sceneHasAnimatedImage(elements, files(MIME_TYPES.png)),
    );
  });
});

/**
 * The overlay needs the elements themselves, not just their ids, because each
 * one has to be turned into a positioned `<img>`.
 */
describe("getAnimatedImageElements", () => {
  const files = (pic2: string) =>
    ({
      gif1: binaryFile(MIME_TYPES.gif),
      pic2: binaryFile(pic2),
    } as unknown as BinaryFiles);

  it("returns only the GIFs", () => {
    const gif = imageElement("gif1");
    const pic = imageElement("pic2");

    expect(getAnimatedImageElements([gif, pic], files(MIME_TYPES.png))).toEqual(
      [gif],
    );
  });

  it("returns nothing for a scene with no GIFs", () => {
    expect(
      getAnimatedImageElements([imageElement("pic2")], files(MIME_TYPES.png)),
    ).toEqual([]);
  });

  it("agrees with animatedImageFileIds on which elements count", () => {
    const elements = [imageElement("gif1"), imageElement("pic2")];
    const named = [
      ...animatedImageFileIds(elements, files(MIME_TYPES.png)),
    ].sort();

    expect(
      getAnimatedImageElements(elements, files(MIME_TYPES.png))
        .map((element) => element.fileId)
        .sort(),
    ).toEqual(named);
  });

  it("ignores an image whose file is gone", () => {
    // a broken GIF must not be given a DOM layer that can never resolve a src
    expect(
      getAnimatedImageElements([imageElement("missing")], {} as never),
    ).toEqual([]);
  });
});

/**
 * A GIF must not be painted onto the canvas at all.
 *
 * `drawImage` bakes in whichever frame the `<img>` is showing at that instant,
 * and a frame baked into a canvas — or into an element's raster cache — never
 * advances. Repainting it twenty times a second still shows frame one. So on
 * screen the renderer leaves animated images alone and the DOM overlay plays
 * them instead. Exports have no overlay and cannot animate anyway, so they take
 * the raster path unchanged.
 *
 * These drive `renderElement` directly rather than going through a mounted
 * editor: jsdom never gets far enough into a full render to reach this branch,
 * so a mounted-editor assertion would pass no matter what the renderer did.
 */
describe("the canvas leaves animated images to the DOM overlay", () => {
  const drawImageElement = ({
    fileId,
    animatedFileIds,
    isExporting,
  }: {
    fileId: string;
    animatedFileIds?: Set<string>;
    isExporting?: boolean;
  }) => {
    const element = API.createElement({
      type: "image",
      fileId,
      width: 100,
      height: 100,
    });

    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;

    const context = canvas.getContext("2d")!;

    // a populated cache is what makes `drawImage` reachable at all; without it
    // the renderer draws a placeholder and the assertions below would pass for
    // the wrong reason
    const imageCache = new Map([
      [
        fileId,
        { image: document.createElement("img"), mimeType: MIME_TYPES.gif },
      ],
    ]);

    renderElement(
      element,
      arrayToMap([element]) as never,
      arrayToMap([element]) as never,
      rough.canvas(canvas),
      context,
      {
        canvasBackgroundColor: "#ffffff",
        imageCache,
        renderGrid: false,
        isExporting: !!isExporting,
        embedsValidationStatus: { element: new Map(), frame: new Map() },
        elementsPendingErasure: new Map(),
        pendingFlowchartNodes: null,
        theme: THEME.LIGHT,
        animatedImageFileIds: animatedFileIds,
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

    return { element, context };
  };

  it("does not paint a GIF on screen", () => {
    const { element, context } = drawImageElement({
      fileId: "gif1",
      animatedFileIds: new Set(["gif1"]),
    });

    expect(context.drawImage).not.toHaveBeenCalled();
    expect(elementWithCanvasCache.has(element)).toBe(false);
  });

  it("still paints a still image", () => {
    // the control: without it, "nothing is painted" would also pass if the
    // renderer simply stopped drawing images altogether
    const { context } = drawImageElement({
      fileId: "pic1",
      animatedFileIds: new Set(["gif1"]),
    });

    expect(context.drawImage).toHaveBeenCalled();
  });

  it("still paints a GIF in an export", () => {
    // an export wants one still frame and has no overlay, so naming a file as
    // animated must not change its path
    const { context } = drawImageElement({
      fileId: "gif1",
      animatedFileIds: new Set(["gif1"]),
      isExporting: true,
    });

    expect(context.drawImage).toHaveBeenCalled();
  });

  it("only exempts the images the editor actually named", () => {
    // two GIFs on one board: naming one must not un-cache the other
    const { context } = drawImageElement({
      fileId: "gif2",
      animatedFileIds: new Set(["gif1"]),
    });

    expect(context.drawImage).toHaveBeenCalled();
  });

  it("caches an image when the editor named no animated files at all", () => {
    // what every scene without a GIF looks like: no set, or an empty one
    expect(
      drawImageElement({ fileId: "pic1", animatedFileIds: new Set() }).context
        .drawImage,
    ).toHaveBeenCalled();
    expect(
      drawImageElement({ fileId: "pic2" }).context.drawImage,
    ).toHaveBeenCalled();
  });
});

/**
 * The other half: the picture has to exist somewhere, as something the browser
 * will actually animate. Chromium only advances a GIF's frame clock while the
 * image is genuinely visible on screen, so an invisible or detached copy stays
 * frozen — every such configuration was measured against the running app.
 */
describe("the editor renders an animated image as a visible <img>", () => {
  const overlayImages = () =>
    Array.from(
      document.querySelectorAll<HTMLImageElement>(
        ".excalidraw__animated-images img",
      ),
    );

  const setup = async (mimeType: string) => {
    const image = API.createElement({
      type: "image",
      fileId: "gif1",
      width: 100,
      height: 100,
    });

    await render(
      <Excalidraw
        initialData={{
          elements: [image],
          files: { gif1: binaryFile(mimeType) },
        }}
      />,
    );
  };

  it("puts a GIF in the overlay layer", async () => {
    await setup(MIME_TYPES.gif);

    const images = overlayImages();

    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe(GIF_DATA_URL);
  });

  it("connects that copy to the document", async () => {
    // a detached `<img>` is exactly what freezes on frame one
    await setup(MIME_TYPES.gif);

    expect(overlayImages()[0].isConnected).toBe(true);
  });

  it("leaves a still image on the canvas, out of the overlay", async () => {
    // the control: a board full of PNGs must not grow a DOM layer
    await setup(MIME_TYPES.png);

    expect(overlayImages()).toHaveLength(0);
  });

  it("never lets the overlay swallow pointer events", async () => {
    // the whole editor's hit testing is the canvas underneath; an overlay that
    // took clicks would break selecting, dragging and the eraser
    await setup(MIME_TYPES.gif);

    const host = document.querySelector<HTMLElement>(
      ".excalidraw__animated-images",
    );

    expect(host).toBeTruthy();
    expect(host!.style.pointerEvents).toBe("none");
  });
});
