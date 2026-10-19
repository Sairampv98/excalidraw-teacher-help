/**
 * Geometry for the animated-image DOM overlay.
 *
 * Every positional assertion here goes through `sceneCoordsToViewportCoords` —
 * the library's own conversion — and through the transform string the
 * implementation actually produces, parsed and applied with plain matrix maths.
 * That combination is deliberate: it is the only way to catch the class of bug
 * this whole feature exists to fix, which is a transform that is internally
 * self-consistent but disagrees with the renderer about which way is "right".
 * Such an implementation would land a GIF mirrored off the side of the screen —
 * exactly the reported bug — while passing any test written against its own
 * arithmetic.
 */

import { describe, expect, it } from "vitest";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import {
  getElementAbsoluteCoords,
  getElementBounds,
} from "@excalidraw/element";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import {
  animatedImageClipPath,
  animatedImageTransform,
  animatedImageViewportRect,
  OUTSIDE_FRAME,
} from "../scene/animatedImageOverlay";
import { getCameraForPage, getPageRectByIndex } from "../scene/pages";

import { API } from "./helpers/api";

import type { NormalizedZoomValue } from "../types";

const VIEWPORT = { width: 1200, height: 800 };

/** tolerance for float drift, in CSS px */
const EPS = 0.001;

type Camera = {
  zoom: { value: NormalizedZoomValue };
  scrollX: number;
  scrollY: number;
};
type Point = { x: number; y: number };

/** maps a scene point through the library's renderer maths onto the viewport */
const toViewport = (camera: Camera, sceneX: number, sceneY: number) =>
  sceneCoordsToViewportCoords(
    { sceneX, sceneY },
    {
      zoom: camera.zoom,
      offsetLeft: 0,
      offsetTop: 0,
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
    },
  );

/**
 * Applies a CSS transform string to a point.
 *
 * CSS applies the functions left to right, outermost first, so a point is pushed
 * through them back to front. Written out longhand rather than with a matrix so
 * that a wrong argument in the transform string cannot hide inside a shared
 * helper.
 */
const applyTransform = (transform: string, point: Point): Point => {
  const functions = [
    ...transform.matchAll(/(translate|scale|rotate)\(([^)]*)\)/g),
  ].reverse();

  let { x, y } = point;

  for (const [, fn, rawArgs] of functions) {
    const args = rawArgs.split(",").map((arg) => parseFloat(arg));

    if (fn === "translate") {
      x += args[0];
      y += args.length > 1 ? args[1] : 0;
    } else if (fn === "scale") {
      x *= args[0];
      y *= args.length > 1 ? args[1] : args[0];
    } else {
      const cos = Math.cos(args[0]);
      const sin = Math.sin(args[0]);
      [x, y] = [x * cos - y * sin, x * sin + y * cos];
    }
  }

  return { x, y };
};

const map = (elements: ExcalidrawElement[]) =>
  new Map(elements.map((el) => [el.id, el])) as unknown as ElementsMap;

const image = (overrides: Record<string, unknown> = {}) =>
  API.createElement({
    type: "image",
    fileId: "gif1",
    x: 300,
    y: 200,
    width: 120,
    height: 80,
    ...overrides,
  });

/** the four corners of the box `drawElementOnCanvas` would draw into */
const localCorners = (element: ExcalidrawElement): Point[] => [
  { x: 0, y: 0 },
  { x: element.width, y: 0 },
  { x: 0, y: element.height },
  { x: element.width, y: element.height },
];

const expectClose = (actual: Point, expected: Point) => {
  expect(actual.x).toBeCloseTo(expected.x, 3);
  expect(actual.y).toBeCloseTo(expected.y, 3);
};

describe("animatedImageTransform", () => {
  it("puts an unrotated image's top-left corner exactly where the library puts it", () => {
    const element = image();
    const camera: Camera = {
      zoom: { value: 1 as NormalizedZoomValue },
      scrollX: 0,
      scrollY: 0,
    };

    expectClose(
      applyTransform(animatedImageTransform(element, map([element]), camera), {
        x: 0,
        y: 0,
      }),
      toViewport(camera, element.x, element.y),
    );
  });

  it("tracks scroll and zoom the same way the renderer does", () => {
    // this is the assertion the whole feature turns on: a negated scroll treated
    // as a plain scene coordinate mirrors the image off the side of the screen,
    // and it still "looks fine" on page 1, whose x is 0 and so cancels out
    const element = image({ x: 1600, y: 640 });
    const camera: Camera = {
      zoom: { value: 1.7 as NormalizedZoomValue },
      scrollX: -1340,
      scrollY: -220,
    };

    expectClose(
      applyTransform(animatedImageTransform(element, map([element]), camera), {
        x: 0,
        y: 0,
      }),
      toViewport(camera, element.x, element.y),
    );
  });

  it("places an image on page 2 using the real page-2 camera", () => {
    const pageRect = getPageRectByIndex(1);
    const camera = getCameraForPage({
      viewportWidth: VIEWPORT.width,
      viewportHeight: VIEWPORT.height,
      pageRect,
      maxZoom: 30,
    });

    const element = image({ x: pageRect.x + 200, y: pageRect.y + 150 });
    const cam: Camera = {
      zoom: { value: camera.zoom as NormalizedZoomValue },
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
    };

    const topLeft = applyTransform(
      animatedImageTransform(element, map([element]), cam),
      { x: 0, y: 0 },
    );

    const expected = toViewport(cam, element.x, element.y);

    // and it must actually be on screen — an image that is off the side is the
    // bug this replaced
    expect(topLeft.x).toBeGreaterThanOrEqual(-EPS);
    expect(topLeft.y).toBeGreaterThanOrEqual(-EPS);
    expect(topLeft.x).toBeLessThanOrEqual(VIEWPORT.width + EPS);
    expect(topLeft.y).toBeLessThanOrEqual(VIEWPORT.height + EPS);

    expectClose(topLeft, expected);
  });

  it("covers exactly the box the renderer covers, whatever the angle", () => {
    // the strongest statement available: whichever corners the implementation's
    // own transform moves them to, their bounding box is the library's
    // `getElementBounds` box on screen.
    //
    // `getElementBounds`, not `getElementAbsoluteCoords` — the latter is the
    // *unrotated* box, and the canvas applies the rotation on top of it rather
    // than folding it in, so it is the wrong oracle the moment an element turns.
    for (const angle of [
      0,
      Math.PI / 6,
      Math.PI / 4,
      Math.PI / 2,
      -Math.PI / 3,
    ]) {
      const element = image({ angle });
      const camera: Camera = {
        zoom: { value: 1.4 as NormalizedZoomValue },
        scrollX: -90,
        scrollY: -35,
      };
      const elementsMap = map([element]);

      const moved = localCorners(element).map((corner) =>
        applyTransform(
          animatedImageTransform(element, elementsMap, camera),
          corner,
        ),
      );

      const [x1, y1, x2, y2] = getElementBounds(element, elementsMap);
      const topLeft = toViewport(camera, x1, y1);
      const bottomRight = toViewport(camera, x2, y2);

      const movedLeft = Math.min(...moved.map((p) => p.x));
      const movedTop = Math.min(...moved.map((p) => p.y));
      const movedRight = Math.max(...moved.map((p) => p.x));
      const movedBottom = Math.max(...moved.map((p) => p.y));

      expect(movedLeft).toBeCloseTo(topLeft.x, 3);
      expect(movedTop).toBeCloseTo(topLeft.y, 3);
      expect(movedRight).toBeCloseTo(bottomRight.x, 3);
      expect(movedBottom).toBeCloseTo(bottomRight.y, 3);
    }
  });

  it("mirrors a flipped image in place", () => {
    // a flip is a negative scale applied *after* rotation, exactly as the canvas
    // does it; getting the order wrong rotates the mirror into the wrong axis
    const element = image({ angle: Math.PI / 3, scale: [-1, 1] } as never);
    const camera: Camera = {
      zoom: { value: 0.9 as NormalizedZoomValue },
      scrollX: -40,
      scrollY: -12,
    };
    const elementsMap = map([element]);

    const moved = localCorners(element).map((corner) =>
      applyTransform(
        animatedImageTransform(element, elementsMap, camera),
        corner,
      ),
    );

    const [x1, y1, x2, y2] = getElementBounds(element, elementsMap);

    expect(Math.min(...moved.map((p) => p.x))).toBeCloseTo(
      toViewport(camera, x1, y1).x,
      3,
    );
    expect(Math.max(...moved.map((p) => p.x))).toBeCloseTo(
      toViewport(camera, x2, y2).x,
      3,
    );
    expect(Math.min(...moved.map((p) => p.y))).toBeCloseTo(
      toViewport(camera, x1, y1).y,
      3,
    );
  });

  it("keeps an unrotated image centred on its own middle, flipped or not", () => {
    // with no rotation there is nothing for `shift` to compensate, so the box's
    // centre must land on the library's centre exactly
    for (const scale of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const element = image({ scale } as never);
      const camera: Camera = {
        zoom: { value: 1.25 as NormalizedZoomValue },
        scrollX: -310,
        scrollY: -75,
      };
      const elementsMap = map([element]);

      const middle = applyTransform(
        animatedImageTransform(element, elementsMap, camera),
        { x: element.width / 2, y: element.height / 2 },
      );

      const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);

      expectClose(middle, toViewport(camera, (x1 + x2) / 2, (y1 + y2) / 2));
    }
  });
});

describe("animatedImageViewportRect", () => {
  it("is the element's absolute bounds on screen", () => {
    const element = image({ angle: Math.PI / 5 });
    const camera: Camera = {
      zoom: { value: 2 as NormalizedZoomValue },
      scrollX: -640,
      scrollY: -410,
    };
    const elementsMap = map([element]);

    const rect = animatedImageViewportRect(element, elementsMap, camera);
    const [x1, y1, x2, y2] = getElementBounds(element, elementsMap);
    const topLeft = toViewport(camera, x1, y1);

    expectClose({ x: rect.left, y: rect.top }, topLeft);
    expect(rect.width).toBeCloseTo((x2 - x1) * camera.zoom.value, 3);
    expect(rect.height).toBeCloseTo((y2 - y1) * camera.zoom.value, 3);
  });
});

describe("animatedImageClipPath", () => {
  it("does not clip an image that is not in a frame", () => {
    // the host already clips to the viewport, which is all an unframed image
    // needs; adding an inset here would shrink it for no reason
    const element = image();
    const camera: Camera = {
      zoom: { value: 1 as NormalizedZoomValue },
      scrollX: 0,
      scrollY: 0,
    };

    expect(
      animatedImageClipPath(element, map([element]), camera, VIEWPORT),
    ).toBeNull();
  });

  it("clips to the frame when the image hangs out of it", () => {
    const frame = API.createElement({
      type: "frame",
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });
    const element = image({
      x: 200,
      y: 200,
      width: 400,
      height: 100,
      frameId: frame.id,
    });
    const camera: Camera = {
      zoom: { value: 2 as NormalizedZoomValue },
      scrollX: -50,
      scrollY: -30,
    };
    const elementsMap = map([frame, element]);

    const clipPath = animatedImageClipPath(
      element,
      elementsMap,
      camera,
      VIEWPORT,
    );

    expect(clipPath).not.toBeNull();

    // the clip must be the intersection of the two boxes on screen
    const imageRect = animatedImageViewportRect(element, elementsMap, camera);
    const frameRect = animatedImageViewportRect(frame, elementsMap, camera);

    const left = Math.max(imageRect.left, frameRect.left);
    const top = Math.max(imageRect.top, frameRect.top);
    const right = Math.min(
      imageRect.left + imageRect.width,
      frameRect.left + frameRect.width,
    );
    const bottom = Math.min(
      imageRect.top + imageRect.height,
      frameRect.top + frameRect.height,
    );

    expect(clipPath).toBe(
      `inset(${top}px ${VIEWPORT.width - right}px ${
        VIEWPORT.height - bottom
      }px ${left}px)`,
    );

    // and that clip must be strictly inside the image, i.e. it actually clips
    expect(right).toBeLessThan(imageRect.left + imageRect.width);
  });

  it("drops an image that lies entirely outside its frame", () => {
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const element = image({
      x: 900,
      y: 900,
      width: 100,
      height: 100,
      frameId: frame.id,
    });
    const camera: Camera = {
      zoom: { value: 1 as NormalizedZoomValue },
      scrollX: 0,
      scrollY: 0,
    };

    // deliberately *not* `null`: `null` means "no frame, so no clip", and the
    // caller draws that one. This image can never be seen, so it must be
    // reported differently or it would be rendered on top of the frame
    expect(
      animatedImageClipPath(element, map([frame, element]), camera, VIEWPORT),
    ).toBe(OUTSIDE_FRAME);
  });

  it("clips a rotated image by its rotated box, not its unrotated one", () => {
    // a 45° image whose *unrotated* box fits the frame exactly, but whose
    // corners stick well outside it. Clipping by the unrotated box would let
    // those corners spill past the frame, which is the bug being guarded.
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 250,
      height: 250,
    });
    const element = image({
      x: 50,
      y: 50,
      width: 200,
      height: 200,
      angle: Math.PI / 4,
      frameId: frame.id,
    });
    const camera: Camera = {
      zoom: { value: 1 as NormalizedZoomValue },
      scrollX: 0,
      scrollY: 0,
    };
    const elementsMap = map([frame, element]);

    const clipPath = animatedImageClipPath(
      element,
      elementsMap,
      camera,
      VIEWPORT,
    );

    expect(clipPath).not.toBeNull();

    const [x1] = getElementBounds(element, elementsMap);

    // the rotated box starts further out than the unrotated box at (50, 50)
    expect(x1).toBeLessThan(50);
    expect(clipPath).toContain(`${x1}px`);
    expect(clipPath).not.toContain("inset(50px ");
  });

  it("does not clip an image comfortably inside its frame", () => {
    const frame = API.createElement({
      type: "frame",
      x: 0,
      y: 0,
      width: 600,
      height: 600,
    });
    const element = image({
      x: 100,
      y: 100,
      width: 120,
      height: 80,
      frameId: frame.id,
    });
    const camera: Camera = {
      zoom: { value: 1.5 as NormalizedZoomValue },
      scrollX: -20,
      scrollY: -10,
    };

    // the intersection is the image itself, so the inset is the image's box —
    // correct, but only because it lines up; assert the numbers rather than
    // `null` so a regression that clips to the viewport would show up
    const clipPath = animatedImageClipPath(
      element,
      map([frame, element]),
      camera,
      VIEWPORT,
    );

    expect(clipPath).not.toBeNull();

    const imageRect = animatedImageViewportRect(
      element,
      map([frame, element]),
      camera,
    );

    expect(clipPath).toContain(`${imageRect.left}px`);
  });
});

describe("an image sitting on the second page", () => {
  it("is inside the viewport when the camera frames that page", () => {
    // the end-to-end statement of the reported bug: a GIF pasted on page 2 used
    // to render off to the left of the canvas, visible only in exports
    const pageRect = getPageRectByIndex(1);
    const camera = getCameraForPage({
      viewportWidth: VIEWPORT.width,
      viewportHeight: VIEWPORT.height,
      pageRect,
      maxZoom: 30,
    });
    const cam: Camera = {
      zoom: { value: camera.zoom as NormalizedZoomValue },
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
    };

    const element = image({ x: pageRect.x + 40, y: pageRect.y + 40 });
    const elementsMap = map([element]);

    const rect = animatedImageViewportRect(element, elementsMap, cam);

    expect(rect.left).toBeGreaterThanOrEqual(-EPS);
    expect(rect.top).toBeGreaterThanOrEqual(-EPS);
    expect(rect.left + rect.width).toBeLessThanOrEqual(VIEWPORT.width + EPS);
    expect(rect.top + rect.height).toBeLessThanOrEqual(VIEWPORT.height + EPS);
  });
});
