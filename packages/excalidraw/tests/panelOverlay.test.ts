/**
 * The geometry of the panel DOM overlay.
 *
 * Every positional assertion here goes through `sceneCoordsToViewportCoords` —
 * the library's own conversion, the oracle (D-34) — and through the transform
 * string the implementation actually produces, parsed and applied with plain
 * matrix maths. That combination is deliberate: it is the only way to catch
 * the class of bug this feature exists to prevent, which is a transform that
 * is internally self-consistent but disagrees with the renderer about which
 * way is "right". A panel is **interactive**, so such a bug is visible rather
 * than cosmetic.
 */

import { describe, expect, it } from "vitest";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import type {
  ElementsMap,
  ExcalidrawPanelElement,
} from "@excalidraw/element/types";

import { panelTransform } from "../scene/panelContent";

import { API } from "./helpers/api";

import type { NormalizedZoomValue } from "../types";

type Camera = {
  zoom: { value: NormalizedZoomValue };
  scrollX: number;
  scrollY: number;
  offsetLeft: number;
  offsetTop: number;
};

type Point = { x: number; y: number };

/**
 * The position the **canvas** would put a scene point at, in the overlay
 * host's own coordinates.
 *
 * The canvas draws in viewport coordinates, which include the editor
 * container's own offset; the overlay's host sits *inside* that container, so
 * the offset comes off again. That subtraction is the whole reason the
 * placement goes through the oracle instead of a re-derivation (D-34).
 */
const toOverlayCoords = (
  camera: Camera,
  sceneX: number,
  sceneY: number,
): Point => {
  const { x, y } = sceneCoordsToViewportCoords(
    { sceneX, sceneY },
    {
      zoom: camera.zoom,
      offsetLeft: camera.offsetLeft,
      offsetTop: camera.offsetTop,
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
    },
  );

  return { x: x - camera.offsetLeft, y: y - camera.offsetTop };
};

/**
 * Applies a CSS transform string to a point.
 *
 * CSS applies the functions left to right, outermost first, so a point is
 * pushed through them back to front. Written out longhand rather than with a
 * matrix so that a wrong argument in the transform string cannot hide inside
 * a shared helper.
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

const map = (elements: ExcalidrawPanelElement[]) =>
  new Map(elements.map((el) => [el.id, el])) as unknown as ElementsMap;

const panel = (overrides: Record<string, unknown> = {}) =>
  API.createElement({
    type: "panel",
    x: 300,
    y: 200,
    width: 120,
    height: 80,
    ...overrides,
  }) as unknown as ExcalidrawPanelElement;

const expectClose = (actual: Point, expected: Point) => {
  expect(actual.x).toBeCloseTo(expected.x, 3);
  expect(actual.y).toBeCloseTo(expected.y, 3);
};

describe("panelTransform", () => {
  it("AC-54 the overlay's screen position for a panel equals the position the canvas would use", () => {
    const element = panel();
    const camera: Camera = {
      zoom: { value: 1 as NormalizedZoomValue },
      scrollX: 0,
      scrollY: 0,
      offsetLeft: 0,
      offsetTop: 0,
    };

    const topLeft = applyTransform(
      panelTransform(element, map([element]), camera),
      { x: 0, y: 0 },
    );

    expectClose(topLeft, toOverlayCoords(camera, element.x, element.y));
  });

  it("AC-54 the placement tracks scroll and zoom the way the renderer does", () => {
    const element = panel({ x: 1600, y: 640 });
    const camera: Camera = {
      zoom: { value: 1.7 as NormalizedZoomValue },
      scrollX: -1340,
      scrollY: -220,
      // a non-zero container offset: this is what a re-derived formula that
      // forgets the offset gets wrong, and what the oracle gets right
      offsetLeft: 40,
      offsetTop: 25,
    };

    const topLeft = applyTransform(
      panelTransform(element, map([element]), camera),
      { x: 0, y: 0 },
    );

    expectClose(topLeft, toOverlayCoords(camera, element.x, element.y));
  });

  it("AC-54 the panel's centre lands on the canvas's centre", () => {
    // the rotation is about the element's centre, which is where the canvas
    // rotates it too — so the centre is the point that must not move
    const element = panel({ angle: Math.PI / 3 });
    const camera: Camera = {
      zoom: { value: 1.4 as NormalizedZoomValue },
      scrollX: -90,
      scrollY: -35,
      offsetLeft: 12,
      offsetTop: 7,
    };

    const centre = applyTransform(
      panelTransform(element, map([element]), camera),
      { x: element.width / 2, y: element.height / 2 },
    );

    expectClose(
      centre,
      toOverlayCoords(
        camera,
        element.x + element.width / 2,
        element.y + element.height / 2,
      ),
    );
  });

  it("AC-54 the panel's box covers exactly the box the renderer covers", () => {
    for (const angle of [
      0,
      Math.PI / 6,
      Math.PI / 4,
      Math.PI / 2,
      -Math.PI / 3,
    ]) {
      const element = panel({ angle });
      const camera: Camera = {
        zoom: { value: 1.2 as NormalizedZoomValue },
        scrollX: -60,
        scrollY: -20,
        offsetLeft: 0,
        offsetTop: 0,
      };

      const transform = panelTransform(element, map([element]), camera);

      const corners = [
        { x: 0, y: 0 },
        { x: element.width, y: 0 },
        { x: 0, y: element.height },
        { x: element.width, y: element.height },
      ].map((corner) => applyTransform(transform, corner));

      const movedLeft = Math.min(...corners.map((p) => p.x));
      const movedTop = Math.min(...corners.map((p) => p.y));
      const movedRight = Math.max(...corners.map((p) => p.x));
      const movedBottom = Math.max(...corners.map((p) => p.y));

      // the canvas rotates the element about its centre, so the rotated box
      // is the *bounding* box of the four corners — and the overlay's box
      // must be the same one
      const radiusX = element.width / 2;
      const radiusY = element.height / 2;
      const centre = toOverlayCoords(
        camera,
        element.x + radiusX,
        element.y + radiusY,
      );

      const halfWidth =
        (Math.abs(Math.cos(angle)) * radiusX +
          Math.abs(Math.sin(angle)) * radiusY) *
        camera.zoom.value;
      const halfHeight =
        (Math.abs(Math.sin(angle)) * radiusX +
          Math.abs(Math.cos(angle)) * radiusY) *
        camera.zoom.value;

      expect(movedLeft).toBeCloseTo(centre.x - halfWidth, 3);
      expect(movedRight).toBeCloseTo(centre.x + halfWidth, 3);
      expect(movedTop).toBeCloseTo(centre.y - halfHeight, 3);
      expect(movedBottom).toBeCloseTo(centre.y + halfHeight, 3);
    }
  });
});
